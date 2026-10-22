//! Exact descriptive statistics over indexed filters; constant memory, no sampling.
use super::*;
use accurate::{sum::Neumaier, traits::SumAccumulator};
use average::{Covariance, Estimate, Max, Min, Variance};
use schemars::JsonSchema;
use serde::Serialize;

#[derive(Serialize, JsonSchema)]
pub struct Summary {
    pub count: u64,
    pub missing: u64,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub sum: Option<f64>,
    pub mean: Option<f64>,
    pub variance_population: Option<f64>,
    pub standard_deviation_population: Option<f64>,
    pub standard_deviation_sample: Option<f64>,
}
#[derive(Serialize, JsonSchema)]
pub struct Paired {
    pub count: u64,
    pub missing_pairs: u64,
    pub mean_x: Option<f64>,
    pub mean_y: Option<f64>,
    pub pearson_r: Option<f64>,
    pub undefined_reason: Option<String>,
}
#[derive(Serialize, JsonSchema)]
pub struct Report {
    pub scope: Value,
    pub field: String,
    pub other_field: Option<String>,
    pub evaluated_count: u64,
    pub summary: Summary,
    pub paired: Option<Paired>,
    pub sampled: bool,
    pub method: String,
}
// Only database/JSON policy lives here. Numerical accumulators are maintained
// by average and accurate; no bespoke moment/covariance recurrences.
pub(super) struct SummaryAccumulator {
    variance: Variance,
    sum: Neumaier<f64>,
    min: Min,
    max: Max,
}
impl Default for SummaryAccumulator {
    fn default() -> Self {
        Self {
            variance: Variance::new(),
            sum: Neumaier::zero(),
            min: Min::new(),
            max: Max::new(),
        }
    }
}
fn numeric_range_error() -> String {
    "RESOURCE_LIMIT: numeric magnitude exceeds the statistics backend's floating-point range; rescale the numeric fields".into()
}
impl SummaryAccumulator {
    pub(super) fn add(&mut self, x: f64) -> Result<(), String> {
        if !x.is_finite() {
            return Err("OPERATION_FAILED: non-finite numeric statistic input".into());
        }
        self.variance.add(x);
        self.sum += x;
        self.min.add(x);
        self.max.add(x);
        if !self.variance.mean().is_finite()
            || !self.variance.population_variance().is_finite()
            || !self.sum.sum().is_finite()
        {
            return Err(numeric_range_error());
        }
        Ok(())
    }
    pub(super) fn summary(&self, total: u64) -> Summary {
        let n = self.variance.len();
        let variance = (n > 0).then(|| self.variance.population_variance());
        Summary {
            count: n,
            missing: total - n,
            min: (n > 0).then(|| self.min.min()),
            max: (n > 0).then(|| self.max.max()),
            sum: (n > 0).then(|| self.sum.sum()),
            // Use the library's compensated sum for the reported mean, too;
            // ordinary running means lose small residuals under cancellation.
            mean: (n > 0).then(|| self.sum.sum() / n as f64),
            variance_population: variance,
            standard_deviation_population: variance.map(f64::sqrt),
            standard_deviation_sample: (n > 1).then(|| self.variance.sample_variance().sqrt()),
        }
    }
}
fn paired_summary(pairs: &Covariance, total: u64) -> Result<Paired, String> {
    let n = pairs.len();
    let vx = pairs.population_variance_x();
    let vy = pairs.population_variance_y();
    let defined = n >= 2 && vx > 0. && vy > 0.;
    let pearson_r = if defined {
        // average::pearson multiplies unnormalised sums of squares. Reject
        // intermediate overflow/underflow explicitly: it can otherwise return
        // a finite, incorrect zero when that product overflows. Do not silently
        // substitute a different formula or present that zero as evidence.
        let denominator_squared = (vx * n as f64) * (vy * n as f64);
        if !denominator_squared.is_finite() || denominator_squared == 0. {
            return Err(numeric_range_error());
        }
        let r = pairs.pearson();
        if !r.is_finite()
            || r.abs() > 1. + 1e-10
            || (r == 0. && pairs.population_covariance() != 0.)
        {
            return Err(numeric_range_error());
        }
        Some(r.clamp(-1., 1.))
    } else {
        None
    };
    Ok(Paired {
        count: n,
        missing_pairs: total - n,
        mean_x: (n > 0).then(|| pairs.mean_x()),
        mean_y: (n > 0).then(|| pairs.mean_y()),
        pearson_r,
        undefined_reason: (!defined).then(|| {
            "Requires at least two paired finite values with nonzero variance in both fields".into()
        }),
    })
}
impl DataStore {
    pub fn statistics(
        &self,
        filter: &Filter,
        source: Option<&str>,
        field: &str,
        other: Option<&str>,
    ) -> Result<Report, String> {
        crate::operation::check()?;
        let (clause, conditions) = Self::where_sql(filter, source);
        let mut joins = String::new();
        let mut values = vec![];
        let mut expression = |name: &str, alias: &str| -> Result<String, String> {
            if let Some(key) = name.strip_prefix("attribute:") {
                if key.is_empty() {
                    return Err("INVALID_ARGUMENT: attribute name is empty".into());
                }
                let exists: bool = self
                    .connection
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM attributes WHERE key=?)",
                        [key],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                if !exists {
                    return Err(format!("INVALID_ARGUMENT: unknown attribute {key:?}; discover dataset_schema first"));
                }
                values.push(SqlValue::Text(key.into()));
                joins.push_str(&format!(
                    " LEFT JOIN attributes {alias} ON {alias}.r=e.r AND {alias}.key=? "
                ));
                Ok(format!("{alias}.num"))
            } else if matches!(name, "value" | "lat" | "lon" | "time" | "end") {
                Ok(format!("e.{name}"))
            } else {
                Err("INVALID_ARGUMENT: numeric fields are value, lat, lon, time, end or attribute:<name>".into())
            }
        };
        let x = expression(field, "sx")?;
        let y = other
            .map(|f| expression(f, "sy"))
            .transpose()?
            .unwrap_or_else(|| "NULL".into());
        values.extend(conditions);
        let mut statement = self
            .connection
            .prepare(&format!(
                "SELECT {x},{y} FROM events e {joins} WHERE {clause} ORDER BY e.r"
            ))
            .map_err(err)?;
        let mut rows = statement
            .query(rusqlite::params_from_iter(values))
            .map_err(err)?;
        let mut total = 0u64;
        let mut summary = SummaryAccumulator::default();
        let mut pairs = Covariance::new();
        while let Some(row) = rows.next().map_err(err)? {
            total += 1;
            if total.is_multiple_of(1024) {
                crate::operation::check()?;
                crate::operation::progress(total, None, "Computing exact statistics");
            }
            let x: Option<f64> = row.get(0).map_err(err)?;
            let y: Option<f64> = row.get(1).map_err(err)?;
            if let Some(x) = x {
                summary.add(x)?;
            }
            if let (Some(x), Some(y)) = (x, y) {
                pairs.add(x, y);
                if !pairs.mean_x().is_finite()
                    || !pairs.mean_y().is_finite()
                    || !pairs.population_variance_x().is_finite()
                    || !pairs.population_variance_y().is_finite()
                    || !pairs.population_covariance().is_finite()
                {
                    return Err(numeric_range_error());
                }
            }
        }
        let paired = other.map(|_| paired_summary(&pairs, total)).transpose()?;
        use sha2::Digest;
        let filter_sha256 = format!(
            "{:x}",
            sha2::Sha256::digest(serde_json::to_vec(filter).map_err(|e| e.to_string())?)
        );
        Ok(Report{scope:json!({"filter_sha256":filter_sha256,"selected_only":filter.selected_only,"source":source}),field:field.into(),other_field:other.map(str::to_owned),evaluated_count:total,summary:summary.summary(total),paired,sampled:false,
            method:"average 0.17.0 streaming variance/covariance/Pearson; accurate 0.4.1 Neumaier compensated sum/mean. Finite numeric values only; missing/non-numeric values excluded explicitly. Pearson correlation describes linear association, not causation.".into()})
    }
}
