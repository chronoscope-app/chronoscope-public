use chronoscope::{
    analysis,
    coordinates::{self, Coordinate},
    terrain::TerrainCatalog,
};
use serde_json::Value;
use std::path::Path;
fn reference() -> Value {
    serde_json::from_str(include_str!("fixtures/gis-reference.json")).unwrap()
}
fn n(v: &Value, name: &str) -> f64 {
    v[name].as_f64().unwrap()
}
#[test]
fn coordinates_match_independent_proj_and_geotrans_vectors() {
    for v in reference()["coordinates"].as_array().unwrap() {
        let lat = n(v, "latitude");
        let lon = n(v, "longitude");
        let converted = coordinates::convert(Coordinate::Dd {
            latitude: lat,
            longitude: lon,
        })
        .unwrap_or_else(|e| panic!("{lat},{lon}: {e}"));
        let Coordinate::Utm {
            zone,
            hemisphere,
            easting,
            northing,
        } = converted.utm
        else {
            panic!()
        };
        assert_eq!(zone, v["zone"].as_i64().unwrap() as i32, "{lat},{lon}");
        assert_eq!(hemisphere, if v["north"] == true { "N" } else { "S" });
        assert!(
            (easting - n(v, "easting")).abs() < 0.001,
            "easting {lat},{lon}: {easting}"
        );
        assert!(
            (northing - n(v, "northing")).abs() < 0.001,
            "northing {lat},{lon}: {northing}"
        );
        if let Some(expected) = v["mgrs"].as_str() {
            // Numerical representations on exact metre/grid boundaries can
            // select either adjacent cell. Test strings away from that ambiguity.
            let away = |x: f64| (x - x.round()).abs() > 1e-5;
            if away(easting) && away(northing) {
                assert_eq!(converted.mgrs, expected, "MGRS {lat},{lon}");
            }
        }
        if zone != 0 {
            let reversed = coordinates::convert(Coordinate::Utm {
                zone,
                hemisphere,
                easting,
                northing,
            })
            .unwrap();
            assert!(
                (reversed.latitude - lat).abs() < 1e-8,
                "reverse latitude {lat},{lon}"
            );
            let d = (reversed.longitude - lon + 180.).rem_euclid(360.) - 180.;
            assert!(d.abs() < 1e-8, "reverse longitude {lat},{lon}");
        }
    }
}
#[test]
fn every_mgrs_precision_uses_independent_cell_centres() {
    for v in reference()["mgrs_cells"].as_array().unwrap() {
        let original = v["reference"].as_str().unwrap();
        let spaced = original
            .chars()
            .map(|c| format!("{c} "))
            .collect::<String>();
        for reference in [original.to_owned(), spaced] {
            let c = coordinates::convert(Coordinate::Mgrs { reference }).unwrap();
            assert!(
                (c.latitude - n(v, "latitude")).abs() < 1e-8,
                "{original}: latitude {}",
                c.latitude
            );
            assert!(
                (c.longitude - n(v, "longitude")).abs() < 1e-8,
                "{original}: longitude {}",
                c.longitude
            );
            assert_eq!(c.mgrs_precision, v["precision"].as_u64().unwrap() as u8);
            assert_eq!(
                c.mgrs_cell_size_m,
                Some(10f64.powi(5 - i32::from(c.mgrs_precision)))
            );
        }
    }
}
#[test]
fn web_mercator_matches_epsg3857_oracle_without_axis_swap() {
    for v in reference()["coordinates"].as_array().unwrap() {
        let Some(xy) = v["web_mercator"].as_array() else {
            continue;
        };
        let lat = n(v, "latitude");
        let lon = n(v, "longitude");
        let [x, y] = coordinates::mercator(lat, lon);
        assert!((x - xy[0].as_f64().unwrap()).abs() < 1e-7);
        assert!((y - xy[1].as_f64().unwrap()).abs() < 1e-7);
        let (ilat, ilon) = coordinates::inverse_mercator(x, y);
        assert!((ilat - lat).abs() < 1e-10);
        assert!((ilon - lon).abs() < 1e-10);
    }
}
#[test]
fn dted_posts_and_interpolation_match_analytic_oracle_without_half_pixel_shift() {
    let mut c = TerrainCatalog::load(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/terrain/synthetic-n43.dt0"),
    )
    .unwrap();
    for v in reference()["terrain_samples"].as_array().unwrap() {
        let height = c
            .sample(n(v, "latitude"), n(v, "longitude"))
            .unwrap()
            .unwrap();
        assert!(
            (f64::from(height) - n(v, "height_m")).abs() < 0.002,
            "{v}: {height}"
        );
    }
}
#[test]
fn ellipsoidal_distances_match_proj_including_antipodes() {
    for v in reference()["geodesic_distances"].as_array().unwrap() {
        let pair = |name: &str| (v[name][0].as_f64().unwrap(), v[name][1].as_f64().unwrap());
        let actual = analysis::geodesic_distance(pair("a"), pair("b"));
        assert!((actual - n(v, "metres")).abs() < 1e-5, "{v}: {actual}");
    }
}
#[test]
fn equator_signed_zero_antimeridian_and_unusual_utm_do_not_panic() {
    let boundary = coordinates::convert(Coordinate::Utm {
        zone: 31,
        hemisphere: "S".into(),
        easting: 441867.7848672009,
        northing: 1116915.0440516975,
    })
    .unwrap();
    assert!((boundary.latitude + 80.).abs() < 1e-10);
    assert_eq!(
        coordinates::convert(Coordinate::Dd {
            latitude: 85.,
            longitude: 0.
        })
        .unwrap()
        .grid_crs,
        "EPSG:32661"
    );
    assert_eq!(
        coordinates::convert(Coordinate::Dd {
            latitude: -82.,
            longitude: 25.
        })
        .unwrap()
        .grid_crs,
        "EPSG:32761"
    );
    for lat in [-0., 0., 0.001, 1., 7., 8.999] {
        for lon in [-180., -73., 0., 3., 179.999, 180.] {
            let c = coordinates::convert(Coordinate::Dd {
                latitude: lat,
                longitude: lon,
            })
            .unwrap();
            assert_eq!(c.latitude, lat);
            assert!(!c.mgrs.is_empty());
            coordinates::format_mgrs(lat, lon, 5).unwrap();
        }
    }
    let c = coordinates::convert(Coordinate::Utm {
        zone: 18,
        hemisphere: "N".into(),
        easting: 900000.,
        northing: 0.,
    })
    .unwrap();
    assert_eq!(c.latitude, 0.);
    assert!((c.longitude + 71.40767279743328).abs() < 1e-10);
    for (lat, lon) in [(91., 0.), (0., 181.), (f64::NAN, 0.)] {
        assert!(coordinates::convert(Coordinate::Dd {
            latitude: lat,
            longitude: lon
        })
        .is_err());
    }
}
#[test]
fn unknown_or_wrong_terrain_datums_and_axes_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("bad.dt0");
    let original = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/terrain/synthetic-n43.dt0"),
    )
    .unwrap();
    for (offset, bytes) in [
        (224, b"     ".as_slice()),
        (224, b"WGS72".as_slice()),
        (221, b"UNK".as_slice()),
        (11, b"N".as_slice()),
        (19, b"E".as_slice()),
    ] {
        let mut data = original.clone();
        data[offset..offset + bytes.len()].copy_from_slice(bytes);
        std::fs::write(&p, data).unwrap();
        assert!(
            chronoscope::terrain::inspect(&p).is_err(),
            "offset {offset}"
        );
    }
}

#[test]
fn dted_voids_are_not_filled_and_record_offsets_are_validated() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("void.dt0");
    let original = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/terrain/synthetic-n43.dt0"),
    )
    .unwrap();
    let size = 12 + 121 * 2;
    let start = 3428 + 60 * size;
    let checksum = |data: &mut Vec<u8>| {
        let sum = data[start..start + size - 4]
            .iter()
            .map(|&v| u32::from(v))
            .sum::<u32>();
        data[start + size - 4..start + size].copy_from_slice(&sum.to_be_bytes());
    };
    let mut data = original.clone();
    data[start + 8 + 60 * 2..start + 10 + 60 * 2].copy_from_slice(&0xffffu16.to_be_bytes());
    checksum(&mut data);
    std::fs::write(&path, &data).unwrap();
    let mut c = TerrainCatalog::load(&path).unwrap();
    assert_eq!(c.sample(43.5, -79.5).unwrap(), None);
    assert_eq!(
        c.sample(43.5 + 0.25 / 120., -79.5 + 0.25 / 120.).unwrap(),
        None
    );
    assert_eq!(c.sample(43.5, -79.5 + 1. / 120.).unwrap(), Some(75.));
    data = original;
    data[start + 7] = 1;
    checksum(&mut data);
    std::fs::write(&path, data).unwrap();
    let mut c = TerrainCatalog::load(&path).unwrap();
    assert!(c.sample(43.5, -79.5).is_err());
}
