//! WMTS addressing, concurrent direct access and a configurable local disk cache.
use roxmltree::Node;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock, Weak,
    },
    time::{Duration, Instant},
};
#[derive(Clone, Copy, PartialEq)]
enum SupportedCrs {
    Mercator,
    LatitudeLongitude,
    LongitudeLatitude,
}
fn supported_crs(value: &str) -> Option<SupportedCrs> {
    let value = value.trim().to_ascii_uppercase();
    let epsg = value
        .strip_prefix("EPSG:")
        .or_else(|| {
            value
                .strip_prefix("URN:OGC:DEF:CRS:EPSG:")
                .and_then(|s| s.rsplit(':').next())
        })
        .or_else(|| {
            value
                .strip_prefix("HTTP://WWW.OPENGIS.NET/DEF/CRS/EPSG/")
                .or_else(|| value.strip_prefix("HTTPS://WWW.OPENGIS.NET/DEF/CRS/EPSG/"))
                .and_then(|s| s.rsplit('/').next())
        });
    match epsg {
        Some("3857" | "900913") => Some(SupportedCrs::Mercator),
        Some("4326") => Some(SupportedCrs::LatitudeLongitude),
        _ if matches!(
            value.as_str(),
            "CRS:84"
                | "OGC:CRS84"
                | "URN:OGC:DEF:CRS:OGC:1.3:CRS84"
                | "URN:OGC:DEF:CRS:OGC::CRS84"
                | "HTTP://WWW.OPENGIS.NET/DEF/CRS/OGC/1.3/CRS84"
                | "HTTPS://WWW.OPENGIS.NET/DEF/CRS/OGC/1.3/CRS84"
        ) =>
        {
            Some(SupportedCrs::LongitudeLatitude)
        }
        _ => None,
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, Default, JsonSchema)]
pub struct MapConfig {
    pub url: String,
    pub layer: String,
    pub matrix_set: String,
    pub style: String,
    pub format: String,
    pub time: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub level: Option<usize>,
}
impl MapConfig {
    pub fn nasa() -> Self {
        Self {
            url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"
                .into(),
            layer: "BlueMarble_ShadedRelief".into(),
            matrix_set: "GoogleMapsCompatible_Level8".into(),
            style: "default".into(),
            format: "image/jpeg".into(),
            time: String::new(),
            enabled: true,
            level: None,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
pub struct Dimension {
    pub name: String,
    pub default: String,
    pub values: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
pub struct Layer {
    pub id: String,
    pub title: String,
    pub style: String,
    pub formats: Vec<String>,
    pub matrix_sets: Vec<String>,
    pub dimensions: Vec<Dimension>,
    pub templates: BTreeMap<String, String>,
    #[serde(default)]
    pub limits: BTreeMap<String, BTreeMap<String, MatrixLimits>>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
pub struct MatrixLimits {
    pub min_row: u32,
    pub max_row: u32,
    pub min_col: u32,
    pub max_col: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
pub struct Matrix {
    pub id: String,
    pub scale: f64,
    pub top_left: [f64; 2],
    pub tile_width: u32,
    pub tile_height: u32,
    pub width: u32,
    pub height: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
pub struct MatrixSet {
    pub id: String,
    pub crs: String,
    pub matrices: Vec<Matrix>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
pub struct Capabilities {
    pub title: String,
    pub layers: Vec<Layer>,
    pub matrix_sets: Vec<MatrixSet>,
    pub kvp_url: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
pub struct TileRequest {
    pub url: String,
    pub matrix: String,
    pub row: u32,
    pub col: u32,
    pub bounds: [f64; 4],
    pub geographic: bool,
}
#[derive(Serialize, JsonSchema)]
pub struct RasterTile {
    pub request: TileRequest,
    pub data_url: String,
    pub cache_hit: bool,
}
#[derive(Serialize, JsonSchema)]
pub struct RasterResult {
    pub tiles: Vec<RasterTile>,
    pub requests: u64,
    pub cache_hits: u64,
    pub attribution: String,
    pub total_tiles: u64,
    pub next_offset: Option<u64>,
}
fn text<'a>(n: Node<'a, 'a>, name: &str) -> String {
    n.children()
        .find(|c| c.is_element() && c.tag_name().name() == name)
        .and_then(|c| c.text())
        .unwrap_or("")
        .trim()
        .into()
}
fn children<'a>(n: Node<'a, 'a>, name: &'a str) -> impl Iterator<Item = Node<'a, 'a>> {
    n.children()
        .filter(move |c| c.is_element() && c.tag_name().name() == name)
}
pub fn parse(xml: &str) -> Result<Capabilities, String> {
    if xml.len() > 8 * 1024 * 1024 {
        return Err("Capabilities exceed 8 MiB".into());
    }
    let doc = roxmltree::Document::parse(xml).map_err(|e| format!("Invalid WMTS XML: {e}"))?;
    let root = doc.root_element();
    if root.tag_name().name() != "Capabilities" {
        return Err("Server did not return WMTS Capabilities".into());
    }
    let contents = root
        .children()
        .find(|n| n.tag_name().name() == "Contents")
        .ok_or("WMTS has no Contents")?;
    let mut layers = Vec::new();
    for n in children(contents, "Layer") {
        let formats: Vec<_> = children(n, "Format")
            .filter_map(|f| f.text().map(str::to_owned))
            .collect();
        let style = children(n, "Style")
            .find(|s| s.attribute("isDefault") == Some("true"))
            .or_else(|| children(n, "Style").next())
            .map(|s| text(s, "Identifier"))
            .unwrap_or_else(|| "default".into());
        let templates = children(n, "ResourceURL")
            .filter(|r| r.attribute("resourceType") == Some("tile"))
            .filter_map(|r| {
                Some((
                    r.attribute("format")?.into(),
                    r.attribute("template")?.into(),
                ))
            })
            .collect();
        let dimensions = children(n, "Dimension")
            .map(|d| Dimension {
                name: text(d, "Identifier"),
                default: text(d, "Default"),
                values: children(d, "Value")
                    .filter_map(|v| v.text().map(str::to_owned))
                    .take(100)
                    .collect(),
            })
            .collect();
        let mut limits = BTreeMap::new();
        for link in children(n, "TileMatrixSetLink") {
            if let Some(container) = children(link, "TileMatrixSetLimits").next() {
                let mut matrices = BTreeMap::new();
                for limit in children(container, "TileMatrixLimits") {
                    let number = |key| {
                        text(limit, key)
                            .parse::<u32>()
                            .map_err(|_| "Invalid WMTS matrix limit")
                    };
                    let value = MatrixLimits {
                        min_row: number("MinTileRow")?,
                        max_row: number("MaxTileRow")?,
                        min_col: number("MinTileCol")?,
                        max_col: number("MaxTileCol")?,
                    };
                    if value.min_row > value.max_row || value.min_col > value.max_col {
                        return Err("Invalid WMTS matrix limit range".into());
                    }
                    matrices.insert(text(limit, "TileMatrix"), value);
                }
                limits.insert(text(link, "TileMatrixSet"), matrices);
            }
        }
        layers.push(Layer {
            id: text(n, "Identifier"),
            title: text(n, "Title"),
            style,
            formats,
            matrix_sets: children(n, "TileMatrixSetLink")
                .map(|m| text(m, "TileMatrixSet"))
                .collect(),
            dimensions,
            templates,
            limits,
        });
    }
    let mut matrix_sets = Vec::new();
    for n in children(contents, "TileMatrixSet") {
        let crs = text(n, "SupportedCRS");
        let mut matrices = Vec::new();
        for m in children(n, "TileMatrix") {
            let parse = |name: &str| {
                text(m, name)
                    .parse::<f64>()
                    .map_err(|_| format!("Invalid WMTS {name}"))
            };
            let corner = text(m, "TopLeftCorner")
                .split_whitespace()
                .map(str::parse::<f64>)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| "Invalid WMTS origin")?;
            if corner.len() != 2 {
                return Err("Invalid WMTS origin".into());
            }
            let mut tl = [corner[0], corner[1]];
            if supported_crs(&crs) == Some(SupportedCrs::LatitudeLongitude) {
                tl.swap(0, 1);
            }
            let integer = |name: &str| {
                text(m, name)
                    .parse::<u32>()
                    .map_err(|_| format!("Invalid WMTS integer {name}"))
            };
            let scale = parse("ScaleDenominator")?;
            let tw = integer("TileWidth")?;
            let th = integer("TileHeight")?;
            let width = integer("MatrixWidth")?;
            let height = integer("MatrixHeight")?;
            if !scale.is_finite()
                || scale <= 0.
                || !tl.iter().all(|v| v.is_finite())
                || tw == 0
                || th == 0
                || tw > 4096
                || th > 4096
                || width == 0
                || height == 0
            {
                return Err("Invalid WMTS matrix dimensions".into());
            }
            matrices.push(Matrix {
                id: text(m, "Identifier"),
                scale,
                top_left: tl,
                tile_width: tw,
                tile_height: th,
                width,
                height,
            });
        }
        matrices.sort_by(|a, b| b.scale.total_cmp(&a.scale));
        matrix_sets.push(MatrixSet {
            id: text(n, "Identifier"),
            crs,
            matrices,
        });
    }
    let kvp_url = doc
        .descendants()
        .filter(|n| n.tag_name().name() == "Operation" && n.attribute("name") == Some("GetTile"))
        .flat_map(|n| n.descendants())
        .find(|n| n.tag_name().name() == "Get")
        .and_then(|n| {
            n.attributes()
                .find(|a| a.name() == "href")
                .map(|a| a.value().into())
        });
    let title = doc
        .descendants()
        .find(|n| n.tag_name().name() == "ServiceIdentification")
        .map(|n| text(n, "Title"))
        .unwrap_or_else(|| "WMTS".into());
    Ok(Capabilities {
        title,
        layers,
        matrix_sets,
        kvp_url,
    })
}
pub fn capability_url(input: &str) -> Result<String, String> {
    let mut url = reqwest::Url::parse(input).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("WMTS URL must be HTTP(S), without embedded credentials".into());
    }
    if !url.path().to_lowercase().ends_with(".xml")
        && !url
            .query()
            .unwrap_or("")
            .to_lowercase()
            .contains("getcapabilities")
    {
        url.query_pairs_mut()
            .append_pair("SERVICE", "WMTS")
            .append_pair("REQUEST", "GetCapabilities")
            .append_pair("VERSION", "1.0.0");
    }
    Ok(url.into())
}
#[derive(Serialize, JsonSchema)]
pub struct PlanPage {
    pub tiles: Vec<TileRequest>,
    pub total_tiles: u64,
    pub next_offset: Option<u64>,
}
/// Advertised MIME aliases still decode to bounded PNG or JPEG tile bytes.
pub fn supported_raster_format(format: &str) -> bool {
    matches!(
        format.to_ascii_lowercase().as_str(),
        "image/png" | "image/jpeg" | "image/jpg" | "image/jpgpng"
    )
}
pub fn plan(
    c: &Capabilities,
    config: &MapConfig,
    bounds: [f64; 4],
    preferred: Option<usize>,
) -> Result<Vec<TileRequest>, String> {
    let page = plan_page(c, config, bounds, preferred, 0, 4096, 1400.)?;
    if page.next_offset.is_some() {
        return Err(format!(
            "Plan contains {} tiles; use wmts_plan_page for paged coverage",
            page.total_tiles
        ));
    }
    Ok(page.tiles)
}
#[allow(clippy::too_many_arguments)]
pub fn plan_page(
    c: &Capabilities,
    config: &MapConfig,
    bounds: [f64; 4],
    preferred: Option<usize>,
    offset: u64,
    limit: usize,
    target_pixels: f64,
) -> Result<PlanPage, String> {
    if !target_pixels.is_finite() || !(1.0..=32768.).contains(&target_pixels) {
        return Err("Invalid WMTS target pixel dimension".into());
    }
    if !bounds.iter().all(|v| v.is_finite())
        || bounds[0] >= bounds[2]
        || bounds[1] >= bounds[3]
        || bounds[0] < -180.
        || bounds[2] > 180.
        || bounds[1] < -85.05112878
        || bounds[3] > 85.05112878
    {
        return Err("WMTS requires non-crossing bounds within Web Mercator latitudes".into());
    }
    let layer = c
        .layers
        .iter()
        .find(|l| l.id == config.layer)
        .ok_or("WMTS layer not found")?;
    if !layer.matrix_sets.contains(&config.matrix_set) {
        return Err("Layer does not support this matrix set".into());
    }
    let set = c
        .matrix_sets
        .iter()
        .find(|s| s.id == config.matrix_set)
        .ok_or("Matrix set not found")?;
    let crs = supported_crs(&set.crs).ok_or_else(|| {
        format!(
            "Unsupported WMTS CRS {}; use EPSG:3857 or EPSG:4326/CRS84",
            set.crs
        )
    })?;
    let geographic = crs != SupportedCrs::Mercator;
    if geographic
        && set
            .matrices
            .iter()
            .any(|m| m.top_left[0].abs() > 180. + 1e-8 || m.top_left[1].abs() > 90. + 1e-8)
    {
        return Err("WMTS geographic origin is outside WGS84 bounds; EPSG:4326 requires latitude/longitude axis order, CRS84 longitude/latitude".into());
    }
    if set.matrices.is_empty() {
        return Err("Empty matrix set".into());
    }
    let sw = if geographic {
        [bounds[0], bounds[1]]
    } else {
        crate::coordinates::mercator(bounds[1], bounds[0])
    };
    let ne = if geographic {
        [bounds[2], bounds[3]]
    } else {
        crate::coordinates::mercator(bounds[3], bounds[2])
    };
    let range = |m: &Matrix| {
        let r = m.scale * 0.00028 / if geographic { 111319.49079327358 } else { 1. };
        let w = r * m.tile_width as f64;
        let h = r * m.tile_height as f64;
        let mut x0 = ((sw[0] - m.top_left[0]) / w).floor().max(0.) as u32;
        let mut x1 = ((ne[0] - m.top_left[0]) / w).ceil() as i64 - 1;
        x1 = x1.min(i64::from(m.width - 1));
        let mut y0 = ((m.top_left[1] - ne[1]) / h).floor().max(0.) as u32;
        let mut y1 = ((m.top_left[1] - sw[1]) / h).ceil() as i64 - 1;
        y1 = y1.min(i64::from(m.height - 1));
        if x1 < 0 || y1 < 0 {
            return (1, 0, 1, 0, w, h);
        }
        let mut x1 = x1 as u32;
        let mut y1 = y1 as u32;
        if let Some(limits) = layer.limits.get(&set.id) {
            let Some(limit) = limits.get(&m.id) else {
                return (1, 0, 1, 0, w, h);
            };
            x0 = x0.max(limit.min_col);
            x1 = x1.min(limit.max_col);
            y0 = y0.max(limit.min_row);
            y1 = y1.min(limit.max_row);
        }
        (x0, x1, y0, y1, w, h)
    };
    if preferred
        .or(config.level)
        .is_some_and(|i| i >= set.matrices.len())
    {
        return Err("Requested WMTS resolution index does not exist in this matrix set".into());
    }
    let index = preferred
        .or(config.level)
        .unwrap_or_else(|| {
            let target = (ne[0] - sw[0]).max(ne[1] - sw[1]) / target_pixels.clamp(1., 32768.);
            set.matrices
                .iter()
                .rposition(|m| {
                    m.scale * 0.00028 / if geographic { 111319.49079327358 } else { 1. } >= target
                })
                .unwrap_or(0)
        })
        .min(set.matrices.len() - 1);
    let m = &set.matrices[index];
    let (x0, x1, y0, y1, w, h) = range(m);
    if x0 > x1 || y0 > y1 {
        return Ok(PlanPage {
            tiles: vec![],
            total_tiles: 0,
            next_offset: None,
        });
    }
    let columns = u64::from(x1 - x0) + 1;
    let total_tiles = columns * (u64::from(y1 - y0) + 1);
    let finish = offset
        .saturating_add(limit.clamp(1, 4096) as u64)
        .min(total_tiles);
    let format = if config.format.is_empty() {
        layer
            .formats
            .iter()
            .find(|f| supported_raster_format(f))
            .cloned()
            .ok_or("Layer has no supported image format")?
    } else {
        config.format.clone()
    };
    if !supported_raster_format(&format) {
        return Err("Only PNG and JPEG WMTS rasters are supported".into());
    }
    let style = if config.style.is_empty() {
        &layer.style
    } else {
        &config.style
    };
    let mut result = Vec::new();
    for position in offset..finish {
        let row = y0 + (position / columns) as u32;
        let col = x0 + (position % columns) as u32;
        let url = if let Some(template) = layer.templates.get(&format) {
            let mut url = template.clone();
            for (k, v) in [
                ("Layer", layer.id.clone()),
                ("Style", style.clone()),
                ("TileMatrixSet", set.id.clone()),
                ("TileMatrix", m.id.clone()),
                ("TileRow", row.to_string()),
                ("TileCol", col.to_string()),
            ] {
                url = url.replace(&format!("{{{k}}}"), &v);
            }
            for d in &layer.dimensions {
                let v = if d.name.eq_ignore_ascii_case("time") && !config.time.is_empty() {
                    &config.time
                } else {
                    &d.default
                };
                url = url
                    .replace(&format!("{{{}}}", d.name), v)
                    .replace(&format!("{{{}}}", d.name.to_uppercase()), v);
            }
            if url.contains('{') {
                return Err("WMTS template has unresolved dimensions".into());
            }
            url
        } else {
            let mut u = reqwest::Url::parse(c.kvp_url.as_deref().unwrap_or(&config.url))
                .map_err(|e| e.to_string())?;
            // Preserve service-specific API keys while replacing operation parameters.
            let pairs: Vec<(String, String)> = u
                .query_pairs()
                .filter(|(k, _)| {
                    ![
                        "SERVICE",
                        "REQUEST",
                        "VERSION",
                        "LAYER",
                        "STYLE",
                        "FORMAT",
                        "TILEMATRIXSET",
                        "TILEMATRIX",
                        "TILEROW",
                        "TILECOL",
                        "TIME",
                    ]
                    .contains(&k.to_ascii_uppercase().as_str())
                })
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();
            u.set_query(None);
            u.query_pairs_mut().extend_pairs(pairs);
            u.query_pairs_mut().extend_pairs([
                ("SERVICE", "WMTS"),
                ("REQUEST", "GetTile"),
                ("VERSION", "1.0.0"),
                ("LAYER", &layer.id),
                ("STYLE", style),
                ("FORMAT", &format),
                ("TILEMATRIXSET", &set.id),
                ("TILEMATRIX", &m.id),
                ("TILEROW", &row.to_string()),
                ("TILECOL", &col.to_string()),
            ]);
            for dimension in &layer.dimensions {
                let value =
                    if dimension.name.eq_ignore_ascii_case("time") && !config.time.is_empty() {
                        &config.time
                    } else {
                        &dimension.default
                    };
                u.query_pairs_mut().append_pair(&dimension.name, value);
            }
            u.into()
        };
        let left = m.top_left[0] + col as f64 * w;
        let top = m.top_left[1] - row as f64 * h;
        let bounds = if geographic {
            [left, top - h, left + w, top]
        } else {
            let (s, west) = crate::coordinates::inverse_mercator(left, top - h);
            let (n, east) = crate::coordinates::inverse_mercator(left + w, top);
            [west, s, east, n]
        };
        result.push(TileRequest {
            url: crate::map_servers::secure_tile_url(config, url),
            matrix: m.id.clone(),
            row,
            col,
            bounds,
            geographic,
        });
    }
    Ok(PlanPage {
        tiles: result,
        total_tiles,
        next_offset: if finish < total_tiles {
            Some(finish)
        } else {
            None
        },
    })
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct AccessSettings {
    pub concurrency: usize,
    pub request_interval_ms: u64,
    pub cache_limit_mb: u64,
    pub tile_ttl_days: u64,
    pub offline: bool,
}
impl Default for AccessSettings {
    fn default() -> Self {
        Self {
            concurrency: 8,
            request_interval_ms: 0,
            cache_limit_mb: 8192,
            tile_ttl_days: 30,
            offline: false,
        }
    }
}
impl AccessSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=32).contains(&self.concurrency)
            || self.request_interval_ms > 60000
            || self.cache_limit_mb > 1048576
            || !(1..=3650).contains(&self.tile_ttl_days)
        {
            Err("Invalid map access/cache settings".into())
        } else {
            Ok(())
        }
    }
}
fn new_scope() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
pub struct TileService {
    pub cache: PathBuf,
    pub auth: crate::wmts_auth::AuthStore,
    native: crate::wmts_native::Client,
    client: reqwest::Client,
    inflight: Mutex<usize>,
    available: std::sync::Condvar,
    gate: Mutex<Instant>,
    locks: Mutex<BTreeMap<String, Weak<Mutex<()>>>>,
    settings: RwLock<AccessSettings>,
    automatic_scope: RwLock<String>,
    cache_bytes: AtomicU64,
    prune_gate: Mutex<()>,
    pub requests: AtomicU64,
    pub hits: AtomicU64,
}
struct Flight<'a>(&'a TileService);
impl Drop for Flight<'_> {
    fn drop(&mut self) {
        if let Ok(mut n) = self.0.inflight.lock() {
            *n = n.saturating_sub(1);
            self.0.available.notify_all();
        }
    }
}
impl TileService {
    pub fn new(cache: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&cache, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        let auth = crate::wmts_auth::AuthStore::new(
            cache
                .parent()
                .ok_or("Invalid map cache directory")?
                .join("wmts-auth.json"),
        );
        let settings_path = cache.parent().unwrap().join("wmts-access.json");
        let settings = match std::fs::read(settings_path) {
            Ok(bytes) => {
                if bytes.len() > 16384 {
                    return Err("Invalid local WMTS settings: file too large".into());
                }
                let settings: AccessSettings = serde_json::from_slice(&bytes).map_err(|_| {
                    "Invalid local WMTS settings; repair or remove wmts-access.json"
                })?;
                settings.validate()?;
                settings
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => AccessSettings::default(),
            Err(e) => return Err(format!("Cannot read local WMTS settings: {e}")),
        };
        // Automatic client-certificate cache entries belong to a TLS identity
        // session. A fresh online process cannot silently reuse a prior identity.
        // Offline mode explicitly reuses the last session without reauthorizing.
        let scope_path = cache.parent().unwrap().join("wmts-auto-cache.json");
        let prior = if settings.offline {
            std::fs::read(&scope_path)
                .ok()
                .filter(|b| b.len() < 1024)
                .and_then(|b| serde_json::from_slice::<String>(&b).ok())
                .filter(|s| s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        } else {
            None
        };
        let automatic_scope = if let Some(scope) = prior {
            scope
        } else {
            new_scope()?
        };
        let mut scope_file =
            tempfile::NamedTempFile::new_in(cache.parent().unwrap()).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut scope_file, &automatic_scope).map_err(|e| e.to_string())?;
        scope_file.persist(&scope_path).map_err(|e| e.to_string())?;
        let cache_bytes = std::fs::read_dir(&cache)
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|e| e.metadata().ok())
                    .filter(|m| m.is_file())
                    .map(|m| m.len())
                    .sum()
            })
            .unwrap_or(0);
        let client = reqwest::Client::builder()
            .user_agent(concat!(
                "Chronoscope/",
                env!("CARGO_PKG_VERSION"),
                " (desktop GIS; direct disk cache)"
            ))
            .timeout(Duration::from_secs(40))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            cache,
            auth,
            native: crate::wmts_native::Client::default(),
            client,
            inflight: Mutex::new(0),
            available: std::sync::Condvar::new(),
            gate: Mutex::new(Instant::now()),
            locks: Mutex::new(BTreeMap::new()),
            settings: RwLock::new(settings),
            automatic_scope: RwLock::new(automatic_scope),
            cache_bytes: AtomicU64::new(cache_bytes),
            prune_gate: Mutex::new(()),
            requests: AtomicU64::new(0),
            hits: AtomicU64::new(0),
        })
    }
    fn flight(&self) -> Result<Flight<'_>, String> {
        let mut active = self
            .inflight
            .lock()
            .map_err(|_| "Map concurrency unavailable")?;
        loop {
            crate::operation::check()?;
            if *active < self.access_settings()?.concurrency {
                *active += 1;
                return Ok(Flight(self));
            }
            active = self
                .available
                .wait_timeout(active, Duration::from_millis(25))
                .map_err(|_| "Map concurrency unavailable")?
                .0;
        }
    }
    fn download(&self, url: &str, max: u64) -> Result<(u16, Option<u64>, Vec<u8>), String> {
        static RUNTIME: std::sync::OnceLock<Result<tokio::runtime::Runtime, String>> =
            std::sync::OnceLock::new();
        let runtime = RUNTIME
            .get_or_init(|| {
                tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(2)
                    .enable_all()
                    .build()
                    .map_err(|e| e.to_string())
            })
            .as_ref()
            .map_err(Clone::clone)?;
        let cancelled = crate::operation::cancellation_flag();
        runtime.block_on(async {
            let work=async {
                let mut response=self.client.get(url).send().await.map_err(|e|e.to_string())?;
                let status=response.status().as_u16();
                let retry=response.headers().get("retry-after").and_then(|h|h.to_str().ok()).and_then(|s|s.parse::<u64>().ok());
                if response.content_length().is_some_and(|n|n>max){return Err("Map response exceeds size limit".into());}
                let mut bytes=Vec::new();
                while let Some(chunk)=response.chunk().await.map_err(|e|e.to_string())? {
                    if bytes.len() as u64+chunk.len() as u64>max{return Err("Map response exceeds size limit".into());}
                    bytes.extend_from_slice(&chunk);
                }
                Ok((status,retry,bytes))
            };
            let cancel=async {
                if let Some(flag)=cancelled {loop{if flag.load(Ordering::Relaxed){break;}tokio::time::sleep(Duration::from_millis(25)).await;}}
                else{std::future::pending::<()>().await;}
            };
            tokio::select!{result=work=>result,_=cancel=>Err("CANCELLED: map request cancelled".into())}
        })
    }
    pub fn access_settings(&self) -> Result<AccessSettings, String> {
        self.settings
            .read()
            .map(|s| s.clone())
            .map_err(|_| "Map settings unavailable".into())
    }
    pub fn set_access_settings(&self, settings: AccessSettings) -> Result<(), String> {
        settings.validate()?;
        if self.access_settings()?.offline && !settings.offline {
            self.reset_authentication()?;
        }
        let mut file = tempfile::NamedTempFile::new_in(self.cache.parent().unwrap())
            .map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut file, &settings).map_err(|e| e.to_string())?;
        file.persist(self.cache.parent().unwrap().join("wmts-access.json"))
            .map_err(|e| e.to_string())?;
        *self
            .settings
            .write()
            .map_err(|_| "Map settings unavailable")? = settings;
        self.prune();
        Ok(())
    }
    pub fn cache_info(&self) -> Result<serde_json::Value, String> {
        Ok(
            serde_json::json!({"directory":self.cache,"bytes":self.cache_bytes.load(Ordering::Relaxed),"settings":self.access_settings()?,"transport":"direct HTTP(S), no proxy/listening server required","automatic_auth_cache":"online session separated; offline explicitly reuses last session without revalidation"}),
        )
    }
    pub fn clear_cache(&self) -> Result<(), String> {
        for entry in std::fs::read_dir(&self.cache)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            if entry.file_type().map_err(|e| e.to_string())?.is_file() {
                std::fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
            }
        }
        self.cache_bytes.store(0, Ordering::Relaxed);
        Ok(())
    }
    pub fn reset_authentication(&self) -> Result<(), String> {
        self.native.reset();
        let scope = new_scope()?;
        let mut file = tempfile::NamedTempFile::new_in(self.cache.parent().unwrap())
            .map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut file, &scope).map_err(|e| e.to_string())?;
        file.persist(self.cache.parent().unwrap().join("wmts-auto-cache.json"))
            .map_err(|e| e.to_string())?;
        *self
            .automatic_scope
            .write()
            .map_err(|_| "Authentication cache unavailable")? = scope;
        Ok(())
    }
    pub fn automatic_cache_scope(&self) -> Result<String, String> {
        self.automatic_scope
            .read()
            .map(|s| s.clone())
            .map_err(|_| "Authentication cache unavailable".into())
    }
    fn scoped_key(&self, url: &str, profile: &Option<crate::wmts_auth::Entry>) -> String {
        let scope = match profile {
            Some(entry) => entry.cache_scope.clone(),
            None if url.starts_with("https:")
                && cfg!(any(target_os = "macos", target_os = "windows")) =>
            {
                self.automatic_scope
                    .read()
                    .map(|s| format!("native-automatic-{s}"))
                    .unwrap_or_else(|_| "unavailable".into())
            }
            None => String::new(),
        };
        if scope.is_empty() {
            url.to_owned()
        } else {
            format!("{scope}\0{url}")
        }
    }
    pub fn metadata_key(&self, url: &str) -> Result<String, String> {
        Ok(self.scoped_key(url, &self.auth.get(url)?))
    }
    pub fn fetch(&self, url: &str, max: u64, ttl: Duration) -> Result<(Vec<u8>, bool), String> {
        if url.len() > 4096 || url.chars().any(char::is_control) {
            return Err(
                "WMTS resource URL must be at most 4096 bytes without control characters".into(),
            );
        }
        let uri = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
        if !matches!(uri.scheme(), "https" | "http")
            || !uri.username().is_empty()
            || uri.password().is_some()
            || uri.host_str().is_none()
        {
            return Err("Only HTTP(S) map resources are allowed".into());
        }
        if max == 0 || max > 8 * 1024 * 1024 {
            return Err("Invalid map response size budget".into());
        }
        let entry = self.auth.get(url)?;
        let profile = entry
            .as_ref()
            .filter(|e| e.profile.kind != crate::wmts_auth::IdentityKind::Disabled)
            .map(|e| &e.profile);
        let automatic = entry.is_none()
            && uri.scheme() == "https"
            && cfg!(any(target_os = "macos", target_os = "windows"));
        let name = format!(
            "{:x}",
            Sha256::digest(self.scoped_key(url, &entry).as_bytes())
        );
        let mut path = self.cache.join(&name);
        // Only responses confirmed by the native transport to have used no
        // client identity enter this persistent anonymous namespace.
        let anonymous = self
            .cache
            .join(format!("{:x}", Sha256::digest(url.as_bytes())));
        if automatic {
            if let Ok(meta) = anonymous.metadata() {
                if meta.len() <= max
                    && meta
                        .modified()
                        .ok()
                        .and_then(|t| t.elapsed().ok())
                        .is_some_and(|age| {
                            age < ttl || self.access_settings().is_ok_and(|s| s.offline)
                        })
                {
                    self.hits.fetch_add(1, Ordering::Relaxed);
                    return std::fs::read(&anonymous)
                        .map(|b| (b, true))
                        .map_err(|e| e.to_string());
                }
            }
        }
        if let Ok(m) = path.metadata() {
            if m.len() <= max
                && m.modified()
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|age| age < ttl || self.access_settings().is_ok_and(|s| s.offline))
            {
                self.hits.fetch_add(1, Ordering::Relaxed);
                return std::fs::read(&path)
                    .map(|b| (b, true))
                    .map_err(|e| e.to_string());
            }
        }
        let settings = self.access_settings()?;
        if settings.offline {
            return Err("WMTS offline mode: requested resource is not in the disk cache".into());
        }
        let lock = {
            let mut locks = self.locks.lock().map_err(|_| "Map cache unavailable")?;
            if locks.len() > 512 {
                locks.retain(|_, v| v.strong_count() > 0);
            }
            let lock = locks
                .get(&name)
                .and_then(Weak::upgrade)
                .unwrap_or_else(|| Arc::new(Mutex::new(())));
            locks.insert(name.clone(), Arc::downgrade(&lock));
            lock
        };
        let _resource = lock.lock().map_err(|_| "Map request unavailable")?;
        if let Ok(m) = path.metadata() {
            if m.len() <= max
                && m.modified()
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|age| age < ttl)
            {
                self.hits.fetch_add(1, Ordering::Relaxed);
                return std::fs::read(&path)
                    .map(|b| (b, true))
                    .map_err(|e| e.to_string());
            }
        }
        let _flight = self.flight()?;
        let start = {
            let mut gate = self.gate.lock().map_err(|_| "Map scheduler unavailable")?;
            let now = Instant::now();
            if *gate > now && settings.request_interval_ms == 0 {
                return Err(format!(
                    "WMTS paused after rate limit; retry after {} seconds",
                    gate.saturating_duration_since(now).as_secs() + 1
                ));
            }
            let start = (*gate).max(now);
            *gate = start + Duration::from_millis(settings.request_interval_ms);
            start
        };
        while Instant::now() < start {
            crate::operation::check()?;
            std::thread::sleep(
                start
                    .saturating_duration_since(Instant::now())
                    .min(Duration::from_millis(100)),
            );
        }
        crate::operation::check()?;
        self.requests.fetch_add(1, Ordering::Relaxed);
        let (bytes, authenticated) = if profile.is_some() || automatic {
            #[cfg(target_os = "macos")]
            let response = self.native.fetch(profile, url, max)?;
            #[cfg(not(target_os = "macos"))]
            let response = crate::wmts_auth::fetch(profile, url, max)?;
            if response.status == 429 {
                *self.gate.lock().map_err(|_| "Map scheduler unavailable")? =
                    Instant::now() + Duration::from_secs(60);
                return Err("WMTS rate limited; paused for 60 seconds. No automatic retry.".into());
            }
            if (300..400).contains(&response.status) {
                return Err("WMTS client authentication does not follow cross-origin redirects; configure the final HTTPS endpoint directly".into());
            }
            if !(200..300).contains(&response.status) {
                return Err(format!(
                    "WMTS HTTP {} (native client authentication)",
                    response.status
                ));
            }
            (response.bytes, response.authenticated)
        } else {
            let (status, retry, bytes) = self.download(url, max)?;
            if status == 429 {
                let delay = retry.unwrap_or(60).min(300);
                *self.gate.lock().map_err(|_| "Map scheduler unavailable")? =
                    Instant::now() + Duration::from_secs(delay);
                return Err(format!(
                    "WMTS rate limited; paused for {delay} seconds. No automatic retry."
                ));
            }
            if !(200..300).contains(&status) {
                return Err(format!("WMTS HTTP {status}"));
            }
            (bytes, false)
        };
        if automatic && !authenticated {
            path = anonymous;
        }

        let mut temp = tempfile::NamedTempFile::new_in(&self.cache).map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut temp, &bytes).map_err(|e| e.to_string())?;
        let previous = path.metadata().map(|m| m.len()).unwrap_or(0);
        temp.persist(path).map_err(|e| e.to_string())?;
        self.cache_bytes
            .fetch_add(bytes.len() as u64, Ordering::Relaxed);
        let mut current = self.cache_bytes.load(Ordering::Relaxed);
        while let Err(actual) = self.cache_bytes.compare_exchange_weak(
            current,
            current.saturating_sub(previous),
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            current = actual;
        }
        self.prune();
        Ok((bytes, false))
    }
    fn prune(&self) {
        let limit = self
            .access_settings()
            .map(|s| s.cache_limit_mb * 1024 * 1024)
            .unwrap_or(8192 * 1024 * 1024);
        if limit == 0 || self.cache_bytes.load(Ordering::Relaxed) <= limit {
            return;
        }
        let Ok(_prune) = self.prune_gate.try_lock() else {
            return;
        };
        if let Ok(entries) = std::fs::read_dir(&self.cache) {
            let mut files: Vec<_> = entries
                .flatten()
                .filter_map(|e| {
                    e.metadata()
                        .ok()
                        .map(|m| (e.path(), m.len(), m.modified().ok()))
                })
                .collect();
            let mut size = files.iter().map(|f| f.1).sum::<u64>();
            if size > limit {
                files.sort_by_key(|f| f.2);
                for (path, len, _) in files {
                    if size <= limit * 9 / 10 {
                        break;
                    }
                    if std::fs::remove_file(path).is_ok() {
                        size = size.saturating_sub(len);
                        let mut current = self.cache_bytes.load(Ordering::Relaxed);
                        while let Err(actual) = self.cache_bytes.compare_exchange_weak(
                            current,
                            current.saturating_sub(len),
                            Ordering::Relaxed,
                            Ordering::Relaxed,
                        ) {
                            current = actual;
                        }
                    }
                }
            }
        }
    }
    pub fn capabilities(&self, url: &str) -> Result<Capabilities, String> {
        let url = capability_url(url)?;
        let (xml, _) = self.fetch(&url, 8 * 1024 * 1024, Duration::from_secs(86400))?;
        let mut result =
            parse(std::str::from_utf8(&xml).map_err(|_| "Capabilities are not UTF-8")?)?;
        let base = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
        for layer in &mut result.layers {
            for template in layer.templates.values_mut() {
                if !template.starts_with("http://") && !template.starts_with("https://") {
                    *template = base
                        .join(template)
                        .map_err(|e| e.to_string())?
                        .to_string()
                        .replace("%7B", "{")
                        .replace("%7D", "}");
                }
            }
        }
        if let Some(endpoint) = &mut result.kvp_url {
            *endpoint = base.join(endpoint).map_err(|e| e.to_string())?.into();
        }
        Ok(result)
    }
    pub fn rasters(
        &self,
        c: &Capabilities,
        config: &MapConfig,
        bounds: [f64; 4],
        preferred: Option<usize>,
    ) -> Result<RasterResult, String> {
        self.rasters_page(c, config, bounds, preferred, 0, 4096, 1400.)
    }
    #[allow(clippy::too_many_arguments)]
    pub fn rasters_page(
        &self,
        c: &Capabilities,
        config: &MapConfig,
        bounds: [f64; 4],
        preferred: Option<usize>,
        offset: u64,
        limit: usize,
        target_pixels: f64,
    ) -> Result<RasterResult, String> {
        let planned = plan_page(c, config, bounds, preferred, offset, limit, target_pixels)?;
        let settings = self.access_settings()?;
        let mut tiles = vec![];
        let mut response_bytes = 0;
        'pages: for chunk in planned.tiles.chunks(settings.concurrency) {
            let context = crate::operation::current_context();
            let results = std::thread::scope(|scope| {
                let workers = chunk
                    .iter()
                    .map(|request| {
                        let context = context.clone();
                        scope.spawn(move || {
                            let action = || self.load_tile(request.clone(), settings.tile_ttl_days);
                            if let Some(context) = context {
                                crate::operation::with_context(context, action)
                            } else {
                                action()
                            }
                        })
                    })
                    .collect::<Vec<_>>();
                workers
                    .into_iter()
                    .map(|worker| {
                        worker
                            .join()
                            .unwrap_or_else(|_| Err("Map worker failed".into()))
                    })
                    .collect::<Vec<_>>()
            });
            for result in results {
                let tile = result?;
                let cost = tile.data_url.len() + tile.request.url.len() + 512;
                if response_bytes + cost > 7 * 1024 * 1024 && !tiles.is_empty() {
                    break 'pages;
                }
                response_bytes += cost;
                tiles.push(tile);
            }
        }
        let delivered = offset + tiles.len() as u64;
        Ok(RasterResult {
            tiles,
            requests: self.requests.load(Ordering::Relaxed),
            cache_hits: self.hits.load(Ordering::Relaxed),
            attribution: crate::map_servers::attribution(config).unwrap_or_else(|| c.title.clone()),
            total_tiles: planned.total_tiles,
            next_offset: (delivered < planned.total_tiles).then_some(delivered),
        })
    }
    fn load_tile(&self, request: TileRequest, ttl_days: u64) -> Result<RasterTile, String> {
        use base64::Engine;

        crate::operation::check()?;
        let (bytes, hit) = self.fetch(
            &request.url,
            4 * 1024 * 1024,
            Duration::from_secs(ttl_days * 86400),
        )?;
        let format = image::guess_format(&bytes).map_err(|_| "WMTS returned non-image tile")?;
        let mut reader = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(4096);
        limits.max_image_height = Some(4096);
        limits.max_alloc = Some(64 * 1024 * 1024);
        reader.limits(limits);
        let (width, height) = reader
            .into_dimensions()
            .map_err(|e| format!("Invalid WMTS raster: {e}"))?;
        if width == 0 || height == 0 || width > 4096 || height > 4096 {
            return Err("WMTS raster dimensions exceed the 4096-pixel budget".into());
        }
        let mime = match format {
            image::ImageFormat::Png => "image/png",
            image::ImageFormat::Jpeg => "image/jpeg",
            _ => return Err("Unsupported WMTS tile encoding".into()),
        };
        Ok(RasterTile {
            request,
            data_url: format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ),
            cache_hit: hit,
        })
    }
}
