//! Tiny C ABI boundary. App/engine crates retain forbid(unsafe_code).
use std::{
    ffi::{c_char, CStr, CString},
    sync::{Arc, OnceLock},
};
type Handler = Arc<dyn Fn(&str) -> String + Send + Sync>;
static HANDLER: OnceLock<Handler> = OnceLock::new();
extern "C" {
    fn chronoscope_intents_install(
        call: extern "C" fn(*const c_char) -> *mut c_char,
        free: extern "C" fn(*mut c_char),
    );
    #[cfg(feature = "qa")]
    fn chronoscope_intents_verify() -> *mut c_char;
    #[cfg(feature = "qa")]
    fn chronoscope_intents_free(pointer: *mut c_char);
}
extern "C" fn call(input: *const c_char) -> *mut c_char {
    // Swift supplies a NUL-terminated UTF-8 buffer valid for the duration of this call.
    let response = std::panic::catch_unwind(|| {
        if input.is_null() {
            return "{\"error\":\"Missing intent request\"}".into();
        }
        let request = unsafe { CStr::from_ptr(input) }.to_str().unwrap_or("");
        if request.len() > 8192 {
            return "{\"error\":\"Intent request too large\"}".into();
        }
        HANDLER
            .get()
            .map(|h| h(request))
            .unwrap_or_else(|| "{\"error\":\"Open Chronoscope first\"}".into())
    })
    .unwrap_or_else(|_| "{\"error\":\"Intent failed\"}".into());
    CString::new(response)
        .unwrap_or_else(|_| CString::new("{\"error\":\"Invalid intent response\"}").unwrap())
        .into_raw()
}
extern "C" fn free(pointer: *mut c_char) {
    if !pointer.is_null() {
        // Only pointers returned by call are accepted by the Swift bridge.
        unsafe {
            drop(CString::from_raw(pointer));
        }
    }
}
pub fn install(handler: Handler) {
    let _ = HANDLER.set(handler);
    unsafe {
        chronoscope_intents_install(call, free);
    }
}
#[cfg(feature = "qa")]
pub fn verify() -> String {
    unsafe {
        let p = chronoscope_intents_verify();
        let s = CStr::from_ptr(p).to_string_lossy().into_owned();
        chronoscope_intents_free(p);
        s
    }
}
