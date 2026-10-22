//! Read-only, disk-backed chart projections. Exact calculations; bounded marks.
use crate::analytics::{functions, Input, Plan};
use rusqlite::{params, types::Value as Sql};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
mod time_views;
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub kind: String,
    pub scope: String,
    pub source: Option<String>,
    pub x: String,
    pub y: String,
    pub group: String,
    pub aggregate: String,
    pub x_axis: String,
    pub time_bucket: String,
    pub stacked: bool,
    pub y2: String,
    pub trendline: bool,
    pub bins: u32,
    pub limit: usize,
    /// Presentation only; never interpreted as fields or calculation inputs.
    pub title: String,
    pub x_label: String,
    pub y_label: String,
    pub y2_label: String,
    /// UTC Unix seconds, start inclusive and end exclusive. Both null means
    /// split the scoped time extent into two adjacent, equal-duration periods.
    pub period_a: Option<[f64; 2]>,
    pub period_b: Option<[f64; 2]>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            kind: "bar".into(),
            scope: "visible".into(),
            source: None,
            x: "entity".into(),
            y: "value".into(),
            group: String::new(),
            aggregate: "count".into(),
            x_axis: "category".into(),
            time_bucket: "day".into(),
            stacked: false,
            y2: String::new(),
            trendline: false,
            bins: 20,
            limit: 2000,
            title: String::new(),
            x_label: String::new(),
            y_label: String::new(),
            y2_label: String::new(),
            period_a: None,
            period_b: None,
        }
    }
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if ![
            "bar",
            "line",
            "area",
            "scatter",
            "histogram",
            "boxplot",
            "heatmap",
            "period",
        ]
        .contains(&self.kind.as_str())
            || !["all", "visible", "selected"].contains(&self.scope.as_str())
            || !["count", "sum", "mean", "min", "max"].contains(&self.aggregate.as_str())
            || !["category", "number", "time"].contains(&self.x_axis.as_str())
            || ![
                "none",
                "millisecond",
                "second",
                "minute",
                "hour",
                "day",
                "week",
                "month",
                "year",
            ]
            .contains(&self.time_bucket.as_str())
            || !(2..=100).contains(&self.bins)
            || !(1..=10000).contains(&self.limit)
            || [&self.x, &self.y, &self.group, &self.y2]
                .iter()
                .any(|s| s.len() > 8192)
            || self.source.as_ref().is_some_and(|s| s.len() > 8192)
            || self.x.is_empty()
            || self.y.is_empty()
            || [&self.title, &self.x_label, &self.y_label, &self.y2_label]
                .iter()
                .any(|s| s.chars().count() > 256)
            || self.x_axis == "time" && !["time", "end"].contains(&self.x.as_str())
            || self.trendline && self.kind != "scatter"
            || !self.y2.is_empty() && !["bar", "line", "area"].contains(&self.kind.as_str())
            || ["heatmap", "period"].contains(&self.kind.as_str())
                && (!self.group.is_empty() || self.stacked)
            || self.kind == "heatmap"
                && (!matches!(self.x.as_str(), "time" | "end") || self.x_axis != "time")
            || self.kind == "period" && (self.x_axis != "category" || self.limit < 2)
        {
            return Err("INVALID_ARGUMENT: unsupported chart configuration".into());
        }
        time_views::validate_periods(self)?;
        Ok(())
    }
    pub fn plan(&self) -> Plan {
        let mut fields = vec![self.y.clone()];
        if self.kind != "histogram" {
            fields.push(self.x.clone());
        }
        if !self.y2.is_empty() {
            fields.push(self.y2.clone());
        }
        if !self.group.is_empty() {
            fields.push(self.group.clone());
        }
        if self.kind == "period" {
            fields.push("time".into());
        }
        fields.sort();
        fields.dedup();
        Plan {
            capability: "profile".into(),
            scope: self.scope.clone(),
            parameters: json!({"fields":fields}),
            prepare: None,
            output_limit: self.limit,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Preset {
    pub name: String,
    pub config: Config,
}
#[derive(Serialize, JsonSchema)]
pub struct Report {
    pub revision: u64,
    pub config: Config,
    pub input_count: u64,
    pub evaluated_count: u64,
    pub excluded_count: u64,
    /// Scoped Events outside both comparison windows; separate from bad values.
    pub outside_period_count: u64,
    pub total_marks: u64,
    pub limited: bool,
    pub rows: Vec<Value>,
    pub trend: Option<Value>,
    pub warnings: Vec<String>,
    pub value_metadata: Option<ValueMetadata>,
    pub value_extent: Option<[f64; 2]>,
}
#[derive(Serialize, JsonSchema)]
pub struct ValueMetadata {
    pub unit: Option<String>,
    pub description: Option<String>,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn sqlvalue(v: &Value) -> Result<Sql, String> {
    Ok(match v {
        Value::Null => Sql::Null,
        // Source category labels can exceed ordinary command-string limits.
        // Accept every key that can fit in the bounded chart response.
        Value::String(s) if s.len() <= 2 * 1024 * 1024 => Sql::Text(s.clone()),
        Value::Number(n) => Sql::Real(n.as_f64().ok_or("Invalid chart number")?),
        _ => return Err("INVALID_ARGUMENT: chart keys must be scalar".into()),
    })
}
fn prepare(i: &Input, c: &Config) -> Result<(), String> {
    i.c()
        .create_scalar_function(
            "chart_floor",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |v| Ok(v.get::<Option<f64>>(0)?.map(f64::floor)),
        )
        .map_err(err)?;
    let v = if c.aggregate == "count"
        && !["scatter", "histogram", "boxplot"].contains(&c.kind.as_str())
    {
        "NULL".into()
    } else {
        i.num(&c.y)?
    };
    let v2 = if c.y2.is_empty() {
        "NULL".into()
    } else {
        i.num(&c.y2)?
    };
    let g = if c.kind == "heatmap" {
        // Floor before calendar conversion: SQLite strftime rounds fractions
        // near a second/day boundary. Euclidean arithmetic also handles dates
        // before the Unix epoch without a local-time or DST dependency.
        format!(
            "((CAST(chart_floor(chart_floor({})/86400.0) AS INTEGER)+3)%7+7)%7",
            i.num(&c.x)?
        )
    } else if c.group.is_empty() {
        "NULL".into()
    } else {
        i.col(&c.group)?.to_string()
    };
    let mut x = if c.kind == "histogram" {
        "NULL".into()
    } else if c.kind == "scatter" || c.x_axis != "category" {
        i.num(&c.x)?
    } else {
        i.col(&c.x)?.to_owned()
    };
    if c.kind == "heatmap" {
        x = format!("((CAST(chart_floor(chart_floor({x})/3600.0) AS INTEGER)%24)+24)%24");
    } else if c.x_axis == "time" && c.kind != "histogram" {
        x = format!("an_bucket({x},'{}')", c.time_bucket);
    }
    if c.kind == "period" {
        time_views::prepare_period(i, c, &x, &v)?;
    } else {
        i.c().execute_batch(&format!("CREATE TEMP TABLE chart_input AS SELECT event_id,{x} AS x,{g} AS g,{v} AS v,{v2} AS v2 FROM analytic_input;")).map_err(err)?;
    }
    i.c()
        .execute_batch("CREATE INDEX chart_xy ON chart_input(x,g,v);")
        .map_err(err)?;
    if c.kind == "histogram" {
        let (min, max): (Option<f64>, Option<f64>) = i
            .c()
            .query_row("SELECT min(v),max(v) FROM chart_input", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .map_err(err)?;
        let lo = min.unwrap_or(0.);
        let hi = max.unwrap_or(lo);
        let width = functions::histogram_width(lo, hi, c.bins)?;
        // A constant-value chart retains its existing one-unit display range.
        let width = if width == 0. { 1. } else { width };
        i.c()
            .execute_batch("CREATE TEMP TABLE chart_bins(lo REAL,width REAL); ")
            .map_err(err)?;
        i.c()
            .execute("INSERT INTO chart_bins VALUES(?,?)", params![lo, width])
            .map_err(err)?;
        i.c()
            .execute(
                "UPDATE chart_input SET x=an_hist_bin(v,?,?,?) WHERE v IS NOT NULL",
                params![lo, width, c.bins],
            )
            .map_err(err)?;
    }
    Ok(())
}
fn valid(c: &Config) -> String {
    let base = if c.kind == "scatter" {
        "x IS NOT NULL AND v IS NOT NULL"
    } else if ["histogram", "boxplot"].contains(&c.kind.as_str()) {
        "v IS NOT NULL"
    } else if c.aggregate == "count" {
        "1"
    } else if !c.y2.is_empty() {
        "v IS NOT NULL OR v2 IS NOT NULL"
    } else {
        "v IS NOT NULL"
    };
    if c.kind != "histogram" && c.x_axis != "category" {
        format!("({base}) AND x IS NOT NULL")
    } else {
        base.into()
    }
}
fn eligible(c: &Config) -> String {
    format!("({}) AND ({} OR g IN (SELECT g FROM chart_groups) OR (g IS NULL AND EXISTS(SELECT 1 FROM chart_groups WHERE g IS NULL)))",valid(c),if c.group.is_empty(){"1"}else{"0"})
}
pub fn report(i: &Input, mut c: Config, revision: u64) -> Result<Report, String> {
    c.validate()?;
    time_views::resolve_periods(i, &mut c)?;
    prepare(i, &c)?;
    let valid = valid(&c);
    let count = i.scalar(&format!("SELECT count(*) FROM chart_input WHERE {valid}"))?;
    // These are explicit source declarations, never units guessed from values
    // or a sample. Require one nonblank value on every record in this scope.
    let uniform = |field: &str| -> Result<Option<String>, String> {
        let Some(col) = i.fields.get(field) else {
            return Ok(None);
        };
        let (n, distinct, value): (u64, u64, Option<String>) = i.c().query_row(
            &format!("SELECT count(NULLIF(trim({col}),'')),count(DISTINCT {col}),min({col}) FROM analytic_input"),
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).map_err(err)?;
        Ok(value.filter(|v| n == i.count && n > 0 && distinct == 1 && v.chars().count() <= 256))
    };
    let unit = uniform("attribute:value_unit")?;
    let description = uniform("attribute:value_description")?;
    let incomplete_units =
        i.count > 0 && i.fields.contains_key("attribute:value_unit") && unit.is_none();
    let value_metadata =
        (unit.is_some() || description.is_some()).then_some(ValueMetadata { unit, description });
    let (min, max): (Option<f64>, Option<f64>) = i
        .c()
        .query_row("SELECT min(v),max(v) FROM chart_input", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(err)?;
    let value_extent = min.zip(max).map(|(lo, hi)| [lo, hi]);
    i.c().execute_batch(&format!("CREATE TEMP TABLE chart_groups AS SELECT g FROM chart_input WHERE {valid} GROUP BY g ORDER BY count(*) DESC,g LIMIT 32")).map_err(err)?;
    let predicate = eligible(&c);
    let key = if c.kind == "scatter" { "x,g,v" } else { "x,g" };
    let total = if c.kind == "heatmap" {
        if count > 0 {
            168
        } else {
            0
        }
    } else if c.kind == "period" {
        2 * i.scalar(&format!(
            "SELECT count(*) FROM (SELECT x FROM chart_input WHERE {valid} GROUP BY x)"
        ))?
    } else {
        i.scalar(&format!(
            "SELECT count(*) FROM (SELECT 1 FROM chart_input WHERE {valid} GROUP BY {key})"
        ))?
    };
    let outside_period_count = if c.kind == "period" {
        i.input_count - i.scalar("SELECT count(*) FROM chart_input")?
    } else {
        0
    };
    let mut warnings = vec![];
    time_views::period_warnings(&c, &mut warnings);
    if incomplete_units {
        warnings.push("Source Value units could not be applied uniformly across this scope. No unit conversion is performed; check the source declarations or filter to consistent measurements before interpreting statistics.".into());
    }
    let mut rows = if c.kind == "heatmap" {
        time_views::heatmap_rows(i, &c, &valid, count)?
    } else if c.kind == "period" {
        time_views::period_rows(i, &c, &valid)?
    } else if c.kind == "scatter" {
        i.rows(&format!("SELECT x,g AS series,v AS y,count(*) AS count FROM chart_input WHERE {predicate} GROUP BY x,g,v ORDER BY x,g,v LIMIT ?"),vec![Sql::Integer(c.limit as i64)],c.limit)?
    } else if c.kind == "histogram" {
        let mut rows=i.rows(&format!("SELECT x,g AS series,count(*) AS y,count(*) AS count FROM chart_input WHERE {predicate} GROUP BY x,g ORDER BY x,g LIMIT ?"),vec![Sql::Integer(c.limit as i64)],c.limit)?;
        let (lo, width): (f64, f64) = i
            .c()
            .query_row("SELECT lo,width FROM chart_bins", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .map_err(err)?;
        for row in &mut rows {
            let bin = row["x"].as_f64().unwrap_or(0.);
            row["range"] = json!([lo + bin * width, lo + (bin + 1.) * width]);
        }
        rows
    } else if c.kind == "boxplot" {
        i.c().execute_batch(&format!("CREATE TEMP TABLE chart_ranked AS SELECT x,g,v,row_number() OVER(PARTITION BY x,g ORDER BY v) AS rn,count(*) OVER(PARTITION BY x,g) AS n FROM chart_input WHERE {predicate};CREATE INDEX chart_rank ON chart_ranked(x,g,rn);")).map_err(err)?;
        let mut columns = vec![];
        for (name, p) in [("q1", 0.25), ("median", 0.5), ("q3", 0.75)] {
            let rank = format!("an_quantile_rank(n,{p})");
            let lower = format!("CAST({rank} AS INTEGER)");
            columns.push(format!("an_quantile(max(CASE WHEN rn={lower}+1 THEN v END),max(CASE WHEN rn={lower}+2 THEN v END),{rank}-{lower}) AS {name}"));
        }
        let mut rows=i.rows(&format!("SELECT x,g AS series,n AS count,{} FROM chart_ranked GROUP BY x,g ORDER BY x,g LIMIT ?",columns.join(",")),vec![Sql::Integer(c.limit as i64)],c.limit)?;
        let mut remaining = 1000;
        for row in &mut rows {
            let q1 = row["q1"].as_f64().ok_or("Invalid quartile")?;
            let q3 = row["q3"].as_f64().ok_or("Invalid quartile")?;
            let med = row["median"].as_f64().ok_or("Invalid median")?;
            let a = q1 - 1.5 * (q3 - q1);
            let b = q3 + 1.5 * (q3 - q1);
            if !a.is_finite() || !b.is_finite() {
                return Err("RESOURCE_LIMIT: boxplot numeric range".into());
            }
            let x = sqlvalue(&row["x"])?;
            let g = sqlvalue(&row["series"])?;
            let (lo,hi):(f64,f64)=i.c().query_row("SELECT min(v),max(v) FROM chart_input WHERE x IS ? AND g IS ? AND v>=? AND v<=?",params![x,g,a,b],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
            row["box"] = json!([lo, q1, med, q3, hi]);
            let out=i.rows("SELECT v AS value FROM chart_input WHERE x IS ? AND g IS ? AND (v<? OR v>?) GROUP BY v ORDER BY v LIMIT ?",vec![x,g,Sql::Real(lo),Sql::Real(hi),Sql::Integer(remaining+1)],(remaining+1) as usize)?;
            if out.len() > remaining as usize {
                warnings.push(
                    "Outlier marks are capped at 1,000; box statistics use all matching records."
                        .into(),
                );
            }
            let values: Vec<_> = out
                .into_iter()
                .take(remaining as usize)
                .map(|v| v["value"].clone())
                .collect();
            remaining -= values.len() as i64;
            row["outliers"] = json!(values);
        }
        rows
    } else {
        let op = functions::aggregate_sql(&c.aggregate, "v");
        let op2 = if c.aggregate == "count" {
            "count(v2)".into()
        } else {
            functions::aggregate_sql(&c.aggregate, "v2")
        };
        i.rows(&format!("SELECT x,g AS series,{op} AS y,{op2} AS y2,count(*) AS count FROM chart_input WHERE {predicate} GROUP BY x,g ORDER BY x,g LIMIT ?"),vec![Sql::Integer(c.limit as i64)],c.limit)?
    };
    let mut bytes = 0;
    let mut retained = 0;
    for row in &rows {
        bytes += row.to_string().len();
        if bytes > 2 * 1024 * 1024 {
            warnings.push("Chart labels reached the 2 MiB response budget; narrow the grouping or use shorter labels.".into());
            break;
        }
        retained += 1;
    }
    if c.kind == "period" {
        retained -= retained % 2;
    }
    rows.truncate(retained);
    for row in &mut rows {
        if c.y2.is_empty() {
            row.as_object_mut().unwrap().remove("y2");
        }
    }
    let trend = if c.trendline {
        use average::Covariance;
        let mut covariance = Covariance::new();
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;
        let mut q = i
            .c()
            .prepare(
                "SELECT x,v FROM chart_input WHERE x IS NOT NULL AND v IS NOT NULL ORDER BY rowid",
            )
            .map_err(err)?;
        let mut r = q.query([]).map_err(err)?;
        while let Some(row) = r.next().map_err(err)? {
            crate::operation::check()?;
            let x: f64 = row.get(0).map_err(err)?;
            let y: f64 = row.get(1).map_err(err)?;
            covariance.add(x, y);
            min = min.min(x);
            max = max.max(x);
        }
        if covariance.len() > 1 && covariance.population_variance_x() > 0. {
            let slope = covariance.population_covariance() / covariance.population_variance_x();
            let intercept = covariance.mean_y() - slope * covariance.mean_x();
            if !slope.is_finite() || !intercept.is_finite() {
                return Err("RESOURCE_LIMIT: trendline numeric range; rescale fields".into());
            }
            let denominator = (covariance.population_variance_x() * covariance.len() as f64)
                * (covariance.population_variance_y() * covariance.len() as f64);
            if covariance.population_variance_y() > 0.
                && (!denominator.is_finite() || denominator == 0.)
            {
                return Err("RESOURCE_LIMIT: trendline numeric range; rescale fields".into());
            }
            let r = if covariance.population_variance_y() > 0. {
                covariance.pearson()
            } else {
                f64::NAN
            };
            Some(
                json!({"slope":slope,"intercept":intercept,"r_squared":if r.is_finite(){Some((r*r).clamp(0.,1.))}else{None},"count":covariance.len(),"min_x":min,"max_x":max,"method":"ordinary least squares; all complete pairs; descriptive association, not causation"}),
            )
        } else {
            warnings.push(
                "A trendline requires at least two complete pairs with different X values.".into(),
            );
            None
        }
    } else {
        None
    };
    if total > rows.len() as u64 {
        warnings.push(format!("Displayed marks are bounded{}. Calculations and matching record selection remain exact; narrow fields or filters for more detail.", if c.group.is_empty() { "" } else { " (up to 32 series groups)" }));
    }
    warnings.sort();
    warnings.dedup();
    Ok(Report {
        revision,
        config: c,
        input_count: i.input_count,
        evaluated_count: count,
        excluded_count: i.input_count - outside_period_count - count,
        outside_period_count,
        total_marks: total,
        limited: total > rows.len() as u64,
        rows,
        trend,
        warnings,
        value_metadata,
        value_extent,
    })
}
pub fn members(i: &Input, c: &Config, marks: &[Value]) -> Result<BTreeSet<u64>, String> {
    c.validate()?;
    let mut c = c.clone();
    time_views::resolve_periods(i, &mut c)?;
    let c = &c;
    prepare(i, c)?;
    i.c()
        .execute_batch("CREATE TEMP TABLE chart_marks(x,g,v,axis INTEGER);")
        .map_err(err)?;
    {
        let mut q = i
            .c()
            .prepare("INSERT INTO chart_marks VALUES(?,?,?,?)")
            .map_err(err)?;
        for m in marks {
            q.execute(params![
                sqlvalue(&m["x"])?,
                sqlvalue(&m["series"])?,
                sqlvalue(&m["value"])?,
                m["axis"].as_i64().unwrap_or(0)
            ])
            .map_err(err)?;
        }
    }
    // Evidence selection may contain two marks for each of 10,000 rows.
    // Probe keys instead of scanning every requested mark for every Event.
    i.c()
        .execute_batch("CREATE INDEX chart_mark_keys ON chart_marks(x,g,v,axis);")
        .map_err(err)?;
    let axis = if c.aggregate == "count"
        && !["scatter", "histogram", "boxplot"].contains(&c.kind.as_str())
    {
        "(m.axis=0 OR ci.v2 IS NOT NULL)"
    } else {
        "((m.axis=0 AND ci.v IS NOT NULL) OR (m.axis=1 AND ci.v2 IS NOT NULL))"
    };
    let extra = if c.kind == "scatter" {
        "AND m.v IS ci.v"
    } else {
        "AND (m.v IS NULL OR m.v IS ci.v)"
    };
    let predicate = valid(c);
    let mut q=i.c().prepare(&format!("SELECT DISTINCT event_id FROM chart_input ci WHERE ({predicate}) AND EXISTS(SELECT 1 FROM chart_marks m WHERE m.x IS ci.x AND m.g IS ci.g {extra} AND {axis}) LIMIT 1000001")).map_err(err)?;
    let mut cursor = q.query([]).map_err(err)?;
    let mut ids = BTreeSet::new();
    while let Some(row) = cursor.next().map_err(err)? {
        crate::operation::check()?;
        ids.insert(row.get::<_, String>(0).map_err(err)?.parse().map_err(err)?);
        if ids.len() > 1000000 {
            return Err(
                "RESOURCE_LIMIT: chart selection exceeds one million records; narrow the scope"
                    .into(),
            );
        }
    }
    Ok(ids)
}
