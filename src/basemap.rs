//! Fixed public vector basemap resources, using the existing private disk cache.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Basemap {
    #[default]
    None,
    Streets,
}

#[derive(Serialize, JsonSchema)]
pub struct Resource {
    pub data: String,
    pub cache_hit: bool,
}

fn validate_url(url: &str) -> Result<reqwest::Url, String> {
    let uri = reqwest::Url::parse(url).map_err(|_| "Invalid basemap resource URL")?;
    if url.len() > 4096
        || uri.scheme() != "https"
        || uri.host_str() != Some("tiles.openfreemap.org")
        || uri.port_or_known_default() != Some(443)
        || !uri.username().is_empty()
        || uri.password().is_some()
        || uri.fragment().is_some()
        || !(uri.path() == "/planet"
            || [
                "/styles/positron",
                "/planet/",
                "/fonts/",
                "/sprites/",
                "/natural_earth/",
            ]
            .iter()
            .any(|prefix| uri.path().starts_with(prefix)))
    {
        return Err("INVALID_ARGUMENT: only OpenFreeMap Streets resources are allowed".into());
    }
    Ok(uri)
}

pub fn resource(service: &crate::wmts::TileService, url: &str) -> Result<Resource, String> {
    let uri = validate_url(url)?;
    // Versioned vector tiles/fonts/sprites are immutable. Styles, TileJSON and
    // latest-version aliases must not be pinned to the older WMTS tile TTL.
    let metadata = uri.path().starts_with("/styles/")
        || uri.path().contains("/latest")
        || !uri.path().rsplit('/').next().unwrap_or("").contains('.');
    let ttl = Duration::from_secs(if metadata { 3600 } else { 86400 * 30 });
    let (bytes, cache_hit) = service.fetch(url, 8 * 1024 * 1024, ttl)?;
    Ok(Resource {
        data: STANDARD.encode(bytes),
        cache_hit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_basemap_is_not_an_arbitrary_url_fetcher() {
        for url in [
            "http://tiles.openfreemap.org/styles/positron",
            "https://tiles.openfreemap.org.evil.invalid/styles/positron",
            "https://user:secret@tiles.openfreemap.org/styles/positron",
            "https://tiles.openfreemap.org:8443/styles/positron",
            "https://127.0.0.1/styles/positron",
            "https://tiles.openfreemap.org/other",
        ] {
            assert!(validate_url(url).is_err(), "{url}");
        }
        assert!(validate_url("https://tiles.openfreemap.org/styles/positron").is_ok());
        assert!(validate_url("https://tiles.openfreemap.org/planet/20261014/14/1/2.pbf").is_ok());
    }
}
