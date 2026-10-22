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
