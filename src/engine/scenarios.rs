//! Recipes live in this profile, outside datasets and data Undo.
use super::*;
use crate::error::{EngineError, ErrorCode};
impl Engine {
    pub(super) fn scenario_request(&self, mut args: Value) -> Result<Value, EngineError> {
        use std::io::Write;
        // Serialize recipe access separately from the workspace operation gate.
        static RECIPES: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let lock = RECIPES.lock().map_err(|_| {
            EngineError::new(ErrorCode::Unavailable, "Scenario library unavailable")
        })?;
        let path = self.data_dir.join("navigation-scenarios.json");
        let mut recipes: BTreeMap<String, Value> = if path.exists() {
            let bytes = std::fs::read(&path)
                .map_err(|e| EngineError::new(ErrorCode::OperationFailed, e.to_string()))?;
            if bytes.len() > 512 * 1024 {
                return Err(EngineError::new(
                    ErrorCode::ResourceLimit,
                    "scenario library exceeds 512 KiB",
                ));
            }
            serde_json::from_slice(&bytes).map_err(|e| {
                EngineError::new(
                    ErrorCode::InvalidArgument,
                    format!("Invalid scenario library: {e}"),
                )
            })?
        } else {
            BTreeMap::new()
        };
        let action = args["action"].as_str().unwrap();
        if action == "list" {
            return Ok(json!({"scenarios":recipes,"persistent":true}));
        }
        if matches!(action, "save" | "remove") {
            let name = args["name"].as_str().unwrap();
            if action == "save" {
                if recipes.contains_key(name) && args["overwrite"] != true {
                    return Err(EngineError::new(
                        ErrorCode::Conflict,
                        "scenario exists; explicitly set overwrite",
                    ));
                }
                if !recipes.contains_key(name) && recipes.len() >= 16 {
                    return Err(EngineError::new(
                        ErrorCode::ResourceLimit,
                        "at most 16 saved scenarios",
                    ));
                }
                recipes.insert(name.into(), args["steps"].clone());
            } else if recipes.remove(name).is_none() {
                return Err(EngineError::new(ErrorCode::NotFound, "unknown scenario"));
            }
            let bytes = serde_json::to_vec(&recipes)
                .map_err(|e| EngineError::new(ErrorCode::OperationFailed, e.to_string()))?;
            if bytes.len() > 512 * 1024 {
                return Err(EngineError::new(
                    ErrorCode::ResourceLimit,
                    "scenario library exceeds 512 KiB",
                ));
            }
            let mut file = tempfile::NamedTempFile::new_in(&self.data_dir)
                .map_err(|e| EngineError::new(ErrorCode::OperationFailed, e.to_string()))?;
            file.write_all(&bytes)
                .map_err(|e| EngineError::new(ErrorCode::OperationFailed, e.to_string()))?;
            crate::persistence::persist(file, &path).map_err(EngineError::from_legacy)?;
            return Ok(json!({"name":name,"saved":action == "save","persistent":true}));
        }
        if action == "run" {
            args["steps"] = recipes
                .get(args["name"].as_str().unwrap())
                .ok_or_else(|| EngineError::new(ErrorCode::NotFound, "unknown scenario"))?
                .clone();
            // Revalidate persisted recipes, including every nested operation.
            crate::schema::validate_typed(
                "view_scenario",
                &json!({"action":"save","name":args["name"],"steps":args["steps"]}),
            )?;
        }
        drop(lock);
        self.desktop_request("view_scenario", args)
            .map_err(EngineError::from_legacy)
    }
}
