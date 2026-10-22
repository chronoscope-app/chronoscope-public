//! Schema-aware, revision-bound analytics: data stays in Rust/SQLite.
pub(crate) mod functions;
mod input;
mod math;
pub mod registry;
mod sql;
pub use input::Input;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
pub const MAX_RESULT_BYTES: usize = 32 * 1024 * 1024;
pub const ALGORITHM_VERSION: u32 = 2;
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Metric {
    pub alias: String,
    pub op: String,
    pub field: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Preparation {
    pub group_by: Vec<String>,
    pub metrics: Vec<Metric>,
}
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub capability: String,
    #[serde(default = "visible")]
    pub scope: String,
    #[serde(default = "empty")]
    pub parameters: Value,
    pub prepare: Option<Preparation>,
    #[serde(default = "limit")]
    pub output_limit: usize,
}
fn visible() -> String {
    "visible".into()
}
fn empty() -> Value {
    json!({})
}
fn limit() -> usize {
    10000
}
pub fn plan_schema() -> Value {
    let mut schema = serde_json::to_value(schemars::schema_for!(Plan)).unwrap();
    let defs = schema.get("$defs").cloned().unwrap_or(json!({}));
    fn inline(v: &mut Value, defs: &Value) {
        if let Some(key) = v
            .get("$ref")
            .and_then(Value::as_str)
            .and_then(|s| s.strip_prefix("#/$defs/"))
        {
            *v = defs[key].clone();
        }
        match v {
            Value::Object(m) => {
                m.remove("$defs");
                for child in m.values_mut() {
                    inline(child, defs);
                }
            }
            Value::Array(a) => {
                for child in a {
                    inline(child, defs);
                }
            }
            _ => {}
        }
    }
    inline(&mut schema, &defs);
    schema
}
impl Plan {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.scope.as_str(), "all" | "visible" | "selected")
            || self.output_limit == 0
            || self.output_limit > 100000
        {
            return Err("INVALID_ARGUMENT: scope or output_limit".into());
        }
        let d = registry::describe(&self.capability)?;
        let v = jsonschema::validator_for(&d["parameters_schema"]).map_err(|e| e.to_string())?;
        if let Some(e) = v.iter_errors(&self.parameters).next() {
            return Err(format!(
                "INVALID_ARGUMENT: analytics parameters at {}: {e}",
                e.instance_path()
            ));
        }
        if let Some(p) = &self.prepare {
            if p.group_by.is_empty()
                || p.group_by.len() > 4
                || p.metrics.is_empty()
                || p.metrics.len() > 16
            {
                return Err(
                    "INVALID_ARGUMENT: prepare needs 1..4 group fields and 1..16 metrics".into(),
                );
            }
            let mut names = std::collections::BTreeSet::new();
            for g in &p.group_by {
                if !names.insert(g) {
                    return Err("INVALID_ARGUMENT: duplicate preparation field".into());
                }
            }
            for m in &p.metrics {
                if m.alias.is_empty()
                    || m.alias.len() > 128
                    || !names.insert(&m.alias)
                    || !matches!(m.op.as_str(), "count" | "sum" | "mean" | "min" | "max")
                    || m.op != "count" && m.field.is_none()
                {
                    return Err("INVALID_ARGUMENT: invalid preparation metric".into());
                }
            }
        }
        Ok(())
    }
}
pub struct Output {
    pub summary: Value,
    pub rows: Vec<Value>,
    pub total_rows: u64,
    pub chart: Value,
    pub warnings: Vec<String>,
    pub evaluated: u64,
    pub excluded: u64,
}
impl Output {
    pub fn new(summary: Value, rows: Vec<Value>, total: u64, evaluated: u64) -> Self {
        Self {
            summary,
            rows,
            total_rows: total,
            chart: Value::Null,
            warnings: vec![],
            evaluated,
            excluded: 0,
        }
    }
}
#[derive(Serialize, Deserialize, JsonSchema)]
pub struct Artifact {
    pub result_id: String,
    pub capability: String,
    pub source_revision: u64,
    pub generation: String,
    pub scope: Value,
    pub input_count: u64,
    pub prepared_count: u64,
    pub evaluated_count: u64,
    pub excluded_count: u64,
    pub sampled: bool,
    pub algorithm_version: u32,
    pub created_utc: String,
    pub parameters: Value,
    pub preparation: Option<Preparation>,
    pub summary: Value,
    pub rows: Vec<Value>,
    pub total_rows: u64,
    pub limited: bool,
    pub chart: Value,
    pub warnings: Vec<String>,
}
impl Artifact {
    pub fn preview(&self, current_generation: &str) -> Value {
        let mut findings: Vec<_> = self.rows.iter().take(5).collect();
        if serde_json::to_string(&findings).map_or(true, |s| s.len() > 650) {
            findings.clear();
        }
        let summary = if self.summary.to_string().len() <= 1800 {
            self.summary.clone()
        } else {
            json!({"details_available":true,"available_fields":self.summary.as_object().map(|v|v.keys().collect::<Vec<_>>())})
        };
        json!({"result_id":self.result_id,"capability":self.capability,"source_revision":self.source_revision,"data_stale":self.generation!=current_generation,"input_count":self.input_count,"prepared_count":self.prepared_count,"evaluated_count":self.evaluated_count,"excluded_count":self.excluded_count,"sampled":false,"algorithm_version":self.algorithm_version,"summary":summary,"findings_preview":findings,"total_rows":self.total_rows,"retained_rows":self.rows.len(),"limited":self.limited,"warnings":self.warnings,"instruction":"findings_preview contains at most five output rows, not the entire result. Use analytics_result for paged rows/chart/provenance or selected summary_fields. Result is bound to its captured scope and source revision."})
    }
}
pub fn execute(input: &Input, plan: &Plan) -> Result<Output, String> {
    crate::operation::check()?;
    let mut output = match plan.capability.as_str() {
        "regression" | "kmeans" | "pca" | "periodicity" | "graph" | "trajectories"
        | "similar_text" | "one_sample_t" | "welch_t" | "correlation" => math::run(input, plan),
        _ => sql::run(input, plan),
    }?;
    output.rows.truncate(plan.output_limit);
    Ok(output)
}
pub fn hash(v: &impl Serialize) -> Result<String, String> {
    use sha2::Digest;
    Ok(format!(
        "{:x}",
        sha2::Sha256::digest(serde_json::to_vec(v).map_err(|e| e.to_string())?)
    ))
}
