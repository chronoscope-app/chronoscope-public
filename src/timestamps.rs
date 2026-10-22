//! UTC timestamps with explicit ambiguity handling and fractional Unix seconds.
//!
//! The wire, SQLite and browser representation is IEEE 754 binary64 seconds.
//! Resolution is magnitude dependent (~0.24 microsecond around 2026), not an
//! arbitrary minute or second bucket. Source attributes retain the original text.
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DateOrder {
    #[default]
    Auto,
    Dmy,
    Mdy,
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TimeEncoding {
    #[default]
    Auto,
    UnixSeconds,
    UnixMilliseconds,
    UnixMicroseconds,
    UnixNanoseconds,
    ExcelSerial,
    Excel1904,
    TimeOfDay,
}
#[derive(Clone, Debug, Default)]
pub struct Options<'a> {
    pub custom: &'a str,
    pub offset_minutes: i32,
    pub order: DateOrder,
    pub encoding: TimeEncoding,
    pub default_date: &'a str,
}
/// Convert a finite epoch to the calendar using its shortest round-trip decimal.
/// This avoids exposing binary subtraction noise as invented nanoseconds in labels.
pub fn datetime(epoch: f64) -> Option<DateTime<Utc>> {
    if !epoch.is_finite() || epoch.abs() > 9_000_000_000_000. {
        return None;
    }
    if epoch.fract() == 0. {
        return DateTime::from_timestamp(epoch as i64, 0);
    }
    let text = epoch.abs().to_string();
    let (whole, fraction) = text.split_once('.').unwrap_or((&text, ""));
    let seconds = whole.parse::<i64>().ok()?;
    let nanos = format!("{fraction:0<9}")[..9].parse::<u32>().ok()?;
    if epoch < 0. {
        if nanos == 0 {
            DateTime::from_timestamp(-seconds, 0)
        } else {
            DateTime::from_timestamp(-seconds - 1, 1_000_000_000 - nanos)
        }
    } else {
        DateTime::from_timestamp(seconds, nanos)
    }
}
fn epoch(t: DateTime<impl chrono::TimeZone>) -> Result<f64, String> {
    if t.timestamp_subsec_nanos() >= 1_000_000_000 {
        return Err("Leap seconds cannot be represented by Unix timestamps".into());
    }
    // Construct the decimal before conversion so there is only one binary64 rounding.
    let secs = t.timestamp();
    let nanos = t.timestamp_subsec_nanos();
    if nanos == 0 {
        return valid(secs as f64);
    }
    let text = if secs < 0 && nanos != 0 {
        format!("-{}.{:09}", -(secs + 1), 1_000_000_000 - nanos)
    } else {
        format!("{secs}.{nanos:09}")
    };
    valid(text.parse().map_err(|_| "Invalid epoch")?)
}
fn valid(timestamp: f64) -> Result<f64, String> {
    datetime(timestamp).ok_or_else(|| "Timestamp is outside the supported calendar".to_string())?;
    Ok(timestamp)
}
fn numeric(s: &str, encoding: TimeEncoding) -> Result<f64, String> {
    if matches!(
        encoding,
        TimeEncoding::ExcelSerial | TimeEncoding::Excel1904
    ) {
        let serial = s.parse::<f64>().map_err(|_| "Invalid Excel date serial")?;
        if !serial.is_finite() || !(-100000. ..=3000000.).contains(&serial) {
            return Err("Excel date serial is out of range".into());
        }
        let base = if encoding == TimeEncoding::Excel1904 {
            24107.
        } else if serial < 60. {
            25568.
        } else {
            25569.
        };
        if encoding == TimeEncoding::ExcelSerial && (60. ..61.).contains(&serial) {
            return Err("Excel's fictitious 1900-02-29 cannot represent a real date".into());
        }
        // Split the day first to avoid cancellation in large serials.
        return valid((serial.floor() - base) * 86400. + serial.rem_euclid(1.) * 86400.);
    }
    let (whole, fraction) = s.split_once('.').unwrap_or((s, ""));
    if s.contains('.') && (fraction.is_empty() || !fraction.bytes().all(|b| b.is_ascii_digit())) {
        return Err("Invalid fractional timestamp".into());
    }
    if whole.trim_start_matches(['-', '+']).is_empty() {
        return Err("Invalid numeric timestamp".into());
    }
    let value = whole
        .parse::<i128>()
        .map_err(|_| "Invalid numeric timestamp")?;
    let digits = whole.trim_start_matches(['-', '+']).len();
    let scale: i128 = match encoding {
        TimeEncoding::UnixMilliseconds => 1000,
        TimeEncoding::UnixMicroseconds => 1000000,
        TimeEncoding::UnixNanoseconds => 1000000000,
        TimeEncoding::Auto => match digits {
            13..=15 => 1000,
            16..=18 => 1000000,
            19.. => 1000000000,
            _ => 1,
        },
        _ => 1,
    };
    // Shift the decimal point as text, then perform one binary64 conversion.
    // This keeps equivalent seconds/ms/us/ns inputs identical and avoids first
    // rounding a 19-digit nanosecond integer through a float.
    let scale = scale as u128;
    let magnitude = value.unsigned_abs();
    let seconds = magnitude / scale;
    let places = scale.ilog10() as usize;
    let tail = if places == 0 {
        fraction.to_owned()
    } else {
        format!("{:0places$}{fraction}", magnitude % scale)
    };
    let sign = if s.starts_with('-') { "-" } else { "" };
    valid(
        format!("{sign}{seconds}.{tail}")
            .parse::<f64>()
            .map_err(|_| "Invalid fractional timestamp")?,
    )
}
fn normalize(s: &str) -> String {
    s.trim()
        .replace(['\u{00a0}', '\t'], " ")
        .replace(['年', '月'], "-")
        .replace('日', " ")
        .replace(" at ", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
pub fn date(s: &str, order: DateOrder) -> Result<NaiveDate, String> {
    let s = s.trim();
    if s.len() == 8 && s.bytes().all(|b| b.is_ascii_digit()) {
        if let Ok(d) = NaiveDate::parse_from_str(s, "%Y%m%d") {
            return Ok(d);
        }
    }
    let parts: Vec<_> = s.split(['-', '/', '.', ' ']).collect();
    if parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
    {
        let a = parts[0].parse::<u32>().map_err(|_| "Invalid date")?;
        let b = parts[1].parse::<u32>().map_err(|_| "Invalid date")?;
        let c = parts[2].parse::<u32>().map_err(|_| "Invalid date")?;
        let (year, month, day) = if parts[0].len() == 4 {
            (a as i32, b, c)
        } else {
            if ![2, 4].contains(&parts[2].len()) {
                return Err("Date needs a two- or four-digit year".into());
            }
            let year = if parts[2].len() == 2 {
                if c >= 69 {
                    1900 + c as i32
                } else {
                    2000 + c as i32
                }
            } else {
                c as i32
            };
            let use_dmy = match order {
                DateOrder::Dmy => true,
                DateOrder::Mdy => false,
                DateOrder::Auto => {
                    if a > 12 && b <= 12 {
                        true
                    } else if b > 12 && a <= 12 || a == b {
                        false
                    } else {
                        return Err(format!(
                            "Ambiguous date {s}: choose Day/Month or Month/Day in import settings"
                        ));
                    }
                }
            };
            (
                year,
                if use_dmy { b } else { a },
                if use_dmy { a } else { b },
            )
        };
        return NaiveDate::from_ymd_opt(year, month, day)
            .ok_or_else(|| format!("Invalid calendar date: {s}"));
    }
    let words = s
        .replace([',', '-', '/', '.'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    for format in [
        "%Y %b %d",
        "%Y %B %d",
        "%d %b %Y",
        "%d %B %Y",
        "%b %d %Y",
        "%B %d %Y",
        "%d %b %y",
        "%b %d %y",
        "%a %b %d %Y",
    ] {
        if let Ok(d) = NaiveDate::parse_from_str(&words, format) {
            return Ok(d);
        }
    }
    for format in ["%G-W%V-%u", "%Y-%j"] {
        if let Ok(d) = NaiveDate::parse_from_str(s, format) {
            return Ok(d);
        }
    }
    Err(format!("Unrecognized calendar date: {s}"))
}
fn clock(s: &str) -> Result<(u32, u32, u32, u32, bool), String> {
    let mut s = s
        .trim()
        .to_ascii_uppercase()
        .replace("A.M.", "AM")
        .replace("P.M.", "PM");
    let period = if s.ends_with("AM") {
        s.truncate(s.len() - 2);
        Some(false)
    } else if s.ends_with("PM") {
        s.truncate(s.len() - 2);
        Some(true)
    } else {
        None
    };
    // Compact HMM/HMMSS clocks can lose their leading zero in spreadsheet
    // numeric cells. Interpret them only here, where a clock is expected.
    let s = s.trim();
    let padded = if [3, 5].contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()) {
        format!("0{s}")
    } else {
        s.to_owned()
    };
    let s = padded.as_str();
    let fields: Vec<String> = if s.contains(':') {
        s.split(':').map(str::to_owned).collect()
    } else if [4, 6].contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()) {
        (0..s.len())
            .step_by(2)
            .map(|i| s[i..i + 2].to_owned())
            .collect()
    } else {
        vec![s.into()]
    };
    if fields.len() > 3 {
        return Err("Invalid time of day".into());
    }
    let mut hour = fields[0].parse::<u32>().map_err(|_| "Invalid hour")?;
    let minutes = fields
        .get(1)
        .map(|v| v.parse::<u32>())
        .transpose()
        .map_err(|_| "Invalid minute")?
        .unwrap_or(0);
    let (seconds, nanos) = if let Some(value) = fields.get(2) {
        let (n, f) = value
            .split_once(['.', ','])
            .map(|(a, b)| (a, Some(b)))
            .unwrap_or((value.as_str(), None));
        if f.is_some_and(|f| f.is_empty() || !f.bytes().all(|b| b.is_ascii_digit())) {
            return Err("Invalid seconds fraction".into());
        }
        let ns = f
            .map(|f| format!("{f:0<9}")[..9].parse::<u32>().unwrap())
            .unwrap_or(0);
        (n.parse::<u32>().map_err(|_| "Invalid seconds")?, ns)
    } else {
        (0, 0)
    };
    if let Some(pm) = period {
        if !(1..=12).contains(&hour) {
            return Err("12-hour time must use hours 1–12".into());
        }
        hour = hour % 12 + if pm { 12 } else { 0 };
    }
    if minutes >= 60
        || seconds >= 60
        || hour > 24
        || hour == 24 && (minutes != 0 || seconds != 0 || nanos != 0)
    {
        return Err("Invalid time of day".into());
    }
    Ok((hour % 24, minutes, seconds, nanos, hour == 24))
}
fn zone(s: &str, default: i32) -> Result<(String, i32), String> {
    let upper = s.to_ascii_uppercase();
    for suffix in [" UTC", " GMT", "Z"] {
        if upper.ends_with(suffix) {
            return Ok((s[..s.len() - suffix.len()].trim().into(), 0));
        }
    }
    if s.contains(':') || s.contains(['T', 't']) {
        for len in [6, 5, 3] {
            if s.len() > len {
                let index = s.len() - len;
                if !s.is_char_boundary(index) {
                    continue;
                }
                let tail = &s[index..];
                if tail.starts_with(['+', '-']) {
                    let digits = tail[1..].replace(':', "");
                    if [2, 4].contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit())
                    {
                        let hour = digits[..2].parse::<i32>().unwrap();
                        let minutes = if digits.len() == 4 {
                            digits[2..].parse::<i32>().unwrap()
                        } else {
                            0
                        };
                        if hour > 23 || minutes >= 60 {
                            return Err("Invalid UTC offset".into());
                        }
                        return Ok((
                            s[..index].trim().into(),
                            (hour * 60 + minutes) * if tail.starts_with('-') { -1 } else { 1 },
                        ));
                    }
                }
            }
        }
    }
    Ok((s.into(), default))
}
fn split(s: &str) -> (&str, &str) {
    if let Some(colon) = s.find(':') {
        let mut start = colon;
        while start > 0 && s.as_bytes()[start - 1].is_ascii_digit() {
            start -= 1;
        }
        return (
            s[..start].trim_end_matches([' ', 'T', 't', ',']),
            s[start..].trim(),
        );
    }
    if let Some((a, b)) = s.split_once(['T', 't']) {
        if b.bytes().all(|v| v.is_ascii_digit()) {
            return (a, b);
        }
    }
    if let Some((day, time)) = s.rsplit_once(' ') {
        if [4, 6].contains(&time.len())
            && time.bytes().all(|b| b.is_ascii_digit())
            && [DateOrder::Auto, DateOrder::Dmy, DateOrder::Mdy]
                .into_iter()
                .any(|o| date(day, o).is_ok())
        {
            return (day, time);
        }
    }
    let upper = s.to_ascii_uppercase();
    if upper.ends_with("AM")
        || upper.ends_with("PM")
        || upper.ends_with("A.M.")
        || upper.ends_with("P.M.")
    {
        let suffix = if upper.ends_with("M.") { 4 } else { 2 };
        let body = s[..s.len() - suffix].trim_end();
        if let Some(i) = body.rfind(' ') {
            return (body[..i].trim(), s[i + 1..].trim());
        }
        return ("", s);
    }
    (s, "")
}
pub fn parse(s: &str, options: &Options<'_>) -> Result<f64, String> {
    let s = normalize(s);
    if s.is_empty() {
        return Err("Timestamp is empty".into());
    }
    if !options.custom.is_empty() {
        if let Ok(t) = DateTime::parse_from_str(&s, options.custom) {
            return epoch(t);
        }
        if let Ok(t) = NaiveDateTime::parse_from_str(&s, options.custom) {
            return valid(epoch(t.and_utc())? - f64::from(options.offset_minutes) * 60.);
        }
        if let Ok(d) = NaiveDate::parse_from_str(&s, options.custom) {
            return valid(
                epoch(d.and_hms_opt(0, 0, 0).unwrap().and_utc())?
                    - f64::from(options.offset_minutes) * 60.,
            );
        }
        if let Ok(t) = NaiveTime::parse_from_str(&s, options.custom) {
            let d = date(options.default_date, DateOrder::Auto)?;
            return valid(
                epoch(d.and_time(t).and_utc())? - f64::from(options.offset_minutes) * 60.,
            );
        }
        return Err(format!(
            "Timestamp does not match custom format {}: {s}",
            options.custom
        ));
    }
    if options.encoding == TimeEncoding::TimeOfDay {
        if options.default_date.is_empty() {
            return Err("Time-only values require a default date or a separate date column".into());
        }
        return parse_fields(
            options.default_date,
            Some(&s),
            &Options {
                encoding: TimeEncoding::Auto,
                ..options.clone()
            },
        );
    }
    if options.encoding != TimeEncoding::Auto {
        let value = numeric(&s, options.encoding)?;
        return if matches!(
            options.encoding,
            TimeEncoding::ExcelSerial | TimeEncoding::Excel1904
        ) {
            valid(value - f64::from(options.offset_minutes) * 60.)
        } else {
            Ok(value)
        };
    }
    if let Ok(t) = DateTime::parse_from_rfc3339(&s) {
        return epoch(t);
    }
    if let Ok(t) = DateTime::parse_from_rfc2822(&s) {
        return epoch(t);
    }
    if s.bytes().all(|b| b.is_ascii_digit()) && [12, 14].contains(&s.len()) {
        let format = if s.len() == 12 {
            "%Y%m%d%H%M"
        } else {
            "%Y%m%d%H%M%S"
        };
        if let Ok(t) = NaiveDateTime::parse_from_str(&s, format) {
            return valid(epoch(t.and_utc())? - f64::from(options.offset_minutes) * 60.);
        }
    }
    if let Ok(d) = date(&s, options.order) {
        return valid(
            epoch(d.and_hms_opt(0, 0, 0).unwrap().and_utc())?
                - f64::from(options.offset_minutes) * 60.,
        );
    }
    if !options.default_date.is_empty()
        && [4, 6].contains(&s.len())
        && s.bytes().all(|v| v.is_ascii_digit())
    {
        return parse_fields(
            options.default_date,
            Some(&s),
            &Options {
                default_date: "",
                ..options.clone()
            },
        );
    }
    if s.trim_start_matches(['-', '+'])
        .bytes()
        .all(|b| b.is_ascii_digit() || b == b'.')
    {
        return numeric(&s, TimeEncoding::Auto);
    }
    let (value, offset) = zone(&s, options.offset_minutes)?;
    let (day, clock_text) = split(&value);
    let day = if day.is_empty() {
        options.default_date
    } else {
        day
    };
    let d = date(day, options.order)?;
    if clock_text.is_empty() {
        return Err(format!("Unrecognized timestamp: {s}. Map a date column or provide a default date for time-only values."));
    }
    let (hour, minutes, seconds, nanos, next_day) = clock(clock_text)?;
    let d = if next_day {
        d.succ_opt().ok_or("Date overflow")?
    } else {
        d
    };
    valid(
        epoch(
            d.and_hms_nano_opt(hour, minutes, seconds, nanos)
                .ok_or("Invalid time of day")?
                .and_utc(),
        )? - f64::from(offset) * 60.,
    )
}
/// Full ISO start/end intervals used by event standards such as Darwin Core.
/// Slash-separated calendar dates are left to the ordinary date parser.
pub fn parse_interval(s: &str, options: &Options<'_>) -> Result<Option<(f64, f64)>, String> {
    if !options.custom.is_empty() || options.encoding != TimeEncoding::Auto {
        return Ok(None);
    }
    let text = s.trim();
    // ISO year-month events describe the whole month, rather than a
    // measured event at an invented midnight on its first day. End is inclusive
    // using the last representable instant before the next month.
    let bytes = text.as_bytes();
    if bytes.len() == 7
        && bytes[4] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..].iter().all(u8::is_ascii_digit)
    {
        let first = date(&format!("{text}-01"), options.order)?;
        let next = first
            .checked_add_months(chrono::Months::new(1))
            .ok_or("Month overflow")?;
        let start = parse(&first.to_string(), options)?;
        let end = previous(parse(&next.to_string(), options)?);
        return Ok(Some((start, end)));
    }
    let Some((start, end)) = text.split_once('/') else {
        return Ok(None);
    };
    let iso = |value: &str| {
        let b = value.trim().as_bytes();
        b.len() >= 10 && b.get(4) == Some(&b'-') && b[..4].iter().all(u8::is_ascii_digit)
    };
    if !iso(start) {
        return Ok(None);
    }
    if !iso(end) || end.contains('/') {
        return Err("Event intervals require full ISO start and end timestamps".into());
    }
    let start = parse(start, options)?;
    let end = parse(end, options)?;
    if end < start {
        return Err("Event interval ends before it starts".into());
    }
    Ok(Some((start, end)))
}
pub fn parse_fields(day: &str, time: Option<&str>, options: &Options<'_>) -> Result<f64, String> {
    let Some(time) = time.filter(|v| !v.trim().is_empty()) else {
        return parse(day, options);
    };
    let day = normalize(day);
    let time = normalize(time);
    if !options.custom.is_empty() {
        if let Ok(t) = parse(&format!("{day} {time}"), options) {
            return Ok(t);
        }
    }
    let day_text = split(&day).0;
    let d = if !options.custom.is_empty() {
        NaiveDate::parse_from_str(day_text, options.custom)
            .map_err(|_| "Date column does not match custom format")?
    } else if !matches!(
        options.encoding,
        TimeEncoding::Auto | TimeEncoding::TimeOfDay
    ) {
        datetime(numeric(&day, options.encoding)?)
            .unwrap()
            .date_naive()
    } else {
        date(day_text, options.order)?
    };
    let time_text = split(&time);
    let value = if time_text.1.is_empty() {
        time.as_str()
    } else {
        time_text.1
    };
    let (value, offset) = zone(value, options.offset_minutes)?;
    let (hour, minutes, seconds, nanos, next_day) = if let Ok(n) = value.parse::<f64>() {
        if (0. ..1.).contains(&n) {
            let total = (n * 86_400_000_000_000.).round() as u64;
            let secs = (total / 1_000_000_000) as u32;
            (
                (secs / 3600) % 24,
                (secs / 60) % 60,
                secs % 60,
                (total % 1_000_000_000) as u32,
                secs == 86400,
            )
        } else {
            clock(&value)?
        }
    } else {
        clock(&value)?
    };
    let d = if next_day {
        d.succ_opt().ok_or("Date overflow")?
    } else {
        d
    };
    valid(
        epoch(
            d.and_hms_nano_opt(hour, minutes, seconds, nanos)
                .ok_or("Invalid time of day")?
                .and_utc(),
        )? - f64::from(offset) * 60.,
    )
}
/// Evidence from numeric D/M dates. Never resolve conflicting or ambiguous samples silently.
pub fn infer_order<'a>(values: impl Iterator<Item = &'a str>) -> DateOrder {
    let mut dmy = false;
    let mut mdy = false;
    for s in values {
        let s = normalize(s);
        let first = split(&s).0;
        let p: Vec<_> = first.split(['/', '-', '.', ' ']).collect();
        if p.len() != 3 || p[0].len() == 4 {
            continue;
        }
        if let (Ok(a), Ok(b)) = (p[0].parse::<u32>(), p[1].parse::<u32>()) {
            dmy |= a > 12 && a <= 31 && b <= 12;
            mdy |= b > 12 && b <= 31 && a <= 12;
        }
    }
    match (dmy, mdy) {
        (true, false) => DateOrder::Dmy,
        (false, true) => DateOrder::Mdy,
        _ => DateOrder::Auto,
    }
}
/// Canonical UTC projections; these never change source timestamps or attributes.
pub fn utc_time(epoch: f64) -> Option<String> {
    datetime(epoch).map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true))
}
pub fn utc_year(epoch: f64) -> Option<i32> {
    use chrono::Datelike;
    datetime(epoch).map(|d| d.year())
}

/// Immediately preceding representable timestamp, for inclusive calendar interval ends.
fn previous(t: f64) -> f64 {
    if t == 0. {
        -1e-9
    } else {
        f64::from_bits(if t > 0. {
            t.to_bits() - 1
        } else {
            t.to_bits() + 1
        })
    }
}

/// Duration between canonical decimal instants, without subtracting two large
/// floating epochs first. In particular, consecutive imported microseconds must
/// yield one microsecond, not binary epoch-cancellation noise in a speed result.
/// This does not recover source detail lost to binary64 representation.
pub fn seconds_between(end: f64, start: f64) -> f64 {
    if end.fract() == 0. && start.fract() == 0. {
        return end - start;
    }
    if let Some((a, b)) = datetime(end).zip(datetime(start)) {
        let nanos = (i128::from(a.timestamp()) - i128::from(b.timestamp())) * 1_000_000_000
            + i128::from(a.timestamp_subsec_nanos())
            - i128::from(b.timestamp_subsec_nanos());
        if nanos != 0 || end == start {
            return nanos as f64 / 1_000_000_000.;
        }
    }
    end - start
}
