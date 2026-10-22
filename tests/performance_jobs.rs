use chronoscope::{
    engine::Engine,
    model::Dataset,
    operation::{self, Context},
    project::Project,
};
use serde_json::json;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
#[test]
fn c13_cancel_after_rename_returns_committed_receipt_and_before_rename_keeps_old_bytes() {
    for after in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("saved.chronoscope");
        std::fs::write(&path, b"previous bytes").unwrap();
        let engine = Engine::new(Project::new(Dataset::default()), dir.path().join("app")).unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = cancelled.clone();
        let result = operation::with_context(
            Context {
                cancelled,
                scope: None,
                progress: Some(Arc::new(move |_, _, message| {
                    if message
                        == if after {
                            "Committed external file"
                        } else {
                            "Committing external file"
                        }
                    {
                        flag.store(true, Ordering::SeqCst);
                    }
                })),
            },
            || engine.invoke("save", json!({"path":path})),
        );
        if after {
            let value = result.unwrap();
            assert_eq!(value["commit_receipt"]["committed"], true);
            assert_eq!(value["commit_receipt"]["cancel_requested"], true);
            assert_ne!(std::fs::read(&path).unwrap(), b"previous bytes");
        } else {
            assert!(result.unwrap_err().starts_with("CANCELLED:"));
            assert_eq!(std::fs::read(&path).unwrap(), b"previous bytes");
        }
    }
}

#[test]
fn c13_async_jobs_expose_monotonic_typed_progress_and_an_independent_commit_receipt() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().join("app")).unwrap();
    let started = engine
        .invoke(
            "job_start",
            json!({"command":"save","arguments":{"path":dir.path().join("job.chronoscope")}}),
        )
        .unwrap();
    let id = started["job_id"].clone();
    let mut sequence = 0;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let job = engine.invoke("job_result", json!({"job_id":id})).unwrap();
        let next = job["progress_event"]["sequence"].as_u64().unwrap();
        assert!(next >= sequence);
        sequence = next;
        if job["status"] == "completed" {
            assert_eq!(job["progress_event"]["phase"], "completed");
            assert_eq!(job["commit_receipt"]["committed"], true);
            assert_eq!(
                job["commit_receipt"]["store_id"].as_str().unwrap().len(),
                64
            );
            assert!(!job["commit_receipt"]
                .to_string()
                .contains(dir.path().to_str().unwrap()));
            break;
        }
        assert_ne!(job["status"], "failed", "{job}");
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    engine.invoke("job_release", json!({"job_id":id})).unwrap();
}
