//! Opt-in SQL profile of synthetic overview reads; never enables tracing in normal builds.
use chronoscope::{display::GridRequest, model::Filter, store::DataStore};
use rusqlite::trace::{TraceEvent, TraceEventCodes};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::Instant,
};

static SQL: LazyLock<Mutex<BTreeMap<String, (u64, f64)>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));
static ORDER: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"ordered_\d+").unwrap());
fn profile(event: TraceEvent<'_>) {
    if let TraceEvent::Profile(statement, duration) = event {
        let text = statement.sql();
        let text = ORDER.replace_all(&text, "ordered_N").into_owned();
        let mut all = SQL.lock().unwrap();
        let item = all.entry(text).or_default();
        item.0 += 1;
        item.1 += duration.as_secs_f64() * 1000.;
    }
}
fn timed<T>(name: &str, samples: &mut Vec<Value>, work: impl FnOnce() -> T) -> T {
    let start = Instant::now();
    let result = work();
    samples.push(json!({"phase":name,"ms":start.elapsed().as_secs_f64()*1000.}));
    result
}
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    assert_eq!(
        args.len(),
        2,
        "profile_overview INPUT.chronoscope OUTPUT.json"
    );
    let input = PathBuf::from(&args[0]);
    let output = PathBuf::from(&args[1]);
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    let dir = tempfile::tempdir_in(output.parent().unwrap()).unwrap();
    let (store, _) = DataStore::open_copy(&input, dir.path()).unwrap();
    assert_eq!(store.count().unwrap(), 1_000_000);
    let (lo, hi) = store.time_bounds().unwrap();
    let mut phases = vec![];
    // Warm the same all-data dictionaries as a loaded overview, before cold filters.
    store
        .summary_with_statistics(&Filter::default(), false)
        .unwrap();
    store
        .connection
        .trace_v2(TraceEventCodes::SQLITE_TRACE_PROFILE, Some(profile));
    for step in 0..6 {
        let start = lo + step as f64 * (hi - lo) / 20.;
        let f = Filter {
            start: Some(start),
            end: Some(start + (hi - lo) / 4.),
            ..Filter::default()
        };
        let summary = timed("summary", &mut phases, || {
            store.summary_with_statistics(&f, false).unwrap()
        });
        assert_eq!(summary["count"], 1_000_000);
        timed("display", &mut phases, || {
            store
                .display_grid(
                    &f,
                    None,
                    GridRequest {
                        level: 8,
                        minutes: 0,
                        partition: "all",
                        weight: "count",
                        limit: 4000,
                    },
                )
                .unwrap()
        });
        timed("located_order_and_sample", &mut phases, || {
            store.render_viewport(&f, 20_000, None).unwrap()
        });
        let missing = timed("inference", &mut phases, || {
            store.inferred_markers(&f, 20_000).unwrap()
        });
        assert_eq!(missing.1, 0);
    }
    store.connection.trace_v2(TraceEventCodes::empty(), None);
    let mut sql = SQL
        .lock()
        .unwrap()
        .iter()
        .map(|(sql, (calls, ms))| json!({"sql":sql,"calls":calls,"ms":ms}))
        .collect::<Vec<_>>();
    sql.sort_by(|a, b| {
        b["ms"]
            .as_f64()
            .unwrap()
            .total_cmp(&a["ms"].as_f64().unwrap())
    });
    let report = json!({"rows":1_000_000,"phases":phases,"sql":sql,"limitations":["SQLite profile durations have millisecond granularity and include cursor processing; they are not pure CPU times.","DataStore read phases omit Engine packet encoding, IPC and UI rendering.","Synthetic fixture; native UI measurements require an unlocked Mac."]});
    std::fs::write(output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
}
