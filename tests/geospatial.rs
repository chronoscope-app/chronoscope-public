use chronoscope::{
    coordinates::{self, Coordinate},
    engine::Engine,
    import::{self, Mapping, RawTable},
    mcp,
    project::Project,
    terrain::{self, TerrainCatalog},
    wmts::{self, MapConfig},
};
use serde_json::json;
use std::path::Path;
fn sample() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/terrain/synthetic-n43.dt0")
}
#[test]
fn synthetic_dted_agrees_with_analytic_fixture() {
    let t = terrain::inspect(&sample()).unwrap();
    assert_eq!((t.width, t.height), (121, 121));
    assert_eq!((t.west, t.south, t.east, t.north), (-80., 43., -79., 44.));
    let mut c = TerrainCatalog::load(sample().parent().unwrap()).unwrap();
    assert_eq!(c.sample(43.5, -79.5).unwrap(), Some(75.));
    assert_eq!(c.sample(10., 10.).unwrap(), None);
    let m = c.mesh([-80., 43., -79., 44.], 33).unwrap();
    assert_eq!(m.covered, 33 * 33);
    assert!(m.minimum >= 74.9 && m.maximum <= 315.);
}
#[test]
fn dted_corrupt_crc_and_truncation_are_errors() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("bad.dt0");
    let mut b = std::fs::read(sample()).unwrap();
    b[3437] ^= 1;
    std::fs::write(&p, &b).unwrap();
    let mut c = TerrainCatalog::load(&p).unwrap();
    assert!(c.sample(43., -80.).is_err());
    b.truncate(100);
    std::fs::write(&p, b).unwrap();
    assert!(terrain::inspect(&p).is_err());
}
#[test]
fn coordinate_reference_vectors_include_special_zones_and_poles() {
    for (lat, lon, mgrs) in [
        (40.748333, -73.985278, "18TWL8566411315"),
        (-33.8688, 151.2093, "56HLH3436850948"),
        (60., 6., "32VLM3270555205"),
        (78., 20., "33XXG1591463320"),
        (85., 0., "ZAB0000044542"),
        (-82., 25., "BFW7595106231"),
    ] {
        let p = coordinates::convert(Coordinate::Dd {
            latitude: lat,
            longitude: lon,
        })
        .unwrap();
        assert_eq!(p.mgrs, mgrs);
        let q = coordinates::convert(Coordinate::Mgrs {
            reference: mgrs.into(),
        })
        .unwrap();
        assert!((p.latitude - q.latitude).abs() < 0.00003);
    }
}
#[test]
fn csv_coordinate_mappings_canonicalize_and_preserve_source() {
    let headers = vec!["entity".into(), "time".into(), "mgrs".into()];
    let t = RawTable {
        sheet: "data".into(),
        headers: headers.clone(),
        row_numbers: vec![2],
        rows: vec![vec![
            "A".into(),
            "2025-01-01".into(),
            "18TWL8566411315".into(),
        ]],
    };
    let r = import::convert(&t, &Mapping::guess(&headers), "mgrs.csv", 1).unwrap();
    assert_eq!(r.rejected_count, 0);
    assert!((r.events[0].lat.unwrap() - 40.748333).abs() < 0.00003);
    assert_eq!(r.events[0].attrs["mgrs"], "18TWL8566411315");
}
const CAPS: &str = r#"<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:o="http://www.opengis.net/ows/1.1"><Contents><Layer><o:Identifier>earth</o:Identifier><o:Title>Earth</o:Title><Style isDefault="true"><o:Identifier>default</o:Identifier></Style><Format>image/png</Format><TileMatrixSetLink><TileMatrixSet>world</TileMatrixSet></TileMatrixSetLink><ResourceURL resourceType="tile" format="image/png" template="https://example.invalid/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png"/></Layer><TileMatrixSet><o:Identifier>world</o:Identifier><o:SupportedCRS>urn:ogc:def:crs:EPSG::3857</o:SupportedCRS><TileMatrix><o:Identifier>zero</o:Identifier><ScaleDenominator>559082264.0287178</ScaleDenominator><TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>1</MatrixWidth><MatrixHeight>1</MatrixHeight></TileMatrix></TileMatrixSet></Contents></Capabilities>"#;
#[test]
fn wmts_uses_metadata_not_assumed_numeric_matrix_ids() {
    let c = wmts::parse(CAPS).unwrap();
    let config = MapConfig {
        url: "https://example.invalid/wmts".into(),
        layer: "earth".into(),
        matrix_set: "world".into(),
        ..Default::default()
    };
    let tiles = wmts::plan(&c, &config, [-80., 43., -79., 44.], None).unwrap();
    assert_eq!(tiles.len(), 1);
    assert_eq!(tiles[0].url, "https://example.invalid/world/zero/0/0.png");
    assert!((tiles[0].bounds[0] + 180.).abs() < 1e-6);
}
#[test]
fn wmts_geographic_axis_order_is_respected() {
    let xml = CAPS
        .replace("EPSG::3857", "EPSG::4326")
        .replace("559082264.0287178", "279541132.0143589")
        .replace("-20037508.342789244 20037508.342789244", "90 -180")
        .replace("<MatrixWidth>1", "<MatrixWidth>2");
    let c = wmts::parse(&xml).unwrap();
    assert_eq!(c.matrix_sets[0].matrices[0].top_left, [-180., 90.]);
    let regional = wmts::parse(&xml.replace("90 -180", "44 -80")).unwrap();
    assert_eq!(regional.matrix_sets[0].matrices[0].top_left, [-80., 44.]);
}
#[test]
fn wmts_rejects_xml_entity_expansion_and_unsupported_schemes() {
    assert!(wmts::parse(
        "<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///etc/passwd'>]><Capabilities>&e;</Capabilities>"
    )
    .is_err());
    assert!(wmts::capability_url("file:///tmp/foo").is_err());
    assert!(wmts::capability_url("https://user:secret@example.invalid/").is_err());
}
#[test]
fn engine_edit_undo_and_exact_string_ids() {
    let d = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::new(chronoscope::demo::dataset()), d.path().into()).unwrap();
    e.invoke("select", json!({"ids":["1"]})).unwrap();
    e.invoke("edit", json!({"id":"1","changes":{"entity":"Edited"}}))
        .unwrap();
    assert_eq!(
        e.project()
            .unwrap()
            .dataset
            .events
            .iter()
            .find(|e| e.id == 1)
            .unwrap()
            .entity,
        "Edited"
    );
    e.invoke("undo", json!({})).unwrap();
    assert_eq!(
        e.project()
            .unwrap()
            .dataset
            .events
            .iter()
            .find(|e| e.id == 1)
            .unwrap()
            .entity,
        "Atlas"
    );
}
#[test]
fn mcp_negotiates_lists_tools_and_enforces_root() {
    let d = tempfile::tempdir().unwrap();
    let e = Engine::new(Project::new(chronoscope::demo::dataset()), d.path().into()).unwrap();
    let root = d.path().canonicalize().unwrap();
    let init=mcp::handle(&e,&root,json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}})).unwrap();
    assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
    assert!(mcp::tools().len() > 20);
    let r=mcp::handle(&e,&root,json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"chronoscope_open","arguments":{"path":"/etc/passwd"}}})).unwrap();
    assert_eq!(r["result"]["isError"], true);
    let r=mcp::handle(&e,&root,json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"chronoscope_snapshot","arguments":{}}})).unwrap();
    assert_eq!(r["result"]["structuredContent"]["count"], 192);
}

#[test]
fn utm_csv_import_handles_southern_hemisphere() {
    let headers: Vec<String> = ["time", "easting", "northing", "zone", "hemisphere"]
        .map(str::to_owned)
        .into();
    let t = RawTable {
        sheet: "UTM".into(),
        headers: headers.clone(),
        row_numbers: vec![2],
        rows: vec![vec![
            "2025-01-01".into(),
            "334368.633648097".into(),
            "6250948.345385009".into(),
            "56".into(),
            "S".into(),
        ]],
    };
    let r = import::convert(&t, &Mapping::guess(&headers), "utm.csv", 1).unwrap();
    assert_eq!(r.rejected_count, 0);
    assert!((r.events[0].lat.unwrap() + 33.8688).abs() < 0.00001);
    assert!((r.events[0].lon.unwrap() - 151.2093).abs() < 0.00001);
}
#[test]
fn wmts_layer_matrix_limits_prevent_outside_requests() {
    let xml=CAPS.replace("</TileMatrixSet></TileMatrixSetLink>","</TileMatrixSet><TileMatrixSetLimits><TileMatrixLimits><TileMatrix>zero</TileMatrix><MinTileRow>1</MinTileRow><MaxTileRow>2</MaxTileRow><MinTileCol>1</MinTileCol><MaxTileCol>2</MaxTileCol></TileMatrixLimits></TileMatrixSetLimits></TileMatrixSetLink>");
    let c = wmts::parse(&xml).unwrap();
    let config = MapConfig {
        layer: "earth".into(),
        matrix_set: "world".into(),
        ..Default::default()
    };
    assert!(wmts::plan(&c, &config, [-80., 43., -79., 44.], None)
        .unwrap()
        .is_empty());
}
#[test]
fn wmts_cache_and_throttle_verified_without_public_requests() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::atomic::Ordering,
        time::{Duration, Instant},
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let mut stamps = Vec::new();
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 8192];
            let count = stream.read(&mut buf).unwrap();
            assert!(count > 0);
            stamps.push(Instant::now());
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest")
                .unwrap();
        }
        stamps
    });
    let d = tempfile::tempdir().unwrap();
    let service = wmts::TileService::new(d.path().join("wmts-cache")).unwrap();
    service
        .set_access_settings(chronoscope::wmts::AccessSettings {
            request_interval_ms: 1000,
            ..Default::default()
        })
        .unwrap();
    let url = format!("http://{address}/one");
    assert!(
        !service
            .fetch(&url, 1024, Duration::from_secs(60))
            .unwrap()
            .1
    );
    assert!(
        service
            .fetch(&url, 1024, Duration::from_secs(60))
            .unwrap()
            .1
    );
    service
        .fetch(
            &format!("http://{address}/two"),
            1024,
            Duration::from_secs(60),
        )
        .unwrap();
    let stamps = server.join().unwrap();
    assert!(stamps[1].duration_since(stamps[0]) >= Duration::from_millis(950));
    assert_eq!(service.requests.load(Ordering::Relaxed), 2);
    assert_eq!(service.hits.load(Ordering::Relaxed), 1);
}
#[test]
fn selecting_visible_includes_unlocated_events() {
    let mut dataset = chronoscope::demo::dataset();
    let mut event = dataset.events[0].clone();
    event.id = 1000;
    event.lat = None;
    event.lon = None;
    dataset.events.push(event);
    let d = tempfile::tempdir().unwrap();
    let engine = Engine::new(Project::new(dataset), d.path().into()).unwrap();
    assert_eq!(
        engine.invoke("select_visible", json!({})).unwrap()["selected"],
        193
    );
    assert_eq!(
        engine
            .invoke("select_visible", json!({"entity":"Atlas"}))
            .unwrap()["selected"],
        49
    );
}
#[test]
fn real_mcp_stdio_has_protocol_only_stdout_and_persistent_state() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let d = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_chronoscope"))
        .args([
            "--demo-data",
            "--data-dir",
            d.path().to_str().unwrap(),
            "mcp",
            "--root",
            d.path().to_str().unwrap(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    for req in [
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"chronoscope_select_visible","arguments":{"entity":"Atlas"}}}),
        json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"chronoscope_snapshot","arguments":{}}}),
    ] {
        writeln!(input, "{req}").unwrap();
    }
    drop(input);
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let lines: Vec<serde_json::Value> = String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect();
    assert_eq!(lines.len(), 3);
    assert_eq!(
        lines[2]["result"]["structuredContent"]["selected"]
            .as_array()
            .unwrap()
            .len(),
        48
    );
}

#[test]
fn mcp_terrain_autoload_cannot_escape_its_scope() {
    let data = tempfile::tempdir().unwrap();
    let scope = tempfile::tempdir().unwrap();
    std::fs::write(data.path().join("preferences.json"),serde_json::to_vec(&json!({"theme":"dark","coordinates":"dd","map":{"url":"","layer":"","matrix_set":"","style":"","format":"","time":"","enabled":false},"terrain_path":sample(),"terrain_exaggeration":1})).unwrap()).unwrap();
    let engine = Engine::new_with_terrain_scope(
        Project::new(chronoscope::demo::dataset()),
        data.path().into(),
        Some(scope.path()),
    )
    .unwrap();
    assert!(engine.invoke("terrain_info", json!({})).unwrap().is_null());
    assert!(engine.invoke("preferences", json!({})).unwrap()["terrain_path"].is_null());
}

#[test]
fn wmts_crs_identifiers_are_exact_and_axis_order_is_authoritative() {
    assert!(wmts::parse(&CAPS.replace(
        "<MatrixWidth>1</MatrixWidth>",
        "<MatrixWidth>1.5</MatrixWidth>"
    ))
    .is_err());
    let wrong = wmts::parse(
        &CAPS
            .replace("urn:ogc:def:crs:EPSG::3857", "EPSG:4326")
            .replace("-20037508.342789244 20037508.342789244", "-180 90"),
    )
    .unwrap();
    assert!(wmts::plan(
        &wrong,
        &MapConfig {
            layer: "earth".into(),
            matrix_set: "world".into(),
            ..Default::default()
        },
        [-80., 43., -79., 44.],
        None
    )
    .is_err());
    for crs in [
        "EPSG:38570",
        "urn:ogc:def:crs:EPSG::14326",
        "https://unrelated.invalid/3857",
    ] {
        let c = wmts::parse(&CAPS.replace("urn:ogc:def:crs:EPSG::3857", crs)).unwrap();
        let config = MapConfig {
            layer: "earth".into(),
            matrix_set: "world".into(),
            ..Default::default()
        };
        assert!(wmts::plan(&c, &config, [-80., 43., -79., 44.], None).is_err());
    }
    for (crs, origin) in [
        ("EPSG:4326", "90 -180"),
        ("urn:ogc:def:crs:EPSG:6.6:4326", "90 -180"),
        ("https://www.opengis.net/def/crs/EPSG/0/4326", "90 -180"),
        ("urn:ogc:def:crs:OGC:1.3:CRS84", "-180 90"),
        ("CRS:84", "-180 90"),
    ] {
        let xml = CAPS
            .replace("urn:ogc:def:crs:EPSG::3857", crs)
            .replace("559082264.0287178", "279541132.0143589")
            .replace("-20037508.342789244 20037508.342789244", origin)
            .replace(
                "<MatrixWidth>1</MatrixWidth>",
                "<MatrixWidth>2</MatrixWidth>",
            );
        let c = wmts::parse(&xml).unwrap();
        let config = MapConfig {
            layer: "earth".into(),
            matrix_set: "world".into(),
            ..Default::default()
        };
        assert_eq!(c.matrix_sets[0].matrices[0].top_left, [-180., 90.], "{crs}");
        let tiles = wmts::plan(&c, &config, [-80., 43., -79., 44.], None).unwrap();
        assert_eq!(tiles.len(), 1);
        assert_eq!((tiles[0].row, tiles[0].col), (0, 0));
        for (a, b) in tiles[0].bounds.into_iter().zip([-180., -90., 0., 90.]) {
            assert!((a - b).abs() < 1e-9, "{crs}");
        }
    }
}

#[test]
fn wide_mesh_decodes_each_tile_once_even_beyond_the_four_tile_cache() {
    let dir = tempfile::tempdir().unwrap();
    let original = std::fs::read(sample()).unwrap();
    for i in 0..5 {
        let mut bytes = original.clone();
        bytes[4..12].copy_from_slice(format!("{:03}0000W", 80 - i).as_bytes());
        std::fs::write(dir.path().join(format!("tile{i}.dt0")), bytes).unwrap();
    }
    let mut terrain = TerrainCatalog::load(dir.path()).unwrap();
    let mesh = terrain.mesh([-80., 43., -75., 44.], 257).unwrap();
    assert_eq!(mesh.covered, 257 * 257);
    assert_eq!(mesh.decoded_tiles, 5);
}
