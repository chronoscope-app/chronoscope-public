//! Coherent internal UI read. The caller holds Engine's operation gate for the
//! whole request. Raw read helpers take short state locks, without recursively
//! entering the public engine or allowing a writer between sections.
use super::*;
impl Engine {
    pub(super) fn view_snapshot_v1(&self, args: Value) -> Result<Value, String> {
        let snapshot=self.invoke_raw("snapshot",json!({"selection_limit":20000,"include_statistics":args["include_statistics"].as_bool().unwrap_or(false)}))?;
        let mut result = json!({"version":1,"snapshot":snapshot});
        if args["include_render"] == true || args["include_display"] == true {
            let mut request = json!({"max_points":args["max_points"].as_u64().or_else(||result["snapshot"]["scene"]["render_budget"].as_u64()).unwrap_or(20000)});
            if let Some(cap) = args["resource_max_points"].as_u64() {
                request["max_points"] = json!(request["max_points"].as_u64().unwrap().min(cap));
            }
            if let Some(bounds) = args.get("bounds") {
                request["bounds"] = bounds.clone();
            }
            let (options, lo, hi, globe_time) = {
                let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
                let (lo, hi) = s.store.time_bounds()?;
                (
                    s.project.scene.display.clone().unwrap_or_default(),
                    s.project.filter.start.unwrap_or(lo),
                    s.project.filter.end.unwrap_or(hi),
                    s.project.scene.globe_time,
                )
            };
            if (options.mode != "points" || options.bloom)
                && !(result["snapshot"]["scene"]["mode"] == "globe"
                    && result["snapshot"]["scene"]["globe_altitude"] == true)
            {
                let mode = result["snapshot"]["scene"]["mode"]
                    .as_str()
                    .unwrap_or("space-time");
                let ground_effect = options.bloom || options.mode == "heatmap";
                let minutes = if mode == "map"
                    || (mode == "globe" && (!globe_time || options.mode == "density"))
                    || ground_effect
                {
                    0
                } else if options.time_bin_minutes > 0 {
                    options.time_bin_minutes
                } else {
                    ((hi - lo).max(60.) / 60. / 24.).max(1.) as i64
                };
                // Visual clusters keep each entity's identity and display color.
                // Density and ground effects retain their combined-count grid.
                let partition = if ground_effect || options.mode == "density" {
                    "all"
                } else {
                    "entity"
                };
                let mut grid = json!({"level":args["display_level"].as_u64().unwrap_or(4),"time_bin_minutes":minutes,"partition":partition,"weight":if options.mode=="heatmap"{options.heat_weight.as_str()}else{"count"},"max_cells":4000});
                if let Some(cap) = args["resource_max_points"].as_u64() {
                    grid["max_cells"] = json!(4000_u64.min(cap));
                }
                // Cesium GeographicProjection supports polar coordinates in all modes.
                // The summary edge cells already extend to the poles.
                grid["flat"] = json!(false);
                if let Some(bounds) = args.get("bounds") {
                    grid["bounds"] = bounds.clone();
                }
                let display = match self.invoke_raw("display_data", grid) {
                    Ok(display) => display,
                    // More independent entities than the cell budget cannot
                    // be combined without losing identity. Fall back to the
                    // ordinary bounded event representation instead of failing
                    // the whole scene or mixing their colors.
                    Err(error)
                        if partition == "entity"
                            && error
                                .starts_with("RESOURCE_LIMIT: too many display partitions;") =>
                    {
                        Value::Null
                    }
                    Err(error) => return Err(error),
                };
                // Retain bounded observations for tracks and trails even when
                // cluster glyphs replace individual event glyphs. A heat-only
                // scene needs exact summary cells and selected evidence, without
                // constructing thousands of hidden source glyphs.
                if (!ground_effect && options.mode == "density")
                    || (ground_effect
                        && !options.show_points
                        && !options.show_tracks
                        && !options.show_trails)
                {
                    request["selected_only"] = json!(true);
                    request["include_time_only"] = json!(true);
                    request["max_points"] = json!(2000);
                }
                result["display"] = display;
            }
            if args["include_render"] == true {
                let render = self.invoke_raw("render_data", request)?;
                let mut request = json!({"limit":1000,"max_vertices":200000});
                if let Some(cap) = args["resource_max_vertices"].as_u64() {
                    request["max_vertices"] = json!(cap);
                }
                if let Some(bounds) = args.get("bounds") {
                    request["bounds"] = bounds.clone();
                }
                let shapes = self.invoke_raw("render_geometries", request)?;
                result["render"] = render;
                result["geometries"] = shapes;
            }
        }
        if let Some(page) = args.get("page") {
            let page = self.invoke_raw(page["command"].as_str().unwrap(), page["args"].clone())?;
            result["page"] = page;
        }
        if args["include_inspector"] == true && result["snapshot"]["selected_count"] == 1 {
            result["inspected"] = self.invoke_raw(
                "events",
                json!({"id":result["snapshot"]["selected"][0],"limit":1}),
            )?;
        }
        let state = self.state.lock().map_err(|_| "Workspace unavailable")?;
        // Intersect before allocating/sorting: a dense view usually has far
        // fewer selected records than rendered records. Borrow coherent payloads.
        let selected = args["selection_ids"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .chain(
                result["render"]["ids"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str),
            )
            .chain(
                result["geometries"]["features"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|v| v["id"].as_str()),
            )
            .chain(
                result["page"]["events"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|v| v["id"].as_str()),
            )
            .filter(|id| {
                id.parse()
                    .ok()
                    .is_some_and(|id| state.project.selected.contains(&id))
            })
            .collect::<BTreeSet<_>>();
        let identity = self
            .canonical_view_identity_locked(&state)
            .map_err(crate::error::EngineError::into_legacy)?;
        let selected = json!(selected);
        result["selected"] = selected;
        result["stamp"] = json!({"store_id":identity.store_id(),"revision":identity.revision(),"data_revision":identity.data_revision(),"selection_revision":identity.selection_revision(),"filter_signature":identity.filter_signature(),"scene_generation":args["generation"]});
        Ok(result)
    }
}
