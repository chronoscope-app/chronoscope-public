use crate::model::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub enum ViewMode {
    #[default]
    #[serde(alias = "Calendar")]
    SpaceTime,
    Map,
    Network,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Camera {
    pub yaw: f32,
    pub pitch: f32,
    pub zoom: f32,
    pub pan: [f32; 2],
    pub time_scale: f32,
}
impl Default for Camera {
    fn default() -> Self {
        Self {
            yaw: -0.55,
            pitch: 0.65,
            zoom: 1.,
            pan: [0., 0.],
            time_scale: 1.,
        }
    }
}

/// Cesium camera coordinates are display state, never event coordinates.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CesiumCamera {
    pub position: [f64; 3],
    pub direction: [f64; 3],
    pub up: [f64; 3],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frustum_width: Option<f64>,
}
impl CesiumCamera {
    fn validate(&self) -> bool {
        self.position
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1e10)
            && [self.direction, self.up].iter().all(|v| {
                v.iter().all(|x| x.is_finite())
                    && (v.iter().map(|x| x * x).sum::<f64>() - 1.).abs() < 1e-6
            })
            && self
                .direction
                .iter()
                .zip(self.up)
                .map(|(a, b)| a * b)
                .sum::<f64>()
                .abs()
                < 1e-6
            && self
                .frustum_width
                .is_none_or(|v| v.is_finite() && (0.01..=1e10).contains(&v))
    }
}

/// Fixed numeric scale: filtering never silently changes what a color means.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MeasurementStyle {
    pub title: String,
    pub unit: String,
    pub minimum: f64,
    pub maximum: f64,
    /// Country statistics show the latest record in the chosen time window.
    #[serde(default)]
    pub latest_per_entity: bool,
}

/// Renderer-neutral display state, portable across desktop platforms.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ViewNavigation {
    pub center: [f64; 3],
    /// Ground width through the screen centre, in metres.
    pub ground_width: f64,
    pub heading: f64,
    pub tilt: f64,
    /// Visible geographic ground corners, used to fit across projections.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub footprint: Vec<[f64; 3]>,
    /// Exact camera for an independently adjusted view; absent after syncing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera: Option<CesiumCamera>,
}
impl ViewNavigation {
    fn validate(&self) -> bool {
        self.center.iter().all(|v| v.is_finite())
            && (-180.0..=180.0).contains(&self.center[0])
            && (-90.0..=90.0).contains(&self.center[1])
            && self.center[2].abs() <= 1e7
            && self.ground_width.is_finite()
            && (0.01..=1e10).contains(&self.ground_width)
            && self.heading.is_finite()
            && (0.0..360.0).contains(&self.heading)
            && self.tilt.is_finite()
            && (0.0..=89.5).contains(&self.tilt)
            && self.footprint.len() <= 4
            && self.footprint.iter().all(|p| {
                p.iter().all(|v| v.is_finite())
                    && (-180.0..=180.0).contains(&p[0])
                    && (-90.0..=90.0).contains(&p[1])
                    && p[2].abs() <= 1e7
            })
            && self.camera.as_ref().is_none_or(CesiumCamera::validate)
    }
}

/// Renderer-neutral display state, portable across desktop platforms.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SceneState {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub renderer: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cesium_camera: Option<CesiumCamera>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub view_states: BTreeMap<String, ViewNavigation>,
    pub mode: String,
    pub position: Option<[f64; 3]>,
    pub target: Option<[f64; 3]>,
    pub time_height: Option<f64>,
    /// None preserves the default fading playback of older workspaces.
    pub playback_fade: Option<bool>,
    /// Encode UTC event time as display elevation in Globe, never source altitude.
    pub globe_time: bool,
    /// Multiplier for the terrain-relative Globe time display (default 1).
    pub globe_time_scale: Option<f64>,
    pub camera_zoom: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera_up: Option<[f64; 3]>,
    pub render_budget: Option<usize>,
    pub display: Option<crate::display::DisplayOptions>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub entity_colors: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measurement: Option<MeasurementStyle>,
    pub table_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gis_table: Option<String>,
    pub table_attributes: bool,
    pub table_respect_filters: bool,
    pub table_sort: String,
    pub table_descending: bool,
    pub table_column_offset: usize,
    pub focus: Option<f64>,
    pub bounds: Option<[f64; 4]>,
    pub table_open: bool,
    pub inspector_tab: String,
    pub expanded: bool,
    pub chart: Option<crate::charts::Config>,
    pub chart_presets: Vec<crate::charts::Preset>,
}
impl SceneState {
    pub fn validate(&self) -> Result<(), String> {
        if self.measurement.as_ref().is_some_and(|m| {
            m.title.trim().is_empty()
                || m.title.len() > 128
                || m.unit.len() > 32
                || !m.minimum.is_finite()
                || !m.maximum.is_finite()
                || m.minimum >= m.maximum
        }) {
            return Err("Invalid fixed measurement color scale".into());
        }
        if self.view_states.len() > 3
            || self.view_states.iter().any(|(mode, state)| {
                !matches!(mode.as_str(), "space-time" | "map" | "globe")
                    || !state.validate()
                    || (mode == "map" && state.tilt != 0.0)
            })
        {
            return Err("Invalid per-view navigation state".into());
        }
        if (!self.renderer.is_empty() && self.renderer != "cesium")
            || self
                .cesium_camera
                .as_ref()
                .is_some_and(|c| self.renderer != "cesium" || !c.validate())
        {
            return Err("Invalid Cesium camera state".into());
        }
        if let Some(chart) = &self.chart {
            chart.validate()?;
        }
        if self.chart_presets.len() > 32
            || self
                .chart_presets
                .iter()
                .any(|p| p.name.trim().is_empty() || p.name.len() > 128)
        {
            return Err("Invalid chart presets".into());
        }
        let mut names = BTreeSet::new();
        for preset in &self.chart_presets {
            if !names.insert(&preset.name) {
                return Err("Duplicate chart preset".into());
            }
            preset.config.validate()?;
        }
        if let Some(display) = &self.display {
            display.validate()?;
        }
        if self.entity_colors.len() > 10000
            || self.entity_colors.iter().any(|(name, color)| {
                name.len() > 8192
                    || color.len() != 7
                    || !color.starts_with('#')
                    || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
            })
        {
            return Err("Invalid entity display colors".into());
        }
        if (!self.mode.is_empty() && !["space-time", "map", "globe"].contains(&self.mode.as_str()))
            || (!self.inspector_tab.is_empty()
                && !["inspect", "patterns", "charts", "views"]
                    .contains(&self.inspector_tab.as_str()))
            || self
                .position
                .into_iter()
                .chain(self.target)
                .flatten()
                .any(|x| !x.is_finite() || x.abs() > 1e7)
            || self.camera_up.is_some_and(|v| {
                v.iter().any(|x| !x.is_finite() || x.abs() > 1.)
                    || (v.iter().map(|x| x * x).sum::<f64>() - 1.).abs() > 1e-6
            })
            || self
                .camera_zoom
                .is_some_and(|v| !v.is_finite() || !(0.1..=100.).contains(&v))
            || self.table_source.as_ref().is_some_and(|s| s.len() > 8192)
            || self
                .gis_table
                .as_ref()
                .is_some_and(|s| s.len() != 32 || !s.bytes().all(|b| b.is_ascii_hexdigit()))
            || self
                .render_budget
                .is_some_and(|v| !matches!(v, 20000 | 100000))
            || self.table_column_offset > 528
            || self.table_sort.len() > 8192
            || self
                .time_height
                .is_some_and(|v| !v.is_finite() || !(0. ..=5.).contains(&v))
            || self
                .globe_time_scale
                .is_some_and(|v| !v.is_finite() || !(0.05..=20.).contains(&v))
            || self
                .focus
                .is_some_and(|v| !v.is_finite() || !(0. ..=1.).contains(&v))
        {
            return Err("Invalid display state".into());
        }
        if let Some([w, s, e, n]) = self.bounds {
            if [w, s, e, n].iter().any(|v| !v.is_finite())
                || w >= e
                || s >= n
                || w < -180.
                || e > 180.
                || s < -90.
                || n > 90.
            {
                return Err("Invalid display bounds".into());
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ImportRecipe {
    pub source: String,
    pub sheet: String,
    pub mapping: crate::import::Mapping,
}

// Calendar's synthetic weekday/hour coordinates are not a geographic camera.
// Migrate stored workspaces and named views, while new API requests reject it.
fn deserialize_saved_scene<'de, D>(deserializer: D) -> Result<SceneState, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let mut scene = SceneState::deserialize(deserializer)?;
    if scene.mode == "calendar" {
        scene.mode = "space-time".into();
        scene.view_states.clear();
        scene.cesium_camera = None;
        scene.position = None;
        scene.target = None;
        scene.camera_up = None;
        scene.camera_zoom = None;
        scene.bounds = None;
    }
    Ok(scene)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceSettings {
    pub preferences: crate::engine::Preferences,
    #[serde(default)]
    pub terrain_files: Vec<PathBuf>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SavedView {
    #[serde(default, deserialize_with = "deserialize_saved_scene")]
    pub scene: SceneState,
    pub name: String,
    #[serde(default)]
    pub mode: ViewMode,
    pub filter: Filter,
    pub selected: BTreeSet<u64>,
    pub camera: Camera,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Group {
    pub name: String,
    pub ids: BTreeSet<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatasetProvenance {
    pub title: String,
    pub creator: String,
    pub source_url: String,
    pub license: String,
    pub license_url: String,
    pub changes: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Project {
    /// Dataset-level credit retained through portable/SQLite saves and CSV sidecars.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub provenance: Vec<DatasetProvenance>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub field_roles: crate::field_roles::Roles,
    #[serde(default = "format_name")]
    pub format: String,
    #[serde(default = "resolution_name")]
    pub time_resolution: String,
    #[serde(default, deserialize_with = "deserialize_saved_scene")]
    pub scene: SceneState,
    #[serde(default)]
    pub workspace: Option<WorkspaceSettings>,
    #[serde(default)]
    pub imports: Vec<ImportRecipe>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub gis_layers: Vec<crate::gis::Layer>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub resources_external: bool,
    #[serde(skip)]
    pub resource_dir: Option<PathBuf>,
    pub version: u32,
    #[serde(default)]
    pub mode: ViewMode,
    pub dataset: Dataset,
    pub filter: Filter,
    pub selected: BTreeSet<u64>,
    pub camera: Camera,
    pub views: Vec<SavedView>,
    pub groups: Vec<Group>,
}
fn format_name() -> String {
    "chronoscope.workspace".into()
}
fn resolution_name() -> String {
    "fractional_second".into()
}
impl Project {
    /// A fresh user workspace contains no example or synthetic observations.
    pub fn empty() -> Self {
        Self::new(Dataset {
            name: "Untitled workspace".into(),
            ..Default::default()
        })
    }
    pub fn new(dataset: Dataset) -> Self {
        Self {
            format: format_name(),
            provenance: Vec::new(),
            field_roles: BTreeMap::new(),
            time_resolution: resolution_name(),
            scene: SceneState::default(),
            workspace: None,
            imports: Vec::new(),
            gis_layers: Vec::new(),
            resources_external: false,
            resource_dir: None,
            version: 6,
            mode: ViewMode::default(),
            dataset,
            filter: Filter::default(),
            selected: BTreeSet::new(),
            camera: Camera::default(),
            views: Vec::new(),
            groups: Vec::new(),
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if ![1, 2, 3, 4, 5, 6].contains(&self.version)
            || self.format != format_name()
            || !matches!(
                self.time_resolution.as_str(),
                "minute" | "fractional_second"
            )
        {
            return Err("Unsupported project version".into());
        }
        if self.provenance.len() > 1000
            || self.provenance.iter().any(|p| {
                [
                    &p.title,
                    &p.creator,
                    &p.source_url,
                    &p.license,
                    &p.license_url,
                    &p.changes,
                ]
                .iter()
                .any(|text| text.len() > 16384)
            })
        {
            return Err("Dataset provenance exceeds text budgets".into());
        }
        self.dataset.validate()?;
        crate::field_roles::validate(&self.field_roles)?;
        crate::gis::validate_layers(&self.gis_layers)?;
        self.scene.validate()?;
        if self.imports.len() > 1000 {
            return Err("Too many import recipes".into());
        }
        if let Some(w) = &self.workspace {
            w.preferences.validate()?;
            if w.terrain_files.len() > 2048 {
                return Err("Too many terrain resources".into());
            }
        }
        validate_context(&self.filter, &self.camera)?;
        if self.views.len() > 200 || self.groups.len() > 500 {
            return Err("Project exceeds 200 saved views or 500 groups".into());
        }
        for view in &self.views {
            validate_context(&view.filter, &view.camera)?;
            view.scene.validate()?;
        }
        let ids: BTreeSet<_> = self.dataset.events.iter().map(|e| e.id).collect();
        if !self.selected.is_subset(&ids)
            || self.views.iter().any(|v| !v.selected.is_subset(&ids))
            || self.groups.iter().any(|g| !g.ids.is_subset(&ids))
        {
            return Err("Project selection refers to missing events".into());
        }
        Ok(())
    }
}
fn validate_context(filter: &Filter, c: &Camera) -> Result<(), String> {
    if ![c.yaw, c.pitch, c.zoom, c.pan[0], c.pan[1], c.time_scale]
        .iter()
        .all(|v| v.is_finite())
        || !(0.1..=15.).contains(&c.zoom)
        || !(0.1..=3.).contains(&c.time_scale)
        || c.pan.iter().any(|v| v.abs() > 1_000_000.)
    {
        return Err("Invalid camera in project".into());
    }
    if filter.start.zip(filter.end).is_some_and(|(a, b)| a > b)
        || [filter.start, filter.end]
            .into_iter()
            .flatten()
            .any(|t| crate::timestamps::datetime(t).is_none())
    {
        return Err("Invalid time range in project".into());
    }
    if filter.hidden_entities.len() > 10000
        || filter.hidden_categories.len() > 10000
        || filter.hidden_sources.len() > 10000
        || filter.search.len() > 16384
    {
        return Err("Project filter exceeds text/visibility budgets".into());
    }
    if filter.facet_fields.len() > 2
        || filter.facet_hidden.len() > 2
        || filter.facet_fields.iter().any(|(kind, field)| {
            !["entity", "category"].contains(&kind.as_str())
                || field.len() > 8192
                || !(matches!(
                    field.as_str(),
                    "id" | "entity"
                        | "category"
                        | "source"
                        | "label"
                        | "related_to"
                        | "note"
                        | "time"
                        | "end"
                        | "lat"
                        | "lon"
                        | "value"
                        | "source_row"
                        | "mgrs_precision"
                        | "geometry_wkt"
                        | "tags"
                        | "location_kind"
                ) || field
                    .strip_prefix("attribute:")
                    .is_some_and(|key| !key.is_empty()))
        })
        || filter.facet_hidden.iter().any(|(kind, values)| {
            !["entity", "category"].contains(&kind.as_str())
                || values.len() > 10000
                || values.iter().any(|v| v.len() > 8192)
        })
    {
        return Err("Invalid sidebar field filters".into());
    }
    if filter.predicates.len() > 128 {
        return Err("Project exceeds 128 attribute rules".into());
    }
    if let Some(b) = &filter.bounds {
        if ![b.south, b.north, b.west, b.east]
            .iter()
            .all(|v| v.is_finite())
            || b.south > b.north
            || b.south < -90.
            || b.north > 90.
            || b.west < -180.
            || b.west > 180.
            || b.east < -180.
            || b.east > 180.
        {
            return Err("Invalid geographic filter".into());
        }
    }
    Ok(())
}
const MAX_TERRAIN_BYTES: u64 = 512 * 1024 * 1024;
fn is_bundle(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("chronoscope"))
}
pub fn save(path: &Path, project: &Project) -> Result<(), String> {
    project.validate()?;
    // GIS packages use the existing indexed container even for small datasets.
    // Raw resources never inflate the JSON manifest or UI snapshots.
    if is_bundle(path) && !project.gis_layers.is_empty() {
        let scratch = tempfile::tempdir().map_err(|e| e.to_string())?;
        let mut store = crate::store::DataStore::new(scratch.path())?;
        let mut metadata = project.clone();
        metadata.version = 6;
        store.load_events(std::mem::take(&mut metadata.dataset.events))?;
        return store.save_as(path, &metadata);
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    let mut portable = migrate(project.clone())?;
    let mut files = Vec::new();
    if is_bundle(path) {
        if let Some(w) = &mut portable.workspace {
            if !w.terrain_files.is_empty() {
                w.preferences.terrain_builtin = false;
            }
            let mut total = 0u64;
            for (i, file) in w.terrain_files.iter_mut().enumerate() {
                let size = file
                    .metadata()
                    .map_err(|e| format!("Cannot bundle terrain {}: {e}", file.display()))?
                    .len();
                total = total.checked_add(size).ok_or("Terrain size overflow")?;
                if size > 32 * 1024 * 1024 || total > MAX_TERRAIN_BYTES {
                    return Err("Terrain bundle exceeds 32 MiB per tile or 512 MiB total".into());
                }
                let ext = file
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if !["dt0", "dt1", "dt2"].contains(&ext.as_str()) {
                    return Err("Only DTED resources can be bundled".into());
                }
                let name = format!("terrain/{i:04}.{ext}");
                files.push((file.clone(), name.clone()));
                *file = PathBuf::from(name);
            }
            w.preferences.terrain_path = None;
        }
    }
    let manifest = serde_json::to_vec(&portable).map_err(|e| e.to_string())?;
    if manifest.len() as u64 > MAX_FILE_BYTES {
        return Err("Project manifest exceeds 64 MiB".into());
    }
    if is_bundle(path) {
        let mut archive = zip::ZipWriter::new(&mut temp);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o600);
        archive
            .start_file("manifest.json", options)
            .map_err(|e| e.to_string())?;
        archive.write_all(&manifest).map_err(|e| e.to_string())?;
        let mut actual_total = 0u64;
        for (path, name) in files {
            archive
                .start_file(name, options)
                .map_err(|e| e.to_string())?;
            let copied = std::io::copy(
                &mut File::open(path)
                    .map_err(|e| e.to_string())?
                    .take(32 * 1024 * 1024 + 1),
                &mut archive,
            )
            .map_err(|e| e.to_string())?;
            actual_total += copied;
            if copied > 32 * 1024 * 1024 || actual_total > MAX_TERRAIN_BYTES {
                return Err("Terrain tile changed during save".into());
            }
        }
        archive.finish().map_err(|e| e.to_string())?;
    } else {
        temp.write_all(&manifest).map_err(|e| e.to_string())?;
    }
    temp.flush().map_err(|e| e.to_string())?;
    crate::persistence::persist(temp, path)?;
    Ok(())
}
fn migrate(mut p: Project) -> Result<Project, String> {
    p.validate()?;
    // Old minute-aligned data keeps its original instants; lost detail is not invented.
    p.time_resolution = resolution_name();
    p.version = 6;
    p.validate()?;
    Ok(p)
}
pub fn load(path: &Path) -> Result<Project, String> {
    load_with_resources(path, &crate::engine::default_data_dir())
}
pub fn load_with_resources(path: &Path, data_dir: &Path) -> Result<Project, String> {
    if crate::store::DataStore::is_database(path) {
        let (store, metadata) = crate::store::DataStore::open_copy(path, data_dir)?;
        return store.materialize(metadata);
    }
    let size = path.metadata().map_err(|e| e.to_string())?.len();
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut magic = [0u8; 4];
    let n = file.read(&mut magic).map_err(|e| e.to_string())?;
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    if n < 4 || &magic != b"PK\x03\x04" {
        if size > MAX_FILE_BYTES {
            return Err("Project exceeds 64 MiB limit".into());
        }
        return migrate(serde_json::from_reader(BufReader::new(file)).map_err(|e| e.to_string())?);
    }
    if size > MAX_FILE_BYTES + MAX_TERRAIN_BYTES {
        return Err("Project bundle exceeds size limit".into());
    }
    use sha2::{Digest, Sha256};
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    let mut read_total = 0u64;
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        read_total += n as u64;
        if read_total > MAX_FILE_BYTES + MAX_TERRAIN_BYTES {
            return Err("Bundle changed beyond size limit".into());
        }
        digest.update(&buffer[..n]);
    }
    let cache_key = format!("{:x}", digest.finalize());
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    if archive.len() > 2049 {
        return Err("Too many bundle entries".into());
    }
    let mut names = BTreeSet::new();
    let mut total = 0u64;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().map_err(|e| e.to_string())?.into_owned();
        let terrain = name.strip_prefix("terrain/").is_some_and(|s| {
            let Some((base, ext)) = s.split_once('.') else {
                return false;
            };
            base.len() == 4
                && base.bytes().all(|b| b.is_ascii_digit())
                && ["dt0", "dt1", "dt2"].contains(&ext)
        });
        if !names.insert(name.to_owned())
            || name != "manifest.json" && !terrain
            || entry.is_dir()
            || entry.is_symlink()
        {
            return Err("Invalid or duplicate bundle entry".into());
        }
        let limit = if terrain {
            32 * 1024 * 1024
        } else {
            MAX_FILE_BYTES
        };
        if entry.size() > limit {
            return Err("Bundle entry exceeds size limit".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("Bundle size overflow")?;
        if total > MAX_FILE_BYTES + MAX_TERRAIN_BYTES {
            return Err("Expanded bundle exceeds size limit".into());
        }
    }
    let mut manifest = Vec::new();
    archive
        .by_name("manifest.json")
        .map_err(|e| e.to_string())?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut manifest)
        .map_err(|e| e.to_string())?;
    if manifest.len() as u64 > MAX_FILE_BYTES {
        return Err("Manifest exceeds size limit".into());
    }
    let p = migrate(serde_json::from_slice(&manifest).map_err(|e| e.to_string())?)?;
    let expected: BTreeSet<_> = p
        .workspace
        .as_ref()
        .map(|w| {
            w.terrain_files
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    if expected.len() != p.workspace.as_ref().map_or(0, |w| w.terrain_files.len())
        || names
            .iter()
            .filter(|n| *n != "manifest.json")
            .cloned()
            .collect::<BTreeSet<_>>()
            != expected
    {
        return Err("Bundle resources do not match manifest".into());
    }
    if expected.is_empty() {
        return Ok(p);
    }
    let root = data_dir.join("project-assets");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let retained = root.join(cache_key);
    if retained.exists() {
        if std::fs::symlink_metadata(&retained)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Invalid project resource cache".into());
        }
        for name in &expected {
            let cached = retained.join(name);
            let metadata = std::fs::symlink_metadata(&cached).map_err(|e| e.to_string())?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() != archive.by_name(name).map_err(|e| e.to_string())?.size()
            {
                return Err("Invalid cached terrain; remove this workspace's project-assets cache and reopen".into());
            }
        }
        let catalog = crate::terrain::TerrainCatalog::load(&retained.join("terrain"))?;
        if catalog.tiles.len() != expected.len() {
            return Err("Unexpected cached terrain resources".into());
        }
        return bind_resources(p, retained);
    }
    let stage = tempfile::Builder::new()
        .prefix("workspace-")
        .tempdir_in(&root)
        .map_err(|e| e.to_string())?;
    std::fs::create_dir(stage.path().join("terrain")).map_err(|e| e.to_string())?;
    for name in &expected {
        let mut entry = archive.by_name(name).map_err(|e| e.to_string())?;
        let mut output = File::create(stage.path().join(name)).map_err(|e| e.to_string())?;
        let count = std::io::copy(&mut (&mut entry).take(32 * 1024 * 1024 + 1), &mut output)
            .map_err(|e| e.to_string())?;
        if count != entry.size() || count > 32 * 1024 * 1024 {
            return Err("Invalid resource size".into());
        }
    }
    // Validate DTED before retaining the directory or exposing its paths to the engine.
    crate::terrain::TerrainCatalog::load(&stage.path().join("terrain"))?;
    match std::fs::rename(stage.path(), &retained) {
        Ok(()) => {}
        Err(_) if retained.is_dir() => { /* Another validated concurrent open finished first. */ }
        Err(e) => return Err(e.to_string()),
    }
    bind_resources(p, retained)
}
fn bind_resources(mut p: Project, retained: PathBuf) -> Result<Project, String> {
    if let Some(w) = &mut p.workspace {
        for file in &mut w.terrain_files {
            *file = retained.join(&*file);
        }
        w.preferences.terrain_path = Some(retained.join("terrain"));
        w.preferences.terrain_builtin = false;
    }
    p.resource_dir = Some(retained);
    Ok(p)
}
fn safe_text(s: &str) -> String {
    if s.trim_start().starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.into()
    }
}
pub fn export_csv(path: &Path, events: impl Iterator<Item = Event>) -> Result<usize, String> {
    let events: Vec<_> = events.collect();
    let keys: BTreeSet<_> = events
        .iter()
        .flat_map(|e| e.attrs.keys().cloned())
        .collect();
    export_csv_with_columns(path, events.into_iter(), keys)
}
pub fn export_csv_with_columns(
    path: &Path,
    events: impl Iterator<Item = Event>,
    keys: BTreeSet<String>,
) -> Result<usize, String> {
    export_csv_results(path, events.map(Ok), keys)
}
pub fn export_csv_results(
    path: &Path,
    events: impl Iterator<Item = Result<Event, String>>,
    keys: BTreeSet<String>,
) -> Result<usize, String> {
    let (temp, count) = stage_csv(path, events, keys)?;
    crate::persistence::persist(temp, path)?;
    Ok(count)
}

fn stage_csv(
    path: &Path,
    events: impl Iterator<Item = Result<Event, String>>,
    keys: BTreeSet<String>,
) -> Result<(tempfile::NamedTempFile, usize), String> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    let count;
    {
        let mut writer = csv::Writer::from_writer(&mut temp);
        let mut headers = vec![
            "id",
            "entity",
            "timestamp",
            "end",
            "latitude",
            "longitude",
            "category",
            "label",
            "value",
            "related_to",
            "tags",
            "note",
            "source",
            "source_row",
            "geometry_wkt",
            "location_kind",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
        headers.extend(keys.iter().map(|k| format!("attribute:{k}")));
        writer.write_record(headers).map_err(|e| e.to_string())?;
        let mut written = 0;
        for e in events {
            crate::operation::check()?;
            let e = e?;
            e.validate()?;
            written += 1;
            let mut row = vec![
                e.id.to_string(),
                safe_text(&e.entity),
                crate::timestamps::utc_time(e.time).ok_or("Invalid event timestamp")?,
                e.end
                    .and_then(crate::timestamps::utc_time)
                    .unwrap_or_default(),
                e.lat.map(|n| n.to_string()).unwrap_or_default(),
                e.lon.map(|n| n.to_string()).unwrap_or_default(),
                safe_text(&e.category),
                safe_text(&e.label),
                e.value.map(|n| n.to_string()).unwrap_or_default(),
                safe_text(&e.related_to),
                safe_text(&e.tags.iter().cloned().collect::<Vec<_>>().join(";")),
                safe_text(&e.note),
                safe_text(&e.source),
                e.source_row.to_string(),
                safe_text(e.geometry_wkt.as_deref().unwrap_or("")),
                e.location_kind.clone().unwrap_or_default(),
            ];
            row.extend(
                keys.iter()
                    .map(|k| safe_text(e.attrs.get(k).map(String::as_str).unwrap_or(""))),
            );
            writer.write_record(row).map_err(|e| e.to_string())?;
        }
        writer.flush().map_err(|e| e.to_string())?;
        count = written;
    }
    Ok((temp, count))
}

/// Stage/validate both files before touching destinations, restoring ordinary
/// failed replacements. Two renames are NOT crash-atomic; callers must keep both.
pub fn export_csv_attributed(
    path: &Path,
    events: impl Iterator<Item = Result<Event, String>>,
    keys: BTreeSet<String>,
    provenance: &[DatasetProvenance],
) -> Result<(usize, PathBuf), String> {
    let (csv, count) = stage_csv(path, events, keys)?;
    let mut name = path.as_os_str().to_os_string();
    name.push(".attribution.json");
    let sidecar = PathBuf::from(name);
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut credit = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    // An explicit empty array replaces stale credit on uncredited overwrites.
    serde_json::to_writer_pretty(&mut credit, provenance).map_err(|e| e.to_string())?;
    credit.write_all(b"\n").map_err(|e| e.to_string())?;
    commit_export_pair([(csv, path), (credit, &sidecar)], |_| Ok(()))?;
    Ok((count, sidecar))
}

fn commit_export_pair(
    staged: [(tempfile::NamedTempFile, &Path); 2],
    mut before_replace: impl FnMut(usize) -> Result<(), String>,
) -> Result<(), String> {
    // Snapshot regular old files before the first rename; reject special paths.
    let mut backups = Vec::new();
    for (file, path) in &staged {
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        let backup = match std::fs::symlink_metadata(path) {
            Ok(metadata) => {
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err("Export destination must be a regular file".into());
                }
                let mut backup = tempfile::NamedTempFile::new_in(file.path().parent().unwrap())
                    .map_err(|e| e.to_string())?;
                let mut source = File::open(path).map_err(|e| e.to_string())?;
                std::io::copy(&mut source, &mut backup).map_err(|e| e.to_string())?;
                backup.as_file().sync_all().map_err(|e| e.to_string())?;
                Some(backup)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        backups.push((path.to_path_buf(), backup));
    }
    crate::operation::check()?;
    let mut replaced = 0;
    let outcome = (|| {
        for (index, (file, path)) in staged.into_iter().enumerate() {
            before_replace(index)?;
            file.persist(path).map_err(|e| e.to_string())?;
            replaced += 1;
        }
        Ok(())
    })();
    if let Err(error) = outcome {
        let mut rollback_errors = Vec::new();
        for (path, backup) in backups.into_iter().take(replaced).rev() {
            if let Some(backup) = backup {
                if let Err(failure) = backup.persist(&path) {
                    let message = failure.error.to_string();
                    let retained = failure
                        .file
                        .keep()
                        .map(|(_, path)| path.display().to_string())
                        .unwrap_or_else(|e| e.to_string());
                    rollback_errors.push(format!("{message}; retained recovery copy: {retained}"));
                }
            } else if let Err(failure) = std::fs::remove_file(&path) {
                rollback_errors.push(failure.to_string());
            }
        }
        return Err(if rollback_errors.is_empty() {
            error
        } else {
            format!("{error}; rollback failed: {}", rollback_errors.join("; "))
        });
    }
    crate::operation::file_committed();
    #[cfg(unix)]
    for (path, _) in &backups {
        if File::open(
            path.parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new(".")),
        )
        .and_then(|d| d.sync_all())
        .is_err()
        {
            eprintln!("Chronoscope: export pair saved; parent directory sync unavailable");
        }
    }
    Ok(())
}
#[cfg(test)]
#[path = "project_pair_tests.rs"]
mod pair_tests;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_roundtrip_and_validation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.chrono.json");
        let p = Project::new(crate::demo::dataset());
        save(&path, &p).unwrap();
        assert_eq!(load(&path).unwrap().dataset.events, p.dataset.events);
        let mut invalid = p.clone();
        invalid.dataset.events[0].lat = Some(100.);
        assert!(save(&path, &invalid).is_err());
        assert!(load(&path).is_ok());
    }
    #[test]
    fn csv_formula_guard_and_attribute_preservation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.csv");
        let mut e = crate::demo::dataset().events[0].clone();
        e.label = "=HYPERLINK(\"bad\")".into();
        export_csv(&path, [e].into_iter()).unwrap();
        let mut r = csv::Reader::from_path(path).unwrap();
        assert!(r
            .headers()
            .unwrap()
            .iter()
            .any(|h| h == "attribute:confidence"));
        assert!(r.records().next().unwrap().unwrap()[7].starts_with('\''));
    }
}
