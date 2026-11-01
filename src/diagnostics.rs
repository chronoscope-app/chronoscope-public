//! Bounded diagnostic log; event values, arguments, tokens and paths are never recorded.
use std::{io::Write, path::Path, time::Duration};
pub fn record(dir: &Path, command: &str, revision: u64, elapsed: Duration, ok: bool) {
    let _ = (|| -> std::io::Result<()> {
        let dir = dir.join("logs");
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("engine.jsonl");
        if path.metadata().is_ok_and(|m| m.len() > 2 * 1024 * 1024) {
            for n in (1..4).rev() {
                let _ = std::fs::rename(
                    dir.join(format!("engine.{n}.jsonl")),
                    dir.join(format!("engine.{}.jsonl", n + 1)),
                );
            }
            let _ = std::fs::rename(&path, dir.join("engine.1.jsonl"));
        }
        let mut options = std::fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(path)?;
        // Formatting directly into the file performs many small writes, which
        // can interleave when native requests finish on different threads.
        let mut line = serde_json::to_vec(&serde_json::json!({"time":chrono::Utc::now().to_rfc3339(),"command":command,"revision":revision,"duration_ms":elapsed.as_millis(),"ok":ok})).map_err(std::io::Error::other)?;
        line.push(b'\n');
        file.write_all(&line)?;
        Ok(())
    })();
}

#[cfg(test)]
mod tests {
    #[test]
    fn concurrent_records_remain_complete_json_lines() {
        let dir = tempfile::tempdir().unwrap();
        std::thread::scope(|scope| {
            for _ in 0..16 {
                let path = dir.path();
                scope.spawn(move || {
                    for n in 0..50 {
                        super::record(path, "query", n, std::time::Duration::from_millis(1), true);
                    }
                });
            }
        });
        let text = std::fs::read_to_string(dir.path().join("logs/engine.jsonl")).unwrap();
        assert_eq!(text.lines().count(), 800);
        for line in text.lines() {
            let value: serde_json::Value = serde_json::from_str(line).unwrap();
            assert_eq!(value["command"], "query");
            assert_eq!(value["ok"], true);
        }
    }
}
