use super::*;
use accurate::traits::SumAccumulator;
use rusqlite::types::Value as Sql;
pub fn run(i: &Input, p: &Plan) -> Result<Output, String> {
    let a = &p.parameters;
    let field = a["field"].as_str().unwrap_or("value");
    let limit = p.output_limit;
    match p.capability.as_str() {
        "profile" => {
            let mut rows = vec![];
            for f in a["fields"].as_array().unwrap() {
                let f = f.as_str().unwrap();
                let c = i.col(f)?;
                let row=i.rows(&format!("SELECT count({c}) AS present_count,count(DISTINCT {c}) AS distinct_count,count(an_num({c})) AS numeric_count,min(an_num({c})) AS min,max(an_num({c})) AS max FROM analytic_input"),vec![],1)?.remove(0);
                let mut row = row;
                row["field"] = json!(f);
                row["missing_count"] = json!(i.count - row["present_count"].as_u64().unwrap());
                row["numeric_excluded"] = json!(i.count - row["numeric_count"].as_u64().unwrap());
                if row["numeric_count"].as_u64().unwrap() > 0 && i.num(f).is_ok() {
                    let (moments, sum) = i.floats(f)?;
                    let mean = sum.sum() / moments.len() as f64;
                    let variance = moments.population_variance();
                    if !mean.is_finite() || !variance.is_finite() || !sum.sum().is_finite() {
                        return Err(
                            "RESOURCE_LIMIT: profile numeric range exceeded; rescale fields".into(),
                        );
                    }
                    row["mean"] = json!(mean);
                    row["sum"] = json!(sum.sum());
                    row["variance_population"] = json!(variance);
                }
                rows.push(row);
            }
            Ok(Output::new(
                json!({"row_count":i.count,"field_count":rows.len(),"types":"numeric counts use finite parsing; semantic meaning and units are not inferred"}),
                rows.clone(),
                rows.len() as u64,
                i.count,
            ))
        }
        "group" | "duplicates" => {
            let keys = if p.capability == "group" {
                &a["group_by"]
            } else {
                &a["fields"]
            };
            let names: Vec<_> = keys
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect();
            let cols: Vec<_> = names.iter().map(|f| i.col(f)).collect::<Result<_, _>>()?;
            let mut select: Vec<_> = cols
                .iter()
                .enumerate()
                .map(|(n, c)| format!("{c} AS group_{n}"))
                .collect();
            select.extend([
                "count(*) AS count".into(),
                "min(event_id) AS example_event_id".into(),
            ]);
            if p.capability == "group" {
                let n = i.num(field)?;
                select.push(format!("count({n}) AS numeric_count,min({n}) AS min,max({n}) AS max,an_sum({n}) AS sum,an_mean({n}) AS mean"));
            }
            let having = if p.capability == "duplicates" {
                " HAVING count(*)>1"
            } else {
                ""
            };
            let group = cols.join(",");
            let total = i.scalar(&format!(
                "SELECT count(*) FROM (SELECT 1 FROM analytic_input GROUP BY {group}{having})"
            ))?;
            let direction = if a["descending"].as_bool().unwrap_or(true) {
                "DESC"
            } else {
                "ASC"
            };
            let order = match a["order_by"].as_str().unwrap_or("count") {
                "key" => "group_0",
                "mean" => "mean",
                _ => "count",
            };
            let rows=i.rows(&format!("SELECT {} FROM analytic_input GROUP BY {group}{having} ORDER BY {order} {direction},{} LIMIT {limit}",select.join(","),(0..cols.len()).map(|j|format!("group_{j}")).collect::<Vec<_>>().join(",")),vec![],limit)?;
            let mut out = Output::new(
                json!({"group_fields":names,"group_count":total,"input_count":i.count,"numeric_field":if p.capability=="group"{Some(field)}else{None}}),
                rows,
                total,
                i.count,
            );
            out.chart = json!({"type":"bar","x":"group_0","y":"count"});
            Ok(out)
        }
        "quantiles" => {
            let probabilities: Vec<f64> = a["probabilities"]
                .as_array()
                .map(|x| x.iter().map(|v| v.as_f64().unwrap()).collect())
                .unwrap_or(vec![0., 0.25, 0.5, 0.75, 1.]);
            let rows = probabilities
                .iter()
                .map(|q| Ok(json!({"probability":q,"value":i.quantile(field,*q)?})))
                .collect::<Result<Vec<_>, String>>()?;
            let n = i.scalar(&format!(
                "SELECT count({}) FROM analytic_input",
                i.num(field)?
            ))?;
            let mut out = Output::new(
                json!({"field":field,"numeric_count":n,"missing_count":i.count-n,"method":"exact linear interpolation at p*(n-1), disk-backed ordering"}),
                rows.clone(),
                rows.len() as u64,
                n,
            );
            out.excluded = i.count - n;
            Ok(out)
        }
        "histogram" => {
            let n = i.num(field)?;
            let s=i.rows(&format!("SELECT count({n}) AS count,min({n}) AS lo,max({n}) AS hi FROM analytic_input"),vec![],1)?.remove(0);
            let count = s["count"].as_u64().unwrap();
            let bins = a["bins"].as_u64().unwrap_or(20);
            let mut rows = vec![];
            if count > 0 {
                let lo = s["lo"].as_f64().unwrap();
                let hi = s["hi"].as_f64().unwrap();
                let width = super::functions::histogram_width(lo, hi, bins as u32)?;
                let bucket = format!("an_hist_bin({n},?1,?2,?3)");
                let args = vec![Sql::Real(lo), Sql::Real(width), Sql::Integer(bins as i64)];
                let counts=i.rows(&format!("SELECT {bucket} AS bin,count(*) AS count FROM analytic_input WHERE {n} IS NOT NULL GROUP BY 1 ORDER BY 1"),args,bins as usize)?;
                for j in 0..if width == 0. { 1 } else { bins } {
                    rows.push(json!({"bin":j,"start":lo+width*j as f64,"end":if j+1==bins{hi}else{lo+width*(j+1) as f64},"count":counts.iter().find(|r|r["bin"]==j).map(|r|r["count"].clone()).unwrap_or(json!(0))}));
                }
            }
            let mut o = Output::new(
                json!({"field":field,"numeric_count":count,"missing_count":i.count-count,"final_bin_includes_max":true}),
                rows.clone(),
                rows.len() as u64,
                count,
            );
            o.excluded = i.count - count;
            o.chart = json!({"type":"bar","x":"start","y":"count"});
            Ok(o)
        }
        "outliers" => {
            let n = i.num(field)?;
            let method = a["method"].as_str().unwrap_or("iqr");
            let k = a["threshold"]
                .as_f64()
                .unwrap_or(if method == "iqr" { 1.5 } else { 3. });
            let (m, sum) = i.floats(field)?;
            let count = m.len();
            if count == 0 {
                let mut output = Output::new(
                    json!({"field":field,"reason":"no finite numeric values"}),
                    vec![],
                    0,
                    0,
                );
                output.excluded = i.count;
                return Ok(output);
            }
            let (lo, hi) = if method == "iqr" {
                let q1 = i.quantile(field, 0.25)?.unwrap();
                let q3 = i.quantile(field, 0.75)?.unwrap();
                (q1 - k * (q3 - q1), q3 + k * (q3 - q1))
            } else {
                let mean = sum.sum() / count as f64;
                let sd = m.population_variance().sqrt();
                (mean - k * sd, mean + k * sd)
            };
            if !lo.is_finite() || !hi.is_finite() {
                return Err("RESOURCE_LIMIT: outlier numeric range".into());
            }
            let condition = format!("{n}<?1 OR {n}>?2");
            let args = vec![Sql::Real(lo), Sql::Real(hi)];
            let total: i64 = i
                .c()
                .query_row(
                    &format!("SELECT count(*) FROM analytic_input WHERE {condition}"),
                    rusqlite::params_from_iter(args.clone()),
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            let rows=i.rows(&format!("SELECT event_id,{n} AS value FROM analytic_input WHERE {condition} ORDER BY {n},rowid LIMIT {limit}"),args,limit)?;
            let mut o = Output::new(
                json!({"field":field,"method":method,"threshold":k,"lower":lo,"upper":hi,"outlier_count":total,"numeric_count":count,"missing_count":i.count-count}),
                rows,
                total as u64,
                count,
            );
            o.excluded = i.count - count;
            o.warnings.push("Outlier candidates are not evidence of error or wrongdoing; review distribution and units.".into());
            Ok(o)
        }
        "compare" => {
            let t = i.num("time")?;
            let g = i.col(a["group_by"].as_str().unwrap())?;
            let f = i.num(field)?;
            let bounds: Vec<f64> = ["baseline", "comparison"]
                .iter()
                .flat_map(|k| {
                    a[*k]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| v.as_f64().unwrap())
                })
                .collect();
            if bounds[0] >= bounds[1] || bounds[2] >= bounds[3] {
                return Err("INVALID_ARGUMENT: comparison windows need increasing finite UTC boundaries, start inclusive/end exclusive".into());
            }
            let b = format!("{t}>={} AND {t}<{}", bounds[0], bounds[1]);
            let c = format!("{t}>={} AND {t}<{}", bounds[2], bounds[3]);
            let query=format!("SELECT {g} AS group_key,sum({b}) AS baseline_count,sum({c}) AS comparison_count,an_mean(CASE WHEN {b} THEN {f} END) AS baseline_mean,an_mean(CASE WHEN {c} THEN {f} END) AS comparison_mean FROM analytic_input WHERE ({b}) OR ({c}) GROUP BY {g}");
            let total = i.scalar(&format!("SELECT count(*) FROM ({query})"))?;
            let rows=i.rows(&format!("SELECT *,comparison_count-baseline_count AS count_change,CASE WHEN baseline_count>0 THEN 100.0*(comparison_count-baseline_count)/baseline_count END AS percent_change FROM ({query}) ORDER BY count_change DESC,group_key LIMIT {limit}"),vec![],limit)?;
            let mut o = Output::new(
                json!({"group_by":a["group_by"],"field":field,"baseline":a["baseline"],"comparison":a["comparison"],"window_semantics":"UTC [start,end); zero baseline produces null percentage"}),
                rows,
                total,
                i.count,
            );
            o.chart = json!({"type":"bar","x":"group_key","y":"count_change"});
            Ok(o)
        }
        "time_series" => {
            let bucket = a["bucket"].as_str().unwrap_or("day");
            let rolling = a["rolling_window"].as_u64().unwrap_or(1);
            let t = i.col("time")?;
            let f = if a["field"].is_string() {
                i.num(field)?
            } else {
                "NULL".into()
            };
            let q=format!("SELECT an_bucket({t},?1) AS bucket_start,count(*) AS count,count({f}) AS numeric_count,an_mean({f}) AS mean,an_sum({f}) AS sum FROM analytic_input GROUP BY 1");
            let mut count = i
                .c()
                .prepare(&format!("SELECT count(*) FROM ({q})"))
                .map_err(|e| e.to_string())?;
            let total: u64 = count
                .query_row([bucket], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            let rows=i.rows(&format!("SELECT *,count-lag(count) OVER (ORDER BY bucket_start) AS count_change,avg(count) OVER (ORDER BY bucket_start ROWS BETWEEN {} PRECEDING AND CURRENT ROW) AS rolling_count_mean FROM ({q}) ORDER BY bucket_start LIMIT {limit}",rolling-1),vec![Sql::Text(bucket.into())],limit)?;
            let mut o = Output::new(
                json!({"bucket":bucket,"rolling_window":rolling,"bucket_count":total}),
                rows,
                total,
                i.count,
            );
            o.chart = json!({"type":"line","x":"bucket_start","y":"count"});
            o.warnings.push(
                "Empty buckets omitted; rolling windows and changes refer to observed buckets."
                    .into(),
            );
            Ok(o)
        }
        "chi_square" => {
            use statrs::distribution::{ChiSquared, ContinuousCDF};
            let fields = a["fields"].as_array().unwrap();
            let x = i.col(fields[0].as_str().unwrap())?;
            let y = i.col(fields[1].as_str().unwrap())?;
            let rows=i.rows(&format!("SELECT {x} AS row_key,{y} AS column_key,count(*) AS count FROM analytic_input WHERE {x} IS NOT NULL AND {y} IS NOT NULL GROUP BY 1,2 ORDER BY 1,2"),vec![],10001)?;
            if rows.len() > 10000 {
                return Err("RESOURCE_LIMIT: chi-square requires at most 10000 populated cells; reduce categories".into());
            }
            let mut rt = std::collections::BTreeMap::<String, f64>::new();
            let mut ct = rt.clone();
            let mut observed = std::collections::BTreeMap::new();
            let mut n = 0.;
            for r in &rows {
                let x = r["row_key"].to_string();
                let y = r["column_key"].to_string();
                let v = r["count"].as_f64().unwrap();
                *rt.entry(x.clone()).or_default() += v;
                *ct.entry(y.clone()).or_default() += v;
                observed.insert((x, y), v);
                n += v;
            }
            if rt.len() < 2 || ct.len() < 2 {
                return Err("INVALID_ARGUMENT: chi-square needs at least two nonempty row and column categories".into());
            }
            if rt.len() * ct.len() > 10000 {
                return Err("RESOURCE_LIMIT: contingency table exceeds 10000 cells".into());
            }
            let mut chi = 0.;
            let mut small = 0;
            let mut cells = vec![];
            for (x, rx) in &rt {
                for (y, cy) in &ct {
                    let expected = rx * cy / n;
                    let o = observed.get(&(x.clone(), y.clone())).copied().unwrap_or(0.);
                    chi += (o - expected).powi(2) / expected;
                    if expected < 5. {
                        small += 1;
                    }
                    cells.push(json!({"row_key":serde_json::from_str::<Value>(x).unwrap(),"column_key":serde_json::from_str::<Value>(y).unwrap(),"observed":o,"expected":expected}));
                }
            }
            let df = (rt.len() - 1) * (ct.len() - 1);
            let probability = ChiSquared::new(df as f64)
                .map_err(|e| e.to_string())?
                .sf(chi);
            let total = cells.len() as u64;
            cells.truncate(limit);
            let mut o = Output::new(
                json!({"chi_square":chi,"degrees_of_freedom":df,"p_two_sided":probability,"cramers_v":(chi/(n*((rt.len()-1).min(ct.len()-1)) as f64)).sqrt(),"expected_cells_below_5":small,"numeric_count":n}),
                cells,
                total,
                n as u64,
            );
            o.excluded = i.count - n as u64;
            o.warnings.push("Assumes independent observations; repeated entities and sparse expected cells can invalidate asymptotic p-values. Association is not causation.".into());
            Ok(o)
        }
        _ => Err("NOT_FOUND: analytics operation".into()),
    }
}
