//! Per-request cooperative cancellation and progress, isolated between threads.
use std::{
    cell::RefCell,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
type Progress = Arc<dyn Fn(u64, Option<u64>, &str) + Send + Sync>;
#[derive(Clone)]
pub struct Context {
    pub cancelled: Arc<AtomicBool>,
    pub progress: Option<Progress>,
    pub scope: Option<std::path::PathBuf>,
}
thread_local! {static CURRENT:RefCell<Option<Context>>=const {RefCell::new(None)};}
thread_local! {static DEADLINE:RefCell<Option<std::time::Instant>>=const {RefCell::new(None)};}
thread_local! {static WORKSPACE:RefCell<Option<String>>=const {RefCell::new(None)};}
pub(crate) fn workspace() -> Option<String> {
    WORKSPACE.with(|w| w.borrow().clone())
}
/// Nested work inherits the original document identity, including work queued
/// before a provider or native bridge starts. File scope remains independent.
pub(crate) fn with_workspace<T>(identity: String, run: impl FnOnce() -> T) -> T {
    struct Reset(Option<String>);
    impl Drop for Reset {
        fn drop(&mut self) {
            WORKSPACE.with(|w| *w.borrow_mut() = self.0.take());
        }
    }
    let previous = WORKSPACE.with(|w| {
        let identity = w.borrow().clone().unwrap_or(identity);
        w.replace(Some(identity))
    });
    let _reset = Reset(previous);
    run()
}
/// A nested operation can shorten, but cannot extend, its caller's deadline.
pub fn with_deadline<T>(duration: std::time::Duration, run: impl FnOnce() -> T) -> T {
    struct Reset(Option<std::time::Instant>);
    impl Drop for Reset {
        fn drop(&mut self) {
            DEADLINE.with(|d| *d.borrow_mut() = self.0);
        }
    }
    let until = std::time::Instant::now() + duration;
    let old = DEADLINE.with(|d| {
        let next = d.borrow().map_or(until, |t| t.min(until));
        d.replace(Some(next))
    });
    let _reset = Reset(old);
    run()
}
pub fn with_context<T>(context: Context, run: impl FnOnce() -> T) -> T {
    struct Reset(Option<Context>);
    impl Drop for Reset {
        fn drop(&mut self) {
            CURRENT.with(|c| *c.borrow_mut() = self.0.take());
        }
    }
    let previous = CURRENT.with(|c| c.replace(Some(context)));
    let _reset = Reset(previous);
    run()
}
pub fn cancelled() -> bool {
    DEADLINE.with(|d| d.borrow().is_some_and(|t| std::time::Instant::now() >= t))
        || CURRENT.with(|c| {
            c.borrow()
                .as_ref()
                .is_some_and(|c| c.cancelled.load(Ordering::Relaxed))
        })
}
pub fn check() -> Result<(), String> {
    if cancelled() {
        Err("CANCELLED: request cancelled".into())
    } else {
        Ok(())
    }
}
pub fn progress(value: u64, total: Option<u64>, message: &str) {
    CURRENT.with(|c| {
        if let Some(p) = c.borrow().as_ref().and_then(|c| c.progress.as_ref()) {
            p(value, total, message)
        }
    })
}

pub fn scope() -> Option<std::path::PathBuf> {
    CURRENT.with(|c| c.borrow().as_ref().and_then(|c| c.scope.clone()))
}
pub fn with_scope<T>(scope: std::path::PathBuf, run: impl FnOnce() -> T) -> T {
    let mut context = CURRENT.with(|c| c.borrow().clone()).unwrap_or(Context {
        cancelled: Arc::new(AtomicBool::new(false)),
        progress: None,
        scope: None,
    });
    context.scope = Some(scope);
    with_context(context, run)
}

/// Reuse a request/job cancellation flag for a nested assistant tool loop.
pub fn cancellation_flag() -> Option<Arc<AtomicBool>> {
    CURRENT.with(|c| c.borrow().as_ref().map(|c| c.cancelled.clone()))
}

pub fn current_context() -> Option<Context> {
    CURRENT.with(|c| c.borrow().clone())
}

/// Canonical directory scopes compose by intersection, never by widening a
/// nested capability. Both callers canonicalize roots when granting access.
pub fn intersect_scopes(
    outer: Option<std::path::PathBuf>,
    inner: Option<std::path::PathBuf>,
) -> Result<Option<std::path::PathBuf>, String> {
    match (outer, inner) {
        (Some(a), Some(b)) if a.starts_with(&b) => Ok(Some(a)),
        (Some(a), Some(b)) if b.starts_with(&a) => Ok(Some(b)),
        (Some(_), Some(_)) => Err("SI file root is outside the current MCP scope".into()),
        (a, b) => Ok(a.or(b)),
    }
}

// File replacement is irreversible. Track it independently of cancellation so
// a late request cannot turn an already replaced output into a false failure.
thread_local! {static FILE_COMMIT:RefCell<Option<std::rc::Rc<std::cell::Cell<bool>>>>=const {RefCell::new(None)};}
pub struct CommitGuard {
    flag: std::rc::Rc<std::cell::Cell<bool>>,
    previous: Option<std::rc::Rc<std::cell::Cell<bool>>>,
}
impl CommitGuard {
    pub fn committed(&self) -> bool {
        self.flag.get()
    }
}
impl Drop for CommitGuard {
    fn drop(&mut self) {
        FILE_COMMIT.with(|c| *c.borrow_mut() = self.previous.take());
    }
}
pub fn track_file_commit() -> CommitGuard {
    let flag = std::rc::Rc::new(std::cell::Cell::new(false));
    let previous = FILE_COMMIT.with(|c| c.replace(Some(flag.clone())));
    CommitGuard { flag, previous }
}
pub fn file_committed() {
    FILE_COMMIT.with(|c| {
        if let Some(flag) = c.borrow().as_ref() {
            flag.set(true);
        }
    });
    progress(1, Some(1), "Committed external file");
}

#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Queued,
    Validating,
    Reading,
    Converting,
    Indexing,
    Staging,
    Committing,
    Completed,
    Cancelled,
    Failed,
}
#[derive(serde::Serialize)]
pub struct ProgressEvent {
    pub phase: Phase,
    pub completed: u64,
    pub total: Option<u64>,
    pub unit: &'static str,
    pub sequence: u64,
}
