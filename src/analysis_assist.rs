//! Compact, deterministic analysis advice shared by chat, CLI/MCP and App Intents.
use crate::engine::Engine;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Recommendation {
    pub pattern: String,
    pub eligible: bool,
    pub reason: String,
    pub required_parameters: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Context {
    pub revision: u64,
    pub scope: String,
    pub event_count: u64,
    pub located_count: u64,
    pub missing_locations: u64,
    pub located_entity_count: u64,
    pub temporal_tracks: u64,
    pub spatial_tracks: u64,
    pub derived_centroids: u64,
    pub time_bounds: [Option<f64>; 2],
    pub recommendations: Vec<Recommendation>,
    pub semantics: String,
}
#[allow(clippy::too_many_arguments)]
pub fn context(
    revision: u64,
    scope: &str,
    count: u64,
    located: u64,
    entities: u64,
    tracks: u64,
    spatial_tracks: u64,
    derived: u64,
    start: Option<f64>,
    end: Option<f64>,
) -> Value {
    let rec = |pattern: &str, eligible: bool, reason: &str, params: &[&str]| Recommendation {
        pattern: pattern.into(),
        eligible,
        reason: reason.into(),
        required_parameters: params.iter().map(|s| s.to_string()).collect(),
    };
    serde_json::to_value(Context {revision,scope:scope.into(),event_count:count,located_count:located,missing_locations:count-located,located_entity_count:entities,temporal_tracks:tracks,spatial_tracks,derived_centroids:derived,time_bounds:[start,end],recommendations:vec![
 rec("Gaps",tracks>0,"Requires at least one entity with two different timestamps.",&["gap_s"]),
 rec("Speed",spatial_tracks>0,"Track travel speed between located events; not a wind-speed attribute.",&["speed_kmh"]),
 rec("Stationary",spatial_tracks>0,"Located observations of an entity across time; review radius and duration.",&["radius_m","duration_s"]),
 rec("Proximity",located>=2 && entities>=2,"Requires located events from different entities; review distance and time tolerance.",&["radius_m","tolerance_s"]),
 rec("Clusters",located>=3,"At least three located events; the chosen minimum cluster size may require more.",&["radius_m","tolerance_s","min_cluster"])
 ],semantics:"Selected scope intersects current workspace filters. Eligibility indicates usable inputs, not a promise of findings. Spatial analyses use point locations, including explicitly derived polygon centroids; unknown locations stay unknown. Thresholds need domain judgement.".into()}).unwrap()
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub revision: u64,
    pub pattern: String,
    pub scope: String,
    pub parameters: Value,
}
pub fn plan_schema() -> Value {
    // Input schema is deliberately narrow, including the engine's numeric bounds.
    crate::schema::object(
        json!({"revision":{"type":"integer","minimum":0},"pattern":{"enum":["Proximity","Stationary","Gaps","Speed","Clusters"]},"scope":{"enum":["visible","selected"]},"parameters":crate::schema::analysis_parameters()}),
        &["revision", "pattern", "scope", "parameters"],
    )
}
pub fn invoke(engine: &Engine, command: &str, args: Value) -> Result<Value, String> {
    let input = if command == "analysis_execute" {
        &args["plan"]
    } else {
        &args
    };
    let scope = input["scope"].as_str().ok_or("Invalid scope")?;
    let context = engine.invoke("analysis_context", json!({"scope":scope}))?;
    let pattern = input["pattern"].as_str().ok_or("Invalid pattern")?;
    let recommendation = context["recommendations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["pattern"] == pattern)
        .ok_or("Invalid pattern")?;
    if recommendation["eligible"] != true {
        return Err(
            "INVALID_ARGUMENT: selected analysis has insufficient usable inputs in this scope"
                .into(),
        );
    }
    let parameters = input["parameters"].clone();
    for key in recommendation["required_parameters"].as_array().unwrap() {
        let key = key.as_str().unwrap();
        if parameters[key].as_f64().is_none_or(|v| v <= 0.0) {
            return Err(format!(
                "INVALID_ARGUMENT: specify a positive {key} explicitly; no inferred defaults"
            ));
        }
    }
    if pattern == "Clusters"
        && parameters["min_cluster"]
            .as_u64()
            .is_none_or(|n| n < 3 || n > context["located_count"].as_u64().unwrap())
    {
        return Err("INVALID_ARGUMENT: cluster minimum must be at least 3 and no more than the located input count".into());
    }
    let revision = context["revision"].as_u64().unwrap();
    if command == "analysis_prepare" {
        return Ok(json!(Plan {
            revision,
            pattern: pattern.into(),
            scope: scope.into(),
            parameters
        }));
    }
    if input["revision"].as_u64() != Some(revision) {
        return Err("CONFLICT: workspace changed; prepare and review a new analysis plan".into());
    }
    let report=engine.invoke("analyze",json!({"pattern":pattern,"parameters":parameters,"selected_only":scope=="selected","limit":10,"max_events":200000}))?;
    if report["revision"] != revision {
        return Err(
            "CONFLICT: workspace changed before analysis captured its inputs; prepare a new plan"
                .into(),
        );
    }
    let mut remembered = report.clone();
    remembered["pattern"] = json!(pattern);
    remembered["parameters"] = parameters;
    *engine
        .assistant
        .analysis_report
        .lock()
        .map_err(|_| "SI unavailable")? = Some(remembered);
    Ok(report)
}

/// Parse explicit physical quantities. The language model never does arithmetic.
pub fn parameters_from_prompt(pattern: &str, prompt: &str) -> Result<Value, String> {
    use std::sync::OnceLock;
    if prompt.contains('−')
        || prompt
            .as_bytes()
            .windows(3)
            .any(|w| w[0].is_ascii_digit() && w[1] == b',' && w[2].is_ascii_digit())
    {
        return Err("Use positive quantities without digit-grouping commas".into());
    }
    static QUANTITY: OnceLock<regex::Regex> = OnceLock::new();
    let regex=QUANTITY.get_or_init(||regex::Regex::new(r"(?i)\b(-?\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s*-?\s*(km/h|kmh|kph|mph|kilometers?|kilometres?|km|meters?|metres?|hours?|hrs?|minutes?|mins?|milliseconds?|msecs?|ms|microseconds?|usecs?|us|µs|seconds?|secs?|events?|points?|records?|observations?|m|h|s)\b").unwrap());
    let mut distance = vec![];
    let mut time = vec![];
    let mut speed = vec![];
    let mut count = vec![];
    for capture in regex.captures_iter(prompt) {
        // A leading minus belongs to the quantity, even though a regex word boundary skips it.
        let start = capture.get(0).unwrap().start();
        if start > 0 && matches!(prompt.as_bytes()[start - 1], b'-' | b'.') {
            return Err("Specify positive quantities".into());
        }
        let number = capture[1].to_lowercase();
        let value = match number.as_str() {
            "one" => 1.,
            "two" => 2.,
            "three" => 3.,
            "four" => 4.,
            "five" => 5.,
            "six" => 6.,
            "seven" => 7.,
            "eight" => 8.,
            "nine" => 9.,
            "ten" => 10.,
            "eleven" => 11.,
            "twelve" => 12.,
            "fifteen" => 15.,
            "twenty" => 20.,
            _ => number.parse::<f64>().map_err(|_| "Invalid quantity")?,
        };
        if !value.is_finite() || value <= 0. {
            return Err("Specify positive finite quantities".into());
        }
        let unit = capture[2].to_lowercase();
        match unit.as_str() {
            "km/h" | "kmh" | "kph" => speed.push(value),
            "mph" => speed.push(value * 1.609344),
            "km" | "kilometer" | "kilometers" | "kilometre" | "kilometres" => {
                distance.push(value * 1000.)
            }
            "m" | "meter" | "meters" | "metre" | "metres" => distance.push(value),
            "h" | "hour" | "hours" | "hr" | "hrs" => time.push(value * 3600.),
            "minute" | "minutes" | "min" | "mins" => time.push(value * 60.),
            "s" | "second" | "seconds" | "sec" | "secs" => time.push(value),
            "ms" | "millisecond" | "milliseconds" | "msec" | "msecs" => time.push(value / 1000.),
            "us" | "µs" | "microsecond" | "microseconds" | "usec" | "usecs" => {
                time.push(value / 1_000_000.)
            }
            _ => count.push(value),
        }
    }
    if distance.len() > 1 || time.len() > 1 || speed.len() > 1 || count.len() > 1 {
        return Err("Multiple quantities of the same kind are ambiguous; request one configuration at a time".into());
    }
    let mut result = serde_json::Map::new();
    if let Some(value) = distance.first() {
        result.insert("radius_m".into(), json!(value));
    }
    if let Some(value) = speed.first() {
        result.insert("speed_kmh".into(), json!(value));
    }
    if let Some(value) = time.first() {
        if *value > 31557600000. {
            return Err("Use a positive duration within the supported range".into());
        }
        let field = match pattern {
            "Gaps" => "gap_s",
            "Stationary" => "duration_s",
            _ => "tolerance_s",
        };
        result.insert(field.into(), json!(*value));
    }
    if let Some(value) = count.first() {
        if value.fract() != 0. || *value > 1000000. {
            return Err("Use a whole-number cluster size".into());
        }
        result.insert("min_cluster".into(), json!(*value as u64));
    }
    // Reject quantities unrelated to the requested analysis instead of silently dropping them.
    let allowed = match pattern {
        "Gaps" => vec!["gap_s"],
        "Speed" => vec!["speed_kmh"],
        "Stationary" => vec!["radius_m", "duration_s"],
        "Proximity" => vec!["radius_m", "tolerance_s"],
        "Clusters" => vec!["radius_m", "tolerance_s", "min_cluster"],
        _ => return Err("Unsupported analysis".into()),
    };
    if result.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err("Some quantities do not match this analysis; clarify the request".into());
    }
    Ok(Value::Object(result))
}

/// Explicit command wording uses a stable route; local AI handles paraphrases only.
pub fn explicit_request_kind(prompt: &str) -> Option<&'static str> {
    let p = prompt.to_lowercase();
    if p.split(|c: char| !c.is_alphabetic())
        .any(|word| matches!(word, "wind" | "winds"))
    {
        return Some("unsupported");
    }
    if p.contains("recommend")
        || p.contains("suggest")
        || p.contains("which analys")
        || p.contains("what can i analy")
    {
        return Some("recommend");
    }
    if p.contains("explain") {
        return Some("explain");
    }
    let candidates = [
        ("gaps", p.contains("gap")),
        ("speed", p.contains("speed")),
        ("stationary", p.contains("stationary")),
        (
            "proximity",
            p.contains("proximity") || p.contains("each other"),
        ),
        ("clusters", p.contains("cluster")),
    ];
    let matches = candidates
        .into_iter()
        .filter(|(_, found)| *found)
        .collect::<Vec<_>>();
    if matches.len() == 1 {
        Some(matches[0].0)
    } else {
        None
    }
}

/// Keep explanation context bounded even when entity names contain long Unicode text.
pub fn explanation_evidence(report: &Value, current_revision: &Value) -> Value {
    let mut text_limited = false;
    let findings = report["findings"]
        .as_array()
        .into_iter()
        .flatten()
        .take(3)
        .map(|finding| {
            let mut excerpt = |field: &str| {
                let original = finding[field].as_str().unwrap_or("");
                let text: String = original
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(160)
                    .collect();
                text_limited |= text != original;
                text
            };
            json!({"summary":excerpt("summary"),"metric":excerpt("metric")})
        })
        .collect::<Vec<_>>();
    json!({"analysis_revision":report["revision"],"workspace_changed":report["revision"]!=*current_revision,"pattern":report["pattern"],"thresholds":report["parameters"],"input_count":report["input_count"],"evaluated_count":report["evaluated_count"],"finding_count":report["count"],"input_limited":report["input_limited"],"limited":report["limited"],"shown_findings":findings,"excerpt_limited":report["count"].as_u64().unwrap_or(0)>3 || text_limited})
}
