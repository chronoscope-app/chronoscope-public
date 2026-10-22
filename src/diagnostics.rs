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
        writeln!(
            file,
            "{}",
            serde_json::json!({"time":chrono::Utc::now().to_rfc3339(),"command":command,"revision":revision,"duration_ms":elapsed.as_millis(),"ok":ok})
        )?;
        Ok(())
    })();
}
