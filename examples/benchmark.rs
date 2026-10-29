use chronoscope::{
    analysis::{self, Parameters, Pattern},
    model::{Event, Filter},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    time::Instant,
};
fn main() {
    let count = std::env::args()
        .nth(1)
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(100_000)
        .min(250_000);
    let mut events = Vec::with_capacity(count);
    for i in 0..count {
        events.push(Event {
            altitude: None,
            location_kind: None,
            geometry_wkt: None,
            mgrs_precision: None,
            id: i as u64 + 1,
            entity: format!("Entity {}", i % 20),
            time: 1_750_000_000. + (i % 300) as f64,
            end: None,
            lat: Some(-70. + (i / 500) as f64 * 0.28),
            lon: Some(-179. + (i % 500) as f64 * 0.716),
            category: "Synthetic".into(),
            label: String::new(),
            value: Some(i as f64),
            related_to: String::new(),
            attrs: BTreeMap::new(),
            tags: BTreeSet::new(),
            note: String::new(),
            source: "Benchmark".into(),
            source_row: i + 2,
        });
    }
    let start = Instant::now();
    let result = analysis::run(&events, Pattern::Proximity, &Parameters::default());
    println!(
        "{count} spatially separated events: proximity {:?}, findings={}, partial={}",
        start.elapsed(),
        result.findings.len(),
        result.limited
    );
    let filter = Filter {
        search: "Entity 1".into(),
        ..Default::default()
    };
    let selected = BTreeSet::new();
    let start = Instant::now();
    let found = events
        .iter()
        .filter(|e| filter.matches(e, &selected))
        .count();
    println!("Text filter: {:?}, {found} matches", start.elapsed());
}
