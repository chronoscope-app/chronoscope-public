//! DTED Level 0/1/2, read in Rust without a native GDAL dependency.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, VecDeque},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Arc,
};
const HEADER: usize = 3428;
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
pub struct TerrainTile {
    pub path: PathBuf,
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
    pub width: usize,
    pub height: usize,
    pub longitude_step: f64,
    pub latitude_step: f64,
    pub datum: String,
    pub vertical_datum: String,
}
fn number(bytes: &[u8]) -> Result<usize, String> {
    std::str::from_utf8(bytes)
        .map_err(|_| "Invalid DTED ASCII")?
        .trim()
        .parse()
        .map_err(|_| "Invalid DTED numeric header".into())
}
fn origin(bytes: &[u8]) -> Result<f64, String> {
    let degrees = number(&bytes[..3])?;
    let minutes = number(&bytes[3..5])?;
    let seconds = number(&bytes[5..7])?;
    if minutes >= 60 || seconds >= 60 {
        return Err("Invalid DTED origin".into());
    }
    let sign = match bytes[7] {
        b'W' | b'S' => -1.,
        b'E' | b'N' => 1.,
        _ => return Err("Invalid DTED hemisphere".into()),
    };
    Ok(sign * (degrees as f64 + minutes as f64 / 60. + seconds as f64 / 3600.))
}
pub fn inspect(path: &Path) -> Result<TerrainTile, String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut h = [0u8; HEADER];
    f.read_exact(&mut h)
        .map_err(|e| format!("Truncated DTED header: {e}"))?;
    if &h[..4] != b"UHL1" || &h[80..83] != b"DSI" || &h[728..731] != b"ACC" {
        return Err("Unsupported DTED: expected UHL1, DSI and ACC headers".into());
    }
    if !matches!(h[11], b'E' | b'W') || !matches!(h[19], b'N' | b'S') {
        return Err("DTED UHL must specify longitude E/W followed by latitude N/S".into());
    }
    let west = origin(&h[4..12])?;
    let south = origin(&h[12..20])?;
    let width = number(&h[47..51])?;
    let height = number(&h[51..55])?;
    let dx = number(&h[20..24])? as f64 / 36000.;
    let dy = number(&h[24..28])? as f64 / 36000.;
    if !(2..=3601).contains(&width)
        || !(2..=3601).contains(&height)
        || dx <= 0.
        || dy <= 0.
        || !(-180. ..=180.).contains(&west)
        || !(-90. ..=90.).contains(&south)
    {
        return Err("Invalid or unsupported DTED dimensions/origin".into());
    }
    let datum = String::from_utf8_lossy(&h[80 + 144..80 + 149])
        .trim()
        .to_string();
    if datum != "WGS84" {
        return Err(format!(
            "DTED datum {datum} is not WGS84; reproject before loading"
        ));
    }
    let vertical = String::from_utf8_lossy(&h[80 + 141..80 + 144])
        .trim()
        .to_string();
    if vertical != "MSL" {
        return Err(format!(
            "Unsupported DTED vertical datum {vertical:?}; expected MSL metres"
        ));
    }
    let east = west + (width - 1) as f64 * dx;
    let north = south + (height - 1) as f64 * dy;
    if east > 180.0001 || north > 90.0001 {
        return Err("DTED extents exceed WGS84 bounds".into());
    }
    let expected = (HEADER + width * (12 + height * 2)) as u64;
    if f.metadata().map_err(|e| e.to_string())?.len() != expected {
        return Err("Unsupported truncated/sparse DTED columns or trailing records".into());
    }
    Ok(TerrainTile {
        path: path.into(),
        west,
        south,
        east,
        north,
        width,
        height,
        longitude_step: dx,
        latitude_step: dy,
        datum: "WGS84".into(),
        vertical_datum: "DTED mean sea level (typically EGM96); no geoid conversion applied".into(),
    })
}
fn decode(tile: &TerrainTile) -> Result<Vec<i16>, String> {
    let mut file = File::open(&tile.path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(HEADER as u64))
        .map_err(|e| e.to_string())?;
    let size = 12 + tile.height * 2;
    let mut record = vec![0u8; size];
    let mut values = vec![-32767i16; tile.width * tile.height];
    for x in 0..tile.width {
        crate::operation::check()?;
        file.read_exact(&mut record).map_err(|e| e.to_string())?;
        let sequence =
            (usize::from(record[1]) << 16) | (usize::from(record[2]) << 8) | usize::from(record[3]);
        if record[0] != 0xaa
            || sequence != x
            || u16::from_be_bytes([record[4], record[5]]) as usize != x
            || u16::from_be_bytes([record[6], record[7]]) != 0
        {
            return Err("Unsupported DTED record ordering".into());
        }
        let crc = u32::from_be_bytes(record[size - 4..].try_into().unwrap());
        let sum = record[..size - 4]
            .iter()
            .map(|b| u32::from(*b))
            .sum::<u32>();
        if crc != sum {
            return Err(format!("DTED checksum failure in column {x}"));
        }
        for y in 0..tile.height {
            let raw = u16::from_be_bytes([record[8 + y * 2], record[9 + y * 2]]);
            let n = (raw & 0x7fff) as i32 * if raw & 0x8000 != 0 { -1 } else { 1 };
            if n != -32767 {
                values[y * tile.width + x] = n as i16;
            }
        }
    }
    Ok(values)
}
#[derive(Default)]
pub struct TerrainCatalog {
    pub tiles: Vec<TerrainTile>,
    index: BTreeMap<(i32, i32), Vec<usize>>,
    cache: BTreeMap<usize, Arc<Vec<i16>>>,
    lru: VecDeque<usize>,
    decoded_tiles: u64,
    mesh_cache_hits: u64,
    file_versions: Vec<(u64, Option<std::time::SystemTime>)>,
    meshes: VecDeque<([u64; 5], Arc<TerrainMesh>)>,
    balanced: Option<crate::balanced_terrain::BalancedTerrain>,
}
#[derive(Debug, Serialize, JsonSchema)]
pub struct TerrainMesh {
    pub bounds: [f64; 4],
    pub width: usize,
    pub height: usize,
    pub elevations: Vec<Option<f32>>,
    pub minimum: f32,
    pub maximum: f32,
    pub covered: usize,
    pub tiles: usize,
    pub decoded_tiles: u64,
    pub attribution: Option<String>,
    pub geographic: bool,
}
impl TerrainCatalog {
    pub fn from_preferences(
        preferences: &crate::engine::Preferences,
    ) -> Result<Option<Self>, String> {
        if preferences.terrain_builtin {
            Self::balanced().map(Some)
        } else {
            preferences
                .terrain_path
                .as_ref()
                .map(|p| Self::load(p))
                .transpose()
        }
    }
    pub fn balanced() -> Result<Self, String> {
        let path = crate::balanced_terrain::resource_path()?;
        let balanced = crate::balanced_terrain::BalancedTerrain::open(&path)?;
        let metadata = path.metadata().map_err(|e| e.to_string())?;
        Ok(Self {
            tiles: vec![TerrainTile {
                path,
                west: -180.,
                south: -90.,
                east: 180.,
                north: 90.,
                width: 21600,
                height: 10800,
                longitude_step: 1. / 60.,
                latitude_step: 1. / 60.,
                datum: "WGS84".into(),
                vertical_datum: "EGM96".into(),
            }],
            file_versions: vec![(metadata.len(), metadata.modified().ok())],
            balanced: Some(balanced),
            ..Self::default()
        })
    }
    pub fn is_balanced(&self) -> bool {
        self.balanced.is_some()
    }
    /// The app-owned default is referenced by identity, never copied into every
    /// portable workspace. User DTED continues to be embedded as before.
    pub fn resource_files(&self) -> Vec<PathBuf> {
        if self.is_balanced() {
            Vec::new()
        } else {
            self.tiles.iter().map(|t| t.path.clone()).collect()
        }
    }
    pub fn load(path: &Path) -> Result<Self, String> {
        fn scan(path: &Path, files: &mut Vec<PathBuf>, depth: usize) -> Result<(), String> {
            crate::operation::check()?;
            if depth > 16 {
                return Err("DTED folder nesting exceeds 16".into());
            }
            if path
                .symlink_metadata()
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
            {
                return Ok(());
            }
            if path.is_file() {
                if path.extension().is_some_and(|e| {
                    matches!(
                        e.to_string_lossy().to_lowercase().as_str(),
                        "dt0" | "dt1" | "dt2"
                    )
                }) {
                    files.push(path.into());
                }
            } else {
                for e in std::fs::read_dir(path).map_err(|e| e.to_string())? {
                    scan(&e.map_err(|e| e.to_string())?.path(), files, depth + 1)?;
                    if files.len() > 2048 {
                        return Err("DTED folder exceeds 2048 tiles".into());
                    }
                }
            }
            Ok(())
        }
        let mut files = Vec::new();
        scan(path, &mut files, 0)?;
        if files.is_empty() {
            return Err("No DTED .dt0/.dt1/.dt2 files found".into());
        }
        files.sort();
        let mut this = Self::default();
        for path in files {
            let meta = path.metadata().map_err(|e| e.to_string())?;
            this.file_versions.push((meta.len(), meta.modified().ok()));
            this.tiles.push(inspect(&path)?);
        }
        for (i, t) in this.tiles.iter().enumerate() {
            for lat in t.south.floor() as i32..=t.north.floor() as i32 {
                for lon in t.west.floor() as i32..=t.east.floor() as i32 {
                    this.index.entry((lat, lon)).or_default().push(i);
                }
            }
        }
        Ok(this)
    }
    pub fn bounds(&self) -> [f64; 4] {
        self.tiles.iter().fold([180., 90., -180., -90.], |b, t| {
            [
                b[0].min(t.west),
                b[1].min(t.south),
                b[2].max(t.east),
                b[3].max(t.north),
            ]
        })
    }
    fn check_file(&self, index: usize) -> Result<(), String> {
        let meta = self.tiles[index]
            .path
            .metadata()
            .map_err(|e| e.to_string())?;
        if self.file_versions.get(index) != Some(&(meta.len(), meta.modified().ok())) {
            return Err("Terrain files changed; reload the terrain catalog".into());
        }
        Ok(())
    }
    /// Diagnostic count of complete mesh reuses.
    pub fn mesh_cache_hits(&self) -> u64 {
        self.mesh_cache_hits
    }
    /// Exact-key memoization, at most two immutable meshes / 16 MiB estimated
    /// elevation storage. Sampling and resolution never change on a cache hit.
    pub fn mesh_cached(
        &mut self,
        bounds: [f64; 4],
        resolution: usize,
    ) -> Result<Arc<TerrainMesh>, String> {
        crate::operation::check()?;
        for index in 0..self.tiles.len() {
            self.check_file(index)?;
        }
        let key = [
            bounds[0].to_bits(),
            bounds[1].to_bits(),
            bounds[2].to_bits(),
            bounds[3].to_bits(),
            resolution.clamp(8, 257) as u64,
        ];
        if let Some(index) = self.meshes.iter().position(|(k, _)| *k == key) {
            self.mesh_cache_hits = self.mesh_cache_hits.saturating_add(1);
            let item = self.meshes.remove(index).unwrap();
            let mesh = item.1.clone();
            self.meshes.push_back(item);
            return Ok(mesh);
        }
        let mesh = Arc::new(self.mesh(bounds, resolution)?);
        let bytes = |m: &TerrainMesh| m.elevations.len() * std::mem::size_of::<Option<f32>>();
        while self.meshes.len() >= 2
            || self.meshes.iter().map(|(_, m)| bytes(m)).sum::<usize>() + bytes(&mesh)
                > 16 * 1024 * 1024
        {
            if self.meshes.pop_front().is_none() {
                break;
            }
        }
        if bytes(&mesh) <= 16 * 1024 * 1024 {
            self.meshes.push_back((key, mesh.clone()));
        }
        Ok(mesh)
    }
    pub fn sample(&mut self, mut lat: f64, mut lon: f64) -> Result<Option<f32>, String> {
        if self.balanced.is_some() {
            self.check_file(0)?;
        }
        if let Some(balanced) = self.balanced.as_mut() {
            return balanced.sample(lat, lon, 0);
        }
        if (lat - lat.round()).abs() < 1e-9 {
            lat = lat.round();
        }
        if (lon - lon.round()).abs() < 1e-9 {
            lon = lon.round();
        }
        let Some(i) = self.tile_index(lat, lon) else {
            return Ok(None);
        };
        self.check_file(i)?;
        self.sample_index(i, lat, lon)
    }
    fn tile_index(&self, mut lat: f64, mut lon: f64) -> Option<usize> {
        if (lat - lat.round()).abs() < 1e-9 {
            lat = lat.round();
        }
        if (lon - lon.round()).abs() < 1e-9 {
            lon = lon.round();
        }
        self.index
            .get(&(lat.floor() as i32, lon.floor() as i32))
            .and_then(|v| {
                v.iter()
                    .copied()
                    .filter(|&i| {
                        let t = &self.tiles[i];
                        lon >= t.west - 1e-9
                            && lon <= t.east + 1e-9
                            && lat >= t.south - 1e-9
                            && lat <= t.north + 1e-9
                    })
                    .min_by(|&a, &b| {
                        self.tiles[a]
                            .longitude_step
                            .total_cmp(&self.tiles[b].longitude_step)
                    })
            })
    }
    fn sample_index(&mut self, i: usize, lat: f64, lon: f64) -> Result<Option<f32>, String> {
        let tile = &self.tiles[i];
        if !self.cache.contains_key(&i) {
            let data = Arc::new(decode(tile)?);
            self.decoded_tiles += 1;
            while self.cache.len() >= 4 {
                if let Some(old) = self.lru.pop_front() {
                    self.cache.remove(&old);
                }
            }
            self.cache.insert(i, data);
        }
        self.lru.retain(|&v| v != i);
        self.lru.push_back(i);
        let values = &self.cache[&i];
        let snap = |v: f64| {
            if (v - v.round()).abs() < 1e-9 {
                v.round()
            } else {
                v
            }
        };
        let x = snap((lon - tile.west) / tile.longitude_step).clamp(0., (tile.width - 1) as f64);
        let y = snap((lat - tile.south) / tile.latitude_step).clamp(0., (tile.height - 1) as f64);
        let x0 = x.floor() as usize;
        let y0 = y.floor() as usize;
        let x1 = (x0 + 1).min(tile.width - 1);
        let y1 = (y0 + 1).min(tile.height - 1);
        let (dx, dy) = ((x - x0 as f64) as f32, (y - y0 as f64) as f32);
        let mut sum = 0.;
        let mut weight = 0.;
        for (x, y, w) in [
            (x0, y0, (1. - dx) * (1. - dy)),
            (x1, y0, dx * (1. - dy)),
            (x0, y1, (1. - dx) * dy),
            (x1, y1, dx * dy),
        ] {
            let v = values[y * tile.width + x];
            // Never manufacture terrain through a void by renormalising other
            // posts. Zero-weight corners do not affect an exact valid post.
            if w > 0. && v == -32767 {
                return Ok(None);
            }
            if v != -32767 {
                sum += v as f32 * w;
                weight += w;
            }
        }
        Ok((weight > 0.).then(|| sum / weight))
    }
    pub fn mesh(&mut self, bounds: [f64; 4], resolution: usize) -> Result<TerrainMesh, String> {
        let n = resolution.clamp(8, 257);
        let latitude_limit = if self.is_balanced() { 90. } else { 85.05112878 };
        if !bounds.iter().all(|n| n.is_finite())
            || bounds[0] >= bounds[2]
            || bounds[1] >= bounds[3]
            || bounds[0] < -180.
            || bounds[2] > 180.
            || bounds[1] < -latitude_limit
            || bounds[3] > latitude_limit
        {
            return Err(
                "Terrain mesh requires non-crossing WGS84 bounds within the source latitude range"
                    .into(),
            );
        }
        let sw = crate::coordinates::mercator(bounds[1], bounds[0]);
        let ne = crate::coordinates::mercator(bounds[3], bounds[2]);
        let mut elevations = vec![None; n * n];
        let (mut minimum, mut maximum) = (f32::MAX, f32::MIN);
        let mut covered = 0;
        let decoded_before = self.decoded_tiles;
        if let Some(balanced) = self.balanced.as_mut() {
            let lat_step = (bounds[3] - bounds[1]) / (n - 1) as f64;
            let spacing = ((bounds[2] - bounds[0]) / (n - 1) as f64).min(lat_step);
            let level = ((spacing * 60.).log2().floor().max(0.) as usize).min(7);
            let before = balanced.decoded;
            let mut positions = Vec::with_capacity(n * n);
            for row in 0..n {
                crate::operation::check()?;
                for col in 0..n {
                    let lat = bounds[3] - (bounds[3] - bounds[1]) * row as f64 / (n - 1) as f64;
                    let lon = bounds[0] + (bounds[2] - bounds[0]) * col as f64 / (n - 1) as f64;
                    positions.push((lat, lon));
                }
            }
            elevations = balanced.sample_many(&positions, level)?;
            for value in elevations.iter().flatten() {
                minimum = minimum.min(*value);
                maximum = maximum.max(*value);
                covered += 1;
            }
            if covered == 0 {
                return Err("No terrain coverage in this area".into());
            }
            return Ok(TerrainMesh {
                bounds,
                width: n,
                height: n,
                elevations,
                minimum,
                maximum,
                covered,
                tiles: balanced.tile_count(),
                decoded_tiles: balanced.decoded - before,
                attribution: Some(crate::balanced_terrain::CREDIT.into()),
                geographic: true,
            });
        }
        let mut batches: BTreeMap<usize, Vec<(usize, f64, f64)>> = BTreeMap::new();
        // Visit all samples for a tile together. A broad viewport must not
        // repeatedly decode >4 intersecting DTED tiles on every mesh row.
        for row in 0..n {
            crate::operation::check()?;
            for col in 0..n {
                let (lat, lon) = crate::coordinates::inverse_mercator(
                    sw[0] + (ne[0] - sw[0]) * col as f64 / (n - 1) as f64,
                    ne[1] - (ne[1] - sw[1]) * row as f64 / (n - 1) as f64,
                );
                if let Some(tile) = self.tile_index(lat, lon) {
                    batches
                        .entry(tile)
                        .or_default()
                        .push((row * n + col, lat, lon));
                }
            }
        }
        for samples in batches.values() {
            let first = samples[0];
            let tile = self
                .tile_index(first.1, first.2)
                .ok_or("Terrain coverage changed")?;
            for (index, lat, lon) in samples {
                if index % 256 == 0 {
                    crate::operation::check()?;
                }
                let value = self.sample_index(tile, *lat, *lon)?;
                if let Some(value) = value {
                    minimum = minimum.min(value);
                    maximum = maximum.max(value);
                    covered += 1;
                }
                elevations[*index] = value;
            }
        }
        if covered == 0 {
            return Err("No terrain coverage in this area".into());
        }
        Ok(TerrainMesh {
            bounds,
            width: n,
            height: n,
            elevations,
            minimum,
            maximum,
            covered,
            tiles: self.tiles.len(),
            decoded_tiles: self.decoded_tiles - decoded_before,
            attribution: None,
            geographic: false,
        })
    }
}
