//! Use --features performance-open-profile to emit coarse open phase timings.
use chronoscope::store::DataStore;
use std::{path::PathBuf, time::Instant};
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    assert_eq!(
        args.len(),
        2,
        "profile_open INPUT.chronoscope SCRATCH_DIRECTORY"
    );
    let root = PathBuf::from(&args[1]);
    std::fs::create_dir_all(&root).unwrap();
    for round in 0..3 {
        let directory = tempfile::tempdir_in(&root).unwrap();
        let started = Instant::now();
        let (store, _) =
            DataStore::open_copy(std::path::Path::new(&args[0]), directory.path()).unwrap();
        assert_eq!(store.count().unwrap(), 1_000_000);
        println!(
            "{}",
            serde_json::json!({"round":round,"total_ms":started.elapsed().as_secs_f64()*1000.})
        );
    }
}
