use chronoscope::{engine::Engine, model::*, project::Project};
use serde_json::{json, Value};
fn engine(events: Vec<Event>, p: &std::path::Path) -> Engine {
    Engine::new(
        Project::new(Dataset {
            events,
            ..Dataset::default()
        }),
        p.into(),
    )
    .unwrap()
}
fn event(id: u64, lat: Option<f64>, lon: Option<f64>, time: i64) -> Event {
    let mut e = chronoscope::demo::dataset().events.remove(0);
    e.id = id;
    e.entity = "Track".into();
    e.lat = lat;
    e.lon = lon;
    e.time = time as f64;
    e.end = None;
    e.value = Some(2.);
    e.geometry_wkt = None;
    e
}
#[test]
fn exact_bins_members_selection_cache_and_portable_defaults() {
    let d = tempfile::tempdir().unwrap();
    let e = engine(
        (0..6000)
            .map(|i| {
                event(
                    9007199254740993 + i,
                    Some(43.25 + (i % 4) as f64 * 0.001),
                    Some(-79.96 + (i % 3) as f64 * 0.001),
                    (i % 60) as i64 * 60,
                )
            })
            .collect(),
        d.path(),
    );
    let a = e
        .invoke("display_data", json!({"level":8,"time_bin_minutes":60}))
        .unwrap();
    assert_eq!(a["count"], 6000);
    assert_eq!(a["aggregated"], true);
    assert_eq!(a["cache_hit"], false);
    for bin in a["bins"].as_array().unwrap() {
        let q = e
            .invoke(
                "query",
                json!({"display_cell":bin["cell"],"limit":1000,"fields":["id"]}),
            )
            .unwrap();
        assert_eq!(q["count"], bin["count"]);
        assert!(q["events"][0]["id"].is_string());
    }
    let union=e.invoke("select_query",json!({"display_cells":a["bins"].as_array().unwrap().iter().map(|b|b["cell"].clone()).collect::<Vec<_>>()})).unwrap();
    assert_eq!(union["selected"], 6000);
    e.invoke("select", json!({"ids":[]})).unwrap();
    let cell = a["bins"][0]["cell"].clone();
    let chosen = e
        .invoke("select_query", json!({"display_cell":cell}))
        .unwrap();
    assert_eq!(chosen["selected"], a["bins"][0]["count"]);
    let b = e
        .invoke("display_data", json!({"level":8,"time_bin_minutes":60}))
        .unwrap();
    assert_eq!(b["cache_hit"], true);
    assert_eq!(b["bins"][0]["selected_count"], a["bins"][0]["count"]);
    let snapshot = e
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"1","include_render":true}),
        )
        .unwrap();
    assert_eq!(snapshot["display"]["count"], 6000);
    assert_eq!(snapshot["render"]["rendered_count"], 6000);
    let defaults = chronoscope::display::DisplayOptions::default();
    assert_eq!(defaults.mode, "auto");
    assert!(!defaults.bloom);
    e.invoke(
        "view_set",
        json!({"display":{"mode":"heatmap","heat_radius":48.,"bloom":true}}),
    )
    .unwrap();
    let path = d.path().join("views.chronoscope");
    e.invoke("save", json!({"path":path})).unwrap();
    e.invoke("open", json!({"path":path})).unwrap();
    let s = e.invoke("snapshot", json!({"compact":true})).unwrap();
    assert_eq!(s["scene"]["display"]["heat_radius"], 48.);
    assert_eq!(s["count"], 6000);
}
#[test]
fn dateline_poles_negative_utc_boundaries_and_viewport_members_are_exact() {
    let d = tempfile::tempdir().unwrap();
    let e = engine(
        vec![
            event(1, Some(90.), Some(180.), -60),
            event(2, Some(89.), Some(-180.), 0),
            event(3, Some(-90.), Some(179.9), 60),
            event(4, Some(43.25), Some(-79.96), 120),
            event(5, None, None, 120),
        ],
        d.path(),
    );
    let packet = e
        .invoke(
            "display_data",
            json!({"level":3,"time_bin_minutes":1,"bounds":[179.,-90.,-179.,90.]}),
        )
        .unwrap();
    assert_eq!(packet["count"], 3);
    let mut ids = std::collections::BTreeSet::new();
    for bin in packet["bins"].as_array().unwrap() {
        let q = e
            .invoke("query", json!({"display_cell":bin["cell"]}))
            .unwrap();
        assert_eq!(q["count"], bin["count"]);
        for e in q["events"].as_array().unwrap() {
            ids.insert(e["id"].as_str().unwrap().to_string());
        }
    }
    assert_eq!(ids, ["1", "2", "3"].into_iter().map(String::from).collect());
    assert!(packet["bins"]
        .as_array()
        .unwrap()
        .iter()
        .any(|b| b["cell"]["slab"] == -1));
    let flat = e.invoke("display_data", json!({"flat":true})).unwrap();
    assert_eq!(flat["count"], 1);
    let zero = e.invoke("display_data", json!({"level":0})).unwrap();
    assert_eq!(zero["count"], 4);
    assert!(zero["bins"][0]["longitude"].as_f64().unwrap().abs() > 150.);
}
#[test]
fn weights_coarsening_temporal_limits_and_invalid_cell_contracts() {
    let d = tempfile::tempdir().unwrap();
    let mut rows: Vec<_> = (0..500)
        .map(|i| {
            event(
                i + 1,
                Some(40. + i as f64 * 0.001),
                Some(-70. + i as f64 * 0.001),
                i as i64 * 60,
            )
        })
        .collect();
    rows[0].value = Some(-200.);
    rows[1].value = None;
    let e = engine(rows, d.path());
    let p = e
        .invoke(
            "display_data",
            json!({"level":24,"time_bin_minutes":1,"weight":"value","max_cells":100}),
        )
        .unwrap();
    assert_eq!(p["count"], 500);
    assert!(p["bins"].as_array().unwrap().len() <= 100);
    assert_eq!(
        p["bins"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x["weight"].as_f64().unwrap())
            .sum::<f64>(),
        996.
    );
    assert!(p["time_bin_minutes"].as_i64().unwrap() > 1);
    let mut bad = p["bins"][0]["cell"].clone();
    bad["x"] = json!(16777216);
    assert!(e.invoke("query", json!({"display_cell":bad})).is_err());
    for options in [
        json!({"mode":"invalid"}),
        json!({"heat_radius":0}),
        json!({"bloom_strength":5}),
    ] {
        assert!(e.invoke("view_set", json!({"display":options})).is_err());
    }
    e.invoke("filter", json!({"filter":{"start":120,"end":240}}))
        .unwrap();
    assert_eq!(e.invoke("display_data", json!({})).unwrap()["count"], 3);
    let _: Value = p;
}

#[test]
fn dense_display_keeps_bounded_unselected_time_only_markers() {
    let d = tempfile::tempdir().unwrap();
    let mut points = (0..3000)
        .map(|i| event(i + 1, Some(43.25), Some(-79.96), i as i64 * 120))
        .collect::<Vec<_>>();
    points.push(event(3001, None, None, 60));
    let mut shape = event(3002, None, None, 60);
    shape.geometry_wkt = Some("LINESTRING(-79.96 43.25,-79.95 43.26)".into());
    points.push(shape);
    let e = engine(points, d.path());
    let view = e
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"1","include_render":true}),
        )
        .unwrap();
    assert_eq!(view["display"]["count"], 3000);
    assert_eq!(view["geometries"]["features"].as_array().unwrap().len(), 1);
    let cells = view["display"]["bins"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["cell"].clone())
        .collect::<Vec<_>>();
    e.invoke("batch",json!({"operations":[{"command":"select_query","args":{"display_cells":cells}},{"command":"select","args":{"ids":["3001","3002"],"mode":"add"}}]})).unwrap();
    assert_eq!(
        e.invoke("snapshot", json!({"compact":true})).unwrap()["selected_count"],
        3002
    );
    assert_eq!(view["render"]["inferred_ids"], json!(["3001"]));
    assert_eq!(view["render"]["rendered_count"], 3001);
    assert!(e.invoke("events", json!({"id":"3001"})).unwrap()["events"][0]["lat"].is_null());
}

#[test]
fn ground_effects_combine_time_slabs_but_keep_time_filter_and_elevated_evidence() {
    let d = tempfile::tempdir().unwrap();
    let e = engine(
        (0..6000)
            .map(|i| {
                event(
                    i + 1,
                    Some(43.25 + (i % 4) as f64 * 0.001),
                    Some(-79.96),
                    (i % 60) as i64 * 60,
                )
            })
            .collect(),
        d.path(),
    );
    for display in [
        json!({"mode":"heatmap","time_bin_minutes":1,"partition":"entity"}),
        json!({"mode":"auto","bloom":true,"time_bin_minutes":1}),
        json!({"mode":"points","bloom":true}),
    ] {
        e.invoke("view_set", json!({"mode":"space-time","display":display}))
            .unwrap();
        let read = || {
            e.invoke(
                "view_snapshot_v1",
                json!({"version":1,"generation":"ground","include_render":true,"display_level":17}),
            )
            .unwrap()
        };
        let s = read();
        assert_eq!(s["display"]["count"], 6000);
        assert_eq!(s["display"]["time_bin_minutes"], 0);
        assert!(s["display"]["bins"]
            .as_array()
            .unwrap()
            .iter()
            .all(|b| b["cell"]["slab"] == 0 && b["cell"]["partition"] == "all"));
        assert!(s["render"]["rendered_count"].as_u64().unwrap() > 0);
        e.invoke("filter", json!({"filter":{"start":600,"end":1200}}))
            .unwrap();
        let filtered = read();
        assert_eq!(
            filtered["display"]["count"],
            filtered["snapshot"]["visible"]
        );
        assert_eq!(filtered["display"]["count"], 1100);
        e.invoke("filter", json!({"filter":{}})).unwrap();
    }
    e.invoke("view_set",json!({"mode":"space-time","display":{"mode":"clusters","bloom":false,"time_bin_minutes":1}})).unwrap();
    let s = e
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"ordinary","include_render":true,"display_level":17}),
        )
        .unwrap();
    assert!(s["display"]["time_bin_minutes"].as_u64().unwrap() > 0);
}

#[test]
fn bloom_keeps_bounded_unselected_events_in_every_geographic_view() {
    let d = tempfile::tempdir().unwrap();
    let e = engine(
        (1..=6000)
            .map(|id| event(id, Some(43.25), Some(-79.96), (id % 60) as i64 * 60))
            .collect(),
        d.path(),
    );
    e.invoke("select", json!({"ids":["1"]})).unwrap();
    for mode in ["map", "globe", "space-time"] {
        for representation in ["points", "auto"] {
            e.invoke("view_set", json!({"mode":mode,"display":{"mode":representation,"bloom":true,"show_points":true}})).unwrap();
            let s = e.invoke("view_snapshot_v1", json!({"version":1,"generation":"bloom-overlay","include_render":true,"max_points":100})).unwrap();
            assert_eq!(s["display"]["count"], 6000);
            let n = s["render"]["rendered_count"].as_u64().unwrap();
            assert!(
                n > 1 && n <= 100,
                "{mode}/{representation}: bloom should retain bounded unselected events, got {n}"
            );
            assert_eq!(s["snapshot"]["selected_count"], 1);
        }
    }
}

#[test]
fn visual_clusters_keep_entity_identity_track_evidence_and_exact_membership() {
    let d = tempfile::tempdir().unwrap();
    let events = (1..=3000)
        .map(|id| {
            let mut e = event(id, Some(30.), Some(-80.), (id % 60) as i64 * 60);
            e.entity = if id % 2 == 0 { "Amber" } else { "Violet" }.into();
            e
        })
        .collect();
    let e = engine(events, d.path());
    for mode in ["map", "globe", "space-time"] {
        for representation in ["auto", "clusters"] {
            e.invoke("view_set", json!({"mode":mode,"display":{"mode":representation,"partition":"all","bloom":false,"time_bin_minutes":0}})).unwrap();
            let s = e.invoke("view_snapshot_v1", json!({"version":1,"generation":"cluster-identity","include_render":true,"display_level":4})).unwrap();
            assert_eq!(s["display"]["count"], 3000);
            assert_eq!(
                s["render"]["rendered_count"], 3000,
                "Tracks need unselected source observations in {mode}/{representation}"
            );
            let bins = s["display"]["bins"].as_array().unwrap();
            assert!(bins.iter().all(|b| b["cell"]["partition"] == "entity"));
            let names = bins
                .iter()
                .map(|b| b["cell"]["key"].as_str().unwrap())
                .collect::<std::collections::BTreeSet<_>>();
            assert_eq!(names, ["Amber", "Violet"].into_iter().collect());
            let bin = &bins[0];
            let q = e
                .invoke(
                    "query",
                    json!({"display_cell":bin["cell"],"fields":["id","entity"],"limit":1000}),
                )
                .unwrap();
            assert_eq!(q["count"], bin["count"]);
            assert!(q["events"]
                .as_array()
                .unwrap()
                .iter()
                .all(|row| row["entity"] == bin["cell"]["key"]));
            let bounded = e.invoke("view_snapshot_v1", json!({"version":1,"generation":"cluster-identity","include_render":true,"max_points":100})).unwrap();
            assert!(bounded["render"]["rendered_count"].as_u64().unwrap() <= 100);
            assert!(bounded["render"]["rendered_count"].as_u64().unwrap() > 1);
        }
    }
    e.invoke("filter", json!({"filter":{"start":600,"end":1200}}))
        .unwrap();
    let s = e
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"cluster-identity","include_render":true}),
        )
        .unwrap();
    assert_eq!(s["display"]["count"], s["snapshot"]["visible"]);
    assert_eq!(s["render"]["rendered_count"], s["snapshot"]["visible"]);
}

#[test]
fn entity_cluster_budget_falls_back_to_bounded_events_instead_of_failing_scene() {
    let d = tempfile::tempdir().unwrap();
    let events = (1..=4001)
        .map(|id| {
            let mut e = event(id, Some(30.), Some(-80.), 0);
            e.entity = format!("Entity {id}");
            e
        })
        .collect();
    let e = engine(events, d.path());
    e.invoke(
        "view_set",
        json!({"display":{"mode":"clusters","bloom":false}}),
    )
    .unwrap();
    let s = e
        .invoke(
            "view_snapshot_v1",
            json!({"version":1,"generation":"budget","include_render":true,"max_points":100}),
        )
        .unwrap();
    assert!(s["display"].is_null());
    assert!(s["render"]["rendered_count"].as_u64().unwrap() <= 100);
    assert!(s["render"]["rendered_count"].as_u64().unwrap() > 1);
    assert_eq!(s["snapshot"]["visible"], 4001);
}
