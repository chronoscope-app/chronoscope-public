//! Reproducible exploratory screening over an exact, revision-bound analytic input.
use crate::analytics::{self, Input, Plan};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub scope: String,
    pub fields: Vec<String>,
    pub minimum_records: usize,
    pub correlation_threshold: f64,
    pub outlier_multiplier: f64,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            scope: "visible".into(),
            fields: vec![],
            minimum_records: 20,
            correlation_threshold: 0.6,
            outlier_multiplier: 1.5,
        }
    }
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !["visible", "selected"].contains(&self.scope.as_str())
            || self.fields.len() > 8
            || self.fields.iter().any(|f| f.is_empty() || f.len() > 256)
            || self.fields.iter().collect::<BTreeSet<_>>().len() != self.fields.len()
            || !(4..=100000).contains(&self.minimum_records)
            || !self.correlation_threshold.is_finite()
            || !(0.0..=1.0).contains(&self.correlation_threshold)
            || !self.outlier_multiplier.is_finite()
            || !(0.5..=10.).contains(&self.outlier_multiplier)
        {
            return Err("INVALID_ARGUMENT: invalid pattern scan options".into());
        }
        Ok(())
    }
    pub fn plan(&self, fields: &[String]) -> Plan {
        let mut columns = fields.to_vec();
        columns.extend(["time", "entity", "source"].map(str::to_owned));
        columns.sort();
        columns.dedup();
        Plan {
            capability: "profile".into(),
            scope: self.scope.clone(),
            parameters: json!({"fields":columns}),
            prepare: None,
            output_limit: 16,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub kind: String,
    pub fields: Vec<String>,
    pub lower: Option<f64>,
    pub upper: Option<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Finding {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub summary: String,
    pub method: String,
    pub metrics: Value,
    pub count: u64,
    pub denominator: u64,
    pub evidence: Evidence,
    pub examples: Vec<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Report {
    pub config: Config,
    pub input_count: u64,
    pub inspected_fields: Vec<String>,
    pub numeric_fields: Vec<String>,
    pub profiles: Vec<Value>,
    pub findings: Vec<Finding>,
    pub checks: Vec<String>,
    pub warnings: Vec<String>,
    pub sampled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub revision: u64,
    pub scan_id: String,
    pub cache_hit: bool,
    pub report: Option<Report>,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn run(
    i: &Input,
    c: &Config,
    capability: &str,
    parameters: Value,
    limit: usize,
) -> Result<analytics::Output, String> {
    let plan = Plan {
        capability: capability.into(),
        scope: c.scope.clone(),
        parameters,
        prepare: None,
        output_limit: limit,
    };
    plan.validate()?;
    analytics::execute(i, &plan)
}
pub fn automatic_field(name: &str) -> bool {
    let key = name.to_lowercase().replace([' ', '-'], "_");
    ![
        "id",
        "uuid",
        "entity",
        "category",
        "source",
        "source_row",
        "time",
        "timestamp",
        "date",
        "end",
        "year",
        "season",
        "lat",
        "lon",
        "latitude",
        "longitude",
        "mgrs_precision",
    ]
    .contains(&key.as_str())
        && !key.ends_with("_id")
        && !key.starts_with("id_")
        && name.len() <= 246
}
fn gaps(i: &Input) -> Result<(), String> {
    let time = i.num("time")?;
    let entity = i.col("entity")?;
    let source = i.col("source")?;
    i.c().execute_batch(&format!("CREATE TEMP TABLE IF NOT EXISTS scan_gaps AS SELECT event_id,previous_id,elapsed FROM (SELECT event_id,lag(event_id) OVER track AS previous_id,{time}-lag({time}) OVER track AS elapsed FROM analytic_input WINDOW track AS (PARTITION BY {entity},{source} ORDER BY {time},event_id)) WHERE elapsed>0;CREATE INDEX IF NOT EXISTS scan_gaps_elapsed ON scan_gaps(elapsed);")).map_err(err)
}
fn quantile(i: &Input, p: f64, n: u64) -> Result<f64, String> {
    let at = p * (n - 1) as f64;
    let lo = at.floor() as u64;
    let hi = at.ceil() as u64;
    let a: f64 = i
        .c()
        .query_row(
            "SELECT elapsed FROM scan_gaps ORDER BY elapsed LIMIT 1 OFFSET ?",
            [lo],
            |r| r.get(0),
        )
        .map_err(err)?;
    let b: f64 = i
        .c()
        .query_row(
            "SELECT elapsed FROM scan_gaps ORDER BY elapsed LIMIT 1 OFFSET ?",
            [hi],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(a + (b - a) * (at - lo as f64))
}
fn condition(i: &Input, e: &Evidence) -> Result<String, String> {
    Ok(match e.kind.as_str() {
        "outliers" => format!(
            "({0}<{1} OR {0}>{2})",
            i.num(&e.fields[0])?,
            e.lower.unwrap(),
            e.upper.unwrap()
        ),
        "missing" => format!(
            "unicode_trim(coalesce(cast({} AS TEXT),''))=''",
            i.col(&e.fields[0])?
        ),
        "correlation" | "trend" | "duplicates" => format!(
            "{} IS NOT NULL AND {} IS NOT NULL",
            i.num(&e.fields[0])?,
            i.num(&e.fields[1])?
        ),
        "gaps" => {
            gaps(i)?;
            format!("event_id IN (SELECT event_id FROM scan_gaps WHERE elapsed>{0} UNION SELECT previous_id FROM scan_gaps WHERE elapsed>{0})",e.upper.unwrap())
        }
        "periodicity" => "1=1".into(),
        _ => return Err("INVALID_ARGUMENT: unknown pattern evidence".into()),
    })
}
fn examples(i: &Input, e: &Evidence) -> Result<Vec<Value>, String> {
    let condition = condition(i, e)?;
    let columns = e
        .fields
        .iter()
        .filter(|f| !["entity", "source"].contains(&f.as_str()))
        .map(|f| {
            i.num(f)
                .map(|n| format!("{n} AS \"{}\"", f.replace('"', "\"\"")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    i.rows(&format!("SELECT event_id,{} AS time{} FROM analytic_input WHERE {condition} ORDER BY event_id LIMIT 5",i.col("time")?,if columns.is_empty(){String::new()}else{format!(",{}",columns.join(","))}),vec![],5)
}
pub fn members(i: &Input, e: &Evidence) -> Result<BTreeSet<u64>, String> {
    let sql = condition(i, e)?;
    let mut query = i
        .c()
        .prepare(&format!(
            "SELECT event_id FROM analytic_input WHERE {sql} ORDER BY event_id"
        ))
        .map_err(err)?;
    let mut ids = BTreeSet::new();
    for row in query
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
    {
        crate::operation::check()?;
        if ids.len() >= 1000000 {
            return Err(
                "RESOURCE_LIMIT: pattern selection exceeds one million records; narrow the scope"
                    .into(),
            );
        }
        ids.insert(row.map_err(err)?.parse::<u64>().map_err(err)?);
    }
    Ok(ids)
}
#[allow(clippy::too_many_arguments)]
fn add(
    report: &mut Report,
    i: &Input,
    kind: &str,
    title: String,
    summary: String,
    method: &str,
    metrics: Value,
    count: u64,
    denominator: u64,
    evidence: Evidence,
) -> Result<(), String> {
    report.findings.push(Finding {
        id: format!("{}:{}", kind, report.findings.len()),
        kind: kind.into(),
        title,
        summary,
        method: method.into(),
        metrics,
        count,
        denominator,
        examples: examples(i, &evidence)?,
        evidence,
    });
    Ok(())
}
fn evidence(kind: &str, fields: Vec<String>, lower: Option<f64>, upper: Option<f64>) -> Evidence {
    Evidence {
        kind: kind.into(),
        fields,
        lower,
        upper,
    }
}
fn name(field: &str) -> String {
    if let Some(original) = field.strip_prefix("attribute:") {
        format!("Imported · {}", original.replace('_', " "))
    } else {
        match field {
            "value" => "Value".into(),
            "time" => "Time".into(),
            "lat" => "Latitude".into(),
            "lon" => "Longitude".into(),
            _ => field.replace('_', " "),
        }
    }
}
pub fn scan(
    i: &Input,
    c: Config,
    fields: Vec<String>,
    mut warnings: Vec<String>,
) -> Result<Report, String> {
    let mut report = Report {
        config: c.clone(),
        input_count: i.count,
        inspected_fields: fields.clone(),
        numeric_fields: vec![],
        profiles: vec![],
        findings: vec![],
        checks: vec![],
        warnings: vec![],
        sampled: false,
    };
    if i.count == 0 {
        report
            .checks
            .push("No records match this scope; no patterns were inferred.".into());
        report.warnings = warnings;
        return Ok(report);
    }
    let profile = run(i, &c, "profile", json!({"fields":fields}), 16)?;
    let mut profiles: BTreeMap<String, Value> = BTreeMap::new();
    for row in profile.rows {
        let field = row["field"].as_str().unwrap().to_owned();
        let col = i.col(&field)?;
        let missing:i64=i.c().query_row(&format!("SELECT count(*) FROM analytic_input WHERE unicode_trim(coalesce(cast({col} AS TEXT),''))=''"),[],|r|r.get(0)).map_err(err)?;
        if missing > 0 {
            add(
                &mut report,
                i,
                "missing",
                format!("Missing values · {}", name(&field)),
                format!(
                    "{missing} of {} records have a missing or blank value.",
                    i.count
                ),
                "Exact null/blank counts; whitespace-only text counts as blank.",
                json!({"missing":missing,"records":i.count}),
                missing as u64,
                i.count,
                evidence("missing", vec![field.clone()], None, None),
            )?;
        }
        let mut coverage = row.clone();
        coverage["missing_or_blank_count"] = json!(missing);
        report.profiles.push(coverage);
        if i.num(&field).is_err() {
            warnings.push(format!(
                "{field} is not a numeric measurement column; only completeness was checked."
            ));
            continue;
        }
        if row["numeric_count"].as_u64().unwrap_or(0) < c.minimum_records as u64
            || row["min"] == row["max"]
        {
            continue;
        }
        let mut duplicate = None;
        for previous in &report.numeric_fields {
            let old = &profiles[previous];
            if old["numeric_count"] != row["numeric_count"]
                || old["min"] != row["min"]
                || old["max"] != row["max"]
            {
                continue;
            }
            let a = i.num(&field)?;
            let b = i.num(previous)?;
            let unequal:bool=i.c().query_row(&format!("SELECT EXISTS(SELECT 1 FROM analytic_input WHERE ({a} IS NULL)!=({b} IS NULL) OR {a}!={b})"),[],|r|r.get(0)).map_err(err)?;
            if !unequal {
                duplicate = Some(previous.clone());
                break;
            }
        }
        if let Some(previous) = duplicate {
            add(&mut report,i,"duplicates",format!("Matching numeric columns · {} / {}",name(&previous),name(&field)),format!("Both columns have identical numeric observations and the same numeric-exclusion positions in this scope. Repeated analyses use {} once.",name(&previous)),"Exact row-by-row equality after finite numeric parsing; excluded text values need not be identical.",json!({"numeric_records":row["numeric_count"]}),row["numeric_count"].as_u64().unwrap(),i.count,evidence("duplicates",vec![previous,field],None,None))?;
            continue;
        }
        profiles.insert(field.clone(), row);
        report.numeric_fields.push(field);
    }
    report.checks.push(format!("Profiled {} columns over all {} scoped records; at least {} numeric records and variation are required for numeric screening.",fields.len(),i.count,c.minimum_records));
    for field in report.numeric_fields.clone() {
        crate::operation::progress(
            report.findings.len() as u64,
            None,
            &format!("Screening {}", name(&field)),
        );
        let out = run(
            i,
            &c,
            "outliers",
            json!({"field":field,"method":"iqr","threshold":c.outlier_multiplier}),
            5,
        )?;
        let count = out.summary["outlier_count"].as_u64().unwrap_or(0);
        if count > 0 {
            let lo = out.summary["lower"].as_f64().unwrap();
            let hi = out.summary["upper"].as_f64().unwrap();
            let n = out.summary["numeric_count"].as_u64().unwrap();
            add(&mut report,i,"outliers",format!("Unusual values · {}",name(&field)),format!("{count} of {n} numeric observations fall outside the interquartile fences."),"Tukey IQR fences; candidates may be valid extremes, skewed distributions, or mixed groups.",out.summary,count,n,evidence("outliers",vec![field],Some(lo),Some(hi)))?;
        }
    }
    report.checks.push(format!(
        "Checked numeric outliers with {} × IQR fences.",
        c.outlier_multiplier
    ));
    if !report.numeric_fields.is_empty() {
        let mut columns = report.numeric_fields.clone();
        if !columns.iter().any(|f| f == "time") {
            columns.push("time".into());
        }
        if columns.len() >= 2 {
            let correlations = run(i, &c, "correlation", json!({"fields":columns}), 128)?;
            for row in correlations.rows {
                let (Some(r), Some(n)) = (row["pearson_r"].as_f64(), row["paired_count"].as_u64())
                else {
                    continue;
                };
                if n < c.minimum_records as u64 || r.abs() < c.correlation_threshold {
                    continue;
                }
                let x = row["field_x"].as_str().unwrap();
                let y = row["field_y"].as_str().unwrap();
                let temporal = x == "time" || y == "time";
                let field = if x == "time" { y } else { x };
                let kind = if temporal { "trend" } else { "correlation" };
                let title = if temporal {
                    format!("Time association · {}", name(field))
                } else {
                    format!("Related values · {} / {}", name(x), name(y))
                };
                add(&mut report,i,kind,title,format!("Pearson r = {r:.3} across {n} complete observation pairs."),"Pairwise-complete Pearson correlation. No significance test or causal inference; repeated observations need not be independent.",row.clone(),n,i.count,evidence(kind,vec![x.into(),y.into()],None,None))?;
            }
            report.checks.push(format!("Screened pairwise relationships and time associations at |r| ≥ {}; no p-values or causal claims.",c.correlation_threshold));
        }
    }
    gaps(i)?;
    let n: u64 = i
        .c()
        .query_row("SELECT count(*) FROM scan_gaps", [], |r| r.get(0))
        .map_err(err)?;
    if n >= c.minimum_records as u64 {
        let median = quantile(i, 0.5, n)?;
        let q1 = quantile(i, 0.25, n)?;
        let q3 = quantile(i, 0.75, n)?;
        let threshold = (q3 + c.outlier_multiplier * (q3 - q1)).max(3. * median);
        let count: u64 = i
            .c()
            .query_row(
                "SELECT count(*) FROM scan_gaps WHERE elapsed>?",
                [threshold],
                |r| r.get(0),
            )
            .map_err(err)?;
        if count > 0 {
            add(&mut report,i,"gaps","Long recording gaps".into(),format!("{count} of {n} positive intervals exceed {threshold:.0} seconds."),"Consecutive observations within each source/entity; cutoff is the larger of the IQR upper fence and three times the pooled median. Different schedules can explain gaps.",json!({"gap_count":count,"interval_count":n,"median_seconds":median,"threshold_seconds":threshold}),count,n,evidence("gaps",vec!["time".into()],None,Some(threshold)))?;
        }
    }
    report.checks.push(format!("Checked {n} positive within-source/entity intervals; gaps describe missing observations, not unobserved travel."));
    let times = i.rows(
        &format!(
            "SELECT min({0}) AS lo,max({0}) AS hi FROM analytic_input",
            i.num("time")?
        ),
        vec![],
        1,
    )?;
    let span = times[0]["hi"].as_f64().unwrap() - times[0]["lo"].as_f64().unwrap();
    if i.count >= c.minimum_records as u64 && span >= 660. {
        let bucket = [
            60, 300, 900, 3600, 21600, 86400, 604800, 2592000, 7776000, 31557600,
        ]
        .into_iter()
        .find(|b| span / (*b as f64) <= 126.)
        .unwrap_or(31557600);
        let bins = (span / (bucket as f64)).ceil() as usize;
        if (12..=128).contains(&bins) {
            let out = run(
                i,
                &c,
                "periodicity",
                json!({"bucket_seconds":bucket,"fill_missing_zero":true}),
                100,
            )?;
            let power: f64 = out.rows.iter().filter_map(|r| r["power"].as_f64()).sum();
            if let Some(peak) = out
                .rows
                .iter()
                .find(|r| r["period_seconds"].as_f64().is_some_and(|p| p <= span / 3.))
            {
                let fraction = if power > 0. {
                    peak["power"].as_f64().unwrap() / power
                } else {
                    0.
                };
                if fraction >= 0.2 {
                    let period = peak["period_seconds"].as_f64().unwrap();
                    add(&mut report,i,"periodicity","Repeated recording timing".into(),format!("A candidate cycle of {period:.0} seconds contributes {:.0}% of positive-frequency power.",fraction*100.),"Mean-centered FFT of fixed UTC event-count buckets; empty buckets count as zero observed records. At least three candidate cycles and 20% of positive-frequency power; not a significance test. Collection schedules, trends, gaps and aliasing may explain the peak.",json!({"period_seconds":period,"positive_frequency_power_fraction":fraction,"bucket_seconds":bucket,"regular_bucket_count":out.summary["regular_bucket_count"],"zero_fill":"zero observed records; not proof of no real-world activity"}),i.count,i.count,evidence("periodicity",vec!["time".into()],None,None))?;
                }
            }
            report.checks.push(format!("Screened count timing in {bucket}-second UTC buckets; empty buckets mean zero observed records."));
        } else {
            warnings.push("Timing span does not support 12–128 regular screening buckets; no periodicity claim was made.".into());
        }
    }
    warnings.push("Candidates describe observations, not confirmed causes, errors, meetings or routes. Review field meanings, units, collection schedules and repeated observations before acting.".into());
    if report.numeric_fields.is_empty() {
        warnings.push("No varying numeric fields met the minimum record count. Gap and timing checks still use eligible observations.".into());
    }
    report.warnings = warnings;
    Ok(report)
}

pub fn config_schema() -> Value {
    crate::schema::object(
        json!({
            "scope":{"type":"string","enum":["visible","selected"]},
            "fields":{"type":"array","items":{"type":"string","minLength":1,"maxLength":256},"maxItems":8,"uniqueItems":true},
            "minimum_records":{"type":"integer","minimum":4,"maximum":100000},
            "correlation_threshold":{"type":"number","minimum":0,"maximum":1},
            "outlier_multiplier":{"type":"number","minimum":0.5,"maximum":10}
        }),
        &[],
    )
}
