use chronoscope::{model::Dataset, project::Project, store::DataStore};

#[test]
fn full_reopen_preserves_unicode_tags_and_maximum_ids_and_rejects_text_tampering() {
    let dir = tempfile::tempdir().unwrap();
    let mut event = chronoscope::demo::dataset().events.remove(0);
    event.id = u64::MAX;
    event.entity = "ΟΣ İSTANBUL 🚀".into();
    event.note = "Mixed CASE\nΣΟΣ\nNUL\0kept".into();
    event.tags = ["", "comma,inside", "ΟΣ", "İ"]
        .into_iter()
        .map(str::to_owned)
        .collect();
    event.attrs.insert("κλειδί".into(), "ΣΟΣ İ 🚀".into());
    let mut store = DataStore::new(&dir.path().join("work")).unwrap();
    store.load_events([event.clone()]).unwrap();
    let original = dir.path().join("original.chronoscope");
    store
        .save_as(&original, &Project::new(Dataset::default()))
        .unwrap();
    let (opened, _) = DataStore::open_copy(&original, &dir.path().join("valid")).unwrap();
    assert_eq!(opened.get(event.id).unwrap().unwrap(), event);
    drop(opened);
    for (n, sql) in [
        "UPDATE events SET entity='wrong'",
        "UPDATE events SET category='wrong'",
        "UPDATE events SET label='wrong'",
        "UPDATE events SET related_to='wrong'",
        "UPDATE events SET source='wrong'",
        "UPDATE events SET tags='wrong'",
        "UPDATE events SET note='wrong'",
        "UPDATE events SET id_key='wrong'",
        "UPDATE events SET geometry_wkt='POINT (1 2)'",
        "UPDATE attributes SET text='wrong'",
        "UPDATE search SET text='wrong'",
        "UPDATE events SET note=CAST(x'ff' AS TEXT)",
        "UPDATE events SET note=CAST('valid bytes' AS BLOB)",
    ]
    .iter()
    .enumerate()
    {
        let path = dir.path().join(format!("tampered-{n}.chronoscope"));
        std::fs::copy(&original, &path).unwrap();
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection.execute_batch(sql).unwrap();
        drop(connection);
        let bytes = std::fs::read(&path).unwrap();
        assert!(
            DataStore::open_copy(&path, &dir.path().join(format!("invalid-{n}"))).is_err(),
            "accepted {sql}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
}
