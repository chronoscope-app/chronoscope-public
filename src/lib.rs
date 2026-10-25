#![forbid(unsafe_code)]
pub mod analysis;
pub mod analysis_assist;
pub mod analytics;
#[cfg(feature = "legacy")]
pub mod app;
pub mod apple_intelligence;
pub mod capture;
pub mod charts;
pub mod demo;
pub mod demos;
pub mod field_roles;
pub mod import;
pub mod model;
pub mod pattern_scan;
pub mod project;
#[cfg(feature = "legacy")]
pub mod scene;

pub mod balanced_terrain;
pub mod basemap;
pub mod coordinates;
pub mod engine;
pub mod mcp;
pub mod server;
pub mod terrain;
pub mod wmts;
pub mod wmts_auth;
mod wmts_native;

pub mod schema;
pub mod store;
pub mod timestamps;

pub mod stream_import;

pub mod diagnostics;

pub mod operation;

pub mod agent;

pub mod jobs;

pub mod si;
/// Compatibility module; new integrations use `si`.
pub use si as ai;

pub mod aggregation;

pub mod geometry;

pub mod command;

pub mod error;

pub mod api;

mod persistence;

pub mod cli;

pub mod platform;

pub mod map_servers;

pub mod map_layers;

pub mod mcp_client;

pub mod display;

#[cfg(feature = "experimental-browser-webmcp")]
pub mod webmcp;

pub mod gis;

pub mod geometry_centroid;
