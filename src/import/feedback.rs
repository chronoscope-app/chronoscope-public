//! Bounded field feedback using the same converters as the eventual import.
use super::*;
use crate::coordinates::CoordinateSystem;

#[derive(Debug, Serialize)]
pub struct FieldFeedback {
    pub state: &'static str,
    pub message: String,
    pub required: bool,
}

/// Validate fields independently so an invalid timestamp cannot hide a bad number
/// or coordinate. This only inspects the supplied sample, never the whole source.
pub fn field_feedback(table: &RawTable, mapping: &Mapping) -> BTreeMap<String, FieldFeedback> {
    // Source indices must not accidentally resolve to the synthetic probe columns.
    let mut mapping = mapping.clone();
    for column in [
        &mut mapping.time,
        &mut mapping.clock,
        &mut mapping.end,
        &mut mapping.entity,
        &mut mapping.lat,
        &mut mapping.lon,
        &mut mapping.altitude,
        &mut mapping.altitude_reference_column,
        &mut mapping.category,
        &mut mapping.label,
        &mut mapping.value,
        &mut mapping.related_to,
        &mut mapping.geometry_wkt,
        &mut mapping.coordinate_column,
        &mut mapping.easting,
        &mut mapping.northing,
        &mut mapping.zone,
        &mut mapping.hemisphere,
        &mut mapping.mgrs,
    ] {
        if column.is_some_and(|i| i >= table.headers.len()) {
            *column = Some(usize::MAX);
        }
    }
    let mut sample = table.clone();
    let timestamp = sample.headers.len();
    sample
        .headers
        .extend(["_time", "_latitude", "_longitude"].map(String::from));
    for row in &mut sample.rows {
        row.resize(timestamp, String::new());
        let present = |column: Option<usize>| {
            column
                .and_then(|i| row.get(i))
                .is_some_and(|v| !v.trim().is_empty())
        };
        let zero = if mapping.coordinate_system == CoordinateSystem::Dms {
            "0 0 0"
        } else {
            "0"
        };
        let lat_partner = if present(mapping.lon.or(mapping.lat)) {
            zero
        } else {
            ""
        };
        let lon_partner = if present(mapping.lat.or(mapping.lon)) {
            zero
        } else {
            ""
        };
        row.extend(["2000-01-01T00:00:00Z", lon_partner, lat_partner].map(String::from));
    }
    let dd = matches!(
        mapping.coordinate_system,
        CoordinateSystem::Dd | CoordinateSystem::Dms
    );
    let utm = mapping.coordinate_system == CoordinateSystem::Utm;
    let separate = mapping.coordinate_column.is_none();
    let fields = [
        ("time", mapping.time, true, true),
        ("clock", mapping.clock, false, true),
        ("end", mapping.end, false, true),
        ("entity", mapping.entity, false, true),
        (
            "lat",
            mapping.lat,
            dd && separate && mapping.lon.is_some(),
            dd && separate,
        ),
        (
            "lon",
            mapping.lon,
            dd && separate && mapping.lat.is_some(),
            dd && separate,
        ),
        ("category", mapping.category, false, true),
        ("label", mapping.label, false, true),
        ("value", mapping.value, false, true),
        ("altitude", mapping.altitude, false, true),
        (
            "altitude_reference_column",
            mapping.altitude_reference_column,
            false,
            true,
        ),
        ("related_to", mapping.related_to, false, true),
        ("geometry_wkt", mapping.geometry_wkt, false, true),
        (
            "coordinate_column",
            mapping.coordinate_column,
            false,
            dd || utm,
        ),
        ("easting", mapping.easting, utm && separate, utm && separate),
        (
            "northing",
            mapping.northing,
            utm && separate,
            utm && separate,
        ),
        (
            "zone",
            mapping.zone,
            utm && separate && !(1..=60).contains(&mapping.default_zone),
            utm && separate,
        ),
        (
            "hemisphere",
            mapping.hemisphere,
            utm && separate && mapping.default_hemisphere.trim().is_empty(),
            utm && separate,
        ),
        (
            "mgrs",
            mapping.mgrs,
            mapping.coordinate_system == CoordinateSystem::Mgrs,
            mapping.coordinate_system == CoordinateSystem::Mgrs,
        ),
    ];
    fields
        .into_iter()
        .map(|(key, column, required, active)| {
            let (state, message) = if !active {
                (
                    "inactive",
                    "Not used by the selected coordinate format".into(),
                )
            } else if column.is_none()
                && key == "entity"
                && mapping.default_entity.trim().is_empty()
            {
                (
                    "invalid",
                    "Choose an entity column or enter a default entity".into(),
                )
            } else if column.is_none() {
                if required {
                    (
                        "invalid",
                        if ["zone", "hemisphere"].contains(&key) {
                            "Required — choose a source column or set its default".into()
                        } else {
                            "Required — choose a source column".into()
                        },
                    )
                } else {
                    ("optional", "Optional · not mapped".into())
                }
            } else {
                let mut probe = Mapping {
                    time: Some(timestamp),
                    decimal_comma: mapping.decimal_comma,
                    ..Default::default()
                };
                match key {
                    "time" | "clock" | "end" => {
                        probe.time = mapping.time;
                        probe.clock = mapping.clock;
                        probe.custom_format.clone_from(&mapping.custom_format);
                        probe.offset_minutes = mapping.offset_minutes;
                        probe.date_order = mapping.date_order;
                        probe.time_encoding = mapping.time_encoding;
                        probe.default_date.clone_from(&mapping.default_date);
                        if key == "end" {
                            probe.end = column;
                        }
                    }
                    "entity" => {
                        probe.entity = column;
                    }
                    "lat" => {
                        probe.coordinate_system = mapping.coordinate_system.clone();
                        probe.lat = column;
                        probe.lon = Some(timestamp + 2);
                    }
                    "lon" => {
                        probe.coordinate_system = mapping.coordinate_system.clone();
                        probe.lon = column;
                        probe.lat = Some(timestamp + 1);
                    }
                    "altitude" | "altitude_reference_column" => {
                        probe.altitude = mapping.altitude;
                        probe.altitude_reference_column = mapping.altitude_reference_column;
                        probe.altitude_unit = mapping.altitude_unit;
                        probe.altitude_reference = mapping.altitude_reference;
                    }
                    "value" => {
                        probe.value = column;
                    }
                    "category" => {
                        probe.category = column;
                    }
                    "label" => {
                        probe.label = column;
                    }
                    "related_to" => {
                        probe.related_to = column;
                    }
                    "geometry_wkt" => {
                        probe.geometry_wkt = column;
                    }
                    _ => {
                        probe.coordinate_system = mapping.coordinate_system.clone();
                        probe.coordinate_column = mapping.coordinate_column;
                        probe.easting = mapping.easting;
                        probe.northing = mapping.northing;
                        probe.zone = mapping.zone;
                        probe.hemisphere = mapping.hemisphere;
                        probe.default_zone = mapping.default_zone;
                        probe
                            .default_hemisphere
                            .clone_from(&mapping.default_hemisphere);
                        probe.mgrs = mapping.mgrs;
                    }
                }
                match convert(&sample, &probe, "sample", 1) {
                    Err(error) => ("invalid", error),
                    Ok(report) if !report.rejected.is_empty() => {
                        let (row, reason) = &report.rejected[0];
                        ("invalid", format!("Row {row}: {reason}"))
                    }
                    Ok(_) if sample.rows.is_empty() => {
                        ("invalid", "No sample rows to validate".into())
                    }
                    Ok(_) => ("valid", "Valid in sample".into()),
                }
            };
            (
                key.into(),
                FieldFeedback {
                    state,
                    message,
                    required,
                },
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn table() -> RawTable {
        RawTable {
            sheet: "CSV".into(),
            headers: ["timestamp", "latitude", "longitude", "value", "end"]
                .map(String::from)
                .to_vec(),
            rows: vec![["03/04/2026", "40", "-70", "wrong", "2025-01-01"]
                .map(String::from)
                .to_vec()],
            row_numbers: vec![42],
        }
    }
    #[test]
    fn independent_errors_use_real_time_number_and_coordinate_rules() {
        let table = table();
        let mut mapping = Mapping {
            time: Some(0),
            lat: Some(1),
            lon: Some(2),
            value: Some(3),
            ..Default::default()
        };
        let fields = field_feedback(&table, &mapping);
        assert_eq!(fields["time"].state, "invalid");
        assert!(fields["time"].message.contains("Ambiguous"));
        assert_eq!(fields["value"].state, "invalid");
        assert_eq!(fields["lat"].state, "valid");
        assert_eq!(fields["lon"].state, "valid");
        mapping.date_order = crate::timestamps::DateOrder::Dmy;
        mapping.lon = None;
        let fields = field_feedback(&table, &mapping);
        assert_eq!(fields["time"].state, "valid");
        assert_eq!(fields["lat"].state, "valid");
        assert!(fields["lon"].required);
        assert_eq!(fields["lon"].state, "invalid");
    }
    #[test]
    fn end_precedence_empty_locations_and_utm_requirements_are_preserved() {
        let mut table = table();
        table.rows[0][0] = "2026-01-01".into();
        table.rows[0][1] = String::new();
        table.rows[0][2] = String::new();
        let mut mapping = Mapping {
            time: Some(0),
            lat: Some(1),
            lon: Some(2),
            end: Some(4),
            ..Default::default()
        };
        let fields = field_feedback(&table, &mapping);
        assert_eq!(fields["lat"].state, "valid");
        assert_eq!(fields["lon"].state, "valid");
        assert_eq!(fields["end"].state, "invalid");
        mapping.coordinate_system = CoordinateSystem::Utm;
        let fields = field_feedback(&table, &mapping);
        assert!(
            fields["easting"].required && fields["zone"].required && fields["hemisphere"].required
        );
        assert_eq!(fields["lat"].state, "inactive");
        assert_eq!(fields["label"].state, "optional");
    }

    #[test]
    fn source_bounds_and_partially_missing_coordinates_cannot_appear_valid() {
        let mut table = table();
        table.rows[0][0] = "2026-01-01".into();
        table.rows[0][1] = String::new();
        let mut mapping = Mapping {
            time: Some(0),
            lat: Some(1),
            lon: Some(2),
            ..Default::default()
        };
        let fields = field_feedback(&table, &mapping);
        assert_eq!(fields["lat"].state, "invalid");
        assert_eq!(fields["lon"].state, "invalid");
        mapping.time = Some(table.headers.len());
        mapping.value = Some(usize::MAX);
        let fields = field_feedback(&table, &mapping);
        assert_eq!(fields["time"].state, "invalid");
        assert_eq!(fields["value"].state, "invalid");
    }
}
