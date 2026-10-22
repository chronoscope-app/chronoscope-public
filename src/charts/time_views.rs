//! Bounded UTC pattern grids and exact, half-open period comparisons.
use super::*;

pub(super) fn validate_periods(c: &Config) -> Result<(), String> {
    match (c.period_a, c.period_b) {
        (None, None) => Ok(()),
        (Some(a), Some(b))
            if [a, b].iter().all(|p| {
                p[0].is_finite() && p[1].is_finite() && p[0] < p[1]
                    && p.iter().all(|t| crate::timestamps::datetime(*t).is_some())
            }) && (a[1] <= b[0] || b[1] <= a[0]) => Ok(()),
        _ => Err("INVALID_ARGUMENT: provide two non-overlapping UTC periods, each with start < end; or set both periods to null for automatic windows".into()),
    }
}

pub(super) fn resolve_periods(i: &Input, c: &mut Config) -> Result<(), String> {
    if c.kind != "period" || c.period_a.is_some() {
        return Ok(());
    }
    let t = i.num("time")?;
    let (lo, hi): (Option<f64>, Option<f64>) = i
        .c()
        .query_row(
            &format!("SELECT min({t}),max({t}) FROM analytic_input"),
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    let lo = lo.unwrap_or(0.);
    let hi = hi.unwrap_or(lo);
    // Include the final sample without assigning a boundary sample twice.
    // Degenerate single-instant scopes get two adjacent half-second windows.
    let (lo, mid, end) = if hi > lo {
        (lo, lo + (hi - lo) / 2., hi.next_up())
    } else {
        (lo - 0.5, lo, lo + 0.5)
    };
    // Adjacent representable instants may have no representable midpoint.
    let mid = if mid <= lo { hi } else { mid };
    c.period_a = Some([lo, mid]);
    c.period_b = Some([mid, end]);
    validate_periods(c)
}

pub(super) fn prepare_period(i: &Input, c: &Config, x: &str, v: &str) -> Result<(), String> {
    let a = c.period_a.ok_or("Missing comparison period A")?;
    let b = c.period_b.ok_or("Missing comparison period B")?;
    let t = i.num("time")?;
    i.c().execute(
        &format!("CREATE TEMP TABLE chart_input AS
            SELECT event_id,{x} AS x,0 AS g,{v} AS v,NULL AS v2 FROM analytic_input WHERE {t}>=? AND {t}<?
            UNION ALL SELECT event_id,{x},1,{v},NULL FROM analytic_input WHERE {t}>=? AND {t}<?"),
        params![a[0], a[1], b[0], b[1]],
    ).map_err(err)?;
    Ok(())
}

fn aggregate(c: &Config) -> String {
    functions::aggregate_sql(&c.aggregate, "v")
}

pub(super) fn heatmap_rows(
    i: &Input,
    c: &Config,
    valid: &str,
    count: u64,
) -> Result<Vec<Value>, String> {
    if count == 0 {
        return Ok(vec![]);
    }
    let y = if c.aggregate == "count" {
        "coalesce(a.y,0)"
    } else {
        "a.y"
    };
    i.rows(
        &format!(
            "WITH RECURSIVE hours(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM hours WHERE x<23),
        days(g) AS (SELECT 0 UNION ALL SELECT g+1 FROM days WHERE g<6),
        a AS (SELECT x,g,{} AS y,count(*) AS count FROM chart_input WHERE {valid} GROUP BY x,g)
        SELECT hours.x,days.g AS series,{y} AS y,coalesce(a.count,0) AS count
        FROM days CROSS JOIN hours LEFT JOIN a ON a.x=hours.x AND a.g=days.g
        ORDER BY days.g,hours.x LIMIT ?",
            aggregate(c)
        ),
        vec![Sql::Integer(c.limit as i64)],
        c.limit,
    )
}

pub(super) fn period_rows(i: &Input, c: &Config, valid: &str) -> Result<Vec<Value>, String> {
    // Keep paired marks together even when the display budget is odd.
    let y = if c.aggregate == "count" {
        "coalesce(a.y,0)"
    } else {
        "a.y"
    };
    let mut rows = i.rows(
        &format!(
            "WITH groups AS (
        SELECT x FROM chart_input WHERE {valid} GROUP BY x ORDER BY x LIMIT ?),
        periods(g) AS (VALUES(0),(1)),
        a AS (SELECT x,g,{} AS y,count(*) AS count FROM chart_input WHERE {valid} GROUP BY x,g)
        SELECT groups.x,periods.g AS series,{y} AS y,coalesce(a.count,0) AS count
        FROM groups CROSS JOIN periods LEFT JOIN a ON a.x IS groups.x AND a.g=periods.g
        ORDER BY groups.x,periods.g",
            aggregate(c)
        ),
        vec![Sql::Integer((c.limit / 2) as i64)],
        c.limit,
    )?;
    for pair in rows.as_chunks_mut::<2>().0 {
        let before = pair[0]["y"].as_f64();
        let after = pair[1]["y"].as_f64();
        let delta = before.zip(after).map(|(a, b)| b - a);
        let percent = before
            .zip(delta)
            .filter(|(a, _)| *a != 0.)
            .map(|(a, d)| (d / a.abs()) * 100.);
        if delta.is_some_and(|v| !v.is_finite()) || percent.is_some_and(|v| !v.is_finite()) {
            return Err(
                "RESOURCE_LIMIT: period comparison numeric range; rescale the measurement".into(),
            );
        }
        for row in pair {
            row["before"] = json!(before);
            row["after"] = json!(after);
            row["change"] = json!(delta);
            row["percent_change"] = json!(percent);
        }
    }
    Ok(rows)
}

pub(super) fn period_warnings(c: &Config, warnings: &mut Vec<String>) {
    if c.kind == "heatmap" {
        warnings.push("UTC weekday/hour bins count recorded Events, not independent entities or inferred activity. Empty count cells mean zero recorded Events; other calculations leave empty cells missing.".into());
    }
    if c.kind == "period" {
        warnings.push("Period starts are inclusive; ends are exclusive. Percentage change is (B-A)/abs(A) × 100; it is undefined when A is zero or either measurement is missing. Counts and totals are not duration-normalized.".into());
        if let (Some(a), Some(b)) = (c.period_a, c.period_b) {
            let da = crate::timestamps::seconds_between(a[1], a[0]);
            let db = crate::timestamps::seconds_between(b[1], b[0]);
            if (da - db).abs() > da.max(db) * 1e-9 {
                warnings.push("The comparison periods have different durations; compare counts or totals with care.".into());
            }
        }
    }
}
