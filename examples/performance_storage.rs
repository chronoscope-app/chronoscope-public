// Adapted CPU benchmark from the OpenClaw evidence bundle for the current API.
// No GPU, public network or private host telemetry.
use chronoscope::{
    engine::Engine, import::Mapping, model::*, project::Project, store::DataStore,
    stream_import::PendingImport,
};
use serde_json::{json, Value};
use std::{io::Write, time::Instant};
fn timed<T>(m: &mut serde_json::Map<String, Value>, k: &str, f: impl FnOnce() -> T) -> T {
    let t = Instant::now();
    let v = f();
    m.insert(k.into(), json!(t.elapsed().as_secs_f64()));
    v
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let n: usize = args[1].parse().unwrap();
    let root = std::path::PathBuf::from(&args[2]);
    std::fs::create_dir_all(&root).unwrap();
    let d = tempfile::tempdir_in(&root).unwrap();
    let csv = root.join(format!("fixture-{n}.csv"));
    if !csv.exists() {
        let mut f = std::io::BufWriter::new(std::fs::File::create(&csv).unwrap());
        writeln!(
            f,
            "entity,timestamp,latitude,longitude,category,value,label"
        )
        .unwrap();
        for i in 0..n {
            writeln!(
                f,
                "Track {},{},{:.6},{:.6},Class {},{},Evidence {} {}",
                i % 100,
                1735689600 + i as i64 * 60,
                35. + (i % 1000) as f64 / 10000.,
                -120. + (i / 1000 % 1000) as f64 / 10000.,
                i % 5,
                i % 10000,
                i,
                "x".repeat(80)
            )
            .unwrap();
        }
    }
    let mut m = serde_json::Map::new();
    m.insert("rows".into(), json!(n));
    m.insert("sqlite_version".into(), json!(rusqlite::version()));
    let mut s = DataStore::new(&d.path().join("store")).unwrap();
    let p = timed(&mut m, "preview_s", || {
        PendingImport::preview(&csv, 0).unwrap()
    });
    let mapping = Mapping::detect(&p.sample.tables[0]).mapping;
    let r = timed(&mut m, "ingest_s", || p.ingest(0, &mapping, &s, 1).unwrap());
    assert_eq!(r.0, n);
    assert_eq!(s.count().unwrap(), n);
    s.changed().unwrap();
    let bounds = timed(&mut m, "bounds_s", || s.time_bounds().unwrap());
    assert_eq!(bounds.0, 1735689600.);
    assert_eq!(bounds.1, 1735689600. + (n - 1) as f64 * 60.);
    let f = Filter {
        predicates: vec![Predicate {
            field: "category".into(),
            op: Operator::Equals,
            value: "Class 2".into(),
        }],
        ..Default::default()
    };
    let t = timed(&mut m, "selective_order_s", || {
        s.ordered(&f, None, "time", false).unwrap()
    });
    assert_eq!(s.table_count(&t).unwrap(), n / 5);
    let numeric = Filter {
        predicates: vec![Predicate {
            field: "value".into(),
            op: Operator::Greater,
            value: "9990".into(),
        }],
        ..Default::default()
    };
    let t = timed(&mut m, "numeric_order_s", || {
        s.ordered(&numeric, None, "time", false).unwrap()
    });
    assert_eq!(s.table_count(&t).unwrap(), n / 10000 * 9);
    let (w, a) = DataStore::where_sql(&numeric, None);
    let mut q = s
        .connection
        .prepare(&format!(
            "EXPLAIN QUERY PLAN SELECT e.r FROM events e WHERE {w} ORDER BY e.time,e.id_key"
        ))
        .unwrap();
    let plans = q
        .query_map(rusqlite::params_from_iter(a.clone()), |r| {
            r.get::<_, String>(3)
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    m.insert("numeric_plan".into(), json!(plans));
    drop(q);
    let mut q = s
        .connection
        .prepare(&format!("SELECT count(*) FROM events e WHERE {w}"))
        .unwrap();
    let _: usize = q
        .query_row(rusqlite::params_from_iter(a), |r| r.get(0))
        .unwrap();
    m.insert(
        "numeric_vm_steps".into(),
        json!(q.get_status(rusqlite::StatementStatus::VmStep)),
    );
    drop(q);
    if args.iter().any(|arg| arg == "--storage-only") {
        for id in [1, n as u64 / 2, n as u64] {
            let event = s.get(id).unwrap().unwrap();
            assert_eq!(event.id, id);
            assert_eq!(event.source_row, id as usize + 1);
            assert_eq!(event.time, 1735689600. + (id - 1) as f64 * 60.);
            assert_eq!(event.attrs["label"], event.label);
        }
        m.insert("mode".into(), json!("storage-only; no copy/save/render"));
        m.insert(
            "working_database_bytes".into(),
            json!(std::fs::metadata(s.directory().join("events.sqlite"))
                .unwrap()
                .len()),
        );
        println!("{}", serde_json::to_string_pretty(&m).unwrap());
        return;
    }
    let summary = timed(&mut m, "summary_full_s", || {
        s.summary(&Filter::default()).unwrap()
    });
    assert_eq!(summary["count"], n);
    let mut target = DataStore::new(&d.path().join("clone")).unwrap();
    timed(&mut m, "copy_into_s", || s.copy_into(&mut target).unwrap());
    assert_eq!(target.count().unwrap(), n);
    for id in [1, n as u64 / 2, n as u64] {
        assert_eq!(s.get(id).unwrap(), target.get(id).unwrap());
    }
    let metadata = Project::new(Dataset {
        name: "benchmark".into(),
        events: vec![],
    });
    let saved = d.path().join("portable.chronoscope");
    timed(&mut m, "save_database_s", || {
        s.save_as(&saved, &metadata).unwrap()
    });
    m.insert("db_bytes".into(), json!(saved.metadata().unwrap().len()));
    let (opened, _) = timed(&mut m, "open_database_s", || {
        DataStore::open_copy(&saved, &d.path().join("open")).unwrap()
    });
    assert_eq!(opened.count().unwrap(), n);
    drop(opened);
    drop(target);
    drop(s);
    let engine = Engine::from_path(&saved, d.path().join("engine"), None).unwrap();
    let compact = timed(&mut m, "snapshot_compact_first_s", || {
        engine.invoke("snapshot", json!({"compact":true})).unwrap()
    });
    let full = timed(&mut m, "snapshot_full_after_compact_s", || {
        engine.invoke("snapshot", json!({})).unwrap()
    });
    let mut oracle = full.clone();
    for k in [
        "histogram",
        "selected_histogram",
        "views",
        "groups",
        "workspace",
        "imports",
    ] {
        oracle.as_object_mut().unwrap().remove(k);
    }
    for key in [
        "count",
        "visible",
        "filter",
        "revision",
        "selected",
        "time_bounds",
    ] {
        assert_eq!(compact[key], oracle[key], "{key}");
    }
    let render = timed(&mut m, "render_100k_s", || {
        engine
            .invoke("render_data", json!({"max_points":100000}))
            .unwrap()
    });
    assert_eq!(render["located_count"], n);
    assert_eq!(render["rendered_count"], n.min(100000));
    println!("{}", serde_json::to_string_pretty(&m).unwrap());
}
