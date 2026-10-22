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
pub struct Demo {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub source_url: &'static str,
    pub license: &'static str,
    #[serde(skip)]
    bytes: &'static [u8],
}

pub const DEMOS: &[Demo] = &[
    Demo {
        id: "hurricanes",
        name: "Atlantic hurricanes · 2016–2025",
        description: "3,568 NOAA NHC observations of 83 storms, with saved views.",
        source_url: "https://www.nhc.noaa.gov/data/#hurdat",
        license: "NOAA public data",
        bytes: include_bytes!("../samples/atlantic-hurricanes-2016-2025.chronoscope"),
    },
    Demo {
        id: "noaa-ais",
        name: "NOAA AIS · San Francisco Bay",
        description: "Ten vessels on 1 January 2024: passenger, tug, towing, pilot, sailing, fishing and tanker tracks. Speed is knots.",
        source_url: "https://coast.noaa.gov/digitalcoast/data/vesseltraffic.html",
        license: "NOAA public data",
        bytes: include_bytes!("../samples/noaa-ais-san-francisco-2024-01-01.chronoscope"),
    },
    Demo {
        id: "animal-gps",
        name: "Animal GPS · Belgian herring gulls",
        description: "Three herring gulls in June 2021, from the INBO/LifeWatch HG_OOSTENDE study. Ground speed is metres per second.",
        source_url: "https://doi.org/10.5281/zenodo.6594838",
        license: "CC0 1.0 · Stienen et al. / INBO",
        bytes: include_bytes!("../samples/animal-gps-herring-gulls-2021-06.chronoscope"),
    },
    Demo {
        id: "local-wildlife",
        name: "Bobcats and fisher · Black Rock Forest",
        description: "3,439 GPS observations of two bobcats and one fisher in New York, 1–7 March 2023. Ground speed is metres per second.",
        source_url: "https://doi.org/10.5441/001/1.652",
        license: "CC BY 4.0 · Scott LaPoint (2026), Hudson Highlands Wildlife Connectivity Project",
        bytes: include_bytes!("../samples/animal-gps-black-rock-forest-2023-03.chronoscope"),
    },
    Demo {
        id: "stork-migration",
        name: "White storks · Europe to Africa",
        description: "6,090 original GPS observations of three named storks in 2018, selected at 30-minute intervals from the published moveVis subset.",
        source_url: "https://doi.org/10.5441/001/1.ck04mn78",
        license: "CC0 1.0 · Fiedler et al. (2019), via moveVis",
        bytes: include_bytes!("../samples/animal-gps-white-storks-2018.chronoscope"),
    },
    Demo {
        id: "elephant-seals",
        name: "Elephant seals · North Pacific dives",
        description: "15,501 dive summaries from three seals in 2004. Locations are modelled dive-start positions; Value is maximum dive depth in metres, available in tables and charts.",
        source_url: "https://doi.org/10.7291/D18D7W",
        license: "CC0 1.0 · Costa, Holser et al., UC Santa Cruz and collaborators",
        bytes: include_bytes!("../samples/animal-telemetry-elephant-seals-2004.chronoscope"),
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
