use chronoscope::{
    engine::Engine,
    input_limits::{self, MIB},
    model::Dataset,
    operation::{self, Context},
    project::Project,
};
use serde_json::json;
use std::{
    fs::File,
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
fn engine(dir: &std::path::Path) -> Engine {
    Engine::new(Project::new(Dataset::default()), dir.join("work")).unwrap()
}
#[test]
fn oversized_inputs_are_rejected_by_metadata_before_parsing_or_opening() {
    let dir = tempfile::tempdir().unwrap();
    let engine = engine(dir.path());
    for (ext, limit) in [
        ("csv", 2048 * MIB),
        ("xlsx", 100 * MIB),
        ("geojson", 64 * MIB),
        ("json", 64 * MIB),
        ("glb", 256 * MIB),
        ("chronoscope", 2048 * MIB),
    ] {
        let path = dir.path().join(format!("oversized.{ext}"));
        let file = File::create(&path).unwrap();
        // NTFS requires an explicit sparse flag before extending a large fixture.
        // Fail before allocation if the filesystem cannot support this safe test.
        #[cfg(windows)]
        assert!(
            std::process::Command::new("fsutil")
                .args(["sparse", "setflag"])
                .arg(&path)
                .status()
                .expect("fsutil is required for a sparse fixture")
                .success(),
            "Cannot create a sparse fixture safely; file was not extended"
        );
        file.set_len(100 * 1024 * 1024 * 1024).unwrap();
        let result = engine
            .invoke("file_probe", json!({"path":path,"metadata_only":true}))
            .unwrap();
        assert_eq!(result["allowed"], false);
        assert_eq!(result["limit_bytes"], limit);
        assert!(engine
            .invoke("file_probe", json!({"path":path}))
            .unwrap_err()
            .contains("too large"));
        if ext == "chronoscope" {
            assert!(engine
                .invoke("open", json!({"path":path}))
                .unwrap_err()
                .contains("too large"));
        } else {
            assert!(engine
                .invoke("import_preview", json!({"path":path}))
                .unwrap_err()
                .contains("too large"));
        }
    }
    assert_eq!(
        engine.invoke("snapshot", json!({"compact":true})).unwrap()["count"],
        0
    );
    assert!(!input_limits::inspect(dir.path()).unwrap().allowed);
}
#[test]
fn csv_preview_stops_at_sample_and_review_still_visits_the_tail() {
    let dir = tempfile::tempdir().unwrap();
    let engine = engine(dir.path());
    let path = dir.path().join("sample.csv");
    let mut file = File::create(&path).unwrap();
    writeln!(file, "timestamp,entity,latitude,longitude").unwrap();
    for _ in 0..1200 {
        writeln!(file, "2026-01-01T00:00:00Z,A,40,-74").unwrap();
    }
    drop(file);
    let preview = engine
        .invoke("import_preview", json!({"path":path}))
        .unwrap();
    assert_eq!(preview["sheets"][0]["count"], 1000);
    assert_eq!(preview["sheets"][0]["count_exact"], false);
    let review = engine
        .invoke(
            "import_review",
            json!({"import_id":preview["import_id"],"mapping":preview["sheets"][0]["mapping"]}),
        )
        .unwrap();
    assert_eq!(review["accepted"], 1200);
    let result = engine
        .invoke(
            "import_commit",
            json!({"import_id":preview["import_id"],"append":true}),
        )
        .unwrap();
    assert_eq!(result["accepted"], 1200);
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap();
    writeln!(file, "broken,wrong,number,of,columns").unwrap();
    drop(file);
    let preview = engine
        .invoke("import_preview", json!({"path":path}))
        .unwrap();
    assert_eq!(preview["sheets"][0]["count"], 1000);
    assert!(engine
        .invoke(
            "import_review",
            json!({"import_id":preview["import_id"],"mapping":preview["sheets"][0]["mapping"]})
        )
        .is_err());
    assert_eq!(
        engine.invoke("snapshot", json!({"compact":true})).unwrap()["count"],
        1200
    );
}
#[test]
fn checked_reads_and_full_review_honor_cancellation_without_publishing() {
    let dir = tempfile::tempdir().unwrap();
    let engine = engine(dir.path());
    let path = dir.path().join("cancel.csv");
    let mut file = File::create(&path).unwrap();
    writeln!(file, "timestamp,entity,latitude,longitude").unwrap();
    for _ in 0..15000 {
        writeln!(file, "2026-01-01T00:00:00Z,A,40,-74").unwrap();
    }
    drop(file);
    let preview = engine
        .invoke("import_preview", json!({"path":path}))
        .unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = cancelled.clone();
    let context = Context {
        cancelled: cancelled.clone(),
        scope: None,
        progress: Some(Arc::new(move |rows, _, message| {
            if rows >= 1000 && message.contains("events") {
                flag.store(true, Ordering::Relaxed);
            }
        })),
    };
    let error = operation::with_context(context, || {
        engine.invoke(
            "import_review",
            json!({"import_id":preview["import_id"],"mapping":preview["sheets"][0]["mapping"]}),
        )
    })
    .unwrap_err();
    assert!(error.contains("CANCELLED"), "{error}");
    assert!(cancelled.load(Ordering::Relaxed));
    assert_eq!(
        engine.invoke("snapshot", json!({"compact":true})).unwrap()["count"],
        0
    );
    let context = Context {
        cancelled: Arc::new(AtomicBool::new(true)),
        scope: None,
        progress: None,
    };
    operation::with_context(context, || {
        let mut reader = input_limits::CheckedReader(std::io::Cursor::new(vec![1; 16]));
        assert!(reader
            .read(&mut [0; 8])
            .unwrap_err()
            .to_string()
            .contains("CANCELLED"));
    });
}

#[test]
fn kmz_above_text_limit_uses_bounded_archive_loading() {
    let dir = tempfile::tempdir().unwrap();
    let engine = engine(dir.path());
    let path = dir.path().join("larger.kmz");
    let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file("doc.kml", options).unwrap();
    zip.write_all(include_bytes!("fixtures/gis/timed-zones.kml"))
        .unwrap();
    zip.start_file("unused.bin", options).unwrap();
    let buffer = [0u8; 64 * 1024];
    for _ in 0..1120 {
        zip.write_all(&buffer).unwrap();
    }
    zip.finish().unwrap();
    assert!(path.metadata().unwrap().len() > 64 * MIB);
    let admission = engine
        .invoke("file_probe", json!({"path":path,"metadata_only":true}))
        .unwrap();
    assert_eq!(admission["allowed"], true);
    let result = engine.invoke("gis_load", json!({"path":path})).unwrap();
    assert_eq!(result["layer"]["feature_count"], 1);
}
