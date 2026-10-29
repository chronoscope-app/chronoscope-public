use super::*;
use crate::operation;
use std::sync::mpsc;
use std::time::Duration;

fn setup() -> (tempfile::TempDir, Engine) {
    let dir = tempfile::tempdir().unwrap();
    let mut data = crate::demo::dataset();
    data.events.truncate(32);
    for (i, event) in data.events.iter_mut().enumerate() {
        event.value = Some(if i == 31 { 999. } else { (i % 5) as f64 });
    }
    let engine = Engine::new(Project::new(data), dir.path().join("profile")).unwrap();
    (dir, engine)
}

fn arguments(engine: &Engine, kind: &str) -> Value {
    if kind != "pattern_members" {
        return json!({});
    }
    let scan = engine
        .pattern_scan(json!({"config":{"fields":["value"]}}))
        .unwrap();
    let finding = scan["report"]["findings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["kind"] == "outliers")
        .unwrap();
    json!({"pattern_scan_id":scan["scan_id"],"pattern_finding_id":finding["id"]})
}

fn read(engine: &Engine, kind: &str, args: &Value) -> Result<Value, String> {
    match kind {
        "fields" => engine.field_profile(json!({"fields":["value"],"scope":"all"})),
        "chart" => engine.chart_invoke(json!({"config":{}})),
        "pattern" => engine.pattern_scan(json!({"config":{"fields":["value"]}})),
        "cached_pattern" => engine.pattern_scan(json!({"cached_only":true})),
        "pattern_members" => engine
            .pattern_members(args)
            .map(|(ids, revision)| json!({"ids":ids,"revision":revision})),
        _ => unreachable!(),
    }
}

#[test]
fn queued_analysis_rejects_replacement_workspace() {
    for kind in [
        "fields",
        "chart",
        "pattern",
        "cached_pattern",
        "pattern_members",
    ] {
        let (dir, engine) = setup();
        let args = arguments(&engine, kind);
        let workspace = engine.workspace_identity().unwrap();
        let worker = engine.analytics_worker.lock().unwrap();
        let replacement = dir.path().join("replacement.json");
        std::fs::write(&replacement, serde_json::to_vec(&Project::empty()).unwrap()).unwrap();
        let reader = engine.clone();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        // Reproduce invoke_inner's successful entry check, then deterministically
        // replace the workspace before the detached read can pin its SQL view.
        let thread = std::thread::spawn(move || {
            operation::with_workspace(workspace, || {
                reader.check_workspace().unwrap();
                entered_tx.send(()).unwrap();
                resume_rx.recv_timeout(Duration::from_secs(2)).unwrap();
                read(&reader, kind, &args)
            })
        });
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        engine.invoke("open", json!({"path":replacement})).unwrap();
        resume_tx.send(()).unwrap();
        drop(worker);
        let result = thread.join().unwrap();
        assert!(
            matches!(result, Err(ref e) if e.starts_with("CONFLICT:")),
            "{kind}: {result:?}"
        );
    }
}

#[test]
fn detached_analysis_waits_for_atomic_operation_boundary() {
    for kind in [
        "fields",
        "chart",
        "pattern",
        "cached_pattern",
        "pattern_members",
    ] {
        let (_dir, engine) = setup();
        let args = arguments(&engine, kind);
        // A batch owns this gate until its SQLite transaction and metadata are
        // committed together. Detached readers must not inspect intermediate state.
        let gate = engine.operation.lock().unwrap();
        let reader = engine.clone();
        let (tx, rx) = mpsc::channel();
        let thread = std::thread::spawn(move || tx.send(read(&reader, kind, &args)).unwrap());
        let early = rx.recv_timeout(Duration::from_millis(250));
        drop(gate);
        thread.join().unwrap();
        assert!(
            matches!(early, Err(mpsc::RecvTimeoutError::Timeout)),
            "{kind} read through an active operation: {early:?}"
        );
        assert!(rx.recv_timeout(Duration::from_secs(2)).unwrap().is_ok());
    }
}
