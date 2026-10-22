use chronoscope::{engine::Engine, map_servers, model::Dataset, project::Project, wmts};
use serde_json::json;

#[test]
fn builtins_do_not_overwrite_or_repopulate_an_existing_library() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    let initial = engine.invoke("wmts_servers", json!({})).unwrap();
    assert!(initial["servers"].as_array().unwrap().is_empty());
    assert!(initial["presets"].as_array().unwrap().is_empty());
    assert!(!dir.path().join("map-servers.json").exists());
    engine
        .invoke("wmts_servers", json!({"settings":{"servers":[]}}))
        .unwrap();
    let saved = std::fs::read(dir.path().join("map-servers.json")).unwrap();
    let catalog = engine.invoke("wmts_servers", json!({})).unwrap();
    assert!(catalog["servers"].as_array().unwrap().is_empty());
    assert_eq!(catalog["presets"], initial["presets"]);
    chronoscope::schema::validate_output("wmts_servers", &catalog).unwrap();
    assert_eq!(
        std::fs::read(dir.path().join("map-servers.json")).unwrap(),
        saved
    );
    let prefs = engine.invoke("preferences", json!({})).unwrap();
    assert_eq!(prefs["basemap"], "streets");
    assert_eq!(prefs["map"]["enabled"], false);
    assert_eq!(prefs["map_layers"], json!([]));
}

#[test]
fn builtins_match_real_provider_capabilities_and_plan_supported_tiles() {
    let eox = wmts::parse(include_str!("fixtures/wmts/eox-2026-10-15.xml")).unwrap();
    let topo = wmts::parse(include_str!("fixtures/wmts/usgs-topo-2026-10-15.xml")).unwrap();
    let imagery = wmts::parse(include_str!("fixtures/wmts/usgs-imagery-2026-10-15.xml")).unwrap();
    let legacy: Vec<map_servers::Preset> =
        serde_json::from_str(include_str!("../src/map-presets.json")).unwrap();
    let presets = legacy.as_slice();
    map_servers::Library {
        servers: presets
            .iter()
            .map(|p| map_servers::MapServer {
                id: p.id.clone(),
                name: p.name.clone(),
                config: p.config.clone(),
            })
            .collect(),
    }
    .validate()
    .unwrap();
    for preset in presets {
        assert!(preset.config.url.starts_with("https://"));
        assert!(!preset.credits.is_empty());
        assert!(preset
            .credits
            .iter()
            .all(|credit| !credit.text.is_empty() && credit.url.starts_with("https://")));
        let caps = match preset.id.as_str() {
            "nasa-gibs" => continue, // Existing NASA fixtures and live-data QA cover GIBS.
            "usgs-topo" => &topo,
            "usgs-imagery" => &imagery,
            _ => &eox,
        };
        let layer = caps
            .layers
            .iter()
            .find(|l| l.id == preset.config.layer)
            .unwrap();
        assert!(layer.formats.contains(&preset.config.format));
        assert!(layer.matrix_sets.contains(&preset.config.matrix_set));
        assert_eq!(layer.style, preset.config.style);
        let plan = wmts::plan_page(
            caps,
            &preset.config,
            [-84.38801, 33.74899, -84.38799, 33.74901],
            Some(12),
            0,
            1,
            512.,
        )
        .unwrap();
        assert!(!plan.tiles.is_empty(), "{}", preset.id);
        assert!(plan
            .tiles
            .iter()
            .all(|tile| tile.url.starts_with("https://")));
        assert!(map_servers::attribution(&preset.config)
            .unwrap()
            .contains(&preset.credits[0].text));
        if preset.id.starts_with("eox-sentinel-") {
            assert!(preset.license.contains("non-commercial"));
            assert!(preset.name.contains("non-commercial"));
        }
    }
}
