use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::json;

#[test]
fn exact_table_ranges_follow_sort_scope_and_cross_pages() {
    let d = tempfile::tempdir().unwrap();
    let mut events = vec![];
    for i in 0..140u64 {
        let mut event = chronoscope::demo::dataset().events.remove(0);
        event.id = 9_007_199_254_740_993 + i;
        event.time = ((i as i64) * 60) as f64;
        event.source = if i % 2 == 0 { "A" } else { "B" }.into();
        event.value = Some((139 - i) as f64);
        events.push(event);
    }
    let e = Engine::new(
        Project::new(Dataset {
            events,
            ..Dataset::default()
        }),
        d.path().into(),
    )
    .unwrap();
    let id = |i: u64| (9_007_199_254_740_993 + i).to_string();
    // Full Attributes and projected queries must expose the same global ordering,
    // including reveal ranks used by keyboard and range selection.
    for descending in [false, true] {
        let args = json!({"sort_by":"value","descending":descending,"offset":50,"limit":50,"fields":["id","value"]});
        let projected = e.invoke("query", args.clone()).unwrap();
        let attributes = e.invoke("attribute_table", args.clone()).unwrap();
        assert_eq!(projected["events"], attributes["events"]);
        let values: Vec<_> = projected["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["value"].as_f64().unwrap())
            .collect();
        assert!(values.windows(2).all(|pair| if descending {
            pair[0] >= pair[1]
        } else {
            pair[0] <= pair[1]
        }));
        let reveal = e.invoke("query",json!({"sort_by":"value","descending":descending,"reveal_id":projected["events"][0]["id"],"limit":50})).unwrap();
        assert_eq!(reveal["offset"], 50);
        assert_eq!(reveal["reveal_found"], true);
    }
    let range = json!({"anchor":id(3),"target":id(104),"sort_by":"time"});
    assert_eq!(
        e.invoke(
            "select_query",
            json!({"table_range":range,"apply_filter":false})
        )
        .unwrap()["selected"],
        102
    );
    assert_eq!(
        e.invoke(
            "selection_contains",
            json!({"ids":[id(2),id(3),id(104),id(105)]})
        )
        .unwrap()["selected"],
        json!([id(3), id(104)])
    );
    assert_eq!(e.invoke("select_query", json!({"table_range":{"anchor":id(104),"target":id(4),"sort_by":"value","descending":true},"source":"A","apply_filter":false})).unwrap()["selected"],51);
    e.invoke("select", json!({"ids":[id(3)],"mode":"toggle"}))
        .unwrap();
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["selected_count"],
        52
    );
    e.invoke("select", json!({"ids":[id(3)],"mode":"toggle"}))
        .unwrap();
    assert_eq!(
        e.invoke("snapshot", json!({})).unwrap()["selected_count"],
        51
    );
    assert!(e
        .invoke(
            "select_query",
            json!({"table_range":range,"source":"A","apply_filter":false})
        )
        .is_err());
    e.invoke("filter", json!({"filter":{"start":600,"end":1200}}))
        .unwrap();
    assert!(e
        .invoke(
            "select_query",
            json!({"table_range":{"anchor":id(3),"target":id(15)}})
        )
        .is_err());
    assert_eq!(
        e.invoke(
            "select_query",
            json!({"table_range":{"anchor":id(20),"target":id(10)}})
        )
        .unwrap()["selected"],
        11
    );
}

#[test]
fn table_local_search_intersects_workspace_and_keeps_exact_ranges_and_cursors() {
    let dir = tempfile::tempdir().unwrap();
    let mut events = vec![];
    for i in 0..9u64 {
        let mut event = chronoscope::demo::dataset().events.remove(0);
        event.id = i + 1;
        event.time = i as f64;
        event.source = "A".into();
        event.note = if i % 2 == 0 { "scope-a" } else { "scope-b" }.into();
        event.attrs.clear();
        event.attrs.insert(
            "far_column".into(),
            if i % 3 == 0 { "needle" } else { "other" }.into(),
        );
        if i == 6 {
            event
                .attrs
                .insert("literal".into(), "needle%_\\literal".into());
        }
        events.push(event);
    }
    let engine = Engine::new(
        Project::new(Dataset {
            events,
            ..Dataset::default()
        }),
        dir.path().into(),
    )
    .unwrap();
    engine
        .invoke("filter", json!({"filter":{"search":"scope-a"}}))
        .unwrap();
    let filtered = engine.invoke("attribute_table", json!({"source":"A","apply_filter":true,"table_search":"NEEDLE","column_offset":0,"column_limit":1,"limit":1})).unwrap();
    assert_eq!(filtered["count"], 2);
    assert_eq!(filtered["events"][0]["id"], "1");
    assert_eq!(filtered["events"][0].as_object().unwrap().len(), 1);
    let cursor = filtered["next_cursor"].as_str().unwrap();
    assert_eq!(engine.invoke("attribute_table",json!({"source":"A","apply_filter":true,"table_search":"NEEDLE","cursor":cursor,"limit":1})).unwrap()["events"][0]["id"],"7");
    assert!(engine.invoke("attribute_table",json!({"source":"A","apply_filter":true,"table_search":"other","cursor":cursor,"limit":1})).is_err());
    let reveal = engine.invoke("query", json!({"source":"A","apply_filter":true,"table_search":"needle","reveal_id":"7","limit":1})).unwrap();
    assert_eq!(reveal["offset"], 1);
    assert_eq!(reveal["reveal_found"], true);
    assert_eq!(engine.invoke("select_query",json!({"source":"A","apply_filter":true,"table_search":"needle","table_range":{"anchor":"1","target":"7","sort_by":"time"}})).unwrap()["selected"],2);
    assert_eq!(
        engine
            .invoke("selection_contains", json!({"ids":["1","4","7"]}))
            .unwrap()["selected"],
        json!(["1", "7"])
    );
    assert_eq!(
        engine
            .invoke(
                "attribute_table",
                json!({"source":"A","apply_filter":false,"table_search":"needle"})
            )
            .unwrap()["count"],
        3
    );
    assert_eq!(
        engine
            .invoke("attribute_table", json!({"table_search":"%_\\literal"}))
            .unwrap()["count"],
        1
    );
    assert_eq!(
        engine
            .invoke(
                "attribute_table",
                json!({"apply_filter":true,"table_search":"no matches"})
            )
            .unwrap()["count"],
        0
    );
    assert_eq!(
        engine.invoke("snapshot", json!({})).unwrap()["filter"]["search"],
        "scope-a"
    );
}

#[test]
fn gis_column_windows_project_payloads_but_search_all_original_properties() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("wide.geojson");
    let properties: serde_json::Map<String, serde_json::Value> = (0..80)
        .map(|i| {
            (
                format!("field{i:03}"),
                json!(if i == 79 {
                    "needle beyond the visible columns".to_owned()
                } else {
                    format!("value{i}")
                }),
            )
        })
        .collect();
    std::fs::write(&path,serde_json::to_vec(&json!({"type":"FeatureCollection","features":[{"type":"Feature","id":"one","properties":properties,"geometry":{"type":"Point","coordinates":[-70,35]}}]})).unwrap()).unwrap();
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().join("profile")).unwrap();
    let layer = engine.invoke("gis_load", json!({"path":path})).unwrap()["layer"]["id"].clone();
    let full = engine.invoke("gis_table", json!({"id":layer})).unwrap();
    assert_eq!(full["columns"].as_array().unwrap().len(), 80);
    let first = engine
        .invoke(
            "gis_table",
            json!({"id":layer,"column_offset":0,"column_limit":8,"search":"needle"}),
        )
        .unwrap();
    assert_eq!(first["count"], 1);
    assert_eq!(first["total_columns"], 84);
    assert_eq!(first["rows"][0]["id"], "one");
    assert_eq!(first["rows"][0]["properties"].as_object().unwrap().len(), 4);
    assert!(first["rows"][0]["properties"].get("field079").is_none());
    let last = engine
        .invoke(
            "gis_table",
            json!({"id":layer,"column_offset":76,"column_limit":8}),
        )
        .unwrap();
    assert_eq!(last["column_offset"], 76);
    assert_eq!(
        last["columns"].as_array().unwrap().last().unwrap(),
        "field079"
    );
    assert_eq!(last["rows"][0]["properties"].as_object().unwrap().len(), 8);
    assert_eq!(
        last["rows"][0]["properties"]["field079"],
        "needle beyond the visible columns"
    );
}
