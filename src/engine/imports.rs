//! Import tickets, validation and publication, separate from presentation.
use super::*;
impl Engine {
    pub(super) fn import_invoke(&self, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "import_preview" | "gis_import_preview" => {
                let delimiter = args["delimiter"]
                    .as_str()
                    .filter(|s| *s != "auto")
                    .unwrap_or("")
                    .as_bytes()
                    .first()
                    .copied()
                    .unwrap_or(0);
                let pending = if command == "gis_import_preview" {
                    let id: String = arg(&args, "id")?;
                    let layer = self.gis_layer(&id)?;
                    let raw = crate::gis::raw_from_layer(&layer)?;
                    crate::stream_import::PendingImport::from_raw(&layer.asset, raw)?
                } else {
                    let path: String = arg(&args, "path")?;
                    crate::stream_import::PendingImport::preview(Path::new(&path), delimiter)?
                };
                let sheets: Vec<_> = pending.sample.tables.iter().enumerate().map(|(i, t)| {
                    let detection = Mapping::detect(t);
                    let sample = RawTable { sheet: t.sheet.clone(), headers: t.headers.clone(), rows: t.rows.iter().take(6).cloned().collect(), row_numbers: t.row_numbers.iter().take(6).copied().collect() };
                    let normalized = import::convert(&sample, &detection.mapping, &pending.sample.source, 1).ok().map(|r| json!({"events":r.events.into_iter().map(preview_event).collect::<Vec<_>>(),"rejected":r.rejected,"sample_only":true,"text_limit_bytes":256}));
                    json!({"sheet":t.sheet,"headers":t.headers,"count":pending.counts[i],"preview":sample.rows.iter().map(|row|row.iter().map(|v|preview_text(v)).collect::<Vec<_>>()).collect::<Vec<_>>(),"preview_text_limit_bytes":256,"mapping":detection.mapping,"notes":detection.notes,"warnings":detection.warnings,"normalized":normalized,"fields":import::field_feedback(&sample, &detection.mapping)})
                }).collect();
                let result = json!({"import_id":pending.id,"source":pending.sample.source,"delimiter":pending.sample.delimiter.map(|b|char::from(b).to_string()),"sheets":sheets,"storage":"disk","streaming":pending.streaming});
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                if !pending.streaming {
                    s.pending.retain(|p| p.streaming);
                }
                if s.pending.len() >= 4 {
                    s.pending.remove(0);
                }
                s.pending.push(pending);
                Ok(result)
            }
            "import_validate" => {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let pending = if let Some(id) = args["import_id"].as_str() {
                    s.pending.iter().find(|p| p.id == id)
                } else {
                    s.pending.last()
                }
                .ok_or("Preview a file first (import ticket missing or expired)")?;
                pending.check()?;
                let table = pending
                    .sample
                    .tables
                    .get(args["sheet"].as_u64().unwrap_or(0) as usize)
                    .ok_or("Invalid sheet")?;
                let sample = RawTable {
                    sheet: table.sheet.clone(),
                    headers: table.headers.clone(),
                    rows: table.rows.iter().take(6).cloned().collect(),
                    row_numbers: table.row_numbers.iter().take(6).copied().collect(),
                };
                let mapping: Mapping = arg(&args, "mapping")?;
                let result = import::convert(&sample, &mapping, &pending.sample.source, 1);
                // Interactive callers need feedback even when a required mapping
                // is absent. Preserve the error contract for existing API users.
                if !args["field_feedback"].as_bool().unwrap_or(false) {
                    let r = result?;
                    return Ok(
                        json!({"events":r.events.into_iter().map(preview_event).collect::<Vec<_>>(),"rejected":r.rejected,"import_id":pending.id,"sample_only":true,"text_limit_bytes":256}),
                    );
                }
                let (events, rejected, error) = match result {
                    Ok(r) => (
                        r.events.into_iter().map(preview_event).collect::<Vec<_>>(),
                        r.rejected,
                        None,
                    ),
                    Err(error) => (Vec::new(), Vec::new(), Some(error)),
                };
                Ok(
                    json!({"events":events,"rejected":rejected,"error":error,"fields":import::field_feedback(&sample, &mapping),"import_id":pending.id,"sample_only":true,"text_limit_bytes":256}),
                )
            }
            "import_commit" => {
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let pending = if let Some(id) = args["import_id"].as_str() {
                    s.pending.iter().find(|p| p.id == id)
                } else {
                    s.pending.last()
                }
                .ok_or("Preview a file first (import ticket missing or expired)")?
                .clone();
                let sheet = args["sheet"].as_u64().unwrap_or(0) as usize;
                let table = pending.sample.tables.get(sheet).ok_or("Invalid sheet")?;
                let mapping = args
                    .get("mapping")
                    .map(|m| {
                        serde_json::from_value::<Mapping>(m.clone()).map_err(|e| e.to_string())
                    })
                    .transpose()?
                    .unwrap_or_else(|| Mapping::detect(table).mapping);
                let mut staged = crate::store::DataStore::new(&self.data_dir)?;
                let append = args["append"].as_bool().unwrap_or(false);
                let target_source = args["target_source"].as_str();
                if let Some(target) = target_source {
                    if !append {
                        return Err("INVALID_ARGUMENT: merging into a layer requires append".into());
                    }
                    if !s.store.has_source(target)? {
                        return Err("INVALID_ARGUMENT: target layer no longer exists".into());
                    }
                }
                let previous_count = if append { s.store.count()? } else { 0 };
                if append
                    && args.get("aggregation").is_none()
                    && previous_count.saturating_add(pending.counts[sheet]) > 50_000_000
                {
                    return Err("RESOURCE_LIMIT: append exceeds the 50 million event budget".into());
                }
                let first = if append {
                    s.store
                        .max_id()?
                        .checked_add(1)
                        .ok_or("Event ID capacity exhausted")?
                } else {
                    1
                };
                if append {
                    s.store.clone_empty_into(&mut staged)?;
                }
                let (accepted, rejected, reasons) = pending.ingest_aggregated(
                    sheet,
                    &mapping,
                    &staged,
                    first,
                    args.get("aggregation")
                        .map(|v| serde_json::from_value(v.clone()).map_err(|e| e.to_string()))
                        .transpose()?,
                    target_source,
                )?;
                if rejected > 0 && !args["accept_rejected"].as_bool().unwrap_or(false) {
                    return Ok(
                        json!({"needs_review":true,"accepted":accepted,"rejected":rejected,"reasons":reasons,"import_id":pending.id}),
                    );
                }
                if accepted == 0 {
                    return Err("No valid rows to import".into());
                }
                let retained = staged.count()?.saturating_sub(previous_count);
                if append {
                    if staged.count()? > 50_000_000 {
                        return Err(
                            "RESOURCE_LIMIT: append exceeds the 50 million event budget".into()
                        );
                    }
                } else {
                    let gis_layers = std::mem::take(&mut s.project.gis_layers);
                    s.project = Project::new(Dataset {
                        name: pending.sample.source.clone(),
                        events: vec![],
                    });
                    s.project.gis_layers = gis_layers;
                    if !s.project.gis_layers.is_empty() {
                        s.project.version = 5;
                    }
                }
                let old = std::mem::replace(&mut s.store, staged);
                s.previous_store = Some(old);
                if s.store.has_centroids()? {
                    s.project.version = 5;
                }
                s.project.imports.push(ImportRecipe {
                    source: pending.sample.source.clone(),
                    sheet: table.sheet.clone(),
                    mapping,
                });
                s.project.filter = Filter::default();
                s.project.selected.clear();
                s.pending.retain(|p| p.id != pending.id);
                Ok(
                    json!({"accepted":accepted,"retained":retained,"aggregated":accepted-retained,"aggregation":args.get("aggregation"),"rejected":rejected,"reasons":reasons,"storage":"sqlite"}),
                )
            }
            "import_review" | "import_rejections_export" => self.review_import(command, args),
            _ => Err("Unknown import command".into()),
        }
    }
}

impl Engine {
    fn review_import(&self, command: &str, args: Value) -> Result<Value, String> {
        let pending = {
            let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            s.pending
                .iter()
                .find(|p| Some(p.id.as_str()) == args["import_id"].as_str())
                .ok_or("Preview a file first (import ticket missing or expired)")?
                .clone()
        };
        pending.check()?;
        let mapping: Mapping = arg(&args, "mapping")?;
        let sheet = args["sheet"].as_u64().unwrap_or(0) as usize;
        let table = pending.sample.tables.get(sheet).ok_or("Invalid sheet")?;
        let output = if command == "import_rejections_export" {
            let path = PathBuf::from(arg::<String>(&args, "path")?);
            if !path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("csv"))
            {
                return Err(
                    "INVALID_ARGUMENT: rejection reports require a .csv destination".into(),
                );
            }
            if path
                .symlink_metadata()
                .is_ok_and(|m| m.file_type().is_symlink())
                || path.canonicalize().is_ok_and(|p| p == pending.path)
            {
                return Err(
                    "INVALID_ARGUMENT: report destination must not replace the source or a symlink"
                        .into(),
                );
            }
            if path.exists() && !args["overwrite"].as_bool().unwrap_or(false) {
                return Err("CONFLICT: report destination exists; choose another filename".into());
            }
            Some(path)
        } else {
            None
        };
        let mut file = output
            .as_ref()
            .map(|p| {
                tempfile::NamedTempFile::new_in(
                    p.parent()
                        .filter(|p| !p.as_os_str().is_empty())
                        .unwrap_or(Path::new(".")),
                )
                .map_err(|e| e.to_string())
            })
            .transpose()?;
        let mut writer = file
            .as_mut()
            .map(|f| csv::Writer::from_writer(f.as_file_mut()));
        if let Some(w) = writer.as_mut() {
            w.write_record(
                ["source", "worksheet", "source_row", "reason"]
                    .into_iter()
                    .map(str::to_owned)
                    .chain(table.headers.iter().map(|name| format!("original:{name}"))),
            )
            .map_err(|e| e.to_string())?;
        }
        let safe = |text: &str| {
            if text
                .trim_start()
                .starts_with(['=', '+', '-', '@', '\t', '\r', '\n'])
            {
                format!("'{text}")
            } else {
                text.to_owned()
            }
        };
        let staged = crate::store::DataStore::new(&self.data_dir)?;
        let (accepted, rejected, reasons) = pending.ingest_reporting(
            sheet,
            &mapping,
            &staged,
            1,
            None,
            None,
            &mut |row, cells, reason| {
                if let Some(w) = writer.as_mut() {
                    w.write_record(
                        [
                            safe(&pending.sample.source),
                            safe(&table.sheet),
                            row.to_string(),
                            safe(reason),
                        ]
                        .into_iter()
                        .chain(cells.iter().map(|cell| safe(cell))),
                    )
                    .map_err(|e| e.to_string())?;
                }
                Ok(())
            },
        )?;
        crate::operation::progress(
            accepted as u64,
            Some(accepted as u64),
            "Checking locations and duplicate candidates",
        );
        let missing: usize = staged
            .connection
            .query_row(
                "SELECT count(*) FROM events e WHERE NOT EXISTS (SELECT 1 FROM spatial s WHERE s.r=e.r)",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let duplicates: usize = staged.connection.query_row(
            "SELECT coalesce(sum(n-1),0) FROM (SELECT count(*) n FROM events GROUP BY entity,time,t_end,lat,lon,category,label,value,related_to,geometry_wkt HAVING count(*)>1)",
            [], |r| r.get(0)
        ).map_err(|e| e.to_string())?;
        pending.check()?;
        self.check_workspace()?;
        crate::operation::check()?;
        if let Some(w) = writer.as_mut() {
            w.flush().map_err(|e| e.to_string())?;
        }
        drop(writer);
        let mut result = json!({"import_id":pending.id,"accepted":accepted,"rejected":rejected,
            "missing_locations":missing,"duplicate_candidates":duplicates,
            "reasons_limited":reasons.len()<rejected,"reasons":reasons,
            "duplicate_definition":"Matching canonical entity, timestamp interval, location/geometry, category, label, value and related entity; original attributes may differ. Candidates are retained.",
            "full_file":true,"source":pending.sample.source,"sheet":table.sheet});
        if let (Some(path), Some(file)) = (output, file) {
            file.as_file().sync_all().map_err(|e| e.to_string())?;
            if args["overwrite"].as_bool().unwrap_or(false) {
                file.persist(&path).map_err(|e| e.to_string())?;
            } else {
                file.persist_noclobber(&path).map_err(|e| e.to_string())?;
            }
            crate::operation::file_committed();
            result["path"] = json!(path);
            result["exported"] = json!(rejected);
        }
        Ok(result)
    }
}
