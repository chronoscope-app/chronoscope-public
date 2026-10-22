//! Workspace identity, resource policy and committed-change publication.
//! Startup, explicit Open and recovery all use the same validation boundary.
use super::*;

pub(super) fn validate_resources(
    project: &Project,
    data_dir: &Path,
    root: Option<&Path>,
) -> Result<(), String> {
    validate_context_budget(project)?;
    for layer in &project.gis_layers {
        crate::operation::check()?;
        crate::gis::validate_scoped_package(
            layer,
            data_dir,
            root,
            project.resource_dir.as_deref(),
        )?;
    }
    Ok(())
}

pub(super) fn prepare_terrain(
    project: &Project,
    preferences: &mut Preferences,
    root: Option<&Path>,
) -> (Option<TerrainCatalog>, Vec<String>) {
    let mut missing = vec![];
    let terrain = preferences.terrain_path.as_ref().and_then(|path| {
        let allowed = root.is_none_or(|root| {
            path.canonicalize().ok().is_some_and(|path| {
                within(&path, root)
                    || project
                        .resource_dir
                        .as_ref()
                        .is_some_and(|dir| within(&path, dir))
            })
        });
        if !allowed {
            missing.push("External terrain is outside the MCP filesystem root".into());
            return None;
        }
        match TerrainCatalog::load(path) {
            Ok(terrain) => Some(terrain),
            Err(error) => {
                missing.push(error);
                None
            }
        }
    });
    if !missing.is_empty() {
        preferences.terrain_path = None;
    }
    (terrain, missing)
}

pub(super) struct LoadedPresentation {
    pub preferences: Option<Preferences>,
    pub terrain: Option<TerrainCatalog>,
    pub missing: Vec<String>,
}

impl Engine {
    pub(crate) fn workspace_identity(&self) -> Result<String, String> {
        let state = self.state.lock().map_err(|_| "Workspace unavailable")?;
        Ok(self.workspace_identity_locked(&state))
    }

    pub(super) fn workspace_identity_locked(&self, state: &State) -> String {
        format!(
            "{}:{}",
            state.store.opaque_identity(),
            self.document_epoch
                .load(std::sync::atomic::Ordering::Acquire)
        )
    }

    pub(crate) fn check_workspace(&self) -> Result<(), String> {
        if let Some(expected) = crate::operation::workspace() {
            let state = self.state.lock().map_err(|_| "Workspace unavailable")?;
            self.check_workspace_state(&state, &expected)?;
        }
        Ok(())
    }

    pub(super) fn check_workspace_state(
        &self,
        state: &State,
        expected: &str,
    ) -> Result<(), String> {
        if self.workspace_identity_locked(state) != expected {
            return Err("CONFLICT: workspace changed during the request; start a new request for the current project".into());
        }
        Ok(())
    }

    pub(super) fn check_workspace_locked(&self, state: &State) -> Result<(), String> {
        if let Some(expected) = crate::operation::workspace() {
            self.check_workspace_state(state, &expected)?;
        }
        Ok(())
    }

    pub(super) fn validate_loaded_resources(&self, project: &Project) -> Result<(), String> {
        let root = crate::operation::intersect_scopes(
            crate::operation::scope(),
            self.terrain_scope.clone(),
        )?;
        validate_resources(project, &self.data_dir, root.as_deref())
    }

    pub(super) fn loaded_preferences(
        &self,
        project: &Project,
    ) -> Result<LoadedPresentation, String> {
        self.validate_loaded_resources(project)?;
        let root = crate::operation::intersect_scopes(
            crate::operation::scope(),
            self.terrain_scope.clone(),
        )?;
        let mut preferences = project.workspace.as_ref().map(|w| w.preferences.clone());
        let (terrain, missing) = if let Some(prefs) = &mut preferences {
            prefs.auto_save_unsaved = read_preferences(&self.data_dir).auto_save_unsaved;
            prepare_terrain(project, prefs, root.as_deref())
        } else {
            (None, vec![])
        };
        Ok(LoadedPresentation {
            preferences,
            terrain,
            missing,
        })
    }

    pub(super) fn load_workspace(&self, path: &Path) -> Result<Value, String> {
        let (store, mut project) = if crate::store::DataStore::is_database(path) {
            let root = crate::operation::intersect_scopes(
                crate::operation::scope(),
                self.terrain_scope.clone(),
            )?;
            let open = || crate::store::DataStore::open_copy(path, &self.data_dir);
            if let Some(root) = root {
                crate::operation::with_scope(root, open)?
            } else {
                open()?
            }
        } else {
            let mut project = project::load_with_resources(path, &self.data_dir)?;
            let mut store = crate::store::DataStore::new(&self.data_dir)?;
            store.load_events(std::mem::take(&mut project.dataset.events))?;
            (store, project)
        };
        let loaded = self.loaded_preferences(&project)?;
        project.dataset.events.clear();
        crate::operation::check()?;
        let mut state = self.state.lock().map_err(|_| "Workspace unavailable")?;
        let mut live_terrain = self.terrain.lock().map_err(|_| "Terrain unavailable")?;
        let old = std::mem::replace(&mut state.store, store);
        state.previous_store = Some(old);
        state.project = project;
        if let Some(preferences) = loaded.preferences {
            state.preferences = preferences;
        }
        *live_terrain = loaded.terrain;
        state.pending.clear();
        Ok(json!({"ok":true,"scene":state.project.scene,"missing_resources":loaded.missing}))
    }

    pub fn from_path(path: &Path, data_dir: PathBuf, root: Option<&Path>) -> Result<Self, String> {
        let engine = Self::new_with_terrain_scope(Project::empty(), data_dir, root)?;
        engine.load_workspace(path)?;
        {
            let mut state = engine.state.lock().map_err(|_| "Workspace unavailable")?;
            state.previous_store = None;
            // Legacy startup files without workspace settings inherit user
            // preferences, just like constructing the engine from that Project.
            if state.project.workspace.is_none() {
                let State {
                    project,
                    preferences,
                    ..
                } = &mut *state;
                let (terrain, _) = prepare_terrain(project, preferences, root);
                *engine.terrain.lock().map_err(|_| "Terrain unavailable")? = terrain;
            }
        }
        engine.lifecycle_changed(
            "open",
            1,
            path.canonicalize().ok().as_ref().and_then(|p| p.to_str()),
            false,
        )?;
        Ok(engine)
    }

    pub(super) fn update_preferences(
        &self,
        updates: Value,
        reload_terrain: bool,
    ) -> Result<Preferences, String> {
        let current = self
            .state
            .lock()
            .map_err(|_| "Workspace unavailable")?
            .preferences
            .clone();
        let mut value = serde_json::to_value(&current).map_err(|e| e.to_string())?;
        for (key, value_new) in updates.as_object().unwrap() {
            value[key] = value_new.clone();
        }
        // The stack is authoritative; preserve a single-map mirror for old readers.
        // Old map-only clients update the bottom layer without deleting other sources.
        if updates.get("map").is_some() && updates.get("map_layers").is_none() {
            let map = value["map"].clone();
            if let Some(layers) = value["map_layers"].as_array_mut() {
                if let Some(first) = layers.first_mut() {
                    first["config"] = map;
                    first["server_name"] = json!("WMTS");
                } else if map["enabled"] == true {
                    layers.push(json!({"id":"legacy-map","name":map["layer"],"server_name":"WMTS","config":map,"opacity":1.0,"min_zoom":0.0,"max_zoom":30.0}));
                }
            }
        }
        if let Some(layers) = value["map_layers"].as_array() {
            let active = layers.iter().find(|l| l["config"]["enabled"] == true);
            let mut mirror = active
                .or_else(|| layers.first())
                .map(|l| l["config"].clone())
                .unwrap_or_else(|| value["map"].clone());
            if active.is_none() {
                mirror["enabled"] = json!(false);
            }
            value["map"] = mirror;
        }
        let preferences: Preferences = serde_json::from_value(value).map_err(|e| e.to_string())?;
        preferences.validate()?;
        let terrain_changed = reload_terrain || preferences.terrain_path != current.terrain_path;
        let terrain = if terrain_changed {
            preferences
                .terrain_path
                .as_ref()
                .map(|path| TerrainCatalog::load(path))
                .transpose()?
        } else {
            None
        };
        let mut temp =
            tempfile::NamedTempFile::new_in(&self.data_dir).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut temp, &preferences).map_err(|e| e.to_string())?;
        temp.flush().map_err(|e| e.to_string())?;
        let mut state = self.state.lock().map_err(|_| "Workspace unavailable")?;
        let mut live_terrain = if terrain_changed {
            Some(self.terrain.lock().map_err(|_| "Terrain unavailable")?)
        } else {
            None
        };
        crate::persistence::persist(temp, &self.data_dir.join("preferences.json"))?;
        if let Some(catalog) = live_terrain.as_mut() {
            **catalog = terrain;
        }
        state.preferences = preferences.clone();
        Ok(preferences)
    }

    /// Publication follows the irreversible commit. A recovery failure is exposed
    /// through lifecycle status and must not turn a committed edit into a retry.
    pub(super) fn complete_workspace_change(
        &self,
        command: &str,
        revision: u64,
        path: Option<&str>,
        new_document: bool,
    ) {
        if let Err(error) = self.lifecycle_changed(command, revision, path, new_document) {
            eprintln!("Chronoscope recovery unavailable: {error}");
        }
        self.notify(json!({"kind":"changed","command":command,"revision":revision}));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_jobs_check_document_identity_after_acquiring_the_operation_gate() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::new(Project::new(crate::demo::dataset()), dir.path().into()).unwrap();
        let file = dir.path().join("replacement.json");
        std::fs::write(&file, serde_json::to_vec(&Project::empty()).unwrap()).unwrap();
        let gate = engine.operation.lock().unwrap();
        let job = engine
            .invoke(
                "job_start",
                json!({"command":"query","arguments":{"limit":1}}),
            )
            .unwrap();
        // Model a workspace replacement that owns the gate ahead of this queued job.
        engine.load_workspace(&file).unwrap();
        drop(gate);
        for _ in 0..200 {
            let status = engine
                .invoke("job_status", json!({"job_id":job["job_id"]}))
                .unwrap();
            if status["status"] == "failed" {
                assert_eq!(status["error"]["code"], "CONFLICT");
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        panic!("Queued job did not reject its stale document identity");
    }
}
