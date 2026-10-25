//! Bounded desktop automation and interactive result contracts.
use super::*;

pub(super) fn input(command: &str) -> Value {
    let name = json!({"type":"string","minLength":1,"maxLength":80,"pattern":"^[A-Za-z0-9][A-Za-z0-9 _.-]*$"});
    let id = json!({"type":"string","minLength":1,"maxLength":80});
    let branch = |action: &str, props: Value, required: &[&str]| {
        let mut props = props;
        props["action"] = json!({"const":action});
        let mut required = required.to_vec();
        required.push("action");
        object(props, &required)
    };
    let variants = match command {
        "view_profile" => vec![
            branch(
                "start",
                json!({"max_seconds":{"type":"number","minimum":1,"maximum":120}}),
                &[],
            ),
            branch("status", json!({"id":id}), &["id"]),
            branch("stop", json!({"id":id}), &["id"]),
        ],
        "view_wait" => {
            return object(
                json!({"timeout_ms":integer(100,10000),"stable_ms":integer(0,2000),"imagery":boolean(),"terrain":boolean(),"effects":boolean(),"gis":boolean()}),
                &[],
            )
        }
        "view_playback" => vec![
            branch("status", json!({}), &[]),
            branch("play", json!({}), &[]),
            branch("pause", json!({}), &[]),
            branch(
                "configure",
                json!({"speed":{"enum":[0.25,0.5,0.75,1,1.25,1.5,1.75,2]},"increment_seconds":{"enum":[0.001,1,60,3600,86400,604800]}}),
                &[],
            ),
            branch("seek", json!({"time":number()}), &["time"]),
            branch("step", json!({"steps":integer(-100,100)}), &["steps"]),
        ],
        "view_scenario" => {
            let commands: Vec<Value> = ["view_set", "view_navigate", "view_wait", "view_playback"].iter().map(|command| object(json!({"command":{"const":command},"arguments":command_schema(command).unwrap()}), &["command","arguments"])).chain(std::iter::once(object(json!({"command":{"const":"wait"},"arguments":object(json!({"milliseconds":integer(1,5000)}), &["milliseconds"])}), &["command","arguments"]))).collect();
            let steps =
                json!({"type":"array","minItems":1,"maxItems":80,"items":{"oneOf":commands}});
            vec![
                branch(
                    "save",
                    json!({"name":name,"steps":steps,"overwrite":boolean()}),
                    &["name", "steps"],
                ),
                branch("list", json!({}), &[]),
                branch("remove", json!({"name":name}), &["name"]),
                branch(
                    "run",
                    json!({"name":name,"timeout_seconds":{"type":"number","minimum":1,"maximum":120}}),
                    &["name"],
                ),
                branch("status", json!({"id":id}), &["id"]),
                branch("cancel", json!({"id":id}), &["id"]),
            ]
        }
        _ => unreachable!(),
    };
    json!({"type":"object","oneOf":variants})
}
