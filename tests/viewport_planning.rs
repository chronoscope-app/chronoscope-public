use chronoscope::{display::GridRequest, model::*, store::DataStore};
use std::collections::BTreeSet;

#[test]
fn adaptive_point_viewports_match_indexed_queries() {
    check_viewports(false);
}

#[test]
fn mixed_geometry_viewports_preserve_indexed_intersections() {
    check_viewports(true);
}

fn check_viewports(with_geometry: bool) {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DataStore::new(dir.path()).unwrap();
    let template = chronoscope::demo::dataset().events.remove(0);
    let mut events = (0..240)
        .map(|i| {
            let mut e = template.clone();
            e.id = 9_007_199_254_740_993 + i;
            e.entity = format!("entity-{}", i % 4);
            e.source = format!("source-{}", i % 3);
            e.category = format!("category-{}", i % 2);
            e.label = format!("needle-{i}");
            e.time = 1_700_000_000. + i as f64;
            e.end = Some(e.time + 30.);
            e.lat = Some((i % 179) as f64 - 89.);
            e.lon = Some((i % 359) as f64 - 179.);
            e.geometry_wkt = None;
            e.location_kind = None;
            if i % 17 == 0 {
                e.lat = None;
                e.lon = None;
            }
            e
        })
        .collect::<Vec<_>>();
    events[2].lat = Some(90.);
    events[2].lon = Some(180.);
    events[4].lat = Some(-90.);
    events[4].lon = Some(-180.);
    for (i, wkt) in [
        "LINESTRING(-80 0,80 0)",
        "POLYGON((-20 -20,20 -20,20 20,-20 20,-20 -20),(-5 -5,-5 5,5 5,5 -5,-5 -5))",
        "POINT(180 90)",
        "MULTILINESTRING((179 -10,180 0),(-180 0,-179 10))",
        "POINT(-180 -90)",
    ]
    .iter()
    .enumerate()
    {
        if !with_geometry {
            break;
        }
        events[i].geometry_wkt = Some((*wkt).into());
        if !wkt.starts_with("POINT(") {
            events[i].lat = None;
            events[i].lon = None;
        }
    }
    store.load_events(events.clone()).unwrap();
    store
        .selection_changed(&events.iter().step_by(5).map(|e| e.id).collect())
        .unwrap();
    let viewports = [
        GeoBounds {
            west: -180.,
            south: -90.,
            east: 180.,
            north: 90.,
        },
        GeoBounds {
            west: -1.,
            south: -1.,
            east: 1.,
            north: 1.,
        },
        GeoBounds {
            west: 178.,
            south: -90.,
            east: -178.,
            north: 90.,
        },
        GeoBounds {
            west: -180.,
            south: 85.,
            east: 180.,
            north: 90.,
        },
        GeoBounds {
            west: -120.,
            south: -60.,
            east: 20.,
            north: 80.,
        },
    ];
    let filters = [
        Filter::default(),
        Filter {
            start: Some(1_700_000_010.),
            end: Some(1_700_000_120.),
            ..Filter::default()
        },
        Filter {
            selected_only: true,
            ..Filter::default()
        },
        Filter {
            search: "needle".into(),
            hidden_sources: BTreeSet::from(["source-1".into()]),
            ..Filter::default()
        },
        Filter {
            bounds: Some(viewports[4].clone()),
            ..Filter::default()
        },
    ];
    for filter in &filters {
        for viewport in &viewports {
            // Reference retains the original RTree IN and exact WKT intersection.
            let (base, mut args) = DataStore::where_sql(filter, None);
            let (spatial, extra) = DataStore::where_sql(
                &Filter {
                    bounds: Some(viewport.clone()),
                    ..Filter::default()
                },
                None,
            );
            args.extend(extra);
            let sql = format!(
                "SELECT e.id FROM events e WHERE ({base}) AND ({spatial}) ORDER BY e.time,e.id_key"
            );
            let expected = store
                .connection
                .prepare(&sql)
                .unwrap()
                .query_map(rusqlite::params_from_iter(&args), |r| r.get::<_, String>(0))
                .unwrap()
                .map(|r| r.unwrap().parse::<u64>().unwrap())
                .collect::<Vec<_>>();
            let table = store
                .ordered_with_bounds(filter, None, "time", false, Some(viewport))
                .unwrap();
            assert_eq!(
                store.ids(&table).unwrap(),
                expected,
                "{filter:?}, {viewport:?}"
            );
            let packet = store
                .display_grid(
                    filter,
                    Some(viewport),
                    GridRequest {
                        level: 4,
                        minutes: 0,
                        partition: "all",
                        weight: "count",
                        limit: 4000,
                    },
                )
                .unwrap();
            let count:usize=store.connection.query_row(&format!("SELECT count(*) FROM events e WHERE ({base}) AND ({spatial}) AND e.lat IS NOT NULL AND e.lon IS NOT NULL"),rusqlite::params_from_iter(&args),|r|r.get(0)).unwrap();
            assert_eq!(packet.count, count);
            for bin in packet.bins {
                assert_eq!(
                    store
                        .display_members(filter, None, &[bin.cell])
                        .unwrap()
                        .len(),
                    bin.count
                );
            }
        }
    }
}
