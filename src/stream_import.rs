//! Streaming CSV ingestion. Excel retains the bounded, format-aware workbook reader.
use crate::{
    import::{self, Mapping, RawImport, RawTable},
    store::DataStore,
};
use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};
#[derive(Clone)]
pub struct PendingImport {
    pub id: String,
    pub sample: std::sync::Arc<RawImport>,
    pub path: PathBuf,
    pub bytes: u64,
    pub modified: Option<SystemTime>,
    pub counts: Vec<usize>,
    pub counts_exact: bool,
    pub streaming: bool,
}
pub type IngestReport = (usize, usize, Vec<(usize, String)>);
impl PendingImport {
    pub fn from_raw(path: &Path, raw: RawImport) -> Result<Self, String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let meta = path.metadata().map_err(|e| e.to_string())?;
        let counts = raw.tables.iter().map(|t| t.rows.len()).collect();
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|e| e.to_string())?;
        Ok(Self {
            id: random.iter().map(|v| format!("{v:02x}")).collect(),
            sample: std::sync::Arc::new(raw),
            path,
            bytes: meta.len(),
            modified: meta.modified().ok(),
            counts,
            counts_exact: true,
            streaming: false,
        })
    }
    pub fn preview(path: &Path, delimiter: u8) -> Result<Self, String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let meta = path.metadata().map_err(|e| e.to_string())?;
        crate::input_limits::ensure(&path)?;
        let streaming = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("csv") || e.eq_ignore_ascii_case("tsv"));
        let (sample, counts, counts_exact) = if streaming {
            let delimiter = if delimiter == 0 {
                import::detect_delimiter(&path)?
            } else {
                delimiter
            };
            let mut sample = RawTable {
                sheet: "CSV".into(),
                headers: vec![],
                rows: vec![],
                row_numbers: vec![],
            };
            let mut count = 0;
            let exact = scan_csv(
                &path,
                delimiter,
                Some((1000, 4 * 1024 * 1024)),
                |headers, row, index| {
                    if index == 0 {
                        sample.headers = headers.to_vec();
                    } else {
                        count += 1;
                        sample.rows.push(row.to_vec());
                        sample.row_numbers.push(index + 1);
                    }
                    Ok(())
                },
            )?;
            (
                RawImport {
                    source: path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into(),
                    tables: vec![sample],
                    delimiter: Some(delimiter),
                },
                vec![count],
                exact,
            )
        } else {
            let raw = import::read_file(&path, delimiter)?;
            let counts = raw.tables.iter().map(|t| t.rows.len()).collect();
            (raw, counts, true)
        };
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|e| e.to_string())?;
        Ok(Self {
            id: random.iter().map(|v| format!("{v:02x}")).collect(),
            sample: std::sync::Arc::new(sample),
            path,
            bytes: meta.len(),
            modified: meta.modified().ok(),
            counts,
            counts_exact,
            streaming,
        })
    }
    pub fn check(&self) -> Result<(), String> {
        // Streaming tickets reread their source, so possession of a ticket
        // cannot grant access beyond the current caller's filesystem root.
        // Bounded GIS/Excel samples are already loaded and do not reread it.
        if self.streaming {
            if let Some(root) = crate::operation::scope() {
                crate::mcp::scoped(
                    self.path.to_str().ok_or("Invalid import source path")?,
                    &root,
                    false,
                )?;
            }
        }
        if self.path.canonicalize().map_err(|e| e.to_string())? != self.path {
            return Err("Import path changed after preview; preview it again".into());
        }
        let meta = self.path.metadata().map_err(|e| e.to_string())?;
        if meta.len() != self.bytes || meta.modified().ok() != self.modified {
            return Err("Import file changed after preview; preview it again".into());
        }
        Ok(())
    }
    pub fn ingest(
        &self,
        sheet: usize,
        mapping: &Mapping,
        store: &DataStore,
        first_id: u64,
    ) -> Result<IngestReport, String> {
        self.ingest_aggregated(sheet, mapping, store, first_id, None, None)
    }
    pub fn ingest_aggregated(
        &self,
        sheet: usize,
        mapping: &Mapping,
        store: &DataStore,
        first_id: u64,
        aggregation: Option<crate::aggregation::Options>,
        target_source: Option<&str>,
    ) -> Result<IngestReport, String> {
        self.ingest_reporting(
            sheet,
            mapping,
            store,
            first_id,
            aggregation,
            target_source,
            &mut |_, _, _| Ok(()),
        )
    }
    #[allow(clippy::too_many_arguments)] // Streaming options plus the rejected-row callback.
    pub fn ingest_reporting(
        &self,
        sheet: usize,
        mapping: &Mapping,
        store: &DataStore,
        first_id: u64,
        aggregation: Option<crate::aggregation::Options>,
        target_source: Option<&str>,
        rejected_row: &mut import::RejectedRow<'_>,
    ) -> Result<IngestReport, String> {
        self.check()?;
        let mut accumulator = aggregation
            .map(|o| crate::aggregation::Accumulator::new(store.directory(), o))
            .transpose()?;
        let table = self.sample.tables.get(sheet).ok_or("Invalid sheet")?;
        let mut accepted = 0;
        let mut rejected = 0;
        let mut reasons = vec![];
        let mut raw_seen = 0u64;
        let bulk = accumulator.is_none() && store.count()? == 0;
        let mut flush = |batch: &RawTable| -> Result<(), String> {
            crate::operation::check()?;
            crate::operation::progress(raw_seen, None, "Converting events");
            let mut report = import::convert_reporting(
                batch,
                mapping,
                &self.sample.source,
                first_id
                    .checked_add(raw_seen)
                    .ok_or("Event ID capacity exhausted")?,
                rejected_row,
            )?;
            if let Some(target) = target_source {
                for event in &mut report.events {
                    import::assign_layer(event, target);
                }
            }
            raw_seen = raw_seen
                .checked_add(batch.rows.len() as u64)
                .ok_or("Event ID capacity exhausted")?;
            accepted += report.events.len();
            rejected += report.rejected_count;
            for r in report.rejected {
                if reasons.len() < 1000 {
                    reasons.push(r)
                }
            }
            if bulk {
                store.insert_import_batch(&report.events)?;
            } else {
                for event in report.events {
                    if let Some(accumulator) = accumulator.as_mut() {
                        accumulator.push(&event)?;
                    } else {
                        store.insert(&event)?;
                    }
                }
            }
            Ok(())
        };
        store
            .connection
            .execute_batch("SAVEPOINT ingestion")
            .map_err(|e| e.to_string())?;
        let result = (|| {
            if bulk {
                store.begin_bulk_import()?;
            }
            if self.streaming {
                let mut batch = RawTable {
                    sheet: table.sheet.clone(),
                    headers: table.headers.clone(),
                    rows: vec![],
                    row_numbers: vec![],
                };
                let header_bytes = table.headers.iter().map(|h| h.len() + 32).sum::<usize>();
                let mut batch_bytes = 0usize;
                visit_csv(
                    &self.path,
                    self.sample.delimiter.unwrap(),
                    |_, row, index| {
                        if index > 0 {
                            let bytes =
                                row.iter().map(|v| v.len() + 24).sum::<usize>() + header_bytes;
                            if !batch.rows.is_empty()
                                && batch_bytes.saturating_add(bytes) > 4 * 1024 * 1024
                            {
                                flush(&batch)?;
                                batch.rows.clear();
                                batch.row_numbers.clear();
                                batch_bytes = 0;
                            }
                            batch_bytes = batch_bytes.saturating_add(bytes);
                            batch.rows.push(row.to_vec());
                            batch.row_numbers.push(index + 1);
                            if batch.rows.len() >= 1000 {
                                flush(&batch)?;
                                batch.rows.clear();
                                batch.row_numbers.clear();
                                batch_bytes = 0;
                            }
                        }
                        Ok(())
                    },
                )?;
                if !batch.rows.is_empty() {
                    flush(&batch)?
                }
            } else {
                for start in (0..table.rows.len()).step_by(1000) {
                    let end = (start + 1000).min(table.rows.len());
                    flush(&RawTable {
                        sheet: table.sheet.clone(),
                        headers: table.headers.clone(),
                        rows: table.rows[start..end].to_vec(),
                        row_numbers: table.row_numbers[start..end].to_vec(),
                    })?
                }
            }
            self.check()?;
            if bulk {
                store.finish_bulk_import()?;
            }
            Ok(())
        })();
        let result = result.and_then(|()| {
            if let Some(accumulator) = accumulator.as_ref() {
                accumulator.write(store)?;
            }
            Ok(())
        });
        match result {
            Ok(()) => {
                store
                    .connection
                    .execute_batch("RELEASE ingestion")
                    .map_err(|e| e.to_string())?;
                store.checkpoint()?;
                Ok((accepted, rejected, reasons))
            }
            Err(e) => {
                let _ = store
                    .connection
                    .execute_batch("ROLLBACK TO ingestion; RELEASE ingestion");
                Err(e)
            }
        }
    }
}
fn visit_csv(
    path: &Path,
    delimiter: u8,
    visit: impl FnMut(&[String], &[String], usize) -> Result<(), String>,
) -> Result<(), String> {
    scan_csv(path, delimiter, None, visit).map(|_| ())
}
fn scan_csv(
    path: &Path,
    delimiter: u8,
    sample_limit: Option<(usize, usize)>,
    mut visit: impl FnMut(&[String], &[String], usize) -> Result<(), String>,
) -> Result<bool, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let guard = RecordGuard {
        reader: std::io::BufReader::new(file),
        quoted: false,
        quote_pending: false,
        field_start: true,
        delimiter,
        bom: 0,
        length: 0,
        total: 0,
    };
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .from_reader(guard);
    let raw: Vec<_> = reader
        .headers()
        .map_err(|e| e.to_string())?
        .iter()
        .map(str::to_owned)
        .collect();
    let headers = import::unique_headers(raw);
    if headers.is_empty() || headers.len() > 512 {
        return Err("CSV requires 1–512 header columns".into());
    }
    visit(&headers, &[], 0)?;
    let mut records = reader.records();
    let mut index = 0;
    let mut sample_bytes = 0usize;
    loop {
        if sample_limit.is_some_and(|(rows, bytes)| index >= rows || sample_bytes >= bytes) {
            return Ok(false);
        }
        let Some(row) = records.next() else {
            return Ok(true);
        };
        crate::operation::check()?;
        if index % 10000 == 0 {
            crate::operation::progress(index as u64, None, "Reading events");
        }
        if index >= 50_000_000 {
            return Err("Import exceeds the 50 million event budget".into());
        }
        let row = row.map_err(|e| format!("Malformed CSV: {e}"))?;
        let row: Vec<_> = row.iter().map(str::to_owned).collect();
        let bytes = row.iter().map(String::len).sum::<usize>();
        if sample_limit.is_some_and(|(_, max)| sample_bytes.saturating_add(bytes) > max) {
            return Ok(false);
        }
        visit(&headers, &row, index + 1)?;
        sample_bytes = sample_bytes.saturating_add(bytes);
        index += 1;
    }
}
// Bound each physical/logical record before csv can grow its record allocation.
struct RecordGuard<R> {
    reader: R,
    quoted: bool,
    quote_pending: bool,
    field_start: bool,
    delimiter: u8,
    bom: u8,
    length: usize,
    total: u64,
}
impl<R: std::io::Read> std::io::Read for RecordGuard<R> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        crate::operation::check().map_err(std::io::Error::other)?;
        let count = self.reader.read(out)?;
        self.total = self.total.saturating_add(count as u64);
        if self.total > crate::input_limits::MAX_INPUT {
            return Err(std::io::Error::other(
                "RESOURCE_LIMIT: CSV grew beyond the 2 GiB read budget",
            ));
        }
        for &byte in &out[..count] {
            self.length += 1;
            let skip_bom = match (self.bom, byte) {
                (0, 0xef) => {
                    self.bom = 1;
                    true
                }
                (1, 0xbb) => {
                    self.bom = 2;
                    true
                }
                (2, 0xbf) => {
                    self.bom = 3;
                    true
                }
                _ => {
                    self.bom = 3;
                    false
                }
            };
            if !skip_bom {
                let mut outside = !self.quoted;
                if self.quoted {
                    if self.quote_pending {
                        if byte == b'"' {
                            self.quote_pending = false;
                        } else {
                            self.quoted = false;
                            self.quote_pending = false;
                            outside = true;
                        }
                    } else if byte == b'"' {
                        self.quote_pending = true;
                    }
                }
                if outside {
                    if byte == b'"' && self.field_start {
                        self.quoted = true;
                        self.field_start = false;
                    } else if byte == self.delimiter {
                        self.field_start = true;
                    } else if byte == b'\n' || byte == b'\r' {
                        self.length = 0;
                        self.field_start = true;
                    } else {
                        self.field_start = false;
                    }
                }
            }
            if self.length > 1024 * 1024 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "CSV logical record exceeds 1 MiB",
                ));
            }
        }
        Ok(count)
    }
}
