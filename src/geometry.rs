//! OGC Simple Features WKT using GeoRust grammar and topology validation.
//! Geometry X/Y are longitude/latitude in WGS84. Z/M are retained in original
//! text, not treated as altitude/time. No implied projection or datum guessing.
use geo::{Coord, Geometry, Intersects, Rect, Validation};
use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
};
use wkt::{types::Coord as WktCoord, Wkt};
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct Shape {
    pub kind: String,
    pub points: Vec<[f64; 2]>,
    pub lines: Vec<Vec<[f64; 2]>>,
    pub polygons: Vec<Vec<Vec<[f64; 2]>>>,
    pub bounds: Option<[f64; 4]>,
    pub vertex_count: usize,
    pub dimensions: String,
    #[serde(skip)]
    #[schemars(skip)]
    pub geometry: Option<Geometry<f64>>,
}
fn coordinate(c: &WktCoord<f64>) -> Result<[f64; 2], String> {
    if !c.x.is_finite()
        || !c.y.is_finite()
        || !(-180.0..=180.0).contains(&c.x)
        || !(-90.0..=90.0).contains(&c.y)
        || c.z.is_some_and(|v| !v.is_finite())
        || c.m.is_some_and(|v| !v.is_finite())
    {
        return Err("WKT coordinates require finite WGS84 X=longitude [-180,180], Y=latitude [-90,90]; reproject other CRS first".into());
    }
    Ok([c.x, c.y])
}
fn line(coords: &[WktCoord<f64>], ring: bool) -> Result<Vec<[f64; 2]>, String> {
    let points = coords
        .iter()
        .map(coordinate)
        .collect::<Result<Vec<_>, _>>()?;
    if !points.is_empty()
        && (points.len() < if ring { 4 } else { 2 } || ring && points.first() != points.last())
    {
        return Err("WKT line needs at least two positions; polygon rings need at least four and must close explicitly".into());
    }
    if points.windows(2).any(|p| (p[0][0] - p[1][0]).abs() > 180.) {
        return Err("WKT segment crosses the antimeridian; split it at ±180° into a multi-geometry before import".into());
    }
    Ok(points)
}
fn collect(w: &Wkt<f64>, shape: &mut Shape) -> Result<(), String> {
    match w {
        Wkt::Point(p) => {
            if let Some(c) = p.coord() {
                shape.points.push(coordinate(c)?);
            }
        }
        Wkt::LineString(l) => shape.lines.push(line(l.coords(), false)?),
        Wkt::Polygon(p) => shape.polygons.push(
            p.rings()
                .iter()
                .map(|r| line(r.coords(), true))
                .collect::<Result<Vec<_>, _>>()?,
        ),
        Wkt::MultiPoint(g) => {
            for p in g.points() {
                collect(&Wkt::Point(p.clone()), shape)?
            }
        }
        Wkt::MultiLineString(g) => {
            for l in g.line_strings() {
                collect(&Wkt::LineString(l.clone()), shape)?
            }
        }
        Wkt::MultiPolygon(g) => {
            for p in g.polygons() {
                collect(&Wkt::Polygon(p.clone()), shape)?
            }
        }
        Wkt::GeometryCollection(g) => {
            for child in g.geometries() {
                collect(child, shape)?
            }
        }
    }
    Ok(())
}
fn to_geometry(w: &Wkt<f64>) -> Result<Option<Geometry<f64>>, String> {
    match w {
        Wkt::Point(point) if point.coord().is_none() => Ok(None),
        Wkt::GeometryCollection(collection) => {
            let children = collection
                .geometries()
                .iter()
                .map(to_geometry)
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .flatten()
                .collect();
            Ok(Some(Geometry::GeometryCollection(geo::GeometryCollection(
                children,
            ))))
        }
        _ => w
            .clone()
            .try_into()
            .map(Some)
            .map_err(|e| format!("Unsupported WKT geometry: {e}")),
    }
}
// Repeated annual country boundaries share validation work. Cache only fully
// validated results, bounded by source bytes, vertices and entry count.
type ParsedCache = VecDeque<(String, Shape)>;
static PARSED: OnceLock<Mutex<ParsedCache>> = OnceLock::new();
pub fn parse(text: &str) -> Result<Shape, String> {
    let cache = PARSED.get_or_init(|| Mutex::new(VecDeque::new()));
    if let Ok(entries) = cache.lock() {
        if let Some((_, shape)) = entries.iter().find(|(key, _)| key == text) {
            return Ok(shape.clone());
        }
    }
    let shape = parse_uncached(text)?;
    if let Ok(mut entries) = cache.lock() {
        while entries.len() >= 256
            || entries.iter().map(|(key, _)| key.len()).sum::<usize>() + text.len()
                > 4 * 1024 * 1024
            || entries
                .iter()
                .map(|(_, shape)| shape.vertex_count)
                .sum::<usize>()
                + shape.vertex_count
                > 200000
        {
            entries.pop_front();
        }
        entries.push_back((text.into(), shape.clone()));
    }
    Ok(shape)
}
fn parse_uncached(text: &str) -> Result<Shape, String> {
    if text.len() > 512 * 1024 {
        return Err("WKT exceeds 512 KiB per record".into());
    }
    let mut text = text.trim();
    if text
        .get(..5)
        .is_some_and(|s| s.eq_ignore_ascii_case("SRID="))
    {
        let (srid, body) = text.split_once(';').ok_or("Invalid EWKT SRID prefix")?;
        if srid[5..].trim() != "4326" {
            return Err("WKT SRID must be 4326; other projections/datums require reprojection before import".into());
        }
        text = body.trim();
    }
    // Bound parser recursion and reject trailing text (including another geometry).
    let mut depth = 0i32;
    let mut closed = false;
    for c in text.chars() {
        if closed && !c.is_whitespace() {
            return Err("Trailing text after WKT geometry".into());
        }
        if c == '(' {
            depth += 1;
            if depth > 32 {
                return Err("WKT exceeds 32 nesting levels".into());
            }
        }
        if c == ')' {
            depth -= 1;
            if depth < 0 {
                return Err("Unbalanced WKT parentheses".into());
            }
            if depth == 0 {
                closed = true;
            }
        }
    }
    if depth != 0 {
        return Err("Unbalanced WKT parentheses".into());
    }
    if !text.contains('(')
        && text
            .split_whitespace()
            .last()
            .is_none_or(|v| !v.eq_ignore_ascii_case("EMPTY"))
    {
        return Err("Invalid WKT geometry".into());
    }
    if !text.contains('(') {
        let words = text.split_whitespace().collect::<Vec<_>>();
        if !(words.len() == 2
            || words.len() == 3
                && ["Z", "M", "ZM"]
                    .iter()
                    .any(|d| words[1].eq_ignore_ascii_case(d)))
        {
            return Err("Invalid or trailing text after EMPTY geometry".into());
        }
    }
    let w: Wkt<f64> = text.parse().map_err(|e| format!("Invalid WKT: {e}"))?;
    let kind = match &w {
        Wkt::Point(_) => "Point",
        Wkt::LineString(_) => "LineString",
        Wkt::Polygon(_) => "Polygon",
        Wkt::MultiPoint(_) => "MultiPoint",
        Wkt::MultiLineString(_) => "MultiLineString",
        Wkt::MultiPolygon(_) => "MultiPolygon",
        Wkt::GeometryCollection(_) => "GeometryCollection",
    }
    .to_string();
    let mut shape = Shape {
        kind,
        points: vec![],
        lines: vec![],
        polygons: vec![],
        bounds: None,
        vertex_count: 0,
        dimensions: format!("{:?}", w.dimension()),
        geometry: None,
    };
    collect(&w, &mut shape)?;
    for p in shape
        .points
        .iter()
        .chain(shape.lines.iter().flatten())
        .chain(shape.polygons.iter().flatten().flatten())
    {
        shape.vertex_count += 1;
        if shape.vertex_count > 50000 {
            return Err("WKT exceeds 50,000 vertices per record".into());
        }
        if let Some(b) = shape.bounds.as_mut() {
            b[0] = b[0].min(p[0]);
            b[1] = b[1].min(p[1]);
            b[2] = b[2].max(p[0]);
            b[3] = b[3].max(p[1]);
        } else {
            shape.bounds = Some([p[0], p[1], p[0], p[1]]);
        }
    }
    // Empty Point is not representable by geo_types::Point, but remains valid
    // WKT with no footprint. Nonempty geometries must pass OGC topology checks.
    if shape.vertex_count > 0 {
        let geometry = to_geometry(&w)?.ok_or("WKT geometry has no nonempty components")?;
        geometry
            .check_validation()
            .map_err(|e| format!("Invalid WKT topology: {e}"))?;
        shape.geometry = Some(geometry);
    }
    Ok(shape)
}
pub fn intersects(text: &str, south: f64, north: f64, west: f64, east: f64) -> bool {
    let Ok(shape) = parse(text) else { return false };
    let Some(g) = shape.geometry else {
        return false;
    };
    let check = |w, e| {
        g.intersects(&Rect::new(
            Coord { x: w, y: south },
            Coord { x: e, y: north },
        ))
    };
    if west <= east {
        check(west, east)
    } else {
        check(west, 180.) || check(-180., east)
    }
}
