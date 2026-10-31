use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::json;

#[test]
fn radius_selection_is_exact_across_pages_filters_and_dateline() {
    let dir = tempfile::tempdir().unwrap();
    let template = chronoscope::demo::dataset().events.remove(0);
    let mut events = vec![];
    for i in 0..1105 {
        let mut event = template.clone();
        event.id = i + 1;
        event.lat = Some(0.0);
        event.lon = Some(if i < 1100 { -179.999 } else { 170.0 });
        events.push(event);
    }
    let mut missing = template;
    missing.id = 1106;
    missing.lat = None;
    missing.lon = None;
    events.push(missing);
    let engine = Engine::new(
        Project::new(Dataset {
            events,
            ..Dataset::default()
        }),
        dir.path().into(),
    )
    .unwrap();
    engine
        .invoke("filter", json!({"filter":{"search":"no matching records"}}))
        .unwrap();
    let query =
        json!({"radius":{"latitude":0,"longitude":179.999,"meters":300},"apply_filter":false});
    assert_eq!(
        engine.invoke("select_query", query.clone()).unwrap()["selected"],
        1100
    );
    let mut filtered = query.clone();
    filtered["apply_filter"] = json!(true);
    assert_eq!(
        engine.invoke("select_query", filtered).unwrap()["selected"],
        0
    );
    for invalid in [0.0, -1.0] {
        let mut args = query.clone();
        args["radius"]["meters"] = json!(invalid);
        assert!(engine.invoke("select_query", args).is_err());
    }
    let mut all = query;
    all["radius"]["meters"] = json!(21000000);
    assert_eq!(
        engine.invoke("select_query", all).unwrap()["selected"],
        1105
    );
}
