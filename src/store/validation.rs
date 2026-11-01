//! Validate authoritative rows and all derived structures with bounded streaming cursors.
use super::*;
use std::fmt::Write as _;

// Borrow only for the current row, preserving strict TEXT/UTF-8 checks.
fn text<'a>(row: &'a rusqlite::Row<'_>, column: usize) -> Result<&'a str, String> {
    row.get_ref(column).map_err(err)?.as_str().map_err(err)
}

fn search_matches(event: &Event, indexed: &str, buffer: &mut String) -> bool {
    // Keep the canonical search_text field order; the differential test below
    // checks this allocation-saving comparison against that encoder.
    buffer.clear();
    for (index, part) in [
        event.entity.as_str(),
        &event.category,
        &event.label,
        &event.related_to,
        &event.note,
    ]
    .into_iter()
    .chain(event.attrs.values().map(String::as_str))
    .chain(event.tags.iter().map(String::as_str))
    .enumerate()
    {
        if index != 0 {
            buffer.push('\n');
        }
        buffer.push_str(part);
    }
    if buffer.is_ascii() {
        buffer.make_ascii_lowercase();
        buffer == indexed
    } else {
        // Keep String's contextual Unicode lowercasing (including final sigma).
        buffer.to_lowercase() == indexed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reused_search_buffer_matches_canonical_encoder_across_text_boundaries() {
        let mut buffer = String::new();
        for value in ["ASCII", "", "ΣΟΣ", "İ", "🚀", "a\0B", "line\nbreak", ","] {
            let mut event = crate::demo::dataset().events.remove(0);
            event.entity = format!("Entity {value}");
            event.category = value.into();
            event.label = value.into();
            event.note = value.into();
            event.related_to = value.into();
            event.attrs.insert("proof".into(), value.into());
            event.tags.insert(value.into());
            let canonical = search_text(&event);
            assert!(search_matches(&event, &canonical, &mut buffer));
            assert!(!search_matches(&event, &(canonical + "x"), &mut buffer));
        }
    }
}

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
        let mut profile = OpenProfile::new();
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
        let mut search_buffer = String::new();
        let mut id_buffer = String::with_capacity(20);
        let mut key_buffer = String::with_capacity(20);
        let mut tags_buffer = String::new();
        while let Some(row) = rows.next().map_err(err)? {
            let event = decode_event(text(row, 0)?)?;
            crate::operation::check()?;
            let r: i64 = row.get(19).map_err(err)?;
            for (key, text) in &event.attrs {
                let attribute = attributes
                    .next()
                    .map_err(err)?
                    .ok_or("Missing event attribute index")?;
                let number = text.trim().parse::<f64>().ok().filter(|v| v.is_finite());
                if attribute.get::<_, i64>(0).map_err(err)? != r
                    || self::text(attribute, 1)? != key
                    || self::text(attribute, 2)? != text
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
                || !search_matches(&event, text(indexed, 1)?, &mut search_buffer)
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

            id_buffer.clear();
            key_buffer.clear();
            tags_buffer.clear();
            write!(&mut id_buffer, "{}", event.id).map_err(err)?;
            write!(&mut key_buffer, "{:020}", event.id).map_err(err)?;
            for (index, tag) in event.tags.iter().enumerate() {
                if index != 0 {
                    tags_buffer.push(',');
                }
                tags_buffer.push_str(tag);
            }
            if id_buffer != text(row, 1)?
                || event.entity != text(row, 2)?
                || event.time != row.get::<_, f64>(3).map_err(err)?
                || event.end.unwrap_or(event.time) != row.get::<_, f64>(4).map_err(err)?
                || event.lat != row.get::<_, Option<f64>>(5).map_err(err)?
                || event.lon != row.get::<_, Option<f64>>(6).map_err(err)?
                || event.end != row.get::<_, Option<f64>>(7).map_err(err)?
                || event.category != text(row, 8)?
                || event.label != text(row, 9)?
                || event.value != row.get::<_, Option<f64>>(10).map_err(err)?
                || event.related_to != text(row, 11)?
                || event.source != text(row, 12)?
                || event.source_row as i64 != row.get::<_, i64>(13).map_err(err)?
                || event.mgrs_precision != row.get::<_, Option<u8>>(14).map_err(err)?
                || tags_buffer != text(row, 15)?
                || event.note != text(row, 16)?
                || event.geometry_wkt.as_deref()
                    != row
                        .get_ref(18)
                        .map_err(err)?
                        .as_str_or_null()
                        .map_err(err)?
                || key_buffer != text(row, 17)?
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
        profile.lap("event_and_derived_row_validation");
        self.connection
            .execute("INSERT INTO search(search) VALUES('integrity-check')", [])
            .map_err(err)?;
        profile.lap("fts_integrity_check");
        Ok(())
    }
}
