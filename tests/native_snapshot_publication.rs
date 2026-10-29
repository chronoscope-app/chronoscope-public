//! Public Rust API only: no desktop, renderer or new JSON command.
use chronoscope::{
    engine::{CanonicalViewIdentity, Engine},
    error::ErrorCode,
    project::Project,
};
use serde_json::json;
use std::sync::Mutex;

#[test]
fn public_checked_publication_keeps_document_and_original_snapshot_contract_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let mut data = chronoscope::demo::dataset();
    data.events.truncate(2);
    let engine = Engine::new(Project::new(data), dir.path().join("profile")).unwrap();
    let args = json!({"version":1,"generation":"external-rust-api","include_render":true,"max_points":100});
    // The original read reports display.cache_hit, which legitimately changes
    // on its own first repeated query. Warm that query before exact comparison.
    engine.invoke("view_snapshot_v1", args.clone()).unwrap();
    let original = engine.invoke("view_snapshot_v1", args.clone()).unwrap();
    let identity = CanonicalViewIdentity::from_snapshot(&original).unwrap();
    let project = serde_json::to_value(engine.project().unwrap()).unwrap();
    let publication = Mutex::new(None);
    engine
        .with_current_view_identity(&identity, || {
            *publication.lock().unwrap() = Some(identity.clone());
            Ok(())
        })
        .unwrap();
    assert_eq!(publication.into_inner().unwrap(), Some(identity.clone()));
    assert_eq!(engine.current_view_identity().unwrap(), identity);
    assert_eq!(engine.invoke("view_snapshot_v1", args).unwrap(), original);
    assert_eq!(
        serde_json::to_value(engine.project().unwrap()).unwrap(),
        project
    );
    for name in ["current_view_identity", "with_current_view_identity"] {
        assert!(chronoscope::command::Command::parse(name).is_none());
    }
}

#[test]
fn ordinary_engine_mutation_requires_a_new_explicit_publication_identity() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::empty(), dir.path().join("profile")).unwrap();
    let before = engine.current_view_identity().unwrap();
    engine
        .invoke("scene_sync", json!({"scene":{"mode":"map"}}))
        .unwrap();
    assert_eq!(
        engine
            .with_current_view_identity(&before, || Ok(()))
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    let model = engine
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"new-explicit-read","include_render":false}),
        )
        .unwrap();
    let fresh = CanonicalViewIdentity::from_snapshot(&model).unwrap();
    assert_ne!(fresh, before);
    engine
        .with_current_view_identity(&fresh, || Ok(()))
        .unwrap();
}
