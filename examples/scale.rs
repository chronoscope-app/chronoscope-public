//! Reproducible streaming/storage benchmark. No public network requests.
use chronoscope::{engine::Engine, model::Dataset, project::Project};
use serde_json::{json, Value};
use std::{io::Write, time::Instant};
fn timed<T>(
    measurements: &mut serde_json::Map<String, Value>,
    name: &str,
    run: impl FnOnce() -> T,
) -> T {
    eprintln!("Starting {name}");
    let start = Instant::now();
    let value = run();
    eprintln!("Completed {name}: {:.3}s", start.elapsed().as_secs_f64());
    measurements.insert(name.into(), json!(start.elapsed().as_secs_f64()));
    value
}
fn main() {
    let count = std::env::args()
        .nth(1)
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(1_000_000);
    let dir = tempfile::tempdir().unwrap();
    let csv = dir.path().join("scale.csv");
    let mut out = std::io::BufWriter::new(std::fs::File::create(&csv).unwrap());
    writeln!(
        out,
        "entity,timestamp,latitude,longitude,category,value,label"
    )
    .unwrap();
    for i in 0..count {
        writeln!(
            out,
            "Track {},{},{:.6},{:.6},Class {},{},Evidence {} {}",
            i % 100,
            1735689600 + (i as i64 * 60),
            35. + (i % 1000) as f64 / 10000.,
            -120. + (i / 1000 % 1000) as f64 / 10000.,
            i % 5,
            i % 10000,
            i,
            "x".repeat(80)
        )
        .unwrap();
    }
    out.flush().unwrap();
    drop(out);
    let mut m = serde_json::Map::new();
    m.insert("rows".into(), json!(count));
    m.insert("csv_bytes".into(), json!(csv.metadata().unwrap().len()));
    let engine = Engine::new(Project::new(Dataset::default()), dir.path().join("app")).unwrap();
    let preview = timed(&mut m, "preview_s", || {
        engine
            .invoke("import_preview", json!({"path":csv}))
            .unwrap()
    });
    let commit = timed(&mut m, "import_s", || {
        engine
            .invoke("import_commit", json!({"import_id":preview["import_id"]}))
            .unwrap()
    });
    assert_eq!(commit["accepted"], count);
    let query = timed(&mut m, "first_filtered_sort_s", || {
        engine.invoke("query",json!({"filter":{"predicates":[{"field":"category","op":"Equals","value":"Class 2"}]},"sort_by":"attribute:value","limit":100,"fields":["id","entity","value"]})).unwrap()
    });
    assert_eq!(query["count"], count / 5);
    let cursor = query["next_cursor"].clone();
    timed(&mut m, "cached_next_page_s", || {
        engine.invoke("query",json!({"filter":{"predicates":[{"field":"category","op":"Equals","value":"Class 2"}]},"sort_by":"attribute:value","cursor":cursor,"limit":100,"fields":["id","entity","value"]})).unwrap()
    });
    let render = timed(&mut m, "render_20k_s", || {
        engine.invoke("render_data", json!({})).unwrap()
    });
    assert_eq!(render["rendered_count"], count.min(20000));
    assert_eq!(render["located_count"], count);
    timed(&mut m, "aggregate_s", || {
        engine
            .invoke("aggregate", json!({"group_by":"category"}))
            .unwrap()
    });
    timed(&mut m, "snapshot_first_s", || {
        engine.invoke("snapshot", json!({"compact":true})).unwrap()
    });
    timed(&mut m, "snapshot_cached_s", || {
        engine.invoke("snapshot", json!({"compact":true})).unwrap()
    });
    let saved = dir.path().join("scale.chronoscope");
    timed(&mut m, "save_s", || {
        engine.invoke("save", json!({"path":saved})).unwrap()
    });
    m.insert(
        "workspace_bytes".into(),
        json!(saved.metadata().unwrap().len()),
    );
    // Close the original working copy before reopening the portable file.
    drop(engine);
    let reopened = timed(&mut m, "reopen_s", || {
        Engine::from_path(&saved, dir.path().join("reopen"), None).unwrap()
    });
    assert_eq!(
        reopened.invoke("query", json!({"limit":1})).unwrap()["count"],
        count
    );
    timed(&mut m, "select_exact_s", || {
        reopened.invoke("select_query",json!({"filter":{"predicates":[{"field":"entity","op":"Equals","value":"Track 3"}]}})).unwrap()
    });
    timed(&mut m, "dry_run_delete_s", || {
        reopened.invoke("delete", json!({"dry_run":true})).unwrap()
    });
    assert_eq!(
        reopened.invoke("query", json!({"limit":1})).unwrap()["count"],
        count
    );
    timed(&mut m, "stream_export_s", || {
        reopened
            .invoke(
                "export",
                json!({"path":dir.path().join("export.csv"),"selected_only":false}),
            )
            .unwrap()
    });
    println!("{}", serde_json::to_string_pretty(&m).unwrap());
}
