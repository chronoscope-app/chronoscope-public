//! Stable presentation DTOs, separate from stored events and credentials.
use schemars::JsonSchema;
use serde::Serialize;
#[derive(Serialize, JsonSchema)]
pub struct TerrainInfo {
    pub tiles: Vec<crate::terrain::TerrainTile>,
    pub bounds: [f64; 4],
}
#[derive(Serialize, JsonSchema)]
pub struct GeometryFeature {
    pub id: String,
    pub entity: String,
    pub time: f64,
    pub shape: crate::geometry::Shape,
}
#[derive(Serialize, JsonSchema)]
pub struct GeometryPacket {
    pub features: Vec<GeometryFeature>,
    pub count: usize,
    pub offset: usize,
    pub limited: bool,
    pub vertex_count: usize,
    pub bounds: Option<[f64; 4]>,
    pub revision: u64,
    pub semantics: String,
}
#[derive(Serialize, JsonSchema)]
pub struct InferredMarker {
    pub id: String,
    pub before_id: String,
    pub after_id: String,
    pub fraction: f64,
    pub before_time: f64,
    pub after_time: f64,
    pub method: String,
}
#[derive(Serialize, JsonSchema)]
pub struct PackedRender {
    pub revision: u64,
    pub stride: usize,
    pub data: String,
    pub ids: Vec<String>,
    pub entities: Vec<String>,
    pub located_count: usize,
    pub unlocated_count: usize,
    pub inferred_ids: Vec<String>,
    pub centroid_ids: Vec<String>,
    pub inferred_markers: Vec<InferredMarker>,
    pub rendered_count: usize,
    pub lod: bool,
    pub max_points: usize,
    pub sampling: String,
    pub selected_located_count: usize,
    pub time_bounds: (f64, f64),
}
#[derive(Serialize, JsonSchema)]
pub struct LifecycleStatus {
    pub dirty: bool,
    pub source: Option<std::path::PathBuf>,
    pub revision: u64,
    pub checkpoint_revision: Option<u64>,
    pub recovery_error: Option<String>,
    pub autosave: String,
    pub auto_save_unsaved: bool,
    pub document_directory: std::path::PathBuf,
    pub autosave_path: Option<std::path::PathBuf>,
    pub autosave_revision: Option<u64>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
    System,
}
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CoordinateDisplay {
    Dd,
    Utm,
    Mgrs,
}
