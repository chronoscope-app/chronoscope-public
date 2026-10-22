use chronoscope::{
    engine::Engine,
    model::Dataset,
    project::Project,
    wmts::TileService,
    wmts_auth::{IdentityKind, Profile},
};
use serde_json::json;
#[test]
fn identities_stay_local_and_are_discoverable_without_pin_arguments() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().to_owned()).unwrap();
    let status = engine.invoke("wmts_auth_status", json!({})).unwrap();
    assert_eq!(status["profiles"], json!([]));
    assert_eq!(status["hardware_verified"], false);
    engine.invoke("wmts_auth_set", json!({"profile":{"origin":"https://maps.example.test/wmts","kind":"disabled","identity":""}})).unwrap();
    assert_eq!(
        engine.invoke("wmts_auth_status", json!({})).unwrap()["profiles"][0]["origin"],
        "https://maps.example.test"
    );
    for secret in ["pin", "password", "key_file", "module_path"] {
        let mut args = json!({"profile":{"origin":"https://maps.example.test","kind":"disabled","identity":""}});
        args["profile"][secret] = json!("not-accepted");
        assert!(engine.invoke("wmts_auth_set", args).is_err(), "{secret}");
    }
    let path = dir.path().join("share.chronoscope");
    engine
        .invoke("save", json!({"path":path.to_string_lossy()}))
        .unwrap();
    let file = std::fs::File::open(path).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).unwrap();
        let name = f.name().unwrap().into_owned();
        assert!(!name.contains("auth"));
        if name.ends_with(".json") {
            let mut text = String::new();
            std::io::Read::read_to_string(&mut f, &mut text).unwrap();
            assert!(!text.contains("maps.example.test"));
        }
    }
    engine.invoke("wmts_auth_reset", json!({})).unwrap();
    engine
        .invoke(
            "wmts_auth_remove",
            json!({"origin":"https://maps.example.test"}),
        )
        .unwrap();
    assert_eq!(
        engine.invoke("wmts_auth_status", json!({})).unwrap()["profiles"],
        json!([])
    );
}
#[test]
fn authenticated_capabilities_and_tiles_have_distinct_cache_namespaces() {
    let dir = tempfile::tempdir().unwrap();
    let maps = TileService::new(dir.path().join("wmts-cache")).unwrap();
    let url = "https://maps.example.test/wmts";
    let public = maps.metadata_key(url).unwrap();
    maps.auth
        .set(
            Profile {
                origin: url.into(),
                kind: IdentityKind::MacosKeychain,
                identity: "Auth A".into(),
            },
            false,
        )
        .unwrap();
    let first = maps.metadata_key(url).unwrap();
    assert_ne!(public, first);
    maps.auth
        .set(
            Profile {
                origin: url.into(),
                kind: IdentityKind::MacosKeychain,
                identity: "Auth B".into(),
            },
            false,
        )
        .unwrap();
    let second = maps.metadata_key(url).unwrap();
    assert_ne!(first, second);
    maps.auth.remove(url).unwrap();
    assert_eq!(maps.metadata_key(url).unwrap(), public);
}

#[test]
fn remote_resource_urls_cannot_overflow_native_request_pipes() {
    let dir = tempfile::tempdir().unwrap();
    let maps = TileService::new(dir.path().join("wmts-cache")).unwrap();
    for url in [
        format!("https://maps.example.test/{}", "x".repeat(4096)),
        "https://maps.example.test/\nresource".into(),
    ] {
        assert!(maps
            .fetch(&url, 1024, std::time::Duration::from_secs(10))
            .unwrap_err()
            .contains("4096 bytes"));
    }
    assert_eq!(maps.requests.load(std::sync::atomic::Ordering::Relaxed), 0);
}
