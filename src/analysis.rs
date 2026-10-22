use crate::{model::Event, timestamps::seconds_between};
use geographiclib_rs::{Geodesic, InverseGeodesic};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum Pattern {
    Proximity,
    Stationary,
    Gaps,
    Speed,
    Clusters,
}
impl Pattern {
    pub fn title(self) -> &'static str {
        match self {
            Self::Proximity => "Proximity",
            Self::Stationary => "Stationary periods",
            Self::Gaps => "Event gaps",
            Self::Speed => "Speed outliers",
            Self::Clusters => "Space-time clusters",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Parameters {
    pub radius_m: f64,
    pub tolerance_s: f64,
    pub duration_s: f64,
    pub gap_s: f64,
    pub speed_kmh: f64,
    pub min_cluster: usize,
}
impl Default for Parameters {
    fn default() -> Self {
        Self {
            radius_m: 150.,
            tolerance_s: 300.,
            duration_s: 900.,
            gap_s: 1800.,
            speed_kmh: 80.,
            min_cluster: 3,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Finding {
    pub ids: Vec<u64>,
    pub summary: String,
    pub metric: String,
}
#[derive(Default, Debug, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub findings: Vec<Finding>,
    pub limited: bool,
    pub candidate_visits: u64,
}
/// Shortest surface distance on the WGS84 ellipsoid, including antipodes.
pub fn geodesic_distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    static GEODESIC: std::sync::OnceLock<Geodesic> = std::sync::OnceLock::new();
    GEODESIC
        .get_or_init(Geodesic::wgs84)
        .inverse(a.0, a.1, b.0, b.1)
}
/// Compatibility alias; distance calculations now use WGS84 geodesics.
pub fn haversine(a: (f64, f64), b: (f64, f64)) -> f64 {
    geodesic_distance(a, b)
}
fn duration_label(seconds: f64) -> String {
    if seconds.abs() >= 60. {
        format!("{:.1} minutes", seconds / 60.)
    } else {
        format!("{seconds} seconds")
    }
}
pub fn run(events: &[Event], kind: Pattern, p: &Parameters) -> AnalysisResult {
    let mut result = AnalysisResult::default();
    macro_rules! cancelled {
        () => {
            if crate::operation::cancelled() {
                result.limited = true;
                return result;
            }
        };
    }
    let mut order: Vec<_> = events.iter().collect();
    order.sort_by(|a, b| a.time.total_cmp(&b.time).then(a.id.cmp(&b.id)));
    let mut tracks: BTreeMap<&str, Vec<&Event>> = BTreeMap::new();
    if matches!(kind, Pattern::Gaps | Pattern::Speed | Pattern::Stationary) {
        for e in &order {
            tracks.entry(&e.entity).or_default().push(e);
        }
    }
    // A proximity finding needs two distinct entities. This common dense
    // single-track case has an exact empty result without scanning its pairs.
    if kind == Pattern::Proximity
        && order
            .first()
            .is_none_or(|first| order.iter().all(|e| e.entity == first.entity))
    {
        return result;
    }
    match kind {
        Pattern::Proximity | Pattern::Clusters => {
            let mut parents: Vec<_> = if kind == Pattern::Clusters {
                (0..order.len()).collect()
            } else {
                Vec::new()
            };

            // Spatial buckets in Earth-centered Cartesian coordinates avoid dateline
            // and polar discontinuities. Use the actual WGS84 ellipsoid: its
            // straight chord is <= the ellipsoidal surface geodesic, so adjacent
            // buckets cannot discard a pair inside the distance threshold.
            type Cell = (i64, i64, i64);
            let cell_size = p.radius_m.max(1.);
            let mut cells: BTreeMap<Cell, VecDeque<usize>> = BTreeMap::new();
            let mut active: VecDeque<(f64, Cell)> = VecDeque::new();
            'outer: for i in 0..order.len() {
                cancelled!();
                while active
                    .front()
                    .is_some_and(|(time, _)| seconds_between(order[i].time, *time) > p.tolerance_s)
                {
                    let (_, cell) = active.pop_front().unwrap();
                    if let Some(bucket) = cells.get_mut(&cell) {
                        bucket.pop_front();
                        if bucket.is_empty() {
                            cells.remove(&cell);
                        }
                    }
                }
                let Some(a) = order[i].location() else {
                    continue;
                };
                let (lat, lon) = (a.0.to_radians(), a.1.to_radians());
                let e2 = 6.6943799901413165e-3;
                let n = 6_378_137. / (1. - e2 * lat.sin().powi(2)).sqrt();
                let xyz = [
                    n * lat.cos() * lon.cos(),
                    n * lat.cos() * lon.sin(),
                    n * (1. - e2) * lat.sin(),
                ];
                let cell = (
                    (xyz[0] / cell_size).floor() as i64,
                    (xyz[1] / cell_size).floor() as i64,
                    (xyz[2] / cell_size).floor() as i64,
                );
                for dx in -1..=1 {
                    for dy in -1..=1 {
                        for dz in -1..=1 {
                            if let Some(bucket) =
                                cells.get(&(cell.0 + dx, cell.1 + dy, cell.2 + dz))
                            {
                                for &j in bucket {
                                    if result.candidate_visits % 1024 == 0 {
                                        cancelled!();
                                    }
                                    result.candidate_visits += 1;
                                    if result.candidate_visits > 5_000_000 {
                                        result.limited = true;
                                        break 'outer;
                                    }
                                    if kind == Pattern::Proximity
                                        && order[i].entity == order[j].entity
                                    {
                                        continue;
                                    }
                                    let d = haversine(a, order[j].location().unwrap());
                                    if d <= p.radius_m {
                                        if kind == Pattern::Proximity {
                                            result.findings.push(Finding {
                                                ids: vec![order[j].id, order[i].id],
                                                summary: format!(
                                                    "{} / {}",
                                                    order[j].entity, order[i].entity
                                                ),
                                                metric: format!(
                                                    "{d:.0} m · {} s apart",
                                                    seconds_between(order[i].time, order[j].time)
                                                ),
                                            });
                                            if result.findings.len() >= 10_000 {
                                                result.limited = true;
                                                break 'outer;
                                            }
                                        } else {
                                            let a = root(&mut parents, i);
                                            let b = root(&mut parents, j);
                                            parents[b] = a;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                cells.entry(cell).or_default().push_back(i);
                active.push_back((order[i].time, cell));
            }
            if kind == Pattern::Clusters {
                let mut groups: BTreeMap<usize, Vec<u64>> = BTreeMap::new();
                for (i, e) in order.iter().enumerate() {
                    if e.location().is_some() {
                        groups.entry(root(&mut parents, i)).or_default().push(e.id);
                    }
                }
                for ids in groups.into_values().filter(|g| g.len() >= p.min_cluster) {
                    result.findings.push(Finding {
                        summary: format!("Cluster of {} events", ids.len()),
                        metric: "Single-link space-time component".into(),
                        ids,
                    });
                }
            }
        }
        Pattern::Gaps | Pattern::Speed => {
            'tracks: for (entity, track) in tracks {
                cancelled!();
                cancelled!();
                for pair in track.windows(2) {
                    let (a, b) = (pair[0], pair[1]);
                    let dt = seconds_between(b.time, a.time);
                    let gap = seconds_between(b.time, a.end.unwrap_or(a.time));
                    let metric = if kind == Pattern::Gaps && gap >= p.gap_s {
                        Some(format!("{} without events", duration_label(gap)))
                    } else if kind == Pattern::Speed && dt > 0. {
                        a.location().zip(b.location()).and_then(|(a, b)| {
                            let speed = haversine(a, b) / dt * 3.6;
                            (speed >= p.speed_kmh)
                                .then(|| format!("{speed:.1} km/h between events"))
                        })
                    } else {
                        None
                    };
                    if let Some(metric) = metric {
                        result.findings.push(Finding {
                            ids: vec![a.id, b.id],
                            summary: entity.into(),
                            metric,
                        });
                    }
                    if result.findings.len() >= 10_000 {
                        result.limited = true;
                        break 'tracks;
                    }
                }
            }
        }
        Pattern::Stationary => {
            for (entity, track) in tracks {
                cancelled!();
                let mut start = 0;
                while start < track.len() {
                    let Some(anchor) = track[start].location() else {
                        start += 1;
                        continue;
                    };
                    let mut end = start + 1;
                    while end < track.len()
                        && seconds_between(
                            track[end].time,
                            track[end - 1].end.unwrap_or(track[end - 1].time),
                        ) <= p.gap_s
                        && track[end]
                            .location()
                            .is_some_and(|b| haversine(anchor, b) <= p.radius_m)
                    {
                        if end % 1024 == 0 {
                            cancelled!();
                        }
                        end += 1;
                    }
                    let elapsed = seconds_between(
                        track[end - 1].end.unwrap_or(track[end - 1].time),
                        track[start].time,
                    );
                    if end - start >= 2 && elapsed >= p.duration_s {
                        result.findings.push(Finding {
                            ids: track[start..end].iter().map(|e| e.id).collect(),
                            summary: entity.into(),
                            metric: format!(
                                "{} · {} events within {:.0} m of anchor",
                                duration_label(elapsed),
                                end - start,
                                p.radius_m
                            ),
                        });
                    }
                    start = end;
                    if result.findings.len() >= 10_000 {
                        result.limited = true;
                        return result;
                    }
                }
            }
        }
    }
    result
}
fn root(parents: &mut [usize], mut i: usize) -> usize {
    while parents[i] != i {
        parents[i] = parents[parents[i]];
        i = parents[i];
    }
    i
}
pub fn expand_links(events: &[Event], seeds: &BTreeSet<String>, depth: usize) -> BTreeSet<u64> {
    let mut nodes = seeds.clone();
    for _ in 0..depth.min(20) {
        let previous = nodes.clone();
        for e in events {
            if !e.related_to.is_empty()
                && (previous.contains(&e.entity) || previous.contains(&e.related_to))
            {
                nodes.insert(e.entity.clone());
                nodes.insert(e.related_to.clone());
            }
        }
        if previous == nodes {
            break;
        }
    }
    events
        .iter()
        .filter(|e| {
            nodes.contains(&e.entity) || (!e.related_to.is_empty() && nodes.contains(&e.related_to))
        })
        .map(|e| e.id)
        .collect()
}
pub fn connecting_path(events: &[Event], from: &str, to: &str) -> BTreeSet<u64> {
    let mut graph: BTreeMap<&str, Vec<(&str, u64)>> = BTreeMap::new();
    for e in events.iter().filter(|e| !e.related_to.is_empty()) {
        graph
            .entry(&e.entity)
            .or_default()
            .push((&e.related_to, e.id));
        graph
            .entry(&e.related_to)
            .or_default()
            .push((&e.entity, e.id));
    }
    let mut queue = VecDeque::from([from]);
    let mut prev: BTreeMap<&str, (&str, u64)> = BTreeMap::new();
    let mut seen = BTreeSet::from([from]);
    while let Some(node) = queue.pop_front() {
        if node == to {
            break;
        }
        for (next, id) in graph.get(node).into_iter().flatten() {
            if seen.insert(next) {
                prev.insert(next, (node, *id));
                queue.push_back(next);
            }
        }
    }
    let mut ids = BTreeSet::new();
    let mut node = to;
    while node != from {
        let Some((parent, id)) = prev.get(node) else {
            return BTreeSet::new();
        };
        ids.insert(*id);
        node = parent;
    }
    ids
}
#[derive(Default, Debug)]
pub struct Statistics {
    pub count: usize,
    pub sum: f64,
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub median: f64,
    pub std_dev: f64,
}
pub fn statistics(events: impl Iterator<Item = f64>) -> Statistics {
    use accurate::{sum::Neumaier, traits::SumWithAccumulator};
    let mut v: Vec<_> = events.filter(|v| v.is_finite()).collect();
    if v.is_empty() {
        return Statistics::default();
    }
    v.sort_by(f64::total_cmp);
    let count = v.len();
    let sum = v.iter().copied().sum_with_accumulator::<Neumaier<f64>>();
    let variance: average::Variance = v.iter().copied().collect();
    let mean = sum / count as f64;
    let median = if count % 2 == 0 {
        (v[count / 2 - 1] + v[count / 2]) / 2.
    } else {
        v[count / 2]
    };
    Statistics {
        count,
        sum,
        min: v[0],
        max: v[count - 1],
        mean,
        median,
        std_dev: variance.population_variance().sqrt(),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::demo;
    #[test]
    fn great_circle_handles_dateline() {
        assert!((geodesic_distance((0., 179.), (0., -179.)) - 222638.98158654713).abs() < 1e-6);
    }
    #[test]
    fn analysis_reports_known_cases() {
        let mut a = demo::dataset().events[0].clone();
        a.entity = "A".into();
        a.id = 1;
        a.time = 0.0;
        a.end = None;
        a.lat = Some(0.);
        a.lon = Some(0.);
        let mut b = a.clone();
        b.entity = "B".into();
        b.id = 2;
        b.time = 60.0;
        b.lon = Some(0.0001);
        assert_eq!(
            run(
                &[a.clone(), b.clone()],
                Pattern::Proximity,
                &Parameters::default()
            )
            .findings
            .len(),
            1
        );
        b.entity = "A".into();
        b.time = 3600.0;
        assert_eq!(
            run(
                &[a.clone(), b.clone()],
                Pattern::Gaps,
                &Parameters::default()
            )
            .findings
            .len(),
            1
        );
        b.lon = Some(2.);
        assert_eq!(
            run(&[a, b], Pattern::Speed, &Parameters::default())
                .findings
                .len(),
            1
        );
    }
    #[test]
    fn numeric_stats() {
        let s = statistics([1., 2., 3., 4.].into_iter());
        assert_eq!(s.median, 2.5);
        assert_eq!(s.sum, 10.);
    }
    #[test]
    fn chains_and_shortest_path() {
        let mut events = demo::dataset().events;
        events.truncate(2);
        events[0].entity = "A".into();
        events[0].related_to = "B".into();
        events[1].entity = "B".into();
        events[1].related_to = "C".into();
        assert_eq!(connecting_path(&events, "A", "C").len(), 2);
        assert!(connecting_path(&events, "A", "Z").is_empty());
        assert_eq!(
            expand_links(&events, &BTreeSet::from(["A".into()]), 1).len(),
            2
        );
    }
}
