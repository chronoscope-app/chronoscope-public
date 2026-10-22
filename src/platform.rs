//! Chronoscope identity and one-time import of the former Cesium profile.
use std::{
    fs,
    path::{Path, PathBuf},
};

pub const PRODUCT_NAME: &str = "Chronoscope";
pub const MCP_SERVER_NAME: &str = "chronoscope";
const LEGACY_PRODUCT: &str = "Chronoscope Cesium";
const MIGRATION_MARKER: &str = ".chronoscope-branding-v1";

fn profile_dir(product: &str, fallback: &str) -> PathBuf {
    directories::ProjectDirs::from("org", "Chronoscope", product)
        .map(|d| d.data_local_dir().into())
        .unwrap_or_else(|| PathBuf::from(fallback))
}
pub fn default_data_dir() -> PathBuf {
    profile_dir(PRODUCT_NAME, ".chronoscope")
}

/// Explicit --data-dir profiles are untouched by the default-profile migration.
pub fn prepare_default_profile() -> Result<PathBuf, String> {
    // Local builds and capture sessions can isolate their profile without
    // changing the user's normal workspace or running profile migration.
    if let Some(path) = std::env::var_os("CHRONOSCOPE_DATA_DIR") {
        return explicit_profile(Path::new(&path));
    }
    let current = default_data_dir();
    migrate_directory(
        &profile_dir(LEGACY_PRODUCT, ".chronoscope-cesium"),
        &current,
        true,
    )?;
    if let Some(documents) =
        directories::UserDirs::new().and_then(|d| d.document_dir().map(Path::to_path_buf))
    {
        migrate_directory(
            &documents.join(LEGACY_PRODUCT).join("Autosaved"),
            &documents.join(PRODUCT_NAME).join("Autosaved"),
            false,
        )?;
    }
    Ok(current)
}

fn explicit_profile(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("CHRONOSCOPE_DATA_DIR must be an absolute path".into());
    }
    Ok(path.to_path_buf())
}

#[cfg(test)]
mod capture_profile_tests {
    #[test]
    fn explicit_profile_requires_an_absolute_path() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            super::explicit_profile(directory.path()).unwrap(),
            directory.path()
        );
        assert!(super::explicit_profile(std::path::Path::new("relative")).is_err());
        assert!(super::explicit_profile(std::path::Path::new("")).is_err());
    }
}

// Publish a complete staged copy, retaining old files for absolute asset references.
// A previous target profile is moved aside rather than mixed with current settings.
fn migrate_directory(legacy: &Path, current: &Path, profile: bool) -> Result<(), String> {
    if current.join(MIGRATION_MARKER).is_file() || !legacy.is_dir() {
        return Ok(());
    }
    let migrate = || -> Result<(), String> {
        let parent = current.parent().ok_or("Profile has no parent directory")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut options = fs::OpenOptions::new();
        options.create(true).truncate(false).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options
            .open(parent.join(".chronoscope-branding.lock"))
            .map_err(|e| e.to_string())?;
        lock.lock().map_err(|e| e.to_string())?;
        if current.join(MIGRATION_MARKER).is_file() {
            return Ok(());
        }
        let mut leases = Vec::new();
        if profile {
            for directory in [legacy, current] {
                if !directory.is_dir() {
                    continue;
                }
                for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
                    let entry = entry.map_err(|e| e.to_string())?;
                    if entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("workspace-")
                    {
                        let lease = entry.path().join(".lease");
                        if lease.is_file() {
                            let file = fs::OpenOptions::new()
                                .read(true)
                                .write(true)
                                .open(lease)
                                .map_err(|e| e.to_string())?;
                            file.try_lock().map_err(|_| {
                                "Close the earlier Chronoscope app before migrating its profile"
                                    .to_string()
                            })?;
                            leases.push(file);
                        }
                    }
                }
            }
        }
        let staged = tempfile::Builder::new()
            .prefix(".chronoscope-migration-")
            .tempdir_in(parent)
            .map_err(|e| e.to_string())?;
        copy_tree(legacy, staged.path())?;
        if profile {
            let settings = staged.path().join("agent-access.json");
            if settings.is_file() {
                let mut value: serde_json::Value =
                    serde_json::from_slice(&fs::read(&settings).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                if let Some(root) = value["root"].as_str().map(PathBuf::from) {
                    if let Ok(relative) = root.strip_prefix(legacy) {
                        value["root"] = serde_json::json!(current.join(relative));
                        fs::write(
                            &settings,
                            serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        fs::write(staged.path().join(MIGRATION_MARKER), b"1\n").map_err(|e| e.to_string())?;
        let backup = if current.exists() {
            let backup = tempfile::Builder::new()
                .prefix("Chronoscope-previous-")
                .tempdir_in(parent)
                .map_err(|e| e.to_string())?;
            fs::rename(current, backup.path().join("profile")).map_err(|e| e.to_string())?;
            Some(backup.keep().join("profile"))
        } else {
            None
        };
        if let Err(error) = fs::rename(staged.path(), current) {
            if let Some(backup) = &backup {
                let _ = fs::rename(backup, current);
            }
            return Err(error.to_string());
        }
        drop(leases);
        Ok(())
    };
    migrate().map_err(|e| {
        format!(
            "Could not migrate Chronoscope data to {}: {e}",
            current.display()
        )
    })
}
fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let destination = target.join(entry.file_name());
        // Never follow user links out of the profile or copy session-only descriptors.
        if kind.is_symlink()
            || entry.file_name() == "agent-connection.json"
            || entry.file_name() == "wmts-auth.lock"
        {
            continue;
        }
        if kind.is_dir() {
            fs::create_dir(&destination).map_err(|e| e.to_string())?;
            copy_tree(&entry.path(), &destination)?;
            fs::set_permissions(
                &destination,
                entry.metadata().map_err(|e| e.to_string())?.permissions(),
            )
            .map_err(|e| e.to_string())?;
        } else if kind.is_file() {
            fs::copy(entry.path(), destination).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
/// Explicit profiles retain automatic document copies within their own directory.
pub fn autosave_directory(data_dir: &Path) -> PathBuf {
    if data_dir == default_data_dir() {
        if let Some(documents) =
            directories::UserDirs::new().and_then(|d| d.document_dir().map(Path::to_path_buf))
        {
            return documents.join(PRODUCT_NAME).join("Autosaved");
        }
    }
    data_dir.join("Documents").join("Autosaved")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_preserves_current_data_permissions_and_is_idempotent() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("previous");
        let new = root.path().join("Chronoscope");
        fs::create_dir_all(old.join("workspace-test")).unwrap();
        fs::write(old.join("workspace-test/.lease"), b"").unwrap();
        fs::write(
            old.join("workspace-test/events.sqlite"),
            b"recovery database",
        )
        .unwrap();
        fs::write(old.join("recovery-test.json"), b"checkpoint").unwrap();
        fs::write(old.join("agent-connection.json"), b"obsolete session").unwrap();
        fs::write(
            old.join("agent-access.json"),
            serde_json::to_vec(&serde_json::json!({"enabled":true,"root":old.join("agent-files")}))
                .unwrap(),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                old.join("agent-access.json"),
                fs::Permissions::from_mode(0o600),
            )
            .unwrap();
            std::os::unix::fs::symlink(root.path(), old.join("external-link")).unwrap();
        }
        fs::create_dir(&new).unwrap();
        fs::write(new.join("original-settings"), b"earlier renderer").unwrap();
        migrate_directory(&old, &new, true).unwrap();
        assert_eq!(
            fs::read(new.join("workspace-test/events.sqlite")).unwrap(),
            b"recovery database"
        );
        assert_eq!(
            fs::read(new.join("recovery-test.json")).unwrap(),
            b"checkpoint"
        );
        assert!(!new.join("agent-connection.json").exists());
        let settings: serde_json::Value =
            serde_json::from_slice(&fs::read(new.join("agent-access.json")).unwrap()).unwrap();
        assert_eq!(settings["root"], serde_json::json!(new.join("agent-files")));
        assert!(old.join("workspace-test/events.sqlite").exists());
        assert!(fs::read_dir(root.path())
            .unwrap()
            .flatten()
            .any(|e| e.path().join("profile/original-settings").is_file()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(new.join("agent-access.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            assert!(!new.join("external-link").exists());
        }
        fs::write(new.join("recovery-test.json"), b"current edits").unwrap();
        migrate_directory(&old, &new, true).unwrap();
        assert_eq!(
            fs::read(new.join("recovery-test.json")).unwrap(),
            b"current edits"
        );
    }
    #[test]
    fn active_workspace_blocks_partial_migration_then_retries_successfully() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("previous");
        let new = root.path().join("Chronoscope");
        fs::create_dir_all(old.join("workspace-active")).unwrap();
        let lease = fs::File::create(old.join("workspace-active/.lease")).unwrap();
        lease.lock().unwrap();
        assert!(migrate_directory(&old, &new, true)
            .unwrap_err()
            .contains("Close the earlier"));
        assert!(!new.exists());
        drop(lease);
        migrate_directory(&old, &new, true).unwrap();
        assert!(new.join(MIGRATION_MARKER).exists());
    }
    #[test]
    fn autosaves_copy_once_without_replacing_later_edits() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("previous Autosaved");
        let new = root.path().join("Chronoscope/Autosaved");
        fs::create_dir(&old).unwrap();
        fs::write(old.join("Recovered.chronoscope"), b"saved study").unwrap();
        migrate_directory(&old, &new, false).unwrap();
        assert_eq!(
            fs::read(new.join("Recovered.chronoscope")).unwrap(),
            b"saved study"
        );
        fs::write(new.join("Recovered.chronoscope"), b"later edits").unwrap();
        migrate_directory(&old, &new, false).unwrap();
        assert_eq!(
            fs::read(new.join("Recovered.chronoscope")).unwrap(),
            b"later edits"
        );
    }
}
