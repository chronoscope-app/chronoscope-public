//! End-to-end imports using independently generated binary fixtures.
use chronoscope::{engine::Engine, project::Project};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn sample(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/gis/vector")
        .join(name)
}
fn engine(root: &Path) -> Engine {
    Engine::new(Project::new(Default::default()), root.to_owned()).unwrap()
}
fn invoke(e: &Engine, command: &str, args: Value) -> Value {
    let result = e
        .invoke(command, args)
        .unwrap_or_else(|err| panic!("{command}: {err}"));
    chronoscope::schema::validate_output(command, &result).unwrap();
    result
}
fn copy_sources(root: &Path) {
    std::fs::create_dir_all(root).unwrap();
    for item in std::fs::read_dir(sample("")).unwrap() {
        let path = item.unwrap().path();
        if path.is_file() {
            std::fs::copy(&path, root.join(path.file_name().unwrap())).unwrap();
        }
    }
}
fn bad_load(e: &Engine, path: &Path, expected: &str) {
    let err = e.invoke("gis_load", json!({"path":path})).unwrap_err();
    assert!(
        err.to_lowercase().contains(&expected.to_lowercase()),
        "{err}"
    );
    assert_eq!(
        invoke(e, "gis_layers", json!({}))["layers"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
}
#[test]
fn shapefile_points_lines_holes_multipart_and_multipoints_load_with_attributes() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    for (name, count) in [
        ("events.shp", 2),
        ("lines.shp", 2),
        ("zones.shp", 2),
        ("clusters.shp", 1),
    ] {
        let probe = invoke(&e, "file_probe", json!({"path":sample(name)}));
        assert_eq!(probe["format"], "shapefile");
        let layer = invoke(&e, "gis_load", json!({"path":sample(name)}))["layer"].clone();
        assert_eq!(layer["format"], "geojson");
        assert_eq!(layer["source_format"], "shapefile");
        assert_eq!(layer["feature_count"], count);
        assert_eq!(layer["resource_count"], 6);
        let rows = invoke(&e, "gis_table", json!({"id":layer["id"]}));
        assert_eq!(rows["count"], count);
        assert_eq!(rows["rows"][0]["properties"]["label"], "caf\u{e9}");
        assert_eq!(rows["rows"][0]["properties"]["date"], "2026-01-01");
        let wkt = rows["rows"][0]["geometry_wkt"].as_str().unwrap();
        if name == "zones.shp" {
            let shape = chronoscope::geometry::parse(wkt).unwrap();
            assert_eq!(shape.polygons[0].len(), 2);
        }
        if name == "lines.shp" {
            assert_eq!(
                chronoscope::geometry::parse(rows["rows"][1]["geometry_wkt"].as_str().unwrap())
                    .unwrap()
                    .lines
                    .len(),
                2
            );
        }
    }
}
#[test]
fn shapefile_and_geopackage_import_as_timestamped_events() {
    for (name, count) in [("events.shp", 2), ("features.gpkg", 5)] {
        let dir = tempfile::tempdir().unwrap();
        let e = engine(dir.path());
        let preview = invoke(&e, "import_preview", json!({"path":sample(name)}));
        assert_eq!(preview["sheets"][0]["count"], count);
        let result = invoke(
            &e,
            "import_commit",
            json!({"import_id":preview["import_id"],"mapping":preview["sheets"][0]["mapping"],"append":false}),
        );
        assert_eq!(result["accepted"], count);
        assert!(result.get("needs_review").is_none(), "{result}");
        assert_eq!(
            invoke(&e, "events", json!({"limit":10}))["events"]
                .as_array()
                .unwrap()
                .len(),
            count as usize
        );
    }
}
#[test]
fn geopackage_combines_vector_tables_preserving_layer_names_exact_ids_and_null_geometry() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    assert_eq!(
        invoke(&e, "file_probe", json!({"path":sample("features.gpkg")}))["format"],
        "geopackage"
    );
    let layer = invoke(&e, "gis_load", json!({"path":sample("features.gpkg")}))["layer"].clone();
    assert_eq!(layer["source_format"], "geopackage");
    assert_eq!(layer["feature_count"], 5);
    assert_eq!(layer["resource_count"], 2);
    let table = invoke(&e, "gis_table", json!({"id":layer["id"],"limit":10}));
    let rows = table["rows"].as_array().unwrap();
    assert!(rows.iter().any(|r| r["id"] == "points/9007199254740993"));
    assert!(rows
        .iter()
        .any(|r| r["id"] == "points/9007199254740995" && r["geometry_wkt"].is_null()));
    assert!(rows
        .iter()
        .all(|r| r["properties"]["source_layer"].is_string()));
    let zones = rows
        .iter()
        .find(|r| r["properties"]["source_layer"] == "zones")
        .unwrap();
    assert_eq!(
        chronoscope::geometry::parse(zones["geometry_wkt"].as_str().unwrap())
            .unwrap()
            .polygons[0]
            .len(),
        2
    );
}
#[test]
fn vector_sources_and_normalized_geometry_survive_portable_save_without_original_files() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input");
    copy_sources(&input);
    let profile = dir.path().join("profile");
    let e = engine(&profile);
    let mut ids = vec![];
    for name in ["events.shp", "features.gpkg"] {
        let layer = invoke(&e, "gis_load", json!({"path":input.join(name)}))["layer"].clone();
        ids.push(layer["id"].clone());
    }
    let project = dir.path().join("vectors.chronoscope");
    invoke(&e, "save", json!({"path":project}));
    std::fs::remove_dir_all(input).unwrap();
    std::fs::remove_dir_all(profile.join("gis-assets")).unwrap();
    let other = engine(&dir.path().join("recipient"));
    invoke(&other, "open", json!({"path":project}));
    for (id, count) in ids.iter().zip([2, 5]) {
        assert_eq!(
            invoke(&other, "gis_table", json!({"id":id}))["count"],
            count
        );
    }
    use base64::Engine as _;
    for (id, name) in [
        (&ids[0], "events.shp"),
        (&ids[0], "events.prj"),
        (&ids[0], "events.dbf"),
        (&ids[1], "features.gpkg"),
    ] {
        let content = invoke(
            &other,
            "gis_read",
            json!({"id":id,"resource":name,"limit":1048576}),
        );
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(content["data"].as_str().unwrap())
                .unwrap(),
            std::fs::read(sample(name)).unwrap()
        );
    }
    let preview = invoke(&other, "gis_import_preview", json!({"id":ids[0]}));
    assert_eq!(preview["sheets"][0]["count"], 2);
}
#[test]
fn shapefile_missing_projection_and_projected_or_modified_datums_are_rejected() {
    for projection in [None,Some("PROJCS[\"WGS 84 / UTM\",GEOGCS[\"WGS 84\"]]"),Some("GEOGCS[\"WGS 84\",DATUM[\"WGS_1984\",SPHEROID[\"WGS 84\",6378137,298.257223563],TOWGS84[1,0,0]],PRIMEM[\"Greenwich\",0],UNIT[\"degree\",0.0174532925199433]]")] {
        let dir=tempfile::tempdir().unwrap();let input=dir.path().join("input");copy_sources(&input);
        if let Some(p)=projection {std::fs::write(input.join("events.prj"),p).unwrap();}else{std::fs::remove_file(input.join("events.prj")).unwrap();}
        let e=engine(&dir.path().join("profile"));bad_load(&e,&input.join("events.shp"),if projection.is_none(){".prj"}else{"WGS84"});
    }
}
#[test]
fn shapefile_declared_counts_indexes_deleted_records_and_bad_utf8_fail_before_commit() {
    for (name, offset, bytes, expected) in [
        (
            "events.shp",
            104,
            i32::MAX.to_be_bytes().to_vec(),
            "Truncated",
        ),
        ("events.shx", 100, 1i32.to_be_bytes().to_vec(), "index"),
        ("events.dbf", 4, 99u32.to_le_bytes().to_vec(), "count"),
        ("events.dbf", 193, vec![b'*'], "deleted"),
        ("events.dbf", 194, vec![255], "encoding"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("input");
        copy_sources(&input);
        let file = input.join(name);
        let mut source = std::fs::read(&file).unwrap();
        source[offset..offset + bytes.len()].copy_from_slice(&bytes);
        std::fs::write(file, source).unwrap();
        let e = engine(&dir.path().join("profile"));
        bad_load(&e, &input.join("events.shp"), expected);
    }
}
#[cfg(unix)]
#[test]
fn shapefile_symlinked_companions_are_not_followed() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input");
    copy_sources(&input);
    let outside = dir.path().join("outside.dbf");
    std::fs::copy(input.join("events.dbf"), &outside).unwrap();
    std::fs::remove_file(input.join("events.dbf")).unwrap();
    std::os::unix::fs::symlink(outside, input.join("events.dbf")).unwrap();
    let e = engine(&dir.path().join("profile"));
    bad_load(&e, &input.join("events.shp"), "nonsymlink");
}
#[test]
fn geopackage_rejects_projected_layers_views_and_generated_columns_atomically() {
    for sql in [
        "UPDATE gpkg_geometry_columns SET srs_id=3857 WHERE table_name='zones'",
        "ALTER TABLE points RENAME TO real_points; CREATE VIEW points AS SELECT * FROM real_points",
        "ALTER TABLE points ADD COLUMN generated TEXT GENERATED ALWAYS AS (entity || label) VIRTUAL",
    ] {
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("bad.gpkg");std::fs::copy(sample("features.gpkg"),&path).unwrap();
        {let conn=rusqlite::Connection::open(&path).unwrap();conn.execute_batch(sql).unwrap();}
        let e=engine(&dir.path().join("profile"));bad_load(&e,&path,if sql.starts_with("UPDATE"){"EPSG:4326"}else if sql.contains("CREATE VIEW"){"ordinary tables"}else{"generated"});
    }
}
#[test]
fn geopackage_sql_identifiers_are_quoted_and_input_is_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("quoted.gpkg");
    std::fs::copy(sample("features.gpkg"), &path).unwrap();
    let name = "points\"; DROP TABLE zones; --";
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("ALTER TABLE points RENAME TO \"points\"\"; DROP TABLE zones; --\"")
            .unwrap();
        conn.execute(
            "UPDATE gpkg_contents SET table_name=?1 WHERE table_name='points'",
            [name],
        )
        .unwrap();
        conn.execute(
            "UPDATE gpkg_geometry_columns SET table_name=?1 WHERE table_name='points'",
            [name],
        )
        .unwrap();
    }
    let before = std::fs::read(&path).unwrap();
    let e = engine(&dir.path().join("profile"));
    let layer = invoke(&e, "gis_load", json!({"path":path}))["layer"].clone();
    assert_eq!(layer["feature_count"], 5);
    let table = invoke(&e, "gis_table", json!({"id":layer["id"]}));
    assert!(table["rows"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["properties"]["source_layer"] == name));
    assert_eq!(std::fs::read(path).unwrap(), before);
}
#[test]
fn geopackage_rejects_pending_wal_and_unsupported_extensions() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("source.gpkg");
    std::fs::copy(sample("features.gpkg"), &path).unwrap();
    let e = engine(&dir.path().join("profile"));
    let wal = dir.path().join("source.gpkg-wal");
    std::fs::write(&wal, b"pending changes").unwrap();
    bad_load(&e, &path, "WAL");
    std::fs::remove_file(wal).unwrap();
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE gpkg_extensions(table_name TEXT,column_name TEXT,extension_name TEXT,definition TEXT,scope TEXT);INSERT INTO gpkg_extensions VALUES('points','geom','custom_geometry','x','read-write')").unwrap();
    }
    bad_load(&e, &path, "unsupported extensions");
}
#[test]
fn geopackage_rejects_malformed_allocation_bomb_geometry_without_mutating_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bad.gpkg");
    std::fs::copy(sample("features.gpkg"), &path).unwrap();
    let mut blob = b"GP\0\x01".to_vec();
    blob.extend(4326i32.to_le_bytes());
    blob.push(1);
    blob.extend(2u32.to_le_bytes());
    blob.extend(u32::MAX.to_le_bytes());
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute("UPDATE lines SET geom=?1", [blob]).unwrap();
    }
    let e = engine(&dir.path().join("profile"));
    bad_load(&e, &path, "budget");
}
