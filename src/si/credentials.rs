//! Profile- and endpoint-bound secrets. No credentials enter JSON or workspaces.
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Arc};
pub(super) trait Secrets: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, key: &str) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}
struct Native;
fn unavailable() -> String {
    "UNAVAILABLE: operating system credential storage is unavailable or locked; unlock it and try again. The API key was not saved to a file.".into()
}
fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("org.chronoscope.ai", account).map_err(|_| unavailable())
}
impl Secrets for Native {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match entry(account)?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(unavailable()),
        }
    }
    fn set(&self, account: &str, key: &str) -> Result<(), String> {
        entry(account)?.set_password(key).map_err(|_| unavailable())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(unavailable()),
        }
    }
}
pub(super) struct Vault(pub Arc<dyn Secrets>);
impl Default for Vault {
    fn default() -> Self {
        Self(Arc::new(Native))
    }
}
pub(super) fn account(profile: &Path, endpoint: &str) -> Result<String, String> {
    let profile = profile
        .canonicalize()
        .map_err(|_| "Cannot resolve AI settings profile")?;
    let mut hash = Sha256::new();
    hash.update(profile.to_string_lossy().as_bytes());
    hash.update([0]);
    hash.update(endpoint.as_bytes());
    Ok(format!("{:x}", hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{engine::Engine, project::Project, si::Assistant};
    use serde_json::json;
    use std::{
        collections::BTreeMap,
        sync::{
            atomic::{AtomicBool, Ordering},
            Mutex,
        },
    };
    #[derive(Default)]
    struct Memory {
        values: Mutex<BTreeMap<String, String>>,
        unavailable: AtomicBool,
    }
    impl Secrets for Memory {
        fn get(&self, a: &str) -> Result<Option<String>, String> {
            if self.unavailable.load(Ordering::Relaxed) {
                return Err(unavailable());
            }
            Ok(self.values.lock().unwrap().get(a).cloned())
        }
        fn set(&self, a: &str, k: &str) -> Result<(), String> {
            if self.unavailable.load(Ordering::Relaxed) {
                return Err(unavailable());
            }
            self.values.lock().unwrap().insert(a.into(), k.into());
            Ok(())
        }
        fn delete(&self, a: &str) -> Result<(), String> {
            self.values.lock().unwrap().remove(a);
            Ok(())
        }
    }
    fn setup(profile: &Path, vault: Arc<Memory>) -> Engine {
        let mut engine = Engine::new(Project::empty(), profile.into()).unwrap();
        engine.assistant = Arc::new(Assistant {
            vault: Vault(vault),
            ..Assistant::default()
        });
        engine
    }
    #[test]
    fn saved_keys_restore_without_leaking_to_settings_status_or_restoring_file_grants() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Arc::new(Memory::default());
        let mut engine = setup(dir.path(), vault.clone());
        let key = "fixture-persistent-api-key";
        engine.invoke("si_configure",json!({"url":"https://example.test/v1","model":"fixture","api_key":key,"remember_key":true,"root":dir.path()})).unwrap();
        let disk = std::fs::read_to_string(dir.path().join("si-connection.json")).unwrap();
        assert!(!disk.contains(key));
        assert!(!engine
            .invoke("si_status", json!({}))
            .unwrap()
            .to_string()
            .contains(key));
        engine.assistant = Arc::new(Assistant::restore(dir.path(), Vault(vault.clone())));
        let status = engine.invoke("si_status", json!({})).unwrap();
        assert_eq!(status["connected"], true);
        assert_eq!(status["key_present"], true);
        assert_eq!(status["key_saved"], true);
        assert!(status["root"].is_null());
        assert_eq!(
            engine.invoke("si_history", json!({})).unwrap()["messages"],
            json!([])
        );
        assert_ne!(
            account(dir.path(), "https://example.test/v1/chat/completions").unwrap(),
            account(dir.path(), "https://other.test/v1/chat/completions").unwrap()
        );
        engine
            .invoke(
                "si_configure",
                json!({"url":"https://other.test/v1","model":"other","remember_key":true}),
            )
            .unwrap();
        assert_eq!(
            engine.invoke("si_status", json!({})).unwrap()["key_present"],
            false
        );
    }
    #[test]
    fn blank_reconnect_reuses_saved_key_and_forget_removes_it() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Arc::new(Memory::default());
        let mut engine = setup(dir.path(), vault.clone());
        engine.invoke("si_configure",json!({"url":"https://example.test/v1","model":"fixture","api_key":"saved-fixture","remember_key":true})).unwrap();
        engine.invoke("si_disconnect", json!({})).unwrap();
        engine.assistant = Arc::new(Assistant::restore(dir.path(), Vault(vault.clone())));
        assert_eq!(
            engine.invoke("si_status", json!({})).unwrap()["connected"],
            false
        );
        engine
            .invoke(
                "si_configure",
                json!({"url":"https://example.test/v1","model":"new-model","remember_key":true}),
            )
            .unwrap();
        assert_eq!(
            engine.invoke("si_status", json!({})).unwrap()["key_present"],
            true
        );
        engine
            .invoke("si_disconnect", json!({"forget_key":true}))
            .unwrap();
        assert!(vault.values.lock().unwrap().is_empty());
        engine.assistant = Arc::new(Assistant::restore(dir.path(), Vault(vault)));
        assert_eq!(
            engine.invoke("si_status", json!({})).unwrap()["key_saved"],
            false
        );
    }
    #[test]
    fn unavailable_vault_does_not_claim_success_and_legacy_sessions_do_not_use_it() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Arc::new(Memory::default());
        vault.unavailable.store(true, Ordering::Relaxed);
        let engine = setup(dir.path(), vault.clone());
        let args = json!({"url":"https://example.test/v1","model":"fixture","api_key":"never-in-error","remember_key":true});
        let error = engine.invoke("si_configure", args).unwrap_err();
        assert!(error.contains("UNAVAILABLE"));
        assert!(!error.contains("never-in-error"));
        assert!(!dir.path().join("si-connection.json").exists());
        engine.invoke("si_configure",json!({"url":"https://example.test/v1","model":"fixture","api_key":"session-fixture"})).unwrap();
        assert_eq!(
            engine.invoke("si_status", json!({})).unwrap()["key_saved"],
            false
        );
        assert!(Assistant::restore(dir.path(), Vault(vault))
            .connection
            .lock()
            .unwrap()
            .is_none());
    }
    #[test]
    #[ignore = "explicit OS credential-store smoke test; uses only an isolated dummy entry"]
    fn native_credential_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let a = account(
            dir.path(),
            "https://credential-fixture.invalid/v1/chat/completions",
        )
        .unwrap();
        let native = Native;
        native.set(&a, "isolated-test-value").unwrap();
        let result = native.get(&a);
        let removed = native.delete(&a);
        assert_eq!(result.unwrap().as_deref(), Some("isolated-test-value"));
        removed.unwrap();
        assert_eq!(native.get(&a).unwrap(), None);
    }
}
