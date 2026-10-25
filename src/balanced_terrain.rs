//! Independently compressed, bounded blocks of the bundled 1-minute DEM.
//! The archive remains compressed on disk; only a small LRU is decoded in RAM.
use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    sync::OnceLock,
};

pub const NAME: &str = "Balanced world terrain";
pub const CREDIT: &str = "USGS/NGA GMTED2010 · Natural Earth land mask · public domain";
static RESOURCE: OnceLock<PathBuf> = OnceLock::new();

/// Desktop supplies Tauri's resource location; CLI/development also discover it
/// beside the executable or in the reviewed source checkout.
pub fn set_resource_path(path: PathBuf) {
    let _ = RESOURCE.set(path);
}
pub fn resource_path() -> Result<PathBuf, String> {
    let mut paths = Vec::new();
    if let Some(p) = RESOURCE.get() {
        paths.push(p.clone());
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("terrain/balanced.cterrain"));
            paths.push(dir.join("../Resources/terrain/balanced.cterrain"));
            paths.push(dir.join("../lib/Chronoscope/terrain/balanced.cterrain"));
            paths.push(dir.join("../lib/chronoscope/terrain/balanced.cterrain"));
            paths.push(dir.join("../lib/org.chronoscope.desktop/terrain/balanced.cterrain"));
        }
    }
    if cfg!(debug_assertions) {
        paths.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets/terrain/balanced.cterrain"),
        );
    }
    paths.into_iter().find(|p| p.is_file()).ok_or_else(|| {
        "Bundled Balanced terrain is missing; reinstall the application to restore it".into()
    })
}

#[derive(Deserialize)]
struct Level {
    width: usize,
    height: usize,
    tiles: Vec<[usize; 2]>,
}
#[derive(Deserialize)]
struct Manifest {
    format: u32,
    datum: String,
    spacing_arc_seconds: u32,
    tile_size: usize,
    width: usize,
    height: usize,
    levels: Vec<Level>,
}
type Key = (usize, usize, usize);
pub struct BalancedTerrain {
    archive: zip::ZipArchive<File>,
    manifest: Manifest,
    present: BTreeSet<Key>,
    cache: BTreeMap<Key, Vec<i16>>,
    lru: VecDeque<Key>,
    pub decoded: u64,
}
impl BalancedTerrain {
    pub fn open(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() > 256 * 1024 * 1024 {
            return Err("Balanced terrain archive exceeds its size limit".into());
        }
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        archive
            .by_name("manifest.json")
            .map_err(|e| e.to_string())?
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 1024 * 1024 {
            return Err("Balanced terrain manifest is too large".into());
        }
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if manifest.format != 1
            || manifest.datum != "egm96"
            || manifest.spacing_arc_seconds != 60
            || manifest.tile_size != 256
            || manifest.width != 21600
            || manifest.height != 10800
            || manifest.levels.len() != 8
        {
            return Err("Invalid Balanced terrain format or registration".into());
        }
        let mut present = BTreeSet::new();
        let mut expected = BTreeSet::from(["manifest.json".to_string()]);
        let (mut width, mut height) = (21600usize, 10800usize);
        for (level, info) in manifest.levels.iter().enumerate() {
            if info.width != width || info.height != height {
                return Err("Invalid Balanced overview dimensions".into());
            }
            for &[x, y] in &info.tiles {
                if x >= width.div_ceil(256)
                    || y >= height.div_ceil(256)
                    || !present.insert((level, x, y))
                {
                    return Err("Invalid or repeated Balanced block".into());
                }
                let name = format!("{level}/{y}/{x}.bin");
                let entry = archive.by_name(&name).map_err(|e| e.to_string())?;
                let size = (width - x * 256).min(256) * (height - y * 256).min(256) * 2;
                if entry.size() != size as u64 {
                    return Err("Invalid Balanced block size".into());
                }
                expected.insert(name);
            }
            width = width.div_ceil(2);
            height = height.div_ceil(2);
        }
        if archive.len() != expected.len()
            || archive.file_names().any(|name| match name {
                Ok(name) => !expected.contains(name.as_ref()),
                Err(_) => true,
            })
        {
            return Err("Unexpected Balanced archive entries".into());
        }
        Ok(Self {
            archive,
            manifest,
            present,
            cache: BTreeMap::new(),
            lru: VecDeque::new(),
            decoded: 0,
        })
    }
    pub fn tile_count(&self) -> usize {
        self.present.len()
    }
    fn post(&mut self, level: usize, x: usize, y: usize) -> Result<i16, String> {
        let key = (level, x / 256, y / 256);
        if !self.present.contains(&key) {
            return Ok(0);
        }
        let info = &self.manifest.levels[level];
        let width = (info.width - key.1 * 256).min(256);
        if !self.cache.contains_key(&key) {
            crate::operation::check()?;
            let expected = width * (info.height - key.2 * 256).min(256) * 2;
            let mut bytes = Vec::new();
            self.archive
                .by_name(&format!("{level}/{}/{}.bin", key.2, key.1))
                .map_err(|e| e.to_string())?
                .take(expected as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() != expected {
                return Err("Truncated Balanced terrain block".into());
            }
            let mut data: Vec<i16> = bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| i16::from_le_bytes(*b))
                .collect();
            for row in data.chunks_exact_mut(width) {
                for i in 1..row.len() {
                    row[i] = row[i].wrapping_add(row[i - 1]);
                }
            }
            while self.cache.len() >= 16 {
                if let Some(old) = self.lru.pop_front() {
                    self.cache.remove(&old);
                }
            }
            self.cache.insert(key, data);
            self.decoded += 1;
        }
        self.lru.retain(|k| *k != key);
        self.lru.push_back(key);
        Ok(self.cache[&key][(y % 256) * width + x % 256])
    }
    pub fn sample(&mut self, lat: f64, lon: f64, level: usize) -> Result<Option<f32>, String> {
        if !lat.is_finite() || !lon.is_finite() || lat.abs() > 90. || lon.abs() > 180. {
            return Err("Invalid terrain coordinates".into());
        }
        let level = level.min(self.manifest.levels.len() - 1);
        let info = &self.manifest.levels[level];
        let scale = (1usize << level) as f64;
        let period = 21600. / scale;
        let snap = |v: f64| {
            if (v - v.round()).abs() < 1e-9 {
                v.round()
            } else {
                v
            }
        };
        // An exact first post can round to period after rem_euclid (the
        // geographic-to-grid arithmetic may be a tiny negative number).
        // Wrap again after snapping so it cannot index past the final row.
        let x = snap((((lon + 180.) * 60. - 0.5) / scale).rem_euclid(period)).rem_euclid(period);
        let y = snap((((lat + 90.) * 60. - 0.5) / scale).clamp(0., (info.height - 1) as f64));
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (x1, y1) = ((x0 + 1) % info.width, (y0 + 1).min(info.height - 1));
        let dx = if x0 == info.width - 1 {
            (x - x0 as f64) / (period - x0 as f64)
        } else {
            x - x0 as f64
        };
        let dy = y - y0 as f64;
        let mut value = 0.;
        for (x, y, weight) in [
            (x0, y0, (1. - dx) * (1. - dy)),
            (x1, y0, dx * (1. - dy)),
            (x0, y1, (1. - dx) * dy),
            (x1, y1, dx * dy),
        ] {
            if weight == 0. {
                continue;
            }
            let height = self.post(level, x, y)?;
            if height == -32767 {
                return Ok(None);
            }
            value += height as f64 * weight;
        }
        Ok(Some(value as f32))
    }
    /// Visit a block's samples together so a thin, wide viewport cannot churn
    /// the decoded LRU once per mesh row. Neighbor interpolation needs at most
    /// four blocks while a primary block is being sampled.
    pub fn sample_many(
        &mut self,
        positions: &[(f64, f64)],
        level: usize,
    ) -> Result<Vec<Option<f32>>, String> {
        let level = level.min(self.manifest.levels.len() - 1);
        let scale = (1usize << level) as f64;
        let info = &self.manifest.levels[level];
        let mut order: Vec<_> = positions
            .iter()
            .enumerate()
            .map(|(index, &(lat, lon))| {
                let x = (((lon + 180.) * 60. - 0.5) / scale).rem_euclid(21600. / scale);
                let y = (((lat + 90.) * 60. - 0.5) / scale).clamp(0., (info.height - 1) as f64);
                (y as usize / 256, x as usize / 256, index)
            })
            .collect();
        order.sort_unstable();
        let mut result = vec![None; positions.len()];
        for (number, (_, _, index)) in order.into_iter().enumerate() {
            if number % 256 == 0 {
                crate::operation::check()?;
            }
            result[index] = self.sample(positions[index].0, positions[index].1, level)?;
        }
        Ok(result)
    }
}
