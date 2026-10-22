use chronoscope::{
    model::Dataset,
    project::{self, Project},
    store::DataStore,
};
#[test]
fn c16_failed_row_decode_never_replaces_an_existing_csv() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out.csv");
    std::fs::write(&path, b"old output").unwrap();
    let e = chronoscope::demo::dataset().events.remove(0);
    let result = project::export_csv_results(
        &path,
        vec![Ok(e), Err("corrupt payload fixture".into())].into_iter(),
        Default::default(),
    );
    assert!(result.unwrap_err().contains("corrupt"));
    assert_eq!(std::fs::read(path).unwrap(), b"old output");
}
#[test]
fn c16_portable_save_stages_metadata_and_resources_without_mutating_the_live_store() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(&dir.path().join("work")).unwrap();
    store
        .load_events(chronoscope::demo::dataset().events)
        .unwrap();
    let sentinel = b"TRANSIENT_RESOURCE_NOT_FOR_PORTABLE_EXPORT";
    store
        .connection
        .execute(
            "INSERT INTO resources VALUES('transient','not-a-portable-hash',?)",
            [sentinel.as_slice()],
        )
        .unwrap();
    let file = dir.path().join("study.chronoscope");
    store
        .save_as(&file, &Project::new(Dataset::default()))
        .unwrap();
    let blob: Vec<u8> = store
        .connection
        .query_row(
            "SELECT bytes FROM resources WHERE name='transient'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(blob, sentinel);
    let count: u64 = store
        .connection
        .query_row("SELECT count(*) FROM meta WHERE key='project'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
    assert!(!std::fs::read(&file)
        .unwrap()
        .windows(sentinel.len())
        .any(|w| w == sentinel));
    let (opened, _) = DataStore::open_copy(&file, &dir.path().join("opened")).unwrap();
    assert_eq!(opened.count().unwrap(), 192);
}
