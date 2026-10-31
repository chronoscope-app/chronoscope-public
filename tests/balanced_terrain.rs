//! Synthetic registration/void/seam fixtures; these are not source-data accuracy claims.
use chronoscope::{balanced_terrain::BalancedTerrain, engine::Engine, project::Project};
use serde_json::json;
use std::{io::Write, path::Path};

fn fixture(path: &Path) {
    let mut archive = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut heights = vec![0i16; 256 * 256];
    for y in 0..256 {
        for x in 0..256 {
            heights[y * 256 + x] = 100 + 2 * x as i16 + 3 * y as i16;
        }
    }
    heights[5 * 256 + 5] = -32767;
    heights[10 * 256 + 10] = -430;
    let mut delta = Vec::new();
    for row in heights.as_chunks::<256>().0 {
        for (i, h) in row.iter().enumerate() {
            delta.extend_from_slice(
                &if i == 0 {
                    *h
                } else {
                    h.wrapping_sub(row[i - 1])
                }
                .to_le_bytes(),
            );
        }
    }
    archive.start_file("0/0/0.bin", options).unwrap();
    archive.write_all(&delta).unwrap();
    // Last fine-grid block: ensure -180/+180 interpolate across the same seam.
    let mut last = Vec::new();
    for _ in 0..256 {
        for x in 0..96 {
            last.extend_from_slice(&if x == 0 { 200i16 } else { 0i16 }.to_le_bytes());
        }
    }
    archive.start_file("0/0/84.bin", options).unwrap();
    archive.write_all(&last).unwrap();
    let mut polar = Vec::new();
    for _ in 0..48 {
        for x in 0..256 {
            polar.extend_from_slice(&if x == 0 { 300i16 } else { 0i16 }.to_le_bytes());
        }
    }
    archive.start_file("0/42/0.bin", options).unwrap();
    archive.write_all(&polar).unwrap();
    let mut levels = vec![];
    let (mut width, mut height) = (21600usize, 10800usize);
    for i in 0..8 {
        levels.push(json!({"width":width,"height":height,"tiles":if i == 0 {vec![[0,0],[84,0],[0,42]]} else {vec![]}}));
        width = width.div_ceil(2);
        height = height.div_ceil(2);
    }
    archive.start_file("manifest.json", options).unwrap();
    archive.write_all(serde_json::to_string(&json!({"format":1,"datum":"egm96","spacing_arc_seconds":60,"tile_size":256,"width":21600,"height":10800,"levels":levels})).unwrap().as_bytes()).unwrap();
    archive.finish().unwrap();
}
fn position(x: f64, y: f64) -> (f64, f64) {
    (-90. + (y + 0.5) / 60., -180. + (x + 0.5) / 60.)
}

#[test]
fn compressed_samples_preserve_registration_negative_heights_voids_and_seams() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.cterrain");
    fixture(&path);
    let mut terrain = BalancedTerrain::open(&path).unwrap();
    let (lat, lon) = position(0., 0.);
    assert_eq!(terrain.sample(lat, lon, 0).unwrap(), Some(100.));
    let (lat, lon) = position(20., 30.);
    assert!((terrain.sample(lat, lon, 0).unwrap().unwrap() - 230.).abs() < 0.01);
    let (lat, lon) = position(20.25, 30.5);
    assert!((terrain.sample(lat, lon, 0).unwrap().unwrap() - 232.).abs() < 0.01);
    let (lat, lon) = position(10., 10.);
    assert!((terrain.sample(lat, lon, 0).unwrap().unwrap() + 430.).abs() < 0.01);
    let (lat, lon) = position(5., 5.);
    assert_eq!(terrain.sample(lat, lon, 0).unwrap(), None);
    let (lat, lon) = position(4.5, 5.);
    assert_eq!(terrain.sample(lat, lon, 0).unwrap(), None);
    let (lat, lon) = position(4., 5.);
    assert_eq!(terrain.sample(lat, lon, 0).unwrap(), Some(123.));
    assert_eq!(terrain.sample(0., -140., 0).unwrap(), Some(0.));
    assert_eq!(terrain.sample(89.9, -179.5, 0).unwrap(), Some(300.));
    let lat = position(0., 30.).0;
    assert_eq!(
        terrain.sample(lat, -180., 0).unwrap(),
        terrain.sample(lat, 180., 0).unwrap()
    );
    let decoded = terrain.decoded;
    terrain.sample(lat, -180., 0).unwrap();
    assert_eq!(terrain.decoded, decoded);
    assert!(terrain.sample(91., 0., 0).is_err());
    assert!(terrain.sample(f64::NAN, 0., 0).is_err());
    // The archive stays in place; sampling creates no decoded disk files.
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn defaults_unload_restart_restore_custom_replacement_and_portable_save() {
    let resources = tempfile::tempdir().unwrap();
    let pack = resources.path().join("balanced.cterrain");
    fixture(&pack);
    chronoscope::balanced_terrain::set_resource_path(pack);
    let profile = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), profile.path().into()).unwrap();
    let (a_lat, a_lon) = position(20., 30.);
    let (b_lat, b_lon) = position(5., 5.);
    let a = engine
        .invoke(
            "terrain_sample",
            json!({"latitude":a_lat,"longitude":a_lon}),
        )
        .unwrap();
    let b = engine
        .invoke(
            "terrain_sample",
            json!({"latitude":b_lat,"longitude":b_lon}),
        )
        .unwrap();
    let batch=engine.invoke("terrain_sample",json!({"latitude":a_lat,"longitude":a_lon,"coordinates":[[a_lon,a_lat],[b_lon,b_lat],[a_lon,a_lat]]})).unwrap();
    chronoscope::schema::validate_output("terrain_sample", &batch).unwrap();
    assert_eq!(batch["elevation_m"], a["elevation_m"]);
    assert_eq!(
        batch["elevations_m"],
        json!([a["elevation_m"], b["elevation_m"], a["elevation_m"]])
    );
    assert!(b["elevation_m"].is_null());
    assert!(engine
        .invoke(
            "terrain_sample",
            json!({"latitude":a_lat,"longitude":a_lon,"coordinates":[[181.,0.]]})
        )
        .is_err());
    let polar = engine
        .invoke(
            "terrain_mesh",
            json!({"bounds":[-179.9,89.5,-179.,89.999999],"resolution":257}),
        )
        .unwrap();
    assert_eq!(polar["geographic"], true);
    assert_eq!(polar["minimum"], 300.);
    assert_eq!(polar["maximum"], 300.);
    assert_eq!(
        engine.invoke("preferences", json!({})).unwrap()["terrain_builtin"],
        true
    );
    assert!(engine
        .invoke("terrain_info", json!({}))
        .unwrap()
        .is_object());
    engine.invoke("terrain_unload", json!({})).unwrap();
    drop(engine);
    let engine = Engine::new(Project::empty(), profile.path().into()).unwrap();
    assert_eq!(
        engine.invoke("preferences", json!({})).unwrap()["terrain_builtin"],
        false
    );
    assert!(engine.invoke("terrain_info", json!({})).unwrap().is_null());
    engine.invoke("preferences",json!({"preferences":{"terrain_builtin":true,"terrain_path":null,"terrain_vertical_datum":"egm96"}})).unwrap();
    let workspace = profile.path().join("world.chronoscope");
    engine.invoke("save", json!({"path":workspace})).unwrap();
    assert!(
        workspace.metadata().unwrap().len() < 1024 * 1024,
        "Default terrain must not be duplicated in each workspace"
    );
    engine.invoke("terrain_unload", json!({})).unwrap();
    engine.invoke("open", json!({"path":workspace})).unwrap();
    assert_eq!(
        engine.invoke("preferences", json!({})).unwrap()["terrain_builtin"],
        true
    );
    assert!(engine
        .invoke("terrain_info", json!({}))
        .unwrap()
        .is_object());
    let dted =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/terrain/synthetic-n43.dt0");
    engine.invoke("terrain_load", json!({"path":dted})).unwrap();
    let prefs = engine.invoke("preferences", json!({})).unwrap();
    assert_eq!(prefs["terrain_builtin"], false);
    assert_eq!(prefs["terrain_vertical_datum"], "unresolved-msl");
    assert_eq!(
        engine.invoke("terrain_info", json!({})).unwrap()["tiles"][0]["south"],
        43.
    );
    drop(engine);
    let engine = Engine::new(Project::empty(), profile.path().into()).unwrap();
    assert_eq!(
        engine.invoke("preferences", json!({})).unwrap()["terrain_builtin"],
        false
    );
    assert_eq!(
        engine.invoke("terrain_info", json!({})).unwrap()["tiles"][0]["south"],
        43.
    );
    // Older explicit no-terrain preferences must not be silently upgraded.
    let legacy = tempfile::tempdir().unwrap();
    std::fs::write(
        legacy.path().join("preferences.json"),
        r#"{"terrain_path":null}"#,
    )
    .unwrap();
    let engine = Engine::new(Project::empty(), legacy.path().into()).unwrap();
    assert!(engine.invoke("terrain_info", json!({})).unwrap().is_null());
}

#[test]
fn corrupt_compressed_blocks_fail_without_substituting_flat_land() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("corrupt.cterrain");
    fixture(&path);
    let offset = {
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
        let offset = archive.by_name("0/0/0.bin").unwrap().data_start().unwrap() as usize;
        offset
    };
    let mut bytes = std::fs::read(&path).unwrap();
    bytes[offset] ^= 0xff;
    std::fs::write(&path, bytes).unwrap();
    let mut terrain = BalancedTerrain::open(&path).unwrap();
    let (lat, lon) = position(20., 30.);
    assert!(terrain.sample(lat, lon, 0).is_err());
}
