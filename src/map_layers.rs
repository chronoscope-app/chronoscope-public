//! Portable WMTS layer stack. Array order is bottom to top; zoom is Web Mercator XYZ.
use crate::wmts::MapConfig;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MapLayer {
    pub id: String,
    pub name: String,
    pub server_name: String,
    pub config: MapConfig,
    pub opacity: f64,
    pub min_zoom: f64,
    pub max_zoom: f64,
}
pub fn validate(layers: &[MapLayer]) -> Result<(), String> {
    if layers.len() > 64 {
        return Err("RESOURCE_LIMIT: at most 64 map layers".into());
    }
    let mut ids = BTreeSet::new();
    for layer in layers {
        if layer.id.is_empty()
            || layer.id.len() > 64
            || !layer
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
            || !ids.insert(&layer.id)
            || layer.name.trim().is_empty()
            || layer.name.chars().count() > 256
            || layer.server_name.chars().count() > 128
            || !layer.opacity.is_finite()
            || !(0.0..=1.0).contains(&layer.opacity)
            || !layer.min_zoom.is_finite()
            || !layer.max_zoom.is_finite()
            || !(0.0..=30.0).contains(&layer.min_zoom)
            || !(0.0..=30.0).contains(&layer.max_zoom)
            || layer.min_zoom >= layer.max_zoom
        {
            return Err("INVALID_ARGUMENT: map layers need unique IDs, names, opacity 0–1 and 0 ≤ minimum zoom < maximum zoom ≤ 30".into());
        }
        crate::wmts::capability_url(&layer.config.url)?;
        if layer.config.enabled
            && (layer.config.layer.is_empty() || layer.config.matrix_set.is_empty())
        {
            return Err("INVALID_ARGUMENT: enabled map layers need a layer and matrix set".into());
        }
        if [
            &layer.config.url,
            &layer.config.layer,
            &layer.config.matrix_set,
            &layer.config.style,
            &layer.config.format,
            &layer.config.time,
        ]
        .iter()
        .any(|s| s.len() > 16384)
        {
            return Err("RESOURCE_LIMIT: map layer field exceeds 16 KiB".into());
        }
    }
    Ok(())
}
