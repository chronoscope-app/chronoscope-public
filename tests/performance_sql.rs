use chronoscope::store::DataStore;
#[test]
fn c05_indexed_endpoints_cover_empty_single_and_intervals() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    assert_eq!(store.time_bounds().unwrap(), (0., 1.));
    let mut e = chronoscope::demo::dataset().events.remove(0);
    e.time = -120.0;
    e.end = Some(600.0);
    store.load_events(vec![e]).unwrap();
    assert_eq!(store.time_bounds().unwrap(), (-120., 600.));
    let sql="EXPLAIN QUERY PLAN SELECT coalesce((SELECT min(time) FROM events),0),coalesce((SELECT max(t_end) FROM events),0)";
    let mut q = store.connection.prepare(sql).unwrap();
    let plan = q
        .query_map([], |r| r.get::<_, String>(3))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
        .join(" ");
    assert!(
        plan.contains("events_time") && plan.contains("events_end"),
        "{plan}"
    );
}
