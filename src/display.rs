//! Reversible, exact-count display grids. They never replace source events.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct DisplayOptions {
    pub mode: String,
    pub cluster_pixels: f64,
    pub time_bin_minutes: i64,
    pub partition: String,
    pub spatial_culling: bool,
    pub show_points: bool,
    pub show_centroids: bool,
    pub point_scale: f64,
    pub track_opacity: f64,
    pub trail_opacity: f64,
    pub show_tracks: bool,
    pub show_trails: bool,
    pub trail_pixels: f64,
    pub trail_gap_minutes: i64,
    pub heat_radius: f64,
    pub heat_weight: String,
    pub heat_max: Option<f64>,
    pub heat_reference_zoom: Option<f64>,
    pub bloom: bool,
    pub bloom_strength: f64,
    pub bloom_radius: f64,
    pub bloom_threshold: f64,
}
impl Default for DisplayOptions {
    fn default() -> Self {
        Self {
            mode: "auto".into(),
            cluster_pixels: 48.,
            time_bin_minutes: 0,
            partition: "all".into(),
            spatial_culling: true,
            show_points: true,
            show_centroids: true,
            point_scale: 1.,
            track_opacity: 0.25,
            trail_opacity: 0.25,
            show_tracks: true,
            show_trails: true,
            trail_pixels: 2.,
            trail_gap_minutes: 180,
            heat_radius: 32.,
            heat_weight: "count".into(),
            heat_max: None,
            heat_reference_zoom: None,
            bloom: false,
            bloom_strength: 1.3,
            bloom_radius: 0.1,
            bloom_threshold: 0.1,
        }
    }
}
impl DisplayOptions {
    pub fn validate(&self) -> Result<(), String> {
        if !["auto", "points", "clusters", "density", "heatmap"].contains(&self.mode.as_str())
            || !["all", "entity", "source"].contains(&self.partition.as_str())
            || !["count", "value"].contains(&self.heat_weight.as_str())
            || !self.point_scale.is_finite()
            || !(0.4..=3.).contains(&self.point_scale)
            || !self.track_opacity.is_finite()
            || !(0. ..=1.).contains(&self.track_opacity)
            || !self.trail_opacity.is_finite()
            || !(0. ..=1.).contains(&self.trail_opacity)
            || !(8. ..=128.).contains(&self.cluster_pixels)
            || !self.cluster_pixels.is_finite()
            || !(0..=5_259_600_000).contains(&self.time_bin_minutes)
            || !(0. ..=20.).contains(&self.trail_pixels)
            || !self.trail_pixels.is_finite()
            || !(0..=5_259_600_000).contains(&self.trail_gap_minutes)
            || !(4. ..=128.).contains(&self.heat_radius)
            || !self.heat_radius.is_finite()
            || self.heat_max.is_some_and(|x| !x.is_finite() || x <= 0.)
            || self
                .heat_reference_zoom
                .is_some_and(|x| !x.is_finite() || !(0. ..=24.).contains(&x))
            || !self.bloom_strength.is_finite()
            || !(0. ..=3.).contains(&self.bloom_strength)
            || !self.bloom_radius.is_finite()
            || !(0. ..=1.).contains(&self.bloom_radius)
            || !self.bloom_threshold.is_finite()
            || !(0. ..=1.).contains(&self.bloom_threshold)
        {
            return Err("INVALID_ARGUMENT: invalid display mode, grid, time, trail, heat-map or bloom settings".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Cell {
    pub level: u8,
    pub x: u32,
    pub y: u32,
    pub slab: i64,
    pub time_bin_minutes: i64,
    pub partition: String,
    pub key: String,
    pub viewport: Option<[f64; 4]>,
}
impl Cell {
    pub fn validate(&self) -> Result<(), String> {
        if let Some([w, s, e, n]) = self.viewport {
            if [w, s, e, n].iter().any(|x| !x.is_finite())
                || w.abs() > 180.
                || e.abs() > 180.
                || s < -90.
                || n > 90.
                || s >= n
                || w == e
            {
                return Err("Invalid display viewport".into());
            }
        }
        if self.time_bin_minutes == 0 && self.slab != 0 {
            return Err("Invalid display time slab".into());
        }
        if self.level > 24
            || self.x >= 1u32 << self.level
            || self.y >= 1u32 << self.level
            || !(0..=5_259_600_000).contains(&self.time_bin_minutes)
            || !["all", "entity", "source"].contains(&self.partition.as_str())
            || self.key.len() > 8192
            || self
                .slab
                .checked_mul(self.time_bin_minutes.max(1))
                .and_then(|x| x.checked_mul(60))
                .is_none()
        {
            return Err("INVALID_ARGUMENT: invalid display cell".into());
        }
        Ok(())
    }
    pub fn bounds(&self) -> [f64; 4] {
        let n = (1u32 << self.level) as f64;
        let latitude = |v: f64| {
            (std::f64::consts::PI * (1. - 2. * v / n))
                .sinh()
                .atan()
                .to_degrees()
        };
        [
            self.x as f64 / n * 360. - 180.,
            if self.y + 1 == 1u32 << self.level {
                -90.
            } else {
                latitude((self.y + 1) as f64)
            },
            (self.x + 1) as f64 / n * 360. - 180.,
            if self.y == 0 {
                90.
            } else {
                latitude(self.y as f64)
            },
        ]
    }
}
pub fn tile_x(lon: f64, level: u8) -> u32 {
    let n = 1u32 << level;
    ((((lon + 180.).rem_euclid(360.) / 360.) * n as f64).floor() as u32).min(n - 1)
}
pub fn tile_y(lat: f64, level: u8) -> u32 {
    let n = 1u32 << level;
    let a = lat.clamp(-85.0511287798066, 85.0511287798066).to_radians();
    (((1. - a.tan().asinh() / std::f64::consts::PI) * 0.5 * n as f64).floor() as u32).min(n - 1)
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
pub struct Bin {
    pub cell: Cell,
    pub count: usize,
    pub selected_count: usize,
    pub weight: f64,
    pub first_time: f64,
    pub last_time: f64,
    pub sample_id: String,
    pub longitude: f64,
    pub latitude: f64,
    pub bounds: [f64; 4],
    #[serde(alias = "observation_bounds")]
    pub event_bounds: [f64; 4],
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
pub struct Packet {
    pub bins: Vec<Bin>,
    pub count: usize,
    pub aggregated: bool,
    pub level: u8,
    pub time_bin_minutes: i64,
    pub cache_hit: bool,
    pub bounds: Option<[f64; 4]>,
    pub revision: u64,
    pub semantics: String,
}

/// Validated grid resolution and presentation choices for one store query.
pub struct GridRequest<'a> {
    pub level: u8,
    pub minutes: i64,
    pub partition: &'a str,
    pub weight: &'a str,
    pub limit: usize,
}
