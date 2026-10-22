//! SI HTTP transport. Native TLS handles certificate challenges before POST data
//! is sent; authenticated requests never fall back, redirect or retry.
use crate::wmts_auth::{IdentityKind, Profile, Response};
use serde_json::Value;
use std::{io::Read, time::Duration};

#[derive(Default)]
pub(super) struct Client {
    http: std::sync::OnceLock<Result<reqwest::blocking::Client, String>>,
    #[cfg(target_os = "macos")]
    native: crate::wmts_native::Client,
}
impl Client {
    pub(super) fn post(
        &self,
        url: &str,
        certificate: Option<&Profile>,
        body: &Value,
        key: &str,
        timeout: Duration,
    ) -> Result<Response, String> {
        if let Some(profile) = certificate {
            if crate::wmts_auth::origin(url)? != profile.origin {
                return Err("SI certificate belongs to a different HTTPS origin".into());
            }
        }
        let native = url.starts_with("https:")
            && !certificate.is_some_and(|p| p.kind == IdentityKind::Disabled)
            && (certificate.is_some() || cfg!(any(target_os = "macos", target_os = "windows")));
        if native {
            #[cfg(target_os = "macos")]
            return self
                .native
                .post(certificate, url, body, key, timeout)
                .map_err(|e| {
                    e.replace("WMTS", "SI")
                        .replace("Map response", "SI response")
                });
            #[cfg(not(target_os = "macos"))]
            return crate::wmts_auth::post(certificate, url, body, key, timeout);
        }
        let client = self
            .http
            .get_or_init(|| {
                reqwest::blocking::Client::builder()
                    .connect_timeout(Duration::from_secs(10))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .map_err(|_| "Cannot initialize SI transport".to_string())
            })
            .as_ref()
            .map_err(Clone::clone)?;
        let mut request = client.post(url).timeout(timeout).json(body);
        if !key.is_empty() {
            request = request.bearer_auth(key);
        }
        let response = request.send().map_err(|_| "SI service request failed (connection, TLS or timeout); check server trust and client-certificate configuration. No automatic retries")?;
        let status = response.status().as_u16();
        let mut bytes = Vec::new();
        response
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read SI response")?;
        if bytes.len() > 1024 * 1024 {
            return Err("RESOURCE_LIMIT: SI response exceeded 1 MiB".into());
        }
        Ok(Response {
            status,
            bytes,
            authenticated: false,
        })
    }
}
