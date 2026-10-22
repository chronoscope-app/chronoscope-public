//! Isolated inference with bounded tool calls over private, bidirectional pipes.
//! Callbacks stay on the caller thread, retaining cancellation and file scope.
use serde_json::{json, Value};

pub const MAX_TOOL_CALLS: usize = 32;
#[cfg(any(target_os = "macos", all(test, unix)))]
const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;
#[cfg(any(target_os = "macos", all(test, unix)))]
const MAX_FRAME_BYTES: usize = 1024 * 1024;

pub fn request(input: Value) -> Result<Value, String> {
    request_with_tools(input, |_, _| Err("SCOPE_DENIED: no tools granted".into()))
}
#[cfg(not(target_os = "macos"))]
pub fn request_with_tools(
    _: Value,
    _: impl FnMut(&str, Value) -> Result<Value, String>,
) -> Result<Value, String> {
    Ok(
        json!({"available":false,"reason":"Apple Intelligence requires macOS","provider":"apple-local","context_tokens":4096}),
    )
}
#[cfg(target_os = "macos")]
pub fn request_with_tools(
    input: Value,
    handler: impl FnMut(&str, Value) -> Result<Value, String>,
) -> Result<Value, String> {
    use std::{
        io::Write,
        os::unix::fs::PermissionsExt,
        process::{Command, Stdio},
    };
    let mut file = tempfile::Builder::new()
        .prefix("chronoscope-apple-")
        .tempfile()
        .map_err(|e| e.to_string())?;
    file.write_all(include_bytes!(concat!(
        env!("OUT_DIR"),
        "/chronoscope-apple-intelligence"
    )))
    .map_err(|e| e.to_string())?;
    let path = file.into_temp_path();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
        .map_err(|e| e.to_string())?;
    let child = Command::new(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Cannot start the on-device Apple Intelligence bridge")?;
    // Availability checks must not hold the SI settings UI behind the much
    // longer inference deadline if the OS service is unavailable.
    let timeout = if input["operation"] == "status" {
        5
    } else {
        300
    };
    exchange(
        child,
        input,
        handler,
        std::time::Duration::from_secs(timeout),
    )
}

#[cfg(any(target_os = "macos", all(test, unix)))]
fn exchange(
    child: std::process::Child,
    input: Value,
    mut handler: impl FnMut(&str, Value) -> Result<Value, String>,
    timeout: std::time::Duration,
) -> Result<Value, String> {
    use std::{
        io::{BufRead, BufReader, Read, Write},
        sync::mpsc,
        time::{Duration, Instant},
    };
    struct Process(std::process::Child);
    impl Drop for Process {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let mut process = Process(child);
    let bytes = serde_json::to_vec(&input).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_REQUEST_BYTES {
        return Err("RESOURCE_LIMIT: native SI request exceeds 2 MiB".into());
    }
    let mut stdin = process
        .0
        .stdin
        .take()
        .ok_or("Native SI stdin unavailable")?;
    let (input_tx, input_rx) = mpsc::sync_channel::<Vec<u8>>(1);
    // A helper that stops reading must never block the operation/cancellation thread.
    std::thread::spawn(move || {
        for bytes in input_rx {
            if stdin
                .write_all(&bytes)
                .and_then(|_| stdin.write_all(b"\n"))
                .is_err()
            {
                break;
            }
        }
    });
    input_tx
        .try_send(bytes)
        .map_err(|_| "Cannot write native SI request")?;
    let stdout = process
        .0
        .stdout
        .take()
        .ok_or("Native SI stdout unavailable")?;
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut bytes = Vec::new();
            let frame = reader
                .by_ref()
                .take((MAX_FRAME_BYTES + 1) as u64)
                .read_until(b'\n', &mut bytes)
                .map_err(|_| "Cannot read native SI response".to_string())
                .and_then(|n| {
                    if n == 0 {
                        return Err("Native SI bridge disconnected".into());
                    }
                    if n > MAX_FRAME_BYTES {
                        return Err("RESOURCE_LIMIT: native SI frame exceeds 1 MiB".into());
                    }
                    serde_json::from_slice::<Value>(&bytes)
                        .map_err(|_| "Invalid native SI frame".into())
                });
            let failed = frame.is_err();
            if tx.send(frame).is_err() || failed {
                break;
            }
        }
    });
    let start = Instant::now();
    let mut calls = 0;
    let mut identifiers = std::collections::HashSet::new();
    loop {
        crate::operation::check()?;
        if start.elapsed() > timeout {
            return Err("CANCELLED: on-device SI timed out; completed actions remain".into());
        }
        let frame = match rx.recv_timeout(Duration::from_millis(40)) {
            Ok(value) => value?,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => return Err("Native SI bridge disconnected".into()),
        };
        if frame["type"] == "tool_call" {
            calls += 1;
            if calls > MAX_TOOL_CALLS {
                return Err(
                    "RESOURCE_LIMIT: native SI tool-call budget exceeded; completed actions remain"
                        .into(),
                );
            }
            let id = frame["id"]
                .as_str()
                .filter(|s| !s.is_empty() && s.len() <= 128)
                .ok_or("Invalid native SI tool-call ID")?;
            if !identifiers.insert(id.to_owned()) {
                return Err("Invalid repeated native SI tool-call ID".into());
            }
            let command = frame["command"]
                .as_str()
                .filter(|s| !s.is_empty() && s.len() <= 128)
                .ok_or("Invalid native SI command")?;
            let arguments = frame
                .get("arguments")
                .filter(|a| a.is_object())
                .ok_or("Invalid native SI tool arguments")?
                .clone();
            if arguments.to_string().len() > 65536 {
                return Err("RESOURCE_LIMIT: native SI tool arguments exceed 64 KiB".into());
            }
            crate::operation::progress(
                calls as u64,
                Some(MAX_TOOL_CALLS as u64),
                &format!("Apple Intelligence: {command}"),
            );
            let result = handler(command, arguments).unwrap_or_else(
                |e| json!({"error":{"code":crate::mcp::error_code(&e),"message":e}}),
            );
            let reply = serde_json::to_vec(&json!({"type":"tool_result","id":id,"result":result}))
                .map_err(|e| e.to_string())?;
            if reply.len() > MAX_FRAME_BYTES {
                return Err("RESOURCE_LIMIT: native SI tool result exceeds 1 MiB".into());
            }
            input_tx
                .try_send(reply)
                .map_err(|_| "Native SI helper is not consuming tool results")?;
            continue;
        }
        if !frame.is_object() {
            return Err("Invalid native SI result".into());
        }
        if let Some(error) = frame["error"].as_str() {
            return Err(format!(
                "OPERATION_FAILED: {error}; completed tool actions, if any, remain"
            ));
        }
        if frame.get("answer").is_none() && frame.get("available").is_none() {
            return Err("Invalid native SI final response".into());
        }
        drop(input_tx);
        loop {
            if let Some(status) = process.0.try_wait().map_err(|e| e.to_string())? {
                if !status.success() {
                    return Err("Native SI helper exited unsuccessfully".into());
                }
                return Ok(frame);
            }
            crate::operation::check()?;
            if start.elapsed() > timeout {
                return Err("CANCELLED: native SI did not finish; completed actions remain".into());
            }
            std::thread::sleep(Duration::from_millis(40));
        }
    }
}
pub fn status() -> Result<Value, String> {
    request(json!({"operation":"status"}))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    #[cfg(target_os = "macos")]
    #[test]
    fn real_swift_helper_reads_status_frames_without_waiting_for_stdin_eof() {
        // exchange keeps stdin open so tool replies can follow the initial
        // request. Exercise both a short frame and one spanning multiple pipe
        // reads against the actual embedded Swift helper, not a Python stand-in.
        for padding in [0, 16384] {
            let result = request(json!({"operation":"status","padding":"x".repeat(padding)}))
                .expect("Native status must respond while the input pipe is open");
            assert!(result["available"].is_boolean(), "{result}");
            assert_eq!(result["provider"], "apple-local");
        }
    }
    fn helper(code: &str) -> std::process::Child {
        Command::new("python3")
            .args(["-u", "-c", code])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap()
    }
    #[test]
    fn private_pipe_roundtrip_retains_caller_and_reports_tool_errors() {
        let child = helper(
            r#"
import json,sys
json.loads(sys.stdin.readline())
for i,command in enumerate(['query','denied']):
 print(json.dumps({'type':'tool_call','id':str(i),'command':command,'arguments':{'limit':3}}),flush=True)
 response=json.loads(sys.stdin.readline())
 assert response['id']==str(i) and response['type']=='tool_result'
 assert ('rows' in response['result']) if i==0 else ('error' in response['result'])
print(json.dumps({'answer':'done'}),flush=True)
"#,
        );
        let caller = std::thread::current().id();
        let mut names = vec![];
        let result = exchange(
            child,
            json!({"operation":"chat"}),
            |name, args| {
                assert_eq!(std::thread::current().id(), caller);
                assert_eq!(args["limit"], 3);
                names.push(name.to_owned());
                if name == "query" {
                    Ok(json!({"rows":[{"id":"9007199254740993"}]}))
                } else {
                    Err("SCOPE_DENIED: command unavailable".into())
                }
            },
            std::time::Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(result["answer"], "done");
        assert_eq!(names, vec!["query", "denied"]);
    }
    #[test]
    fn cancellation_kills_stalled_helper_and_frames_are_bounded() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        let flag = Arc::new(AtomicBool::new(false));
        let signal = flag.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(100));
            signal.store(true, Ordering::Relaxed);
        });
        let child = helper("import time;time.sleep(30)");
        let result = crate::operation::with_context(
            crate::operation::Context {
                cancelled: flag,
                scope: None,
                progress: None,
            },
            || {
                exchange(
                    child,
                    json!({}),
                    |_, _| Ok(json!({})),
                    std::time::Duration::from_secs(5),
                )
            },
        );
        assert!(result.unwrap_err().starts_with("CANCELLED:"));
        let child = helper("import sys;sys.stdin.readline();print('x'*1048577,flush=True)");
        assert!(exchange(
            child,
            json!({}),
            |_, _| Ok(json!({})),
            std::time::Duration::from_secs(5)
        )
        .unwrap_err()
        .contains("1 MiB"));
    }
    #[test]
    fn repeated_ids_cannot_replay_a_mutation() {
        let child = helper(
            r#"
import json,sys
sys.stdin.readline()
for _ in range(2):
 print(json.dumps({'type':'tool_call','id':'same','command':'edit','arguments':{}}),flush=True)
 sys.stdin.readline()
"#,
        );
        let mut calls = 0;
        let error = exchange(
            child,
            json!({}),
            |_, _| {
                calls += 1;
                Ok(json!({}))
            },
            std::time::Duration::from_secs(5),
        )
        .unwrap_err();
        assert!(error.contains("repeated"));
        assert_eq!(calls, 1);
    }
    #[test]
    fn a_helper_that_never_reads_large_input_cannot_block_the_deadline() {
        let child = helper("import time; time.sleep(30)");
        let start = std::time::Instant::now();
        let error = exchange(
            child,
            json!({"prompt":"a".repeat(1024*1024)}),
            |_, _| Ok(json!({})),
            std::time::Duration::from_millis(150),
        )
        .unwrap_err();
        assert!(error.starts_with("CANCELLED:"));
        assert!(start.elapsed() < std::time::Duration::from_secs(3));
    }
    #[test]
    fn call_budget_and_invalid_arguments_stop_before_execution() {
        let child = helper(
            r#"
import json,sys
sys.stdin.readline()
for i in range(33):
 print(json.dumps({'type':'tool_call','id':str(i),'command':'query','arguments':{}}),flush=True)
 sys.stdin.readline()
"#,
        );
        let mut calls = 0;
        let error = exchange(
            child,
            json!({}),
            |_, _| {
                calls += 1;
                Ok(json!({}))
            },
            std::time::Duration::from_secs(5),
        )
        .unwrap_err();
        assert!(error.contains("budget"));
        assert_eq!(calls, 32);
        let child = helper(
            r#"
import json,sys
sys.stdin.readline()
print(json.dumps({'type':'tool_call','id':'x','command':'query','arguments':{'value':'x'*65537}}),flush=True)
sys.stdin.readline()
"#,
        );
        let error = exchange(
            child,
            json!({}),
            |_, _| panic!("Oversized arguments must not execute"),
            std::time::Duration::from_secs(5),
        )
        .unwrap_err();
        assert!(error.contains("64 KiB"));
    }
}
