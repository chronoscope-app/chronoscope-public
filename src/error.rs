//! Stable transport-independent failures. Legacy domain functions can migrate
//! incrementally; every adapter uses the same typed boundary classification.
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    Conflict,
    Cancelled,
    ScopeDenied,
    InvalidArgument,
    NotFound,
    ResourceLimit,
    Unavailable,
    OperationFailed,
}
impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Conflict => "CONFLICT",
            Self::Cancelled => "CANCELLED",
            Self::ScopeDenied => "SCOPE_DENIED",
            Self::InvalidArgument => "INVALID_ARGUMENT",
            Self::NotFound => "NOT_FOUND",
            Self::ResourceLimit => "RESOURCE_LIMIT",
            Self::Unavailable => "UNAVAILABLE",
            Self::OperationFailed => "OPERATION_FAILED",
        }
    }
    pub fn classify(message: &str) -> Self {
        if let Some((prefix, _)) = message.split_once(':') {
            match prefix {
                "CONFLICT" => return Self::Conflict,
                "CANCELLED" => return Self::Cancelled,
                "SCOPE_DENIED" => return Self::ScopeDenied,
                "INVALID_ARGUMENT" => return Self::InvalidArgument,
                "NOT_FOUND" => return Self::NotFound,
                "RESOURCE_LIMIT" => return Self::ResourceLimit,
                "UNAVAILABLE" => return Self::Unavailable,
                "OPERATION_FAILED" => return Self::OperationFailed,
                _ => {}
            }
        }
        let lower = message.to_lowercase();
        if lower.contains("interrupted") {
            Self::Cancelled
        } else if lower.contains("outside") && lower.contains("scope") {
            Self::ScopeDenied
        } else if lower.contains("invalid")
            || lower.contains("missing")
            || lower.contains("unknown")
        {
            Self::InvalidArgument
        } else if lower.contains("not found") || lower.contains("expired") {
            Self::NotFound
        } else if lower.contains("budget") || lower.contains("exceed") || lower.contains("limit") {
            Self::ResourceLimit
        } else {
            Self::OperationFailed
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EngineError {
    pub code: ErrorCode,
    pub message: String,
}
impl From<String> for EngineError {
    fn from(message: String) -> Self {
        Self {
            code: ErrorCode::classify(&message),
            message,
        }
    }
}
impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.message.fmt(f)
    }
}
impl std::error::Error for EngineError {}
