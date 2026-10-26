//! Area-weighted surface centroid, not an observed position or an interior-point guarantee.
//! Integrate vector area on the WGS84 authalic sphere. WGS84 geodesic edges
//! are densified to <=25 km before mapping; holes subtract, multipart areas add.
use crate::geometry::Shape;
use geographiclib_rs::{DirectGeodesic, Geodesic, InverseGeodesic};
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
};
const E2: f64 = 0.006_694_379_990_141_316_5;
fn q(phi: f64) -> f64 {
    let e = E2.sqrt();
    let s = phi.sin();
    (1. - E2) * (s / (1. - E2 * s * s) - ((1. - e * s) / (1. + e * s)).ln() / (2. * e))
}
fn authalic(lat: f64) -> f64 {
    (q(lat.to_radians()) / q(std::f64::consts::FRAC_PI_2))
        .clamp(-1., 1.)
        .asin()
}
fn geodetic(beta: f64) -> f64 {
    let target = q(std::f64::consts::FRAC_PI_2) * beta.sin();
    let (mut lo, mut hi) = (-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2);
    for _ in 0..60 {
        let mid = (lo + hi) / 2.;
        if q(mid) < target {
            lo = mid
        } else {
            hi = mid
        }
    }
    ((lo + hi) / 2.).to_degrees()
}
fn vector([lon, lat]: [f64; 2]) -> [f64; 3] {
    let p = authalic(lat);
    let l = lon.to_radians();
    [p.cos() * l.cos(), p.cos() * l.sin(), p.sin()]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}
fn norm(v: [f64; 3]) -> f64 {
    dot(v, v).sqrt()
}
fn ring(points: &[[f64; 2]]) -> Option<[f64; 3]> {
    if points.len() < 4 {
        return None;
    }
    let geod = Geodesic::wgs84();
    let mut result = [0.; 3];
    let mut reference = [0.; 3];
    let mut segments = 0;
    for edge in points.windows(2) {
        let [a, b] = [edge[0], edge[1]];
        let (distance, azimuth, _, _): (f64, f64, f64, f64) = geod.inverse(a[1], a[0], b[1], b[0]);
        if !distance.is_finite() {
            return None;
        }
        let steps = (distance / 25000.).ceil().max(1.) as usize;
        segments += steps;
        if segments > 2_000_000 {
            return None;
        }
        let mut previous = vector(a);
        for step in 1..=steps {
            let current = if step == steps {
                vector(b)
            } else {
                let (lat, lon): (f64, f64) =
                    geod.direct(a[1], a[0], azimuth, distance * step as f64 / steps as f64);
                vector([lon, lat])
            };
            let c = cross(previous, current);
            let n = norm(c);
            if n > 1e-16 {
                let angle = n.atan2(dot(previous, current));
                for i in 0..3 {
                    result[i] += c[i] / n * angle * 0.5;
                }
            }
            for i in 0..3 {
                reference[i] += previous[i];
            }
            previous = current;
        }
    }
    let orientation = dot(result, reference);
    if norm(result) < 1e-16 || norm(reference) < 1e-8 || orientation.abs() < 1e-16 {
        return None;
    }
    if orientation < 0. {
        for v in &mut result {
            *v = -*v;
        }
    }
    Some(result)
}
type CentroidCache = VecDeque<(String, Option<[f64; 2]>)>;
static CENTROIDS: OnceLock<Mutex<CentroidCache>> = OnceLock::new();
pub fn centroid(shape: &Shape) -> Option<[f64; 2]> {
    if shape.polygons.is_empty() || !shape.lines.is_empty() || !shape.points.is_empty() {
        return None;
    }
    // Key by exact coordinate content, so modified shapes cannot reuse a stale
    // centroid. Do the expensive geodesic integration outside the mutex.
    let key = serde_json::to_string(&shape.polygons).ok()?;
    let cache = CENTROIDS.get_or_init(|| Mutex::new(VecDeque::new()));
    if let Ok(entries) = cache.lock() {
        if let Some((_, result)) = entries.iter().find(|(k, _)| k == &key) {
            return *result;
        }
    }
    let result = integrate(shape);
    if key.len() <= 4 * 1024 * 1024 {
        if let Ok(mut entries) = cache.lock() {
            while entries.len() >= 256
                || entries.iter().map(|(k, _)| k.len()).sum::<usize>() + key.len() > 4 * 1024 * 1024
            {
                entries.pop_front();
            }
            entries.push_back((key, result));
        }
    }
    result
}
fn integrate(shape: &Shape) -> Option<[f64; 2]> {
    let mut sum = [0.; 3];
    let mut contribution = 0.;
    for polygon in &shape.polygons {
        for (index, r) in polygon.iter().enumerate() {
            let moment = ring(r)?;
            contribution += norm(moment);
            let sign = if index == 0 { 1. } else { -1. };
            for i in 0..3 {
                sum[i] += sign * moment[i];
            }
        }
    }
    if norm(sum) <= contribution * 1e-10 || norm(sum) < 1e-16 {
        return None;
    }
    let lon = sum[1].atan2(sum[0]).to_degrees();
    let beta = sum[2].atan2(sum[0].hypot(sum[1]));
    let lat = geodetic(beta);
    (lon.is_finite() && lat.is_finite()).then_some([lon, lat])
}
#[cfg(test)]
mod tests {
    use super::*;
    fn c(wkt: &str) -> [f64; 2] {
        centroid(&crate::geometry::parse(wkt).unwrap()).unwrap()
    }
    #[test]
    fn equatorial_symmetry_and_reversal() {
        let a = c("POLYGON((-1 -1,1 -1,1 1,-1 1,-1 -1))");
        let b = c("POLYGON((-1 -1,-1 1,1 1,1 -1,-1 -1))");
        assert!(a[0].abs() < 1e-9 && a[1].abs() < 1e-9);
        assert!((a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9);
    }
    #[test]
    fn holes_subtract_and_multipart_area_weights() {
        let a = c("POLYGON((-4 -2,4 -2,4 2,-4 2,-4 -2),(1 -1,3 -1,3 1,1 1,1 -1))");
        assert!(a[0] < -0.2 && a[0] > -0.5 && a[1].abs() < 1e-9);
        let b = c("MULTIPOLYGON(((-4 -1,-2 -1,-2 1,-4 1,-4 -1)),((2 -1,4 -1,4 1,2 1,2 -1)))");
        assert!(b[0].abs() < 1e-9 && b[1].abs() < 1e-9);
    }
    #[test]
    fn exact_spherical_octant_and_pole() {
        let a = c("POLYGON((0 0,90 0,90 90,0 0))");
        assert!((a[0] - 45.).abs() < 1e-9);
        assert!(
            (authalic(a[1]).to_degrees() - (1f64 / 3f64.sqrt()).asin().to_degrees()).abs() < 1e-9
        );
        let p = c("POLYGON((-20 80,20 80,20 85,-20 85,-20 80))");
        assert!(p[0].abs() < 1e-8 && p[1] > 82. && p[1] < 84.);
    }
    #[test]
    fn split_date_line_uses_short_side() {
        let p=c("MULTIPOLYGON(((178 -1,180 -1,180 1,178 1,178 -1)),((-180 -1,-178 -1,-178 1,-180 1,-180 -1)))");
        assert!((p[0].abs() - 180.).abs() < 1e-9 && p[1].abs() < 1e-9);
    }
    #[test]
    fn repeated_boundaries_and_mutated_copies_do_not_share_stale_centroids() {
        let text = "POLYGON((-1 -1,1 -1,1 1,-1 1,-1 -1))";
        let original = c(text);
        let mut moved = crate::geometry::parse(text).unwrap();
        for polygon in &mut moved.polygons {
            for ring in polygon {
                for coordinate in ring {
                    coordinate[0] += 10.;
                }
            }
        }
        let next = centroid(&moved).unwrap();
        assert!((next[0] - 10.).abs() < 1e-8);
        assert_eq!(original, c(text));
        assert!(crate::geometry::parse("POLYGON((0 0,2 2,0 2,2 0,0 0))").is_err());
    }
    #[test]
    fn lines_have_no_polygon_centroid() {
        assert!(centroid(&crate::geometry::parse("LINESTRING(1 2,3 4)").unwrap()).is_none());
    }
}
