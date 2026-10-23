//! Bounded, local vector import. Binary sources are snapshotted and normalized
//! to GeoJSON, so reference layers, Events and portable saves share one path.
mod crs;
use super::{MAX_FEATURES, MAX_SOURCE};
use geo::Geometry;
use geozero::{
    error::{GeozeroError, Result as GeoResult},
    GeomProcessor, GeozeroGeometry, ToGeo,
};
use serde_json::{json, Map, Value};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
};
use wkt::ToWkt;

const MAX_VERTICES: usize = 50_000;
const MAX_TOTAL_VERTICES: usize = 2_000_000;
pub(super) struct Prepared {
    pub document: Vec<u8>,
    pub sources: BTreeMap<String, Vec<u8>>,
    pub warnings: Vec<String>,
}
fn read(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let meta = std::fs::symlink_metadata(path)
        .map_err(|e| format!("Missing GIS file {}: {e}", path.display()))?;
    if !meta.is_file() || meta.len() > limit {
        return Err(
            "Vector companions must be regular, nonsymlink files within the size limit".into(),
        );
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Vector source exceeds size limit".into());
    }
    Ok(bytes)
}
pub(super) fn prepare(path: &Path, source: &[u8]) -> Result<Prepared, String> {
    let mut sources = BTreeMap::new();
    sources.insert(
        path.file_name()
            .and_then(|p| p.to_str())
            .ok_or("Invalid vector filename")?
            .into(),
        source.to_vec(),
    );
    let mut features = Features::default();
    let mut warnings = Vec::new();
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "shp" => shapefile(path, source, &mut sources, &mut features)?,
        "gpkg" => geopackage(path, source, &mut features, &mut warnings)?,
        _ => return Err("Unsupported vector source".into()),
    }
    let document =
        serde_json::to_vec(&json!({"type":"FeatureCollection","features":features.rows}))
            .map_err(|e| e.to_string())?;
    if document.len() as u64 > MAX_SOURCE {
        return Err("Converted vector data exceeds 64 MiB; split the input".into());
    }
    Ok(Prepared {
        document,
        sources,
        warnings,
    })
}
#[derive(Default)]
struct Features {
    rows: Vec<Value>,
    bytes: usize,
    vertices: usize,
}
impl Features {
    fn push(
        &mut self,
        id: String,
        properties: Map<String, Value>,
        geometry: Option<Geometry<f64>>,
    ) -> Result<(), String> {
        crate::operation::check()?;
        if self.rows.len() >= MAX_FEATURES || properties.len() > 500 {
            return Err("Vector data exceeds 250000 features or 500 fields".into());
        }
        let shape = if let Some(g) = geometry {
            let text = g.wkt_string();
            let parsed = crate::geometry::parse(&text)?;
            self.vertices = self
                .vertices
                .checked_add(parsed.vertex_count)
                .ok_or("Vector vertex overflow")?;
            if self.vertices > MAX_TOTAL_VERTICES {
                return Err("Vector data exceeds two million vertices; split the input".into());
            }
            geometry_json(&g)?
        } else {
            Value::Null
        };
        let feature = json!({"type":"Feature","id":id,"properties":properties,"geometry":shape});
        let bytes = serde_json::to_vec(&feature)
            .map_err(|e| e.to_string())?
            .len();
        if bytes > 1024 * 1024 {
            return Err("Vector feature exceeds 1 MiB".into());
        }
        self.bytes = self
            .bytes
            .checked_add(bytes + 1)
            .ok_or("Vector size overflow")?;
        if self.bytes > MAX_SOURCE as usize - 128 {
            return Err("Converted vector data exceeds 64 MiB; split the input".into());
        }
        self.rows.push(feature);
        Ok(())
    }
}
fn geometry_json(g: &Geometry<f64>) -> Result<Value, String> {
    fn coord(c: &geo::Coord<f64>) -> Value {
        json!([c.x, c.y])
    }
    fn line(l: &geo::LineString<f64>) -> Value {
        Value::Array(l.0.iter().map(coord).collect())
    }
    fn polygon(p: &geo::Polygon<f64>) -> Value {
        Value::Array(
            std::iter::once(p.exterior())
                .chain(p.interiors())
                .map(line)
                .collect(),
        )
    }
    let (kind, coords) = match g {
        Geometry::Point(p) => ("Point", coord(&p.0)),
        Geometry::LineString(l) => ("LineString", line(l)),
        Geometry::Polygon(p) => ("Polygon", polygon(p)),
        Geometry::MultiPoint(p) => (
            "MultiPoint",
            Value::Array(p.0.iter().map(|p| coord(&p.0)).collect()),
        ),
        Geometry::MultiLineString(p) => (
            "MultiLineString",
            Value::Array(p.0.iter().map(line).collect()),
        ),
        Geometry::MultiPolygon(p) => (
            "MultiPolygon",
            Value::Array(p.0.iter().map(polygon).collect()),
        ),
        Geometry::GeometryCollection(p) => {
            return Ok(
                json!({"type":"GeometryCollection","geometries":p.0.iter().map(geometry_json).collect::<Result<Vec<_>,_>>()?}),
            )
        }
        _ => return Err("Only Simple Features geometry is supported".into()),
    };
    Ok(json!({"type":kind,"coordinates":coords}))
}
fn u32le(b: &[u8], i: usize) -> u32 {
    u32::from_le_bytes(b[i..i + 4].try_into().unwrap())
}
fn i32be(b: &[u8], i: usize) -> i32 {
    i32::from_be_bytes(b[i..i + 4].try_into().unwrap())
}
fn header(b: &[u8]) -> Result<u32, String> {
    if b.len() < 100
        || i32be(b, 0) != 9994
        || i32be(b, 24) < 50
        || (i32be(b, 24) as usize) * 2 != b.len()
        || u32le(b, 28) != 1000
    {
        return Err("Invalid Shapefile header or declared file length".into());
    }
    let kind = u32le(b, 32);
    if ![0, 1, 3, 5, 8].contains(&kind) {
        return Err("Shapefile import supports XY Point, Polyline, Polygon and MultiPoint. Export Z/M or MultiPatch geometry to XY first.".into());
    }
    Ok(kind)
}
fn preflight_shp(b: &[u8]) -> Result<Vec<(usize, usize)>, String> {
    let kind = header(b)?;
    let mut pos = 100;
    let mut records = Vec::new();
    let mut total = 0usize;
    while pos < b.len() {
        crate::operation::check()?;
        if records.len() >= MAX_FEATURES
            || pos + 12 > b.len()
            || i32be(b, pos) <= 0
            || i32be(b, pos + 4) < 2
        {
            return Err("Invalid Shapefile record header".into());
        }
        let len = (i32be(b, pos + 4) as usize)
            .checked_mul(2)
            .ok_or("Shapefile record overflow")?;
        let end = pos
            .checked_add(8)
            .and_then(|p| p.checked_add(len))
            .filter(|p| *p <= b.len())
            .ok_or("Truncated Shapefile record")?;
        let r = &b[pos + 8..end];
        let typ = u32le(r, 0);
        if typ != 0 && typ != kind {
            return Err("Shapefile record type differs from header".into());
        }
        let (expected, vertices) = match typ {
            0 => (4, 0),
            1 => (20, 1),
            8 if r.len() >= 40 => {
                let n = u32le(r, 36) as usize;
                if n == 0 {
                    return Err(
                        "Empty Shapefile MultiPoint; export empty geometry to NULL first".into(),
                    );
                }
                (
                    40usize
                        .checked_add(n.checked_mul(16).ok_or("Shapefile count overflow")?)
                        .ok_or("Shapefile count overflow")?,
                    n,
                )
            }
            3 | 5 if r.len() >= 44 => {
                let parts = u32le(r, 36) as usize;
                let n = u32le(r, 40) as usize;
                if parts > n || n > MAX_VERTICES || parts == 0 || n == 0 {
                    return Err("Invalid or excessive Shapefile part/point counts".into());
                }
                let expected = 44usize
                    .checked_add(parts * 4)
                    .and_then(|p| p.checked_add(n * 16))
                    .ok_or("Shapefile count overflow")?;
                if expected != r.len() {
                    return Err("Shapefile counts do not match record bytes".into());
                }
                let mut previous = None;
                for i in 0..parts {
                    let start = u32le(r, 44 + i * 4) as usize;
                    if start >= n || i == 0 && start != 0 || previous.is_some_and(|p| p >= start) {
                        return Err("Invalid Shapefile part offsets".into());
                    }
                    previous = Some(start);
                }
                (expected, n)
            }
            _ => return Err("Invalid Shapefile record".into()),
        };
        if r.len() != expected || vertices > MAX_VERTICES {
            return Err("Invalid or excessive Shapefile geometry size".into());
        }
        total = total
            .checked_add(vertices)
            .ok_or("Shapefile vertex overflow")?;
        if total > MAX_TOTAL_VERTICES {
            return Err("Shapefile exceeds two million vertices".into());
        }
        records.push((pos, len));
        pos = end;
    }
    Ok(records)
}
fn companions(path: &Path) -> Result<BTreeMap<String, PathBuf>, String> {
    let parent = path.parent().ok_or("Shapefile has no directory")?;
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Invalid Shapefile name")?;
    let mut found = BTreeMap::new();
    for (n, item) in std::fs::read_dir(parent)
        .map_err(|e| e.to_string())?
        .enumerate()
    {
        crate::operation::check()?;
        if n > 100_000 {
            return Err("Shapefile directory has too many entries".into());
        }
        let p = item.map_err(|e| e.to_string())?.path();
        if p.file_stem()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case(stem))
        {
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ["dbf", "shx", "prj", "cpg"].contains(&ext.as_str())
                && found.insert(ext, p).is_some()
            {
                return Err("Ambiguous case-insensitive Shapefile companions".into());
            }
        }
    }
    for ext in ["dbf", "shx", "prj"] {
        if !found.contains_key(ext) {
            return Err(format!("Shapefile requires its matching .{ext} companion"));
        }
    }
    Ok(found)
}
fn dbf_preflight(b: &[u8], count: usize) -> Result<(), String> {
    if b.len() < 33 || b[0] != 3 {
        return Err("Only standard dBASE III Shapefile attributes are supported; export memo/FoxPro tables first".into());
    }
    let header = u16::from_le_bytes(b[8..10].try_into().unwrap()) as usize;
    let row = u16::from_le_bytes(b[10..12].try_into().unwrap()) as usize;
    if u32le(b, 4) as usize != count
        || header < 33
        || (header - 33) % 32 != 0
        || (header - 33) / 32 > 498
        || header > b.len()
        || b[header - 1] != 13
        || row == 0
    {
        return Err(
            "Invalid DBF header, field count or geometry/attribute record count mismatch".into(),
        );
    }
    let end = header
        .checked_add(count.checked_mul(row).ok_or("DBF size overflow")?)
        .ok_or("DBF size overflow")?;
    if end > b.len() || b.len() > end + 1 || b.len() == end + 1 && b[end] != 26 {
        return Err("Truncated DBF or unexpected trailing bytes".into());
    }
    let mut fields = 1usize;
    let mut names = std::collections::BTreeSet::new();
    for f in b[32..header - 1].chunks_exact(32) {
        let name = &f[..11];
        let end = name.iter().position(|b| *b == 0).unwrap_or(11);
        if end == 0
            || !name[..end].is_ascii()
            || !names.insert(name[..end].to_vec())
            || ![b'C', b'N', b'F', b'D', b'L'].contains(&f[11])
            || f[16] == 0
            || f[11] == b'D' && f[16] != 8
            || f[11] == b'L' && f[16] != 1
        {
            return Err("Unsupported or invalid DBF field definition".into());
        }
        fields += f[16] as usize;
    }
    if fields != row {
        return Err("DBF fields do not match the declared record length".into());
    }
    for i in 0..count {
        if b[header + i * row] != b' ' {
            return Err("DBF contains deleted or invalid records; pack or export the Shapefile before importing".into());
        }
    }
    Ok(())
}
fn shapefile(
    path: &Path,
    source: &[u8],
    sources: &mut BTreeMap<String, Vec<u8>>,
    out: &mut Features,
) -> Result<(), String> {
    let records = preflight_shp(source)?;
    let paths = companions(path)?;
    let mut data = BTreeMap::new();
    let mut total = source.len() as u64;
    for (ext, path) in paths {
        let limit = if ext == "prj" {
            32768
        } else if ext == "cpg" {
            128
        } else {
            MAX_SOURCE.saturating_sub(total)
        };
        let bytes = read(&path, limit)?;
        total += bytes.len() as u64;
        if total > MAX_SOURCE {
            return Err("Shapefile companions exceed 64 MiB combined".into());
        }
        sources.insert(
            path.file_name()
                .and_then(|s| s.to_str())
                .ok_or("Invalid companion name")?
                .into(),
            bytes.clone(),
        );
        data.insert(ext, bytes);
    }
    crs::wgs84(&data["prj"])?;
    let index = &data["shx"];
    if header(index)? != u32le(source, 32) || index.len() != 100 + records.len() * 8 {
        return Err("Shapefile index does not match its geometry".into());
    }
    for (i, (pos, len)) in records.iter().enumerate() {
        if i32be(index, 100 + i * 8) < 0
            || (i32be(index, 100 + i * 8) as usize) * 2 != *pos
            || i32be(index, 104 + i * 8) < 0
            || (i32be(index, 104 + i * 8) as usize) * 2 != *len
        {
            return Err("Invalid Shapefile index offset or record size".into());
        }
    }
    let dbf = &data["dbf"];
    dbf_preflight(dbf, records.len())?;
    let label = if let Some(cpg) = data.get("cpg") {
        let text = std::str::from_utf8(cpg)
            .map_err(|_| "Invalid .cpg encoding")?
            .trim()
            .trim_start_matches('\u{feff}');
        if text == "65001" {
            "utf-8".into()
        } else if text.bytes().all(|b| b.is_ascii_digit()) {
            format!("windows-{text}")
        } else {
            text.to_owned()
        }
    } else {
        match dbf[29] {
            0 => "utf-8".into(),
            3 | 0x57 => "windows-1252".into(),
            _ => return Err("DBF code page requires a matching .cpg encoding declaration".into()),
        }
    };
    let encoding = shapefile::dbase::encoding_rs::Encoding::for_label(label.as_bytes())
        .ok_or("Unsupported DBF .cpg encoding")?;
    // dbase's decoder may replace malformed text. Reject it before decoding so
    // attribute values cannot silently change during normalization.
    let dbf_header = u16::from_le_bytes(dbf[8..10].try_into().unwrap()) as usize;
    let dbf_row = u16::from_le_bytes(dbf[10..12].try_into().unwrap()) as usize;
    for i in 0..records.len() {
        let mut offset = dbf_header + i * dbf_row + 1;
        for field in dbf[32..dbf_header - 1].chunks_exact(32) {
            let end = offset + field[16] as usize;
            if field[11] == b'C'
                && encoding
                    .decode_without_bom_handling_and_without_replacement(&dbf[offset..end])
                    .is_none()
            {
                return Err("DBF text does not match the declared encoding".into());
            }
            offset = end;
        }
    }
    let s = shapefile::ShapeReader::with_shx(Cursor::new(source), Cursor::new(index))
        .map_err(|e| e.to_string())?;
    let d = shapefile::dbase::ReaderBuilder::new()
        .with_encoding(shapefile::dbase::encoding::EncodingRs::from(encoding))
        .build(Cursor::new(dbf))
        .map_err(|e| e.to_string())?;
    let mut reader = shapefile::Reader::new(s, d);
    let mut count = 0;
    for item in reader.iter_shapes_and_records() {
        let (shape, record) =
            item.map_err(|e| format!("Invalid Shapefile record {}: {e}", count + 1))?;
        let geometry = if matches!(shape, shapefile::Shape::NullShape) {
            None
        } else {
            Some(
                shape
                    .try_into()
                    .map_err(|e| format!("Unsupported Shapefile geometry: {e}"))?,
            )
        };
        let mut properties = Map::new();
        for (key, value) in record {
            use shapefile::dbase::FieldValue;
            let value = match value {
                FieldValue::Character(v) => v.map(Value::String).unwrap_or(Value::Null),
                FieldValue::Numeric(v) => number_value(v)?,
                FieldValue::Float(v) => number_value(v.map(f64::from))?,
                FieldValue::Logical(v) => v.map(Value::Bool).unwrap_or(Value::Null),
                FieldValue::Date(v) => v
                    .map(|d| {
                        Value::String(format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day()))
                    })
                    .unwrap_or(Value::Null),
                _ => return Err("Unsupported DBF field type".into()),
            };
            properties.insert(key, value);
        }
        count += 1;
        out.push(count.to_string(), properties, geometry)?;
    }
    if count != records.len() {
        return Err("Shapefile geometry and attribute counts differ".into());
    }
    Ok(())
}
fn number_value(value: Option<f64>) -> Result<Value, String> {
    match value {
        None => Ok(Value::Null),
        Some(n) => serde_json::Number::from_f64(n)
            .map(Value::Number)
            .ok_or_else(|| "Nonfinite vector attribute".into()),
    }
}

// Validate file-controlled counts and recursion before GeoZero's allocating writer.
#[derive(Default)]
struct Budget {
    items: usize,
    vertices: usize,
    depth: usize,
}
impl Budget {
    fn size(&mut self, n: usize) -> GeoResult<()> {
        self.items = self
            .items
            .checked_add(n)
            .ok_or(GeozeroError::GeometryFormat)?;
        if self.items > MAX_VERTICES {
            Err(GeozeroError::GeometryFormat)
        } else {
            Ok(())
        }
    }
}
impl GeomProcessor for Budget {
    fn xy(&mut self, x: f64, y: f64, _: usize) -> GeoResult<()> {
        self.vertices += 1;
        if self.vertices > MAX_VERTICES
            || !x.is_finite()
            || !y.is_finite()
            || x.abs() > 180.
            || y.abs() > 90.
        {
            Err(GeozeroError::GeometryFormat)
        } else {
            Ok(())
        }
    }
    fn multipoint_begin(&mut self, n: usize, _: usize) -> GeoResult<()> {
        self.size(n)
    }
    fn linestring_begin(&mut self, _: bool, n: usize, _: usize) -> GeoResult<()> {
        self.size(n)
    }
    fn multilinestring_begin(&mut self, n: usize, _: usize) -> GeoResult<()> {
        self.size(n)
    }
    fn polygon_begin(&mut self, _: bool, n: usize, _: usize) -> GeoResult<()> {
        self.size(n)
    }
    fn multipolygon_begin(&mut self, n: usize, _: usize) -> GeoResult<()> {
        self.size(n)
    }
    fn geometrycollection_begin(&mut self, n: usize, _: usize) -> GeoResult<()> {
        self.depth += 1;
        if self.depth > 32 {
            return Err(GeozeroError::GeometryFormat);
        }
        self.size(n)
    }
    fn geometrycollection_end(&mut self, _: usize) -> GeoResult<()> {
        self.depth -= 1;
        Ok(())
    }
    fn circularstring_begin(&mut self, _: usize, _: usize) -> GeoResult<()> {
        Err(GeozeroError::GeometryFormat)
    }
    fn compoundcurve_begin(&mut self, _: usize, _: usize) -> GeoResult<()> {
        Err(GeozeroError::GeometryFormat)
    }
    fn curvepolygon_begin(&mut self, _: usize, _: usize) -> GeoResult<()> {
        Err(GeozeroError::GeometryFormat)
    }
    fn multicurve_begin(&mut self, _: usize, _: usize) -> GeoResult<()> {
        Err(GeozeroError::GeometryFormat)
    }
    fn multisurface_begin(&mut self, _: usize, _: usize) -> GeoResult<()> {
        Err(GeozeroError::GeometryFormat)
    }
    fn polyhedralsurface_begin(&mut self, _: usize, _: usize) -> GeoResult<()> {
        Err(GeozeroError::GeometryFormat)
    }
    fn tin_begin(&mut self, _: usize, _: usize) -> GeoResult<()> {
        Err(GeozeroError::GeometryFormat)
    }
    fn triangle_begin(&mut self, _: bool, _: usize, _: usize) -> GeoResult<()> {
        Err(GeozeroError::GeometryFormat)
    }
}
fn gpkg_geometry(bytes: &[u8]) -> Result<Geometry<f64>, String> {
    if bytes.len() < 13
        || bytes.len() > 512 * 1024
        || &bytes[..2] != b"GP"
        || bytes[2] != 0
        || bytes[3] & 0xf0 != 0
    {
        return Err(
            "Invalid/unsupported GeoPackage geometry header, empty geometry or size".into(),
        );
    }
    let envelope = (bytes[3] >> 1) & 7;
    if envelope > 1 {
        return Err("GeoPackage geometry supports XY only; export Z/M to XY first".into());
    }
    let wkb = 8 + if envelope == 1 { 32 } else { 0 };
    if bytes.len() < wkb + 5 {
        return Err("Truncated GeoPackage geometry".into());
    }
    let little = bytes[3] & 1 == 1;
    let srid = if little {
        i32::from_le_bytes(bytes[4..8].try_into().unwrap())
    } else {
        i32::from_be_bytes(bytes[4..8].try_into().unwrap())
    };
    if srid != 4326 || bytes[wkb] > 1 || (bytes[wkb] == 1) != little {
        return Err("GeoPackage geometry must use consistent byte order and EPSG:4326".into());
    }
    let kind = if little {
        u32le(bytes, wkb + 1)
    } else {
        u32::from_be_bytes(bytes[wkb + 1..wkb + 5].try_into().unwrap())
    };
    if !(1..=7).contains(&kind) {
        return Err("GeoPackage geometry supports XY Simple Features only".into());
    }
    let mut scan = WkbScan {
        bytes,
        pos: wkb,
        vertices: 0,
        items: 0,
    };
    scan.geometry(0, None)?;
    if scan.pos != bytes.len() {
        return Err("Trailing GeoPackage geometry bytes".into());
    }
    let geom = geozero::wkb::GpkgWkb(bytes);
    geom.process_geom(&mut Budget::default())
        .map_err(|e| format!("Invalid or excessive GeoPackage geometry: {e}"))?;
    geom.to_geo()
        .map_err(|e| format!("Invalid GeoPackage geometry: {e}"))
}
// This nonallocating preflight also checks every nested type and dimensional
// flag. Checking only the outer header could silently discard nested Z/M.
struct WkbScan<'a> {
    bytes: &'a [u8],
    pos: usize,
    vertices: usize,
    items: usize,
}
impl WkbScan<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], String> {
        let end = self
            .pos
            .checked_add(n)
            .filter(|p| *p <= self.bytes.len())
            .ok_or("Truncated GeoPackage geometry")?;
        let bytes = &self.bytes[self.pos..end];
        self.pos = end;
        Ok(bytes)
    }
    fn count(&mut self, little: bool) -> Result<usize, String> {
        let b = self.take(4)?;
        let n = if little {
            u32::from_le_bytes(b.try_into().unwrap())
        } else {
            u32::from_be_bytes(b.try_into().unwrap())
        } as usize;
        self.items = self
            .items
            .checked_add(n)
            .ok_or("GeoPackage count overflow")?;
        if self.items > MAX_VERTICES {
            return Err("GeoPackage geometry exceeds vertex/part budget".into());
        }
        Ok(n)
    }
    fn coord(&mut self, little: bool) -> Result<(), String> {
        self.vertices += 1;
        if self.vertices > MAX_VERTICES {
            return Err("GeoPackage geometry exceeds vertex budget".into());
        }
        let b = self.take(16)?;
        let x = if little {
            f64::from_le_bytes(b[..8].try_into().unwrap())
        } else {
            f64::from_be_bytes(b[..8].try_into().unwrap())
        };
        let y = if little {
            f64::from_le_bytes(b[8..].try_into().unwrap())
        } else {
            f64::from_be_bytes(b[8..].try_into().unwrap())
        };
        if !x.is_finite() || !y.is_finite() || x.abs() > 180. || y.abs() > 90. {
            return Err("GeoPackage coordinates must be finite WGS84 longitude/latitude".into());
        }
        Ok(())
    }
    fn geometry(&mut self, depth: usize, expected: Option<u32>) -> Result<(), String> {
        if depth > 32 {
            return Err("GeoPackage geometry nesting exceeds 32".into());
        }
        let order = self.take(1)?[0];
        if order > 1 {
            return Err("Invalid WKB byte order".into());
        }
        let little = order == 1;
        let b = self.take(4)?;
        let kind = if little {
            u32::from_le_bytes(b.try_into().unwrap())
        } else {
            u32::from_be_bytes(b.try_into().unwrap())
        };
        if !(1..=7).contains(&kind) || expected.is_some_and(|n| n != kind) {
            return Err(
                "GeoPackage requires standard XY Simple Features, including all nested geometries"
                    .into(),
            );
        }
        match kind {
            1 => self.coord(little)?,
            2 => {
                let n = self.count(little)?;
                if n < 2 {
                    return Err(
                        "GeoPackage LineString requires two points; export empty geometry to NULL"
                            .into(),
                    );
                }
                for _ in 0..n {
                    self.coord(little)?;
                }
            }
            3 => {
                let rings = self.count(little)?;
                if rings == 0 {
                    return Err("Export empty GeoPackage geometry to NULL first".into());
                }
                for _ in 0..rings {
                    let n = self.count(little)?;
                    if n < 4 {
                        return Err("GeoPackage polygon ring requires four points".into());
                    }
                    for _ in 0..n {
                        self.coord(little)?;
                    }
                }
            }
            4..=7 => {
                let n = self.count(little)?;
                if n == 0 {
                    return Err("Export empty GeoPackage geometry to NULL first".into());
                }
                for _ in 0..n {
                    self.geometry(depth + 1, if kind == 7 { None } else { Some(kind - 3) })?;
                }
            }
            _ => unreachable!(),
        }
        Ok(())
    }
}
fn quote(name: &str) -> Result<String, String> {
    if name.is_empty() || name.len() > 512 || name.contains('\0') {
        return Err("Invalid GeoPackage identifier".into());
    }
    Ok(format!("\"{}\"", name.replace('"', "\"\"")))
}
fn regular_table(conn: &rusqlite::Connection, name: &str) -> Result<(), String> {
    let typ: String = conn
        .query_row(
            "SELECT type FROM pragma_table_list WHERE schema='main' AND name=?1",
            [name],
            |r| r.get(0),
        )
        .map_err(|e| format!("Invalid GeoPackage table: {e}"))?;
    if typ != "table" {
        return Err(
            "GeoPackage features and metadata must be ordinary tables, not views or virtual tables"
                .into(),
        );
    }
    let hidden: i64 = conn
        .query_row(
            "SELECT count(*) FROM pragma_table_xinfo(?1) WHERE hidden<>0",
            [name],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if hidden != 0 {
        return Err("GeoPackage generated/hidden columns are not supported".into());
    }
    Ok(())
}
fn geopackage(
    path: &Path,
    source: &[u8],
    out: &mut Features,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    if source.len() < 100 || &source[..16] != b"SQLite format 3\0" {
        return Err("Invalid GeoPackage SQLite header".into());
    }
    let mut wal = path.as_os_str().to_os_string();
    wal.push("-wal");
    match std::fs::symlink_metadata(wal) {
        Ok(meta) if !meta.is_file() || meta.len()>0 => return Err("GeoPackage has pending or invalid WAL changes; close/checkpoint it in the source application before importing".into()),
        Ok(_) => (),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(e.to_string()),
    }
    let mut snapshot = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
    snapshot.write_all(source).map_err(|e| e.to_string())?;
    snapshot.flush().map_err(|e| e.to_string())?;
    let conn = rusqlite::Connection::open_with_flags(
        snapshot.path(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;
    use rusqlite::limits::Limit;
    conn.set_limit(Limit::SQLITE_LIMIT_LENGTH, 1024 * 1024)
        .map_err(|e| e.to_string())?;
    conn.set_limit(Limit::SQLITE_LIMIT_SQL_LENGTH, 65536)
        .map_err(|e| e.to_string())?;
    conn.set_limit(Limit::SQLITE_LIMIT_COLUMN, 512)
        .map_err(|e| e.to_string())?;
    conn.set_limit(Limit::SQLITE_LIMIT_EXPR_DEPTH, 32)
        .map_err(|e| e.to_string())?;
    conn.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0)
        .map_err(|e| e.to_string())?;
    conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)
        .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;")
        .map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();
    conn.progress_handler(
        1000,
        Some(move || {
            start.elapsed() > std::time::Duration::from_secs(30)
                || crate::operation::check().is_err()
        }),
    );
    let app_id: i64 = conn
        .query_row("PRAGMA application_id", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if app_id != 0x47504b47 {
        return Err("File is not a standard GeoPackage (GPKG application ID required)".into());
    }
    for name in [
        "gpkg_contents",
        "gpkg_geometry_columns",
        "gpkg_spatial_ref_sys",
    ] {
        regular_table(&conn, name)?;
    }
    let crs:i64=conn.query_row("SELECT count(*) FROM gpkg_spatial_ref_sys WHERE srs_id=4326 AND upper(organization)='EPSG' AND organization_coordsys_id=4326",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    if crs != 1 {
        return Err("GeoPackage requires an explicit EPSG:4326 spatial reference".into());
    }
    let extensions: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name='gpkg_extensions'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if extensions > 0 {
        regular_table(&conn, "gpkg_extensions")?;
        let unsupported:i64=conn.query_row("SELECT count(*) FROM gpkg_extensions WHERE extension_name NOT IN ('gpkg_rtree_index','gpkg_crs_wkt') OR extension_name IS NULL",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        if unsupported > 0 {
            return Err(
                "GeoPackage uses unsupported extensions; export standard vector features first"
                    .into(),
            );
        }
    }
    let mut statement=conn.prepare("SELECT c.table_name,g.column_name,g.geometry_type_name,g.srs_id,g.z,g.m,c.srs_id FROM gpkg_contents c JOIN gpkg_geometry_columns g ON c.table_name=g.table_name WHERE c.data_type='features' ORDER BY c.table_name LIMIT 65").map_err(|e|e.to_string())?;
    let tables = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if tables.is_empty() || tables.len() > 64 {
        return Err(
            "GeoPackage requires 1–64 vector feature tables; raster-only packages are unsupported"
                .into(),
        );
    }
    let declared: i64 = conn
        .query_row(
            "SELECT count(*) FROM gpkg_contents WHERE data_type='features'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if declared != tables.len() as i64 {
        return Err("GeoPackage feature metadata is missing or duplicated".into());
    }
    let other: i64 = conn
        .query_row(
            "SELECT count(*) FROM gpkg_contents WHERE data_type<>'features'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if other > 0 {
        warnings.push("GeoPackage raster/attribute-only tables are retained in the source file but are not imported as vector features.".into());
    }
    let mut seen = std::collections::BTreeSet::new();
    for (table, column, kind, srid, z, m, content_srid) in tables {
        crate::operation::check()?;
        quote(&table)?;
        quote(&column)?;
        regular_table(&conn, &table)?;
        if !seen.insert(table.clone())
            || srid != 4326
            || content_srid != 4326
            || z != 0
            || m != 0
            || ![
                "GEOMETRY",
                "POINT",
                "LINESTRING",
                "POLYGON",
                "MULTIPOINT",
                "MULTILINESTRING",
                "MULTIPOLYGON",
                "GEOMETRYCOLLECTION",
            ]
            .contains(&kind.to_ascii_uppercase().as_str())
        {
            return Err(format!("GeoPackage layer {table} must contain standard XY geometry in EPSG:4326; reproject/export unsupported layers first"));
        }
        let mut info = conn
            .prepare("SELECT name,pk,type FROM pragma_table_info(?1) ORDER BY cid")
            .map_err(|e| e.to_string())?;
        let columns = info
            .query_map([&table], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if columns.len() > 499 || columns.iter().any(|(n, _, _)| quote(n).is_err()) {
            return Err("GeoPackage exceeds 499 columns or has invalid column names".into());
        }
        let geometry_index = columns
            .iter()
            .position(|(n, _, _)| n == &column)
            .ok_or("Missing GeoPackage geometry column")?;
        let keys: Vec<_> = columns
            .iter()
            .enumerate()
            .filter(|(_, (_, pk, _))| *pk > 0)
            .collect();
        if keys.len() != 1 || keys[0].1 .2.to_ascii_uppercase() != "INTEGER" {
            return Err("GeoPackage feature table requires one INTEGER primary key".into());
        }
        let key_index = keys[0].0;
        let sql = format!(
            "SELECT {} FROM {} LIMIT {}",
            columns
                .iter()
                .map(|(n, _, _)| quote(n))
                .collect::<Result<Vec<_>, _>>()?
                .join(","),
            quote(&table)?,
            MAX_FEATURES + 1
        );
        let mut query = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut rows = query.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows
            .next()
            .map_err(|e| format!("Cannot read GeoPackage layer {table}: {e}"))?
        {
            crate::operation::check()?;
            let id: i64 = row.get(key_index).map_err(|e| e.to_string())?;
            let geometry = match row.get_ref(geometry_index).map_err(|e| e.to_string())? {
                rusqlite::types::ValueRef::Null => None,
                rusqlite::types::ValueRef::Blob(b) => Some(gpkg_geometry(b)?),
                _ => return Err("GeoPackage geometry must be a binary geometry or NULL".into()),
            };
            if let Some(g) = &geometry {
                let actual = match g {
                    Geometry::Point(_) => "POINT",
                    Geometry::LineString(_) => "LINESTRING",
                    Geometry::Polygon(_) => "POLYGON",
                    Geometry::MultiPoint(_) => "MULTIPOINT",
                    Geometry::MultiLineString(_) => "MULTILINESTRING",
                    Geometry::MultiPolygon(_) => "MULTIPOLYGON",
                    Geometry::GeometryCollection(_) => "GEOMETRYCOLLECTION",
                    _ => return Err("Unsupported geometry type".into()),
                };
                if !kind.eq_ignore_ascii_case("GEOMETRY") && !kind.eq_ignore_ascii_case(actual) {
                    return Err("GeoPackage geometry type differs from its layer metadata".into());
                }
            }
            let mut properties = Map::new();
            for (i, (name, _, _)) in columns.iter().enumerate() {
                if i == geometry_index {
                    continue;
                }
                use rusqlite::types::ValueRef;
                let value=match row.get_ref(i).map_err(|e|e.to_string())? {
                    ValueRef::Null=>Value::Null,ValueRef::Integer(n)=>Value::String(n.to_string()),ValueRef::Real(n)=>number_value(Some(n))?,
                    ValueRef::Text(s)=>Value::String(std::str::from_utf8(s).map_err(|_|"GeoPackage text must be UTF-8")?.into()),
                    ValueRef::Blob(_)=>return Err("GeoPackage binary attribute columns are not supported; export them to text first".into()),
                };
                properties.insert(name.clone(), value);
            }
            let source_key = if properties.contains_key("source_layer") {
                "chronoscope_source_layer"
            } else {
                "source_layer"
            };
            if properties.contains_key(source_key) {
                return Err("GeoPackage reserves source_layer/chronoscope_source_layer for layer provenance".into());
            }
            properties.insert(source_key.into(), Value::String(table.clone()));
            out.push(
                format!("{}/{id}", table.replace('~', "~0").replace('/', "~1")),
                properties,
                geometry,
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn point() -> Vec<u8> {
        let mut b = vec![1];
        b.extend(1u32.to_le_bytes());
        b.extend(12f64.to_le_bytes());
        b.extend(48f64.to_le_bytes());
        b
    }
    fn gpkg(wkb: &[u8]) -> Vec<u8> {
        let mut b = b"GP\0\x01".to_vec();
        b.extend(4326i32.to_le_bytes());
        b.extend(wkb);
        b
    }
    #[test]
    fn geometry_rejects_truncation_flags_srid_nonfinite_coordinates_and_trailing_data() {
        let good = gpkg(&point());
        assert!(gpkg_geometry(&good).is_ok());
        for end in 0..good.len() {
            assert!(gpkg_geometry(&good[..end]).is_err());
        }
        for (pos, value) in [(0, b'X'), (2, 1), (3, 0x81), (3, 0x21), (4, 0)] {
            let mut b = good.clone();
            b[pos] = value;
            assert!(gpkg_geometry(&b).is_err());
        }
        let mut b = good.clone();
        b[13..21].copy_from_slice(&f64::NAN.to_le_bytes());
        assert!(gpkg_geometry(&b).is_err());
        let mut b = good;
        b.push(0);
        assert!(gpkg_geometry(&b).is_err());
    }
    #[test]
    fn geometry_rejects_nested_dimensions_wrong_child_types_and_excessive_recursion() {
        let mut z = point();
        z[1..5].copy_from_slice(&1001u32.to_le_bytes());
        z.extend(100f64.to_le_bytes());
        let mut collection = vec![1];
        collection.extend(7u32.to_le_bytes());
        collection.extend(1u32.to_le_bytes());
        collection.extend(z);
        assert!(gpkg_geometry(&gpkg(&collection)).is_err());
        collection[1..5].copy_from_slice(&5u32.to_le_bytes());
        assert!(gpkg_geometry(&gpkg(&collection)).is_err());
        let mut nested = Vec::new();
        for _ in 0..2000 {
            nested.push(1);
            nested.extend(7u32.to_le_bytes());
            nested.extend(1u32.to_le_bytes());
        }
        nested.extend(point());
        assert!(gpkg_geometry(&gpkg(&nested))
            .unwrap_err()
            .contains("nesting"));
    }
    #[test]
    fn geometry_checks_hostile_counts_before_allocating() {
        for typ in 2u32..=7 {
            let mut b = vec![1];
            b.extend(typ.to_le_bytes());
            b.extend(u32::MAX.to_le_bytes());
            assert!(gpkg_geometry(&gpkg(&b)).unwrap_err().contains("budget"));
        }
    }
    #[test]
    fn geometry_accepts_big_endian_and_validates_every_nested_byte_order() {
        let mut b = b"GP\0\0".to_vec();
        b.extend(4326i32.to_be_bytes());
        b.push(0);
        b.extend(1u32.to_be_bytes());
        b.extend(12f64.to_be_bytes());
        b.extend(48f64.to_be_bytes());
        assert!(gpkg_geometry(&b).is_ok());
        let mut w = vec![1];
        w.extend(7u32.to_le_bytes());
        w.extend(1u32.to_le_bytes());
        w.extend(&b[8..]);
        assert!(gpkg_geometry(&gpkg(&w)).is_ok());
    }
    #[test]
    fn crs_recognizer_rejects_spoofed_wgs84_labels_and_ambiguous_axes() {
        let good = include_bytes!("../../tests/fixtures/gis/vector/events.prj");
        assert!(crs::wgs84(good).is_ok());
        let text = std::str::from_utf8(good).unwrap();
        for bad in [
            text.replace("6378137", "6370000"),
            text.replace("298.257223563", "300"),
            text.replace("0.0174532925199433", "1"),
            text.replace("PRIMEM[\"Greenwich\",0]", "PRIMEM[\"Greenwich\",2]"),
            text.replace("GEOGCS[", "PROJCS["),
        ] {
            assert!(crs::wgs84(bad.as_bytes()).is_err());
        }
    }
}
