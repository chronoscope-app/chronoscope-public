use chronoscope::{engine::Engine, model::*, project::Project};
use serde_json::json;
use std::io::Write;
#[test]
fn rejected_first_row_cross_batch_count_and_identity() {
 let d=tempfile::tempdir().unwrap(); let path=d.path().join("boundary.csv");
 let mut f=std::fs::File::create(&path).unwrap(); writeln!(f,"entity,timestamp,latitude,longitude,label").unwrap();
 for i in 0..1001 { writeln!(f,"Track,{},{},{},row-{i}",if i==0 {"invalid".into()} else {(1735689600+i*60).to_string()},40,-75).unwrap(); }
 drop(f); let e=Engine::new(Project::new(Dataset::default()),d.path().join("app")).unwrap();
 let p=e.invoke("import_preview",json!({"path":path})).unwrap();
 let r=e.invoke("import_commit",json!({"import_id":p["import_id"],"accept_rejected":true})).unwrap();
 assert_eq!(r["accepted"],1000); assert_eq!(r["rejected"],1);
 let q=e.invoke("query",json!({"limit":1000,"sort_by":"id"})).unwrap();
 assert_eq!(q["count"],r["accepted"],"accepted must equal actual store count across rejected batch boundary");
 let labels:std::collections::BTreeSet<_>=q["events"].as_array().unwrap().iter().map(|v|v["label"].as_str().unwrap()).collect();
 assert!(labels.contains("row-999")); assert!(labels.contains("row-1000"));
}
#[test]
fn failed_read_stale_cursor_preserves_metadata_and_store() {
 let d=tempfile::tempdir().unwrap(); let mut p=Project::new(chronoscope::demo::dataset());
 p.dataset.name="Important study".into(); p.selected.insert(1); p.filter.search="".into(); p.scene.time_height=Some(2.5);
 let e=Engine::new(p,d.path().join("app")).unwrap();
 let q=e.invoke("query",json!({"limit":1,"sort_by":"id"})).unwrap();
 e.invoke("filter",json!({"filter":{"search":"not found"}})).unwrap();
 let before=e.invoke("snapshot",json!({"compact":true})).unwrap();
 let error=e.invoke("query",json!({"limit":1,"sort_by":"id","cursor":q["next_cursor"]})).unwrap_err();
 assert!(error.contains("stale")); let after=e.invoke("snapshot",json!({"compact":true})).unwrap();
 assert_eq!(after["count"],192); assert_eq!(after,before,"failed READ must preserve name/filter/selection/scene/revision/store");
}
