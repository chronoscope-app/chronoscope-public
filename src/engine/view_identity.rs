//! Canonical read/publication identity, independent of caller request generations.
use super::{Engine, State};
use crate::error::{EngineError, ErrorCode};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::{Mutex, MutexGuard, TryLockError};

/// A validated identity extracted from a coherent Engine snapshot or read under
/// its current state guard. Revisions remain exact canonical decimal strings.
/// `scene_generation` is caller-owned request identity and is deliberately absent.
/// Private fields and no unchecked Deserialize implementation prevent bypassing
/// validation. This validates identity/revision envelopes, not render payloads;
/// consumers must still validate their complete point/geometry packet.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CanonicalViewIdentity {
    workspace_id: String,
    store_id: String,
    revision: String,
    data_revision: String,
    selection_revision: String,
    filter_signature: String,
}

impl CanonicalViewIdentity {
    pub fn from_snapshot(root: &Value) -> Result<Self, EngineError> {
        if root["version"].as_u64() != Some(1) {
            return Err(invalid(
                "Canonical view identity requires snapshot version 1",
            ));
        }
        let field = |value: &Value, key: &str| {
            value[key]
                .as_str()
                .filter(|text| text.len() <= 512)
                .map(str::to_owned)
                .ok_or_else(|| {
                    invalid(format!(
                        "Canonical view identity requires bounded {key} string"
                    ))
                })
        };
        let identity = Self {
            workspace_id: field(&root["snapshot"], "workspace_id")?,
            store_id: field(&root["stamp"], "store_id")?,
            revision: field(&root["stamp"], "revision")?,
            data_revision: field(&root["stamp"], "data_revision")?,
            selection_revision: field(&root["stamp"], "selection_revision")?,
            filter_signature: field(&root["stamp"], "filter_signature")?,
        };
        identity.validate()?;
        let revision = decimal(&identity.revision)?;
        if root["snapshot"]["revision"].as_u64() != Some(revision) {
            return Err(invalid("Snapshot summary revision differs from its stamp"));
        }
        for section in ["render", "geometries", "display"] {
            if let Some(value) = root.get(section).filter(|value| !value.is_null()) {
                if value["revision"].as_u64() != Some(revision) {
                    return Err(invalid(format!(
                        "Snapshot {section} revision differs from its stamp"
                    )));
                }
            }
        }
        if root
            .get("revision")
            .is_some_and(|value| value.as_u64() != Some(revision))
        {
            return Err(invalid("Snapshot root revision differs from its stamp"));
        }
        Ok(identity)
    }

    fn validate(&self) -> Result<(), EngineError> {
        if self.store_id.is_empty()
            || self.store_id.len() > 256
            || self.store_id.chars().any(char::is_control)
        {
            return Err(invalid("Invalid canonical store identity"));
        }
        let (store, epoch) = self
            .workspace_id
            .rsplit_once(':')
            .ok_or_else(|| invalid("Invalid canonical workspace identity"))?;
        if store != self.store_id {
            return Err(invalid("Workspace identity differs from stamped store"));
        }
        decimal(epoch)?;
        decimal(&self.revision)?;
        decimal(&self.data_revision)?;
        decimal(&self.selection_revision)?;
        if self.filter_signature.len() != 64
            || !self
                .filter_signature
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(invalid("Invalid canonical filter signature"));
        }
        Ok(())
    }

    pub fn workspace_id(&self) -> &str {
        &self.workspace_id
    }
    pub fn store_id(&self) -> &str {
        &self.store_id
    }
    pub fn revision(&self) -> &str {
        &self.revision
    }
    pub fn data_revision(&self) -> &str {
        &self.data_revision
    }
    pub fn selection_revision(&self) -> &str {
        &self.selection_revision
    }
    pub fn filter_signature(&self) -> &str {
        &self.filter_signature
    }
}

fn invalid(message: impl Into<String>) -> EngineError {
    EngineError::new(ErrorCode::InvalidArgument, message)
}

fn decimal(value: &str) -> Result<u64, EngineError> {
    let parsed = value
        .parse::<u64>()
        .map_err(|_| invalid("Identity revision must be a canonical decimal u64"))?;
    if parsed.to_string() != value {
        return Err(invalid("Identity revision must be a canonical decimal u64"));
    }
    Ok(parsed)
}

pub(super) fn cooperative_lock<'a, T>(
    lock: &'a Mutex<T>,
    label: &str,
) -> Result<MutexGuard<'a, T>, EngineError> {
    loop {
        crate::operation::check().map_err(EngineError::from)?;
        match lock.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::WouldBlock) => {
                std::thread::sleep(std::time::Duration::from_millis(25))
            }
            Err(TryLockError::Poisoned(_)) => {
                return Err(EngineError::new(
                    ErrorCode::Unavailable,
                    format!("{label} unavailable"),
                ))
            }
        }
    }
}

impl Engine {
    /// Cheap current identity read; no render query, publication or observer/progress
    /// callback. Lock waits honor the calling operation's cancellation/deadline.
    pub fn current_view_identity(&self) -> Result<CanonicalViewIdentity, EngineError> {
        self.with_view_identity_state(|state| self.canonical_view_identity_locked(state))
    }

    /// Compare and run a caller-owned short publication transaction while BOTH
    /// Engine operation and state mutexes remain held. This excludes ordinary and
    /// detached state writers between comparison and commit. A stale identity
    /// never calls `publish`; its typed error and publication errors are preserved.
    ///
    /// The closure MUST NOT call Engine, perform IO/network/UI/GPU work, acquire
    /// an outer host lock or invoke callbacks/Session notifiers. Acquire caller
    /// locks before entering, commit without notification, then wake consumers
    /// after this method returns. The caller owns rollback of a failed transaction.
    /// Cancellation is checked immediately before publication, not after it:
    /// a completed external commit must not be reported as canceled afterward.
    pub fn with_current_view_identity<T>(
        &self,
        expected: &CanonicalViewIdentity,
        publish: impl FnOnce() -> Result<T, EngineError>,
    ) -> Result<T, EngineError> {
        self.with_view_identity_state(|state| {
            if self.canonical_view_identity_locked(state)? != *expected {
                return Err(EngineError::new(
                    ErrorCode::Conflict,
                    "Canonical view identity changed before publication",
                ));
            }
            crate::operation::check().map_err(EngineError::from)?;
            publish()
        })
    }

    fn with_view_identity_state<T>(
        &self,
        run: impl FnOnce(&State) -> Result<T, EngineError>,
    ) -> Result<T, EngineError> {
        let _operation = cooperative_lock(&self.operation, "Workspace operation")?;
        let state = cooperative_lock(&self.state, "Workspace state")?;
        crate::operation::check().map_err(EngineError::from)?;
        self.check_workspace_locked(&state)
            .map_err(EngineError::from)?;
        run(&state)
    }

    // Shared with view_snapshot_v1: retain its exact original source identity,
    // query stamps and serialized-filter SHA256; never include request generation.
    pub(super) fn canonical_view_identity_locked(
        &self,
        state: &State,
    ) -> Result<CanonicalViewIdentity, EngineError> {
        let (data, selection) = state.store.query_stamp(true);
        let filter = serde_json::to_vec(&state.project.filter)
            .map_err(|error| EngineError::new(ErrorCode::OperationFailed, error.to_string()))?;
        Ok(CanonicalViewIdentity {
            workspace_id: self.workspace_identity_locked(state),
            store_id: state.store.opaque_identity(),
            revision: state.revision.to_string(),
            data_revision: data.to_string(),
            selection_revision: selection.to_string(),
            filter_signature: format!("{:x}", Sha256::digest(filter)),
        })
    }
}

#[cfg(test)]
#[path = "view_identity_tests.rs"]
mod tests;
