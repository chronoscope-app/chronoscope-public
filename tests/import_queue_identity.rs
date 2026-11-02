use chronoscope::{engine::Engine, project::Project};
use serde_json::json;
#[test]
fn import_commit_returns_its_new_identity_for_a_reviewed_queue() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::new(Default::default()), dir.path().join("work")).unwrap();
    let path = dir.path().join("events.csv");
    std::fs::write(
        &path,
        "timestamp,entity,latitude,longitude\n2026-01-01T00:00:00Z,A,40,-74\n",
    )
    .unwrap();
    let mut prior =
        engine.invoke("snapshot", json!({"compact":true})).unwrap()["workspace_id"].clone();
    for expected_count in 1..=2 {
        let preview = engine
            .invoke(
                "import_preview",
                json!({"path":path,"expected_workspace":prior}),
            )
            .unwrap();
        let result = engine
            .invoke(
                "import_commit",
                json!({"import_id":preview["import_id"],"append":true,"expected_workspace":prior}),
            )
            .unwrap();
        let snapshot = engine.invoke("snapshot", json!({"compact":true})).unwrap();
        assert_eq!(result["workspace_id"], snapshot["workspace_id"]);
        assert_ne!(result["workspace_id"], prior);
        assert_eq!(snapshot["count"], expected_count);
        assert!(engine
            .invoke(
                "import_preview",
                json!({"path":path,"expected_workspace":prior})
            )
            .is_err());
        prior = result["workspace_id"].clone();
    }
}
