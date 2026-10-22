//! User-declared field semantics. These annotations never coerce stored data.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Measurement,
    Category,
    Identifier,
    Timestamp,
    Coordinate,
    Unit,
    Ignore,
}
pub type Roles = BTreeMap<String, Role>;

pub fn validate(roles: &Roles) -> Result<(), String> {
    if roles.len() > 512
        || roles.keys().any(|k| k.is_empty() || k.len() > 8192)
        || roles.keys().map(String::len).sum::<usize>() > 256 * 1024
    {
        return Err(
            "INVALID_ARGUMENT: field roles support up to 512 fields and 256 KiB of field names"
                .into(),
        );
    }
    Ok(())
}

pub fn numeric_canonical(field: &str) -> bool {
    matches!(field, "value" | "lat" | "lon" | "time" | "end" | "year_utc")
}

pub fn schema(nullable: bool) -> serde_json::Value {
    let role = serde_json::json!({"enum":["measurement","category","identifier","timestamp","coordinate","unit","ignore"]});
    serde_json::json!({"type":"object","maxProperties":512,"propertyNames":{"minLength":1,"maxLength":8192},"additionalProperties":if nullable {serde_json::json!({"anyOf":[role,{"type":"null"}]})} else {role}})
}
