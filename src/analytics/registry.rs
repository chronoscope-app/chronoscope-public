use crate::schema::object;
use serde_json::{json, Value};
fn text() -> Value {
    json!({"type":"string","minLength":1,"maxLength":256})
}
fn number() -> Value {
    json!({"type":"number"})
}
fn integer(a: i64, b: i64) -> Value {
    json!({"type":"integer","minimum":a,"maximum":b})
}
fn fields(min: usize, max: usize) -> Value {
    json!({"type":"array","items":text(),"minItems":min,"maxItems":max,"uniqueItems":true})
}
fn choice(v: &[&str]) -> Value {
    json!({"type":"string","enum":v})
}
pub const NAMES: &[&str] = &[
    "profile",
    "group",
    "duplicates",
    "quantiles",
    "histogram",
    "outliers",
    "correlation",
    "compare",
    "time_series",
    "one_sample_t",
    "welch_t",
    "chi_square",
    "regression",
    "kmeans",
    "pca",
    "periodicity",
    "graph",
    "trajectories",
    "similar_text",
];
pub fn describe(name: &str) -> Result<Value, String> {
    let (description,library,strategy,props,required)=match name{
 "profile"=>("Column completeness, missing values, finite numeric counts, distinct values and exact descriptive profiles","SQLite/average/accurate","sql",json!({"fields":fields(1,16)}),vec!["fields"]),
 "group"=>("Exact grouped count/numeric summaries, ranked frequencies by count, key or mean; supports two-way cross-tabs","SQLite","sql",json!({"group_by":fields(1,4),"field":text(),"order_by":choice(&["count","key","mean"]),"descending":{"type":"boolean"}}),vec!["group_by"]),
 "duplicates"=>("Exact duplicate groups over chosen columns; retains group counts and bounded member examples","SQLite","sql",json!({"fields":fields(1,8)}),vec!["fields"]),
 "quantiles"=>("Median, quartiles, percentiles and exact linearly interpolated quantiles from disk-backed numeric ordering, without sampling","SQLite","sql",json!({"field":text(),"probabilities":{"type":"array","minItems":1,"maxItems":21,"items":{"type":"number","minimum":0,"maximum":1}}}),vec!["field"]),
 "histogram"=>("Numeric distribution using an equal-width histogram with exact counts and excluded-value denominator","SQLite","sql",json!({"field":text(),"bins":integer(1,100)}),vec!["field"]),
 "outliers"=>("IQR or population z-score outlier/anomaly candidates; exact thresholds and source Event IDs","SQLite/average","sql",json!({"field":text(),"method":choice(&["iqr","zscore"]),"threshold":{"type":"number","exclusiveMinimum":0,"maximum":20}}),vec!["field"]),
 "correlation"=>("Pairwise Pearson correlations over selected numeric fields, with pair/missing counts","average","stream",json!({"fields":fields(2,16)}),vec!["fields"]),
 "compare"=>("Compare full Event counts and measurement means by group across two explicit UTC time windows","SQLite","sql",json!({"group_by":text(),"field":text(),"baseline":{"type":"array","items":{"type":"number"},"minItems":2,"maxItems":2},"comparison":{"type":"array","items":{"type":"number"},"minItems":2,"maxItems":2}}),vec!["group_by","baseline","comparison"]),
 "time_series"=>("UTC calendar time buckets for activity trends with counts, numeric summaries, period changes and optional rolling means","SQLite/chrono/average","sql",json!({"field":text(),"bucket":choice(&["second","minute","hour","day","week","month","year"]),"rolling_window":integer(1,365)}),vec![]),
 "one_sample_t"=>("Two-sided one-sample t test and mean confidence interval; independent observations and finite variance required","statrs/average","stream",json!({"field":text(),"expected_mean":number(),"confidence":{"type":"number","exclusiveMinimum":0.5,"exclusiveMaximum":1}}),vec!["field","expected_mean"]),
 "welch_t"=>("Two-sided Welch unequal-variance mean comparison and confidence interval for two explicit independent cohorts","statrs/average","stream",json!({"field":text(),"group_by":text(),"group_a":text(),"group_b":text(),"confidence":{"type":"number","exclusiveMinimum":0.5,"exclusiveMaximum":1}}),vec!["field","group_by","group_a","group_b"]),
 "chi_square"=>("Contingency-table independence test; expected-cell diagnostics and Cramer's V; independent observations required","statrs","sql",json!({"fields":fields(2,2)}),vec!["fields"]),
 "regression"=>("Ordinary least squares with intercept, diagnostics and per-row predictions; not causal inference","linfa-linear","matrix",json!({"fields":fields(1,16),"target":text()}),vec!["fields","target"]),
 "kmeans"=>("Deterministic seeded numeric-feature K-means with optional standardization and Event assignments; geographic degrees forbidden","linfa-clustering","matrix",json!({"fields":fields(2,16),"clusters":integer(2,32),"seed":integer(0,2147483647),"max_iterations":integer(1,100),"standardize":{"type":"boolean"}}),vec!["fields","clusters"]),
 "pca"=>("Numeric feature dimensionality reduction with components, variance and row embeddings; scale explicitly","linfa-reduction","matrix",json!({"fields":fields(2,32),"dimensions":integer(1,8),"standardize":{"type":"boolean"}}),vec!["fields","dimensions"]),
 "periodicity"=>("FFT of regularly spaced UTC bucket counts/means; explicit optional zero-fill, bounded series and spectral candidate periods","rustfft","matrix",json!({"field":text(),"bucket_seconds":{"type":"number","minimum":0.000001,"maximum":31557600},"fill_missing_zero":{"type":"boolean"}}),vec!["bucket_seconds"]),
 "graph"=>("Explicit network/graph entity relationship components and degree ranking from explicit source/target attributes; no inferred interactions","petgraph","matrix",json!({"source_field":text(),"target_field":text()}),vec!["source_field","target_field"]),
 "trajectories"=>("Per-entity trajectory statistics: WGS84 geodesic track length, elapsed time and maximum segment speed; missing locations excluded and same-time conflicts disclosed","GeographicLib","stream",json!({}),vec![]),
 "similar_text"=>("Rank distinct textual values against a query using Jaro-Winkler similarity; not semantic equivalence","strsim","stream",json!({"field":text(),"query":text(),"minimum_score":{"type":"number","minimum":0,"maximum":1}}),vec!["field","query"]),
 _=>return Err("NOT_FOUND: unknown analytics capability; use analytics_discover".into())};
    Ok(
        json!({"capability":name,"description":description,"library":library,"strategy":strategy,"parameters_schema":object(props,&required),"full_scope":true,"sampling":"none; budget failures are explicit","source_changes":false,"matrix_limit":"200000 input rows after preparation; at most 4000000 numeric cells; native kernels are not interruptible mid-call","results":"persistent handle, compact summary, paged rows and chart metadata","prepare":"optional exact group/metric preparation before execution","timeout_seconds":300,"algorithm_version":1}),
    )
}
pub fn discover(search: &str, offset: usize) -> Value {
    let q = search.to_lowercase();
    let matches: Vec<_> = NAMES
        .iter()
        .filter_map(|n| describe(n).ok())
        .filter(|v| {
            format!("{} {}", v["capability"], v["description"])
                .to_lowercase()
                .split_whitespace()
                .any(|word| q.split_whitespace().any(|term| word.contains(term)))
                || q.is_empty()
        })
        .collect();
    let list:Vec<_>=matches.iter().skip(offset).take(6).map(|v|json!({"capability":v["capability"],"description":v["description"],"strategy":v["strategy"]})).collect();
    json!({"capabilities":list,"count":matches.len(),"next_offset":if offset+list.len()<matches.len(){Some(offset+list.len())}else{None},"instruction":"Describe the chosen capability; run it over the requested scope. Read compact results by result_id. Rust performs all calculations; never page all Events to calculate manually."})
}
