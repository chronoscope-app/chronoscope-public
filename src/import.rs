use crate::model::*;
use calamine::{open_workbook_auto, Data, Reader};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    path::Path,
};

mod feedback;
pub use feedback::field_feedback;

const MAX_EXPANDED: u64 = 256 * 1024 * 1024;
const MAX_COLUMNS: usize = 512;
const MAX_CELLS: usize = 4_000_000;
#[derive(Clone, Debug)]
pub struct RawTable {
    pub sheet: String,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub row_numbers: Vec<usize>,
}
#[derive(Clone, Debug)]
pub struct RawImport {
    pub source: String,
    pub tables: Vec<RawTable>,
    pub delimiter: Option<u8>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Mapping {
    pub geometry_wkt: Option<usize>,
    #[serde(default)]
    pub coordinate_system: crate::coordinates::CoordinateSystem,
    #[serde(default)]
    pub easting: Option<usize>,
    #[serde(default)]
    pub northing: Option<usize>,
    #[serde(default)]
    pub zone: Option<usize>,
    #[serde(default)]
    pub hemisphere: Option<usize>,
    #[serde(default)]
    pub mgrs: Option<usize>,
    #[serde(default = "default_zone")]
    pub default_zone: i32,
    #[serde(default = "default_hemisphere")]
    pub default_hemisphere: String,
    pub entity: Option<usize>,
    pub time: Option<usize>,
    pub end: Option<usize>,
    pub lat: Option<usize>,
    pub lon: Option<usize>,
    pub altitude: Option<usize>,
    #[serde(default)]
    pub altitude_reference_column: Option<usize>,
    pub altitude_unit: crate::altitude::AltitudeUnit,
    pub altitude_reference: crate::altitude::AltitudeReference,
    pub category: Option<usize>,
    pub label: Option<usize>,
    pub value: Option<usize>,
    pub related_to: Option<usize>,
    pub custom_format: String,
    pub offset_minutes: i32,
    pub default_entity: String,
    pub clock: Option<usize>,
    pub coordinate_column: Option<usize>,
    pub date_order: crate::timestamps::DateOrder,
    pub time_encoding: crate::timestamps::TimeEncoding,
    pub default_date: String,
    pub decimal_comma: bool,
}
impl Default for Mapping {
    fn default() -> Self {
        Self {
            geometry_wkt: None,
            coordinate_system: Default::default(),
            easting: None,
            northing: None,
            zone: None,
            hemisphere: None,
            mgrs: None,
            default_zone: 0,
            default_hemisphere: String::new(),
            entity: None,
            time: None,
            end: None,
            lat: None,
            lon: None,
            altitude: None,
            altitude_reference_column: None,
            altitude_unit: Default::default(),
            altitude_reference: Default::default(),
            category: None,
            label: None,
            value: None,
            related_to: None,
            custom_format: String::new(),
            offset_minutes: 0,
            default_entity: "Events".into(),
            clock: None,
            coordinate_column: None,
            date_order: Default::default(),
            time_encoding: Default::default(),
            default_date: String::new(),
            decimal_comma: false,
        }
    }
}
fn default_zone() -> i32 {
    0
}
fn default_hemisphere() -> String {
    String::new()
}
impl Mapping {
    pub fn guess(headers: &[String]) -> Self {
        let find = |names: &[&str]| {
            headers.iter().position(|h| {
                names.contains(
                    &h.trim()
                        .to_lowercase()
                        .replace([' ', '_', '-'], "")
                        .as_str(),
                )
            })
        };
        let normalize = |h: &str| {
            h.chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect::<String>()
        };
        let altitude = headers
            .iter()
            .position(|h| {
                let h = normalize(h);
                (h.contains("ellipsoid") || h.contains("wgs84"))
                    && (h.contains("altitude") || h.contains("height"))
                    || h == "geoaltitude"
                    || h == "geometricaltitude"
            })
            .or_else(|| {
                headers.iter().position(|h| {
                    matches!(
                        normalize(h).as_str(),
                        "alt"
                            | "altm"
                            | "altitude"
                            | "altitudem"
                            | "altitudemeters"
                            | "altitudekm"
                            | "altitudeft"
                            | "altitudefeet"
                            | "height"
                            | "heightm"
                            | "heightegm96m"
                            | "heightreportedm"
                            | "heightkm"
                            | "heightft"
                            | "elevation"
                            | "elevationm"
                            | "altitudeegm96m"
                            | "altitudereportedkm"
                            | "altitudereportedm"
                            | "baroaltitude"
                    )
                })
            });
        let altitude_name = altitude.map(|i| normalize(&headers[i])).unwrap_or_default();
        Self {
            altitude,
            altitude_reference_column: headers
                .iter()
                .position(|h| normalize(h) == "altitudereference"),
            altitude_unit: if altitude_name.ends_with("ft") || altitude_name.ends_with("feet") {
                crate::altitude::AltitudeUnit::Feet
            } else if altitude_name.ends_with("km") {
                crate::altitude::AltitudeUnit::Kilometers
            } else {
                crate::altitude::AltitudeUnit::Meters
            },
            altitude_reference: if altitude_name.contains("ellipsoid")
                || altitude_name.contains("wgs84")
                || altitude_name == "geoaltitude"
                || altitude_name == "geometricaltitude"
            {
                crate::altitude::AltitudeReference::Ellipsoid
            } else if altitude_name.contains("egm96") {
                crate::altitude::AltitudeReference::Egm96
            } else if altitude_name.contains("reported") {
                crate::altitude::AltitudeReference::Reported
            } else {
                crate::altitude::AltitudeReference::Unspecified
            },
            geometry_wkt: find(&["wkt", "geometry", "geom", "geometrywkt", "wellknowntext"]),
            entity: find(&[
                "entity", "entityid", "target", "name", "track", "trackid", "device", "person",
                "subject",
            ]),
            time: find(&[
                "time",
                "timestamp",
                "datetime",
                "date",
                "start",
                "starttime",
            ]),
            end: find(&["end", "endtime", "endtimestamp"]),
            lat: find(&["latitude", "lat"]),
            lon: find(&["longitude", "lon", "lng", "long"]),
            category: find(&["category", "type", "eventtype", "kind"]),
            label: find(&["label", "description", "event", "title", "place"]),
            value: find(&["value", "amount", "magnitude", "mag"]),
            related_to: find(&[
                "relatedto",
                "destination",
                "recipient",
                "contact",
                "targetentity",
            ]),
            default_entity: "Events".into(),
            easting: find(&["easting", "utmeasting"]),
            northing: find(&["northing", "utmnorthing"]),
            zone: find(&["zone", "utmzone"]),
            hemisphere: find(&["hemisphere", "northsouth"]),
            mgrs: find(&["mgrs", "gridreference", "mgrscoordinate"]),
            coordinate_system: if find(&["mgrs", "gridreference", "mgrscoordinate"]).is_some() {
                crate::coordinates::CoordinateSystem::Mgrs
            } else if find(&["easting", "utmeasting"]).is_some() {
                crate::coordinates::CoordinateSystem::Utm
            } else {
                crate::coordinates::CoordinateSystem::Dd
            },
            default_zone: 0,
            default_hemisphere: String::new(),
            ..Default::default()
        }
    }
}
pub(crate) fn unique_headers(raw: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    raw.into_iter()
        .enumerate()
        .map(|(i, h)| {
            let base = if h.trim().is_empty() {
                format!("Column {}", i + 1)
            } else {
                h.trim().trim_start_matches('\u{feff}').to_owned()
            };
            let mut name = base.clone();
            let mut n = 2;
            while !seen.insert(name.clone()) {
                name = format!("{base} ({n})");
                n += 1;
            }
            name
        })
        .collect()
}
pub fn read_file(path: &Path, delimiter: u8) -> Result<RawImport, String> {
    if path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
        [
            "geojson", "topojson", "json", "kml", "kmz", "czml", "gpx", "shp", "gpkg",
        ]
        .iter()
        .any(|x| e.eq_ignore_ascii_case(x))
    }) {
        return crate::gis::raw_import(path);
    }

    let size = path.metadata().map_err(|e| e.to_string())?.len();
    if size > MAX_FILE_BYTES {
        return Err("Import exceeds the 64 MiB file limit".into());
    }
    let source = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let delimiter = if delimiter == 0 && ["csv", "tsv"].contains(&ext.as_str()) {
        detect_delimiter(path)?
    } else if delimiter == 0 {
        b','
    } else {
        delimiter
    };
    let mut tables = Vec::new();
    if ext == "csv" || ext == "tsv" {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(delimiter)
            .flexible(false)
            .from_path(path)
            .map_err(|e| e.to_string())?;
        let headers = unique_headers(
            reader
                .headers()
                .map_err(|e| e.to_string())?
                .iter()
                .map(str::to_owned)
                .collect(),
        );
        if headers.is_empty() || headers.len() > MAX_COLUMNS {
            return Err("CSV requires 1–512 header columns".into());
        }
        let mut rows = Vec::new();
        let mut row_numbers = Vec::new();
        for row in reader.records() {
            if rows.len() >= MAX_EVENTS {
                return Err(format!("Import exceeds {MAX_EVENTS} rows"));
            }
            if (rows.len() + 1).saturating_mul(headers.len()) > MAX_CELLS {
                return Err("Import exceeds 4 million cells".into());
            }
            let row = row.map_err(|e| format!("Malformed CSV: {e}"))?;
            row_numbers.push(rows.len() + 2);
            rows.push(row.iter().map(str::to_owned).collect());
        }
        tables.push(RawTable {
            sheet: "CSV".into(),
            headers,
            rows,
            row_numbers,
        });
    } else if ["xlsx", "xls", "xlsb"].contains(&ext.as_str()) {
        if ext == "xlsx" || ext == "xlsb" {
            let mut zip = zip::ZipArchive::new(File::open(path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            let mut expanded = 0u64;
            for i in 0..zip.len() {
                let mut member = zip.by_index(i).map_err(|e| e.to_string())?;
                if member.size() > MAX_EXPANDED.saturating_sub(expanded) {
                    return Err("Workbook expanded size exceeds 256 MiB".into());
                }
                // Count actual output too, rather than trusting ZIP size declarations.
                let bytes = std::io::copy(
                    &mut std::io::Read::take(&mut member, MAX_EXPANDED - expanded + 1),
                    &mut std::io::sink(),
                )
                .map_err(|e| e.to_string())?;
                expanded = expanded.saturating_add(bytes);
                if expanded > MAX_EXPANDED {
                    return Err("Workbook expanded size exceeds 256 MiB".into());
                }
            }
        }
        let mut workbook =
            open_workbook_auto(path).map_err(|e| format!("Cannot read workbook: {e}"))?;
        let names = workbook.sheet_names().to_vec();
        let mut total = 0;
        let mut cells = 0usize;
        for sheet in names {
            let range = workbook
                .worksheet_range(&sheet)
                .map_err(|e| e.to_string())?;
            if range.is_empty() {
                continue;
            }
            if range.width() > MAX_COLUMNS || range.height() > MAX_EVENTS + 1 {
                return Err("Worksheet exceeds row or column limits".into());
            }
            cells = cells.saturating_add(range.width().saturating_mul(range.height()));
            if cells > MAX_CELLS {
                return Err("Workbook exceeds 4 million cells".into());
            }
            let start_row = range.start().map(|p| p.0 as usize).unwrap_or(0);
            let mut iter = range.rows();
            let headers = unique_headers(iter.next().unwrap().iter().map(cell_string).collect());
            let mut rows = Vec::new();
            let mut row_numbers = Vec::new();
            for (index, row) in iter.enumerate() {
                if row.iter().all(|c| matches!(c, Data::Empty)) {
                    continue;
                }
                total += 1;
                if total > MAX_EVENTS {
                    return Err(format!("Workbook exceeds {MAX_EVENTS} rows"));
                }
                row_numbers.push(start_row + index + 2);
                rows.push(row.iter().map(cell_string).collect());
            }
            tables.push(RawTable {
                sheet,
                headers,
                rows,
                row_numbers,
            });
        }
    } else {
        return Err("Choose a CSV, TSV, XLSX, XLS or XLSB file".into());
    }
    if tables.is_empty() {
        return Err("No nonempty worksheets found".into());
    }
    Ok(RawImport {
        source,
        tables,
        delimiter: (["csv", "tsv"].contains(&ext.as_str())).then_some(delimiter),
    })
}
fn cell_string(cell: &Data) -> String {
    if let Data::DateTime(dt) = cell {
        if let Some(rounded) = dt.as_datetime() {
            use chrono::Timelike;
            let fraction = dt.as_f64().rem_euclid(1.);
            let nanos = (fraction * 86_400_000_000_000.).round() as u64;
            let mut day = rounded.date();
            if rounded.num_seconds_from_midnight() == 0 && fraction > 0.5 {
                day = day.pred_opt().unwrap_or(day);
            }
            let t = day.and_hms_opt(0, 0, 0).unwrap() + chrono::Duration::nanoseconds(nanos as i64);
            if (0. ..1.).contains(&dt.as_f64()) {
                return t.format("%H:%M:%S%.f").to_string();
            }
            return t.format("%Y-%m-%d %H:%M:%S%.f").to_string();
        }
    }
    match cell {
        Data::Empty => String::new(),
        _ => cell.to_string(),
    }
}
#[derive(Debug)]
pub struct ImportReport {
    pub events: Vec<Event>,
    pub rejected: Vec<(usize, String)>,
    pub rejected_count: usize,
}
pub fn convert(
    table: &RawTable,
    mapping: &Mapping,
    source: &str,
    first_id: u64,
) -> Result<ImportReport, String> {
    convert_reporting(table, mapping, source, first_id, &mut |_, _, _| Ok(()))
}
pub type RejectedRow<'a> = dyn FnMut(usize, &[String], &str) -> Result<(), String> + 'a;
/// Report every rejection while retaining only a bounded set of UI examples.
pub fn convert_reporting(
    table: &RawTable,
    mapping: &Mapping,
    source: &str,
    first_id: u64,
    rejected_row: &mut RejectedRow<'_>,
) -> Result<ImportReport, String> {
    let time_col = mapping.time.ok_or("Map a timestamp column")?;
    first_id
        .checked_add(table.rows.len().saturating_sub(1) as u64)
        .ok_or("Event ID capacity exhausted")?;
    if table.rows.len() > MAX_EVENTS {
        return Err("Too many rows".into());
    }
    for c in [
        Some(time_col),
        mapping.entity,
        mapping.end,
        mapping.lat,
        mapping.lon,
        mapping.altitude,
        mapping.altitude_reference_column,
        mapping.category,
        mapping.label,
        mapping.value,
        mapping.related_to,
        mapping.easting,
        mapping.northing,
        mapping.zone,
        mapping.hemisphere,
        mapping.mgrs,
        mapping.clock,
        mapping.coordinate_column,
        mapping.geometry_wkt,
    ]
    .into_iter()
    .flatten()
    {
        if c >= table.headers.len() {
            return Err("Mapped column is out of range".into());
        }
    }
    if mapping.coordinate_system == crate::coordinates::CoordinateSystem::Dd
        && mapping.coordinate_column.is_none()
        && mapping.lat.is_some() != mapping.lon.is_some()
    {
        return Err("Map both coordinate columns or neither".into());
    }
    if mapping.coordinate_system == crate::coordinates::CoordinateSystem::Utm
        && mapping.coordinate_column.is_none()
        && (mapping.easting.is_none() || mapping.northing.is_none())
    {
        return Err("Map UTM easting and northing columns".into());
    }
    if mapping.coordinate_system == crate::coordinates::CoordinateSystem::Mgrs
        && mapping.mgrs.is_none()
    {
        return Err("Map an MGRS reference column".into());
    }
    let mut events = Vec::new();
    let mut rejected = Vec::new();
    let mut rejected_count = 0;
    for (index, row) in table.rows.iter().enumerate() {
        let get = |c: Option<usize>| c.and_then(|i| row.get(i)).map(|s| s.trim()).unwrap_or("");
        let attempt = || -> Result<Event, String> {
            let options = crate::timestamps::Options {
                custom: &mapping.custom_format,
                offset_minutes: mapping.offset_minutes,
                order: mapping.date_order,
                encoding: mapping.time_encoding,
                default_date: &mapping.default_date,
            };
            let interval = if mapping.clock.is_none() {
                crate::timestamps::parse_interval(get(Some(time_col)), &options)?
            } else {
                None
            };
            let time = if let Some((start, _)) = interval {
                start
            } else {
                crate::timestamps::parse_fields(
                    get(Some(time_col)),
                    mapping.clock.map(|c| get(Some(c))),
                    &options,
                )?
            };
            let end = if get(mapping.end).is_empty() {
                interval.map(|(_, end)| end)
            } else {
                Some(crate::timestamps::parse(get(mapping.end), &options)?)
            };
            let number = |c| -> Result<Option<f64>, String> {
                let s = get(c);
                if s.is_empty() {
                    Ok(None)
                } else {
                    parse_number(s, mapping.decimal_comma)
                        .map(Some)
                        .map_err(|_| format!("Invalid number: {s}"))
                }
            };
            let entity = if mapping.entity.is_none() {
                mapping.default_entity.trim()
            } else {
                get(mapping.entity)
            };
            let mut mgrs_precision = None;
            let geometry_wkt = if get(mapping.geometry_wkt).is_empty() {
                None
            } else {
                Some(get(mapping.geometry_wkt).to_owned())
            };
            let (lat, lon) = if let Some(text) = geometry_wkt.as_ref() {
                let shape = crate::geometry::parse(text)?;
                if shape.kind == "Point" && shape.points.len() == 1 {
                    let [lon, lat] = shape.points[0];
                    (Some(lat), Some(lon))
                } else {
                    (None, None)
                }
            } else {
                match mapping.coordinate_system {
                    crate::coordinates::CoordinateSystem::Dd => {
                        if let Some(c) = mapping.coordinate_column {
                            let text = get(Some(c));
                            if text.is_empty() {
                                (None, None)
                            } else {
                                let p = parse_dd_pair(text, mapping.decimal_comma)?;
                                (Some(p.0), Some(p.1))
                            }
                        } else {
                            (
                                parse_dd(get(mapping.lat), true, mapping.decimal_comma)?,
                                parse_dd(get(mapping.lon), false, mapping.decimal_comma)?,
                            )
                        }
                    }
                    crate::coordinates::CoordinateSystem::Utm => {
                        if let Some(c) = mapping.coordinate_column {
                            let text = get(Some(c));
                            if text.is_empty() {
                                (None, None)
                            } else {
                                let p = crate::coordinates::convert(parse_utm_pair(text)?)?;
                                (Some(p.latitude), Some(p.longitude))
                            }
                        } else if get(mapping.easting).is_empty()
                            && get(mapping.northing).is_empty()
                        {
                            (None, None)
                        } else {
                            let zone = if get(mapping.zone).is_empty() {
                                mapping.default_zone
                            } else {
                                get(mapping.zone).parse::<i32>().map_err(|_| {
                                    "UTM zone must be an integer; use a separate hemisphere field"
                                })?
                            };
                            if zone == 0 {
                                return Err(
                                    "UTM needs a zone column or an explicit default zone (1–60)"
                                        .into(),
                                );
                            }
                            let hemisphere = if get(mapping.hemisphere).is_empty() {
                                mapping.default_hemisphere.clone()
                            } else {
                                get(mapping.hemisphere).into()
                            };
                            let p =
                                crate::coordinates::convert(crate::coordinates::Coordinate::Utm {
                                    zone,
                                    hemisphere,
                                    easting: number(mapping.easting)?.ok_or("Missing easting")?,
                                    northing: number(mapping.northing)?
                                        .ok_or("Missing northing")?,
                                })?;
                            (Some(p.latitude), Some(p.longitude))
                        }
                    }
                    crate::coordinates::CoordinateSystem::Mgrs => {
                        if get(mapping.mgrs).is_empty() {
                            (None, None)
                        } else {
                            let p = crate::coordinates::convert(
                                crate::coordinates::Coordinate::Mgrs {
                                    reference: get(mapping.mgrs).into(),
                                },
                            )?;
                            mgrs_precision = Some(p.mgrs_precision);
                            (Some(p.latitude), Some(p.longitude))
                        }
                    }
                }
            };
            let mut event = Event {
                altitude: None,
                location_kind: None,
                geometry_wkt,
                mgrs_precision,
                id: first_id + index as u64,
                entity: entity.to_owned(),
                time,
                end,
                lat,
                lon,
                category: get(mapping.category).to_owned(),
                label: get(mapping.label).to_owned(),
                value: number(mapping.value)?,
                related_to: get(mapping.related_to).to_owned(),
                attrs: table
                    .headers
                    .iter()
                    .cloned()
                    .zip(row.iter().cloned())
                    .collect::<BTreeMap<_, _>>(),
                tags: BTreeSet::new(),
                note: String::new(),
                source: format!("{source} / {}", table.sheet),
                source_row: table.row_numbers.get(index).copied().unwrap_or(index + 2),
            };
            if let Some(value) = number(mapping.altitude)? {
                let reference = if let Some(column) = mapping.altitude_reference_column {
                    let raw = row.get(column).map(String::as_str).unwrap_or("").trim();
                    if raw.is_empty() {
                        mapping.altitude_reference
                    } else {
                        serde_json::from_value(serde_json::Value::String(raw.into()))
                            .map_err(|_| "Invalid altitude reference; use ellipsoid, egm96, reported or unspecified")?
                    }
                } else {
                    mapping.altitude_reference
                };
                event.altitude = Some(crate::altitude::Altitude {
                    meters: mapping.altitude_unit.meters(value),
                    reference,
                });
            }
            event.derive_polygon_centroid()?;
            event.validate()?;
            Ok(event)
        };
        match attempt() {
            Ok(e) => events.push(e),
            Err(reason) => {
                rejected_count += 1;
                rejected_row(
                    table.row_numbers.get(index).copied().unwrap_or(index + 2),
                    row,
                    &reason,
                )?;
                if rejected.len() < 100 {
                    rejected.push((
                        table.row_numbers.get(index).copied().unwrap_or(index + 2),
                        reason,
                    ));
                }
            }
        }
    }
    Ok(ImportReport {
        events,
        rejected,
        rejected_count,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn import_rejects_bad_coordinates_and_preserves_unlocated() {
        let t = RawTable {
            sheet: "data".into(),
            row_numbers: vec![2, 3, 4],
            headers: vec!["entity", "time", "lat", "lon"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            rows: vec![
                vec!["A", "2025-01-01", "91", "0"],
                vec!["B", "2025-01-01", "", ""],
                vec!["C", "2025-01-01", "NaN", "0"],
            ]
            .into_iter()
            .map(|r| r.into_iter().map(str::to_owned).collect())
            .collect(),
        };
        let r = convert(&t, &Mapping::guess(&t.headers), "test.csv", 1).unwrap();
        assert_eq!(r.events.len(), 1);
        assert_eq!(r.rejected_count, 2);
        assert_eq!(r.events[0].id, 2);
        assert!(r.events[0].location().is_none());
    }
    #[test]
    fn duplicate_headers_are_retained() {
        assert_eq!(
            unique_headers(vec!["lat".into(), "lat".into(), "".into()]),
            ["lat", "lat (2)", "Column 3"]
        );
    }
}

pub fn detect_delimiter(path: &Path) -> Result<u8, String> {
    use std::io::Read;
    if path
        .extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("tsv"))
    {
        return Ok(b'\t');
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| e.to_string())?
        .take(128 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let mut best = (0usize, b',');
    for delimiter in *b",\t;|" {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(delimiter)
            .flexible(false)
            .from_reader(bytes.as_slice());
        if let Ok(headers) = reader.headers() {
            let width = headers.len();
            if width > 1 && width <= MAX_COLUMNS {
                let valid = reader.records().take(12).filter(Result::is_ok).count();
                let score = width * (valid + 1);
                if score > best.0 {
                    best = (score, delimiter);
                }
            }
        }
    }
    Ok(best.1)
}
fn parse_number(text: &str, decimal_comma: bool) -> Result<f64, String> {
    let text = text.replace(['\u{00a0}', ' '], "");
    let text = if decimal_comma {
        text.replace('.', "").replace(',', ".")
    } else {
        text.replace(',', "")
    };
    let value = text
        .parse::<f64>()
        .map_err(|_| format!("Invalid number: {text}"))?;
    if !value.is_finite() {
        return Err("Numeric values must be finite".into());
    }
    Ok(value)
}
fn parse_dd(text: &str, latitude: bool, decimal_comma: bool) -> Result<Option<f64>, String> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    let mut text = text.trim().to_uppercase().replace('°', "");
    let direction = text
        .chars()
        .last()
        .filter(|c| ['N', 'S', 'E', 'W'].contains(c));
    if let Some(c) = direction {
        text.pop();
        if latitude && !['N', 'S'].contains(&c) || !latitude && !['E', 'W'].contains(&c) {
            return Err("Coordinate hemisphere is on the wrong axis".into());
        }
    }
    let mut value = parse_number(text.trim(), decimal_comma)?;
    if let Some(c) = direction {
        value = value.abs() * if ['S', 'W'].contains(&c) { -1. } else { 1. };
    }
    if value.abs() > if latitude { 90. } else { 180. } {
        return Err("Decimal-degree coordinate is out of range".into());
    }
    Ok(Some(value))
}
fn parse_dd_pair(text: &str, decimal_comma: bool) -> Result<(f64, f64), String> {
    let text = text.trim().trim_matches(['(', ')', '[', ']']);
    let mut pieces: Vec<_> = if text.contains(';') {
        text.split(';').collect()
    } else if text.contains(',') && !decimal_comma {
        text.split(',').collect()
    } else {
        text.split_whitespace().collect()
    };
    let combined;
    if pieces.len() == 4 {
        combined = [
            format!("{}{}", pieces[0], pieces[1]),
            format!("{}{}", pieces[2], pieces[3]),
        ];
        pieces = combined.iter().map(String::as_str).collect();
    }
    if pieces.len() != 2 {
        return Err(
            "Combined DD needs latitude, longitude (or a space/semicolon between them)".into(),
        );
    }
    Ok((
        parse_dd(pieces[0], true, decimal_comma)?.ok_or("Missing latitude")?,
        parse_dd(pieces[1], false, decimal_comma)?.ok_or("Missing longitude")?,
    ))
}
fn parse_utm_pair(text: &str) -> Result<crate::coordinates::Coordinate, String> {
    let parts: Vec<_> = text.split_whitespace().collect();
    let (zone, hemisphere, easting, northing) = match parts.as_slice() {
        [z, e, n] if z.ends_with(['N', 'S', 'n', 's']) => {
            (&z[..z.len() - 1], &z[z.len() - 1..], *e, *n)
        }
        [z, h, e, n] => (*z, *h, *e, *n),
        _ => return Err("Combined UTM needs zone, hemisphere N/S, easting, northing".into()),
    };
    Ok(crate::coordinates::Coordinate::Utm {
        zone: zone.parse().map_err(|_| "Invalid UTM zone")?,
        hemisphere: hemisphere.into(),
        easting: parse_number(easting, false)?,
        northing: parse_number(northing, false)?,
    })
}
#[derive(Clone, Debug, Serialize)]
pub struct Detection {
    pub mapping: Mapping,
    pub notes: Vec<String>,
    pub warnings: Vec<String>,
    pub samples: usize,
}
impl Mapping {
    pub fn detect(table: &RawTable) -> Detection {
        use crate::{
            coordinates::CoordinateSystem as C,
            timestamps::{self, DateOrder, TimeEncoding},
        };
        let mut mapping = Self::guess(&table.headers);
        let mut notes = vec![
            "Timestamps retain seconds and fractions (binary64 Unix seconds); source strings are preserved.".into(),
        ];
        let mut warnings = Vec::new();
        let headers: Vec<_> = table
            .headers
            .iter()
            .map(|h| h.to_lowercase().replace([' ', '_', '-'], ""))
            .collect();
        let find = |names: &[&str]| headers.iter().position(|h| names.contains(&h.as_str()));
        let values = |column: usize| {
            table
                .rows
                .iter()
                .take(200)
                .filter_map(move |r| r.get(column))
                .map(String::as_str)
                .filter(|v| !v.trim().is_empty())
        };
        mapping.time = find(&[
            "timestamp",
            "datetime",
            "dateandtime",
            "eventdatetime",
            "startdatetime",
            "starttimestamp",
        ])
        .or_else(|| {
            find(&[
                "date",
                "startdate",
                "eventdate",
                "observationdate",
                "acqdate",
                "acquisitiondate",
            ])
        })
        .or(mapping.time);
        if let Some(day) = find(&[
            "date",
            "startdate",
            "eventdate",
            "observationdate",
            "acqdate",
            "acquisitiondate",
        ]) {
            if mapping.time == Some(day) {
                mapping.clock = find(&[
                    "time",
                    "clock",
                    "starttime",
                    "eventtime",
                    "observationtime",
                    "acqtime",
                    "acquisitiontime",
                ]);
                if mapping.clock.is_some() {
                    notes.push("Separate date and time columns are combined automatically.".into());
                }
            }
        }
        if mapping.lat.is_none() {
            mapping.lat = find(&["y", "ycoord", "ycoordinate", "decimallatitude", "latdd"]);
        }
        if mapping.lon.is_none() {
            mapping.lon = find(&["x", "xcoord", "xcoordinate", "decimallongitude", "londd"]);
        }
        if mapping.time.is_none() {
            let mut candidates = Vec::new();
            for c in 0..table.headers.len() {
                let mut valid = 0;
                let mut count = 0;
                for value in values(c).take(40) {
                    count += 1;
                    let shaped = value.contains(':')
                        || value.contains('/')
                        || value.contains('-')
                        || value.len() == 8 && value.bytes().all(|b| b.is_ascii_digit())
                        || value.len() >= 10 && value.len() <= 20 && value.parse::<f64>().is_ok();
                    if shaped
                        && [DateOrder::Auto, DateOrder::Dmy, DateOrder::Mdy]
                            .into_iter()
                            .any(|order| {
                                timestamps::parse(
                                    value,
                                    &timestamps::Options {
                                        order,
                                        ..Default::default()
                                    },
                                )
                                .is_ok()
                            })
                    {
                        valid += 1;
                    }
                }
                if count > 0 && valid * 10 >= count * 8 {
                    candidates.push((valid, c));
                }
            }
            candidates.sort_by(|a, b| b.cmp(a));
            if let Some((_, c)) = candidates.first() {
                mapping.time = Some(*c);
                notes.push(format!(
                    "Timestamp column detected from values: {}.",
                    table.headers[*c]
                ));
            }
        }
        // A date column with arbitrary headers can still pair with a clock column.
        if mapping.clock.is_none() {
            if let Some(day) = mapping.time {
                let days: Vec<_> = values(day).take(30).collect();
                if !days.is_empty()
                    && days.iter().all(|s| {
                        !s.contains(':')
                            && [DateOrder::Auto, DateOrder::Dmy, DateOrder::Mdy]
                                .into_iter()
                                .any(|o| timestamps::date(s, o).is_ok())
                    })
                {
                    for c in 0..table.headers.len() {
                        if c == day {
                            continue;
                        }
                        let clocks: Vec<_> = values(c).take(30).collect();
                        if !clocks.is_empty()
                            && clocks.iter().all(|s| {
                                (s.contains(':')
                                    || s.to_ascii_uppercase().ends_with("AM")
                                    || s.to_ascii_uppercase().ends_with("PM"))
                                    && timestamps::parse_fields(
                                        "2000-01-01",
                                        Some(s),
                                        &Default::default(),
                                    )
                                    .is_ok()
                            })
                        {
                            mapping.clock = Some(c);
                            notes.push(format!(
                                "Clock column detected from values: {}.",
                                table.headers[c]
                            ));
                            break;
                        }
                    }
                }
            }
        }
        if let Some(column) = mapping.time {
            mapping.date_order = timestamps::infer_order(values(column));
            if mapping.date_order != DateOrder::Auto {
                notes.push(format!(
                    "Date order inferred from unambiguous samples: {:?}.",
                    mapping.date_order
                ));
            }
            let sample: Vec<_> = values(column).take(50).collect();
            if !sample.is_empty()
                && sample.iter().all(|s| {
                    s.parse::<f64>()
                        .is_ok_and(|v| (20000. ..=80000.).contains(&v))
                })
                && (headers[column].contains("date") || table.sheet != "CSV")
            {
                mapping.time_encoding = TimeEncoding::ExcelSerial;
                notes.push(
                    "Excel 1900-system serial dates detected; the encoding can be changed.".into(),
                );
            }
            if sample.iter().any(|s| {
                timestamps::parse(
                    s,
                    &timestamps::Options {
                        order: mapping.date_order,
                        ..Default::default()
                    },
                )
                .is_err_and(|e| e.contains("Ambiguous"))
            }) {
                warnings.push("Some numeric dates are ambiguous. Choose Day/Month or Month/Day, or specify a custom format.".into());
            }
            if mapping.clock.is_none()
                && !sample.is_empty()
                && sample
                    .iter()
                    .all(|s| s.parse::<f64>().is_ok_and(|v| (0. ..1.).contains(&v)))
            {
                mapping.time_encoding = TimeEncoding::TimeOfDay;
                warnings.push("Fractional-day clock values need a default date or a separate date column; choose Unix seconds to interpret them as epochs.".into());
            }
            if mapping.clock.is_none()
                && sample.iter().all(|s| {
                    s.contains(':') && !s.contains(['-', '/']) && s.split_whitespace().count() <= 2
                })
            {
                mapping.time_encoding = TimeEncoding::TimeOfDay;
                warnings.push(
                    "Time-only values need a default date. No date is silently invented.".into(),
                );
            }
        } else {
            warnings.push("No timestamp column recognized; choose one manually.".into());
        }
        if mapping.mgrs.is_none() && !(mapping.lat.is_some() && mapping.lon.is_some()) {
            for c in 0..table.headers.len() {
                let sample: Vec<_> = values(c).take(30).collect();
                if sample.is_empty() {
                    continue;
                }
                let valid = sample
                    .iter()
                    .filter(|s| {
                        let t = crate::coordinates::normalize_mgrs(s);
                        t.len() >= 5
                            && t.bytes().any(|b| b.is_ascii_alphabetic())
                            && crate::coordinates::mgrs_precision(s).is_ok()
                    })
                    .count();
                if valid * 10 >= sample.len() * 8 {
                    mapping.mgrs = Some(c);
                    mapping.coordinate_system = C::Mgrs;
                    notes.push(format!("MGRS detected from values in {}; spaces and 0–10 grid digits are supported.",table.headers[c]));
                    break;
                }
            }
        }
        if mapping.lat.is_some() && mapping.lon.is_some() {
            if mapping.mgrs.is_some() || mapping.easting.is_some() {
                notes.push("Multiple coordinate representations are present; DD columns are selected. Change input coordinates to use MGRS or UTM instead.".into());
            }
            mapping.coordinate_system = C::Dd;
        } else if mapping.mgrs.is_some() {
            mapping.coordinate_system = C::Mgrs;
        } else if mapping.easting.is_some() {
            mapping.coordinate_system = C::Utm;
        } else if mapping.lat.is_none() && mapping.lon.is_none() {
            for c in 0..table.headers.len() {
                let sample: Vec<_> = values(c).take(30).collect();
                if sample.is_empty() {
                    continue;
                }
                if sample
                    .iter()
                    .filter(|s| {
                        parse_utm_pair(s)
                            .and_then(crate::coordinates::convert)
                            .is_ok()
                    })
                    .count()
                    * 10
                    >= sample.len() * 8
                {
                    mapping.coordinate_column = Some(c);
                    mapping.coordinate_system = C::Utm;
                    notes.push(format!(
                        "Combined UTM coordinates detected in {}.",
                        table.headers[c]
                    ));
                    break;
                }
                if sample
                    .iter()
                    .filter(|s| {
                        s.contains(['.', 'N', 'S', 'E', 'W']) && parse_dd_pair(s, false).is_ok()
                    })
                    .count()
                    * 10
                    >= sample.len() * 8
                {
                    mapping.coordinate_column = Some(c);
                    mapping.coordinate_system = C::Dd;
                    notes.push(format!(
                        "Combined latitude/longitude detected in {}.",
                        table.headers[c]
                    ));
                    break;
                }
            }
        }
        if mapping.coordinate_system == C::Utm && mapping.coordinate_column.is_none() {
            if mapping.zone.is_none() {
                warnings.push("UTM zone is missing. Set its column or an explicit default; it cannot be inferred from easting/northing alone.".into());
            }
            if mapping.hemisphere.is_none() {
                warnings.push(
                    "UTM hemisphere is missing. Set its column or choose N/S explicitly.".into(),
                );
            }
        }
        if mapping.coordinate_system == C::Dd {
            if let Some(c) = mapping.lat {
                if values(c).any(|s| s.contains(',') && !s.contains('.')) {
                    mapping.decimal_comma = true;
                    notes.push("Decimal commas detected in coordinates; change Number format if necessary.".into());
                }
            }
        }
        if mapping.geometry_wkt.is_none() {
            mapping.geometry_wkt = (0..table.headers.len()).find(|&column| {
                let sample = values(column).take(20).collect::<Vec<_>>();
                !sample.is_empty() && sample.iter().all(|v| crate::geometry::parse(v).is_ok())
            });
        }
        if let Some(column) = mapping.geometry_wkt {
            notes.push(format!("WKT geometry column: {}. X is WGS84 longitude; Y is latitude. Z/M stay in source text and are not used as elevation/time. WKT takes precedence over other coordinates on nonempty rows.",table.headers[column]));
        }
        Detection {
            mapping,
            notes,
            warnings,
            samples: table.rows.len().min(200),
        }
    }
}
