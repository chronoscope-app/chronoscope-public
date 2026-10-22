use chronoscope::{
    engine::Engine,
    geometry,
    model::{Dataset, Filter, GeoBounds},
    project::Project,
    store::DataStore,
    wmts::{self, AccessSettings, MapConfig},
};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
fn engine(dir: &std::path::Path) -> Engine {
    Engine::new(Project::new(Dataset::default()), dir.into()).unwrap()
}
fn import(e: &Engine, path: &std::path::Path) -> Value {
    let p = e.invoke("import_preview", json!({"path":path})).unwrap();
    e.invoke("import_commit", json!({"import_id":p["import_id"]}))
        .unwrap()
}
fn csv(path: &std::path::Path, geometries: &[&str]) {
    let mut writer = csv::Writer::from_path(path).unwrap();
    writer
        .write_record(["entity", "timestamp", "geometry"])
        .unwrap();
    for (i, g) in geometries.iter().enumerate() {
        writer
            .write_record([
                format!("Feature {i}"),
                "2026-01-01 00:00".into(),
                g.to_string(),
            ])
            .unwrap();
    }
    writer.flush().unwrap();
}
#[test]
fn wkt_simple_features_dimensions_multiparts_collections_and_empty() {
    for text in [
        "POINT(-79 43)",
        "POINT Z(-79 43 123.4)",
        "POINT M(-79 43 900)",
        "POINT ZM(-79 43 100 900)",
        "SRID=4326; POINT(-79 43)",
        "LINESTRING(-79 43,-79.1 43.1)",
        "POLYGON((0 0,4 0,4 4,0 4,0 0),(1 1,1 2,2 2,2 1,1 1))",
        "MULTIPOINT((-79 43),(-78 42))",
        "MULTIPOINT(-79 43,-78 42)",
        "MULTILINESTRING((0 0,1 1),(1 2,2 3))",
        "MULTIPOLYGON(((0 0,1 0,1 1,0 0)),((2 2,3 2,3 3,2 2)))",
        "GEOMETRYCOLLECTION(POINT(0 1),LINESTRING(1 2,3 4))",
        "POINT EMPTY",
        "LINESTRING EMPTY",
        "POLYGON EMPTY",
        "GEOMETRYCOLLECTION EMPTY",
        "GEOMETRYCOLLECTION(POINT EMPTY,POINT(1 1))",
    ] {
        assert!(
            geometry::parse(text).is_ok(),
            "{text}: {:?}",
            geometry::parse(text).unwrap_err()
        );
    }
    assert_eq!(
        geometry::parse("POINT(-79 43)").unwrap().points,
        vec![[-79., 43.]]
    );
}
#[test]
fn wkt_rejects_invalid_crs_topology_ranges_trailing_and_resource_abuse() {
    for text in [
        "SRID=3857;POINT(0 0)",
        "POINT(181 43)",
        "POINT(43 91)",
        "POINT(NaN 0)",
        "POINT(0 0) junk",
        "POINT EMPTY junk EMPTY",
        "LINESTRING(0 0)",
        "POLYGON((0 0,1 0,1 1))",
        "POLYGON((0 0,2 2,0 2,2 0,0 0))",
        "LINESTRING(179 0,-179 0)",
        "CIRCULARSTRING(0 0,1 1,2 0)",
    ] {
        assert!(geometry::parse(text).is_err(), "{text}");
    }
    let nested = format!(
        "{}POINT(0 0){}",
        "GEOMETRYCOLLECTION(".repeat(40),
        ")".repeat(40)
    );
    assert!(geometry::parse(&nested).is_err());
}
#[test]
fn geometry_filter_uses_exact_intersection_including_holes_not_just_envelopes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("shapes.csv");
    csv(
        &path,
        &[
            "POLYGON((0 0,4 0,4 4,0 4,0 0),(1 1,1 3,3 3,3 1,1 1))",
            "LINESTRING(0 0,4 4)",
            "POINT(0.5 0.5)",
        ],
    );
    let e = engine(dir.path());
    let p = e.invoke("import_preview", json!({"path":path})).unwrap();
    assert_eq!(p["sheets"][0]["mapping"]["geometry_wkt"], 2);
    assert_eq!(import(&e, &path)["accepted"], 3);
    let hole = Filter {
        bounds: Some(GeoBounds {
            west: 1.8,
            south: 1.8,
            east: 2.2,
            north: 2.2,
        }),
        ..Default::default()
    };
    let result = e.invoke("query", json!({"filter":hole})).unwrap();
    assert_eq!(result["count"], 1);
    assert_eq!(result["events"][0]["id"], "2");
    let corner = Filter {
        bounds: Some(GeoBounds {
            west: 0.1,
            south: 3.5,
            east: 0.3,
            north: 3.7,
        }),
        ..Default::default()
    };
    let result = e.invoke("query", json!({"filter":corner})).unwrap();
    assert_eq!(result["count"], 1);
    assert_eq!(result["events"][0]["id"], "1");
    let shapes = e
        .invoke("render_geometries", json!({"max_vertices":100}))
        .unwrap();
    assert_eq!(shapes["count"], 2);
    assert_eq!(
        shapes["features"][0]["shape"]["polygons"][0]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        e.invoke("render_data", json!({})).unwrap()["located_count"],
        2 // measured point plus the explicitly derived polygon centroid
    );
    assert_eq!(
        e.invoke("render_data", json!({})).unwrap()["inferred_ids"],
        json!([])
    );
}
#[test]
fn wkt_auto_values_edit_undo_exports_zip_and_sqlite_v2_and_v1_migration() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("geometry.csv");
    csv(
        &path,
        &["POINT Z(-79 43 50)", "LINESTRING(-79 43,-78.99 43.01)"],
    );
    let mut raw = chronoscope::import::read_file(&path, 0).unwrap();
    raw.tables[0].headers[2] = "unexpected geometry name".into();
    assert_eq!(
        chronoscope::import::Mapping::detect(&raw.tables[0])
            .mapping
            .geometry_wkt,
        Some(2)
    );
    let e = engine(dir.path());
    import(&e, &path);
    e.invoke(
        "edit",
        json!({"id":"1","changes":{"geometry_wkt":"POINT(-78 42)"}}),
    )
    .unwrap();
    assert_eq!(
        e.invoke("events", json!({"id":"1"})).unwrap()["events"][0]["lat"],
        42.0
    );
    e.invoke("undo", json!({})).unwrap();
    let event = e.invoke("events", json!({"id":"1"})).unwrap()["events"][0].clone();
    assert_eq!(event["geometry_wkt"], "POINT Z(-79 43 50)");
    assert_eq!(event["lat"], 43.0);
    let saved = dir.path().join("study.chronoscope");
    assert_eq!(
        e.invoke("save", json!({"path":saved})).unwrap()["format"],
        "zip_v6"
    );
    assert_eq!(
        chronoscope::project::load_with_resources(&saved, dir.path())
            .unwrap()
            .version,
        6
    );
    let reopened = Engine::from_path(&saved, dir.path().join("reopen"), None).unwrap();
    assert_eq!(
        reopened.invoke("render_geometries", json!({})).unwrap()["count"],
        2 - 1
    );
    let export = dir.path().join("export.csv");
    e.invoke("export", json!({"path":export})).unwrap();
    let reader = chronoscope::import::read_file(&export, 0).unwrap();
    assert!(reader.tables[0].headers.iter().any(|h| h == "geometry_wkt"));
    assert!(reader.tables[0].rows[0]
        .iter()
        .any(|v| v == "POINT Z(-79 43 50)"));
    let store = DataStore::new(dir.path()).unwrap();
    for event in e.project().unwrap().dataset.events {
        store.insert(&event).unwrap();
    } // Engine project returns complete bounded data.
    let db = dir.path().join("v2.chronoscope");
    let project = e.project().unwrap();
    store.save_as(&db, &project).unwrap();
    let (opened, _) = DataStore::open_copy(&db, dir.path()).unwrap();
    assert_eq!(
        opened.get(1).unwrap().unwrap().geometry_wkt.as_deref(),
        Some("POINT Z(-79 43 50)")
    );
    let legacy = DataStore::new(dir.path()).unwrap();
    let db = dir.path().join("v1.chronoscope");
    legacy
        .save_as(&db, &Project::new(Dataset::default()))
        .unwrap();
    let c = rusqlite::Connection::open(&db).unwrap();
    c.execute_batch("DROP INDEX events_geometry; ALTER TABLE events DROP COLUMN geometry_wkt; PRAGMA user_version=1")
        .unwrap();
    drop(c);
    assert!(DataStore::open_copy(&db, dir.path()).is_ok());
}
fn capabilities(url: &str) -> wmts::Capabilities {
    wmts::Capabilities {
        title: "Local fixture".into(),
        layers: vec![wmts::Layer {
            id: "fixture".into(),
            title: "Fixture".into(),
            style: "default".into(),
            formats: vec!["image/png".into()],
            matrix_sets: vec!["grid".into()],
            dimensions: vec![],
            templates: [(
                "image/png".into(),
                format!("{url}/{{TileMatrix}}/{{TileRow}}/{{TileCol}}"),
            )]
            .into(),
            limits: Default::default(),
        }],
        matrix_sets: vec![wmts::MatrixSet {
            id: "grid".into(),
            crs: "EPSG:3857".into(),
            matrices: vec![wmts::Matrix {
                id: "fine".into(),
                scale: 559082264.0287178 / 16.,
                top_left: [-20037508.342789244, 20037508.342789244],
                tile_width: 256,
                tile_height: 256,
                width: 16,
                height: 16,
            }],
        }],
        kvp_url: None,
    }
}
fn config() -> MapConfig {
    MapConfig {
        layer: "fixture".into(),
        matrix_set: "grid".into(),
        format: "image/png".into(),
        ..Default::default()
    }
}
#[test]
fn wmts_requested_resolution_pages_all_tiles_instead_of_sixteen_tile_downsampling() {
    let caps = capabilities("http://localhost");
    let region = [-179., -84., 179., 84.];
    let page = wmts::plan_page(&caps, &config(), region, Some(0), 0, 7, 2000.).unwrap();
    assert!(page.total_tiles > 16);
    assert_eq!(page.tiles.len(), 7);
    assert_eq!(page.next_offset, Some(7));
    assert!(page.tiles.iter().all(|t| t.matrix == "fine"));
    let mut keys = std::collections::BTreeSet::new();
    let mut offset = 0;
    loop {
        let page = wmts::plan_page(&caps, &config(), region, Some(0), offset, 13, 2000.).unwrap();
        for tile in page.tiles {
            assert!(keys.insert((tile.row, tile.col)));
        }
        if let Some(next) = page.next_offset {
            offset = next
        } else {
            assert_eq!(keys.len() as u64, page.total_tiles);
            break;
        }
    }
}
#[test]
fn direct_cache_offline_and_parallel_requests_have_no_default_one_second_delay() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let hits = Arc::new(AtomicUsize::new(0));
    let (a, p, h) = (active.clone(), peak.clone(), hits.clone());
    let server = std::thread::spawn(move || {
        let mut workers = vec![];
        for _ in 0..4 {
            let (mut stream, _) = listener.accept().unwrap();
            let (a, p, h) = (a.clone(), p.clone(), h.clone());
            workers.push(std::thread::spawn(move || {
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut header = [0; 4096];
                assert!(stream.read(&mut header).unwrap() > 0);
                let current = a.fetch_add(1, Ordering::SeqCst) + 1;
                p.fetch_max(current, Ordering::SeqCst);
                h.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(100));
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntile",
                    )
                    .unwrap();
                a.fetch_sub(1, Ordering::SeqCst);
            }));
        }
        for worker in workers {
            worker.join().unwrap()
        }
    });
    let dir = tempfile::tempdir().unwrap();
    let service = wmts::TileService::new(dir.path().join("cache")).unwrap();
    assert_eq!(service.access_settings().unwrap().request_interval_ms, 0);
    let start = Instant::now();
    std::thread::scope(|scope| {
        for i in 0..4 {
            let service = &service;
            scope.spawn(move || {
                service
                    .fetch(
                        &format!("http://{address}/{i}"),
                        1024,
                        Duration::from_secs(1),
                    )
                    .unwrap()
            });
        }
    });
    server.join().unwrap();
    assert!(peak.load(Ordering::SeqCst) > 1);
    assert!(start.elapsed() < Duration::from_secs(3));
    assert_eq!(hits.load(Ordering::SeqCst), 4);
    service
        .set_access_settings(AccessSettings {
            offline: true,
            ..Default::default()
        })
        .unwrap();
    assert!(
        service
            .fetch(&format!("http://{address}/0"), 1024, Duration::ZERO)
            .unwrap()
            .1
    );
    assert!(service
        .fetch(
            &format!("http://{address}/missing"),
            1024,
            Duration::from_secs(1)
        )
        .unwrap_err()
        .contains("offline"));
    assert_eq!(service.requests.load(Ordering::Relaxed), 4);
    service.clear_cache().unwrap();
    assert_eq!(service.cache_info().unwrap()["bytes"], 0);
}

#[test]
fn cache_settings_are_local_patchable_persisted_and_invalid_files_fail_closed() {
    let dir = tempfile::tempdir().unwrap();
    let e = engine(dir.path());
    e.invoke(
        "wmts_access",
        json!({"settings":{"concurrency":3,"request_interval_ms":250}}),
    )
    .unwrap();
    let next = e
        .invoke("wmts_access", json!({"settings":{"offline":true}}))
        .unwrap();
    assert_eq!(next["settings"]["concurrency"], 3);
    assert_eq!(next["settings"]["request_interval_ms"], 250);
    let maps = wmts::TileService::new(dir.path().join("wmts-cache")).unwrap();
    assert!(maps.access_settings().unwrap().offline);
    std::fs::write(dir.path().join("wmts-access.json"), "invalid JSON").unwrap();
    assert!(wmts::TileService::new(dir.path().join("wmts-cache")).is_err());
}
#[test]
fn repeated_misses_are_deduplicated_and_http_429_prevents_an_immediate_retry() {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut b = [0; 4096];
        assert!(stream.read(&mut b).unwrap() > 0);
        std::thread::sleep(Duration::from_millis(100));
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            .unwrap();
    });
    let maps = wmts::TileService::new(dir.path().join("cache")).unwrap();
    std::thread::scope(|scope| {
        for _ in 0..4 {
            let maps = &maps;
            scope.spawn(move || {
                maps.fetch(
                    &format!("http://{address}/same"),
                    1024,
                    Duration::from_secs(60),
                )
                .unwrap()
            });
        }
    });
    server.join().unwrap();
    assert_eq!(maps.requests.load(Ordering::Relaxed), 1);
    assert_eq!(maps.hits.load(Ordering::Relaxed), 3);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut b = [0; 4096];
        assert!(stream.read(&mut b).unwrap() > 0);
        stream.write_all(b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 5\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    });
    let url = format!("http://{address}/limited");
    assert!(maps
        .fetch(&url, 1024, Duration::from_secs(60))
        .unwrap_err()
        .contains("rate limited"));
    assert!(maps
        .fetch(&url, 1024, Duration::from_secs(60))
        .unwrap_err()
        .contains("paused"));
    server.join().unwrap();
    assert_eq!(maps.requests.load(Ordering::Relaxed), 2);
}

#[test]
fn real_usgs_arcgis_mixed_png_jpeg_format_plans_without_format_rewriting() {
    let caps = wmts::parse(include_str!("fixtures/usgs-imagery-wmts.xml")).unwrap();
    let mut config = MapConfig {
        url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/WMTS/1.0.0/WMTSCapabilities.xml".into(),
        layer: "USGSImageryOnly".into(), matrix_set: "GoogleMapsCompatible".into(),
        style: "default".into(), format: "image/jpgpng".into(), time: String::new(),
        enabled: true, level: Some(8),
    };
    let tiles = wmts::plan(&caps, &config, [-122.45, 36.75, -122.35, 36.83], Some(8)).unwrap();
    assert!(!tiles.is_empty());
    assert!(tiles[0]
        .url
        .contains("USGSImageryOnly/default/GoogleMapsCompatible/8/"));
    config.format.clear();
    assert!(
        !wmts::plan(&caps, &config, [-122.45, 36.75, -122.35, 36.83], Some(8))
            .unwrap()
            .is_empty()
    );
    assert!(wmts::supported_raster_format("image/jpg"));
    config.format = "image/svg+xml".into();
    assert!(wmts::plan(&caps, &config, [-122.45, 36.75, -122.35, 36.83], Some(8)).is_err());
}
