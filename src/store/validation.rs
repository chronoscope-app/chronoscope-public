//! Validate authoritative rows and all derived structures with bounded streaming cursors.
use super::*;

pub(super) fn index_definitions(
    connection: &Connection,
) -> Result<BTreeMap<String, String>, String> {
    let mut q=connection.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").map_err(err)?;
    let rows = q
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" "),
            ))
        })
        .map_err(err)?;
    rows.collect::<Result<BTreeMap<_, _>, _>>().map_err(err)
}
impl DataStore {
    pub(super) fn verify_events(&self) -> Result<(), String> {
        if self.count()? > 50_000_000 {
            return Err("Workspace exceeds the 50 million event budget".into());
        }
        let mut q = self
            .connection
            .prepare("SELECT payload,id,entity,time,t_end,lat,lon,end,category,label,value,related_to,source,source_row,mgrs_precision,tags,note,id_key,geometry_wkt,r FROM events ORDER BY r")
            .map_err(err)?;
        let mut rows = q.query([]).map_err(err)?;
        let mut aq = self
            .connection
            .prepare("SELECT r,key,text,num FROM attributes ORDER BY r,key")
            .map_err(err)?;
        let mut attributes = aq.query([]).map_err(err)?;
        let mut fq = self
            .connection
            .prepare("SELECT rowid,text FROM search ORDER BY rowid")
            .map_err(err)?;
        let mut search = fq.query([]).map_err(err)?;
        let mut sq = self
            .connection
            .prepare("SELECT r,lat_min,lat_max,lon_min,lon_max FROM spatial ORDER BY r")
            .map_err(err)?;
        let mut spatial = sq.query([]).map_err(err)?;
        while let Some(row) = rows.next().map_err(err)? {
            let payload: String = row.get(0).map_err(err)?;
            let event = decode_event(&payload)?;
            crate::operation::check()?;
            let r: i64 = row.get(19).map_err(err)?;
            for (key, text) in &event.attrs {
                let attribute = attributes
                    .next()
                    .map_err(err)?
                    .ok_or("Missing event attribute index")?;
                let number = text.trim().parse::<f64>().ok().filter(|v| v.is_finite());
                if attribute.get::<_, i64>(0).map_err(err)? != r
                    || attribute.get::<_, String>(1).map_err(err)? != *key
                    || attribute.get::<_, String>(2).map_err(err)? != *text
                    || attribute.get::<_, Option<f64>>(3).map_err(err)? != number
                {
                    return Err("Event attributes do not match their derived index".into());
                }
            }
            let indexed = search
                .next()
                .map_err(err)?
                .ok_or("Missing event search index")?;
            if indexed.get::<_, i64>(0).map_err(err)? != r
                || indexed.get::<_, String>(1).map_err(err)? != search_text(&event)
            {
                return Err("Event text does not match its search index".into());
            }
            let footprint = if let Some(text) = event.geometry_wkt.as_ref() {
                crate::geometry::parse(text)?.bounds
            } else {
                event.location().map(|(lat, lon)| [lon, lat, lon, lat])
            };
            if let Some([west, south, east, north]) = footprint {
                let indexed = spatial
                    .next()
                    .map_err(err)?
                    .ok_or("Missing event spatial index")?;
                if indexed.get::<_, i64>(0).map_err(err)? != r {
                    return Err("Event spatial index identity mismatch".into());
                }
                for (column, expected, lower) in [
                    (1, south, true),
                    (2, north, false),
                    (3, west, true),
                    (4, east, false),
                ] {
                    let actual: f64 = indexed.get(column).map_err(err)?;
                    // SQLite RTree bounds are outward-rounded Float32. Exact
                    // predicates still use Float64 event coordinates.
                    if !actual.is_finite()
                        || (actual - expected).abs() > expected.abs().max(1.) * 3e-7
                        || lower && actual > expected
                        || !lower && actual < expected
                    {
                        return Err("Event geometry does not match its spatial index".into());
                    }
                }
            }

            if event.id.to_string() != row.get::<_, String>(1).map_err(err)?
                || event.entity != row.get::<_, String>(2).map_err(err)?
                || event.time != row.get::<_, f64>(3).map_err(err)?
                || event.end.unwrap_or(event.time) != row.get::<_, f64>(4).map_err(err)?
                || event.lat != row.get::<_, Option<f64>>(5).map_err(err)?
                || event.lon != row.get::<_, Option<f64>>(6).map_err(err)?
                || event.end != row.get::<_, Option<f64>>(7).map_err(err)?
                || event.category != row.get::<_, String>(8).map_err(err)?
                || event.label != row.get::<_, String>(9).map_err(err)?
                || event.value != row.get::<_, Option<f64>>(10).map_err(err)?
                || event.related_to != row.get::<_, String>(11).map_err(err)?
                || event.source != row.get::<_, String>(12).map_err(err)?
                || event.source_row as i64 != row.get::<_, i64>(13).map_err(err)?
                || event.mgrs_precision != row.get::<_, Option<u8>>(14).map_err(err)?
                || event.tags.iter().cloned().collect::<Vec<_>>().join(",")
                    != row.get::<_, String>(15).map_err(err)?
                || event.note != row.get::<_, String>(16).map_err(err)?
                || event.geometry_wkt != row.get::<_, Option<String>>(18).map_err(err)?
                || format!("{:020}", event.id) != row.get::<_, String>(17).map_err(err)?
            {
                return Err("Event payload does not match its canonical indexes".into());
            }
        }
        if attributes.next().map_err(err)?.is_some()
            || search.next().map_err(err)?.is_some()
            || spatial.next().map_err(err)?.is_some()
        {
            return Err("Unlisted rows in event derived indexes".into());
        }
        self.connection
            .execute("INSERT INTO search(search) VALUES('integrity-check')", [])
            .map_err(err)?;
        Ok(())
    }
}
