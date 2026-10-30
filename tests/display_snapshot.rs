use chronoscope::{engine::Engine,model::Dataset,project::Project};
use serde_json::json;

#[test]
fn display_only_snapshot_preserves_exact_weighted_cells_without_point_packets() {
 let directory=tempfile::tempdir().unwrap();
 let mut events=chronoscope::demo::dataset().events;events.truncate(3);
 for (i,e) in events.iter_mut().enumerate() {e.id=i as u64+1;e.entity="track".into();e.time=1735689600.+i as f64;e.end=None;e.geometry_wkt=None;e.location_kind=None;e.lat=Some(32.);e.lon=Some(-80.);e.value=Some(i as f64+1.);}
 let engine=Engine::new(Project::new(Dataset{name:"display".into(),events}),directory.path().into()).unwrap();
 engine.invoke("view_set",json!({"mode":"map","display":{"mode":"heatmap","show_points":false,"show_tracks":false,"show_trails":false,"heat_weight":"value"}})).unwrap();
 let full=engine.invoke("view_snapshot_v1",json!({"version":1,"generation":"full","include_render":true})).unwrap();
 let summary=engine.invoke("view_snapshot_v1",json!({"version":1,"generation":"display","include_render":false,"include_display":true})).unwrap();
 chronoscope::schema::validate_output("view_snapshot_v1",&summary).unwrap();
 assert!(summary.get("render").is_none());assert!(summary.get("geometries").is_none());
 assert_eq!(full["display"]["bins"],summary["display"]["bins"]);
 assert_eq!(summary["display"]["count"],3);
 engine.invoke("filter",json!({"filter":{"start":1735689601.,"end":1735689601.}})).unwrap();
 let summary=engine.invoke("view_snapshot_v1",json!({"version":1,"generation":"filtered","include_display":true})).unwrap();
 assert_eq!(summary["snapshot"]["visible"],1);assert_eq!(summary["display"]["count"],1);
 assert_eq!(summary["display"]["bins"][0]["weight"],2.);
}
