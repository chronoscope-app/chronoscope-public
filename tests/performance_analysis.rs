use chronoscope::analysis::{self, Parameters, Pattern};
#[test]
fn c18_dense_single_track_100k_does_not_allocate_pair_work() {
    let mut event = chronoscope::demo::dataset().events.remove(0);
    event.entity = "one".into();
    event.attrs.clear();
    event.time = 0.0;
    event.end = None;
    let rows = (0..100000)
        .map(|id| {
            let mut e = event.clone();
            e.id = id;
            e
        })
        .collect::<Vec<_>>();
    let result = analysis::run(&rows, Pattern::Proximity, &Parameters::default());
    assert!(result.findings.is_empty());
    assert!(!result.limited);
    assert_eq!(result.candidate_visits, 0);
}
