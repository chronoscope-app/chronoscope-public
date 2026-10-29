use chronoscope::{
    aggregation::{Accumulator, Options},
    engine::Engine,
    model::{Dataset, Event, Filter},
    project::Project,
};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
fn event(id: u64, time: i64, lat: Option<f64>, lon: Option<f64>) -> Event {
    Event {
        altitude: None,
        location_kind: None,
        id,
        entity: "Track A".into(),
        time: time as f64,
        end: None,
        lat,
        lon,
        geometry_wkt: None,
        mgrs_precision: None,
        category: "test".into(),
        label: "Event".into(),
        value: Some(id as f64),
        related_to: String::new(),
        attrs: Default::default(),
        tags: Default::default(),
        note: String::new(),
        source: "input.csv".into(),
        source_row: id as usize + 1,
    }
}
fn engine(dir: &std::path::Path, events: Vec<Event>) -> Engine {
    Engine::new(
        Project::new(Dataset {
            name: "test".into(),
            events,
        }),
        dir.into(),
    )
    .unwrap()
}
fn mock(
    responses: Vec<Value>,
    inspect: impl Fn(usize, &Value, &str) + Send + 'static,
) -> (String, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let thread = std::thread::spawn(move || {
        for (index, response) in responses.into_iter().enumerate() {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut bytes = vec![];
            let header_end = loop {
                let mut b = [0u8; 1];
                stream.read_exact(&mut b).unwrap();
                bytes.push(b[0]);
                if bytes.ends_with(b"\r\n\r\n") {
                    break bytes.len();
                }
            };
            let header = String::from_utf8(bytes).unwrap();
            let length: usize = header
                .lines()
                .find_map(|l| {
                    l.to_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse().unwrap())
                })
                .unwrap();
            let mut body = vec![0; length];
            stream.read_exact(&mut body).unwrap();
            assert!(header_end > 0);
            let request: Value = serde_json::from_slice(&body).unwrap();
            inspect(index, &request, &header);
            let text = response.to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",text.len(),text).unwrap();
        }
    });
    (format!("http://{address}/v1"), thread)
}
fn answer(text: &str) -> Value {
    json!({"choices":[{"message":{"role":"assistant","content":text}}]})
}
fn calls(name: &str, args: Value) -> Value {
    json!({"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"tool-1","type":"function","function":{"name":format!("chronoscope_{name}"),"arguments":args.to_string()}}]}}]})
}
#[test]
fn assistant_uses_real_tools_and_never_serializes_key_or_self_management_tools() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path(), vec![event(1, 0, Some(0.), Some(0.))]);
    let (url, thread) = mock(
        vec![
            calls("select", json!({"ids":["1"]})),
            answer("Selected one event."),
        ],
        |i, r, header| {
            assert!(header.contains("/v1/chat/completions"));
            assert!(header
                .to_lowercase()
                .contains("authorization: bearer session-secret"));
            let tools = r["tools"].as_array().unwrap();
            assert!(tools
                .iter()
                .any(|t| t["function"]["name"] == "chronoscope_filter"));
            assert!(!tools
                .iter()
                .any(|t| t["function"]["name"] == "chronoscope_delete"));
            assert!(!tools
                .iter()
                .any(|t| t["function"]["name"].as_str().unwrap().contains("si_")));
            if i == 1 {
                let messages = r["messages"].as_array().unwrap();
                assert_eq!(messages.last().unwrap()["role"], "tool");
                assert!(messages.last().unwrap()["content"]
                    .as_str()
                    .unwrap()
                    .contains("1"));
            }
        },
    );
    e.invoke(
        "si_configure",
        json!({"url":url,"model":"test","api_key":"session-secret"}),
    )
    .unwrap();
    let result = e
        .invoke("si_run", json!({"prompt":"Select event 1"}))
        .unwrap();
    thread.join().unwrap();
    assert_eq!(result["tool_calls"][0]["ok"], true);
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["selected"],
        json!(["1"])
    );
    assert!(!e
        .invoke("si_status", json!({}))
        .unwrap()
        .to_string()
        .contains("session-secret"));
    let saved = dir.path().join("study.chronoscope");
    e.invoke("save", json!({"path":saved})).unwrap();
    assert!(!String::from_utf8_lossy(
        &std::fs::read(dir.path().join("si-connection.json")).unwrap()
    )
    .contains("session-secret"));
    let other = Engine::from_path(&saved, dir.path().join("other"), None).unwrap();
    assert_eq!(
        other.invoke("si_status", json!({})).unwrap()["connected"],
        false
    );
    e.invoke("si_disconnect", json!({})).unwrap();
    assert_eq!(
        e.invoke("si_status", json!({})).unwrap()["key_present"],
        false
    );
}
#[test]
fn unadvertised_tools_cannot_escalate_permissions_and_budget_is_enforced() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path(), vec![event(1, 0, Some(0.), Some(0.))]);
    let (url, thread) = mock(
        vec![
            calls("delete", json!({})),
            calls("select", json!({"ids":["1"]})),
        ],
        |_, _, _| {},
    );
    e.invoke("si_configure", json!({"url":url,"model":"test"}))
        .unwrap();
    let result = e
        .invoke("si_run", json!({"prompt":"delete all","max_steps":2}))
        .unwrap();
    thread.join().unwrap();
    assert_eq!(result["completed"], false);
    assert_eq!(result["tool_calls"][0]["ok"], false);
    assert_eq!(e.invoke("snapshot", json!({})).unwrap()["count"], 1);
    for url in [
        "http://example.com/v1",
        "https://u:p@example.com/v1",
        "https://example.com/v1?api_key=secret",
    ] {
        assert!(e
            .invoke("si_configure", json!({"url":url,"model":"test"}))
            .is_err());
    }
    let error = e
        .invoke(
            "si_configure",
            json!({"url":5,"model":"test","api_key":"SECRET"}),
        )
        .unwrap_err();
    assert!(!error.contains("SECRET"));
}
#[test]
fn assistant_edit_permission_and_cancellation_work() {
    let dir = tempfile::tempdir().unwrap();
    let e = Arc::new(engine(dir.path(), vec![event(1, 0, Some(0.), Some(0.))]));
    let (url, thread) = mock(
        vec![
            calls("edit", json!({"id":"1","changes":{"label":"Updated"}})),
            answer("Updated"),
        ],
        |_, r, _| {
            assert!(r["tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|t| t["function"]["name"] == "chronoscope_edit"));
        },
    );
    e.invoke("si_configure", json!({"url":url,"model":"test"}))
        .unwrap();
    e.invoke("si_run", json!({"prompt":"update","allow_edits":true}))
        .unwrap();
    thread.join().unwrap();
    assert_eq!(
        e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["label"],
        "Updated"
    );
    e.invoke("undo", json!({})).unwrap();
    assert_eq!(
        e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["label"],
        "Event"
    );
    let seen = Arc::new(AtomicBool::new(false));
    let mark = seen.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    let (url, thread) = mock(
        vec![calls(
            "edit",
            json!({"id":"1","changes":{"label":"Should not happen"}}),
        )],
        move |_, _, _| {
            mark.store(true, Ordering::SeqCst);
            rx.recv_timeout(Duration::from_secs(10)).unwrap();
        },
    );
    e.invoke("si_configure", json!({"url":url,"model":"test"}))
        .unwrap();
    let worker = e.clone();
    let run = std::thread::spawn(move || {
        worker.invoke("si_run", json!({"prompt":"update","allow_edits":true}))
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !seen.load(Ordering::SeqCst) {
        assert!(std::time::Instant::now() < deadline);
        std::thread::yield_now();
    }
    assert!(e
        .invoke("si_run", json!({"prompt":"overlap"}))
        .unwrap_err()
        .contains("CONFLICT"));
    e.invoke("si_cancel", json!({})).unwrap();
    tx.send(()).unwrap();
    assert!(run.join().unwrap().unwrap_err().contains("CANCELLED"));
    thread.join().unwrap();
    assert_eq!(
        e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["label"],
        "Event"
    );
}
#[test]
fn anchored_groups_handle_dateline_poles_boundaries_unknowns_and_unsorted_times() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = Accumulator::new(
        dir.path(),
        Options {
            window_minutes: 10,
            radius_m: 100.,
        },
    )
    .unwrap();
    let events = [
        event(1, 120, Some(0.), Some(179.9998)),
        event(2, 60, Some(0.), Some(-179.9998)),
        event(3, 600, Some(0.), Some(179.9998)),
        event(4, -60, Some(0.), Some(179.9998)),
        event(5, 120, None, None),
        event(6, 120, None, None),
        event(7, 0, Some(89.9999), Some(0.)),
        event(8, 60, Some(89.9999), Some(180.)),
    ];
    for e in events {
        a.push(&e).unwrap()
    }
    let result = a.preview(20).unwrap();
    assert_eq!(result["input_count"], 8);
    assert_eq!(result["group_count"], 6);
    assert_eq!(result["groups"][0]["count"], 2);
    let rep = &result["groups"][0]["representative"];
    assert_eq!(rep["lon"], 179.9998);
    assert_eq!(rep["time"], 60.);
    assert_eq!(rep["end"], 120.);
    assert_eq!(rep["value"], 1.5);
    let mut a = Accumulator::new(
        dir.path(),
        Options {
            window_minutes: 10,
            radius_m: 100.,
        },
    )
    .unwrap();
    // 0m, 78m, 156m: the third must not chain into the first anchor's group.
    for e in [
        event(1, 0, Some(0.), Some(0.)),
        event(2, 60, Some(0.), Some(0.0007)),
        event(3, 120, Some(0.), Some(0.0014)),
    ] {
        a.push(&e).unwrap()
    }
    assert_eq!(a.preview(20).unwrap()["group_count"], 2);
}
#[test]
fn aggregate_apply_preview_revision_undo_and_portable_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(
        dir.path(),
        vec![
            event(1, 0, Some(43.), Some(-79.)),
            event(2, 60, Some(43.), Some(-79.)),
            event(3, 60, None, None),
        ],
    );
    let args = json!({"aggregation":{"window_minutes":10,"radius_m":50}});
    assert_eq!(
        e.invoke("space_time_aggregate", args.clone()).unwrap()["group_count"],
        2
    );
    assert_eq!(e.invoke("snapshot", json!({})).unwrap()["count"], 3);
    assert!(e
        .invoke(
            "aggregate_apply",
            json!({"aggregation":args["aggregation"],"expected_revision":999})
        )
        .is_err());
    let mut dry = args.clone();
    dry["dry_run"] = json!(true);
    e.invoke("aggregate_apply", dry).unwrap();
    assert_eq!(e.invoke("snapshot", json!({})).unwrap()["count"], 3);
    assert_eq!(e.invoke("aggregate_apply", args).unwrap()["retained"], 2);
    let path = dir.path().join("summary.chronoscope");
    e.invoke("save", json!({"path":path})).unwrap();
    let reopened = Engine::from_path(&path, dir.path().join("reopen"), None).unwrap();
    assert_eq!(
        reopened.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["attrs"]
            ["chronoscope.aggregate.count"],
        "2"
    );
    e.invoke("undo", json!({})).unwrap();
    assert_eq!(e.invoke("snapshot", json!({})).unwrap()["count"], 3);
    e.invoke("redo", json!({})).unwrap();
    assert_eq!(e.invoke("snapshot", json!({})).unwrap()["count"], 2);
}
#[test]
fn streaming_import_aggregates_before_main_store_and_preserves_missing_locations() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("busy.csv");
    let mut file = std::fs::File::create(&path).unwrap();
    writeln!(file, "entity,timestamp,latitude,longitude,value").unwrap();
    for i in 0..20000 {
        writeln!(file, "A,2026-01-01 00:01,43,-79,{i}").unwrap();
    }
    writeln!(file, "A,2026-01-01 00:02,,,3").unwrap();
    let e = engine(dir.path(), vec![]);
    let preview = e.invoke("import_preview", json!({"path":path})).unwrap();
    let result=e.invoke("import_commit",json!({"import_id":preview["import_id"],"aggregation":{"window_minutes":10,"radius_m":50}})).unwrap();
    assert_eq!(result["accepted"], 20001);
    assert_eq!(result["retained"], 2);
    assert_eq!(result["aggregated"], 19999);
    let rows = e.invoke("query", json!({"limit":10})).unwrap();
    assert_eq!(rows["count"], 2);
    assert!((rows["events"][0]["value"].as_f64().unwrap() - 9999.5).abs() < 1e-8);
    assert!(rows["events"][1]["lat"].is_null());
}
#[test]
fn inferred_markers_keep_null_locations_use_exact_endpoints_and_hide_with_bounds() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(
        dir.path(),
        vec![
            event(1, 0, Some(0.), Some(179.)),
            event(2, 300, None, None),
            event(3, 600, Some(0.), Some(-179.)),
            event(4, 900, None, None),
        ],
    );
    let render = e.invoke("render_data", json!({"max_points":100})).unwrap();
    assert_eq!(render["inferred_ids"], json!(["2"]));
    assert_eq!(render["located_count"], 2);
    assert_eq!(render["unlocated_count"], 2);
    assert_eq!(render["inferred_markers"][0]["fraction"], 0.5);
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(render["data"].as_str().unwrap())
        .unwrap();
    let i = render["ids"]
        .as_array()
        .unwrap()
        .iter()
        .position(|id| id == "2")
        .unwrap();
    let lon = f64::from_le_bytes(bytes[i * 32..i * 32 + 8].try_into().unwrap());
    assert!((lon.abs() - 180.).abs() < 1e-10);
    assert!(e.invoke("events", json!({"id":"2"})).unwrap()["events"][0]["lat"].is_null());
    // Selecting only the missing event cannot use hidden anchors to invent a route.
    e.invoke("select", json!({"ids":["2"]})).unwrap();
    assert_eq!(
        e.invoke("render_data", json!({"selected_only":true}))
            .unwrap()["rendered_count"],
        0
    );
    let f = Filter {
        start: Some(60.0),
        ..Default::default()
    };
    e.invoke("filter", json!({"filter":f})).unwrap();
    assert_eq!(
        e.invoke("render_data", json!({})).unwrap()["inferred_ids"],
        json!([])
    );
    assert!(chronoscope::coordinates::interpolate((0., 0.), (0., 180.), 0.5).is_none());
}

#[test]
fn assistant_file_scope_and_mcp_job_contracts_are_enforced() {
    let dir = tempfile::tempdir().unwrap();
    let inside = dir.path().join("allowed");
    std::fs::create_dir(&inside).unwrap();
    let e = engine(dir.path(), vec![event(1, 0, Some(0.), Some(0.))]);
    let outside = dir.path().join("outside.chronoscope");
    e.invoke("save", json!({"path":outside})).unwrap();
    let (url, thread) = mock(
        vec![
            calls("open", json!({"path":outside})),
            answer("File outside allowed folder."),
        ],
        |_, r, _| {
            assert!(r["tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|t| t["function"]["name"] == "chronoscope_open"));
        },
    );
    e.invoke(
        "si_configure",
        json!({"url":url,"model":"test","root":inside}),
    )
    .unwrap();
    let result = e
        .invoke(
            "si_run",
            json!({"prompt":"open outside root","allow_edits":true}),
        )
        .unwrap();
    thread.join().unwrap();
    assert_eq!(result["tool_calls"][0]["ok"], false);
    assert!(result["tool_calls"][0]["error"]
        .as_str()
        .unwrap()
        .contains("outside"));
    let tools = chronoscope::mcp::tools();
    let job = tools
        .iter()
        .find(|t| t["name"] == "chronoscope_job_start")
        .unwrap();
    let validator = jsonschema::validator_for(&job["inputSchema"]).unwrap();
    assert!(validator
        .is_valid(&json!({"command":"si_run","arguments":{"prompt":"Inspect current data"}})));
    assert!(!validator
        .is_valid(&json!({"command":"si_run","arguments":{"prompt":"Inspect","unexpected":true}})));
    for command in ["si_status", "space_time_aggregate"] {
        let args = if command == "si_status" {
            json!({})
        } else {
            json!({"aggregation":{"window_minutes":10,"radius_m":50}})
        };
        let value = e.invoke(command, args).unwrap();
        let schema = chronoscope::schema::output_schema(command);
        assert!(jsonschema::validator_for(&schema).unwrap().is_valid(&value));
    }
}
#[test]
fn aggregation_partitioning_radius_and_preview_limits_are_honest() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = Accumulator::new(
        dir.path(),
        Options {
            window_minutes: 1,
            radius_m: 100.,
        },
    )
    .unwrap();
    let mut second = event(2, 0, Some(0.), Some(0.));
    second.entity = "B".into();
    let mut third = event(3, 0, Some(0.), Some(0.));
    third.source = "other.csv".into();
    let mut fourth = event(4, 0, Some(0.), Some(0.));
    fourth.category = "other".into();
    // PROJ/GeographicLib equatorial distance: 0.0009 degrees is 100.18754m.
    for e in [
        event(1, 0, Some(0.), Some(0.)),
        second,
        third,
        fourth,
        event(5, 0, Some(0.), Some(0.0009)),
    ] {
        a.push(&e).unwrap()
    }
    let result = a.preview(1).unwrap();
    assert_eq!(result["group_count"], 5);
    assert_eq!(result["groups"].as_array().unwrap().len(), 1);
    assert_eq!(result["limited"], true);
    let mut summary = event(6, 0, Some(0.), Some(0.));
    summary
        .attrs
        .insert("chronoscope.aggregate.count".into(), "5".into());
    assert!(a
        .push(&summary)
        .unwrap_err()
        .contains("already contains summaries"));
    assert!(chronoscope::coordinates::interpolate((90., 30.), (-90., 70.), 0.5).is_none());
}
#[test]
fn inferred_markers_obey_total_budget_without_early_sampling_when_data_fits() {
    let dir = tempfile::tempdir().unwrap();
    let mut events = vec![event(1, 0, Some(43.), Some(-79.))];
    for i in 2..=61 {
        events.push(event(i, (i as i64 - 1) * 60, None, None));
    }
    events.push(event(62, 3660, Some(43.01), Some(-79.01)));
    let e = engine(dir.path(), events);
    let render = e.invoke("render_data", json!({"max_points":100})).unwrap();
    assert_eq!(render["rendered_count"], 62);
    assert_eq!(render["inferred_ids"].as_array().unwrap().len(), 60);
    assert_eq!(render["lod"], false);
}

#[test]
fn mcp_cannot_widen_the_assistants_configured_file_root() {
    let dir = tempfile::tempdir().unwrap();
    let narrow = dir.path().join("assistant");
    std::fs::create_dir(&narrow).unwrap();
    let e = engine(
        &dir.path().join("data"),
        vec![event(1, 0, Some(0.), Some(0.))],
    );
    let outside = dir.path().join("outside.csv");
    let (url, thread) = mock(
        vec![calls("export", json!({"path":outside})), answer("Denied")],
        |i, r, _| {
            if i == 1 {
                assert!(r["messages"].as_array().unwrap().last().unwrap()["content"]
                    .as_str()
                    .unwrap()
                    .contains("scope"));
            }
        },
    );
    e.invoke(
        "si_configure",
        json!({"url":url,"model":"fixture","root":narrow}),
    )
    .unwrap();
    let result=chronoscope::mcp::handle(&e,dir.path(),json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"chronoscope_si_run","arguments":{"prompt":"Export outside","allow_edits":true}}})).unwrap();
    assert_ne!(result["result"]["isError"], true, "{result}");
    thread.join().unwrap();
    assert_eq!(
        result["result"]["structuredContent"]["tool_calls"][0]["ok"],
        false
    );
    assert!(!outside.exists());
}

#[test]
fn si_chat_remembers_followups_clears_and_keeps_permissions_separate() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path(), vec![event(1, 0, Some(0.), Some(0.))]);
    let (url, thread) = mock(
        vec![
            answer("First answer."),
            answer("Follow-up answer."),
            answer("Fresh answer."),
        ],
        |index, body, _| {
            let messages = body["messages"].as_array().unwrap();
            let history: Vec<_> = messages.iter().filter(|m| m["role"] != "system").collect();
            if index == 1 {
                assert_eq!(history.len(), 3);
                assert_eq!(history[0]["content"], "Remember this question");
                assert_eq!(history[1]["content"], "First answer.");
                assert_eq!(history[2]["content"], "And the follow-up?");
            } else {
                assert_eq!(history.len(), 1);
            }
            assert!(!body["tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|t| t["function"]["name"]
                    .as_str()
                    .unwrap()
                    .starts_with("chronoscope_si_")));
        },
    );
    e.invoke(
        "si_configure",
        json!({"url":url,"model":"fixture","api_key":"secret-only-in-memory"}),
    )
    .unwrap();
    e.invoke("si_run", json!({"prompt":"Remember this question"}))
        .unwrap();
    let history = e.invoke("si_history", json!({})).unwrap();
    assert_eq!(history["messages"].as_array().unwrap().len(), 2);
    e.invoke("si_permissions", json!({"root":dir.path()}))
        .unwrap();
    assert!(e.invoke("si_status", json!({})).unwrap()["key_present"]
        .as_bool()
        .unwrap());
    e.invoke("si_run", json!({"prompt":"And the follow-up?"}))
        .unwrap();
    e.invoke("si_clear", json!({})).unwrap();
    e.invoke("si_run", json!({"prompt":"A new conversation"}))
        .unwrap();
    thread.join().unwrap();
    e.invoke("si_disconnect", json!({})).unwrap();
    assert!(e.invoke("si_history", json!({})).unwrap()["messages"]
        .as_array()
        .unwrap()
        .is_empty());
    let persisted = std::fs::read_to_string(dir.path().join("si-connection.json")).unwrap();
    assert!(!persisted.contains("secret-only-in-memory"));
    assert!(!persisted.contains("Remember this question"));
    assert_eq!(
        serde_json::from_str::<Value>(&persisted).unwrap()["root"],
        Value::Null
    );
}

#[test]
fn si_history_is_bounded_and_reconfigure_forgets_it() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path(), vec![]);
    let (url, thread) = mock(
        (0..20).map(|_| answer(&"é".repeat(20000))).collect(),
        |_, body, _| {
            assert!(serde_json::to_vec(&body["messages"]).unwrap().len() < 256 * 1024);
        },
    );
    e.invoke("si_configure", json!({"url":url,"model":"fixture"}))
        .unwrap();
    for _ in 0..20 {
        e.invoke("si_run", json!({"prompt":"continue"})).unwrap();
    }
    thread.join().unwrap();
    let history = e.invoke("si_history", json!({})).unwrap();
    assert!(history["messages"].as_array().unwrap().len() <= 32);
    assert!(serde_json::to_vec(&history["messages"]).unwrap().len() <= 98304);
    assert!(history.to_string().contains("History excerpt truncated"));
    e.invoke(
        "si_configure",
        json!({"url":"http://localhost:9/v1","model":"other"}),
    )
    .unwrap();
    assert_eq!(
        e.invoke("si_history", json!({})).unwrap()["messages"],
        json!([])
    );
}

#[test]
fn legacy_assistant_names_work_without_being_advertised() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path(), vec![]);
    assert_eq!(
        e.invoke("ai_status", json!({})).unwrap()["connected"],
        false
    );
    assert!(chronoscope::schema::command_schema("ai_run").is_some());
    let names: Vec<_> = chronoscope::mcp::tools()
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_owned())
        .collect();
    assert!(names.contains(&"chronoscope_si_run".into()));
    assert!(!names.iter().any(|n| n.starts_with("chronoscope_ai_")));
    let reply = chronoscope::mcp::handle(&e, dir.path(), json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"chronoscope_ai_status","arguments":{}}})).unwrap();
    assert_ne!(reply["result"]["isError"], true);
    assert!(reply.get("error").is_none());
}

#[test]
fn linked_selection_reveals_exact_sorted_page_and_respects_scope() {
    let dir = tempfile::tempdir().unwrap();
    let mut events: Vec<_> = (1..=151)
        .map(|id| event(id, id as i64 * 60, Some(0.), Some(0.)))
        .collect();
    events[150].id = u64::MAX;
    events[150].source = "other.csv".into();
    let e = engine(dir.path(), events);
    let id = u64::MAX.to_string();
    e.invoke("select", json!({"ids":[id]})).unwrap();
    let view = e.invoke("view_snapshot_v1", json!({"version":1,"generation":"1","page":{"command":"attribute_table","args":{"sort_by":"time","limit":50,"reveal_id":id}}})).unwrap();
    assert_eq!(view["page"]["offset"], 150);
    assert_eq!(view["page"]["reveal_found"], true);
    assert_eq!(view["page"]["events"][0]["id"], id);
    assert!(view["selected"].as_array().unwrap().contains(&json!(id)));
    let descending = e
        .invoke(
            "attribute_table",
            json!({"sort_by":"time","descending":true,"limit":50,"reveal_id":"1"}),
        )
        .unwrap();
    assert_eq!(descending["offset"], 150);
    assert_eq!(descending["events"][0]["id"], "1");
    let absent = e
        .invoke(
            "attribute_table",
            json!({"source":"input.csv","limit":50,"reveal_id":id,"offset":50}),
        )
        .unwrap();
    assert_eq!(absent["reveal_found"], false);
    assert_eq!(absent["offset"], 50);
    let filtered = e
        .invoke(
            "attribute_table",
            json!({"apply_filter":false,"filter":{"end":60},"limit":50,"reveal_id":id}),
        )
        .unwrap();
    assert_eq!(filtered["reveal_found"], false);
    assert!(e
        .invoke("query", json!({"reveal_id":"1","cursor":"invalid"}))
        .is_err());
    // A new sort/filter or a mutation invalidates the cached ordering and its rank index.
    e.invoke("edit", json!({"id":id,"changes":{"time":-60}}))
        .unwrap();
    let moved = e
        .invoke("events", json!({"reveal_id":id,"limit":50}))
        .unwrap();
    assert_eq!(moved["offset"], 0);
    assert_eq!(moved["events"][0]["id"], id);
}

#[test]
fn assistant_discovers_and_executes_analytics_without_paging_raw_events() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(
        dir.path(),
        (1..=1000)
            .map(|i| event(i, 0, Some(0.), Some(0.)))
            .collect(),
    );
    let (url, worker) = mock(vec![
        calls("analytics_discover",json!({"search":"quantile"})),
        calls("analytics_describe",json!({"capability":"quantiles"})),
        calls("analytics_run",json!({"plan":{"capability":"quantiles","scope":"all","parameters":{"field":"value","probabilities":[0.5]}}})),
        answer("The median is calculated by Rust; open the saved analysis to inspect its evidence."),
    ], |index,request,_| {
        if index == 3 {
            let message=request["messages"].as_array().unwrap().last().unwrap();
            let evidence:Value=serde_json::from_str(message["content"].as_str().unwrap()).unwrap();
            assert_eq!(evidence["input_count"],1000);
            assert_eq!(evidence["sampled"],false);
            assert_eq!(evidence["result_id"].as_str().unwrap().len(),64);
            assert!(evidence.get("rows").is_none());
        }
    });
    e.invoke(
        "si_configure",
        json!({"url":url,"model":"test","api_key":"test-key"}),
    )
    .unwrap();
    let result=e.invoke("si_run",json!({"prompt":"Find the median measurement across all Events using the analytics engine."})).unwrap();
    worker.join().unwrap();
    assert_eq!(result["tool_calls"].as_array().unwrap().len(), 3);
    let id = &result["tool_calls"][2]["result_id"];
    assert_eq!(
        e.invoke("analytics_result", json!({"result_id":id,"section":"rows"}))
            .unwrap()["rows"][0]["value"],
        500.5
    );
}

#[test]
fn retired_apple_provider_cannot_replace_a_connected_si_service() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path(), vec![event(1, 0, Some(0.), Some(0.))]);
    e.invoke(
        "si_configure",
        json!({"url":"http://127.0.0.1:9/v1","model":"capable-model"}),
    )
    .unwrap();
    let before = e.invoke("si_status", json!({})).unwrap();
    let saved = std::fs::read(dir.path().join("si-connection.json")).unwrap();
    for args in [
        json!({"provider":"apple-local"}),
        json!({"provider":"apple-local","url":"http://127.0.0.1:9/v1","model":"test"}),
    ] {
        assert!(e.invoke("si_configure", args).is_err());
    }
    assert_eq!(e.invoke("si_status", json!({})).unwrap(), before);
    assert_eq!(
        std::fs::read(dir.path().join("si-connection.json")).unwrap(),
        saved
    );
    let capabilities = e.invoke("capabilities", json!({})).unwrap();
    assert_eq!(
        capabilities["assistant"]["providers"],
        json!(["openai-compatible"])
    );
    assert!(capabilities["assistant"].get("apple_local").is_none());
    for args in [
        json!({}),
        json!({"url":"https://example.com/v1"}),
        json!({"model":"test"}),
    ] {
        assert!(chronoscope::schema::validate("si_configure", &args).is_err());
    }
}

#[test]
fn legacy_apple_chat_preferences_open_as_an_unconfigured_service() {
    for filename in ["si-connection.json", "ai-connection.json"] {
        let dir = tempfile::tempdir().unwrap();
        let saved = br#"{"provider":"apple-local","url":"","model":"Apple on-device","root":null,"client_certificate":null}"#;
        std::fs::write(dir.path().join(filename), saved).unwrap();
        let e = engine(dir.path(), vec![]);
        let status = e.invoke("si_status", json!({})).unwrap();
        assert_eq!(status["provider"], "openai-compatible");
        assert_eq!(status["connected"], false);
        assert_eq!(status["url"], "");
        assert_eq!(status["model"], "");
        assert!(e.invoke("si_run", json!({"prompt":"hello"})).is_err());
        assert_eq!(std::fs::read(dir.path().join(filename)).unwrap(), saved);
        e.invoke(
            "si_configure",
            json!({"url":"http://127.0.0.1:9/v1","model":"new-model"}),
        )
        .unwrap();
        assert_eq!(
            e.invoke("si_status", json!({})).unwrap()["model"],
            "new-model"
        );
    }
}
