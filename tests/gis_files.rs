use chronoscope::{engine::Engine, project::Project};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
fn sample(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/gis")
        .join(name)
}
fn invoke(engine: &Engine, name: &str, args: Value) -> Value {
    let result = engine
        .invoke(name, args)
        .unwrap_or_else(|e| panic!("{name}: {e}"));
    chronoscope::schema::validate_output(name, &result)
        .unwrap_or_else(|e| panic!("{name} output: {e}: {result}"));
    result
}
fn engine(dir: &Path) -> Engine {
    Engine::new(Project::new(Default::default()), dir.to_owned()).unwrap()
}
#[test]
fn every_tabular_gis_format_has_reference_attributes_and_ticketed_events() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    for (file, format, count) in [
        ("events.geojson", "geojson", 3),
        ("boundaries.topojson", "topojson", 2),
        ("timed-zones.kml", "kml", 1),
        ("moving.czml", "czml", 3),
        ("track.gpx", "gpx", 4),
    ] {
        let probe = invoke(&e, "file_probe", json!({"path":sample(file)}));
        assert_eq!(probe["kind"], "gis");
        assert_eq!(probe["format"], format);
        let loaded = invoke(&e, "gis_load", json!({"path":sample(file)}));
        let id = &loaded["layer"]["id"];
        assert_eq!(loaded["layer"]["feature_count"], count);
        assert_eq!(
            loaded["layer"]["resource_count"],
            if ["geojson", "topojson"].contains(&format) {
                2
            } else {
                1
            },
            "only dependencies and normalized IDs are bundled"
        );
        let table = invoke(&e, "gis_table", json!({"id":id,"limit":10}));
        assert_eq!(table["count"], count);
        let preview = invoke(&e, "gis_import_preview", json!({"id":id}));
        assert_eq!(preview["sheets"][0]["count"], count);
        if format != "topojson" {
            let committed = invoke(
                &e,
                "import_commit",
                json!({"import_id":preview["import_id"],"mapping":preview["sheets"][0]["mapping"],"append":false}),
            );
            assert_eq!(committed["accepted"], count, "{file}");
            assert!(
                committed.get("needs_review").is_none(),
                "{file}: {committed}"
            );
            let events = invoke(&e, "events", json!({"limit":10}));
            for event in events["events"].as_array().unwrap() {
                assert!(
                    chronoscope::timestamps::utc_time(event["time"].as_f64().unwrap()).is_some()
                );
            }
        }
    }
    assert_eq!(
        invoke(&e, "gis_layers", json!({}))["layers"]
            .as_array()
            .unwrap()
            .len(),
        5,
        "replacing Events retains reference layers"
    );
}
#[test]
fn json_sniffing_keeps_workspaces_and_gis_separate() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let workspace = dir.path().join("legacy.chrono.JSON");
    invoke(&e, "save", json!({"path":workspace}));
    assert_eq!(
        invoke(&e, "file_probe", json!({"path":workspace}))["kind"],
        "workspace"
    );
    let source = dir.path().join("zones.json");
    std::fs::copy(sample("events.geojson"), &source).unwrap();
    assert_eq!(
        invoke(&e, "file_probe", json!({"path":source}))["format"],
        "geojson"
    );
}
#[test]
fn kmz_companions_portable_save_autosave_and_reopen_without_originals() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("source");
    std::fs::create_dir(&input).unwrap();
    let kmz = input.join("zones.kmz");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&kmz).unwrap());
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("doc.kml", opts).unwrap();
    zip.write_all(&std::fs::read(sample("timed-zones.kml")).unwrap())
        .unwrap();
    zip.start_file("icons/note.txt", opts).unwrap();
    zip.write_all(b"retained KMZ companion").unwrap();
    zip.finish().unwrap();
    let profile = dir.path().join("profile");
    let e = engine(&profile);
    let loaded = invoke(&e, "gis_load", json!({"path":kmz}));
    let id = &loaded["layer"]["id"];
    invoke(
        &e,
        "gis_set",
        json!({"id":id,"selected":["warning"],"name":"Shared zones"}),
    );
    let file = dir.path().join("shared.chronoscope");
    assert_eq!(
        invoke(&e, "save", json!({"path":file}))["format"],
        "sqlite_v3"
    );
    std::fs::remove_dir_all(&input).unwrap();
    std::fs::remove_dir_all(profile.join("gis-assets")).unwrap();
    let other = engine(&dir.path().join("recipient"));
    invoke(&other, "open", json!({"path":file}));
    let layers = invoke(&other, "gis_layers", json!({}));
    assert_eq!(layers["layers"][0]["selected"], json!(["warning"]));
    assert_eq!(layers["layers"][0]["name"], "Shared zones");
    let content = invoke(
        &other,
        "gis_read",
        json!({"id":id,"resource":"icons/note.txt","offset":0,"limit":7}),
    );
    assert_eq!(content["total"], 22);
    let preview = invoke(&other, "gis_import_preview", json!({"id":id}));
    assert_eq!(preview["sheets"][0]["count"], 1);
    // Automatic copies intentionally refer to managed assets, rather than copying
    // large resource blobs every 30 seconds; they must still reopen normally.
    invoke(&other, "gis_set", json!({"id":id,"enabled":false}));
    let saved = invoke(&other, "autosave_unsaved", json!({}));
    let auto = saved["autosave_path"].as_str().unwrap();
    let third = engine(&dir.path().join("third"));
    invoke(&third, "open", json!({"path":auto}));
    assert_eq!(
        invoke(&third, "gis_layers", json!({}))["layers"][0]["enabled"],
        false
    );
}
#[test]
fn malformed_crs_archives_and_escape_paths_leave_workspace_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let wrong = dir.path().join("projected.geojson");
    std::fs::write(&wrong,r#"{"type":"FeatureCollection","crs":{"type":"name","properties":{"name":"EPSG:3857"}},"features":[]}"#).unwrap();
    assert!(e
        .invoke("gis_load", json!({"path":wrong}))
        .unwrap_err()
        .contains("reproject"));
    let kmz = dir.path().join("evil.kmz");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&kmz).unwrap());
    zip.start_file("../escape.kml", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"<kml/>").unwrap();
    zip.finish().unwrap();
    assert!(e.invoke("gis_load", json!({"path":kmz})).is_err());
    let kml = dir.path().join("bad.kml");
    std::fs::write(&kml,r#"<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Style><IconStyle><Icon><href>../secret.png</href></Icon></IconStyle></Style></Document></kml>"#).unwrap();
    assert!(e.invoke("gis_load", json!({"path":kml})).is_err());
    assert_eq!(invoke(&e, "gis_layers", json!({}))["layers"], json!([]));
    let loaded = invoke(&e, "gis_load", json!({"path":sample("events.geojson")}));
    assert!(e
        .invoke(
            "gis_read",
            json!({"id":loaded["layer"]["id"],"resource":"../secret"})
        )
        .is_err());
}
#[test]
fn polygon_centroid_events_keep_shapes_render_markers_and_cluster_exactly() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let preview = invoke(
        &e,
        "import_preview",
        json!({"path":sample("events.geojson")}),
    );
    invoke(
        &e,
        "import_commit",
        json!({"import_id":preview["import_id"],"mapping":preview["sheets"][0]["mapping"]}),
    );
    let events = invoke(&e, "events", json!({"limit":10}));
    let polygon = events["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["entity"] == "Storm zone")
        .unwrap();
    assert_eq!(polygon["location_kind"], "polygon-centroid");
    assert!(polygon["geometry_wkt"]
        .as_str()
        .unwrap()
        .starts_with("POLYGON"));
    assert!(polygon["lat"].is_number());
    let packed = invoke(&e, "render_data", json!({}));
    assert_eq!(packed["located_count"], 3);
    assert_eq!(packed["centroid_ids"].as_array().unwrap().len(), 2);
    let shapes = invoke(&e, "render_geometries", json!({}));
    assert_eq!(
        shapes["count"], 2,
        "centroid markers do not replace polygon geometry"
    );
    let grid = invoke(
        &e,
        "display_data",
        json!({"level":2,"time_bin_minutes":0,"partition":"all","weight":"count","max_cells":100}),
    );
    assert_eq!(
        grid["bins"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["count"].as_u64().unwrap())
            .sum::<u64>(),
        3
    );
}

#[test]
fn native_json_ids_remain_exact_above_javascript_integer_precision_and_z_is_retained() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ids.geojson");
    std::fs::write(&path,r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":9007199254740993,"properties":{"timestamp":"2025-09-01T12:10Z"},"geometry":{"type":"Point","coordinates":[12,48,123.5]}}]}"#).unwrap();
    let e = engine(dir.path());
    let layer = invoke(&e, "gis_load", json!({"path":path}))["layer"].clone();
    let table = invoke(
        &e,
        "gis_table",
        json!({"id":layer["id"],"feature_id":"9007199254740993"}),
    );
    assert_eq!(table["count"], 1);
    assert_eq!(table["rows"][0]["geometry_wkt"], "POINT Z(12 48 123.5)");
    let resource = invoke(
        &e,
        "gis_read",
        json!({"id":layer["id"],"resource":layer["entrypoint"]}),
    );
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(resource["data"].as_str().unwrap())
        .unwrap();
    let document: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(document["features"][0]["id"], "9007199254740993");
}
#[test]
fn native_models_tiles_and_gpx_samples_keep_explicit_identity_and_dependencies() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    assert!(
        e.invoke("gis_load", json!({"path":sample("box/Box.gltf")}))
            .is_err(),
        "model location must not be invented"
    );
    for (file, resources, position) in [
        ("box/Box.gltf", 2, Some([12., 48., 100.])),
        ("box/Box.glb", 1, Some([12., 48., 100.])),
        ("box/tileset.json", 2, None),
    ] {
        let mut args = json!({"path":sample(file)});
        if let Some(position) = position {
            args["position"] = json!(position);
        }
        let layer = invoke(&e, "gis_load", args)["layer"].clone();
        assert_eq!(layer["resource_count"], resources);
        assert_eq!(layer["position"], json!(position));
    }
    let layer = invoke(&e, "gis_load", json!({"path":sample("track.gpx")}))["layer"].clone();
    let rows = invoke(
        &e,
        "gis_table",
        json!({"id":layer["id"],"feature_id":"_chronoscope_trk_1"}),
    );
    assert_eq!(rows["count"], 3);
}
