//! Small OS-memory sample; never enumerate processes or run external programs.
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use sysinfo::System;

#[derive(Clone, Serialize, schemars::JsonSchema)]
pub struct Resources {
    pub supported: bool,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub swap_used_bytes: u64,
    pub sample_age_ms: u64,
    pub scope: String,
}

struct Sampler {
    system: Option<System>,
    at: Instant,
    value: Resources,
}

pub fn sample() -> Resources {
    static SAMPLER: OnceLock<Mutex<Sampler>> = OnceLock::new();
    let sampler = SAMPLER.get_or_init(|| {
        Mutex::new(Sampler {
            system: System::new().ok(),
            at: Instant::now() - Duration::from_secs(6),
            value: Resources {
                supported: false,
                total_bytes: 0,
                available_bytes: 0,
                swap_used_bytes: 0,
                sample_age_ms: 0,
                scope: "unavailable".into(),
            },
        })
    });
    let mut s = sampler.lock().unwrap_or_else(|e| e.into_inner());
    if s.at.elapsed() >= Duration::from_secs(5) {
        if let Some(system) = s.system.as_mut() {
            system.refresh_memory();
            let mut total = system.total_memory();
            let mut available = system.available_memory().min(total);
            let mut scope = "host";
            if let Some(group) = system.cgroup_limits() {
                if group.total_memory > 0 && group.total_memory < total {
                    total = group.total_memory;
                    available = available.min(group.free_memory).min(total);
                    scope = "cgroup";
                }
            }
            let swap_used = system.used_swap();
            s.value = Resources {
                supported: total > 0,
                total_bytes: total,
                available_bytes: available,
                swap_used_bytes: swap_used,
                sample_age_ms: 0,
                scope: scope.into(),
            };
        }
        s.at = Instant::now();
    }
    let mut result = s.value.clone();
    result.sample_age_ms = s.at.elapsed().as_millis().min(u64::MAX as u128) as u64;
    result
}

#[cfg(test)]
mod tests {
    #[test]
    fn samples_are_bounded_and_shared_without_a_process_scan() {
        let first = super::sample();
        let second = super::sample();
        assert!(first.available_bytes <= first.total_bytes);
        assert_eq!(first.total_bytes, second.total_bytes);
        assert_eq!(first.available_bytes, second.available_bytes);
        assert!(second.sample_age_ms < 5000);
    }
}
