use chronoscope::{engine::Engine, model::Dataset, project::Project, wmts_auth::platform_kind};
use serde_json::json;
fn engine(path: &std::path::Path) -> Engine {
    Engine::new(Project::new(Dataset::default()), path.into()).unwrap()
}
#[test]
fn si_certificate_settings_stay_local_and_separate_from_map_authentication() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let profile =
        json!({"origin":"https://SI.example.test:443/v1", "kind":"disabled", "identity":""});
    e.invoke("si_configure", json!({"url":"https://si.example.test/v1", "model":"fixture", "api_key":"memory-only-secret", "client_certificate":profile})).unwrap();
    let status = e.invoke("si_status", json!({})).unwrap();
    assert_eq!(
        status["client_certificate"]["origin"],
        "https://si.example.test"
    );
    assert_eq!(status["client_certificate_kind"], json!(platform_kind()));
    assert_eq!(
        status["automatic_client_certificate"],
        cfg!(any(target_os = "macos", target_os = "windows"))
    );
    assert_eq!(
        e.invoke("wmts_auth_status", json!({})).unwrap()["profiles"],
        json!([])
    );
    let saved = std::fs::read_to_string(dir.path().join("si-connection.json")).unwrap();
    assert!(!saved.contains("memory-only-secret"));
    let other = tempfile::tempdir().unwrap();
    e.invoke(
        "save",
        json!({"path":other.path().join("portable.chronoscope")}),
    )
    .unwrap();
    let reopened = engine(other.path());
    reopened
        .invoke(
            "open",
            json!({"path":other.path().join("portable.chronoscope")}),
        )
        .unwrap();
    assert!(reopened.invoke("si_status", json!({})).unwrap()["client_certificate"].is_null());
    e.invoke("si_disconnect", json!({})).unwrap();
    assert!(!e.invoke("si_status", json!({})).unwrap()["key_present"]
        .as_bool()
        .unwrap());
    e.invoke(
        "si_configure",
        json!({"url":"https://other.example.test/v1","model":"fixture"}),
    )
    .unwrap();
    assert!(e.invoke("si_status", json!({})).unwrap()["client_certificate"].is_null());
}
#[test]
fn si_certificate_configuration_rejects_cross_origin_and_secret_references() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let base = json!({"url":"https://si.example.test/v1", "model":"fixture", "client_certificate":{"origin":"https://other.example.test","kind":"disabled","identity":""}});
    assert!(e
        .invoke("si_configure", base.clone())
        .unwrap_err()
        .contains("origin"));
    for name in ["pin", "password", "key_file", "module_path"] {
        let mut args = base.clone();
        args["client_certificate"]["origin"] = json!("https://si.example.test");
        args["client_certificate"][name] = json!("secret");
        assert!(e.invoke("si_configure", args).is_err(), "{name}");
    }
    for uri in [
        "pkcs11:id=%01;type=cert?pin-value=1234",
        "pkcs11:id=%01;type=cert;module-path=/tmp/module",
    ] {
        let mut args = base.clone();
        args["client_certificate"] =
            json!({"origin":"https://si.example.test","kind":"pkcs11","identity":uri});
        assert!(e.invoke("si_configure", args).is_err());
    }
    let mut http = base;
    http["url"] = json!("http://localhost:3000/v1");
    assert!(e.invoke("si_configure", http).is_err());
}
