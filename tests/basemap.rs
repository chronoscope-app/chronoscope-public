use base64::{engine::general_purpose::STANDARD, Engine as _};
use chronoscope::{basemap::Basemap, engine::Engine, model::Dataset, project::Project};
use serde_json::json;
use sha2::{Digest, Sha256};

fn engine(path: &std::path::Path) -> Engine {
    Engine::new(Project::new(Dataset::default()), path.into()).unwrap()
}

#[test]
fn streets_is_default_and_survives_project_save_open_and_partial_preferences() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let initial = e.invoke("preferences", json!({})).unwrap();
    assert_eq!(initial["basemap"], "streets");
    assert_eq!(initial["map_layers"], json!([]));
    let path = dir.path().join("streets.chronoscope");
    e.invoke("save", json!({"path":path})).unwrap();
    e.invoke("preferences", json!({"preferences":{"basemap":"none"}}))
        .unwrap();
    e.invoke("open", json!({"path":path})).unwrap();
    let result = e
        .invoke("preferences", json!({"preferences":{"theme":"light"}}))
        .unwrap();
    assert_eq!(result["basemap"], "streets");
    chronoscope::schema::validate_output("preferences", &result).unwrap();
    assert!(e
        .invoke(
            "preferences",
            json!({"preferences":{"basemap":"other-provider"}})
        )
        .is_err());
}

#[test]
fn migrate_only_the_old_default_not_custom_wmts_or_old_shared_projects() {
    for custom in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let mut prefs = serde_json::to_value(chronoscope::engine::Preferences::default()).unwrap();
        prefs.as_object_mut().unwrap().remove("basemap");
        prefs["map"] = serde_json::to_value(chronoscope::wmts::MapConfig::nasa()).unwrap();
        prefs["map_layers"] = serde_json::Value::Null;
        if custom {
            prefs["map"]["url"] = json!("https://custom.invalid/wmts");
        }
        std::fs::write(
            dir.path().join("preferences.json"),
            serde_json::to_vec(&prefs).unwrap(),
        )
        .unwrap();
        let e = engine(dir.path());
        let actual = e.invoke("preferences", json!({})).unwrap();
        assert_eq!(actual["basemap"], if custom { "none" } else { "streets" });
        assert_eq!(actual["map"]["enabled"], custom);
        let old_project_preferences: chronoscope::engine::Preferences =
            serde_json::from_value(prefs).unwrap();
        assert_eq!(old_project_preferences.basemap, Basemap::None);
    }
}

#[test]
fn fixed_resource_command_reuses_disk_cache_offline_and_rejects_other_origins() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let url = "https://tiles.openfreemap.org/styles/positron";
    let cache = e.invoke("wmts_access", json!({})).unwrap();
    let key = e.maps.metadata_key(url).unwrap();
    let filename = format!("{:x}", Sha256::digest(key.as_bytes()));
    let content = br#"{"version":8,"sources":{},"layers":[]}"#;
    std::fs::write(
        std::path::Path::new(cache["directory"].as_str().unwrap()).join(filename),
        content,
    )
    .unwrap();
    e.invoke("wmts_access", json!({"settings":{"offline":true}}))
        .unwrap();
    let result = e.invoke("basemap_resource", json!({"url":url})).unwrap();
    assert_eq!(result["cache_hit"], true);
    assert_eq!(
        STANDARD.decode(result["data"].as_str().unwrap()).unwrap(),
        content
    );
    chronoscope::schema::validate_output("basemap_resource", &result).unwrap();
    assert!(e
        .invoke(
            "basemap_resource",
            json!({"url":"https://127.0.0.1/private"})
        )
        .is_err());
    assert!(e
        .invoke(
            "basemap_resource",
            json!({"url":"https://tiles.openfreemap.org/planet/not-cached/0/0/0.pbf"})
        )
        .unwrap_err()
        .contains("offline"));
}
