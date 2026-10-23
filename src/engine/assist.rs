//! Capture bounded source evidence before inference; never hold the workspace during AI work.
use super::*;
impl Engine {
    pub(crate) fn assist_tag_input(&self, args: &Value) -> Result<Value, String> {
        if let Some(name) = args["field"]
            .as_str()
            .and_then(|f| f.strip_prefix("attribute:"))
        {
            let schema = self.invoke(
                "dataset_schema",
                json!({"attribute_search":name,"attribute_limit":512}),
            )?;
            if !schema["attributes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|value| value.as_str() == Some(name))
            {
                return Err("INVALID_ARGUMENT: unknown imported text field".into());
            }
        }
        let workspace = self.workspace_identity()?;
        let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
        if args["expected_revision"].as_u64() != Some(s.revision) {
            return Err("CONFLICT: selection or data changed; reopen tag suggestions".into());
        }
        let ids: Vec<String> = arg(args, "ids")?;
        if ids.is_empty() || ids.len() > 25 {
            return Err("INVALID_ARGUMENT: choose between 1 and 25 Events".into());
        }
        let unique: BTreeSet<_> = ids.iter().collect();
        if unique.len() != ids.len() {
            return Err("INVALID_ARGUMENT: duplicate Event IDs".into());
        }
        let field = args["field"].as_str().unwrap();
        let mut records = vec![];
        for id in ids {
            let e = s
                .store
                .get(id.parse().map_err(|_| "Invalid Event ID")?)?
                .ok_or("NOT_FOUND: Event no longer exists")?;
            let text = match field {
                "note" => e.note.clone(),
                "label" => e.label.clone(),
                _ => e
                    .attrs
                    .get(field.strip_prefix("attribute:").ok_or(
                        "INVALID_ARGUMENT: choose note, label or an imported text attribute",
                    )?)
                    .cloned()
                    .unwrap_or_default(),
            };
            if text.len() > 4000 {
                return Err("RESOURCE_LIMIT: an Event's text exceeds 4,000 bytes; choose a shorter text field".into());
            }
            records.push(json!({"id":id,"text":text,"existing_tags":e.tags,"tags":[],"skipped":text.trim().is_empty()}));
        }
        Ok(json!({"revision":s.revision,"workspace_id":workspace,"field":field,"records":records}))
    }
    pub(crate) fn assist_pattern_input(&self, args: &Value) -> Result<Value, String> {
        let s = self.state.lock().map_err(|_| "Workspace unavailable")?;
        let cache = self
            .pattern_cache
            .lock()
            .map_err(|_| "Pattern cache unavailable")?;
        let id = args["scan_id"].as_str().unwrap();
        let cached = cache
            .get(id)
            .ok_or("CONFLICT: finding expired; run Find patterns again")?;
        if patterns::key(&s, &cached.config)? != id {
            return Err(
                "CONFLICT: finding's data or scope changed; run Find patterns again".into(),
            );
        }
        let f = cached
            .report
            .findings
            .iter()
            .find(|f| Some(f.id.as_str()) == args["finding_id"].as_str())
            .ok_or("NOT_FOUND: finding is absent from this scan")?;
        Ok(
            json!({"source_revision":s.revision,"scope":cached.config.scope,"input_count":cached.report.input_count,"sampled":cached.report.sampled,"finding":{"title":f.title,"summary":f.summary,"method":f.method,"metrics":f.metrics,"count":f.count,"denominator":f.denominator},"warnings":cached.report.warnings}),
        )
    }
}
