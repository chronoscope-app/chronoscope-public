#[cfg(target_os = "macos")]
fn main() {
    use serde_json::{json, Value};
    use std::sync::Arc;
    let dir = std::env::args().nth(1).expect("isolated QA profile");
    std::fs::create_dir_all(&dir).unwrap();
    let engine = Arc::new(
        chronoscope::engine::Engine::new(
            chronoscope::project::Project::new(chronoscope::demo::dataset()),
            dir.into(),
        )
        .unwrap(),
    );
    let target = engine.clone();
    chronoscope_apple_intents::install(Arc::new(move |input| {
        let request: Value = serde_json::from_str(input).unwrap();
        target
            .invoke(
                request["command"].as_str().unwrap(),
                request["args"].clone(),
            )
            .unwrap_or_else(|e| json!({"error":e}))
            .to_string()
    }));
    let result: Value = serde_json::from_str(&chronoscope_apple_intents::verify()).unwrap();
    assert_eq!(result["passed"], true, "{result}");
    let snapshot = engine.invoke("snapshot", json!({"compact":true})).unwrap();
    assert_eq!(snapshot["scene"]["mode"], "map");
    assert_eq!(snapshot["selected_count"], 48);
    println!(
        "{}",
        json!({"passed":true,"native_intent_performs":5,"scene":snapshot["scene"]["mode"],"selected":snapshot["selected_count"],"synthetic_profile":true})
    );
}
#[cfg(not(target_os = "macos"))]
fn main() {}
