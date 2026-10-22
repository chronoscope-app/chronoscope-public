//! Local named WMTS connections. The library is not embedded in shared projects.
use crate::wmts::MapConfig;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, io::Write, path::Path};
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Credit {
    pub text: String,
    pub url: String,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub config: MapConfig,
    pub description: String,
    pub coverage: String,
    pub license: String,
    pub credits: Vec<Credit>,
}
#[derive(Serialize, JsonSchema)]
pub struct Catalog {
    pub servers: Vec<MapServer>,
    pub presets: &'static [Preset],
}
/// Bundled metadata is available offline, independently of the user's library.
pub fn presets() -> &'static [Preset] {
    &[]
}
fn known_presets() -> &'static [Preset] {
    static PRESETS: std::sync::LazyLock<Vec<Preset>> = std::sync::LazyLock::new(|| {
        serde_json::from_str(include_str!("map-presets.json")).expect("valid bundled WMTS presets")
    });
    &PRESETS
}
pub fn attribution(config: &MapConfig) -> Option<String> {
    known_presets()
        .iter()
        .find(|p| p.config.url == config.url && p.config.layer == config.layer)
        .map(|p| {
            p.credits
                .iter()
                .map(|c| format!("{} ({})", c.text, c.url))
                .collect::<Vec<_>>()
                .join(" · ")
        })
}
/// Some known public WMTS capabilities still advertise HTTP tile templates.
/// Use their verified HTTPS endpoint without rewriting arbitrary user services.
pub fn secure_tile_url(config: &MapConfig, tile_url: String) -> String {
    if !known_presets().iter().any(|p| p.config.url == config.url) {
        return tile_url;
    }
    if let (Ok(source), Ok(mut tile)) = (
        reqwest::Url::parse(&config.url),
        reqwest::Url::parse(&tile_url),
    ) {
        if source.scheme() == "https"
            && tile.scheme() == "http"
            && source.host_str() == tile.host_str()
            && source.port().is_none()
            && tile.port().is_none()
        {
            let _ = tile.set_scheme("https");
            return tile.into();
        }
    }
    tile_url
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MapServer {
    pub id: String,
    pub name: String,
    pub config: MapConfig,
}
#[derive(Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Library {
    pub servers: Vec<MapServer>,
}
impl Library {
    pub fn validate(&self) -> Result<(), String> {
        if self.servers.len() > 32 {
            return Err("RESOURCE_LIMIT: at most 32 saved WMTS servers".into());
        }
        let mut ids = BTreeSet::new();
        for server in &self.servers {
            if server.id.is_empty()
                || server.id.len() > 64
                || !server
                    .id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
                || !ids.insert(&server.id)
                || server.name.trim().is_empty()
                || server.name.chars().count() > 128
            {
                return Err(
                    "INVALID_ARGUMENT: WMTS servers need unique IDs and names of 1–128 characters"
                        .into(),
                );
            }
            crate::wmts::capability_url(&server.config.url)?;
            if [
                &server.config.url,
                &server.config.layer,
                &server.config.matrix_set,
                &server.config.style,
                &server.config.format,
                &server.config.time,
            ]
            .iter()
            .any(|s| s.len() > 16384)
            {
                return Err("RESOURCE_LIMIT: WMTS connection field exceeds 16 KiB".into());
            }
        }
        Ok(())
    }
}
pub fn read(data: &Path) -> Result<Library, String> {
    match std::fs::read(data.join("map-servers.json")) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Library::default()),
        Err(e) => Err(e.to_string()),
        Ok(b) if b.len() > 1024 * 1024 => {
            Err("RESOURCE_LIMIT: map server library exceeds 1 MiB".into())
        }
        Ok(b) => {
            let library: Library = serde_json::from_slice(&b)
                .map_err(|e| format!("Invalid map server library: {e}"))?;
            library.validate()?;
            Ok(library)
        }
    }
}
pub fn write(data: &Path, library: &Library) -> Result<(), String> {
    library.validate()?;
    let b = serde_json::to_vec(library).map_err(|e| e.to_string())?;
    if b.len() > 1024 * 1024 {
        return Err("RESOURCE_LIMIT: map server library exceeds 1 MiB".into());
    }
    let mut file = tempfile::NamedTempFile::new_in(data).map_err(|e| e.to_string())?;
    file.write_all(&b).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    crate::operation::check()?;
    file.persist(data.join("map-servers.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}
