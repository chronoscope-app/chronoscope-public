use chronoscope::terrain::TerrainCatalog;
#[test]
fn c19_mesh_cache_reuses_exact_values_and_rejects_changed_source_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tile.dt0");
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/terrain/synthetic-n43.dt0");
    std::fs::copy(source, &path).unwrap();
    let mut catalog = TerrainCatalog::load(&path).unwrap();
    let bounds = [-80., 43., -79., 44.];
    let first = catalog.mesh_cached(bounds, 129).unwrap();
    let next = catalog.mesh_cached(bounds, 129).unwrap();
    assert!(std::sync::Arc::ptr_eq(&first, &next));
    assert_eq!(first.covered, 129 * 129);
    let other = catalog.mesh_cached(bounds, 257).unwrap();
    assert!(!std::sync::Arc::ptr_eq(&first, &other));
    assert_eq!(other.elevations.len(), 257 * 257);
    let bytes = std::fs::read(&path).unwrap();
    std::fs::write(&path, &bytes[..bytes.len() - 1]).unwrap();
    assert!(catalog
        .mesh_cached(bounds, 129)
        .unwrap_err()
        .contains("changed"));
    std::fs::write(&path, bytes).unwrap();
    let mut reload = TerrainCatalog::load(&path).unwrap();
    let fresh = reload.mesh_cached(bounds, 129).unwrap();
    assert!(!std::sync::Arc::ptr_eq(&first, &fresh));
    assert_eq!(first.elevations, fresh.elevations);
}

#[test]
fn c19_wire_cache_hits_report_zero_new_decodes_with_identical_elevations() {
    use chronoscope::{engine::Engine, model::Dataset, project::Project};
    use serde_json::json;
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().into()).unwrap();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/terrain/synthetic-n43.dt0");
    engine.invoke("terrain_load", json!({"path":path})).unwrap();
    let args = json!({"bounds":[-80,43,-79,44],"resolution":129});
    let first = engine.invoke("terrain_mesh", args.clone()).unwrap();
    let cached = engine.invoke("terrain_mesh", args).unwrap();
    assert_eq!(first["cache_hit"], false);
    assert_eq!(cached["cache_hit"], true);
    assert_eq!(cached["decoded_tiles"], 0);
    assert_eq!(first["elevations"], cached["elevations"]);
    chronoscope::schema::validate_output("terrain_mesh", &cached).unwrap();
}
