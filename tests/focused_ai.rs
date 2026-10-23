use chronoscope::{engine::Engine, project::Project};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
    time::{Duration, Instant},
};
fn engine(dir: &std::path::Path) -> Engine {
    let mut data = chronoscope::demo::dataset();
    data.events.truncate(3);
    for (i, e) in data.events.iter_mut().enumerate() {
        e.id = i as u64 + 1;
        e.note = if i == 0 {
            "Coastal survey recorded nesting seabirds.".into()
        } else {
            String::new()
        };
    }
    data.events[0].tags.insert("Reviewed".into());
    Engine::new(Project::new(data), dir.into()).unwrap()
}
fn read_request(stream: &mut std::net::TcpStream) -> Value {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut data = Vec::new();
    let mut buf = [0; 8192];
    loop {
        let n = stream.read(&mut buf).unwrap();
        assert!(n > 0);
        data.extend_from_slice(&buf[..n]);
        if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&data[..pos]);
            let size: usize = headers
                .lines()
                .find_map(|l| {
                    l.to_lowercase()
                        .strip_prefix("content-length:")
                        .map(|s| s.trim().parse().unwrap())
                })
                .unwrap();
            if data.len() >= pos + 4 + size {
                return serde_json::from_slice(&data[pos + 4..pos + 4 + size]).unwrap();
            }
        }
    }
}
fn reply(stream: &mut std::net::TcpStream, content: Value) {
    let body = json!({"choices":[{"message":{"role":"assistant","content":content.to_string()}}]})
        .to_string();
    write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
}
fn snapshot(e: &Engine) -> Value {
    e.invoke(
        "snapshot",
        json!({"compact":true,"include_statistics":false}),
    )
    .unwrap()
}
#[test]
fn focused_model_requests_are_tool_free_and_preserve_evidence_and_tags() {
    let d = tempfile::tempdir().unwrap();
    let e = engine(d.path());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        for i in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let req = read_request(&mut stream);
            assert!(req.get("tools").is_none());
            assert_eq!(req["messages"].as_array().unwrap().len(), 2);
            assert_eq!(req["temperature"], 0);
            let body = req["messages"][1]["content"].as_str().unwrap();
            if i == 0 {
                assert!(body.contains("observations"));
                assert!(body.contains("median"));
                assert!(!body.contains("disk-backed"));
                assert!(body.contains("findings"));
                assert!(body.contains("recorded_value"));
                reply(
                    &mut stream,
                    json!({"text":"This result summarizes the recorded values. It does not establish a cause."}),
                );
            } else {
                assert!(body.contains("nesting seabirds"));
                reply(
                    &mut stream,
                    json!({"tags":["seabirds","coastal survey","seabirds"]}),
                );
            }
        }
    });
    e.invoke("si_configure", json!({"url":url,"model":"fixture"}))
        .unwrap();
    let artifact=e.invoke("analytics_run",json!({"plan":{"capability":"quantiles","scope":"all","parameters":{"field":"value","probabilities":[0.5]}}})).unwrap();
    let explained=e.invoke("assist_explain",json!({"provider":"connected","source":{"kind":"analysis","result_id":artifact["result_id"]}})).unwrap();
    chronoscope::schema::validate_output("assist_explain", &explained).unwrap();
    assert_eq!(
        explained["source_changed"], false,
        "Saving the result alone does not make its evidence stale"
    );
    assert_eq!(explained["evidence"]["evaluated_count"], 3);
    assert_eq!(
        explained["evidence"]["scope"]["kind"]
            .as_str()
            .unwrap_or("all"),
        "all"
    );
    let s = snapshot(&e);
    let tags=e.invoke("assist_tags",json!({"provider":"connected","ids":["1","2"],"field":"note","expected_revision":s["revision"],"expected_workspace":s["workspace_id"]})).unwrap();
    chronoscope::schema::validate_output("assist_tags", &tags).unwrap();
    assert_eq!(
        tags["records"][0]["tags"],
        json!(["coastal survey", "seabirds"])
    );
    assert_eq!(tags["records"][1]["skipped"], true);
    assert_eq!(tags["skipped_count"], 1);
    assert_eq!(snapshot(&e)["revision"], s["revision"]);
    assert_eq!(
        e.invoke("events", json!({"id":"1","limit":1})).unwrap()["events"][0]["tags"],
        json!(["Reviewed"])
    );
    assert!(e.invoke("si_history", json!({})).unwrap()["messages"]
        .as_array()
        .unwrap()
        .is_empty());
    worker.join().unwrap();
}
#[test]
fn reviewed_tags_are_additive_atomic_revision_bound_and_undoable() {
    let d = tempfile::tempdir().unwrap();
    let e = engine(d.path());
    let s = snapshot(&e);
    let args = json!({"items":[{"id":"1","tags":["reviewed","Coast"]},{"id":"2","tags":["new"]}],"expected_revision":s["revision"],"expected_workspace":s["workspace_id"]});
    let applied = e.invoke("assist_tags_apply", args.clone()).unwrap();
    assert_eq!(applied["changed"], 2);
    let tags = e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["tags"].clone();
    assert_eq!(tags, json!(["Reviewed", "coast"]));
    assert!(e
        .invoke("assist_tags_apply", args)
        .unwrap_err()
        .starts_with("CONFLICT:"));
    e.invoke("undo", json!({})).unwrap();
    assert_eq!(
        e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["tags"],
        json!(["Reviewed"])
    );
    assert_eq!(
        e.invoke("events", json!({"id":"2"})).unwrap()["events"][0]["tags"],
        json!([])
    );
    let s = snapshot(&e);
    assert!(e.invoke("assist_tags_apply",json!({"items":[{"id":"1","tags":["must roll back"]},{"id":"999999","tags":["absent"]}],"expected_revision":s["revision"],"expected_workspace":s["workspace_id"]})).is_err());
    assert_eq!(snapshot(&e)["revision"], s["revision"]);
    assert_eq!(
        e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["tags"],
        json!(["Reviewed"])
    );
}
#[test]
fn malformed_tags_unknown_fields_and_workspace_conflicts_never_mutate() {
    let d = tempfile::tempdir().unwrap();
    let e = engine(d.path());
    let s = snapshot(&e);
    for tags in [json!(["bad,tag"]), json!(["\n"]), json!(["x".repeat(65)])] {
        assert!(e.invoke("assist_tags_apply",json!({"items":[{"id":"1","tags":tags}],"expected_revision":s["revision"],"expected_workspace":s["workspace_id"]})).is_err());
    }
    assert!(e.invoke("assist_tags",json!({"provider":"connected","ids":["1"],"field":"attribute:does-not-exist","expected_revision":s["revision"],"expected_workspace":s["workspace_id"]})).unwrap_err().contains("unknown"));
    assert!(e.invoke("assist_tags_apply",json!({"items":[{"id":"1","tags":["no"]}],"expected_revision":s["revision"],"expected_workspace":"another-workspace"})).is_err());
    assert_eq!(snapshot(&e)["revision"], s["revision"]);
    assert!(e.invoke("assist_tags", json!({"provider":"connected","ids":[],"field":"note","expected_revision":s["revision"],"expected_workspace":s["workspace_id"]})).is_err());
    assert!(e.invoke("assist_explain", json!({"provider":"connected","source":{"kind":"pattern","scan_id":"expired","finding_id":"absent"}})).unwrap_err().contains("expired"));
    assert!(e
        .invoke("assist_ui", json!({"action":"generate"}))
        .unwrap_err()
        .contains("explicit provider"));
}
#[test]
fn cancelling_inference_returns_promptly_and_leaves_source_untouched() {
    let d = tempfile::tempdir().unwrap();
    let e = engine(d.path());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let (seen, ready) = mpsc::channel();
    let (finish, wait) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        read_request(&mut stream);
        seen.send(()).unwrap();
        wait.recv_timeout(Duration::from_secs(10)).unwrap();
        reply(&mut stream, json!({"tags":["unused"]}));
    });
    e.invoke("si_configure", json!({"url":url,"model":"slow"}))
        .unwrap();
    let s = snapshot(&e);
    let job=e.invoke("job_start",json!({"command":"assist_tags","arguments":{"provider":"connected","ids":["1"],"field":"note","expected_revision":s["revision"],"expected_workspace":s["workspace_id"]}})).unwrap();
    ready.recv_timeout(Duration::from_secs(10)).unwrap();
    let start = Instant::now();
    e.invoke("job_cancel", json!({"job_id":job["job_id"]}))
        .unwrap();
    loop {
        let status = e
            .invoke("job_status", json!({"job_id":job["job_id"]}))
            .unwrap();
        if status["status"] == "cancelled" {
            break;
        }
        assert!(start.elapsed() < Duration::from_secs(2));
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(snapshot(&e)["revision"], s["revision"]);
    finish.send(()).unwrap();
    worker.join().unwrap();
}
