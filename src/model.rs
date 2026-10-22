use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_EVENTS: usize = 250_000;
pub const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub id: u64,
    pub entity: String,
    pub time: f64,
    pub end: Option<f64>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mgrs_precision: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geometry_wkt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location_kind: Option<String>,
    pub category: String,
    pub label: String,
    pub value: Option<f64>,
    pub related_to: String,
    pub attrs: BTreeMap<String, String>,
    pub tags: BTreeSet<String>,
    pub note: String,
    pub source: String,
    pub source_row: usize,
}
impl Event {
    pub fn location(&self) -> Option<(f64, f64)> {
        self.lat.zip(self.lon)
    }
    pub fn derive_polygon_centroid(&mut self) -> Result<(), String> {
        if let Some(wkt) = &self.geometry_wkt {
            let shape = crate::geometry::parse(wkt)?;
            if shape.kind == "Point" && shape.points.len() == 1 {
                self.location_kind = None;
            } else if self.location().is_none()
                || self.location_kind.as_deref() == Some("polygon-centroid")
            {
                if let Some([lon, lat]) = crate::geometry_centroid::centroid(&shape) {
                    self.lat = Some(lat);
                    self.lon = Some(lon);
                    self.location_kind = Some("polygon-centroid".into());
                } else if self.location_kind.is_some() {
                    self.lat = None;
                    self.lon = None;
                    self.location_kind = None;
                }
            }
        } else {
            self.location_kind = None;
        }
        Ok(())
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.entity.trim().is_empty() {
            return Err("Entity must not be empty".into());
        }
        if crate::timestamps::datetime(self.time).is_none() {
            return Err("Time is outside the supported calendar".into());
        }
        if let Some(end) = self.end {
            if end < self.time || crate::timestamps::datetime(end).is_none() {
                return Err("End time must be valid and at or after start".into());
            }
        }
        if self.lat.is_some() != self.lon.is_some() {
            return Err("Provide both latitude and longitude, or neither".into());
        }
        if let Some((lat, lon)) = self.location() {
            if !lat.is_finite()
                || !lon.is_finite()
                || !(-90.0..=90.0).contains(&lat)
                || !(-180.0..=180.0).contains(&lon)
            {
                return Err(
                    "Coordinates must be finite WGS84 latitude [-90,90], longitude [-180,180]"
                        .into(),
                );
            }
        }
        if let Some(text) = &self.geometry_wkt {
            let shape = crate::geometry::parse(text)?;
            if shape.kind == "Point" && shape.points.len() == 1 {
                if self.location_kind.is_some() {
                    return Err("A source point cannot be labelled as a polygon centroid".into());
                }
                let [lon, lat] = shape.points[0];
                if self.lat != Some(lat) || self.lon != Some(lon) {
                    return Err("WKT Point must match its canonical point coordinates".into());
                }
            } else if self.location().is_some() {
                let centroid = crate::geometry_centroid::centroid(&shape);
                if self.location_kind.as_deref() != Some("polygon-centroid")
                    || centroid.is_none_or(|[lon, lat]| {
                        self.lon.is_none_or(|x| (x - lon).abs() > 1e-8)
                            || self.lat.is_none_or(|y| (y - lat).abs() > 1e-8)
                    })
                {
                    return Err("Non-point geometry coordinates must be its explicitly derived polygon centroid".into());
                }
            }
        }
        if self.location_kind.is_some()
            && (self.location_kind.as_deref() != Some("polygon-centroid")
                || self.geometry_wkt.is_none()
                || self.location().is_none())
        {
            return Err("Invalid derived geometry location".into());
        }
        if self.value.is_some_and(|v| !v.is_finite()) {
            return Err("Numeric value must be finite".into());
        }
        if self.mgrs_precision.is_some_and(|p| p > 5) {
            return Err("Invalid MGRS precision".into());
        }
        if self.attrs.len() > 512 || self.tags.len() > 1024 || self.source_row > i64::MAX as usize {
            return Err("Event exceeds attribute/tag/source-row budget".into());
        }
        let scalar = [
            &self.entity,
            &self.category,
            &self.label,
            &self.related_to,
            &self.note,
            &self.source,
        ];
        if scalar.iter().any(|v| v.len() > 65536)
            || self.tags.iter().any(|v| v.len() > 16384)
            || self
                .attrs
                .iter()
                .map(|(k, v)| k.len() + v.len())
                .sum::<usize>()
                > 1024 * 1024
        {
            return Err("Event text exceeds field/record budgets".into());
        }
        if serde_json::to_vec(self).map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024 {
            return Err("Event encoded payload exceeds 2 MiB".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Dataset {
    pub events: Vec<Event>,
    pub name: String,
}
impl Dataset {
    pub fn validate(&self) -> Result<(), String> {
        if self.events.len() > MAX_EVENTS {
            return Err(format!("At most {MAX_EVENTS} events are supported"));
        }
        let mut ids = BTreeSet::new();
        for e in &self.events {
            e.validate()?;
            if !ids.insert(e.id) {
                return Err("Duplicate event ID in project".into());
            }
        }
        Ok(())
    }
    pub fn time_bounds(&self) -> (f64, f64) {
        let lo = self
            .events
            .iter()
            .map(|e| e.time)
            .reduce(f64::min)
            .unwrap_or(0.);
        let hi = self
            .events
            .iter()
            .map(|e| e.end.unwrap_or(e.time))
            .reduce(f64::max)
            .unwrap_or(lo);
        (lo, if hi > lo { hi } else { lo + 1. })
    }
    pub fn entities(&self) -> BTreeSet<String> {
        self.events.iter().map(|e| e.entity.clone()).collect()
    }
    pub fn categories(&self) -> BTreeSet<String> {
        self.events.iter().map(|e| e.category.clone()).collect()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct GeoBounds {
    pub south: f64,
    pub north: f64,
    pub west: f64,
    pub east: f64,
}
impl GeoBounds {
    pub fn contains(&self, lat: f64, lon: f64) -> bool {
        lat >= self.south
            && lat <= self.north
            && if self.west <= self.east {
                lon >= self.west && lon <= self.east
            } else {
                lon >= self.west || lon <= self.east
            }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub enum Operator {
    #[default]
    Contains,
    Equals,
    NotEquals,
    Greater,
    Less,
    IsEmpty,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct Predicate {
    pub field: String,
    pub op: Operator,
    pub value: String,
}
impl Predicate {
    pub fn matches(&self, e: &Event) -> bool {
        let value = if let Some(field) = self.field.strip_prefix("attribute:") {
            e.attrs.get(field).cloned().unwrap_or_default()
        } else {
            match self.field.as_str() {
                "geometry_wkt" => e.geometry_wkt.clone().unwrap_or_default(),
                "location_kind" => e.location_kind.clone().unwrap_or_default(),
                "id" => e.id.to_string(),
                "time" => e.time.to_string(),
                "end" => e.end.map(|v| v.to_string()).unwrap_or_default(),
                "lat" => e.lat.map(|v| v.to_string()).unwrap_or_default(),
                "lon" => e.lon.map(|v| v.to_string()).unwrap_or_default(),
                "source" => e.source.clone(),
                "source_row" => e.source_row.to_string(),
                "note" => e.note.clone(),
                "mgrs_precision" => e.mgrs_precision.map(|v| v.to_string()).unwrap_or_default(),
                "entity" => e.entity.clone(),
                "category" => e.category.clone(),
                "label" => e.label.clone(),
                "related_to" => e.related_to.clone(),
                "value" => e.value.map(|v| v.to_string()).unwrap_or_default(),
                "tags" => e.tags.iter().cloned().collect::<Vec<_>>().join(","),
                field => e.attrs.get(field).cloned().unwrap_or_default(),
            }
        };
        if self.field == "id" && matches!(self.op, Operator::Greater | Operator::Less) {
            return self.value.parse::<u64>().ok().is_some_and(|rhs| {
                if self.op == Operator::Greater {
                    e.id > rhs
                } else {
                    e.id < rhs
                }
            });
        }
        let numeric = if matches!(self.field.as_str(), "value" | "lat" | "lon") {
            self.value.parse::<f64>().ok().filter(|v| v.is_finite())
        } else {
            None
        };
        match self.op {
            Operator::Contains => value.to_lowercase().contains(&self.value.to_lowercase()),
            Operator::Equals => numeric.map_or_else(
                || value == self.value,
                |rhs| value.parse::<f64>().ok() == Some(rhs),
            ),
            Operator::NotEquals => numeric.map_or_else(
                || value != self.value,
                |rhs| value.parse::<f64>().ok() != Some(rhs),
            ),
            Operator::IsEmpty => value.trim().is_empty(),
            Operator::Greater | Operator::Less => value
                .parse::<f64>()
                .ok()
                .zip(self.value.parse::<f64>().ok())
                .is_some_and(|(a, b)| {
                    if self.op == Operator::Greater {
                        a > b
                    } else {
                        a < b
                    }
                }),
        }
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Filter {
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub hidden_entities: BTreeSet<String>,
    pub hidden_categories: BTreeSet<String>,
    pub hidden_sources: BTreeSet<String>,
    /// Sidebar groupings are independent of the source entity/track identity.
    pub facet_fields: BTreeMap<String, String>,
    pub facet_hidden: BTreeMap<String, BTreeSet<String>>,
    pub search: String,
    pub predicates: Vec<Predicate>,
    pub selected_only: bool,
    pub bounds: Option<GeoBounds>,
    pub located_only: bool,
}
impl Filter {
    pub fn matches(&self, e: &Event, selected: &BTreeSet<u64>) -> bool {
        if self.start.is_some_and(|t| e.end.unwrap_or(e.time) < t)
            || self.end.is_some_and(|t| e.time > t)
            || self.hidden_entities.contains(&e.entity)
            || self.hidden_categories.contains(&e.category)
            || self.hidden_sources.contains(&e.source)
            || (self.selected_only && !selected.contains(&e.id))
            || (self.located_only
                && e.location().is_none()
                && !e
                    .geometry_wkt
                    .as_ref()
                    .is_some_and(|w| crate::geometry::parse(w).is_ok_and(|s| s.bounds.is_some())))
        {
            return false;
        }
        if let Some(b) = &self.bounds {
            if !e.geometry_wkt.as_ref().map_or_else(
                || e.location().is_some_and(|(lat, lon)| b.contains(lat, lon)),
                |w| crate::geometry::intersects(w, b.south, b.north, b.west, b.east),
            ) {
                return false;
            }
        }
        if self.facet_hidden.iter().any(|(kind, hidden)| {
            let field = self
                .facet_fields
                .get(kind)
                .map(String::as_str)
                .unwrap_or(kind);
            hidden.iter().any(|value| {
                Predicate {
                    field: field.into(),
                    op: Operator::Equals,
                    value: value.clone(),
                }
                .matches(e)
            })
        }) {
            return false;
        }
        if !self.predicates.iter().all(|p| p.matches(e)) {
            return false;
        }
        if !self.search.is_empty() {
            let q = self.search.to_lowercase();
            if ![&e.entity, &e.category, &e.label, &e.related_to, &e.note]
                .iter()
                .any(|s| s.to_lowercase().contains(&q))
                && !e.attrs.values().any(|s| s.to_lowercase().contains(&q))
                && !e.tags.iter().any(|s| s.to_lowercase().contains(&q))
            {
                return false;
            }
        }
        true
    }
}

pub fn parse_time(s: &str, custom: &str, offset_minutes: i32) -> Result<f64, String> {
    crate::timestamps::parse(
        s,
        &crate::timestamps::Options {
            custom,
            offset_minutes,
            ..Default::default()
        },
    )
}
pub fn time_label(t: f64) -> String {
    crate::timestamps::datetime(t)
        .map(|d| d.format("%Y-%m-%d %H:%M:%S%.f").to_string())
        .unwrap_or_else(|| "Invalid time".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timestamp_offsets_and_custom_dates() {
        assert_eq!(
            parse_time("2025-01-01T10:00:00+02:00", "", 0).unwrap(),
            parse_time("2025-01-01 08:00:00", "", 0).unwrap()
        );
        assert_eq!(
            parse_time("01/02/2025 10:00", "%d/%m/%Y %H:%M", 120).unwrap(),
            parse_time("2025-02-01T08:00:00Z", "", 0).unwrap()
        );
        assert!(parse_time("01/02/2025", "", 0).is_err());
        assert_eq!(parse_time("1735718400000", "", 0).unwrap(), 1735718400.);
    }
    #[test]
    fn dateline_bounds() {
        let b = GeoBounds {
            south: -10.,
            north: 10.,
            west: 170.,
            east: -170.,
        };
        assert!(b.contains(0., 179.));
        assert!(b.contains(0., -179.));
        assert!(!b.contains(0., 0.));
    }
}
