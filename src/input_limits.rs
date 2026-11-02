//! Metadata-only admission checks shared by Open, drops and backend readers.
use std::{
    io::{Read, Seek, SeekFrom},
    path::Path,
};
pub const MIB: u64 = 1024 * 1024;
pub const MAX_INPUT: u64 = 2048 * MIB;
pub const LARGE_INPUT: u64 = 100 * MIB;
#[derive(serde::Serialize)]
pub struct Admission {
    pub bytes: u64,
    pub limit_bytes: u64,
    pub allowed: bool,
    pub requires_confirmation: bool,
    pub reason: Option<String>,
}
pub fn inspect(path: &Path) -> Result<Admission, String> {
    inspect_limit(path, None)
}
fn inspect_limit(path: &Path, workspace_limit: Option<u64>) -> Result<Admission, String> {
    crate::operation::check()?;
    let meta = path.metadata().map_err(|e| e.to_string())?;
    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    let limit = workspace_limit.unwrap_or(match ext.as_str() {
        "csv" | "tsv" | "chronoscope" => MAX_INPUT,
        "xls" | "xlsx" | "xlsb" => 100 * MIB,
        "kmz" => 256 * MIB,
        "glb" => 256 * MIB,
        _ => 64 * MIB,
    });
    let reason = if !meta.is_file() {
        Some(
            "Choose individual regular files; folders and special files cannot be imported.".into(),
        )
    } else if meta.len() > limit {
        Some(format!("File is too large ({:.1} MiB). The limit for this format is {} MiB. Split or reduce the source first.", meta.len() as f64 / MIB as f64, limit / MIB))
    } else {
        None
    };
    Ok(Admission {
        bytes: meta.len(),
        limit_bytes: limit,
        allowed: reason.is_none(),
        requires_confirmation: reason.is_none() && meta.len() > LARGE_INPUT,
        reason,
    })
}
pub fn ensure(path: &Path) -> Result<Admission, String> {
    let result = inspect(path)?;
    if let Some(reason) = &result.reason {
        return Err(format!("RESOURCE_LIMIT: {reason}"));
    }
    Ok(result)
}
pub fn ensure_workspace(path: &Path) -> Result<Admission, String> {
    let result = inspect_limit(path, Some(MAX_INPUT))?;
    if let Some(reason) = &result.reason {
        return Err(format!("RESOURCE_LIMIT: {reason}"));
    }
    Ok(result)
}
/// Check between bounded reads, including archive decompression and workbook parsing.
#[derive(Clone)]
pub struct CheckedReader<R>(pub R);
impl<R: Read> Read for CheckedReader<R> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        crate::operation::check().map_err(std::io::Error::other)?;
        let size = out.len().min(64 * 1024);
        self.0.read(&mut out[..size])
    }
}
impl<R: Seek> Seek for CheckedReader<R> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        crate::operation::check().map_err(std::io::Error::other)?;
        self.0.seek(pos)
    }
}

/// Bound allocation and report long reads without trusting size metadata alone.
pub fn read_bounded(path: &Path, limit: u64, message: &str) -> Result<Vec<u8>, String> {
    let meta = path.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > limit {
        return Err("RESOURCE_LIMIT: File exceeds its read budget".into());
    }
    let mut reader = CheckedReader(std::fs::File::open(path).map_err(|e| e.to_string())?);
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut reported = 0u64;
    crate::operation::progress(0, Some(meta.len()), message);
    loop {
        let count = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        if (bytes.len() as u64).saturating_add(count as u64) > limit {
            return Err("RESOURCE_LIMIT: File grew beyond its read budget".into());
        }
        bytes.extend_from_slice(&buffer[..count]);
        if bytes.len() as u64 >= reported + MIB {
            reported = bytes.len() as u64;
            crate::operation::progress(reported, Some(meta.len()), message);
        }
    }
    crate::operation::progress(bytes.len() as u64, Some(meta.len()), message);
    Ok(bytes)
}
