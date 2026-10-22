use super::*;
use accurate::{sum::Neumaier, traits::SumAccumulator};
use average::{Covariance, Estimate, Variance};
use linfa::{
    traits::{Fit, Predict, Transformer},
    DatasetBase,
};
use ndarray::{Array2, Axis};
fn finite(x: f64) -> Result<f64, String> {
    if x.is_finite() {
        Ok(x)
    } else {
        Err("RESOURCE_LIMIT: numerical range exceeded; rescale the chosen fields".into())
    }
}
fn assumptions() -> String {
    "Inferential results assume independent observations. Repeated entities, spatial/temporal autocorrelation, selection bias and multiple comparisons can invalidate interpretation; association is not causation.".into()
}
struct Matrix {
    x: Array2<f64>,
    ids: Vec<Value>,
    fields: Vec<String>,
    means: Vec<f64>,
    scales: Vec<f64>,
}
fn matrix(i: &Input, fields: Vec<String>, standardize: bool) -> Result<Matrix, String> {
    if fields.is_empty()
        || fields.len() > 32
        || i.count > 200000
        || i.count as usize * fields.len() > 4_000_000
    {
        return Err("RESOURCE_LIMIT: matrix analysis needs <=200000 input rows and <=4000000 numeric cells; use explicit preparation/filters. No automatic sampling.".into());
    }
    let columns: Vec<_> = fields.iter().map(|f| i.num(f)).collect::<Result<_, _>>()?;
    let predicate = columns
        .iter()
        .map(|c| format!("{c} IS NOT NULL"))
        .collect::<Vec<_>>()
        .join(" AND ");
    let mut q = i
        .c()
        .prepare(&format!(
            "SELECT event_id,{} FROM analytic_input WHERE {predicate} ORDER BY rowid",
            columns.join(",")
        ))
        .map_err(|e| e.to_string())?;
    let mut rows = q.query([]).map_err(|e| e.to_string())?;
    let mut ids = vec![];
    let mut data = Vec::new();
    let mut moments = vec![Variance::new(); fields.len()];
    let mut sums = vec![Neumaier::<f64>::zero(); fields.len()];
    while let Some(r) = rows.next().map_err(|e| e.to_string())? {
        crate::operation::check()?;
        ids.push(super::input::value(
            r.get_ref(0).map_err(|e| e.to_string())?,
        ));
        for j in 0..fields.len() {
            let x: f64 = r.get(j + 1).map_err(|e| e.to_string())?;
            data.push(x);
            moments[j].add(x);
            sums[j] += x;
        }
    }
    if ids.len() < 2 {
        return Err("INVALID_ARGUMENT: at least two complete numeric rows are required".into());
    }
    let means: Vec<_> = sums
        .iter()
        .map(|s| finite(s.sum() / ids.len() as f64))
        .collect::<Result<_, _>>()?;
    let mut scales = vec![1.; fields.len()];
    for (j, m) in moments.iter().enumerate() {
        finite(m.population_variance())?;
        if standardize {
            let sd = m.population_variance().sqrt();
            if sd == 0. {
                return Err(format!(
                    "INVALID_ARGUMENT: constant feature {}; remove it before standardization",
                    fields[j]
                ));
            }
            scales[j] = sd;
        }
    }
    if standardize {
        for row in data.chunks_mut(fields.len()) {
            for (j, x) in row.iter_mut().enumerate() {
                *x = finite((*x - means[j]) / scales[j])?;
            }
        }
    }
    let x = Array2::from_shape_vec((ids.len(), fields.len()), data).map_err(|e| e.to_string())?;
    Ok(Matrix {
        x,
        ids,
        fields,
        means,
        scales,
    })
}
pub fn run(i: &Input, p: &Plan) -> Result<Output, String> {
    let a = &p.parameters;
    let limit = p.output_limit;
    match p.capability.as_str() {
        "one_sample_t" | "welch_t" => {
            use statrs::distribution::{ContinuousCDF, StudentsT};
            let field = a["field"].as_str().unwrap();
            let conf = a["confidence"].as_f64().unwrap_or(0.95);
            let (n_a, mean_a, var_a, n_b, mean_b, var_b) = if p.capability == "one_sample_t" {
                let (m, s) = i.floats(field)?;
                (
                    m.len(),
                    s.sum() / m.len().max(1) as f64,
                    m.sample_variance(),
                    0,
                    a["expected_mean"].as_f64().unwrap(),
                    0.,
                )
            } else {
                if a["group_a"] == a["group_b"] {
                    return Err("INVALID_ARGUMENT: Welch cohorts must differ".into());
                }
                let group = i.col(a["group_by"].as_str().unwrap())?;
                let n = i.num(field)?;
                let mut ma = Variance::new();
                let mut mb = Variance::new();
                let mut sa = Neumaier::<f64>::zero();
                let mut sb = sa;
                let mut q=i.c().prepare(&format!("SELECT cast({group} AS TEXT),{n} FROM analytic_input WHERE {n} IS NOT NULL ORDER BY rowid")).map_err(|e|e.to_string())?;
                let mut rows = q.query([]).map_err(|e| e.to_string())?;
                while let Some(r) = rows.next().map_err(|e| e.to_string())? {
                    crate::operation::check()?;
                    let g: Option<String> = r.get(0).map_err(|e| e.to_string())?;
                    let x: f64 = r.get(1).map_err(|e| e.to_string())?;
                    if g.as_deref() == a["group_a"].as_str() {
                        ma.add(x);
                        sa += x;
                    } else if g.as_deref() == a["group_b"].as_str() {
                        mb.add(x);
                        sb += x;
                    }
                }
                (
                    ma.len(),
                    sa.sum() / ma.len().max(1) as f64,
                    ma.sample_variance(),
                    mb.len(),
                    sb.sum() / mb.len().max(1) as f64,
                    mb.sample_variance(),
                )
            };
            if n_a < 2 || p.capability == "welch_t" && n_b < 2 {
                return Err("INVALID_ARGUMENT: at least two finite measurements per tested cohort are required".into());
            }
            let va = finite(var_a / n_a as f64)?;
            let vb = if n_b > 0 {
                finite(var_b / n_b as f64)?
            } else {
                0.
            };
            let se = (va + vb).sqrt();
            if se == 0. {
                return Err(
                    "INVALID_ARGUMENT: test uncertainty is undefined for zero-variance cohorts"
                        .into(),
                );
            }
            let df = if n_b == 0 {
                (n_a - 1) as f64
            } else {
                finite(
                    (va + vb).powi(2)
                        / (va.powi(2) / (n_a - 1) as f64 + vb.powi(2) / (n_b - 1) as f64),
                )?
            };
            let t = finite((mean_a - mean_b) / se)?;
            let d = StudentsT::new(0., 1., df).map_err(|e| e.to_string())?;
            let probability = finite(2. * d.sf(t.abs()))?;
            let margin = finite(d.inverse_cdf(0.5 + conf / 2.) * se)?;
            let mut out = Output::new(
                json!({"method":p.capability,"count_a":n_a,"count_b":n_b,"mean_a":mean_a,"mean_b_or_null_hypothesis":mean_b,"mean_difference":finite(mean_a-mean_b)?,"t":t,"degrees_of_freedom":df,"p_two_sided":probability,"confidence":conf,"difference_interval":[finite(mean_a-mean_b-margin)?,finite(mean_a-mean_b+margin)?]}),
                vec![],
                0,
                n_a + n_b,
            );
            out.excluded = i.count - n_a - n_b;
            out.warnings.push(assumptions());
            Ok(out)
        }
        "correlation" => {
            let fields: Vec<_> = a["fields"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect();
            let cols = fields
                .iter()
                .map(|f| i.num(f))
                .collect::<Result<Vec<_>, _>>()?;
            let mut accum = std::collections::BTreeMap::new();
            for x in 0..cols.len() {
                for y in x + 1..cols.len() {
                    accum.insert((x, y), Covariance::new());
                }
            }
            let mut q = i
                .c()
                .prepare(&format!(
                    "SELECT {} FROM analytic_input ORDER BY rowid",
                    cols.join(",")
                ))
                .map_err(|e| e.to_string())?;
            let mut data = q.query([]).map_err(|e| e.to_string())?;
            while let Some(row) = data.next().map_err(|e| e.to_string())? {
                crate::operation::check()?;
                let vals = (0..cols.len())
                    .map(|j| row.get::<_, Option<f64>>(j))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                for ((x, y), v) in &mut accum {
                    if let (Some(x), Some(y)) = (vals[*x], vals[*y]) {
                        v.add(x, y);
                    }
                }
            }
            let mut rows = vec![];
            for ((x, y), c) in accum {
                let vx = c.population_variance_x();
                let vy = c.population_variance_y();
                let defined = c.len() >= 2 && vx > 0. && vy > 0.;
                let r = if defined {
                    let denom = finite((vx * c.len() as f64) * (vy * c.len() as f64))?;
                    if denom == 0. {
                        return Err(
                            "RESOURCE_LIMIT: Pearson scale underflow; rescale fields".into()
                        );
                    }
                    let r = finite(c.pearson())?;
                    if r.abs() > 1. + 1e-10 || r == 0. && c.population_covariance() != 0. {
                        return Err("RESOURCE_LIMIT: Pearson numeric range".into());
                    }
                    Some(r.clamp(-1., 1.))
                } else {
                    None
                };
                rows.push(json!({"field_x":fields[x],"field_y":fields[y],"pearson_r":r,"paired_count":c.len(),"excluded_pairs":i.count-c.len(),"undefined":!defined}));
            }
            let total = rows.len() as u64;
            rows.truncate(limit);
            let mut out = Output::new(
                json!({"method":"pairwise complete Pearson","fields":fields}),
                rows,
                total,
                i.count,
            );
            out.warnings
                .push("Pairwise denominators can differ; correlation is not causation.".into());
            Ok(out)
        }
        "regression" | "kmeans" | "pca" => {
            let mut fields: Vec<String> = a["fields"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().into())
                .collect();
            if p.capability == "kmeans"
                && fields.iter().any(|f| {
                    matches!(f.as_str(), "lat" | "lon")
                        || matches!(
                            f.to_lowercase().trim_start_matches("attribute:"),
                            "latitude" | "longitude" | "lat" | "lon"
                        )
                })
            {
                return Err("INVALID_ARGUMENT: feature K-means does not use longitude/latitude degrees as distances. Use metre-based spatial pattern analysis or explicit geospatial preparation.".into());
            }
            if p.capability == "regression" {
                let target = a["target"].as_str().unwrap();
                if fields.iter().any(|f| f == target) {
                    return Err("INVALID_ARGUMENT: target cannot also be a predictor".into());
                }
                fields.push(target.into());
            }
            let mut m = matrix(
                i,
                fields,
                p.capability != "regression" && a["standardize"].as_bool().unwrap_or(true),
            )?;
            let evaluated = m.ids.len() as u64;
            let mut out = if p.capability == "regression" {
                use linfa::prelude::SingleTargetRegression;
                let target = m.x.column(m.x.ncols() - 1).to_owned();
                let features =
                    m.x.select(Axis(1), &(0..m.x.ncols() - 1).collect::<Vec<_>>());
                if features.nrows() <= features.ncols() {
                    return Err(
                        "INVALID_ARGUMENT: regression needs more complete rows than predictors"
                            .into(),
                    );
                }
                let data = DatasetBase::new(features, target);
                let model = linfa_linear::LinearRegression::default()
                    .fit(&data)
                    .map_err(|e| {
                        format!("INVALID_ARGUMENT: regression failed: {e}; inspect rank/scale")
                    })?;
                crate::operation::check()?;
                let pred = model.predict(&data);
                let r2 = pred.r2(&data).map_err(|e| e.to_string())?;
                let mse = pred.mean_squared_error(&data).map_err(|e| e.to_string())?;
                let rows=pred.iter().zip(m.ids.iter()).zip(data.targets().iter()).take(limit).map(|((y,id),actual)|Ok(json!({"event_id":id,"predicted":finite(*y)?,"actual":actual,"residual":finite(actual-y)?}))).collect::<Result<Vec<_>,String>>()?;
                Output::new(
                    json!({"predictors":a["fields"],"target":a["target"],"intercept":finite(model.intercept())?,"coefficients":model.params().iter().copied().map(finite).collect::<Result<Vec<_>,_>>()?,"r_squared":if r2.is_finite(){Some(r2)}else{None},"root_mean_squared_error":finite(mse.sqrt())?,"validation":"in-sample fit diagnostics; no held-out accuracy claim"}),
                    rows,
                    evaluated,
                    evaluated,
                )
            } else if p.capability == "kmeans" {
                use rand::SeedableRng;
                use rand_xoshiro::Xoshiro256Plus;
                let k = a["clusters"].as_u64().unwrap() as usize;
                let iterations = a["max_iterations"].as_u64().unwrap_or(50);
                if k >= m.x.nrows() || m.x.len() as u64 * k as u64 * iterations > 500_000_000 {
                    return Err("RESOURCE_LIMIT: cluster count or fitting-work budget exceeded; reduce features/iterations or prepare data".into());
                }
                let ds = DatasetBase::from(m.x.clone());
                let seed = a["seed"].as_u64().unwrap_or(42);
                let model = linfa_clustering::KMeans::params_with_rng(
                    k,
                    Xoshiro256Plus::seed_from_u64(seed),
                )
                .max_n_iterations(iterations)
                .n_runs(1)
                .fit(&ds)
                .map_err(|e| e.to_string())?;
                crate::operation::check()?;
                let labels = model.predict(&ds);
                let mut sizes = vec![0u64; k];
                for label in &labels {
                    sizes[*label] += 1;
                }
                let rows = labels
                    .iter()
                    .zip(m.ids.iter())
                    .take(limit)
                    .map(|(label, id)| json!({"event_id":id,"cluster":label}))
                    .collect();
                Output::new(
                    json!({"fields":m.fields,"seed":seed,"standardized":a["standardize"].as_bool().unwrap_or(true),"means":m.means,"scales":m.scales,"cluster_sizes":sizes,"centroids_in_transformed_units":model.centroids().outer_iter().map(|r|r.to_vec()).collect::<Vec<_>>(),"inertia":finite(model.inertia())?}),
                    rows,
                    evaluated,
                    evaluated,
                )
            } else {
                let dimensions = a["dimensions"].as_u64().unwrap() as usize;
                if dimensions > m.x.ncols() || dimensions >= m.x.nrows() {
                    return Err(
                        "INVALID_ARGUMENT: PCA dimensions must fit feature and sample counts"
                            .into(),
                    );
                }
                let ds = DatasetBase::from(m.x.clone());
                let model = linfa_reduction::Pca::params(dimensions)
                    .fit(&ds)
                    .map_err(|e| e.to_string())?;
                crate::operation::check()?;
                // The crate's variance helpers normalise by component count; use its
                // singular values with the sample denominator and full input variance.
                let variances: Vec<f64> = model
                    .singular_values()
                    .iter()
                    .map(|s| s * s / (evaluated - 1) as f64)
                    .collect();
                let mut total = 0.;
                for column in m.x.columns() {
                    let v: Variance = column.iter().copied().collect();
                    total += v.sample_variance();
                }
                if total <= 0. || !total.is_finite() {
                    return Err(
                        "INVALID_ARGUMENT: PCA needs nonzero finite feature variance".into(),
                    );
                }
                let components = model
                    .components()
                    .outer_iter()
                    .map(|r| r.to_vec())
                    .collect::<Vec<_>>();
                let embedded = model.transform(ds);
                let rows = embedded
                    .records()
                    .outer_iter()
                    .zip(m.ids.iter())
                    .take(limit)
                    .map(|(r, id)| json!({"event_id":id,"components":r.to_vec()}))
                    .collect();
                Output::new(
                    json!({"fields":m.fields,"means":m.means,"scales":m.scales,"components":components,"explained_variance":variances,"explained_fraction_of_total":variances.iter().map(|v|v/total).collect::<Vec<_>>(),"standardized":a["standardize"].as_bool().unwrap_or(true),"seed":42}),
                    rows,
                    evaluated,
                    evaluated,
                )
            };
            out.excluded = i.count - evaluated;
            out.warnings.push("Complete-case input; no imputation or sampling. Numerical fitting is cooperatively cancellable before/after library kernels. Derived preparation rows have no fabricated Event IDs.".into());
            if p.capability == "regression" {
                out.warnings.push(assumptions());
            }
            m.ids.clear();
            Ok(out)
        }
        "periodicity" => {
            use rustfft::{num_complex::Complex, FftPlanner};
            let t = i.num("time")?;
            let bucket = a["bucket_seconds"].as_f64().unwrap();
            i.c()
                .create_scalar_function(
                    "an_period_bucket",
                    2,
                    rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
                    |ctx| {
                        let t: f64 = ctx.get(0)?;
                        let width: f64 = ctx.get(1)?;
                        Ok((t / width).floor() as i64)
                    },
                )
                .map_err(|e| e.to_string())?;
            let field = a["field"].as_str();
            let numeric = field.map(|f| i.num(f)).transpose()?;
            let expr = numeric
                .as_ref()
                .map(|f| format!("avg({f})"))
                .unwrap_or("count(*)".into());
            let q=format!("SELECT an_period_bucket({t},{bucket}) AS bucket,{expr} AS value FROM analytic_input WHERE {t} IS NOT NULL GROUP BY 1 ORDER BY 1");
            let rows = i.rows(&q, vec![], 200001)?;
            if rows.len() < 4 || rows.len() > 200000 {
                return Err("RESOURCE_LIMIT: periodicity requires 4..200000 time buckets".into());
            }
            let first = rows[0]["bucket"].as_i64().unwrap();
            let last = rows.last().unwrap()["bucket"].as_i64().unwrap();
            let n = last
                .checked_sub(first)
                .and_then(|v| v.checked_add(1))
                .ok_or("RESOURCE_LIMIT: FFT time span is too large")?;
            if !(4..=262144).contains(&n) {
                return Err("RESOURCE_LIMIT: regular FFT series exceeds 262144 buckets".into());
            }
            if rows.len() as i64 != n && !a["fill_missing_zero"].as_bool().unwrap_or(false) {
                return Err("INVALID_ARGUMENT: missing time buckets; choose fill_missing_zero explicitly or prepare a complete series".into());
            }
            let mut values = vec![0.; n as usize];
            for r in rows {
                let x = r["value"]
                    .as_f64()
                    .ok_or("INVALID_ARGUMENT: bucket has no finite measurements")?;
                values[(r["bucket"].as_i64().unwrap() - first) as usize] = x;
            }
            let mut sum = Neumaier::<f64>::zero();
            for x in &values {
                sum += *x;
            }
            let mean = sum.sum() / values.len() as f64;
            let mut buffer: Vec<_> = values.iter().map(|x| Complex::new(x - mean, 0.)).collect();
            let mut planner = FftPlanner::new();
            planner.plan_fft_forward(buffer.len()).process(&mut buffer);
            crate::operation::check()?;
            let mut peaks: Vec<_> = buffer
                .iter()
                .enumerate()
                .skip(1)
                .take(buffer.len() / 2)
                .map(|(k, c)| (k, c.norm_sqr() / (n as f64 * n as f64)))
                .collect();
            if peaks.iter().any(|(_, v)| !v.is_finite()) {
                return Err("RESOURCE_LIMIT: spectral numerical range".into());
            }
            peaks.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
            let total = peaks.len() as u64;
            let outrows=peaks.into_iter().take(limit.min(100)).map(|(k,power)|json!({"frequency_cycles_per_second":k as f64/(n as f64*bucket),"period_seconds":(n as f64*bucket)/k as f64,"power":power})).collect();
            let mut o = Output::new(
                json!({"regular_bucket_count":n,"bucket_seconds":bucket,"zero_filled":a["fill_missing_zero"].as_bool().unwrap_or(false),"mean_removed":mean,"method":"raw mean-centered FFT power, no statistical significance test"}),
                outrows,
                total,
                i.count,
            );
            o.warnings.push("Spectral candidates can reflect collection schedules, gaps, trend and aliasing; they do not establish a true periodic cause.".into());
            Ok(o)
        }
        "graph" => {
            use petgraph::{graph::DiGraph, unionfind::UnionFind};
            let x = i.col(a["source_field"].as_str().unwrap())?;
            let y = i.col(a["target_field"].as_str().unwrap())?;
            let rows=i.rows(&format!("SELECT cast({x} AS TEXT) AS source,cast({y} AS TEXT) AS target,count(*) AS count FROM analytic_input WHERE {x} IS NOT NULL AND {y} IS NOT NULL AND cast({x} AS TEXT)!='' AND cast({y} AS TEXT)!='' GROUP BY 1,2 ORDER BY 1,2"),vec![],200001)?;
            if rows.len() > 200000 {
                return Err(
                    "RESOURCE_LIMIT: graph exceeds 200000 distinct edges; prepare a smaller scope"
                        .into(),
                );
            }
            let mut graph = DiGraph::<String, u64>::new();
            let mut nodes = std::collections::BTreeMap::new();
            let mut eligible = 0;
            for r in rows {
                crate::operation::check()?;
                let mut ids = vec![];
                for key in ["source", "target"] {
                    let s = r[key].as_str().unwrap().to_string();
                    let id = if let Some(id) = nodes.get(&s) {
                        *id
                    } else {
                        if nodes.len() >= 50000 {
                            return Err("RESOURCE_LIMIT: graph exceeds 50000 nodes".into());
                        }
                        let id = graph.add_node(s.clone());
                        nodes.insert(s, id);
                        id
                    };
                    ids.push(id);
                }
                let count = r["count"].as_u64().unwrap();
                eligible += count;
                graph.add_edge(ids[0], ids[1], count);
            }
            let mut uf = UnionFind::<usize>::new(nodes.len());
            for e in graph.raw_edges() {
                uf.union(e.source().index(), e.target().index());
            }
            crate::operation::check()?;
            let mut result = vec![];
            let mut components = std::collections::BTreeSet::new();
            for (name, id) in &nodes {
                let component = uf.find(id.index());
                components.insert(component);
                let incoming = graph
                    .neighbors_directed(*id, petgraph::Direction::Incoming)
                    .count();
                let outgoing = graph
                    .neighbors_directed(*id, petgraph::Direction::Outgoing)
                    .count();
                result.push(json!({"entity":name,"weak_component":component,"in_degree":incoming,"out_degree":outgoing,"total_degree":incoming+outgoing}));
            }
            result.sort_by(|a, b| {
                b["total_degree"]
                    .as_u64()
                    .unwrap()
                    .cmp(&a["total_degree"].as_u64().unwrap())
                    .then(a["entity"].as_str().cmp(&b["entity"].as_str()))
            });
            let total = result.len() as u64;
            result.truncate(limit);
            let mut o = Output::new(
                json!({"node_count":nodes.len(),"distinct_edge_count":graph.edge_count(),"weak_components":components.len(),"edge_definition":"explicit source/target values; degrees over distinct directed edges; repeated edge counts retained during construction","rank_order":"total distinct degree, then entity name"}),
                result,
                total,
                eligible,
            );
            o.excluded = i.count - eligible;
            o.warnings.push("Relationships are defined by the chosen fields, not inferred real-world interactions.".into());
            Ok(o)
        }
        "trajectories" => {
            let entity = i.col("entity")?;
            let t = i.num("time")?;
            let lat = i.num("lat")?;
            let lon = i.num("lon")?;
            let mut q=i.c().prepare(&format!("SELECT {entity},{t},{lat},{lon} FROM analytic_input WHERE {lat} IS NOT NULL AND {lon} IS NOT NULL ORDER BY {entity},{t},event_id")).map_err(|e|e.to_string())?;
            let mut rows = q.query([]).map_err(|e| e.to_string())?;
            let mut result = vec![];
            let mut prev: Option<(String, f64, f64, f64)> = None;
            let mut count = 0u64;
            let mut distance = Neumaier::<f64>::zero();
            let mut speed = 0f64;
            let mut conflicts = 0u64;
            let mut first = 0.;
            let mut eligible = 0;
            let mut total = 0;
            while let Some(r) = rows.next().map_err(|e| e.to_string())? {
                crate::operation::check()?;
                let name: String = r.get(0).map_err(|e| e.to_string())?;
                let time = r.get::<_, f64>(1).map_err(|e| e.to_string())?;
                let la: f64 = r.get(2).map_err(|e| e.to_string())?;
                let lo: f64 = r.get(3).map_err(|e| e.to_string())?;
                if let Some((pname, pt, pla, plo)) = &prev {
                    if *pname == name {
                        let d = crate::analysis::geodesic_distance((*pla, *plo), (la, lo));
                        if time > *pt {
                            distance += d;
                            speed =
                                speed.max(d / crate::timestamps::seconds_between(time, *pt) * 3.6);
                        } else if d > 0. {
                            conflicts += 1;
                        }
                    } else {
                        total += 1;
                        if result.len() < limit {
                            result.push(json!({"entity":pname,"located_count":count,"track_distance_m":finite(distance.sum())?,"elapsed_seconds":crate::timestamps::seconds_between(*pt,first),"max_segment_speed_kmh":finite(speed)?,"same_time_location_conflicts":conflicts}));
                        }
                        count = 0;
                        distance = Neumaier::zero();
                        speed = 0.;
                        conflicts = 0;
                        first = time;
                    }
                } else {
                    first = time;
                }
                count += 1;
                eligible += 1;
                prev = Some((name, time, la, lo));
            }
            if let Some((name, last, _, _)) = prev {
                total += 1;
                if result.len() < limit {
                    result.push(json!({"entity":name,"located_count":count,"track_distance_m":finite(distance.sum())?,"elapsed_seconds":crate::timestamps::seconds_between(last,first),"max_segment_speed_kmh":finite(speed)?,"same_time_location_conflicts":conflicts}));
                }
            }
            let mut o = Output::new(
                json!({"entity_count":total,"distance":"WGS84 ellipsoidal shortest-geodesic segments between consecutive located Event anchors; not wind speed or polygon perimeter"}),
                result,
                total,
                eligible,
            );
            o.excluded = i.count - eligible;
            o.warnings.push("Missing locations are excluded; segment distance spans any intervening missing-location records. Same-time conflicting positions are disclosed and not used for speed.".into());
            Ok(o)
        }
        "similar_text" => {
            let field = a["field"].as_str().unwrap();
            let c = i.col(field)?;
            let query = a["query"].as_str().unwrap().to_lowercase();
            let threshold = a["minimum_score"].as_f64().unwrap_or(0.8);
            let rows=i.rows(&format!("SELECT cast({c} AS TEXT) AS value,count(*) AS count FROM analytic_input WHERE {c} IS NOT NULL GROUP BY 1 ORDER BY 1"),vec![],100001)?;
            if rows.len() > 100000 {
                return Err(
                    "RESOURCE_LIMIT: text similarity exceeds 100000 distinct values".into(),
                );
            }
            let mut result = vec![];
            for r in rows {
                crate::operation::check()?;
                let text = r["value"].as_str().unwrap();
                if text.len() > 4096 {
                    return Err("RESOURCE_LIMIT: similarity strings exceed 4096 bytes".into());
                }
                let score = strsim::jaro_winkler(&query, &text.to_lowercase());
                if score >= threshold {
                    result.push(json!({"value":text,"count":r["count"],"similarity":score}));
                }
            }
            result.sort_by(|a, b| {
                b["similarity"]
                    .as_f64()
                    .unwrap()
                    .total_cmp(&a["similarity"].as_f64().unwrap())
                    .then(a["value"].as_str().cmp(&b["value"].as_str()))
            });
            let total = result.len() as u64;
            result.truncate(limit);
            Ok(Output::new(
                json!({"field":field,"query":a["query"],"method":"Unicode lowercase then Jaro-Winkler","minimum_score":threshold}),
                result,
                total,
                i.count,
            ))
        }
        _ => Err("NOT_FOUND: analytic kernel".into()),
    }
}
