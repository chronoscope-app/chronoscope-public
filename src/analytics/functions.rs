//! Shared disk-backed calculation primitives for charts and analytics.
use accurate::{sum::Neumaier, traits::SumAccumulator};
use chrono::{Datelike, Timelike};
use rusqlite::{
    functions::{Aggregate, Context, FunctionFlags},
    Connection,
};

fn range_error(message: &str) -> rusqlite::Error {
    rusqlite::Error::UserFunctionError(
        format!("RESOURCE_LIMIT: {message}; rescale numeric inputs").into(),
    )
}

/// Type-7/inclusive quantiles. Keep this definition explicit: library defaults
/// (including statrs' default quantile) need not use the same interpolation.
pub(crate) fn quantile_rank(count: u64, probability: f64) -> f64 {
    (count - 1) as f64 * probability
}

pub(crate) fn histogram_width(lo: f64, hi: f64, bins: u32) -> Result<f64, String> {
    let width = (hi - lo) / f64::from(bins);
    if !width.is_finite() || (hi > lo && width <= 0.) {
        return Err("RESOURCE_LIMIT: histogram numeric range; rescale field".into());
    }
    Ok(width)
}

pub(crate) fn aggregate_sql(op: &str, field: &str) -> String {
    match op {
        "count" => "count(*)".into(),
        "sum" => format!("an_sum({field})"),
        "mean" => format!("an_mean({field})"),
        _ => format!("{op}({field})"),
    }
}

struct Compensated {
    mean: bool,
}
struct Accumulator {
    sum: Neumaier<f64>,
    count: u64,
}
impl Aggregate<Accumulator, Option<f64>> for Compensated {
    fn init(&self, _: &mut Context<'_>) -> rusqlite::Result<Accumulator> {
        Ok(Accumulator {
            sum: Neumaier::zero(),
            count: 0,
        })
    }
    fn step(&self, ctx: &mut Context<'_>, acc: &mut Accumulator) -> rusqlite::Result<()> {
        if let Some(value) = ctx.get::<Option<f64>>(0)? {
            acc.sum += value;
            acc.count += 1;
        }
        Ok(())
    }
    fn finalize(
        &self,
        _: &mut Context<'_>,
        acc: Option<Accumulator>,
    ) -> rusqlite::Result<Option<f64>> {
        let Some(acc) = acc.filter(|a| a.count > 0) else {
            return Ok(None);
        };
        let sum = acc.sum.sum();
        let value = if self.mean {
            sum / acc.count as f64
        } else {
            sum
        };
        if !sum.is_finite() || !value.is_finite() {
            return Err(range_error("aggregate numeric range"));
        }
        Ok(Some(value))
    }
}

pub(crate) fn register(c: &Connection) -> rusqlite::Result<()> {
    let flags = FunctionFlags::SQLITE_DETERMINISTIC;
    c.create_aggregate_function("an_sum", 1, flags, Compensated { mean: false })?;
    c.create_aggregate_function("an_mean", 1, flags, Compensated { mean: true })?;
    c.create_scalar_function("an_bucket", 2, flags, |ctx| {
        let Some(time) = ctx.get::<Option<f64>>(0)? else {
            return Ok(None);
        };
        let kind = ctx.get::<String>(1)?;
        if kind == "none" {
            return Ok(Some(time));
        }
        if kind == "millisecond" {
            return Ok(Some((time * 1000.).floor() / 1000.));
        }
        // Floor before conversion so negative subnanosecond instants stay in
        // their original second/day/month, without SQLite date rounding.
        let d = crate::timestamps::datetime(time.floor())
            .ok_or_else(|| range_error("calendar instant"))?;
        let date = match kind.as_str() {
            "year" => chrono::NaiveDate::from_ymd_opt(d.year(), 1, 1),
            "month" => chrono::NaiveDate::from_ymd_opt(d.year(), d.month(), 1),
            "week" => d.date_naive().checked_sub_signed(chrono::Duration::days(
                d.weekday().num_days_from_monday() as i64,
            )),
            "day" | "hour" | "minute" | "second" => Some(d.date_naive()),
            _ => {
                return Err(rusqlite::Error::UserFunctionError(
                    "INVALID_ARGUMENT: unsupported UTC bucket".into(),
                ))
            }
        }
        .ok_or_else(|| range_error("calendar bucket outside supported range"))?;
        let hour = if matches!(kind.as_str(), "hour" | "minute" | "second") {
            d.hour()
        } else {
            0
        };
        let minute = if matches!(kind.as_str(), "minute" | "second") {
            d.minute()
        } else {
            0
        };
        let second = if kind == "second" { d.second() } else { 0 };
        Ok(Some(
            date.and_hms_opt(hour, minute, second)
                .unwrap()
                .and_utc()
                .timestamp() as f64,
        ))
    })?;
    c.create_scalar_function("an_quantile_rank", 2, flags, |ctx| {
        Ok(quantile_rank(ctx.get(0)?, ctx.get(1)?))
    })?;
    c.create_scalar_function("an_quantile", 3, flags, |ctx| {
        let lo = ctx.get::<f64>(0)?;
        let hi = ctx.get::<Option<f64>>(1)?.unwrap_or(lo);
        let fraction = ctx.get::<f64>(2)?;
        let value = lo * (1. - fraction) + hi * fraction;
        if !value.is_finite() {
            return Err(range_error("quantile numeric range"));
        }
        Ok(value)
    })?;
    c.create_scalar_function("an_hist_bin", 4, flags, |ctx| {
        let Some(value) = ctx.get::<Option<f64>>(0)? else {
            return Ok(None);
        };
        let lo = ctx.get::<f64>(1)?;
        let width = ctx.get::<f64>(2)?;
        let bins = ctx.get::<u32>(3)?;
        Ok(Some(if width == 0. {
            0
        } else {
            (((value - lo) / width).floor() as u32).min(bins - 1)
        }))
    })?;
    Ok(())
}
