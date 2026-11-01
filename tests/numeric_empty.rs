use chronoscope::{
    model::{Filter, Operator, Predicate},
    store::DataStore,
};

#[test]
fn numeric_empty_checks_match_original_canonical_text_predicates() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    let template = chronoscope::demo::dataset().events.remove(0);
    store
        .load_events(
            [None, Some(0.), Some(-0.), Some(1.25), Some(-1.25)]
                .into_iter()
                .enumerate()
                .map(|(i, value)| {
                    let mut e = template.clone();
                    e.id = i as u64 + 1;
                    e.time = i as f64;
                    e.end = None;
                    e.geometry_wkt = None;
                    e.location_kind = None;
                    e.mgrs_precision = None;
                    e.lat = value;
                    e.lon = value;
                    e.value = value;
                    e.attrs
                        .insert("lat".into(), if i == 0 { "" } else { " " }.into());
                    e
                }),
        )
        .unwrap();
    for field in ["lat", "lon", "value"] {
        for op in [Operator::Equals, Operator::NotEquals, Operator::IsEmpty] {
            for value in ["", "ignored"] {
                if op != Operator::IsEmpty && !value.is_empty() {
                    continue;
                }
                let filter = Filter {
                    predicates: vec![Predicate {
                        field: field.into(),
                        op: op.clone(),
                        value: value.into(),
                    }],
                    ..Filter::default()
                };
                let table = store.ordered(&filter, None, "time", false).unwrap();
                let expr = format!("coalesce(canonical_number(e.{field},e.payload,'{field}'),'')");
                let comparison = match op {
                    Operator::IsEmpty => format!("unicode_trim({expr})=''"),
                    Operator::Equals => format!("{expr}=''"),
                    _ => format!("{expr}<>''"),
                };
                let mut q = store
                    .connection
                    .prepare(&format!(
                        "SELECT e.id FROM events e WHERE {comparison} ORDER BY e.time,e.id_key"
                    ))
                    .unwrap();
                let expected = q
                    .query_map([], |r| r.get::<_, String>(0))
                    .unwrap()
                    .map(|r| r.unwrap().parse::<u64>().unwrap())
                    .collect::<Vec<_>>();
                assert_eq!(
                    store.ids(&table).unwrap(),
                    expected,
                    "{field} {op:?} {value:?}"
                );
            }
        }
    }
    // Attribute text and nonempty numeric comparisons retain their own semantics.
    for (field, op, value, count) in [
        ("attribute:lat", Operator::IsEmpty, "", 5),
        ("lat", Operator::Contains, "", 5),
        ("lat", Operator::Equals, "0", 2),
        ("lat", Operator::Equals, " ", 0),
    ] {
        let filter = Filter {
            predicates: vec![Predicate {
                field: field.into(),
                op,
                value: value.into(),
            }],
            ..Filter::default()
        };
        let table = store.ordered(&filter, None, "time", false).unwrap();
        assert_eq!(store.table_count(&table).unwrap(), count);
    }
}
