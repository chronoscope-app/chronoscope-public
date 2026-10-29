//! Runtime presentation identity. This is a property of the attached shell,
//! never part of a Project, saved SceneState, undo history or document revision.
use super::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum NativeViewBackend {
    Metal,
    Vulkan,
    Dx12,
}
impl NativeViewBackend {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Metal => "Metal",
            Self::Vulkan => "Vulkan",
            Self::Dx12 => "Dx12",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HardwareAcceleration {
    #[default]
    Unknown,
    Hardware,
    Software,
}

/// An opt-in native host identity. The backend comes from the actual selected
/// device, not browser API availability. Missing presentation features remain
/// explicit; registering a renderer does not claim complete desktop parity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NativeViewHost {
    pub backend: NativeViewBackend,
    pub hardware_acceleration: HardwareAcceleration,
    pub incomplete_features: Vec<String>,
}
impl NativeViewHost {
    fn validate(&self) -> Result<(), String> {
        if self.incomplete_features.len() > 128
            || self.incomplete_features.iter().any(|feature| {
                feature.trim().is_empty()
                    || feature.len() > 256
                    || feature.chars().any(char::is_control)
            })
        {
            return Err("INVALID_ARGUMENT: native host features require at most 128 nonempty descriptions of at most 256 bytes".into());
        }
        Ok(())
    }
}

/// An explicit recorder implementation supplied by the attached native shell.
/// This does not describe browser support or prove platform runtime acceptance.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum NativeRecordingBackend {
    FfmpegNativeComposite,
}

/// Fresh local prerequisite discovery, separate from saved state and rendering
/// identity. An installed encoder does not prove successful capture/encoding.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NativeRecordingHost {
    pub backend: NativeRecordingBackend,
    pub encoder_available: bool,
}

/// A fast, synchronous local probe called once per capabilities request. The
/// provider MUST NOT call Engine methods, block on UI work, access the network,
/// download software or perform capture/encoding. Hosts may check local encoder
/// discovery here and retain execution failures in the actual recording status.
pub type NativeRecordingHostProvider = Arc<dyn Fn() -> NativeRecordingHost + Send + Sync>;

impl Engine {
    /// Register/reset runtime host metadata without editing the document. None
    /// retains the existing Cesium desktop capability document unchanged.
    /// Updating the resource token lets capability subscribers refetch it.
    pub fn set_native_view_host(&self, host: Option<NativeViewHost>) -> Result<(), String> {
        if let Some(host) = &host {
            host.validate()?;
        }
        let mut current = self
            .native_view_host
            .lock()
            .map_err(|_| "View host unavailable")?;
        if *current != host {
            *current = host;
            self.resource_epoch
                .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        }
        Ok(())
    }
    /// Register/reset a separate recording capability provider without changing
    /// NativeViewHost struct literals or any project/history state. None leaves
    /// the existing ScreenCaptureKit capability document unchanged. Resource
    /// subscribers can refetch after registration changes; encoder discovery is
    /// recomputed on every request, never cached here.
    pub fn set_native_recording_host_provider(
        &self,
        provider: Option<NativeRecordingHostProvider>,
    ) -> Result<(), String> {
        let mut current = self
            .native_recording_host_provider
            .lock()
            .map_err(|_| "Recording host unavailable")?;
        let changed = match (&*current, &provider) {
            (None, None) => false,
            (Some(previous), Some(next)) => !Arc::ptr_eq(previous, next),
            _ => true,
        };
        if changed {
            *current = provider;
            self.resource_epoch
                .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        }
        Ok(())
    }

    pub(super) fn apply_native_recording_host(
        &self,
        capabilities: &mut Value,
    ) -> Result<(), String> {
        // Never run host code while retaining the provider-registration mutex.
        let provider = self
            .native_recording_host_provider
            .lock()
            .map_err(|_| "Recording host unavailable")?
            .clone();
        if let Some(provider) = provider {
            let host = provider();
            let video = &mut capabilities["renderer"]["capture"]["video"];
            video["backend"] = json!(host.backend);
            video["platform"] = json!("macOS, Windows and Linux native desktop hosts");
            video["platforms"] = json!(["macOS", "Windows", "Linux"]);
            video["platform_runtime_acceptance"] = json!("separate per-platform acceptance; encoder discovery does not prove capture or recording success");
            video["encoder_available"] = json!(host.encoder_available);
            video["requires_installed_ffmpeg"] = json!(true);
            video["source_scope"] = json!("app-owned WebView content and native GPU compositor; excludes the OS desktop and other applications");
            video["os_screen_capture"] = json!(false);
        }
        Ok(())
    }

    pub(super) fn apply_native_view_host(&self, capabilities: &mut Value) -> Result<(), String> {
        let host = self
            .native_view_host
            .lock()
            .map_err(|_| "View host unavailable")?;
        if let Some(host) = &*host {
            let renderer = &mut capabilities["renderer"];
            renderer["engine"] = json!("wgpu-native");
            renderer["backend"] = json!(host.backend);
            renderer["hardware_acceleration"] = json!(host.hardware_acceleration);
            renderer["native_wgpu"] = json!(true);
            // The selected backend is a native API. Do not imply that a browser
            // WebGPU/WebGL context is rendering this view.
            renderer["webgpu_backend"] = json!(false);
            renderer["full_desktop_parity"] = json!(false);
            renderer["incomplete_features"] = json!(host.incomplete_features);
            renderer["capture"]["app_snapshot"] = json!(
                "host-provided native scene and UI composition; inspect attached host status"
            );
        }
        Ok(())
    }
}
