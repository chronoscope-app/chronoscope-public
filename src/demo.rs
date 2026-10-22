use crate::model::{parse_time, Dataset, Event};
use std::collections::{BTreeMap, BTreeSet};
pub fn dataset() -> Dataset {
    let start = parse_time("2025-06-17T08:00:00Z", "", 0).unwrap();
    let names = ["Atlas", "Beacon", "Cedar", "Delta"];
    let routes = [
        vec![
            (37.7955, -122.3937, "Ferry terminal"),
            (37.7920, -122.4030, "Financial district"),
            (37.7840, -122.4075, "Market street"),
            (37.7765, -122.4170, "Civic center"),
            (37.7694, -122.4260, "Mission district"),
            (37.7765, -122.4170, "Civic center"),
            (37.7955, -122.3937, "Ferry terminal"),
        ],
        vec![
            (37.8070, -122.4170, "North waterfront"),
            (37.8000, -122.4090, "North beach"),
            (37.7920, -122.4030, "Financial district"),
            (37.7840, -122.4075, "Market street"),
            (37.7840, -122.4075, "Market street"),
            (37.7970, -122.4050, "Chinatown"),
            (37.8070, -122.4170, "North waterfront"),
        ],
        vec![
            (37.7690, -122.4530, "Golden gate"),
            (37.7750, -122.4400, "Western addition"),
            (37.7765, -122.4170, "Civic center"),
            (37.7765, -122.4170, "Civic center"),
            (37.7840, -122.4075, "Market street"),
            (37.7955, -122.3937, "Ferry terminal"),
            (37.7690, -122.4530, "Golden gate"),
        ],
        vec![
            (37.7600, -122.3900, "Southern waterfront"),
            (37.7710, -122.3980, "Mission bay"),
            (37.7820, -122.3950, "South beach"),
            (37.7955, -122.3937, "Ferry terminal"),
            (37.7920, -122.4030, "Financial district"),
            (37.7710, -122.3980, "Mission bay"),
            (37.7600, -122.3900, "Southern waterfront"),
        ],
    ];
    let mut events = Vec::new();
    let mut id = 1;
    for (track, route) in routes.iter().enumerate() {
        for i in 0..48 {
            let phase = (i as f64 / 47.) * 6.;
            let segment = (phase.floor() as usize).min(5);
            let f = phase - segment as f64;
            let a = route[segment];
            let b = route[segment + 1];
            let (lat, lon) = (a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f);
            let category = if i % 11 == 0 {
                "Exchange"
            } else if (a.0 - b.0).abs() + (a.1 - b.1).abs() < 0.00001 {
                "Dwell"
            } else {
                "Transit"
            };
            let related = if i % 11 == 0 {
                names[(track + 1) % 4]
            } else {
                ""
            };
            events.push(Event {
                location_kind: None,
                geometry_wkt: None,
                mgrs_precision: None,
                id,
                entity: names[track].into(),
                time: start + i as f64 * 900. + track as f64 * 80.,
                end: None,
                lat: Some(lat),
                lon: Some(lon),
                category: category.into(),
                label: a.2.into(),
                value: Some((20 + (i * 7 + track * 3) % 80) as f64),
                related_to: related.into(),
                attrs: BTreeMap::from([
                    ("confidence".into(), format!("{}", 70 + (i * 3) % 30)),
                    ("region".into(), "San Francisco".into()),
                ]),
                tags: BTreeSet::new(),
                note: String::new(),
                source: "Synthetic demonstration".into(),
                source_row: i + 2,
            });
            id += 1;
        }
    }
    events.sort_by(|a, b| a.time.total_cmp(&b.time).then(a.id.cmp(&b.id)));
    Dataset {
        events,
        name: "San Francisco · synthetic movement study".into(),
    }
}
