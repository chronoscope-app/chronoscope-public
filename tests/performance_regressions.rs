use chronoscope::{engine::Engine, project::Project};
use serde_json::json;

#[test]
fn c01_cancelled_read_preserves_context_and_selection_cache() {
    use std::sync::{atomic::AtomicBool, Arc};
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    engine.invoke("select", json!({"ids":["1","2"]})).unwrap();
    engine
        .invoke("save_group", json!({"name":"evidence"}))
        .unwrap();
    let before = engine.invoke("snapshot", json!({})).unwrap();
    let cancelled = chronoscope::operation::with_context(
        chronoscope::operation::Context {
            cancelled: Arc::new(AtomicBool::new(true)),
            progress: None,
            scope: None,
        },
        || engine.invoke("query", json!({"filter":{"selected_only":true}})),
    );
    assert!(cancelled.unwrap_err().starts_with("CANCELLED:"));
    assert_eq!(engine.invoke("snapshot", json!({})).unwrap(), before);
    assert_eq!(
        engine
            .invoke("query", json!({"filter":{"selected_only":true}}))
            .unwrap()["count"],
        2
    );
}

#[test]
fn c02_raw_rows_reserve_unique_ids_across_rejects_and_flush_boundaries() {
    use chronoscope::{import::Mapping, store::DataStore, stream_import::PendingImport};
    for rejected in [
        vec![0],
        vec![999],
        vec![0, 1, 999, 1000, 1001],
        (0..1000).collect(),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rows.csv");
        let mut csv = String::from("entity,timestamp,label\n");
        for i in 0..2001 {
            csv.push_str(&format!(
                "A,{},row-{i}\n",
                if rejected.contains(&i) {
                    "bad"
                } else {
                    "2026-01-01"
                }
            ));
        }
        std::fs::write(&path, csv).unwrap();
        let pending = PendingImport::preview(&path, 0).unwrap();
        let mapping = Mapping::guess(&pending.sample.tables[0].headers);
        let store = DataStore::new(&dir.path().join("work")).unwrap();
        let first = 9_007_199_254_740_993;
        let (accepted, _, _) = pending.ingest(0, &mapping, &store, first).unwrap();
        assert_eq!(store.count().unwrap(), accepted, "rejected {rejected:?}");
        let table = store
            .ordered(&Default::default(), None, "id", false)
            .unwrap();
        let expected = (0..2001)
            .filter(|i| !rejected.contains(i))
            .map(|i| first + i as u64)
            .collect::<Vec<_>>();
        assert_eq!(store.ids(&table).unwrap(), expected);
        assert_eq!(store.get(first + 2000).unwrap().unwrap().label, "row-2000");
    }
}

#[test]
fn c02_id_capacity_checks_the_last_consumed_row_without_wrapping() {
    use chronoscope::import::{convert, Mapping, RawTable};
    let mut table = RawTable {
        sheet: "test".into(),
        headers: vec!["time".into()],
        rows: vec![vec!["2026-01-01".into()]],
        row_numbers: vec![2],
    };
    let mapping = Mapping::guess(&table.headers);
    assert_eq!(
        convert(&table, &mapping, "test", u64::MAX).unwrap().events[0].id,
        u64::MAX
    );
    table.rows.push(vec!["bad".into()]);
    table.row_numbers.push(3);
    assert!(convert(&table, &mapping, "test", u64::MAX).is_err());
}

#[test]
fn c24a_invalid_numeric_attribute_comparisons_have_no_dangling_bindings() {
    use chronoscope::model::{Filter, Operator, Predicate};
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    for value in ["", "banana", "NaN", "inf", " 10 "] {
        for op in [Operator::Greater, Operator::Less] {
            let invalid = Predicate {
                field: "attribute:number".into(),
                op,
                value: value.into(),
            };
            for predicates in [
                vec![invalid.clone()],
                vec![
                    Predicate {
                        field: "entity".into(),
                        op: Operator::Equals,
                        value: "Aurora".into(),
                    },
                    invalid.clone(),
                ],
                vec![
                    invalid.clone(),
                    Predicate {
                        field: "source".into(),
                        op: Operator::Equals,
                        value: "demo".into(),
                    },
                ],
            ] {
                let filter = Filter {
                    predicates,
                    ..Default::default()
                };
                assert_eq!(
                    engine.invoke("query", json!({"filter":filter})).unwrap()["count"],
                    0
                );
            }
        }
    }
}

#[test]
fn c24b_all_predicates_match_canonical_signed_zero_and_attribute_text() {
    let d = tempfile::tempdir().unwrap();
    let mut s = chronoscope::store::DataStore::new(d.path()).unwrap();
    let mut events = chronoscope::demo::dataset().events;
    for (i, e) in events.iter_mut().enumerate() {
        e.category = if i % 2 == 0 { "Évidence" } else { "" }.into();
        e.value = match i % 4 {
            0 => None,
            1 => Some(-0.),
            2 => Some(-2.5),
            _ => Some(10.),
        };
        e.attrs.insert(
            "number".into(),
            if i % 2 == 0 { " 10 " } else { "banana" }.into(),
        );
    }
    s.load_events(events.clone()).unwrap();
    for field in [
        "category",
        "entity",
        "source",
        "id",
        "value",
        "lat",
        "lon",
        "attribute:number",
    ] {
        for op in [
            chronoscope::model::Operator::Equals,
            chronoscope::model::Operator::NotEquals,
            chronoscope::model::Operator::Greater,
            chronoscope::model::Operator::Less,
            chronoscope::model::Operator::Contains,
            chronoscope::model::Operator::IsEmpty,
        ] {
            for value in [
                "",
                "Évidence",
                "évidence",
                "10",
                "1e1",
                " 10 ",
                "NaN",
                "-0",
                "-2.5",
            ] {
                let f = chronoscope::model::Filter {
                    predicates: vec![chronoscope::model::Predicate {
                        field: field.into(),
                        op: op.clone(),
                        value: value.into(),
                    }],
                    ..Default::default()
                };
                let t = s.ordered(&f, None, "id", false).unwrap();
                let mut expected: Vec<_> = events
                    .iter()
                    .filter(|e| f.matches(e, &Default::default()))
                    .map(|e| e.id)
                    .collect();
                expected.sort_unstable();
                assert_eq!(s.ids(&t).unwrap(), expected, "{field} {op:?} {value}");
            }
        }
    }
}

#[test]
fn c24b_portable_reopen_preserves_signed_zero_lexical_coordinates_and_values() {
    use chronoscope::model::{Dataset, Filter, Operator, Predicate};
    let dir = tempfile::tempdir().unwrap();
    let mut e = chronoscope::demo::dataset().events.remove(0);
    e.lat = Some(-0.);
    e.lon = Some(-0.);
    e.value = Some(-0.);
    let mut store = chronoscope::store::DataStore::new(&dir.path().join("work")).unwrap();
    store.load_events(vec![e.clone()]).unwrap();
    let file = dir.path().join("zeros.chronoscope");
    store
        .save_as(&file, &Project::new(Dataset::default()))
        .unwrap();
    let (opened, _) =
        chronoscope::store::DataStore::open_copy(&file, &dir.path().join("opened")).unwrap();
    let event = opened.get(e.id).unwrap().unwrap();
    for v in [event.lat, event.lon, event.value] {
        assert!(v.unwrap().is_sign_negative());
    }
    for field in ["lat", "lon", "value"] {
        let filter = Filter {
            predicates: vec![Predicate {
                field: field.into(),
                op: Operator::Contains,
                value: "-0".into(),
            }],
            ..Default::default()
        };
        let table = opened.ordered(&filter, None, "id", false).unwrap();
        assert_eq!(opened.ids(&table).unwrap(), vec![e.id]);
    }
}

#[test]
fn c06_internal_view_sections_share_one_revision_and_exact_membership() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    engine.invoke("select", json!({"ids":["1"]})).unwrap();
    let result=engine.invoke("view_snapshot_v1",json!({"version":1,"generation":"scene-1","include_render":true,"include_inspector":true,"page":{"command":"events","args":{"limit":50}}})).unwrap();
    let revision = result["snapshot"]["revision"].as_u64().unwrap();
    assert_eq!(result["render"]["revision"], revision);
    assert_eq!(result["geometries"]["revision"], revision);
    assert_eq!(result["stamp"]["revision"], revision.to_string());
    assert_eq!(result["inspected"]["events"][0]["id"], "1");
    assert_eq!(result["selected"], json!(["1"]));
    assert!(!chronoscope::mcp::tools()
        .iter()
        .any(|tool| tool["name"] == "chronoscope_view_snapshot_v1"));
    assert!(engine
        .invoke("view_snapshot_v1", json!({"version":2,"generation":"x"}))
        .is_err());
}

#[test]
fn c06_one_hundred_concurrent_store_replacements_cannot_tear_view_sections() {
    use chronoscope::model::Dataset;
    use std::sync::{Arc, Barrier};
    let dir = tempfile::tempdir().unwrap();
    let mut files = vec![];
    for (name, count) in [("A", 10), ("B", 20)] {
        let mut template = chronoscope::demo::dataset().events.remove(0);
        template.entity = name.into();
        template.time = 0.0;
        template.end = None;
        let events = (1..=count)
            .map(|id| {
                let mut e = template.clone();
                e.id = id;
                e
            })
            .collect();
        let file = dir.path().join(format!("{name}.chronoscope"));
        chronoscope::project::save(
            &file,
            &Project::new(Dataset {
                name: name.into(),
                events,
            }),
        )
        .unwrap();
        files.push(file);
    }
    let engine = Arc::new(Engine::from_path(&files[0], dir.path().join("app"), None).unwrap());
    let barrier = Arc::new(Barrier::new(2));
    let writer = engine.clone();
    let gate = barrier.clone();
    let worker = std::thread::spawn(move || {
        gate.wait();
        for i in 0..100 {
            writer.invoke("open", json!({"path":files[i%2]})).unwrap();
        }
    });
    barrier.wait();
    for i in 0..100 {
        let result=engine.invoke("view_snapshot_v1",json!({"version":1,"generation":i.to_string(),"include_render":true,"page":{"command":"events","args":{"fields":["id"],"limit":50}}})).unwrap();
        let name = result["snapshot"]["name"].as_str().unwrap();
        let count = if name == "A" { 10 } else { 20 };
        assert_eq!(result["snapshot"]["count"], count);
        assert_eq!(result["render"]["located_count"], count);
        assert_eq!(result["page"]["count"], count);
        assert_eq!(result["render"]["entities"], json!([name]));
        assert_eq!(result["snapshot"]["revision"], result["render"]["revision"]);
        assert_eq!(result["stamp"]["store_id"].as_str().unwrap().len(), 64);
    }
    worker.join().unwrap();
}

#[test]
fn view_selection_intersects_and_deduplicates_every_payload_source() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::new(
        Project::new(chronoscope::demo::dataset()),
        dir.path().into(),
    )
    .unwrap();
    engine
        .invoke("select", json!({"ids":["1","2","10","190"]}))
        .unwrap();
    // No render: include retained IDs and a table-only record, exclude unrelated
    // selected records, and preserve the existing lexicographic membership order.
    let r = engine.invoke("view_snapshot_v1", json!({"version":1,"generation":"retained","include_render":false,"selection_ids":["2","10","2","3"],"page":{"command":"events","args":{"id":"1","limit":1}}})).unwrap();
    assert_eq!(r["selected"], json!(["1", "10", "2"]));
    let r = engine.invoke("view_snapshot_v1", json!({"version":1,"generation":"rendered","include_render":true,"selection_ids":[],"max_points":1000})).unwrap();
    assert_eq!(r["selected"], json!(["1", "10", "190", "2"]));
    engine.invoke("select", json!({"ids":[]})).unwrap();
    let r = engine.invoke("view_snapshot_v1", json!({"version":1,"generation":"empty","include_render":true,"selection_ids":["1","10"],"max_points":1000})).unwrap();
    assert_eq!(r["selected"], json!([]));
}
