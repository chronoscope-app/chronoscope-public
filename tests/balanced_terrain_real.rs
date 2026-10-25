//! Source-backed regression probes produced by validate_balanced_source.py.
//! Synthetic archive tests live in a separate process in balanced_terrain.rs.
use chronoscope::balanced_terrain::BalancedTerrain;
use serde_json::Value;
use std::path::Path;

#[test]
fn real_pack_matches_independent_source_probes_and_all_overview_registrations() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let report: Value = serde_json::from_str(
        &std::fs::read_to_string(
            root.join("docs/validation/balanced-terrain-2026-10-24/source-checks.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let mut terrain =
        BalancedTerrain::open(&root.join("assets/terrain/balanced.cterrain")).unwrap();
    for probe in report["rust_probes"].as_array().unwrap() {
        let lat = probe["latitude"].as_f64().unwrap();
        let lon = probe["longitude"].as_f64().unwrap();
        let level = probe["level"].as_u64().unwrap() as usize;
        let actual = terrain.sample(lat, lon, level).unwrap();
        if let Some(expected) = probe["expected"].as_f64() {
            assert!(
                (f64::from(actual.unwrap()) - expected).abs() < 0.001,
                "{probe}: {actual:?}"
            );
        } else {
            assert!(actual.is_none(), "{probe}: {actual:?}");
        }
    }
    for lat in [-89.9, -16.5, 0., 51.8, 83.99, 89.9] {
        for level in 0..8 {
            assert_eq!(
                terrain.sample(lat, -180., level).unwrap(),
                terrain.sample(lat, 180., level).unwrap()
            );
        }
    }
}
