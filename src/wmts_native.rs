//! Persistent macOS URLSession sidecar: native client-certificate challenges and
//! OS PIN handling, with bounded IPC and a parent-enforced deadline.
//! Shared by WMTS GETs and SI POSTs; each service owns an independent client.
#[cfg(target_os = "macos")]
mod macos {
    use crate::wmts_auth::{Profile, Response};
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::{
        io::{BufRead, Write},
        process::{Child, ChildStdin, Command, Stdio},
        sync::{mpsc, Arc, Mutex},
        time::Duration,
    };
    const HELPER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/chronoscope-wmts-native"));
    const MAX_FRAME: u64 = 12 * 1024 * 1024;
    struct Session {
        child: Child,
        stdin: Arc<Mutex<ChildStdin>>,
        responses: mpsc::Receiver<Result<Vec<u8>, String>>,
        _executable: tempfile::TempPath,
    }
    impl Drop for Session {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
    impl Session {
        fn new() -> Result<Self, String> {
            use std::os::unix::fs::PermissionsExt;
            let mut file = tempfile::Builder::new()
                .prefix("chronoscope-wmts-")
                .tempfile()
                .map_err(|_| "Cannot prepare native WMTS transport")?;
            file.write_all(HELPER)
                .map_err(|_| "Cannot prepare native WMTS transport")?;
            file.as_file()
                .sync_all()
                .map_err(|_| "Cannot prepare native WMTS transport")?;
            let path = file.into_temp_path();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| "Cannot prepare native WMTS transport")?;
            let mut child = Command::new(&path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .env_remove("SSLKEYLOGFILE")
                .spawn()
                .map_err(|_| "Cannot start native macOS WMTS transport")?;
            let stdin = child.stdin.take().unwrap();
            let mut stdout = std::io::BufReader::new(child.stdout.take().unwrap());
            let (send, responses) = mpsc::sync_channel(1);
            std::thread::spawn(move || loop {
                let mut line = Vec::new();
                let result =
                    std::io::Read::take(&mut stdout, MAX_FRAME + 1).read_until(b'\n', &mut line);
                if !matches!(result, Ok(n) if n > 0 && n <= MAX_FRAME as usize)
                    || line.last() != Some(&b'\n')
                {
                    let _ = send.send(Err("Invalid or oversized native WMTS response".into()));
                    break;
                }
                if send.send(Ok(line)).is_err() {
                    break;
                }
            });
            Ok(Self {
                child,
                stdin: Arc::new(Mutex::new(stdin)),
                responses,
                _executable: path,
            })
        }
        fn request(
            &mut self,
            profile: Option<&Profile>,
            url: &str,
            max: u64,
            post: Option<(&serde_json::Value, &str)>,
            timeout: Duration,
        ) -> Result<Response, String> {
            let body = post
                .map(|(body, _)| serde_json::to_vec(body))
                .transpose()
                .map_err(|_| "Cannot encode SI request")?;
            if body.as_ref().is_some_and(|b| b.len() > 1024 * 1024) {
                return Err("RESOURCE_LIMIT: SI request exceeded 1 MiB".into());
            }
            let req = serde_json::json!({"url":url,"max":max,"identity":profile.map(|p| &p.identity),"interactive":std::env::var_os(if post.is_some() { "CHRONOSCOPE_SI_NO_UI" } else { "CHRONOSCOPE_WMTS_NO_UI" }).is_none(),"method":if post.is_some() {"POST"} else {"GET"},"body":body.map(|b| STANDARD.encode(b)),"bearer":post.map(|(_,key)|key),"timeout":if post.is_some() { timeout.as_secs_f64().min(60.0) } else { 40.0 }});
            let request =
                serde_json::to_vec(&req).map_err(|_| "Cannot encode native WMTS request")?;
            if request.len()
                > if post.is_some() {
                    2 * 1024 * 1024
                } else {
                    12 * 1024
                }
            {
                return Err("Native WMTS request exceeds IPC size limit".into());
            }
            // SI frames can exceed pipe capacity. A blocked helper/PIN dialog
            // must not trap the parent inside write_all before its deadline.
            let input = self.stdin.clone();
            let (sent, written) = mpsc::sync_channel(1);
            std::thread::spawn(move || {
                let result = (|| {
                    let mut stdin = input
                        .lock()
                        .map_err(|_| "Native TLS transport unavailable")?;
                    stdin
                        .write_all(&request)
                        .and_then(|_| stdin.write_all(b"\n"))
                        .and_then(|_| stdin.flush())
                        .map_err(|_| "Native TLS transport disconnected")
                })();
                let _ = sent.send(result);
            });
            let start = std::time::Instant::now();
            loop {
                crate::operation::check()?;
                match written.recv_timeout(Duration::from_millis(25)) {
                    Ok(result) => {
                        result?;
                        break;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        return Err("Native TLS transport disconnected".into())
                    }
                    Err(_) if start.elapsed() >= timeout => {
                        return Err("Native TLS request timed out while writing".into())
                    }
                    Err(_) => {}
                }
            }
            let bytes = loop {
                crate::operation::check()?;
                match self.responses.recv_timeout(Duration::from_millis(50)) {
                    Ok(result) => break result?,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return Err("Native WMTS transport disconnected".into()),
                    Err(_) if start.elapsed() >= timeout => return Err("WMTS authentication timed out; check the certificate chooser or OS PIN prompt".into()),
                    Err(_) => {}
                }
            };
            let json: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|_| "Invalid native WMTS response")?;
            if let Some(error) = json["error"].as_str() {
                return Err(error.to_owned());
            }
            let status = json["status"]
                .as_u64()
                .filter(|v| (100..=599).contains(v))
                .ok_or("Invalid native WMTS status")? as u16;
            let bytes = STANDARD
                .decode(json["body"].as_str().ok_or("Missing native WMTS body")?)
                .map_err(|_| "Invalid native WMTS body")?;
            if bytes.len() as u64 > max {
                return Err("Map response exceeds size limit".into());
            }
            Ok(Response {
                status,
                bytes,
                authenticated: json["authenticated"].as_bool().unwrap_or(true),
            })
        }
    }
    #[derive(Default)]
    pub struct Client(Mutex<Option<Session>>, Mutex<Option<std::time::Instant>>);
    impl Client {
        pub fn fetch(
            &self,
            profile: Option<&Profile>,
            url: &str,
            max: u64,
        ) -> Result<Response, String> {
            self.request(profile, url, max, None, Duration::from_secs(90))
        }
        pub fn post(
            &self,
            profile: Option<&Profile>,
            url: &str,
            body: &serde_json::Value,
            key: &str,
            timeout: Duration,
        ) -> Result<Response, String> {
            self.request(profile, url, 1024 * 1024, Some((body, key)), timeout)
        }
        fn request(
            &self,
            profile: Option<&Profile>,
            url: &str,
            max: u64,
            post: Option<(&serde_json::Value, &str)>,
            timeout: Duration,
        ) -> Result<Response, String> {
            let mut session = loop {
                crate::operation::check()?;
                match self.0.try_lock() {
                    Ok(guard) => break guard,
                    Err(std::sync::TryLockError::WouldBlock) => {
                        std::thread::sleep(Duration::from_millis(25))
                    }
                    Err(_) => return Err("Native WMTS transport unavailable".into()),
                }
            };
            if self
                .1
                .lock()
                .map_err(|_| "Native authentication unavailable")?
                .is_some_and(|until| until > std::time::Instant::now())
            {
                return Err("UNAVAILABLE: native authentication paused after a failure; reset authentication to retry".into());
            }
            if session.is_none() {
                *session = Some(Session::new()?);
            }
            let result = session
                .as_mut()
                .unwrap()
                .request(profile, url, max, post, timeout);
            // Cancellation/failure drops the connection and its remembered choices.
            if result.is_err()
                || result
                    .as_ref()
                    .is_ok_and(|response| matches!(response.status, 401 | 403))
            {
                *session = None;
                // Do not present a new PIN/certificate chooser for every queued
                // tile after the user cancels or an identity is rejected.
                *self
                    .1
                    .lock()
                    .map_err(|_| "Native authentication unavailable")? =
                    Some(std::time::Instant::now() + Duration::from_secs(60));
            }
            result
        }
        pub fn reset(&self) {
            if let Ok(mut session) = self.0.lock() {
                *session = None;
                if let Ok(mut retry) = self.1.lock() {
                    *retry = None;
                }
            }
        }
    }
}
#[cfg(target_os = "macos")]
pub use macos::Client;
#[cfg(not(target_os = "macos"))]
#[derive(Default)]
pub struct Client {
    _private: (),
}
#[cfg(not(target_os = "macos"))]
impl Client {
    pub fn reset(&self) {}
}
