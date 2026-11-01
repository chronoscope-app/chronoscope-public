use chronoscope::{
    model::Dataset,
    project::{self, Project},
    store::DataStore,
};
#[test]
fn cancelled_portable_save_preserves_destination_and_cleans_staging_files() {
    use std::sync::{atomic::AtomicBool, Arc};
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(&dir.path().join("work")).unwrap();
    store
        .load_events(chronoscope::demo::dataset().events)
        .unwrap();
    let path = dir.path().join("existing.chronoscope");
    std::fs::write(&path, b"existing destination").unwrap();
    let result = chronoscope::operation::with_context(
        chronoscope::operation::Context {
            cancelled: Arc::new(AtomicBool::new(true)),
            progress: None,
            scope: None,
        },
        || store.save_as(&path, &Project::new(Dataset::default())),
    );
    assert!(result.is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"existing destination");
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
}

#[test]
fn cancellation_after_compaction_does_not_publish_or_leave_temporary_files() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(&dir.path().join("work")).unwrap();
    store
        .load_events(chronoscope::demo::dataset().events)
        .unwrap();
    let path = dir.path().join("existing.chronoscope");
    std::fs::write(&path, b"existing destination").unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = cancelled.clone();
    let result = chronoscope::operation::with_context(
        chronoscope::operation::Context {
            cancelled: cancelled.clone(),
            scope: None,
            progress: Some(Arc::new(move |_, _, message| {
                if message == "Committing external file" {
                    flag.store(true, Ordering::Relaxed);
                }
            })),
        },
        || store.save_as(&path, &Project::new(Dataset::default())),
    );
    assert!(cancelled.load(Ordering::Relaxed));
    assert!(result.is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"existing destination");
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
}

// APFS rejects invalid UTF-8 names; exercise the OS-path fallback on Linux.
#[cfg(target_os = "linux")]
#[test]
fn portable_save_keeps_non_utf8_parent_path_support() {
    use std::os::unix::ffi::OsStringExt;
    let dir = tempfile::tempdir().unwrap();
    let parent = dir
        .path()
        .join(std::ffi::OsString::from_vec(b"non-utf8-\xff".to_vec()));
    std::fs::create_dir(&parent).unwrap();
    let mut store = DataStore::new(&dir.path().join("work")).unwrap();
    store
        .load_events(chronoscope::demo::dataset().events)
        .unwrap();
    let path = parent.join("study.chronoscope");
    store
        .save_as(&path, &Project::new(Dataset::default()))
        .unwrap();
    let (opened, _) = DataStore::open_copy(&path, &dir.path().join("opened")).unwrap();
    assert_eq!(opened.count().unwrap(), 192);
}
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
