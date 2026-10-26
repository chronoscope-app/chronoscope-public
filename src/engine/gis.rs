use super::*;
use crate::gis::{Feature, Layer};
impl Engine {
    pub(super) fn gis_layer(&self, id: &str) -> Result<Layer, String> {
        self.state
            .lock()
            .map_err(|_| "Workspace unavailable")?
            .project
            .gis_layers
            .iter()
            .find(|l| l.id == id)
            .cloned()
            .ok_or_else(|| "GIS layer not found".into())
    }
    pub(super) fn gis_features(&self, layer: &Layer) -> Result<Arc<Vec<Feature>>, String> {
        if let Some(features) = self
            .gis_cache
            .lock()
            .map_err(|_| "GIS cache unavailable")?
            .get(&layer.sha256)
            .cloned()
        {
            return Ok(features);
        }
        let features = Arc::new(crate::gis::features(layer)?);
        let bytes: usize = features
            .iter()
            .map(|f| {
                f.geometry_wkt.as_ref().map_or(0, String::len)
                    + f.properties
                        .iter()
                        .map(|(k, v)| k.len() + v.len())
                        .sum::<usize>()
                    + f.id.len()
                    + f.entity.len()
                    + 128
            })
            .sum();
        if bytes <= 32 * 1024 * 1024 {
            let mut cache = self.gis_cache.lock().map_err(|_| "GIS cache unavailable")?;
            if cache.len() >= 4 {
                cache.clear();
            }
            cache.insert(layer.sha256.clone(), features.clone());
        }
        Ok(features)
    }
    pub(super) fn invoke_gis(&self, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "file_probe" => {
                let path: String = arg(&args, "path")?;
                let path = Path::new(&path);
                let ext = path
                    .extension()
                    .and_then(|x| x.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if ext == "chronoscope" {
                    return Ok(json!({"kind":"workspace","format":null}));
                }
                if ["csv", "tsv", "xls", "xlsx", "xlsb"].contains(&ext.as_str()) {
                    return Ok(json!({"kind":"data","format":null}));
                }
                let mut probe = vec![];
                if ext == "json" {
                    use std::io::Read;
                    std::fs::File::open(path)
                        .map_err(|e| e.to_string())?
                        .take(crate::gis::MAX_SOURCE + 1)
                        .read_to_end(&mut probe)
                        .map_err(|e| e.to_string())?;
                    if probe.len() as u64 > crate::gis::MAX_SOURCE {
                        return Err("JSON source exceeds 64 MiB".into());
                    }
                    let v: Value =
                        serde_json::from_slice(&probe).map_err(|e| format!("Invalid JSON: {e}"))?;
                    if v.get("dataset").is_some()
                        && (v.get("version").is_some() || v.get("format").is_some())
                    {
                        return Ok(json!({"kind":"workspace","format":null}));
                    }
                }
                Ok(match crate::gis::format(path, &probe) {
                    Ok(format) => json!({"kind":"gis","format":match ext.as_str() {
                        "shp" => json!("shapefile"), "gpkg" => json!("geopackage"), _ => json!(format),
                    }}),
                    Err(_) => json!({"kind":"data","format":null}),
                })
            }
            "gis_layers" => Ok(
                json!({"layers":self.state.lock().map_err(|_|"Workspace unavailable")?.project.gis_layers}),
            ),
            "gis_load" => {
                let path: String = arg(&args, "path")?;
                if self
                    .state
                    .lock()
                    .map_err(|_| "Workspace unavailable")?
                    .project
                    .gis_layers
                    .len()
                    >= crate::gis::MAX_LAYERS
                {
                    return Err("GIS layer limit is 64".into());
                }
                let position = args
                    .get("position")
                    .filter(|v| !v.is_null())
                    .map(|v| serde_json::from_value(v.clone()).map_err(|e| e.to_string()))
                    .transpose()?;
                let mut layer = crate::gis::load(
                    Path::new(&path),
                    &self.data_dir,
                    position,
                    args["scale"].as_f64().unwrap_or(1.),
                )?;
                if let Some(name) = args["name"].as_str() {
                    layer.name = name.into();
                }
                if !layer.format.is_3d() && layer.feature_count > 50000 {
                    return Err("RESOURCE_LIMIT: native GIS reference layers are limited to 50000 features. Import this source as Events to use clustering and display budgets.".into());
                }
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let mut layers = s.project.gis_layers.clone();
                layers.push(layer.clone());
                crate::gis::validate_layers(&layers)?;
                s.project.gis_layers = layers;
                s.project.version = 5;
                Ok(json!({"layer":layer}))
            }
            "gis_set" => {
                let id: String = arg(&args, "id")?;
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let layer = s
                    .project
                    .gis_layers
                    .iter_mut()
                    .find(|l| l.id == id)
                    .ok_or("GIS layer not found")?;
                let mut next = layer.clone();
                if let Some(enabled) = args["enabled"].as_bool() {
                    next.enabled = enabled;
                }
                if let Some(name) = args["name"].as_str() {
                    next.name = name.into();
                }
                if let Some(scale) = args["scale"].as_f64() {
                    next.scale = scale;
                }
                if let Some(p) = args.get("position") {
                    next.position =
                        Some(serde_json::from_value(p.clone()).map_err(|e| e.to_string())?);
                }
                if let Some(selected) = args.get("selected") {
                    next.selected =
                        serde_json::from_value(selected.clone()).map_err(|e| e.to_string())?;
                }
                next.validate()?;
                if args.get("selected").is_some() {
                    let features = self.gis_features(&next)?;
                    let ids: BTreeSet<_> = features.iter().map(|f| f.id.as_str()).collect();
                    if next.selected.iter().any(|id| !ids.contains(id.as_str())) {
                        return Err(
                            "Unknown GIS feature ID; use gis_table to discover exact source IDs"
                                .into(),
                        );
                    }
                    next.selected.sort();
                    next.selected.dedup();
                }
                *layer = next.clone();
                Ok(json!({"layer":next}))
            }
            "gis_remove" => {
                let id: String = arg(&args, "id")?;
                let mut s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let old = s.project.gis_layers.len();
                s.project.gis_layers.retain(|l| l.id != id);
                if old == s.project.gis_layers.len() {
                    return Err("GIS layer not found".into());
                }
                if s.project.scene.gis_table.as_deref() == Some(&id) {
                    s.project.scene.gis_table = None;
                }
                for view in &mut s.project.views {
                    if view.scene.gis_table.as_deref() == Some(&id) {
                        view.scene.gis_table = None;
                    }
                }
                Ok(json!({"removed":id}))
            }
            "gis_read" => {
                let id: String = arg(&args, "id")?;
                let resource: String = arg(&args, "resource")?;
                crate::gis::read(
                    &self.gis_layer(&id)?,
                    &resource,
                    args["offset"].as_u64().unwrap_or(0),
                    args["limit"].as_u64().unwrap_or(1024 * 1024) as usize,
                )
            }
            "gis_table" => {
                let revision = self
                    .revision_counter
                    .load(std::sync::atomic::Ordering::Acquire);
                if args["expected_revision"]
                    .as_u64()
                    .is_some_and(|expected| expected != revision)
                {
                    return Err(
                        "CONFLICT: workspace changed while paging GIS reference data".into(),
                    );
                }
                let id: String = arg(&args, "id")?;
                let layer = self.gis_layer(&id)?;
                let features = self.gis_features(&layer)?;
                let search = args["search"].as_str().unwrap_or("").to_lowercase();
                let mut rows: Vec<_> = features
                    .iter()
                    .filter(|f| {
                        args["feature_id"].as_str().is_none_or(|id| {
                            f.id == id
                                || matches!(layer.format, crate::gis::Format::Czml)
                                    && f.properties.get("czml_id").is_some_and(|v| v == id)
                                || matches!(layer.format, crate::gis::Format::Gpx)
                                    && f.properties
                                        .get("chronoscope_native_id")
                                        .is_some_and(|v| v == id)
                        })
                    })
                    .filter(|f| {
                        search.is_empty()
                            || f.id.to_lowercase().contains(&search)
                            || f.entity.to_lowercase().contains(&search)
                            || f.properties
                                .values()
                                .any(|v| v.to_lowercase().contains(&search))
                    })
                    .collect();
                let field = args["sort"].as_str().unwrap_or("id");
                let value = |f: &Feature| {
                    match field {
                        "id" => f.id.as_str(),
                        "entity" => f.entity.as_str(),
                        "time" => f.time.as_deref().unwrap_or(""),
                        "end" => f.end.as_deref().unwrap_or(""),
                        _ => f.properties.get(field).map(String::as_str).unwrap_or(""),
                    }
                    .to_owned()
                };
                rows.sort_by_cached_key(|f| value(f));
                if args["descending"] == true {
                    rows.reverse();
                }
                let count = rows.len();
                let offset = args["offset"].as_u64().unwrap_or(0) as usize;
                let limit = args["limit"].as_u64().unwrap_or(50) as usize;
                let mut columns = BTreeSet::new();
                for f in features.iter() {
                    columns.extend(f.properties.keys().cloned());
                }
                let windowed = args.get("column_limit").is_some();
                let columns: Vec<_> = if windowed {
                    ["id", "entity", "time", "end"]
                        .into_iter()
                        .map(str::to_owned)
                        .chain(columns.into_iter().filter(|name| {
                            !matches!(name.as_str(), "id" | "entity" | "time" | "end")
                        }))
                        .collect()
                } else {
                    columns.into_iter().collect()
                };
                let total_columns = columns.len();
                let column_offset = args["column_offset"].as_u64().unwrap_or(0) as usize;
                let columns: Vec<_> = if windowed {
                    columns
                        .into_iter()
                        .skip(column_offset)
                        .take(args["column_limit"].as_u64().unwrap() as usize)
                        .collect()
                } else {
                    columns
                };
                let mut page = vec![];
                let mut bytes = 0;
                for row in rows.into_iter().skip(offset).take(limit) {
                    let mut value = serde_json::to_value(row).map_err(|e| e.to_string())?;
                    if windowed {
                        value["properties"]
                            .as_object_mut()
                            .unwrap()
                            .retain(|name, _| columns.contains(name));
                    }
                    bytes += serde_json::to_vec(&value).map_err(|e| e.to_string())?.len();
                    if bytes > 4 * 1024 * 1024 {
                        if page.is_empty() {
                            return Err(
                                "RESOURCE_LIMIT: GIS feature exceeds page payload limit".into()
                            );
                        }
                        break;
                    }
                    page.push(value);
                }
                let next_offset = offset.saturating_add(page.len());
                Ok(
                    json!({"revision":revision,"returned_count":page.len(),"next_offset":if next_offset<count {Some(next_offset)} else {None},"rows":page,"count":count,"offset":offset,"limit":limit,"columns":columns,"total_columns":total_columns,"column_offset":column_offset,"source":layer.name,"semantics":"Reference features retain source geometry/properties; Events conversion is explicit and requires timestamps."}),
                )
            }
            _ => Err(format!("Unknown GIS command: {command}")),
        }
    }
}
