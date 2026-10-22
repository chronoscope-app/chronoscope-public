use super::*;
use crate::{
    model::Filter,
    store::{AnalyticsRead, DataStore},
};
use rusqlite::{
    params_from_iter,
    types::{Value as Sql, ValueRef},
};
use std::collections::{BTreeMap, BTreeSet};
pub struct Input {
    pub(crate) read: AnalyticsRead,
    pub fields: BTreeMap<String, String>,
    pub count: u64,
    pub input_count: u64,
}
pub fn needed(plan: &Plan) -> Vec<String> {
    let p = &plan.parameters;
    let mut v = vec![];
    if let Some(prep) = &plan.prepare {
        v.extend(prep.group_by.clone());
        v.extend(prep.metrics.iter().filter_map(|m| m.field.clone()));
    } else {
        for key in ["fields", "group_by"] {
            if let Some(a) = p[key].as_array() {
                v.extend(a.iter().filter_map(Value::as_str).map(str::to_owned));
            }
        }
        for key in [
            "field",
            "group_by",
            "target",
            "source_field",
            "target_field",
        ] {
            if let Some(s) = p[key].as_str() {
                v.push(s.into());
            }
        }
        match plan.capability.as_str() {
            "compare" | "time_series" | "periodicity" => v.push("time".into()),
            "trajectories" => v.extend(["entity", "time", "lat", "lon"].map(str::to_owned)),
            _ => {}
        }
        if matches!(plan.capability.as_str(), "group" | "compare") && p["field"].is_null() {
            v.push("value".into());
        }
    }
    v.sort();
    v.dedup();
    v
}
fn expression(c: &rusqlite::Connection, f: &str, args: &mut Vec<Sql>) -> Result<String, String> {
    if let Some(key) = f.strip_prefix("attribute:") {
        let exists: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM attributes WHERE key=?)",
                [key],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !exists {
            return Err(format!("INVALID_ARGUMENT: unknown attribute {key:?}; inspect_dataset or dataset_schema first"));
        }
        args.push(Sql::Text(key.into()));
        return Ok("(SELECT text FROM attributes a WHERE a.r=e.r AND a.key=?)".into());
    }
    Ok(match f {
        "time_utc" => "utc_time(e.time)".into(),
        "year_utc" => "utc_year(e.time)".into(),
        "tags" | "attrs" | "location_kind" => format!("json_extract(e.payload,'$.{f}')"),
        "id" | "entity" | "category" | "source" | "label" | "related_to" | "note" | "time"
        | "end" | "lat" | "lon" | "value" | "source_row" | "mgrs_precision" | "geometry_wkt" => {
            format!("e.{f}")
        }
        _ => {
            return Err(format!(
                "INVALID_ARGUMENT: unsupported field {f:?}; original columns use attribute:<name>"
            ))
        }
    })
}
pub fn value(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(n) => json!(n),
        ValueRef::Real(n) => json!(n),
        ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
        ValueRef::Blob(_) => Value::Null,
    }
}
impl Input {
    pub(crate) fn build(
        read: AnalyticsRead,
        filter: &Filter,
        source: Option<&str>,
        selection: &BTreeSet<u64>,
        plan: &Plan,
    ) -> Result<Self, String> {
        let c = &read.connection;
        super::functions::register(c).map_err(|e| e.to_string())?;
        c.create_scalar_function(
            "an_num",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| {
                Ok(match ctx.get_raw(0) {
                    ValueRef::Integer(n) => Some(n as f64),
                    ValueRef::Real(x) => x.is_finite().then_some(x),
                    ValueRef::Text(t) => std::str::from_utf8(t)
                        .ok()
                        .and_then(|s| s.trim().parse::<f64>().ok())
                        .filter(|n| n.is_finite()),
                    _ => None,
                })
            },
        )
        .map_err(|e| e.to_string())?;
        c.execute_batch("CREATE TEMP TABLE selection(id TEXT PRIMARY KEY); ")
            .map_err(|e| e.to_string())?;
        if filter.selected_only {
            let mut stmt = c
                .prepare("INSERT INTO selection VALUES(?)")
                .map_err(|e| e.to_string())?;
            for (i, id) in selection.iter().enumerate() {
                if i % 1024 == 0 {
                    crate::operation::check()?;
                }
                stmt.execute([id.to_string()]).map_err(|e| e.to_string())?;
            }
        }
        let fields = needed(plan);
        if fields.len() > 32 {
            return Err("RESOURCE_LIMIT: at most 32 projected fields per analysis".into());
        }
        let mut args = vec![];
        let mut columns = vec!["e.id AS event_id".to_string()];
        let mut map = BTreeMap::new();
        for (i, f) in fields.iter().enumerate() {
            let column = format!("c{i}");
            columns.push(format!("{} AS {column}", expression(c, f, &mut args)?));
            map.insert(f.clone(), column);
        }
        let (clause, where_args) = DataStore::where_sql(filter, source);
        args.extend(where_args);
        crate::operation::progress(0, None, "Reading scoped analytic columns");
        c.execute(&format!("CREATE TEMP TABLE analytic_input AS SELECT {} FROM events e WHERE {clause} ORDER BY e.r",columns.join(",")),params_from_iter(args)).map_err(|e|format!("RESOURCE_LIMIT: analytics input staging failed: {e}"))?;
        let input_count = c
            .query_row("SELECT count(*) FROM analytic_input", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if let Some(prep) = &plan.prepare {
            let mut columns = vec!["NULL AS event_id".into()];
            let mut group = vec![];
            let mut next = BTreeMap::new();
            for f in &prep.group_by {
                let col = format!("c{}", next.len());
                let old = map.get(f).ok_or("Unknown preparation group")?;
                columns.push(format!("{old} AS {col}"));
                group.push(old.clone());
                next.insert(f.clone(), col);
            }
            for m in &prep.metrics {
                let expr = if m.op == "count" {
                    "count(*)".into()
                } else {
                    let f = map
                        .get(m.field.as_ref().unwrap())
                        .ok_or("Unknown metric field")?;
                    super::functions::aggregate_sql(&m.op, &format!("an_num({f})"))
                };
                let col = format!("c{}", next.len());
                columns.push(format!("{expr} AS {col}"));
                next.insert(m.alias.clone(), col);
            }
            c.execute_batch(&format!("CREATE TEMP TABLE analytic_prepared AS SELECT {} FROM analytic_input GROUP BY {}; DROP TABLE analytic_input; ALTER TABLE analytic_prepared RENAME TO analytic_input;",columns.join(","),group.join(","))).map_err(|e|e.to_string())?;
            map = next;
        }
        let count = c
            .query_row("SELECT count(*) FROM analytic_input", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok(Self {
            read,
            fields: map,
            count,
            input_count,
        })
    }
    pub fn c(&self) -> &rusqlite::Connection {
        &self.read.connection
    }
    pub fn col(&self, field: &str) -> Result<&str, String> {
        self.fields.get(field).map(String::as_str).ok_or_else(|| {
            format!("INVALID_ARGUMENT: field {field:?} is not available after preparation")
        })
    }
    pub fn num(&self, field: &str) -> Result<String, String> {
        if matches!(
            field,
            "id" | "entity" | "source" | "category" | "source_row"
        ) {
            return Err(
                "INVALID_ARGUMENT: identifiers/categories are not numeric measurements".into(),
            );
        }
        Ok(format!("an_num({})", self.col(field)?))
    }
    pub fn rows(&self, sql: &str, args: Vec<Sql>, limit: usize) -> Result<Vec<Value>, String> {
        let mut q = self.c().prepare(sql).map_err(|e| e.to_string())?;
        let names: Vec<_> = q.column_names().into_iter().map(str::to_owned).collect();
        let mut rows = q.query(params_from_iter(args)).map_err(|e| e.to_string())?;
        let mut out = vec![];
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            crate::operation::check()?;
            if out.len() >= limit {
                break;
            }
            let mut object = serde_json::Map::new();
            for (i, name) in names.iter().enumerate() {
                let raw = row.get_ref(i).map_err(|e| e.to_string())?;
                if matches!(raw, ValueRef::Real(n) if !n.is_finite()) {
                    return Err(
                        "RESOURCE_LIMIT: non-finite aggregate; rescale numeric inputs".into(),
                    );
                }
                object.insert(name.clone(), value(raw));
            }
            out.push(Value::Object(object));
        }
        Ok(out)
    }
    pub fn scalar(&self, sql: &str) -> Result<u64, String> {
        self.c()
            .query_row(sql, [], |r| r.get(0))
            .map_err(|e| e.to_string())
    }
    pub fn floats(
        &self,
        field: &str,
    ) -> Result<(average::Variance, accurate::sum::Neumaier<f64>), String> {
        use accurate::traits::SumAccumulator;
        use average::Estimate;
        let mut moments = average::Variance::new();
        let mut sum = accurate::sum::Neumaier::zero();
        let mut q = self
            .c()
            .prepare(&format!(
                "SELECT {} FROM analytic_input WHERE {} IS NOT NULL ORDER BY rowid",
                self.num(field)?,
                self.num(field)?
            ))
            .map_err(|e| e.to_string())?;
        let mut rows = q.query([]).map_err(|e| e.to_string())?;
        while let Some(r) = rows.next().map_err(|e| e.to_string())? {
            crate::operation::check()?;
            let x: f64 = r.get(0).map_err(|e| e.to_string())?;
            moments.add(x);
            sum += x;
        }
        if !moments.is_empty()
            && (!moments.population_variance().is_finite() || !sum.sum().is_finite())
        {
            return Err("RESOURCE_LIMIT: statistics numeric range; rescale fields".into());
        }
        Ok((moments, sum))
    }
    pub fn quantile(&self, field: &str, p: f64) -> Result<Option<f64>, String> {
        let num = self.num(field)?;
        let n = self.scalar(&format!("SELECT count({num}) FROM analytic_input"))?;
        if n == 0 {
            return Ok(None);
        }
        let rank = super::functions::quantile_rank(n, p);
        let lo = rank.floor() as u64;
        let frac = rank - lo as f64;
        let mut q=self.c().prepare(&format!("SELECT {num} FROM analytic_input WHERE {num} IS NOT NULL ORDER BY {num},rowid LIMIT 2 OFFSET ?")).map_err(|e|e.to_string())?;
        let a: Vec<f64> = q
            .query_map([lo], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        let x = self
            .c()
            .query_row(
                "SELECT an_quantile(?1,?2,?3)",
                rusqlite::params![a[0], a.get(1).copied(), frac],
                |r| r.get::<_, f64>(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(Some(x))
    }
}
