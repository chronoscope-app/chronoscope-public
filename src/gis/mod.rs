//! Local Cesium GIS sources. Descriptors stay small; immutable packaged assets
//! are addressed by hash and fetched in bounded chunks without a listening proxy.
mod assets;
mod normalize;
pub(crate) use assets::validate_scoped_package;
pub use assets::{features, load, read, validate_package};
pub use normalize::{raw_from_layer, raw_import, Feature};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const MAX_LAYERS: usize = 64;
pub const MAX_PACKAGE: u64 = 512 * 1024 * 1024;
pub const MAX_TOTAL: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_SOURCE: u64 = 64 * 1024 * 1024;
pub const MAX_ASSET: u64 = 256 * 1024 * 1024;
pub const MAX_FILES: usize = 8192;
pub const MAX_FEATURES: usize = 250_000;
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Geojson,
    Topojson,
    Kml,
    Kmz,
    Czml,
    Gpx,
    Tiles3d,
    Gltf,
    Glb,
}
impl Format {
    pub fn is_model(&self) -> bool {
        matches!(self, Self::Gltf | Self::Glb)
    }
    pub fn is_3d(&self) -> bool {
        self.is_model() || *self == Self::Tiles3d
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Layer {
    pub id: String,
    pub name: String,
    pub format: Format,
    pub enabled: bool,
    #[serde(default)]
    pub selected: Vec<String>,
    pub asset: PathBuf,
    pub sha256: String,
    pub entrypoint: String,
    pub bytes: u64,
    pub resource_count: usize,
    pub feature_count: usize,
    pub bounds: Option<[f64; 4]>,
    pub time_bounds: Option<[f64; 2]>,
    /// Explicit WGS84 longitude, latitude and ellipsoidal height for unreferenced models.
    pub position: Option<[f64; 3]>,
    pub scale: f64,
    pub warnings: Vec<String>,
}
impl Layer {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.len() != 32
            || !self.id.bytes().all(|b| b.is_ascii_hexdigit())
            || self.sha256.len() != 64
            || !self.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            || self.selected.len() > 1000
            || self.selected.iter().map(String::len).sum::<usize>() > 512 * 1024
            || self.selected.iter().any(|id| id.len() > 8192)
            || self.name.trim().is_empty()
            || self.name.len() > 8192
            || self.asset.as_os_str().len() > 32768
            || !safe_name(&self.entrypoint)
            || self.bytes > MAX_PACKAGE
            || self.resource_count == 0
            || self.resource_count > MAX_FILES
            || self.feature_count > MAX_FEATURES
            || self.warnings.len() > 64
            || self.warnings.iter().any(|w| w.len() > 8192)
            || !self.scale.is_finite()
            || !(0.000001..=1e6).contains(&self.scale)
        {
            return Err("Invalid GIS layer descriptor".into());
        }
        if self.position.is_some_and(|[x, y, z]| {
            !x.is_finite()
                || !y.is_finite()
                || !z.is_finite()
                || !(-180. ..=180.).contains(&x)
                || !(-90. ..=90.).contains(&y)
                || !(-12000. ..=1e8).contains(&z)
        }) || self.format.is_model() && self.position.is_none()
            || self.time_bounds.is_some_and(|[a, b]| {
                a > b
                    || crate::timestamps::datetime(a).is_none()
                    || crate::timestamps::datetime(b).is_none()
            })
            || self.bounds.is_some_and(|b| {
                b.iter().any(|n| !n.is_finite())
                    || b[0] < -180.
                    || b[2] > 180.
                    || b[1] < -90.
                    || b[3] > 90.
                    || b[0] > b[2]
                    || b[1] > b[3]
            })
        {
            return Err("Invalid GIS placement or bounds".into());
        }
        Ok(())
    }
}
pub fn validate_layers(layers: &[Layer]) -> Result<(), String> {
    let mut ids = std::collections::BTreeSet::new();
    let mut bytes = 0u64;
    if layers.len() > MAX_LAYERS {
        return Err("GIS layer limit is 64".into());
    }
    for layer in layers {
        layer.validate()?;
        if !ids.insert(&layer.id) {
            return Err("Duplicate GIS layer ID".into());
        }
        bytes = bytes.checked_add(layer.bytes).ok_or("GIS size overflow")?;
    }
    if bytes > MAX_TOTAL {
        return Err("GIS resources exceed 2 GiB per workspace".into());
    }
    Ok(())
}
pub fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 4096
        && !name.contains(['\\', ':', '\0', '?', '#'])
        && !name.starts_with('/')
        && name
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != "..")
}
pub fn format(path: &Path, bytes: &[u8]) -> Result<Format, String> {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "geojson" => Ok(Format::Geojson), "topojson"=>Ok(Format::Topojson),
        "kml"=>Ok(Format::Kml),"kmz"=>Ok(Format::Kmz),"gpx"=>Ok(Format::Gpx),
        "czml"=>Ok(Format::Czml),"gltf"=>Ok(Format::Gltf),"glb"=>Ok(Format::Glb),
        "json"=> { let v:serde_json::Value=serde_json::from_slice(bytes).map_err(|e|format!("Invalid JSON: {e}"))?;
            match v["type"].as_str() { Some("Topology")=>Ok(Format::Topojson),Some("Feature"|"FeatureCollection"|"Point"|"MultiPoint"|"LineString"|"MultiLineString"|"Polygon"|"MultiPolygon"|"GeometryCollection")=>Ok(Format::Geojson),_=>{
                if v.is_array() && v[0]["id"]=="document" {Ok(Format::Czml)} else if v["asset"].is_object() && v["root"].is_object() {Ok(Format::Tiles3d)} else if v["asset"]["version"]=="2.0" {Ok(Format::Gltf)} else {Err("JSON is not a supported GIS document".into())}
            }}
        }, _=>Err("Unsupported GIS format; use GeoJSON, TopoJSON, KML/KMZ, CZML, GPX, tileset.json or glTF/GLB".into())
    }
}
pub fn mime(name: &str) -> &'static str {
    match name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "kml" => "application/vnd.google-earth.kml+xml",
        "gpx" | "xml" => "application/xml",
        "json" | "geojson" | "topojson" | "czml" | "gltf" => "application/json",
        "glb" => "model/gltf-binary",
        _ => "application/octet-stream",
    }
}

#[derive(Serialize, schemars::JsonSchema)]
pub struct LayerResult {
    pub layer: Layer,
}
#[derive(Serialize, schemars::JsonSchema)]
pub struct LayersResult {
    pub layers: Vec<Layer>,
}
#[derive(Serialize, schemars::JsonSchema)]
pub struct TableResult {
    pub revision: u64,
    pub returned_count: usize,
    pub next_offset: Option<usize>,
    pub rows: Vec<Feature>,
    pub count: usize,
    pub offset: usize,
    pub limit: usize,
    pub columns: Vec<String>,
    pub source: String,
    pub semantics: String,
}
