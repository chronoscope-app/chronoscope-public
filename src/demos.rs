//! Offline, immutable real-world examples. Opening creates a new editable document.
use crate::project::Project;
use schemars::JsonSchema;
use serde::Serialize;
use std::{io::Write, path::Path};

#[derive(Serialize, JsonSchema)]
pub struct Catalog {
    pub demos: Vec<Demo>,
}

#[derive(Serialize, JsonSchema)]
pub struct Preview {
    pub key: &'static str,
    pub label: &'static str,
    pub view_index: usize,
}

const TIME_MAP: &[Preview] = &[
    Preview {
        key: "time",
        label: "Time",
        view_index: 0,
    },
    Preview {
        key: "map",
        label: "Map",
        view_index: 1,
    },
];

#[derive(Serialize, JsonSchema)]
pub struct Demo {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub source_url: &'static str,
    pub license: &'static str,
    pub previews: &'static [Preview],
    #[serde(skip)]
    bytes: &'static [u8],
}

pub const DEMOS: &[Demo] = &[
    Demo {
        id: "flight-altitude",
        name: "A week of flights · 6 Philippine airports",
        description: "175 flights and 11,018 samples across March 1–7, 2026 UTC: Manila, Cebu, Davao, Iloilo, Caticlan and Puerto Princesa. Reported altitude is approximate; original timestamps are preserved.",
        source_url: "https://doi.org/10.5281/zenodo.20534917",
        license: "CC BY 4.0 · Alexander Bañados / original flight data via Flightradar24",
        previews: &[Preview { key: "globe", label: "Altitude", view_index: 0 }, Preview { key: "time", label: "Time Height", view_index: 1 }],
        bytes: include_bytes!("../samples/flights-philippines-week-2026.chronoscope"),
    },
    Demo {
        id: "kabr-uav",
        name: "UAV takeoff to landing · Kenya",
        description: "Three complete KABR wildlife-monitoring flights on January 11, 12 and 20, 2023. Opens on the 12-minute January 12 flight. 25,924 records in one layer; six startup records have no GPS fix. Globe height is reported metres above takeoff; original UTC dates and sea-level altitude remain separate.",
        source_url: "https://huggingface.co/datasets/imageomics/kabr_airdata",
        license: "CC0 1.0 · Imageomics Institute / KABR; curated by Jenna Kline",
        previews: &[Preview { key: "time", label: "Time", view_index: 0 }, Preview { key: "globe", label: "Height above takeoff", view_index: 1 }],
        bytes: include_bytes!("../samples/kabr-uav-kenya-2023.chronoscope"),
    },
    Demo {
        id: "hurricanes",
        name: "Atlantic hurricanes · 2016–2025",
        description: "3,568 NOAA NHC observations of 83 storms, with saved views.",
        source_url: "https://www.nhc.noaa.gov/data/#hurdat",
        license: "NOAA public data",
        previews: &[
            Preview { key: "time", label: "Time", view_index: 3 },
            Preview { key: "map", label: "Map", view_index: 0 },
        ],
        bytes: include_bytes!("../samples/atlantic-hurricanes-2016-2025.chronoscope"),
    },
    Demo {
        id: "noaa-ais",
        name: "NOAA AIS · San Francisco Bay",
        description: "Ten vessels on 1 January 2024: passenger, tug, towing, pilot, sailing, fishing and tanker tracks. Speed is knots.",
        source_url: "https://coast.noaa.gov/digitalcoast/data/vesseltraffic.html",
        license: "NOAA public data",
        previews: TIME_MAP,
        bytes: include_bytes!("../samples/noaa-ais-san-francisco-2024-01-01.chronoscope"),
    },
    Demo {
        id: "animal-gps",
        name: "Animal GPS · Belgian herring gulls",
        description: "Three herring gulls in June 2021, from the INBO/LifeWatch HG_OOSTENDE study. Ground speed is metres per second.",
        source_url: "https://doi.org/10.5281/zenodo.6594838",
        license: "CC0 1.0 · Stienen et al. / INBO",
        previews: TIME_MAP,
        bytes: include_bytes!("../samples/animal-gps-herring-gulls-2021-06.chronoscope"),
    },
    Demo {
        id: "local-wildlife",
        name: "Bobcats and fisher · Black Rock Forest",
        description: "3,439 GPS observations of two bobcats and one fisher in New York, 1–7 March 2023. Ground speed is metres per second.",
        source_url: "https://doi.org/10.5441/001/1.652",
        license: "CC BY 4.0 · Scott LaPoint (2026), Hudson Highlands Wildlife Connectivity Project",
        previews: TIME_MAP,
        bytes: include_bytes!("../samples/animal-gps-black-rock-forest-2023-03.chronoscope"),
    },
    Demo {
        id: "stork-migration",
        name: "White storks · Europe to Africa",
        description: "6,090 original GPS observations of three named storks in 2018, selected at 30-minute intervals from the published moveVis subset.",
        source_url: "https://doi.org/10.5441/001/1.ck04mn78",
        license: "CC0 1.0 · Fiedler et al. (2019), via moveVis",
        previews: TIME_MAP,
        bytes: include_bytes!("../samples/animal-gps-white-storks-2018.chronoscope"),
    },
    Demo {
        id: "elephant-seals",
        name: "Elephant seals · North Pacific dives",
        description: "15,501 dive summaries from three seals in 2004. Locations are modelled dive-start positions; Value is maximum dive depth in metres, available in tables and charts.",
        source_url: "https://doi.org/10.7291/D18D7W",
        license: "CC0 1.0 · Costa, Holser et al., UC Santa Cruz and collaborators",
        previews: TIME_MAP,
        bytes: include_bytes!("../samples/animal-telemetry-elephant-seals-2004.chronoscope"),
    },
    Demo {
        id: "earthquakes",
        name: "Global earthquakes · 2025",
        description: "8,500 USGS-authored magnitude ≥4.5 events over a complete year. Surface epicenters, with depth in km as an attribute. No tracks.",
        source_url: "https://earthquake.usgs.gov/fdsnws/event/1/",
        license: "USGS-authored data · US public domain",
        previews: &[
            Preview { key: "globe", label: "Globe", view_index: 0 },
            Preview { key: "map", label: "Map", view_index: 1 },
        ],
        bytes: include_bytes!("../samples/usgs-global-earthquakes-2025.chronoscope"),
    },
    Demo {
        id: "fire-detections",
        name: "NASA FIRMS · South America",
        description: "50,713 nominal/high-confidence VIIRS detections, 19–25 October 2026. Heat sums radiative power (MW); detections are not burned area or independent fires.",
        source_url: "https://firms.modaps.eosdis.nasa.gov/active_fire/",
        license: "NASA LANCE / FIRMS · open Earth science data",
        previews: &[
            Preview { key: "heat", label: "FRP heat", view_index: 0 },
            Preview { key: "map", label: "Detections", view_index: 1 },
        ],
        bytes: include_bytes!("../samples/nasa-firms-south-america-2026-10.chronoscope"),
    },
    Demo {
        id: "electricity-access",
        name: "Electricity access · 1990–2023",
        description: "Annual World Bank electricity-access percentages for 169 mapped countries. Fixed 0–100% scale, missing values gray. Starts at 2023; compare saved years.",
        source_url: "https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS",
        license: "World Bank / ESMAP · CC BY 4.0; Natural Earth boundaries · public domain",
        previews: &[
            Preview { key: "2023", label: "2023", view_index: 0 },
            Preview { key: "1990", label: "1990", view_index: 4 },
        ],
        bytes: include_bytes!("../samples/world-bank-electricity-1990-2023.chronoscope"),
    },
    Demo {
        id: "london-crime",
        name: "London theft reports · January 2025",
        description: "4,053 Police.uk theft-from-the-person reports. Approximate locations, month-only dates. Heat and density show reported counts, not population-adjusted risk.",
        source_url: "https://data.police.uk/about/",
        license: "Police.uk / contributing forces · Open Government Licence v3.0",
        previews: &[
            Preview { key: "heat", label: "Heat map", view_index: 0 },
            Preview { key: "density", label: "Count cells", view_index: 1 },
        ],
        bytes: include_bytes!("../samples/police-uk-london-theft-2025-01.chronoscope"),
    },
    Demo {
        id: "earthquakes-january",
        name: "Global earthquakes · January 2025",
        description: "The original website globe showcase: 652 USGS-authored earthquakes of magnitude ≥4.5. Surface epicenters; no tracks.",
        source_url: "https://earthquake.usgs.gov/fdsnws/event/1/",
        license: "USGS-authored data · US public domain",
        previews: &[
            Preview { key: "globe", label: "Globe", view_index: 0 },
            Preview { key: "map", label: "Map", view_index: 1 },
        ],
        bytes: include_bytes!("../samples/usgs-global-earthquakes-2025-01.chronoscope"),
    },
    Demo {
        id: "hurricanes-short",
        name: "Atlantic hurricanes · 2021–2025",
        description: "The shorter five-season workspace: 1,604 original fixes for 38 Atlantic hurricanes, with saved regional views.",
        source_url: "https://www.nhc.noaa.gov/data/#hurdat",
        license: "NOAA public data",
        previews: &[
            Preview { key: "time", label: "Time", view_index: 1 },
            Preview { key: "map", label: "Map", view_index: 0 },
        ],
        bytes: include_bytes!("../samples/atlantic-hurricanes-2021-2025-tracks.chronoscope"),
    },
    Demo {
        id: "starlink-orbits",
        name: "128 Starlinks · global orbits",
        description: "46,208 predicted positions over six hours, 26 November 2024; opens a 90-minute window. Original 60-second samples; transformed MEME coordinates assume J2000 equinox. Predictions, not measured flight telemetry.",
        source_url: "https://doi.org/10.6084/m9.figshare.33446503.v1",
        license: "CC BY 4.0 · Guo et al. / SpaceX operator predictions",
        previews: &[Preview { key: "globe", label: "Altitude", view_index: 0 }, Preview { key: "time", label: "Time Height", view_index: 1 }],
        bytes: include_bytes!("../samples/starlink-128-predicted-orbits-2024.chronoscope"),
    },
];

pub fn load(id: &str, data_dir: &Path) -> Result<Project, String> {
    let demo = DEMOS
        .iter()
        .find(|d| d.id == id)
        .ok_or("INVALID_ARGUMENT: unknown demo dataset")?;
    // Use the normal portable-workspace validator. The private temporary file is
    // never the editable document's source, and disappears after validation.
    let mut file = tempfile::NamedTempFile::new_in(data_dir).map_err(|e| e.to_string())?;
    file.write_all(demo.bytes).map_err(|e| e.to_string())?;
    crate::project::load_with_resources(file.path(), data_dir)
}
