use super::*;
use crate::{model::Filter, operation, project::Project};
use serde_json::json;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc, Arc,
};
use std::time::{Duration, Instant};

fn setup() -> (tempfile::TempDir, Engine) {
    let dir = tempfile::tempdir().unwrap();
    let mut data = crate::demo::dataset();
    data.events.truncate(3);
    let engine = Engine::new(Project::new(data), dir.path().join("profile")).unwrap();
    (dir, engine)
}

fn snapshot(engine: &Engine, generation: &str, render: bool) -> Value {
    engine
        .invoke(
            "view_snapshot_v1",
            json!({
                "version":1,"generation":generation,"include_render":render,
                "max_points":100,"selection_ids":["1","2"]
            }),
        )
        .unwrap()
}

fn context(cancelled: Arc<AtomicBool>) -> operation::Context {
    operation::Context {
        cancelled,
        progress: None,
        scope: None,
    }
}

#[test]
fn real_snapshot_and_current_head_match_without_request_generation() {
    let (_dir, engine) = setup();
    let full = snapshot(&engine, "render-A", true);
    let metadata = snapshot(&engine, "metadata-B", false);
    let identity = CanonicalViewIdentity::from_snapshot(&full).unwrap();
    assert_eq!(
        identity,
        CanonicalViewIdentity::from_snapshot(&metadata).unwrap()
    );
    assert_eq!(identity, engine.current_view_identity().unwrap());
    assert_eq!(
        engine
            .with_current_view_identity(&identity, || Ok(123))
            .unwrap(),
        123
    );
    assert_eq!(full["stamp"]["scene_generation"], "render-A");
    assert_eq!(metadata["stamp"]["scene_generation"], "metadata-B");
    let mut keys: Vec<_> = full["stamp"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "data_revision",
            "filter_signature",
            "revision",
            "scene_generation",
            "selection_revision",
            "store_id"
        ]
    );
    for key in keys {
        assert!(full["stamp"][key].is_string());
    }
    assert_eq!(
        identity.workspace_id(),
        full["snapshot"]["workspace_id"].as_str().unwrap()
    );
    assert_eq!(
        identity.store_id(),
        full["stamp"]["store_id"].as_str().unwrap()
    );
    assert_eq!(
        identity.revision(),
        full["stamp"]["revision"].as_str().unwrap()
    );
    assert_eq!(
        identity.data_revision(),
        full["stamp"]["data_revision"].as_str().unwrap()
    );
    assert_eq!(
        identity.selection_revision(),
        full["stamp"]["selection_revision"].as_str().unwrap()
    );
    assert_eq!(
        identity.filter_signature(),
        full["stamp"]["filter_signature"].as_str().unwrap()
    );
    assert_eq!(
        serde_json::to_value(&identity).unwrap()["revision"],
        full["stamp"]["revision"]
    );
}

#[test]
fn identity_rejects_noncanonical_or_inexact_revision_fields() {
    let (_dir, engine) = setup();
    let raw = snapshot(&engine, "exact-u64", false);
    for field in ["revision", "data_revision", "selection_revision"] {
        for invalid in [
            json!(""),
            json!("00"),
            json!("01"),
            json!("+1"),
            json!("-1"),
            json!("1.0"),
            json!("1e3"),
            json!("1 "),
            json!("18446744073709551616"),
            json!(1),
            json!(1.0),
            Value::Null,
        ] {
            let mut candidate = raw.clone();
            candidate["stamp"][field] = invalid;
            assert_eq!(
                CanonicalViewIdentity::from_snapshot(&candidate)
                    .unwrap_err()
                    .code,
                ErrorCode::InvalidArgument,
                "{field}"
            );
        }
    }
    for exact in [9_007_199_254_740_993u64, u64::MAX] {
        let mut candidate = raw.clone();
        candidate["snapshot"]["revision"] = json!(exact);
        candidate["revision"] = json!(exact);
        for field in ["revision", "data_revision", "selection_revision"] {
            candidate["stamp"][field] = json!(exact.to_string());
        }
        let parsed = CanonicalViewIdentity::from_snapshot(&candidate).unwrap();
        assert_eq!(parsed.revision(), exact.to_string());
        assert_eq!(parsed.data_revision(), exact.to_string());
        assert_eq!(parsed.selection_revision(), exact.to_string());
    }
}

#[test]
fn identity_checks_workspace_hash_and_all_present_revision_envelopes() {
    let (_dir, engine) = setup();
    let raw = snapshot(&engine, "envelopes", true);
    for (pointer, value) in [
        ("/version", json!(2)),
        ("/snapshot/workspace_id", json!("another-store:1")),
        (
            "/snapshot/workspace_id",
            json!(format!("{}:01", raw["stamp"]["store_id"].as_str().unwrap())),
        ),
        ("/snapshot/revision", json!(1.0)),
        ("/stamp/store_id", json!("bad\nstore")),
        ("/stamp/filter_signature", json!("f".repeat(63))),
        ("/stamp/filter_signature", json!("g".repeat(64))),
        ("/render/revision", json!(999)),
        ("/geometries/revision", json!(999)),
    ] {
        let mut candidate = raw.clone();
        *candidate.pointer_mut(pointer).unwrap() = value;
        assert_eq!(
            CanonicalViewIdentity::from_snapshot(&candidate)
                .unwrap_err()
                .code,
            ErrorCode::InvalidArgument,
            "{pointer}"
        );
    }
    for field in ["revision", "display"] {
        let mut candidate = raw.clone();
        candidate[field] = if field == "revision" {
            json!(999)
        } else {
            json!({"revision":999})
        };
        assert_eq!(
            CanonicalViewIdentity::from_snapshot(&candidate)
                .unwrap_err()
                .code,
            ErrorCode::InvalidArgument
        );
    }
}

#[test]
fn selection_filter_and_data_changes_each_reject_stale_publication() {
    for change in ["selection", "filter", "data"] {
        let (_dir, engine) = setup();
        let mut before = engine.current_view_identity().unwrap();
        match change {
            "selection" => {
                engine.invoke("select", json!({"ids":["1"]})).unwrap();
            }
            "filter" => {
                engine.invoke("filter", json!({"filter":Filter { search:"not-present".into(), ..Default::default() }})).unwrap();
            }
            _ => {
                engine
                    .invoke("edit", json!({"id":"1","changes":{"note":"edited value"}}))
                    .unwrap();
            }
        }
        let after = engine.current_view_identity().unwrap();
        match change {
            "selection" => assert_ne!(before.selection_revision(), after.selection_revision()),
            "filter" => assert_ne!(before.filter_signature(), after.filter_signature()),
            _ => assert_ne!(before.data_revision(), after.data_revision()),
        }
        // Isolate each field from the ordinary revision rejection. This is a
        // fabricated EXPECTATION only, never an emitted/modified Engine packet.
        before.revision.clone_from(&after.revision);
        let called = AtomicBool::new(false);
        let error = engine
            .with_current_view_identity(&before, || {
                called.store(true, Ordering::SeqCst);
                Ok(())
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::Conflict);
        assert!(!called.load(Ordering::SeqCst));
    }
}

#[test]
fn undo_of_open_restores_store_but_not_document_epoch_authority() {
    let (dir, engine) = setup();
    let mut before = engine.current_view_identity().unwrap();
    let path = dir.path().join("replacement.json");
    std::fs::write(&path, serde_json::to_vec(&Project::empty()).unwrap()).unwrap();
    engine.invoke("open", json!({"path":path})).unwrap();
    engine.invoke("undo", json!({})).unwrap();
    let after = engine.current_view_identity().unwrap();
    assert_eq!(before.store_id(), after.store_id());
    assert_ne!(before.workspace_id(), after.workspace_id());
    before.revision.clone_from(&after.revision);
    before.data_revision.clone_from(&after.data_revision);
    before
        .selection_revision
        .clone_from(&after.selection_revision);
    assert_eq!(before.filter_signature(), after.filter_signature());
    assert_eq!(
        engine
            .with_current_view_identity(&before, || Ok(()))
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
}

#[test]
fn workspace_scoped_operations_cannot_read_or_publish_another_document() {
    let (_dir, engine) = setup();
    let expected = engine.current_view_identity().unwrap();
    operation::with_workspace(expected.workspace_id().into(), || {
        assert_eq!(engine.current_view_identity().unwrap(), expected);
    });
    let called = AtomicBool::new(false);
    operation::with_workspace("other-document:1".into(), || {
        assert_eq!(
            engine.current_view_identity().unwrap_err().code,
            ErrorCode::Conflict
        );
        assert_eq!(
            engine
                .with_current_view_identity(&expected, || {
                    called.store(true, Ordering::SeqCst);
                    Ok(())
                })
                .unwrap_err()
                .code,
            ErrorCode::Conflict
        );
    });
    assert!(!called.load(Ordering::SeqCst));
}

#[test]
fn closure_errors_release_locks_and_preserve_the_typed_failure() {
    let (_dir, engine) = setup();
    let expected = engine.current_view_identity().unwrap();
    let error = engine
        .with_current_view_identity(&expected, || {
            Err::<(), _>(EngineError::new(
                ErrorCode::ScopeDenied,
                "caller transaction rejected",
            ))
        })
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::ScopeDenied);
    assert_eq!(error.message, "caller transaction rejected");
    assert_eq!(engine.current_view_identity().unwrap(), expected);
    assert_eq!(
        engine
            .with_current_view_identity(&expected, || Ok(5))
            .unwrap(),
        5
    );
}

#[test]
fn identity_and_publication_do_not_call_observer_or_progress_callbacks() {
    let (_dir, engine) = setup();
    let callbacks = Arc::new(AtomicUsize::new(0));
    let observed = callbacks.clone();
    engine
        .set_observer(Arc::new(move |_| {
            observed.fetch_add(1, Ordering::SeqCst);
        }))
        .unwrap();
    let progress = callbacks.clone();
    let mut operation = context(Arc::new(AtomicBool::new(false)));
    operation.progress = Some(Arc::new(move |_, _, _| {
        progress.fetch_add(1, Ordering::SeqCst);
    }));
    operation::with_context(operation, || {
        let identity = engine.current_view_identity().unwrap();
        engine
            .with_current_view_identity(&identity, || Ok(()))
            .unwrap();
    });
    assert_eq!(callbacks.load(Ordering::SeqCst), 0);
}

#[test]
fn publication_holds_operation_and_state_through_commit_before_real_writer() {
    let (_dir, engine) = setup();
    let expected = engine.current_view_identity().unwrap();
    let (start_tx, start_rx) = mpsc::channel();
    let (attempt_tx, attempt_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let writer = engine.clone();
    let thread = std::thread::spawn(move || {
        start_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(matches!(
            writer.operation.try_lock(),
            Err(TryLockError::WouldBlock)
        ));
        assert!(matches!(
            writer.state.try_lock(),
            Err(TryLockError::WouldBlock)
        ));
        attempt_tx.send(()).unwrap();
        let result = writer.invoke(
            "edit",
            json!({"id":"1","changes":{"note":"after publication"}}),
        );
        done_tx.send(result).unwrap();
    });
    let committed = engine
        .with_current_view_identity(&expected, || {
            start_tx.send(()).unwrap();
            attempt_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            assert!(matches!(done_rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
            Ok("committed before writer")
        })
        .unwrap();
    assert_eq!(committed, "committed before writer");
    done_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .unwrap();
    thread.join().unwrap();
    assert_ne!(
        engine.current_view_identity().unwrap().data_revision(),
        expected.data_revision()
    );
}

#[test]
fn detached_state_contender_cannot_enter_during_publication() {
    let (_dir, engine) = setup();
    let expected = engine.current_view_identity().unwrap();
    let (start_tx, start_rx) = mpsc::channel();
    let (blocked_tx, blocked_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let detached = engine.clone();
    let thread = std::thread::spawn(move || {
        start_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(matches!(
            detached.state.try_lock(),
            Err(TryLockError::WouldBlock)
        ));
        blocked_tx.send(()).unwrap();
        // Models a detached state's lock boundary without mutating source data.
        let _state = detached.state.lock().unwrap();
        done_tx.send(()).unwrap();
    });
    engine
        .with_current_view_identity(&expected, || {
            start_tx.send(()).unwrap();
            blocked_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            assert!(matches!(done_rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
            Ok(())
        })
        .unwrap();
    done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    thread.join().unwrap();
}

#[test]
fn deadlines_interrupt_both_operation_and_state_mutex_waits() {
    for operation_lock in [true, false] {
        let (_dir, engine) = setup();
        let operation_guard = operation_lock.then(|| engine.operation.lock().unwrap());
        let state_guard = (!operation_lock).then(|| engine.state.lock().unwrap());
        let reader = engine.clone();
        let start = Instant::now();
        let result = std::thread::spawn(move || {
            operation::with_deadline(Duration::from_millis(30), || reader.current_view_identity())
        })
        .join()
        .unwrap();
        assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
        assert!(start.elapsed() < Duration::from_secs(2));
        drop((operation_guard, state_guard));
        engine.current_view_identity().unwrap();
    }
}

#[test]
fn cancellation_interrupts_both_mutex_waits_without_calling_publication() {
    for operation_lock in [true, false] {
        let (_dir, engine) = setup();
        let expected = engine.current_view_identity().unwrap();
        let operation_guard = operation_lock.then(|| engine.operation.lock().unwrap());
        let state_guard = (!operation_lock).then(|| engine.state.lock().unwrap());
        let canceled = Arc::new(AtomicBool::new(false));
        let request = context(canceled.clone());
        let reader = engine.clone();
        let called = Arc::new(AtomicBool::new(false));
        let publication = called.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            operation::with_context(request, || {
                started_tx.send(()).unwrap();
                reader.with_current_view_identity(&expected, || {
                    publication.store(true, Ordering::SeqCst);
                    Ok(())
                })
            })
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        canceled.store(true, Ordering::SeqCst);
        assert_eq!(
            thread.join().unwrap().unwrap_err().code,
            ErrorCode::Cancelled
        );
        assert!(!called.load(Ordering::SeqCst));
        drop((operation_guard, state_guard));
    }
}

#[test]
fn cancellation_after_successful_commit_does_not_relabel_success() {
    let (_dir, engine) = setup();
    let expected = engine.current_view_identity().unwrap();
    let canceled = Arc::new(AtomicBool::new(false));
    operation::with_context(context(canceled.clone()), || {
        assert_eq!(
            engine
                .with_current_view_identity(&expected, || {
                    canceled.store(true, Ordering::SeqCst);
                    Ok(9)
                })
                .unwrap(),
            9
        );
        assert_eq!(
            engine.current_view_identity().unwrap_err().code,
            ErrorCode::Cancelled
        );
    });
}

#[test]
fn poisoned_mutexes_are_typed_unavailable_and_never_call_publication() {
    for operation_lock in [true, false] {
        let (_dir, engine) = setup();
        let expected = engine.current_view_identity().unwrap();
        let poisoned = engine.clone();
        let panic = std::thread::spawn(move || {
            if operation_lock {
                let _lock = poisoned.operation.lock().unwrap();
                panic!("owned operation poison");
            } else {
                let _lock = poisoned.state.lock().unwrap();
                panic!("owned state poison");
            }
        })
        .join();
        assert!(panic.is_err());
        assert_eq!(
            engine.current_view_identity().unwrap_err().code,
            ErrorCode::Unavailable
        );
        let called = AtomicBool::new(false);
        assert_eq!(
            engine
                .with_current_view_identity(&expected, || {
                    called.store(true, Ordering::SeqCst);
                    Ok(())
                })
                .unwrap_err()
                .code,
            ErrorCode::Unavailable
        );
        assert!(!called.load(Ordering::SeqCst));
    }
}
