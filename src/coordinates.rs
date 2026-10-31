//! WGS84 coordinate interchange. Canonical data stays in decimal degrees.
use mgrs_convert::{LatLon, Mgrs, Precision, UtmUps};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CoordinateSystem {
    #[default]
    Dd,
    Dms,
    Utm,
    Mgrs,
}
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "system", rename_all = "snake_case")]
pub enum Coordinate {
    Dd {
        latitude: f64,
        longitude: f64,
    },
    Dms {
        latitude: String,
        longitude: String,
    },
    Utm {
        zone: i32,
        hemisphere: String,
        easting: f64,
        northing: f64,
    },
    Mgrs {
        reference: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Converted {
    pub latitude: f64,
    pub longitude: f64,
    pub dms: Dms,
    /// Legacy grid field: zone 0 denotes UPS, explicitly identified below.
    pub utm: Coordinate,
    pub grid_system: String,
    pub grid_crs: String,
    pub mgrs: String,
    pub mgrs_precision: u8,
    pub mgrs_cell_size_m: Option<f64>,
}
/// Readable DMS coordinates, rounded to milliseconds of arc for display only.
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Dms {
    pub latitude: String,
    pub longitude: String,
}
pub fn format_dms(value: f64, latitude: bool) -> String {
    // Round before decomposing, carrying 60 seconds/minutes into the next unit.
    let ticks = (value.abs() * 3_600_000.).round() as u64;
    let degrees = ticks / 3_600_000;
    let minutes = ticks / 60_000 % 60;
    let seconds = (ticks % 60_000) as f64 / 1000.;
    let hemisphere = match (latitude, value < 0.) {
        (true, false) => 'N',
        (true, true) => 'S',
        (false, false) => 'E',
        (false, true) => 'W',
    };
    format!("{degrees}°{minutes:02}′{seconds:06.3}″{hemisphere}")
}
/// Accept symbols, colon separators, or three space-separated components.
/// Hemisphere letters may precede or follow the coordinate; signs must agree.
pub fn parse_dms(text: &str, latitude: bool) -> Result<f64, String> {
    static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pattern = PATTERN.get_or_init(|| regex::Regex::new(
        r#"^([NSEW])?\s*([+-]?\d{1,3})(?:\s*[°:]\s*|\s+)(\d{1,2})(?:\s*['′:]\s*|\s+)(\d{1,2}(?:\.\d+)?)\s*["″]?\s*([NSEW])?$"#
    ).unwrap());
    let text = text.trim().to_uppercase();
    let c = pattern
        .captures(&text)
        .ok_or("DMS requires degrees, minutes and seconds, for example 40°44′54.0″N")?;
    if c.get(1).is_some() && c.get(5).is_some() {
        return Err("Use one DMS hemisphere letter".into());
    }
    let direction = c.get(1).or_else(|| c.get(5)).map(|v| v.as_str());
    if direction.is_some_and(|h| {
        if latitude {
            !matches!(h, "N" | "S")
        } else {
            !matches!(h, "E" | "W")
        }
    }) {
        return Err("Coordinate hemisphere is on the wrong axis".into());
    }
    let degrees: f64 = c[2].parse().map_err(|_| "Invalid DMS degrees")?;
    let minutes: f64 = c[3].parse().map_err(|_| "Invalid DMS minutes")?;
    let seconds: f64 = c[4].parse().map_err(|_| "Invalid DMS seconds")?;
    if minutes >= 60. || !seconds.is_finite() || seconds >= 60. {
        return Err("DMS minutes and seconds must be less than 60".into());
    }
    let negative = direction.map_or(c[2].starts_with('-'), |h| matches!(h, "S" | "W"));
    if direction.is_some()
        && ((c[2].starts_with('-') && !negative) || (c[2].starts_with('+') && negative))
    {
        return Err("DMS sign conflicts with its hemisphere".into());
    }
    let value = degrees.abs() + minutes / 60. + seconds / 3600.;
    if value > if latitude { 90. } else { 180. } {
        return Err("DMS coordinate is out of range".into());
    }
    Ok(if negative { -value } else { value })
}
pub fn parse_dms_pair(text: &str) -> Result<(f64, f64), String> {
    let text = text
        .trim()
        .trim_matches(['(', ')', '[', ']'])
        .to_uppercase();
    let split = text
        .find([';', ','])
        .map(|i| (i, 1))
        .or_else(|| {
            text.char_indices()
                .find(|(i, c)| *i > 0 && matches!(c, 'N' | 'S'))
                .map(|(i, _)| (i + 1, 0))
        })
        .or_else(|| {
            text.char_indices()
                .find(|(i, c)| *i > 0 && matches!(c, 'E' | 'W'))
                .map(|(i, _)| (i, 0))
        });
    if let Some((i, skip)) = split {
        return Ok((
            parse_dms(&text[..i], true)?,
            parse_dms(&text[i + skip..], false)?,
        ));
    }
    let parts: Vec<_> = text.split_whitespace().collect();
    if parts.len() == 6 {
        return Ok((
            parse_dms(&parts[..3].join(" "), true)?,
            parse_dms(&parts[3..].join(" "), false)?,
        ));
    }
    Err("Combined DMS needs latitude, longitude; separate them with a comma or semicolon".into())
}
pub fn normalize_mgrs(reference: &str) -> String {
    reference
        .split_whitespace()
        .collect::<String>()
        .to_uppercase()
}
pub fn mgrs_precision(reference: &str) -> Result<u8, String> {
    let text = normalize_mgrs(reference);
    if text.len() > 32 || text.is_empty() || !text.is_ascii() {
        return Err("Invalid MGRS reference".into());
    }
    let grid = text.parse::<Mgrs>().map_err(|e| e.to_string())?;
    if !(0..=5).contains(&grid.precision().get()) {
        return Err(
            "MGRS needs a 100 km square and 0–10 grid digits in equal easting/northing halves"
                .into(),
        );
    }
    Ok(grid.precision().get())
}
pub fn format_mgrs(latitude: f64, longitude: f64, precision: u8) -> Result<String, String> {
    if precision > 5 {
        return Err("Invalid MGRS precision".into());
    }
    guarded(|| {
        Ok(wgs84(latitude, longitude)?
            .to_mgrs(Precision::new(precision).map_err(|e| e.to_string())?)
            .to_string())
    })
}
// Canonicalize the equivalent antimeridian endpoint and signed zero before
// entering the converter. The replaced geoconvert dependency had equatorial
// MGRS hemisphere/false-northing defects; keep the canonical convention explicit.
fn wgs84(latitude: f64, longitude: f64) -> Result<LatLon, String> {
    if !latitude.is_finite()
        || !longitude.is_finite()
        || !(-90. ..=90.).contains(&latitude)
        || !(-180. ..=180.).contains(&longitude)
    {
        return Err("WGS84 requires latitude -90–90 and longitude -180–180 degrees".into());
    }
    LatLon::new(
        if latitude == 0. { 0. } else { latitude },
        if longitude == 180. {
            -180.
        } else if longitude == 0. {
            0.
        } else {
            longitude
        },
    )
    .map_err(|e| e.to_string())
}
fn guarded<T>(
    run: impl FnOnce() -> Result<T, String> + std::panic::UnwindSafe,
) -> Result<T, String> {
    std::panic::catch_unwind(run)
        .map_err(|_| "Coordinate library could not represent this coordinate safely".to_string())?
}
pub fn convert(input: Coordinate) -> Result<Converted, String> {
    guarded(|| convert_checked(input))
}
fn convert_checked(input: Coordinate) -> Result<Converted, String> {
    let precision = if let Coordinate::Mgrs { reference } = &input {
        Some(mgrs_precision(reference)?)
    } else {
        None
    };
    let p = match input {
        Coordinate::Dd {
            latitude,
            longitude,
        } => wgs84(latitude, longitude)?,
        Coordinate::Dms {
            latitude,
            longitude,
        } => wgs84(parse_dms(&latitude, true)?, parse_dms(&longitude, false)?)?,
        Coordinate::Utm {
            zone,
            hemisphere,
            easting,
            northing,
        } => {
            if !(1..=60).contains(&zone)
                || !easting.is_finite()
                || !northing.is_finite()
                || !(100_000. ..=900_000.).contains(&easting)
                || !(0. ..=10_000_000.).contains(&northing)
            {
                return Err(
                    "UTM requires zone 1–60, easting 100000–900000 m and northing 0–10000000 m"
                        .into(),
                );
            }
            let north = match hemisphere.trim().to_uppercase().as_str() {
                "N" | "NORTH" => true,
                "S" | "SOUTH" => false,
                _ => return Err("UTM hemisphere must be N or S (not a latitude band)".into()),
            };
            let p = UtmUps::utm(zone as u8, north, easting, northing)
                .map_err(|e| e.to_string())?
                .to_latlon();
            // Inverse projection can land a few ULPs beyond an exact domain
            // edge (observed on Apple Silicon). Tolerate at most 1e-10 degree
            // (~11 micrometres), then snap only that numerical boundary excess.
            if !(-80. - 1e-10..=84. + 1e-10).contains(&p.lat()) {
                return Err("UTM is supported from 80°S to 84°N".into());
            }
            wgs84(p.lat().clamp(-80., 84.), p.lon())?
        }
        Coordinate::Mgrs { reference } => {
            let text = normalize_mgrs(&reference);
            if text.len() > 32 || text.is_empty() || !text.is_ascii() {
                return Err("Invalid MGRS reference".into());
            }
            text.parse::<Mgrs>().map_err(|e| e.to_string())?.to_latlon()
        }
    };
    let p = wgs84(p.lat(), p.lon())?;
    let utm = p.to_utmups();
    Ok(Converted {
        latitude: p.lat(),
        longitude: p.lon(),
        dms: Dms {
            latitude: format_dms(p.lat(), true),
            longitude: format_dms(p.lon(), false),
        },
        utm: Coordinate::Utm {
            zone: i32::from(utm.zone()),
            hemisphere: if utm.is_north() { "N" } else { "S" }.into(),
            easting: utm.easting(),
            northing: utm.northing(),
        },
        grid_system: if utm.zone() == 0 { "UPS" } else { "UTM" }.into(),
        grid_crs: format!(
            "EPSG:{}",
            if utm.zone() == 0 {
                if utm.is_north() {
                    32661
                } else {
                    32761
                }
            } else {
                (if utm.is_north() { 32600 } else { 32700 }) + u32::from(utm.zone())
            }
        ),
        mgrs: p
            .to_mgrs(Precision::new(precision.unwrap_or(5)).map_err(|e| e.to_string())?)
            .to_string(),
        mgrs_precision: precision.unwrap_or(5),
        mgrs_cell_size_m: precision.map(|p| 10f64.powi(5 - i32::from(p))),
    })
}
pub const EARTH_RADIUS: f64 = 6_378_137.;
pub fn mercator(lat: f64, lon: f64) -> [f64; 2] {
    [
        EARTH_RADIUS * lon.to_radians(),
        EARTH_RADIUS
            * (std::f64::consts::FRAC_PI_4
                + lat.clamp(-85.05112878, 85.05112878).to_radians() / 2.)
                .tan()
                .ln(),
    ]
}
pub fn inverse_mercator(x: f64, y: f64) -> (f64, f64) {
    (
        (2. * (y / EARTH_RADIUS).exp().atan() - std::f64::consts::FRAC_PI_2).to_degrees(),
        (x / EARTH_RADIUS).to_degrees(),
    )
}
/// Time interpolation on the shortest WGS84 geodesic. Display-only: never used
/// to fill missing source coordinates. Antipodal routes have no unique solution.
pub fn interpolate(a: (f64, f64), b: (f64, f64), fraction: f64) -> Option<(f64, f64)> {
    use geographiclib_rs::{DirectGeodesic, Geodesic, InverseGeodesic};
    if !(0.0..=1.0).contains(&fraction) {
        return None;
    }
    if (a.0 + b.0).abs() < 1e-10
        && (((a.1 - b.1).abs() - 180.).abs() < 1e-10 || (a.0.abs() - 90.).abs() < 1e-10)
    {
        return None;
    }
    let geodesic = Geodesic::wgs84();
    let (distance, azimuth, _, _): (f64, f64, f64, f64) = geodesic.inverse(a.0, a.1, b.0, b.1);
    let (lat, lon): (f64, f64) = geodesic.direct(a.0, a.1, azimuth, distance * fraction);
    if lat.is_finite() && lon.is_finite() {
        Some((lat, lon))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn published_empire_state_reference() {
        let p = convert(Coordinate::Utm {
            zone: 18,
            hemisphere: "N".into(),
            easting: 585664.121,
            northing: 4511315.422,
        })
        .unwrap();
        assert!((p.latitude - 40.748333).abs() < 1e-6);
        assert!((p.longitude + 73.985278).abs() < 1e-6);
        let q = convert(Coordinate::Mgrs { reference: p.mgrs }).unwrap();
        assert!((q.latitude - p.latitude).abs() < 0.00002);
    }
    #[test]
    fn south_roundtrip() {
        let a = convert(Coordinate::Dd {
            latitude: -33.8688,
            longitude: 151.2093,
        })
        .unwrap();
        let b = convert(a.utm).unwrap();
        assert!((a.latitude - b.latitude).abs() < 1e-7);
    }
    #[test]
    fn rejects_ambiguous_hemisphere() {
        assert!(convert(Coordinate::Utm {
            zone: 18,
            hemisphere: "T".into(),
            easting: 500000.,
            northing: 4000000.
        })
        .is_err());
    }
}
