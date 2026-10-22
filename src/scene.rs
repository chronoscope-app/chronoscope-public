use crate::{
    model::{Dataset, Event},
    project::Camera,
};
use eframe::egui::{self, Align2, Color32, FontId, Pos2, Rect, Sense, Stroke, Vec2};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const ACCENT: Color32 = Color32::from_rgb(95, 215, 190);
pub const MUTED: Color32 = Color32::from_rgb(137, 156, 177);
pub fn entity_color(name: &str) -> Color32 {
    let hash = name.bytes().fold(2_166_136_261u32, |h, c| {
        (h ^ u32::from(c)).wrapping_mul(16_777_619)
    });
    egui::ecolor::Hsva::new((hash % 360) as f32 / 360., 0.48, 0.95, 1.).into()
}
pub use crate::project::ViewMode;
#[derive(Clone, Copy, Debug)]
pub struct GeoFrame {
    pub lon_ref: f64,
    pub lat_center: f64,
    pub lon_center: f64,
    pub scale: f64,
    pub cos_lat: f64,
}
fn unwrap_lon(lon: f64, reference: f64) -> f64 {
    reference + (lon - reference + 180.).rem_euclid(360.) - 180.
}
impl GeoFrame {
    pub fn fit<'a>(events: impl Iterator<Item = &'a Event>) -> Self {
        let points: Vec<_> = events.filter_map(Event::location).collect();
        if points.is_empty() {
            return Self {
                lon_ref: 0.,
                lat_center: 0.,
                lon_center: 0.,
                scale: 100.,
                cos_lat: 1.,
            };
        }
        let lon_ref = points[0].1;
        let (mut min_lat, mut max_lat, mut min_lon, mut max_lon) =
            (90f64, -90f64, f64::MAX, f64::MIN);
        for (lat, lon) in points {
            min_lat = min_lat.min(lat);
            max_lat = max_lat.max(lat);
            let lon = unwrap_lon(lon, lon_ref);
            min_lon = min_lon.min(lon);
            max_lon = max_lon.max(lon);
        }
        let lat_center = (min_lat + max_lat) / 2.;
        let lon_center = (min_lon + max_lon) / 2.;
        let cos_lat = lat_center.to_radians().cos().max(0.05);
        let scale = ((max_lat - min_lat).max((max_lon - min_lon) * cos_lat) / 2.).max(0.001) * 1.3;
        Self {
            lon_ref,
            lat_center,
            lon_center,
            scale,
            cos_lat,
        }
    }
    pub fn xy(&self, lat: f64, lon: f64) -> [f32; 2] {
        [
            ((unwrap_lon(lon, self.lon_ref) - self.lon_center) * self.cos_lat / self.scale) as f32,
            ((lat - self.lat_center) / self.scale) as f32,
        ]
    }
}
pub struct Scene {
    pub frame: GeoFrame,
    pub box_start: Option<Pos2>,
    pub trails: bool,
    pub stems: bool,
    pub size_value: bool,
    pub select_box: bool,
    pub world: Vec<Vec<[f64; 2]>>,
}
impl Scene {
    pub fn new(data: &Dataset) -> Self {
        let world: Vec<Vec<[f64; 2]>> =
            serde_json::from_str(include_str!("../assets/coastlines.json"))
                .expect("bundled geography is valid");
        Self {
            frame: GeoFrame::fit(data.events.iter()),
            box_start: None,
            trails: true,
            stems: true,
            size_value: false,
            select_box: false,
            world,
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub fn show(
        &mut self,
        ui: &mut egui::Ui,
        data: &Dataset,
        visible: &[usize],
        selected: &BTreeSet<u64>,
        camera: &mut Camera,
        mode: ViewMode,
        focus: f64,
    ) -> Option<(Vec<u64>, bool)> {
        let (rect, response) = ui.allocate_exact_size(ui.available_size(), Sense::click_and_drag());
        let painter = ui.painter_at(rect);
        painter.rect_filled(rect, 8., Color32::from_rgb(15, 24, 35));
        if response.hovered() {
            let scroll = ui.input(|i| i.smooth_scroll_delta.y);
            if scroll != 0. {
                camera.zoom = (camera.zoom * (scroll * 0.002).exp()).clamp(0.1, 15.);
            }
        }
        if response.dragged_by(egui::PointerButton::Secondary) {
            let d = ui.input(|i| i.pointer.delta());
            camera.pan[0] += d.x;
            camera.pan[1] += d.y;
        }
        if response.dragged_by(egui::PointerButton::Primary)
            && !self.select_box
            && mode == ViewMode::SpaceTime
        {
            let d = ui.input(|i| i.pointer.delta());
            camera.yaw += d.x * 0.008;
            camera.pitch = (camera.pitch + d.y * 0.006).clamp(0.12, 1.45);
        }
        if response.dragged_by(egui::PointerButton::Primary)
            && !self.select_box
            && mode == ViewMode::Map
        {
            let d = ui.input(|i| i.pointer.delta());
            camera.pan[0] += d.x;
            camera.pan[1] += d.y;
        }
        if response.double_clicked() {
            *camera = Camera::default();
        }
        const MAX_MARKERS: usize = 25_000;
        let sampled: Vec<usize> = if mode != ViewMode::Network && visible.len() > MAX_MARKERS {
            visible
                .iter()
                .step_by(visible.len().div_ceil(MAX_MARKERS))
                .copied()
                .collect()
        } else {
            Vec::new()
        };
        let shown: &[usize] = if sampled.is_empty() {
            visible
        } else {
            &sampled
        };
        let mut node_hits: Vec<(String, Pos2, Vec<u64>)> = Vec::new();
        let (lo, hi) = data.time_bounds();
        let span = (hi - lo) as f64;
        let projection = |x: f32, z: f32, t: f32| -> Pos2 {
            let scale = rect.width().min(rect.height()) * 0.36 * camera.zoom;
            if mode == ViewMode::Map {
                return rect.center()
                    + Vec2::new(x * scale, -z * scale)
                    + Vec2::new(camera.pan[0], camera.pan[1]);
            }
            let (s, c) = camera.yaw.sin_cos();
            let rx = x * c - z * s;
            let rz = x * s + z * c;
            let (sp, cp) = camera.pitch.sin_cos();
            Pos2::new(
                rect.center().x + rx * scale + camera.pan[0],
                rect.top() + rect.height() * 0.72 + (rz * sp - t * cp) * scale + camera.pan[1],
            )
        };
        let mut picks: Vec<(u64, Pos2, f32)> = Vec::new();
        match mode {
            ViewMode::SpaceTime | ViewMode::Map => {
                let ground = [
                    projection(-1., -1., 0.),
                    projection(1., -1., 0.),
                    projection(1., 1., 0.),
                    projection(-1., 1., 0.),
                ];
                painter.add(egui::Shape::convex_polygon(
                    ground.to_vec(),
                    Color32::from_rgb(23, 39, 52),
                    Stroke::new(1_f32, Color32::from_rgb(57, 82, 102)),
                ));
                for ring in &self.world {
                    for pair in ring.windows(2) {
                        let a = self.frame.xy(pair[0][1], pair[0][0]);
                        let b = self.frame.xy(pair[1][1], pair[1][0]);
                        if let Some((a, b)) = clip(a, b) {
                            painter.line_segment(
                                [projection(a[0], a[1], 0.), projection(b[0], b[1], 0.)],
                                Stroke::new(1_f32, Color32::from_rgb(69, 99, 111)),
                            );
                        }
                    }
                }
                for i in 0..=8 {
                    let v = -1. + i as f32 / 4.;
                    let grid = Stroke::new(0.7_f32, Color32::from_rgb(39, 59, 76));
                    painter.line_segment([projection(v, -1., 0.), projection(v, 1., 0.)], grid);
                    painter.line_segment([projection(-1., v, 0.), projection(1., v, 0.)], grid);
                    if i % 2 == 0 {
                        let lon = self.frame.lon_center
                            + v as f64 * self.frame.scale / self.frame.cos_lat;
                        let lon = (lon + 180.).rem_euclid(360.) - 180.;
                        painter.text(
                            projection(v, -1.08, 0.),
                            Align2::CENTER_TOP,
                            format!("{lon:.3}°"),
                            FontId::monospace(10.),
                            MUTED,
                        );
                    }
                }
                painter.text(
                    projection(-1.08, 1.1, 0.),
                    Align2::LEFT_BOTTOM,
                    "N",
                    FontId::proportional(13.),
                    ACCENT,
                );
                let height = 1.55 * camera.time_scale;
                if mode == ViewMode::SpaceTime {
                    for i in 0..=4 {
                        let t = i as f32 / 4. * height;
                        let color = Color32::from_rgb(41, 58, 77);
                        painter.line_segment(
                            [projection(-1., 1., t), projection(1., 1., t)],
                            Stroke::new(0.7_f32, color),
                        );
                        let timestamp = lo + (span * i as f64 / 4.);
                        let label = crate::model::time_label(timestamp);
                        painter.text(
                            projection(-1.05, 1., t),
                            Align2::RIGHT_CENTER,
                            &label[5..16],
                            FontId::monospace(10.),
                            MUTED,
                        );
                    }
                    painter.line_segment(
                        [projection(-1., 1., 0.), projection(-1., 1., height)],
                        Stroke::new(1_f32, MUTED),
                    );
                    let t = focus as f32 * height;
                    let plane = vec![
                        projection(-1., -1., t),
                        projection(1., -1., t),
                        projection(1., 1., t),
                        projection(-1., 1., t),
                    ];
                    painter.add(egui::Shape::convex_polygon(
                        plane,
                        Color32::from_rgba_unmultiplied(95, 215, 190, 12),
                        Stroke::new(0.7_f32, Color32::from_rgba_unmultiplied(95, 215, 190, 80)),
                    ));
                }
                let mut tracks: BTreeMap<&str, Vec<(f64, u64, Pos2)>> = BTreeMap::new();
                for &i in shown {
                    let e = &data.events[i];
                    let Some((lat, lon)) = e.location() else {
                        continue;
                    };
                    let [x, z] = self.frame.xy(lat, lon);
                    let t = if mode == ViewMode::Map {
                        0.
                    } else {
                        ((e.time - lo) as f64 / span) as f32 * height
                    };
                    let pos = projection(x, z, t);
                    tracks
                        .entry(&e.entity)
                        .or_default()
                        .push((e.time, e.id, pos));
                    if self.stems && mode == ViewMode::SpaceTime {
                        painter.line_segment(
                            [projection(x, z, 0.), pos],
                            Stroke::new(0.6_f32, entity_color(&e.entity).gamma_multiply(0.16)),
                        );
                    }
                    if let Some(end) = e.end {
                        if mode == ViewMode::SpaceTime {
                            painter.line_segment(
                                [
                                    pos,
                                    projection(x, z, ((end - lo) as f64 / span) as f32 * height),
                                ],
                                Stroke::new(3_f32, entity_color(&e.entity).gamma_multiply(0.6)),
                            );
                        }
                    }
                    picks.push((
                        e.id,
                        pos,
                        if self.size_value {
                            e.value.unwrap_or(1.).abs().sqrt().clamp(2., 10.) as f32
                        } else {
                            3.8
                        },
                    ));
                }
                if self.trails {
                    for (name, mut track) in tracks {
                        track.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
                        for pair in track.windows(2) {
                            let both =
                                selected.contains(&pair[0].1) && selected.contains(&pair[1].1);
                            painter.line_segment(
                                [pair[0].2, pair[1].2],
                                Stroke::new(
                                    if both { 2.8 } else { 1.5_f32 },
                                    entity_color(name).gamma_multiply(if both { 1. } else { 0.6 }),
                                ),
                            );
                        }
                    }
                }
                let unlocated: Vec<_> = visible
                    .iter()
                    .filter(|&&i| data.events[i].location().is_none())
                    .collect();
                if !unlocated.is_empty() {
                    painter.text(
                        rect.left_top() + Vec2::new(16., 50.),
                        Align2::LEFT_TOP,
                        format!(
                            "{} events without location · see timeline / table",
                            unlocated.len()
                        ),
                        FontId::proportional(12.),
                        MUTED,
                    );
                }
            }
            ViewMode::Network => {
                let mut nodes: BTreeSet<&str> = BTreeSet::new();
                for &i in visible {
                    let e = &data.events[i];
                    nodes.insert(&e.entity);
                    if !e.related_to.is_empty() {
                        nodes.insert(&e.related_to);
                    }
                }
                let node_count = nodes.len();
                let nodes: Vec<_> = nodes.into_iter().take(200).collect();
                let radius = rect.width().min(rect.height()) * 0.33;
                let mut positions = BTreeMap::new();
                for (i, name) in nodes.iter().enumerate() {
                    let a = i as f32 / nodes.len().max(1) as f32 * std::f32::consts::TAU
                        - std::f32::consts::FRAC_PI_2;
                    positions.insert(*name, rect.center() + Vec2::angled(a) * radius);
                }
                let mut links: BTreeMap<(&str, &str), (usize, bool)> = BTreeMap::new();
                for &i in visible {
                    let e = &data.events[i];
                    if !e.related_to.is_empty() {
                        let (a, b) = if e.entity < e.related_to {
                            (&*e.entity, &*e.related_to)
                        } else {
                            (&*e.related_to, &*e.entity)
                        };
                        let entry = links.entry((a, b)).or_default();
                        entry.0 += 1;
                        entry.1 |= selected.contains(&e.id);
                    }
                }
                for ((a, b), (count, sel)) in links {
                    if let Some((a, b)) = positions.get(a).zip(positions.get(b)) {
                        painter.line_segment(
                            [*a, *b],
                            Stroke::new(
                                1. + (count as f32).ln(),
                                if sel {
                                    ACCENT
                                } else {
                                    Color32::from_rgb(66, 89, 116)
                                },
                            ),
                        );
                        painter.text(
                            a.lerp(*b, 0.5),
                            Align2::CENTER_CENTER,
                            count.to_string(),
                            FontId::monospace(12.),
                            MUTED,
                        );
                    }
                }
                for (name, &pos) in &positions {
                    painter.circle_filled(pos, 12., entity_color(name));
                    painter.text(
                        pos + Vec2::new(0., 22.),
                        Align2::CENTER_TOP,
                        name,
                        FontId::proportional(13.),
                        Color32::WHITE,
                    );
                }
                let mut members: BTreeMap<&str, Vec<u64>> = BTreeMap::new();
                for &i in visible {
                    let e = &data.events[i];
                    if positions.contains_key(e.entity.as_str()) {
                        members.entry(&e.entity).or_default().push(e.id);
                    }
                    if e.related_to != e.entity && positions.contains_key(e.related_to.as_str()) {
                        members.entry(&e.related_to).or_default().push(e.id);
                    }
                }
                for (name, ids) in members {
                    let pos = positions[name];
                    picks.push((ids[0], pos, 12.));
                    node_hits.push((name.into(), pos, ids));
                }
                if node_count > 200 {
                    painter.text(rect.left_top()+Vec2::new(18.,38.),Align2::LEFT_TOP,format!("Showing first 200 of {node_count} nodes · narrow filters to explore others"),FontId::proportional(11.),MUTED);
                }
                painter.text(rect.left_top()+Vec2::new(18.,15.),Align2::LEFT_TOP,"Connections from the mapped related-to field · click a node to select its events",FontId::proportional(12.),MUTED);
            }
        }
        let by_id: BTreeMap<_, _> = shown
            .iter()
            .map(|&i| (data.events[i].id, &data.events[i]))
            .collect();
        if mode == ViewMode::SpaceTime {
            let depth = |id: u64| {
                let e = by_id[&id];
                let (lat, lon) = e.location().unwrap();
                let [x, z] = self.frame.xy(lat, lon);
                let rz = x * camera.yaw.sin() + z * camera.yaw.cos();
                let t = ((e.time - lo) as f64 / span) as f32 * 1.55 * camera.time_scale;
                rz * camera.pitch.cos() + t * camera.pitch.sin()
            };
            picks.sort_by(|a, b| depth(a.0).total_cmp(&depth(b.0)));
        }
        if !sampled.is_empty() {
            painter.text(
                rect.left_top() + Vec2::new(18., 14.),
                Align2::LEFT_TOP,
                format!(
                    "{} of {} markers drawn · box selection and analysis use all visible events",
                    shown.len(),
                    visible.len()
                ),
                FontId::proportional(11.),
                MUTED,
            );
        }
        if mode != ViewMode::Network {
            for &(id, pos, radius) in &picks {
                if !rect.contains(pos) {
                    continue;
                }
                let Some(e) = by_id.get(&id) else {
                    continue;
                };
                let sel = selected.contains(&id);
                if sel {
                    painter.circle_stroke(pos, radius + 3., Stroke::new(1.6_f32, Color32::WHITE));
                }
                painter.circle_filled(pos, radius, entity_color(&e.entity));
            }
        }
        let hover = response.hover_pos().and_then(|p| {
            picks
                .iter()
                .rev()
                .filter(|(_, pos, r)| pos.distance(p) < r + 6.)
                .min_by(|a, b| a.1.distance(p).total_cmp(&b.1.distance(p)))
        });
        if let Some((id, _, _)) = hover {
            if let Some(e) = by_id.get(id) {
                response.clone().on_hover_ui(|ui| {
                    ui.strong(&e.entity);
                    ui.label(crate::model::time_label(e.time) + " UTC");
                    ui.label(&e.label);
                    ui.label(&e.category);
                    if let Some((lat, lon)) = e.location() {
                        ui.monospace(format!("{lat:.6}, {lon:.6}"));
                    }
                    if !e.note.is_empty() {
                        ui.label(&e.note);
                    }
                });
            }
        }
        if self.select_box && response.drag_started_by(egui::PointerButton::Primary) {
            self.box_start = response.interact_pointer_pos();
        }
        if let Some(start) = self.box_start {
            if let Some(end) = response.interact_pointer_pos() {
                let area = Rect::from_two_pos(start, end);
                painter.rect_filled(area, 0., Color32::from_rgba_unmultiplied(95, 215, 190, 22));
                painter.rect_stroke(
                    area,
                    0.,
                    Stroke::new(1_f32, ACCENT),
                    egui::StrokeKind::Inside,
                );
            }
        }
        let additive = ui.input(|i| i.modifiers.shift || i.modifiers.command);
        if response.drag_stopped_by(egui::PointerButton::Primary) && self.select_box {
            if let Some(start) = self.box_start.take() {
                if let Some(end) = response.interact_pointer_pos() {
                    let area = Rect::from_two_pos(start, end);
                    let ids = if mode == ViewMode::Network {
                        node_hits
                            .iter()
                            .filter(|(_, p, _)| area.contains(*p))
                            .flat_map(|(_, _, ids)| ids.iter().copied())
                            .collect()
                    } else {
                        visible
                            .iter()
                            .filter_map(|&i| {
                                let e = &data.events[i];
                                let (lat, lon) = e.location()?;
                                let [x, z] = self.frame.xy(lat, lon);
                                let t = if mode == ViewMode::Map {
                                    0.
                                } else {
                                    ((e.time - lo) as f64 / span) as f32 * 1.55 * camera.time_scale
                                };
                                area.contains(projection(x, z, t)).then_some(e.id)
                            })
                            .collect()
                    };
                    return Some((ids, additive));
                }
            }
        }
        if response.clicked() {
            if let Some((id, pos, _)) = hover {
                let ids = if mode == ViewMode::Network {
                    node_hits
                        .iter()
                        .find(|(_, p, _)| p == pos)
                        .map(|(_, _, ids)| ids.clone())
                        .unwrap_or_default()
                } else {
                    vec![*id]
                };
                return Some((ids, additive));
            }
            if !additive {
                return Some((Vec::new(), false));
            }
        }
        painter.text(
            rect.left_bottom() + Vec2::new(18., -14.),
            Align2::LEFT_BOTTOM,
            if self.select_box {
                "Drag to select · Shift to add"
            } else if mode == ViewMode::SpaceTime {
                "Drag to orbit · Right-drag to pan · Scroll to zoom"
            } else {
                "Click to select · Scroll to zoom"
            },
            FontId::proportional(11.),
            MUTED,
        );
        None
    }
}
fn clip(a: [f32; 2], b: [f32; 2]) -> Option<([f32; 2], [f32; 2])> {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let (mut lo, mut hi) = (0f32, 1f32);
    for (p, q) in [
        (-dx, a[0] + 1.),
        (dx, 1. - a[0]),
        (-dy, a[1] + 1.),
        (dy, 1. - a[1]),
    ] {
        if p.abs() < 1e-9 {
            if q < 0. {
                return None;
            }
        } else {
            let r = q / p;
            if p < 0. {
                lo = lo.max(r);
            } else {
                hi = hi.min(r);
            }
            if lo > hi {
                return None;
            }
        }
    }
    Some((
        [a[0] + lo * dx, a[1] + lo * dy],
        [a[0] + hi * dx, a[1] + hi * dy],
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clip_crossing_boundary() {
        assert_eq!(clip([-2., 0.], [2., 0.]), Some(([-1., 0.], [1., 0.])));
        assert!(clip([-2., 3.], [2., 3.]).is_none());
    }
}
