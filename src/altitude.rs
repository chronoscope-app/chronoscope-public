//! Physical Event altitude. Source units are normalized to metres at import;
//! the vertical reference remains explicit and independent of time elevation.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AltitudeReference {
    #[default]
    Unspecified,
    Ellipsoid,
    Egm96,
    /// Explicit approximate visualization of a height with unknown reference.
    Reported,
}
impl AltitudeReference {
    pub fn code(self) -> u8 {
        match self {
            Self::Ellipsoid => 1,
            Self::Egm96 => 2,
            Self::Reported => 3,
            Self::Unspecified => 4,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ellipsoid => "ellipsoid",
            Self::Egm96 => "egm96",
            Self::Reported => "reported",
            Self::Unspecified => "unspecified",
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Altitude {
    pub meters: f64,
    #[serde(default)]
    pub reference: AltitudeReference,
}
impl Altitude {
    pub fn validate(self) -> Result<(), String> {
        if !self.meters.is_finite() || !(-12000.0..=100_000_000.0).contains(&self.meters) {
            return Err(
                "Altitude must be finite and between -12,000 and 100,000,000 metres".into(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AltitudeUnit {
    #[default]
    Meters,
    Feet,
    Kilometers,
}
impl AltitudeUnit {
    pub fn meters(self, value: f64) -> f64 {
        value
            * match self {
                Self::Meters => 1.0,
                Self::Feet => 0.3048,
                Self::Kilometers => 1000.0,
            }
    }
}
