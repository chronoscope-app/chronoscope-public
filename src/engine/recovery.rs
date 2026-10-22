//! Session-local lifecycle and recovery. Checkpoints commit metadata into the
//! existing WAL database; no event copy is made during background saves.
use super::*;
use std::{
    fs,
    sync::{
        atomic::{AtomicBool, Ordering},
        Weak,
    },
    time::{Duration, Instant},
};
#[derive(Clone)]
struct Status {
    dirty: bool,
    revision: u64,
    checkpoint: Option<u64>,
    changed: Instant,
    source: Option<PathBuf>,
    error: Option<String>,
    autosave_path: Option<PathBuf>,
    autosave_revision: Option<u64>,
    document: u64,
}
pub(super) struct Lifecycle {
    session: String,
    status: Mutex<Status>,
    started: AtomicBool,
}
impl Lifecycle {
    pub(super) fn new() -> Result<Self, String> {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|e| e.to_string())?;
        Ok(Self {
            session: random.iter().map(|b| format!("{b:02x}")).collect(),
            status: Mutex::new(Status {
                dirty: false,
                revision: 1,
                checkpoint: None,
                changed: Instant::now(),
                source: None,
                error: None,
                autosave_path: None,
                autosave_revision: None,
                document: 0,
            }),
            started: AtomicBool::new(false),
        })
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u32,
    session: String,
    database: PathBuf,
    revision: u64,
    name: String,
    updated: String,
    source: Option<PathBuf>,
}
fn descriptor(dir: &Path, session: &str) -> PathBuf {
    dir.join(format!("recovery-{session}.json"))
}
fn read_record(dir: &Path, id: &str) -> Result<Record, String> {
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid recovery ID".into());
    }
    let bytes = fs::read(descriptor(dir, id)).map_err(|_| "Recovery checkpoint not found")?;
    if bytes.len() > 32768 {
        return Err("Invalid recovery descriptor size".into());
    }
    let record: Record =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid recovery descriptor")?;
    let parts = record.database.components().collect::<Vec<_>>();
    if record.version != 1
        || record.session != id
        || parts.len() != 2
        || record.database.is_absolute()
        || !parts[0]
            .as_os_str()
            .to_string_lossy()
            .starts_with("workspace-")
        // Older releases used the other basename; keep their crash recovery
        // checkpoints readable without relaxing directory/path validation.
        || (parts[1].as_os_str() != "events.sqlite"
            && parts[1].as_os_str() != "observations.sqlite")
    {
        return Err("Invalid recovery database path".into());
    }
    let root = dir.canonicalize().map_err(|e| e.to_string())?;
    let path = dir
        .join(&record.database)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !path.starts_with(root) {
        return Err("Recovery database is outside the data directory".into());
    }
    Ok(record)
}
fn lease(dir: &Path, record: &Record) -> Result<fs::File, String> {
    let path = dir.join(&record.database).parent().unwrap().join(".lease");
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|_| "Recovery lease unavailable")?;
    file.try_lock()
        .map_err(|_| "CONFLICT: this workspace is still open in another process")?;
    Ok(file)
}
impl Engine {
    pub fn workspace_dirty(&self) -> bool {
        self.lifecycle
            .status
            .lock()
            .map(|s| s.dirty)
            .unwrap_or(true)
    }
    pub(super) fn lifecycle_changed(
        &self,
        command: &str,
        revision: u64,
        path: Option<&str>,
        new_document: bool,
    ) -> Result<(), String> {
        if matches!(command, "save" | "open") {
            self.recovery_clear()?;
            let mut status = self
                .lifecycle
                .status
                .lock()
                .map_err(|_| "Lifecycle unavailable")?;
            status.source = path.map(PathBuf::from);
            status.revision = revision;
            return Ok(());
        }
        if !crate::command::Command::parse(command).is_some_and(|c| c.effects().dirty) {
            return Ok(());
        }
        {
            let mut status = self
                .lifecycle
                .status
                .lock()
                .map_err(|_| "Lifecycle unavailable")?;
            if new_document {
                status.source = None;
                status.autosave_path = None;
                status.autosave_revision = None;
                status.document += 1;
            }
            status.dirty = true;
            status.revision = revision;
            status.changed = Instant::now();
        }
        if !self.lifecycle.started.swap(true, Ordering::Relaxed) {
            let lifecycle = Arc::downgrade(&self.lifecycle);
            let state = Arc::downgrade(&self.state);
            let gate = Arc::downgrade(&self.operation);
            let dir = self.data_dir.clone();
            std::thread::spawn(move || checkpoint_loop(lifecycle, state, gate, dir));
        }
        Ok(())
    }
    /// Force the latest committed workspace state into its recovery checkpoint.
    pub fn recovery_checkpoint(&self) -> Result<Value, String> {
        let _gate = self.operation.lock().map_err(|_| "Workspace unavailable")?;
        checkpoint(&self.lifecycle, &self.state, &self.data_dir)?;
        self.workspace_status()
    }
    pub fn workspace_status(&self) -> Result<Value, String> {
        let s = self
            .lifecycle
            .status
            .lock()
            .map_err(|_| "Lifecycle unavailable")?;
        Ok(
            json!({"dirty":s.dirty,"source":s.source,"revision":self.revision_counter.load(Ordering::Acquire),"checkpoint_revision":s.checkpoint,"recovery_error":s.error,"autosave":"Working database checkpoints after 2 seconds; automatic document copies every 30 seconds and before leaving a workspace.","auto_save_unsaved":read_preferences(&self.data_dir).auto_save_unsaved,"document_directory":document_directory(&self.data_dir),"autosave_path":s.autosave_path,"autosave_revision":s.autosave_revision}),
        )
    }
    pub fn recovery_clear(&self) -> Result<(), String> {
        match fs::remove_file(descriptor(&self.data_dir, &self.lifecycle.session)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
        s.store.retain_recovery(false);
        for h in s.undo.iter().chain(s.redo.iter()) {
            if let Some(store) = &h.replacement {
                store.retain_recovery(false);
            }
        }
        drop(s);
        let mut status = self
            .lifecycle
            .status
            .lock()
            .map_err(|_| "Lifecycle unavailable")?;
        status.dirty = false;
        status.checkpoint = None;
        status.error = None;
        status.autosave_path = None;
        status.autosave_revision = None;
        status.document += 1;
        Ok(())
    }
    pub fn recovery_list(&self) -> Result<Value, String> {
        let mut records = vec![];
        for entry in fs::read_dir(&self.data_dir)
            .map_err(|e| e.to_string())?
            .flatten()
            .take(10000)
        {
            let name = entry.file_name();
            let Some(id) = name
                .to_str()
                .and_then(|s| s.strip_prefix("recovery-"))
                .and_then(|s| s.strip_suffix(".json"))
            else {
                continue;
            };
            if let Ok(r) = read_record(&self.data_dir, id) {
                if let Ok(_lease) = lease(&self.data_dir, &r) {
                    records.push(json!({"id":r.session,"name":r.name,"updated":r.updated,"revision":r.revision,"source":r.source}));
                }
            }
        }
        records.sort_by(|a, b| b["updated"].as_str().cmp(&a["updated"].as_str()));
        Ok(json!({"checkpoints":records}))
    }
    pub(super) fn recovery_invoke(&self, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "autosave_unsaved" => {
                if read_preferences(&self.data_dir).auto_save_unsaved {
                    checkpoint(&self.lifecycle, &self.state, &self.data_dir)?;
                    let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                    let mut status = self
                        .lifecycle
                        .status
                        .lock()
                        .map_err(|_| "Lifecycle unavailable")?;
                    if status.dirty && status.autosave_revision != Some(s.revision) {
                        let directory = document_directory(&self.data_dir);
                        let path = status.autosave_path.clone().unwrap_or_else(|| {
                            directory.join(format!(
                                "Autosaved-{}-{}-{}.chronoscope",
                                chrono::Utc::now().format("%Y%m%d-%H%M%S"),
                                self.lifecycle.session,
                                status.document
                            ))
                        });
                        let mut project = s.project.clone();
                        project.workspace = Some(WorkspaceSettings {
                            preferences: s.preferences.clone(),
                            terrain_files: vec![],
                        });
                        s.store.save_autosave(&path, &project)?;
                        status.autosave_path = Some(path);
                        status.autosave_revision = Some(s.revision);
                    }
                }
                self.workspace_status()
            }
            "recovery_archive" => {
                let directory = document_directory(&self.data_dir);
                let mut archived = vec![];
                let mut errors = vec![];
                if read_preferences(&self.data_dir).auto_save_unsaved {
                    let records = self.recovery_list()?;
                    for item in records["checkpoints"].as_array().unwrap() {
                        let result = (|| -> Result<PathBuf, String> {
                            let record = read_record(&self.data_dir, item["id"].as_str().unwrap())?;
                            let _lease = lease(&self.data_dir, &record)?;
                            let (store, project) = crate::store::DataStore::open_recovery(
                                &self.data_dir.join(&record.database),
                                &self.data_dir,
                            )?;
                            let path = directory.join(format!(
                                "Recovered-{}-r{}.chronoscope",
                                record.session, record.revision
                            ));
                            store.save_autosave(&path, &project)?;
                            // Retire the crash checkpoint only after the document is durable.
                            fs::remove_file(descriptor(&self.data_dir, &record.session))
                                .map_err(|e| e.to_string())?;
                            drop(_lease);
                            fs::remove_dir_all(
                                self.data_dir.join(&record.database).parent().unwrap(),
                            )
                            .map_err(|e| e.to_string())?;
                            Ok(path)
                        })();
                        match result {
                            Ok(path) => archived.push(path),
                            Err(error) => errors.push(error),
                        }
                    }
                }
                Ok(json!({"archived":archived,"errors":errors,"directory":directory}))
            }
            "workspace_status" => self.workspace_status(),
            "recovery_list" => self.recovery_list(),
            "recovery_checkpoint" => {
                checkpoint(&self.lifecycle, &self.state, &self.data_dir)?;
                self.workspace_status()
            }
            "recovery_clear" => {
                self.recovery_clear()?;
                self.workspace_status()
            }
            "recovery_discard" => {
                let r = read_record(&self.data_dir, args["id"].as_str().unwrap())?;
                let _lease = lease(&self.data_dir, &r)?;
                fs::remove_file(descriptor(&self.data_dir, &r.session))
                    .map_err(|e| e.to_string())?;
                fs::remove_dir_all(self.data_dir.join(&r.database).parent().unwrap())
                    .map_err(|e| e.to_string())?;
                Ok(json!({"discarded":true}))
            }
            "recovery_restore" => {
                let r = read_record(&self.data_dir, args["id"].as_str().unwrap())?;
                let _lease = lease(&self.data_dir, &r)?;
                let (store, project) = crate::store::DataStore::open_recovery(
                    &self.data_dir.join(&r.database),
                    &self.data_dir,
                )?;
                let loaded = self.loaded_preferences(&project)?;
                let preferences = loaded.preferences.unwrap_or_default();
                let scene = project.scene.clone();
                {
                    let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                    let old = std::mem::replace(&mut s.store, store);
                    s.previous_store = Some(old);
                    s.project = project;
                    s.preferences = preferences;
                }
                *self.terrain.lock().map_err(|_| "Terrain unavailable")? = loaded.terrain;
                self.lifecycle
                    .status
                    .lock()
                    .map_err(|_| "Lifecycle unavailable")?
                    .source = r.source;
                // Preserve the source checkpoint until the restored working copy
                // has its own durable descriptor.
                Ok(json!({"restored":true,"scene":scene,"source_checkpoint":r.session}))
            }
            _ => Err("Unknown lifecycle operation".into()),
        }
    }
}
/// Custom data directories stay isolated (CLI, tests and separate profiles).
fn document_directory(data_dir: &Path) -> PathBuf {
    crate::platform::autosave_directory(data_dir)
}
fn checkpoint(lifecycle: &Lifecycle, state: &Mutex<State>, dir: &Path) -> Result<(), String> {
    let s = state.lock().map_err(|_| "Workspace unavailable")?;
    let mut status = lifecycle
        .status
        .lock()
        .map_err(|_| "Lifecycle unavailable")?;
    if !status.dirty || status.checkpoint == Some(s.revision) {
        return Ok(());
    }
    let mut project = s.project.clone();
    project.workspace = Some(WorkspaceSettings {
        preferences: s.preferences.clone(),
        terrain_files: vec![],
    });
    let database = s.store.write_recovery_metadata(&project)?;
    let relative = database
        .strip_prefix(dir)
        .map_err(|_| "Invalid recovery directory")?
        .to_path_buf();
    let record = Record {
        version: 1,
        session: lifecycle.session.clone(),
        database: relative,
        revision: s.revision,
        name: project.dataset.name.chars().take(256).collect(),
        updated: chrono::Utc::now().to_rfc3339(),
        source: status.source.clone(),
    };
    let mut file = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &record).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(descriptor(dir, &lifecycle.session))
        .map_err(|e| e.to_string())?;
    s.store.retain_recovery(true);
    for h in s.undo.iter().chain(s.redo.iter()) {
        if let Some(store) = &h.replacement {
            store.retain_recovery(false);
        }
    }
    status.checkpoint = Some(s.revision);
    status.error = None;
    Ok(())
}
fn checkpoint_loop(
    lifecycle: Weak<Lifecycle>,
    state: Weak<Mutex<State>>,
    gate: Weak<Mutex<()>>,
    dir: PathBuf,
) {
    let mut last = Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(250));
        let (Some(lifecycle), Some(state), Some(gate)) =
            (lifecycle.upgrade(), state.upgrade(), gate.upgrade())
        else {
            return;
        };
        let ready = lifecycle
            .status
            .lock()
            .map(|s| {
                s.dirty
                    && s.checkpoint != Some(s.revision)
                    && (s.changed.elapsed() >= Duration::from_secs(2)
                        || last.elapsed() >= Duration::from_secs(30))
            })
            .unwrap_or(false);
        if !ready {
            continue;
        }
        let Ok(_gate) = gate.try_lock() else { continue };
        if let Err(e) = checkpoint(&lifecycle, &state, &dir) {
            if let Ok(mut s) = lifecycle.status.lock() {
                s.error = Some(e);
                s.changed = Instant::now();
            }
        }
        last = Instant::now();
    }
}
