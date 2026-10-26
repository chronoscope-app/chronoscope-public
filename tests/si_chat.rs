use chronoscope::{engine::Engine, project::Project};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::Arc,
    time::Duration,
};
fn engine(root: &std::path::Path) -> Engine {
    Engine::new(Project::new(chronoscope::demo::dataset()), root.into()).unwrap()
}
#[test]
fn apple_generation_metadata_is_valid_for_public_chat_transports() {
    let mut result = json!({"answer":"Verified actual values.","steps":1,"completed":true,"tool_calls":[],"context":{"context_tokens":8192,"input_tokens":2500,"history_messages":2,"omitted_history_messages":0,"workspace_included":true,"generation_retries":0}});
    for retries in [0, 1] {
        result["context"]["generation_retries"] = json!(retries);
        chronoscope::schema::validate_output("si_run", &result).unwrap();
    }
    result["context"]["generation_retries"] = json!(2);
    assert!(chronoscope::schema::validate_output("si_run", &result).is_err());
    result["context"]
        .as_object_mut()
        .unwrap()
        .remove("generation_retries");
    chronoscope::schema::validate_output("si_run", &result).unwrap();
}
fn mock(responses: Vec<Value>) -> (String, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let worker = std::thread::spawn(move || {
        for response in responses {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut bytes = vec![];
            loop {
                let mut b = [0];
                stream.read_exact(&mut b).unwrap();
                bytes.push(b[0]);
                if bytes.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            let header = String::from_utf8(bytes).unwrap();
            let count = header
                .lines()
                .find_map(|l| {
                    l.to_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse::<usize>().unwrap())
                })
                .unwrap();
            let mut body = vec![0; count];
            stream.read_exact(&mut body).unwrap();
            let request: Value = serde_json::from_slice(&body).unwrap();
            assert!(!request["messages"].to_string().contains("data:image/png"));
            std::thread::sleep(Duration::from_millis(200));
            let text = response.to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",text.len(),text).unwrap();
        }
    });
    (format!("http://{addr}/v1"), worker)
}
fn answer(text: &str) -> Value {
    json!({"choices":[{"message":{"role":"assistant","content":text}}]})
}
fn settled(e: &Engine) -> Value {
    for _ in 0..300 {
        let state = e.invoke("si_chat_state", json!({})).unwrap();
        if state["active"].is_null() {
            return state;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("Chat did not settle");
}
#[test]
fn shared_chat_finishes_without_a_window_and_deduplicates_submissions() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let tool = json!({"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"one","type":"function","function":{"name":"chronoscope_analytics_run","arguments":json!({"plan":{"capability":"histogram","scope":"all","parameters":{"field":"value","bins":8}}}).to_string()}}]}}]});
    let(url,worker)=mock(vec![tool,answer("## Distribution\n\nRust calculated **every matching Event**.\n\n| Method | Input |\n|---|---|\n| Histogram | full scope |")]);
    e.invoke("si_configure", json!({"url":url,"model":"test"}))
        .unwrap();
    e.invoke("si_chat_draft", json!({"text":"Unsent draft"}))
        .unwrap();
    assert_eq!(
        e.invoke("si_chat_state", json!({})).unwrap()["draft"],
        "Unsent draft"
    );
    let args = json!({"request_id":"a".repeat(32),"prompt":"Describe the distribution"});
    let started = e.invoke("si_chat_send", args.clone()).unwrap();
    assert_eq!(e.invoke("si_chat_send", args).unwrap()["replayed"], true);
    assert_eq!(e.invoke("si_chat_send",json!({"request_id":"a".repeat(32),"prompt":"Describe the distribution","allow_edits":false,"allow_external_actions":false})).unwrap()["replayed"],true);
    assert!(e
        .invoke(
            "si_chat_send",
            json!({"request_id":"a".repeat(32),"prompt":"Different"})
        )
        .unwrap_err()
        .starts_with("CONFLICT:"));
    assert!(e
        .invoke(
            "si_chat_send",
            json!({"request_id":"b".repeat(32),"prompt":"Second concurrent message"})
        )
        .unwrap_err()
        .starts_with("CONFLICT:"));
    // Neither browser nor desktop needs to poll the job to retain its response.
    worker.join().unwrap();
    let state = settled(&e);
    chronoscope::schema::validate_output("si_chat_state", &state).unwrap();
    assert_eq!(state["messages"].as_array().unwrap().len(), 2);
    assert_eq!(state["draft"], "");
    assert_eq!(state["messages"][1]["blocks"][0]["type"], "analysis");
    let result_id = &state["messages"][1]["blocks"][0]["result_id"];
    assert!(e
        .invoke("analytics_result", json!({"result_id":result_id}))
        .is_ok());
    assert_eq!(
        e.invoke("si_chat_state", json!({"since_revision":state["revision"]}))
            .unwrap()["messages"],
        Value::Null
    );
    std::thread::sleep(Duration::from_millis(20));
    assert!(
        e.invoke("job_result", json!({"job_id":started["job_id"]}))
            .is_err(),
        "UI-owned jobs must release their retained registry payload"
    );
    let history = e.invoke("si_history", json!({})).unwrap();
    assert!(history["messages"]
        .as_array()
        .unwrap()
        .iter()
        .all(|m| m.as_object().unwrap().len() == 2));
    e.invoke("si_clear", json!({})).unwrap();
    let cleared = e.invoke("si_chat_state", json!({})).unwrap();
    assert_eq!(cleared["messages"], json!([]));
    assert_ne!(cleared["session_id"], state["session_id"]);
}
fn png() -> String {
    use base64::Engine as _;
    let image = image::DynamicImage::new_rgba8(1800, 1200);
    let mut out = std::io::Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Png).unwrap();
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(out.into_inner())
    )
}
#[test]
fn map_presentations_are_validated_bounded_images_and_clear_with_the_session() {
    let dir = tempfile::tempdir().unwrap();
    let e = Arc::new(engine(dir.path()));
    let data = png();
    let weak = Arc::downgrade(&e);
    let picture = data.clone();
    e.set_observer(Arc::new(move |event| {
        if event["kind"] == "capture" {
            assert_eq!(
                event["arguments"]["target"], "map",
                "SI map presentation must not capture the surrounding chat"
            );
            weak.upgrade()
                .unwrap()
                .invoke(
                    "view_response",
                    json!({"request_id":event["request_id"],"data_url":picture}),
                )
                .unwrap();
        }
    }))
    .unwrap();
    let result = e
        .invoke(
            "present_result",
            json!({"kind":"map","title":"Current view"}),
        )
        .unwrap();
    let block = &result["presentation"];
    assert_eq!(block["type"], "image");
    assert!(block["width"].as_u64().unwrap() <= 1600);
    assert!(block["height"].as_u64().unwrap() <= 1200);
    let media = e
        .invoke("si_chat_image", json!({"image_id":block["image_id"]}))
        .unwrap();
    assert!(media["data_url"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));
    assert!(result.to_string().len() < 2000);
    let state = e.invoke("si_chat_state", json!({})).unwrap();
    assert_eq!(
        state["messages"][0]["blocks"][0]["image_id"],
        block["image_id"]
    );
    for invalid in [
        "https://example.com/photo.png",
        "data:image/svg+xml;base64,PHN2Zy8+",
        "data:image/png;base64,notPNG",
    ] {
        assert!(e
            .invoke("si_chat_attach", json!({"data_url":invalid}))
            .is_err());
    }
    e.invoke(
        "si_configure",
        json!({"url":"http://127.0.0.1:9","model":"test"}),
    )
    .unwrap();
    let old = e.invoke("si_chat_state", json!({})).unwrap()["session_id"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    e.invoke("si_clear", json!({})).unwrap();
    assert!(e
        .invoke("si_chat_image", json!({"image_id":block["image_id"]}))
        .is_err());
    assert!(e
        .invoke(
            "si_run",
            json!({"prompt":"No network request should occur","expected_session":old})
        )
        .unwrap_err()
        .starts_with("CONFLICT:"));
    e.clear_observer();
}
#[test]
fn chart_choices_reference_engine_columns_and_direct_cli_chat_stays_visible() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let result = e
        .invoke(
            "analytics_run",
            json!({"plan":{"capability":"histogram","parameters":{"field":"value"}}}),
        )
        .unwrap();
    assert!(e.invoke("present_result",json!({"kind":"analysis","result_id":result["result_id"],"chart":"scatter","x":"does_not_exist","y":"count"})).is_err());
    let valid=e.invoke("present_result",json!({"kind":"analysis","result_id":result["result_id"],"chart":"bar","x":"start","y":"count"})).unwrap();
    chronoscope::schema::validate_output("present_result", &valid).unwrap();
    let (url, worker) = mock(vec![answer("**CLI reply**")]);
    e.invoke("si_configure", json!({"url":url,"model":"test"}))
        .unwrap();
    e.invoke("si_run", json!({"prompt":"From the CLI"}))
        .unwrap();
    worker.join().unwrap();
    let state = e.invoke("si_chat_state", json!({})).unwrap();
    assert_eq!(state["messages"].as_array().unwrap().len(), 3);
    assert_eq!(state["messages"][2]["content"], "**CLI reply**");
}

#[test]
fn clear_without_a_provider_and_old_draft_writes_cannot_resurrect_content() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    e.invoke(
        "si_chat_draft",
        json!({"text":"Disconnected draft","session_id":null}),
    )
    .unwrap();
    e.invoke("si_clear", json!({})).unwrap();
    assert_eq!(e.invoke("si_chat_state", json!({})).unwrap()["draft"], "");
    e.invoke(
        "si_configure",
        json!({"url":"http://127.0.0.1:9","model":"test"}),
    )
    .unwrap();
    let old = e.invoke("si_chat_state", json!({})).unwrap()["session_id"].clone();
    e.invoke("si_clear", json!({})).unwrap();
    assert!(e
        .invoke(
            "si_chat_draft",
            json!({"text":"Stale draft","session_id":old})
        )
        .unwrap_err()
        .starts_with("CONFLICT:"));
    assert_eq!(e.invoke("si_chat_state", json!({})).unwrap()["draft"], "");
}

#[test]
fn finished_engine_cards_survive_a_failed_model_explanation() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    let artifact = e
        .invoke(
            "analytics_run",
            json!({"plan":{"capability":"histogram","parameters":{"field":"value"}}}),
        )
        .unwrap();
    let present = json!({"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"present","type":"function","function":{"name":"chronoscope_present_result","arguments":json!({"kind":"analysis","result_id":artifact["result_id"]}).to_string()}}]}}]});
    let (url, worker) = mock(vec![
        present,
        json!({"choices":[{"message":{"role":"invalid","content":"Invalid service response"}}]}),
    ]);
    e.invoke("si_configure", json!({"url":url,"model":"test"}))
        .unwrap();
    e.invoke(
        "si_chat_send",
        json!({"request_id":"c".repeat(32),"prompt":"Show this saved histogram"}),
    )
    .unwrap();
    worker.join().unwrap();
    let state = settled(&e);
    assert_eq!(state["messages"][1]["role"], "notice");
    assert_eq!(
        state["messages"][1]["blocks"][0]["result_id"],
        artifact["result_id"]
    );
}

#[test]
fn chat_send_pins_its_session_before_replay_draft_changes_and_provider_work() {
    for reset in ["si_configure", "si_clear"] {
        let dir = tempfile::tempdir().unwrap();
        let e = engine(dir.path());
        let (url, worker) = mock(vec![answer("Fresh reply")]);
        e.invoke("si_configure", json!({"url":url,"model":"first"}))
            .unwrap();
        let old = e.invoke("si_chat_state", json!({})).unwrap()["session_id"].clone();
        e.invoke(
            "si_chat_draft",
            json!({"text":"Draft for old service","session_id":old}),
        )
        .unwrap();
        e.invoke(
            reset,
            if reset == "si_configure" {
                json!({"url":url,"model":"replacement"})
            } else {
                json!({})
            },
        )
        .unwrap();
        let current = e.invoke("si_chat_state", json!({})).unwrap()["session_id"].clone();
        assert_ne!(old, current);
        e.invoke(
            "si_chat_draft",
            json!({"text":"Replacement draft","session_id":current}),
        )
        .unwrap();
        let before = e.invoke("si_chat_state", json!({})).unwrap();
        let request = "d".repeat(32);
        let stale =
            json!({"request_id":request,"prompt":"Draft for old service","expected_session":old});
        let error = e.invoke("si_chat_send", stale).unwrap_err();
        assert_eq!(
            error,
            "CONFLICT: conversation changed; message was not sent"
        );
        assert_eq!(e.invoke("si_chat_state", json!({})).unwrap(), before);
        let fresh =
            json!({"request_id":request,"prompt":"Fresh message","expected_session":current});
        assert_eq!(
            e.invoke("si_chat_send", fresh.clone()).unwrap()["replayed"],
            false
        );
        let mut stale_replay = fresh.clone();
        stale_replay["expected_session"] = old;
        assert_eq!(e.invoke("si_chat_send", stale_replay).unwrap_err(), error);
        assert_eq!(e.invoke("si_chat_send", fresh).unwrap()["replayed"], true);
        worker.join().unwrap();
        let state = settled(&e);
        assert_eq!(state["messages"].as_array().unwrap().len(), 2);
        assert_eq!(state["messages"][0]["content"], "Fresh message");
        assert_eq!(state["messages"][1]["content"], "Fresh reply");
    }
}

#[test]
fn chat_send_session_input_is_optional_and_keeps_decimal_identity_exact() {
    let base = json!({"request_id":"e".repeat(32),"prompt":"No provider work"});
    chronoscope::schema::validate("si_chat_send", &base).unwrap();
    let mut guarded = base;
    guarded["expected_session"] = json!("18446744073709551615");
    chronoscope::schema::validate("si_chat_send", &guarded).unwrap();
    for invalid in [
        json!(9007199254740993_u64),
        json!(""),
        json!("1.0"),
        json!("1".repeat(21)),
        Value::Null,
    ] {
        guarded["expected_session"] = invalid;
        assert!(chronoscope::schema::validate("si_chat_send", &guarded).is_err());
    }
}
