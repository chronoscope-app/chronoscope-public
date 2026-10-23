//! Attribute/event extraction is independent of Cesium's native presentation.
//! No centroids, guessed CRS, timestamps, or model georeferencing are invented.
use super::*;
use crate::import::{RawImport, RawTable};
use serde_json::{json, Value};
use std::collections::BTreeMap;
#[derive(Clone, Debug, Serialize, schemars::JsonSchema)]
pub struct Feature {
    pub id: String,
    pub properties: BTreeMap<String, String>,
    pub geometry_wkt: Option<String>,
    pub time: Option<String>,
    pub end: Option<String>,
    pub entity: String,
}
fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        _ => v.to_string(),
    }
}
fn properties(v: &Value) -> Result<BTreeMap<String, String>, String> {
    let p: BTreeMap<_, _> = v
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, v)| (k.clone(), text(v)))
        .collect();
    if p.len() > 500 || p.iter().map(|(k, v)| k.len() + v.len()).sum::<usize>() > 1024 * 1024 {
        return Err("GIS attributes exceed 500 fields or 1 MiB per feature".into());
    }
    Ok(p)
}
fn prop<'a>(p: &'a BTreeMap<String, String>, names: &[&str]) -> Option<&'a String> {
    names.iter().find_map(|name| {
        p.iter()
            .find(|(key, v)| key.eq_ignore_ascii_case(name) && !v.trim().is_empty())
            .map(|(_, v)| v)
    })
}
fn feature(
    id: String,
    p: BTreeMap<String, String>,
    wkt: Option<String>,
    time: Option<String>,
    end: Option<String>,
    entity: Option<String>,
) -> Feature {
    let time = time.or_else(|| {
        prop(
            &p,
            &[
                "timestamp",
                "datetime",
                "time",
                "date",
                "start",
                "begin",
                "when",
            ],
        )
        .cloned()
    });
    let end = end.or_else(|| prop(&p, &["end", "end_time", "end_timestamp", "stop"]).cloned());
    let entity = entity
        .or_else(|| {
            prop(
                &p,
                &["entity", "track", "track_id", "storm", "name", "title"],
            )
            .cloned()
        })
        .unwrap_or_else(|| id.clone());
    Feature {
        id,
        properties: p,
        geometry_wkt: wkt,
        time,
        end,
        entity,
    }
}
fn number(v: &Value) -> Result<f64, String> {
    v.as_f64()
        .filter(|n| n.is_finite())
        .ok_or_else(|| "Geometry coordinates must be finite numbers".into())
}
fn coord(v: &Value) -> Result<String, String> {
    let a = v.as_array().ok_or("Invalid coordinate array")?;
    if a.len() < 2 || a.len() > 3 {
        return Err("GIS positions require longitude, latitude and optional height".into());
    }
    let x = number(&a[0])?;
    let y = number(&a[1])?;
    if !(-180. ..=180.).contains(&x) || !(-90. ..=90.).contains(&y) {
        return Err(
            "GIS coordinates must be WGS84 longitude/latitude; reproject other CRS before import"
                .into(),
        );
    }
    if a.len() == 3 {
        return Ok(format!("{x} {y} {}", number(&a[2])?));
    }
    Ok(format!("{x} {y}"))
}
fn array(v: &Value) -> Result<&Vec<Value>, String> {
    v.as_array()
        .ok_or_else(|| "Invalid GIS geometry array".into())
}
fn sequence(v: &Value) -> Result<String, String> {
    array(v)?
        .iter()
        .map(coord)
        .collect::<Result<Vec<_>, _>>()
        .map(|v| v.join(","))
}
fn wkt(g: &Value, vertices: &mut usize) -> Result<Option<String>, String> {
    if g.is_null() {
        return Ok(None);
    }
    let kind = g["type"].as_str().ok_or("GIS geometry needs a type")?;
    let c = &g["coordinates"];
    fn dims(v: &Value, out: &mut [bool; 2]) {
        if let Some(a) = v.as_array() {
            if a.first().is_some_and(Value::is_number) {
                if a.len() == 2 {
                    out[0] = true;
                } else if a.len() == 3 {
                    out[1] = true;
                }
            } else {
                for c in a {
                    dims(c, out);
                }
            }
        }
    }
    let mut dimensions = [false, false];
    dims(c, &mut dimensions);
    if dimensions == [true, true] {
        fn xy(v: &mut Value) {
            if let Some(a) = v.as_array_mut() {
                if a.first().is_some_and(Value::is_number) {
                    a.truncate(2);
                } else {
                    for c in a {
                        xy(c);
                    }
                }
            }
        }
        let mut normalized = g.clone();
        xy(&mut normalized["coordinates"]);
        return wkt(&normalized, vertices);
    }
    fn count(v: &Value) -> usize {
        if let Some(a) = v.as_array() {
            if a.first().is_some_and(Value::is_number) {
                1
            } else {
                a.iter().map(count).sum()
            }
        } else {
            0
        }
    }
    *vertices = vertices
        .checked_add(count(c))
        .ok_or("Vertex count overflow")?;
    if *vertices > 2_000_000 {
        return Err("GIS geometry exceeds two million vertices; split the source".into());
    }
    let s = match kind {
        "Point" => format!("POINT({})", coord(c)?),
        "LineString" => format!("LINESTRING({})", sequence(c)?),
        "MultiPoint" => format!(
            "MULTIPOINT({})",
            array(c)?
                .iter()
                .map(|v| coord(v).map(|p| format!("({p})")))
                .collect::<Result<Vec<_>, _>>()?
                .join(",")
        ),
        "MultiLineString" | "Polygon" => format!(
            "{}({})",
            if kind == "Polygon" {
                "POLYGON"
            } else {
                "MULTILINESTRING"
            },
            array(c)?
                .iter()
                .map(|v| sequence(v).map(|p| format!("({p})")))
                .collect::<Result<Vec<_>, _>>()?
                .join(",")
        ),
        "MultiPolygon" => format!(
            "MULTIPOLYGON({})",
            array(c)?
                .iter()
                .map(|poly| Ok(format!(
                    "({})",
                    array(poly)?
                        .iter()
                        .map(|ring| sequence(ring).map(|p| format!("({p})")))
                        .collect::<Result<Vec<_>, String>>()?
                        .join(",")
                )))
                .collect::<Result<Vec<_>, String>>()?
                .join(",")
        ),
        "GeometryCollection" => format!(
            "GEOMETRYCOLLECTION({})",
            array(&g["geometries"])?
                .iter()
                .filter_map(|g| wkt(g, vertices).transpose())
                .collect::<Result<Vec<_>, _>>()?
                .join(",")
        ),
        _ => return Err(format!("Unsupported GIS geometry type: {kind}")),
    };
    Ok(Some(if dimensions[1] && kind != "GeometryCollection" {
        s.replacen('(', " Z(", 1)
    } else {
        s
    }))
}
fn validate_crs(v: &Value) -> Result<(), String> {
    if let Some(crs) = v.get("crs").filter(|v| !v.is_null()) {
        let name = crs["properties"]["name"]
            .as_str()
            .unwrap_or("")
            .to_ascii_uppercase();
        if ![
            "EPSG:4326",
            "URN:OGC:DEF:CRS:OGC:1.3:CRS84",
            "URN:OGC:DEF:CRS:EPSG::4326",
            "OGC:CRS84",
        ]
        .contains(&name.as_str())
        {
            return Err(
                "Only WGS84 GeoJSON/TopoJSON is supported; reproject the source CRS before import"
                    .into(),
            );
        }
    }
    Ok(())
}
fn geojson(v: &Value) -> Result<Vec<Feature>, String> {
    validate_crs(v)?;
    let features = if v["type"] == "FeatureCollection" {
        array(&v["features"])?.clone()
    } else {
        vec![v.clone()]
    };
    if features.len() > MAX_FEATURES {
        return Err("GIS feature limit is 250000".into());
    }
    let mut vertices = 0;
    features
        .into_iter()
        .enumerate()
        .map(|(i, f)| {
            let is_feature = f["type"] == "Feature";
            let mut p = properties(if is_feature {
                &f["properties"]
            } else {
                &Value::Null
            })?;
            if is_feature {
                fn dimensions(v:&Value,seen:&mut [bool;2]){if let Some(a)=v.as_array(){if a.first().is_some_and(Value::is_number){if a.len()==2{seen[0]=true}else if a.len()==3{seen[1]=true}}else{for v in a{dimensions(v,seen)}}}else if let Some(o)=v.as_object(){for v in o.values(){dimensions(v,seen)}}}
                let mut seen=[false,false];dimensions(&f["geometry"],&mut seen);
                if seen==[true,true]{p.insert("source_geometry_original".into(),f["geometry"].to_string());p.insert("conversion_note".into(),"Mixed position dimensions normalized to XY WKT; complete source geometry retained in source_geometry_original".into());}
            }
            let id = f
                .get("id")
                .map(text)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| (i + 1).to_string());
            let shape = wkt(if is_feature { &f["geometry"] } else { &f }, &mut vertices)?;
            Ok(feature(id, p, shape, None, None, None))
        })
        .collect()
}
fn topology(v: &Value) -> Result<Vec<Feature>, String> {
    validate_crs(v)?;
    let transform = v.get("transform");
    let point = |p: &Value| -> Result<Value, String> {
        let a = array(p)?;
        if a.len() < 2 {
            return Err("Invalid TopoJSON position".into());
        }
        let (mut x, mut y) = (number(&a[0])?, number(&a[1])?);
        if let Some(t) = transform {
            x = x * number(&t["scale"][0])? + number(&t["translate"][0])?;
            y = y * number(&t["scale"][1])? + number(&t["translate"][1])?;
        }
        if a.len() == 3 {
            Ok(json!([x, y, number(&a[2])?]))
        } else {
            Ok(json!([x, y]))
        }
    };
    let mut arcs = vec![];
    for arc in array(&v["arcs"])? {
        let mut out = vec![];
        let (mut x, mut y) = (0., 0.);
        for p in array(arc)? {
            if transform.is_some() {
                let a = array(p)?;
                if a.len() < 2 || a.len() > 3 {
                    return Err("Invalid TopoJSON arc point".into());
                }
                x += number(&a[0])?;
                y += number(&a[1])?;
                let position = if a.len() == 3 {
                    json!([x, y, number(&a[2])?])
                } else {
                    json!([x, y])
                };
                out.push(point(&position)?)
            } else {
                out.push(point(p)?);
            }
        }
        arcs.push(out);
    }
    fn stitch(indices: &Value, arcs: &[Vec<Value>]) -> Result<Value, String> {
        let mut out = vec![];
        for index in array(indices)? {
            let index = index.as_i64().ok_or("Invalid TopoJSON arc index")?;
            let reversed = index < 0;
            let n = if reversed { !index } else { index };
            let arc = arcs
                .get(usize::try_from(n).map_err(|_| "Invalid TopoJSON arc index")?)
                .ok_or("TopoJSON arc is out of range")?;
            let part: Vec<_> = if reversed {
                arc.iter().rev().cloned().collect()
            } else {
                arc.clone()
            };
            if !out.is_empty() && !part.is_empty() && out.last() != part.first() {
                return Err("Disconnected TopoJSON arcs".into());
            }
            let skip = usize::from(!out.is_empty());
            out.extend(part.into_iter().skip(skip));
            if out.len() > 2_000_000 {
                return Err("TopoJSON arc expansion exceeds vertex budget".into());
            }
        }
        Ok(Value::Array(out))
    }
    fn geometry(
        g: &Value,
        arcs: &[Vec<Value>],
        point: &impl Fn(&Value) -> Result<Value, String>,
        depth: usize,
    ) -> Result<Value, String> {
        if depth > 64 {
            return Err("TopoJSON nesting exceeds 64".into());
        }
        let kind = g["type"].as_str().ok_or("Missing TopoJSON geometry type")?;
        let coords = match kind {
            "Point" => point(&g["coordinates"])?,
            "MultiPoint" => Value::Array(
                array(&g["coordinates"])?
                    .iter()
                    .map(point)
                    .collect::<Result<_, _>>()?,
            ),
            "LineString" => stitch(&g["arcs"], arcs)?,
            "MultiLineString" | "Polygon" => Value::Array(
                array(&g["arcs"])?
                    .iter()
                    .map(|p| stitch(p, arcs))
                    .collect::<Result<_, _>>()?,
            ),
            "MultiPolygon" => Value::Array(
                array(&g["arcs"])?
                    .iter()
                    .map(|p| {
                        Ok(Value::Array(
                            array(p)?
                                .iter()
                                .map(|p| stitch(p, arcs))
                                .collect::<Result<_, String>>()?,
                        ))
                    })
                    .collect::<Result<_, String>>()?,
            ),
            "GeometryCollection" => {
                return Ok(
                    json!({"type":kind,"geometries":array(&g["geometries"])?.iter().map(|p|geometry(p,arcs,point,depth+1)).collect::<Result<Vec<_>,_>>()?}),
                )
            }
            _ => return Err("Unsupported TopoJSON geometry".into()),
        };
        Ok(json!({"type":kind,"coordinates":coords}))
    }
    let mut fs = vec![];
    for (name, obj) in v["objects"].as_object().ok_or("TopoJSON has no objects")? {
        let objects = if obj["type"] == "GeometryCollection" {
            array(&obj["geometries"])?.clone()
        } else {
            vec![obj.clone()]
        };
        for (mut index, g) in objects.into_iter().enumerate() {
            index += 1;
            let mut props = g["properties"].as_object().cloned().unwrap_or_default();
            props.entry("topology_object").or_insert(json!(name));
            fs.push(json!({"type":"Feature","id":g.get("id").cloned().unwrap_or(json!(format!("{name}/{index}"))),"properties":props,"geometry":geometry(&g,&arcs,&point,0)?}));
        }
    }
    geojson(&json!({"type":"FeatureCollection","features":fs}))
}
fn xml(bytes: &[u8]) -> Result<roxmltree::Document<'_>, String> {
    let s = std::str::from_utf8(bytes).map_err(|_| "GIS XML must be UTF-8")?;
    if s.contains("<!DOCTYPE") || s.contains("<!ENTITY") {
        return Err("DTD/entities are not allowed in GIS XML".into());
    }
    roxmltree::Document::parse(s).map_err(|e| format!("Invalid GIS XML: {e}"))
}
fn child_text(n: roxmltree::Node<'_, '_>, name: &str) -> Option<String> {
    n.children()
        .find(|n| n.is_element() && n.tag_name().name() == name)
        .and_then(|n| n.text())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}
fn kml_coords(n: roxmltree::Node<'_, '_>) -> Result<Value, String> {
    let s = child_text(n, "coordinates").ok_or("KML geometry has no coordinates")?;
    Ok(Value::Array(
        s.split_whitespace()
            .map(|s| {
                s.split(',')
                    .map(|n| {
                        n.parse::<f64>()
                            .map(|n| json!(n))
                            .map_err(|_| "Invalid KML coordinate".to_owned())
                    })
                    .collect::<Result<Vec<_>, _>>()
                    .map(Value::Array)
            })
            .collect::<Result<_, _>>()?,
    ))
}
fn kml_geometry(n: roxmltree::Node<'_, '_>, depth: usize) -> Result<Option<Value>, String> {
    if depth > 64 {
        return Err("KML nesting exceeds 64".into());
    }
    let c = match n.tag_name().name() {
        "Point" => {
            json!({"type":"Point","coordinates":array(&kml_coords(n)?)?.first().ok_or("Empty KML point")?})
        }
        "LineString" | "LinearRing" => json!({"type":"LineString","coordinates":kml_coords(n)?}),
        "Polygon" => {
            let mut rings = vec![];
            for boundary in ["outerBoundaryIs", "innerBoundaryIs"] {
                for b in n
                    .children()
                    .filter(|b| b.is_element() && b.tag_name().name() == boundary)
                {
                    let ring = b
                        .descendants()
                        .find(|r| r.is_element() && r.tag_name().name() == "LinearRing")
                        .ok_or("KML polygon boundary missing ring")?;
                    rings.push(kml_coords(ring)?);
                }
            }
            json!({"type":"Polygon","coordinates":rings})
        }
        "MultiGeometry" => {
            json!({"type":"GeometryCollection","geometries":n.children().filter(|c|c.is_element()).filter_map(|c|kml_geometry(c,depth+1).transpose()).collect::<Result<Vec<_>,_>>()?})
        }
        _ => return Ok(None),
    };
    Ok(Some(c))
}
fn kml(bytes: &[u8], warnings: &mut Vec<String>) -> Result<Vec<Feature>, String> {
    let doc = xml(bytes)?;
    if doc.root_element().tag_name().name() != "kml" {
        return Err("Expected KML root element".into());
    }
    let mut out = vec![];
    let mut vertices = 0;
    if doc
        .descendants()
        .any(|n| n.is_element() && n.tag_name().name() == "NetworkLink")
    {
        warnings.push("KML NetworkLinks are retained in the source but disabled during local display; import the linked file explicitly.".into())
    }
    for (i, n) in doc
        .descendants()
        .filter(|n| n.is_element() && n.tag_name().name() == "Placemark")
        .enumerate()
    {
        let mut p = BTreeMap::new();
        for name in ["name", "description", "address"] {
            if let Some(value) = child_text(n, name) {
                p.insert(name.to_owned(), value);
            }
        }
        for data in n
            .descendants()
            .filter(|n| n.is_element() && matches!(n.tag_name().name(), "Data" | "SimpleData"))
        {
            if let Some(key) = data.attribute("name") {
                let value = if data.tag_name().name() == "Data" {
                    child_text(data, "value")
                } else {
                    data.text().map(str::to_owned)
                };
                if let Some(v) = value {
                    p.insert(key.to_owned(), v);
                }
            }
        }
        let id = n
            .attribute("id")
            .map(str::to_owned)
            .unwrap_or_else(|| (i + 1).to_string());
        let mut when = None;
        let mut end = None;
        for a in n.ancestors().filter(|a| a.is_element()) {
            if let Some(t) = a
                .children()
                .find(|c| c.is_element() && matches!(c.tag_name().name(), "TimeStamp" | "TimeSpan"))
            {
                when = child_text(t, "when").or_else(|| child_text(t, "begin"));
                end = child_text(t, "end");
                break;
            }
        }
        let tracks: Vec<_> = n
            .descendants()
            .filter(|c| c.is_element() && c.tag_name().name() == "Track")
            .collect();
        if !tracks.is_empty() {
            for (segment, track) in tracks.iter().enumerate() {
                let times: Vec<_> = track
                    .children()
                    .filter(|n| n.is_element() && n.tag_name().name() == "when")
                    .map(|n| n.text().unwrap_or("").to_owned())
                    .collect();
                let coords: Vec<_> = track
                    .children()
                    .filter(|n| n.is_element() && n.tag_name().name() == "coord")
                    .map(|n| n.text().unwrap_or(""))
                    .collect();
                if times.len() != coords.len() {
                    return Err("KML gx:Track must pair every coordinate with a timestamp".into());
                }
                for (j, (time, coords)) in times.into_iter().zip(coords).enumerate() {
                    let coords = coords
                        .split_whitespace()
                        .map(|n| {
                            n.parse::<f64>()
                                .map(|n| json!(n))
                                .map_err(|_| "Invalid gx:Track coordinate".to_owned())
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    let shape = wkt(&json!({"type":"Point","coordinates":coords}), &mut vertices)?;
                    out.push(feature(
                        format!("{id}/{segment}/{j}"),
                        p.clone(),
                        shape,
                        Some(time),
                        None,
                        Some(p.get("name").cloned().unwrap_or_else(|| id.clone())),
                    ));
                }
            }
        } else {
            let geoms = n
                .children()
                .filter(|c| c.is_element())
                .filter_map(|c| kml_geometry(c, 0).transpose())
                .collect::<Result<Vec<_>, _>>()?;
            let g = if geoms.len() == 1 {
                geoms[0].clone()
            } else if geoms.is_empty() {
                Value::Null
            } else {
                json!({"type":"GeometryCollection","geometries":geoms})
            };
            out.push(feature(id, p, wkt(&g, &mut vertices)?, when, end, None));
        }
        if out.len() > MAX_FEATURES {
            return Err("KML exceeds 250000 extracted features".into());
        }
    }
    Ok(out)
}
fn gpx(bytes: &[u8]) -> Result<Vec<Feature>, String> {
    let doc = xml(bytes)?;
    if doc.root_element().tag_name().name() != "gpx" {
        return Err("Expected GPX root element".into());
    }
    let mut out = vec![];
    let mut vertices = 0;
    let mut native_groups = BTreeMap::new();
    let mut track = 0;
    let mut route = 0;
    for node in doc
        .descendants()
        .filter(|n| n.is_element() && matches!(n.tag_name().name(), "trk" | "rte"))
    {
        let (kind, count) = if node.tag_name().name() == "trk" {
            track += 1;
            ("trk", track)
        } else {
            route += 1;
            ("rte", route)
        };
        native_groups.insert(
            node.range().start,
            node.attribute("id")
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("_chronoscope_{kind}_{count}")),
        );
    }
    for (i, n) in doc
        .descendants()
        .filter(|n| n.is_element() && matches!(n.tag_name().name(), "wpt" | "trkpt" | "rtept"))
        .enumerate()
    {
        let x = n
            .attribute("lon")
            .ok_or("GPX point has no longitude")?
            .parse::<f64>()
            .map_err(|_| "Invalid GPX longitude")?;
        let y = n
            .attribute("lat")
            .ok_or("GPX point has no latitude")?
            .parse::<f64>()
            .map_err(|_| "Invalid GPX latitude")?;
        let mut p = BTreeMap::new();
        for c in n.children().filter(|c| c.is_element()) {
            if let Some(value) = c.text() {
                p.insert(c.tag_name().name().to_owned(), value.to_owned());
            }
        }
        let group = n
            .ancestors()
            .find(|a| a.is_element() && matches!(a.tag_name().name(), "trk" | "rte"));
        let entity = group
            .and_then(|g| child_text(g, "name"))
            .unwrap_or_else(|| {
                if n.tag_name().name() == "wpt" {
                    child_text(n, "name").unwrap_or_else(|| format!("Waypoint {}", i + 1))
                } else {
                    "GPX track".into()
                }
            });
        let native_id = group
            .and_then(|g| native_groups.get(&g.range().start))
            .cloned()
            .unwrap_or_else(|| {
                n.attribute("id")
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .unwrap_or_else(|| (i + 1).to_string())
            });
        p.insert("chronoscope_native_id".into(), native_id);
        if let Some(segment) = n
            .ancestors()
            .find(|a| a.is_element() && a.tag_name().name() == "trkseg")
        {
            p.insert("track_segment".into(), segment.range().start.to_string());
        }
        out.push(feature(
            (i + 1).to_string(),
            p,
            wkt(&json!({"type":"Point","coordinates":[x,y]}), &mut vertices)?,
            child_text(n, "time"),
            None,
            Some(entity),
        ));
        if out.len() > MAX_FEATURES {
            return Err("GPX exceeds 250000 points".into());
        }
    }
    Ok(out)
}
fn ecef(x: f64, y: f64, z: f64) -> Result<[f64; 3], String> {
    if ![x, y, z].iter().all(|v| v.is_finite()) {
        return Err("Invalid CZML Cartesian coordinate".into());
    }
    let a = 6378137.;
    let e2 = 6.6943799901413165e-3;
    let p = x.hypot(y);
    if p == 0. {
        if z == 0. {
            return Err("Earth centre has no geographic location".into());
        }
        return Ok([0., 90. * z.signum(), z.abs() - 6356752.314245179]);
    }
    let lon = y.atan2(x);
    let mut lat = z.atan2(p * (1. - e2));
    for _ in 0..16 {
        let n = a / (1. - e2 * lat.sin().powi(2)).sqrt();
        let next = (z + e2 * n * lat.sin()).atan2(p);
        if (next - lat).abs() < 1e-14 {
            lat = next;
            break;
        }
        lat = next;
    }
    let n = a / (1. - e2 * lat.sin().powi(2)).sqrt();
    let h = if lat.cos().abs() > 1e-8 {
        p / lat.cos() - n
    } else {
        z / lat.sin() - n * (1. - e2)
    };
    Ok([lon.to_degrees(), lat.to_degrees(), h])
}
fn options() -> crate::timestamps::Options<'static> {
    crate::timestamps::Options {
        order: Default::default(),
        encoding: Default::default(),
        custom: "",
        offset_minutes: 0,
        default_date: "",
    }
}
fn sample_time(v: &Value, epoch: Option<&str>) -> Result<String, String> {
    if let Some(s) = v.as_str() {
        return Ok(s.to_owned());
    }
    let delta = number(v)?;
    let epoch = epoch.ok_or("CZML numeric sample times require epoch")?;
    let t = chrono::DateTime::parse_from_rfc3339(epoch).map_err(|_| "Invalid CZML epoch")?;
    if !delta.is_finite() || delta.abs() > i64::MAX as f64 {
        return Err("CZML time offset out of range".into());
    }
    // Split whole seconds from fractions: an i64 total-nanosecond offset would
    // unnecessarily reduce the supported span to roughly 292 years.
    let duration = chrono::Duration::try_seconds(delta.trunc() as i64)
        .and_then(|whole| {
            whole.checked_add(&chrono::Duration::nanoseconds(
                (delta.fract() * 1_000_000_000.).round() as i64,
            ))
        })
        .ok_or("CZML time offset out of range")?;
    let out = t
        .checked_add_signed(duration)
        .ok_or("CZML sample time out of range")?;
    Ok(out.to_rfc3339())
}
fn czml(v: &Value, warnings: &mut Vec<String>) -> Result<Vec<Feature>, String> {
    let packets = array(v)?;
    if packets
        .first()
        .is_none_or(|p| p["id"] != "document" || p["version"] != "1.0")
    {
        return Err("CZML requires a document packet with version 1.0".into());
    }
    let mut out = vec![];
    let mut vertices = 0;
    for (i, p) in packets.iter().enumerate().skip(1) {
        if p["delete"] == true {
            continue;
        }
        let id = p["id"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| i.to_string());
        let mut props = properties(&p["properties"])?;
        for key in ["name", "description", "availability"] {
            if let Some(v) = p.get(key) {
                props.insert(key.into(), text(v));
            }
        }
        let availability = p["availability"].as_str().and_then(|s| s.split_once('/'));
        let default_time = availability.map(|(a, _)| a.to_owned());
        let default_end = availability.map(|(_, b)| b.to_owned());
        let entity = p["name"].as_str().unwrap_or(&id).to_owned();
        let positions = if p["position"].is_array() {
            array(&p["position"])?.clone()
        } else {
            vec![p["position"].clone()]
        };
        let before = out.len();
        for (pos_index, pos) in positions.iter().enumerate() {
            if pos["referenceFrame"] == "INERTIAL" {
                if warnings.len() < 60 {
                    warnings.push(format!("{id}: inertial positions render natively; Events conversion requires fixed WGS84 positions."))
                }
                continue;
            }
            let values = ["cartographicDegrees", "cartographicRadians", "cartesian"]
                .iter()
                .find_map(|key| pos.get(key).map(|value| (*key, value)));
            if let Some((kind, values)) = values {
                let a = array(values)?;
                let sampled = a.len() != 3;
                let stride = if sampled { 4 } else { 3 };
                if a.len() % stride != 0 {
                    return Err("Invalid CZML position sample length".into());
                }
                for (sample_index, s) in a.chunks(stride).enumerate() {
                    let offset = usize::from(sampled);
                    let [x, y, z] = [
                        number(&s[offset])?,
                        number(&s[offset + 1])?,
                        number(&s[offset + 2])?,
                    ];
                    let coords = match kind {
                        "cartographicDegrees" => [x, y, z],
                        "cartographicRadians" => [x.to_degrees(), y.to_degrees(), z],
                        _ => ecef(x, y, z)?,
                    };
                    let time = if sampled {
                        Some(sample_time(&s[0], pos["epoch"].as_str())?)
                    } else {
                        pos["interval"]
                            .as_str()
                            .and_then(|s| s.split_once('/'))
                            .map(|(a, _)| a.to_owned())
                            .or_else(|| default_time.clone())
                    };
                    let mut attrs = props.clone();
                    attrs.insert("czml_id".into(), id.clone());
                    out.push(feature(
                        if sampled || positions.len() > 1 {
                            format!("{id}/{pos_index}/{sample_index}")
                        } else {
                            id.clone()
                        },
                        attrs,
                        wkt(&json!({"type":"Point","coordinates":coords}), &mut vertices)?,
                        time,
                        if sampled { None } else { default_end.clone() },
                        Some(entity.clone()),
                    ));
                }
            }
        }
        if before == out.len() {
            let geom = p
                .get("polyline")
                .and_then(|v| v.get("positions"))
                .map(|v| (false, v))
                .or_else(|| {
                    p.get("polygon")
                        .and_then(|v| v.get("positions"))
                        .map(|v| (true, v))
                });
            let shape = if let Some((polygon, positions)) = geom {
                if let Some(values) = positions["cartographicDegrees"].as_array() {
                    if values.len() % 3 != 0 {
                        return Err("Invalid CZML geometry coordinates".into());
                    }
                    let mut coords = values
                        .chunks(3)
                        .map(|v| Value::Array(v.to_vec()))
                        .collect::<Vec<_>>();
                    if polygon && !coords.is_empty() && coords.first() != coords.last() {
                        coords.push(coords[0].clone());
                    }
                    wkt(
                        &if polygon {
                            json!({"type":"Polygon","coordinates":[coords]})
                        } else {
                            json!({"type":"LineString","coordinates":coords})
                        },
                        &mut vertices,
                    )?
                } else {
                    None
                }
            } else {
                None
            };
            out.push(feature(
                id,
                props,
                shape,
                default_time,
                default_end,
                Some(entity),
            ));
        }
        if out.len() > MAX_FEATURES {
            return Err("CZML exceeds 250000 extracted samples".into());
        }
    }
    Ok(out)
}
pub(super) fn parse(
    format: &Format,
    bytes: &[u8],
    warnings: &mut Vec<String>,
) -> Result<Vec<Feature>, String> {
    let out = match format {
        Format::Geojson => {
            geojson(&serde_json::from_slice(bytes).map_err(|e| format!("Invalid GeoJSON: {e}"))?)?
        }
        Format::Topojson => {
            topology(&serde_json::from_slice(bytes).map_err(|e| format!("Invalid TopoJSON: {e}"))?)?
        }
        Format::Kml | Format::Kmz => kml(bytes, warnings)?,
        Format::Gpx => gpx(bytes)?,
        Format::Czml => czml(
            &serde_json::from_slice(bytes).map_err(|e| format!("Invalid CZML: {e}"))?,
            warnings,
        )?,
        Format::Tiles3d | Format::Gltf => {
            let v: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
            if v["asset"].is_null() || *format == Format::Tiles3d && v["root"].is_null() {
                return Err("Invalid tileset/glTF document".into());
            }
            vec![]
        }
        Format::Glb => {
            if bytes.len() < 20
                || &bytes[..4] != b"glTF"
                || u32::from_le_bytes(bytes[4..8].try_into().unwrap()) != 2
                || u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize != bytes.len()
            {
                return Err("Invalid glTF 2 GLB header/length".into());
            }
            vec![]
        }
    };
    let mut ids = std::collections::BTreeSet::new();
    let mut out = out;
    for (i, f) in out.iter_mut().enumerate() {
        if !ids.insert(f.id.clone()) {
            f.id = format!("{}/row/{}", f.id, i + 1);
            if !ids.insert(f.id.clone()) {
                return Err("Duplicate GIS feature identifiers".into());
            }
        }
        if f.id.len() > 8192
            || f.properties.len() > 500
            || f.properties
                .iter()
                .map(|(k, v)| k.len() + v.len())
                .sum::<usize>()
                > 1024 * 1024
        {
            return Err("GIS feature attributes exceed budget".into());
        }
    }
    Ok(out)
}
pub(super) fn bounds(features: &[Feature]) -> (Option<[f64; 4]>, Option<[f64; 2]>) {
    let mut bounds: Option<[f64; 4]> = None;
    let mut times: Option<[f64; 2]> = None;
    for f in features {
        if let Some(wkt) = &f.geometry_wkt {
            if let Ok(shape) = crate::geometry::parse(wkt) {
                if let Some(b) = shape.bounds {
                    bounds = Some(bounds.map_or(b, |a| {
                        [
                            a[0].min(b[0]),
                            a[1].min(b[1]),
                            a[2].max(b[2]),
                            a[3].max(b[3]),
                        ]
                    }));
                }
            }
        }
        for t_source in [f.time.as_deref(), f.end.as_deref()].into_iter().flatten() {
            if let Ok(t) = crate::timestamps::parse(t_source, &options()) {
                let stop = t;
                times = Some(times.map_or([t, stop], |[a, b]| [a.min(t), b.max(stop)]));
            }
        }
    }
    (bounds, times)
}
pub fn raw_import(path: &Path) -> Result<RawImport, String> {
    // Use the same bounded reader/package validation for CLI and desktop conversions.
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let layer = assets::load(path, dir.path(), None, 1.)?;
    if layer.format.is_3d() {
        return Err("Models and 3D Tiles are reference layers, not timestamped Events".into());
    }
    raw_from_layer(&layer)
}
pub fn raw_from_layer(layer: &Layer) -> Result<RawImport, String> {
    if layer.format.is_3d() {
        return Err("3D assets do not contain tabular Events".into());
    }
    let features = assets::features(layer)?;
    let mut keys = std::collections::BTreeSet::new();
    for f in &features {
        keys.extend(f.properties.keys().cloned());
    }
    if keys.len() > 500 {
        return Err("GIS source exceeds 500 attribute columns".into());
    }
    let keys: Vec<_> = keys.into_iter().collect();
    let mut headers = vec![
        "entity".into(),
        "timestamp".into(),
        "end_timestamp".into(),
        "geometry_wkt".into(),
        "source_feature_id".into(),
    ];
    headers.extend(keys.iter().map(|k| format!("source:{k}")));
    let rows = features
        .into_iter()
        .map(|f| {
            let mut row = vec![
                f.entity,
                f.time.unwrap_or_default(),
                f.end.unwrap_or_default(),
                f.geometry_wkt.unwrap_or_default(),
                f.id,
            ];
            row.extend(
                keys.iter()
                    .map(|k| f.properties.get(k).cloned().unwrap_or_default()),
            );
            row
        })
        .collect::<Vec<_>>();
    let count = rows.len();
    Ok(RawImport {
        source: layer.name.clone(),
        tables: vec![RawTable {
            sheet: layer.source_format.as_ref().map(|f| format!("{f:?}"))
                .unwrap_or_else(|| format!("{:?}", layer.format)),
            headers,
            rows,
            row_numbers: (1..=count).collect(),
        }],
        delimiter: None,
    })
}

/// Preserve exact and generated feature identities across Rust and JavaScript.
/// Original bytes remain packaged alongside this render-only derivative.
pub(super) fn render_json(
    format: &Format,
    bytes: &[u8],
    features: &[Feature],
) -> Result<Option<Vec<u8>>, String> {
    if !matches!(format, Format::Geojson | Format::Topojson) {
        return Ok(None);
    }
    let mut document: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if *format == Format::Geojson {
        if document["type"] == "FeatureCollection" {
            for (value, feature) in document["features"]
                .as_array_mut()
                .ok_or("Invalid GeoJSON features")?
                .iter_mut()
                .zip(features)
            {
                value["id"] = json!(feature.id);
            }
        } else if document["type"] == "Feature" {
            document["id"] = json!(features[0].id);
        } else {
            document =
                json!({"type":"Feature","id":features[0].id,"properties":{},"geometry":document});
        }
    } else {
        let mut index = 0;
        for object in document["objects"]
            .as_object_mut()
            .ok_or("Invalid TopoJSON objects")?
            .values_mut()
        {
            if object["type"] == "GeometryCollection" {
                for geometry in object["geometries"]
                    .as_array_mut()
                    .ok_or("Invalid TopoJSON geometries")?
                {
                    geometry["id"] =
                        json!(features.get(index).ok_or("TopoJSON identity mismatch")?.id);
                    index += 1;
                }
            } else {
                object["id"] = json!(features.get(index).ok_or("TopoJSON identity mismatch")?.id);
                index += 1;
            }
        }
    }
    let result = serde_json::to_vec(&document).map_err(|e| e.to_string())?;
    if result.len() as u64 > MAX_SOURCE {
        return Err("Normalized GIS document exceeds 64 MiB".into());
    }
    Ok(Some(result))
}
