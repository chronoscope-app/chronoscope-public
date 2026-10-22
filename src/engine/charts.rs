use super::*;
use crate::{analytics::Input, charts};
impl Engine {
    pub(super) fn chart_read(&self, args: &Value) -> Result<(Input, charts::Config, u64), String> {
        let config: charts::Config = serde_json::from_value(args["config"].clone())
            .map_err(|e| format!("INVALID_ARGUMENT: {e}"))?;
        config.validate()?;
        let (read, filter, selection, revision) = {
            let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
            if args["expected_revision"]
                .as_u64()
                .is_some_and(|r| r != s.revision)
            {
                return Err("CONFLICT: chart source changed; refresh the chart".into());
            }
            let scope = json!({"apply_filter":config.scope!="all","selected_only":config.scope=="selected"});
            (
                s.store.analytics_read()?,
                query_filter(&s.project, &scope, true)?,
                s.project.selected.clone(),
                s.revision,
            )
        };
        let mut plan = config.plan();
        let numeric_y = config.aggregate != "count"
            || ["scatter", "histogram", "boxplot"].contains(&config.kind.as_str());
        if (config.kind != "histogram" && config.x == "value")
            || (numeric_y && (config.y == "value" || config.y2 == "value"))
        {
            for name in ["value_unit", "value_description"] {
                let exists: bool = read
                    .connection
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM attributes WHERE key=?)",
                        [name],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if exists {
                    plan.parameters["fields"]
                        .as_array_mut()
                        .unwrap()
                        .push(json!(format!("attribute:{name}")));
                }
            }
        }
        let input = Input::build(read, &filter, config.source.as_deref(), &selection, &plan)?;
        Ok((input, config, revision))
    }
    pub(super) fn chart_invoke(&self, args: Value) -> Result<Value, String> {
        let _worker = loop {
            crate::operation::check()?;
            match self.analytics_worker.try_lock() {
                Ok(g) => break g,
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
                Err(_) => return Err("Analytics worker unavailable".into()),
            }
        };
        let (input, config, revision) = self.chart_read(&args)?;
        serde_json::to_value(charts::report(&input, config, revision)?).map_err(|e| e.to_string())
    }
    pub(super) fn chart_members(&self, args: &Value) -> Result<(BTreeSet<u64>, u64), String> {
        let _worker = loop {
            crate::operation::check()?;
            match self.analytics_worker.try_lock() {
                Ok(g) => break g,
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
                Err(_) => return Err("Analytics worker unavailable".into()),
            }
        };
        let (input, config, revision) = self.chart_read(args)?;
        let ids = charts::members(
            &input,
            &config,
            args["chart_marks"]
                .as_array()
                .ok_or("INVALID_ARGUMENT: chart_marks required")?,
        )?;
        Ok((ids, revision))
    }
}
