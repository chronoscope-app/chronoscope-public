use super::*;
use crate::display::{Bin, Cell as DisplayCell, Packet};
use std::collections::BTreeSet;
pub(super) fn register(c: &Connection) -> Result<(), String> {
    use rusqlite::functions::FunctionFlags as F;
    for (name, is_x) in [("display_x", true), ("display_y", false)] {
        c.create_scalar_function(name, 2, F::SQLITE_DETERMINISTIC, move |ctx| {
            let value: f64 = ctx.get(0)?;
            let level: u8 = ctx.get(1)?;
            if level > 24 {
                return Err(rusqlite::Error::UserFunctionError(
                    "Invalid display level".into(),
                ));
            }
            Ok(if is_x {
                crate::display::tile_x(value, level)
            } else {
                crate::display::tile_y(value, level)
            })
        })
        .map_err(err)?;
    }
    for (name, sine) in [("display_sin", true), ("display_cos", false)] {
        c.create_scalar_function(name, 1, F::SQLITE_DETERMINISTIC, move |ctx| {
            let value: f64 = ctx.get(0)?;
            Ok(if sine {
                value.to_radians().sin()
            } else {
                value.to_radians().cos()
            })
        })
        .map_err(err)?;
    }
    c.create_scalar_function("display_slab", 2, F::SQLITE_DETERMINISTIC, |ctx| {
        let time: f64 = ctx.get(0)?;
        let minutes: i64 = ctx.get(1)?;
        Ok(if minutes <= 0 {
            0
        } else {
            (time / (minutes * 60) as f64).floor() as i64
        })
    })
    .map_err(err)?;
    Ok(())
}
impl DataStore {
    /// Exact union of homogeneous display cells, without thousands of SQL ORs.
    pub fn display_members(
        &self,
        filter: &Filter,
        source: Option<&str>,
        cells: &[DisplayCell],
    ) -> Result<BTreeSet<u64>, String> {
        let Some(first) = cells.first() else {
            return Ok(BTreeSet::new());
        };
        for cell in cells {
            cell.validate()?;
            if cell.level != first.level
                || cell.time_bin_minutes != first.time_bin_minutes
                || cell.partition != first.partition
                || cell.viewport != first.viewport
            {
                return Err("INVALID_ARGUMENT: display cells must share grid, time width, partition and viewport".into());
            }
        }
        self.connection.execute_batch("CREATE TEMP TABLE IF NOT EXISTS display_picked(x INTEGER,y INTEGER,slab INTEGER,key TEXT,PRIMARY KEY(x,y,slab,key));DELETE FROM display_picked;").map_err(err)?;
        let mut insert = self
            .connection
            .prepare("INSERT OR IGNORE INTO display_picked VALUES(?,?,?,?)")
            .map_err(err)?;
        for cell in cells {
            insert
                .execute(rusqlite::params![cell.x, cell.y, cell.slab, cell.key])
                .map_err(err)?;
        }
        let mut scoped = filter.clone();
        if first.viewport.is_some() {
            scoped.selected_only = false;
        }
        let (mut clause, mut args) = Self::where_sql(&scoped, source);
        if first.viewport.is_some() && filter.selected_only {
            clause.push_str(" AND EXISTS(SELECT 1 FROM selection s WHERE s.id=e.id)");
        }
        if let Some([west, south, east, north]) = first.viewport {
            let (c, a) = Self::where_sql(
                &Filter {
                    bounds: Some(GeoBounds {
                        west,
                        south,
                        east,
                        north,
                    }),
                    ..Filter::default()
                },
                None,
            );
            clause.push_str(&format!(" AND ({c})"));
            args.extend(a);
        }
        let partition = match first.partition.as_str() {
            "entity" => "e.entity",
            "source" => "e.source",
            _ => "''",
        };
        let sql=format!("SELECT e.id FROM events e WHERE ({clause}) AND e.lat IS NOT NULL AND e.lon IS NOT NULL AND (display_x(e.lon,{}),display_y(e.lat,{}),display_slab(e.time,{}),{partition}) IN (SELECT x,y,slab,key FROM display_picked)",first.level,first.level,first.time_bin_minutes);
        let mut query = self.connection.prepare(&sql).map_err(err)?;
        let rows = query
            .query_map(rusqlite::params_from_iter(args), |r| r.get::<_, String>(0))
            .map_err(err)?;
        let mut ids = BTreeSet::new();
        for row in rows {
            ids.insert(row.map_err(err)?.parse().map_err(|_| "Invalid stored ID")?);
        }
        self.connection
            .execute("DELETE FROM display_picked", [])
            .map_err(err)?;
        Ok(ids)
    }
    pub fn display_cell_sql(cell: &DisplayCell) -> Result<(String, Vec<SqlValue>), String> {
        cell.validate()?;
        let mut args = vec![
            SqlValue::Integer(cell.level as i64),
            SqlValue::Integer(cell.x as i64),
            SqlValue::Integer(cell.level as i64),
            SqlValue::Integer(cell.y as i64),
            SqlValue::Integer(cell.time_bin_minutes),
            SqlValue::Integer(cell.slab),
        ];
        let mut sql="e.lat IS NOT NULL AND e.lon IS NOT NULL AND display_x(e.lon,?)=? AND display_y(e.lat,?)=? AND display_slab(e.time,?)=?".to_string();
        if cell.partition != "all" {
            sql.push_str(if cell.partition == "entity" {
                " AND e.entity=?"
            } else {
                " AND e.source=?"
            });
            args.push(SqlValue::Text(cell.key.clone()));
        }
        if let Some([west, south, east, north]) = cell.viewport {
            let (extra, values) = Self::where_sql(
                &Filter {
                    bounds: Some(GeoBounds {
                        west,
                        south,
                        east,
                        north,
                    }),
                    ..Filter::default()
                },
                None,
            );
            sql.push_str(&format!(" AND ({extra})"));
            args.extend(values);
        }
        Ok((sql, args))
    }
    pub fn display_grid(
        &self,
        filter: &Filter,
        viewport: Option<&GeoBounds>,
        request: crate::display::GridRequest<'_>,
    ) -> Result<Packet, String> {
        let crate::display::GridRequest {
            mut level,
            mut minutes,
            partition,
            weight,
            limit,
        } = request;
        let key = serde_json::to_string(&(
            "display",
            self.query_stamp(filter.selected_only),
            filter,
            viewport,
            level,
            minutes,
            partition,
            weight,
            limit,
        ))
        .map_err(err)?;
        let cached = self.summary_cache.borrow().get(&key).cloned();
        let mut packet = if let Some(cached) = cached {
            let mut p: Packet = serde_json::from_value(cached).map_err(err)?;
            p.cache_hit = true;
            p
        } else {
            let mut scoped = filter.clone();
            if viewport.is_some() {
                scoped.selected_only = false;
            }
            let (mut clause, mut args) = Self::where_sql(&scoped, None);
            if viewport.is_some() && filter.selected_only {
                clause.push_str(" AND EXISTS(SELECT 1 FROM selection s WHERE s.id=e.id)");
            }
            clause.push_str(" AND e.lat IS NOT NULL AND e.lon IS NOT NULL");
            if let Some(bounds) = viewport {
                let extra = Filter {
                    bounds: Some(bounds.clone()),
                    ..Filter::default()
                };
                let (sql, values) = Self::where_sql(&extra, None);
                clause.push_str(&format!(" AND ({sql})"));
                args.extend(values);
            }
            let part = match partition {
                "entity" => "e.entity",
                "source" => "e.source",
                _ => "''",
            };
            let weighting = if weight == "value" {
                "SUM(CASE WHEN e.value>=0 THEN e.value ELSE 0 END)"
            } else {
                "CAST(COUNT(*) AS REAL)"
            };
            let mut bins;
            loop {
                crate::operation::check()?;
                let sql=format!("SELECT display_x(e.lon,{level}),display_y(e.lat,{level}),display_slab(e.time,{minutes}),{part},COUNT(*),{weighting},MIN(e.time),MAX(e.time),MIN(e.id),MIN(e.lon),MIN(e.lat),MAX(e.lon),MAX(e.lat),AVG(e.lat),AVG(CASE WHEN e.lon=180 THEN -180 ELSE e.lon END),SUM(display_sin(e.lon)),SUM(display_cos(e.lon)) FROM events e WHERE {clause} GROUP BY 1,2,3,4 ORDER BY 1,2,3,4 LIMIT {}",limit+1);
                let mut q = self.connection.prepare(&sql).map_err(err)?;
                let rows = q
                    .query_map(rusqlite::params_from_iter(&args), |r| {
                        let cell = DisplayCell {
                            level,
                            x: r.get(0)?,
                            y: r.get(1)?,
                            slab: r.get(2)?,
                            time_bin_minutes: minutes,
                            partition: partition.into(),
                            key: r.get(3)?,
                            viewport: viewport.map(|b| [b.west, b.south, b.east, b.north]),
                        };
                        let bounds = cell.bounds();
                        let count: usize = r.get(4)?;
                        Ok(Bin {
                            cell,
                            count,
                            selected_count: 0,
                            weight: r.get(5)?,
                            first_time: r.get(6)?,
                            last_time: r.get(7)?,
                            sample_id: r.get(8)?,
                            longitude: if count == 1 {
                                r.get(9)?
                            } else {
                                if level == 0 {
                                    let y: f64 = r.get(15)?;
                                    let x: f64 = r.get(16)?;
                                    y.atan2(x).to_degrees()
                                } else {
                                    r.get(14)?
                                }
                            },
                            latitude: if count == 1 { r.get(10)? } else { r.get(13)? },
                            event_bounds: [r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?],
                            bounds,
                        })
                    })
                    .map_err(err)?;
                bins = rows.collect::<Result<Vec<_>, _>>().map_err(err)?;
                if bins.len() <= limit {
                    let slabs: std::collections::BTreeSet<_> =
                        bins.iter().map(|b| b.cell.slab).collect();
                    if slabs.len() <= 32 {
                        break;
                    }
                    if minutes > 0 && minutes < 5_259_600_000 {
                        minutes = (minutes * 2).min(5_259_600_000);
                        continue;
                    }
                }
                if level > 0 {
                    level -= 1;
                } else if minutes > 0 && minutes < 5_259_600_000 {
                    minutes = (minutes * 2).min(5_259_600_000);
                } else {
                    return Err("RESOURCE_LIMIT: too many display partitions; choose All, a narrower time window or fewer sources/entities".into());
                }
            }
            if bins.iter().any(|b| !b.weight.is_finite()) {
                return Err("RESOURCE_LIMIT: display weight sum exceeds finite numeric range; choose count weighting".into());
            }
            let count = bins.iter().map(|b| b.count).sum();
            let bounds = bins.iter().map(|b| b.event_bounds).reduce(|a, b| {
                [
                    a[0].min(b[0]),
                    a[1].min(b[1]),
                    a[2].max(b[2]),
                    a[3].max(b[3]),
                ]
            });
            let p=Packet{bounds,bins,count,aggregated:count>2000,level,time_bin_minutes:minutes,cache_hit:false,revision:0,semantics:"Exact counts of matching located events in a hierarchical Web Mercator grid; edge rows include polar latitudes. UTC start-time slabs, half-open cells; +180 wraps to -180. Summaries are display positions, not measurements. Missing locations and non-point WKT are excluded. Value weights omit missing/negative values. No source records are removed.".into()};
            self.cache_summary(key, &serde_json::to_value(&p).map_err(err)?, false)?;
            p
        };
        if !self.previous_selection.borrow().is_empty() {
            // Candidate IDs are already indexed by selection. Adding an RTree
            // rowid IN here makes SQLite intersect id/rowid IN terms with a
            // nested product. Test exact point bounds after the unique-ID lookup.
            let mut selected_filter = filter.clone();
            selected_filter.bounds = None;
            selected_filter.selected_only = false;
            let (mut clause, mut args) = Self::where_sql(&selected_filter, None);
            for bounds in [filter.bounds.as_ref(), viewport].into_iter().flatten() {
                clause.push_str(if bounds.west <= bounds.east {
                    " AND e.lat>=? AND e.lat<=? AND e.lon>=? AND e.lon<=?"
                } else {
                    " AND e.lat>=? AND e.lat<=? AND (e.lon>=? OR e.lon<=?)"
                });
                args.extend(
                    [bounds.south, bounds.north, bounds.west, bounds.east].map(SqlValue::Real),
                );
            }
            let p = match partition {
                "entity" => "e.entity",
                "source" => "e.source",
                _ => "''",
            };
            let sql=format!("SELECT display_x(e.lon,{}),display_y(e.lat,{}),display_slab(e.time,{}),{p},COUNT(*) FROM selection selected CROSS JOIN events e INDEXED BY sqlite_autoindex_events_1 ON e.id=selected.id WHERE ({clause}) AND e.lat IS NOT NULL AND e.lon IS NOT NULL GROUP BY 1,2,3,4",packet.level,packet.level,packet.time_bin_minutes);
            let mut q = self.connection.prepare(&sql).map_err(err)?;
            let rows = q
                .query_map(rusqlite::params_from_iter(args), |r| {
                    Ok((
                        (
                            r.get::<_, u32>(0)?,
                            r.get::<_, u32>(1)?,
                            r.get::<_, i64>(2)?,
                            r.get::<_, String>(3)?,
                        ),
                        r.get::<_, usize>(4)?,
                    ))
                })
                .map_err(err)?;
            let counts = rows.collect::<Result<BTreeMap<_, _>, _>>().map_err(err)?;
            for b in &mut packet.bins {
                b.selected_count = counts
                    .get(&(b.cell.x, b.cell.y, b.cell.slab, b.cell.key.clone()))
                    .copied()
                    .unwrap_or(0);
            }
        }
        Ok(packet)
    }
}
