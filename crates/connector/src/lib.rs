//! Fail-closed protocol primitives for the local Codex App Server stdio boundary.
//!
//! This crate implements the stable initialization exchange, a candidate-only account/usage
//! adapter for one exact schema extract, and a bounded one-shot child supervisor behind an
//! reviewed-launch capability with no public constructor. It does not discover or admit a Codex executable,
//! expose a generic JSON-RPC client, or claim compatibility with any Codex release.

#![forbid(unsafe_code)]
#![deny(missing_docs)]

use std::fmt;

use serde::de::{self, Deserialize, Deserializer, MapAccess, Visitor};

mod codex_0_144_4;
mod process;

pub use codex_0_144_4::{
    CandidateCodex01444AccountUsage, DailyUsage, DailyUsageEntry, MAX_DAILY_USAGE_ENTRIES,
    MAX_SYNC_TOKEN_VALUE,
};
pub use process::{
    APP_SERVER_EXIT_GRACE, APP_SERVER_LIFETIME, APP_SERVER_RESPONSE_TIMEOUT,
    CandidateCodex01444Collector, CollectionError, MAX_APP_SERVER_STDERR_BYTES,
    MAX_APP_SERVER_STDOUT_FRAMES, ReviewedCodexLaunch,
};

/// Maximum accepted App Server JSONL frame size, including its final line-feed byte.
pub const MAX_FRAME_BYTES: usize = 16 * 1024;

const INITIALIZE_REQUEST: &str = concat!(
    "{\"id\":0,\"method\":\"initialize\",\"params\":{\"clientInfo\":{",
    "\"name\":\"viberacing_connector\",\"title\":\"Vibe Racing Connector\",",
    "\"version\":\"",
    env!("CARGO_PKG_VERSION"),
    "\"}}}\n"
);
const INITIALIZED_NOTIFICATION: &[u8] = b"{\"method\":\"initialized\",\"params\":{}}\n";

/// Stable, non-reflective failures produced by the initialization boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolError {
    /// The caller attempted a handshake operation in the wrong state.
    InvalidState,
    /// The frame exceeded [`MAX_FRAME_BYTES`].
    FrameTooLarge,
    /// The bytes were not exactly one newline-terminated JSONL record.
    InvalidFrame,
    /// The record was not valid UTF-8 JSON with the reviewed initialization response shape.
    InvalidMessage,
    /// The active Codex account is not an authenticated `ChatGPT` account.
    UnsupportedAccountMode,
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidState => "connector handshake state is invalid",
            Self::FrameTooLarge => "app-server frame exceeds the size limit",
            Self::InvalidFrame => "app-server frame is invalid",
            Self::InvalidMessage => "app-server message is invalid",
            Self::UnsupportedAccountMode => "active Codex account mode is unsupported",
        })
    }
}

impl std::error::Error for ProtocolError {}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum HandshakeState {
    #[default]
    New,
    AwaitingInitialize,
    Initialized,
    Failed,
}

/// Single-connection state machine for the stable App Server initialization exchange.
///
/// Any invalid server frame permanently fails this instance so callers cannot reinterpret attacker
/// input or retry a partial handshake on the same transport.
#[derive(Debug, Default)]
pub struct ConnectorHandshake {
    state: HandshakeState,
}

impl ConnectorHandshake {
    /// Creates a fresh, not-yet-started handshake.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Emits the one fixed-shape `initialize` request allowed for this connection.
    ///
    /// The request deliberately omits `capabilities`, including `experimentalApi`.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::InvalidState`] if initialization was already started or this
    /// connection has completed or failed its handshake.
    pub fn start(&mut self) -> Result<&'static [u8], ProtocolError> {
        if self.state != HandshakeState::New {
            return Err(ProtocolError::InvalidState);
        }

        self.state = HandshakeState::AwaitingInitialize;
        Ok(INITIALIZE_REQUEST.as_bytes())
    }

    /// Validates the matching initialize response and emits the fixed `initialized` notification.
    ///
    /// The accepted response is intentionally narrower than generic JSON-RPC: request id `0`, one
    /// `result` object, and the four reviewed stable initialization fields. Values are validated and
    /// discarded; in particular, the server's local Codex home path is never retained or exposed.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::InvalidState`] unless [`Self::start`] emitted the pending request.
    /// Framing, size, JSON, duplicate-field, shape, or value violations return the corresponding
    /// non-reflective protocol error and permanently fail this handshake instance.
    pub fn accept_initialize_response(
        &mut self,
        frame: &[u8],
    ) -> Result<&'static [u8], ProtocolError> {
        if self.state != HandshakeState::AwaitingInitialize {
            return Err(ProtocolError::InvalidState);
        }

        if let Err(error) = decode_initialize_response(frame) {
            self.state = HandshakeState::Failed;
            return Err(error);
        }

        self.state = HandshakeState::Initialized;
        Ok(INITIALIZED_NOTIFICATION)
    }

    /// Reports whether the reviewed initialization exchange completed successfully.
    #[must_use]
    pub fn is_initialized(&self) -> bool {
        self.state == HandshakeState::Initialized
    }

    /// Consumes a completed handshake into the candidate Codex `0.144.4` account/usage adapter.
    ///
    /// This exact-version adapter is development evidence only. Its existence does not mark Codex
    /// `0.144.4` supported; the public compatibility matrix remains authoritative.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::InvalidState`] unless initialization completed successfully.
    pub fn into_codex_0_144_4_account_usage(
        self,
    ) -> Result<CandidateCodex01444AccountUsage, ProtocolError> {
        if self.state != HandshakeState::Initialized {
            return Err(ProtocolError::InvalidState);
        }
        Ok(CandidateCodex01444AccountUsage::new())
    }
}

fn decode_initialize_response(frame: &[u8]) -> Result<(), ProtocolError> {
    let payload = validate_frame(frame)?;
    let mut deserializer = serde_json::Deserializer::from_slice(payload);
    InitializeEnvelope::deserialize(&mut deserializer)
        .and_then(|_| deserializer.end())
        .map_err(|_| ProtocolError::InvalidMessage)
}

pub(crate) fn validate_frame(frame: &[u8]) -> Result<&[u8], ProtocolError> {
    if frame.len() > MAX_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge);
    }
    let Some(payload) = frame.strip_suffix(b"\n") else {
        return Err(ProtocolError::InvalidFrame);
    };
    if payload.len() < 2
        || payload.first() != Some(&b'{')
        || payload.last() != Some(&b'}')
        || payload
            .iter()
            .any(|byte| matches!(byte, b'\n' | b'\r' | b'\0'))
    {
        return Err(ProtocolError::InvalidFrame);
    }
    Ok(payload)
}

struct InitializeEnvelope;

impl<'de> Deserialize<'de> for InitializeEnvelope {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(InitializeEnvelopeVisitor)
    }
}

struct InitializeEnvelopeVisitor;

impl<'de> Visitor<'de> for InitializeEnvelopeVisitor {
    type Value = InitializeEnvelope;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a closed initialize response envelope")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut saw_id = false;
        let mut saw_result = false;

        while let Some(field) = map.next_key::<EnvelopeField>()? {
            match field {
                EnvelopeField::Id if !saw_id => {
                    saw_id = true;
                    if map.next_value::<u64>()? != 0 {
                        return Err(de::Error::custom("unexpected request id"));
                    }
                }
                EnvelopeField::Result if !saw_result => {
                    saw_result = true;
                    map.next_value::<InitializeResult>()?;
                }
                _ => return Err(de::Error::custom("duplicate response field")),
            }
        }

        if !saw_id || !saw_result {
            return Err(de::Error::custom("missing response field"));
        }
        Ok(InitializeEnvelope)
    }
}

enum EnvelopeField {
    Id,
    Result,
}

impl<'de> Deserialize<'de> for EnvelopeField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_identifier(EnvelopeFieldVisitor)
    }
}

struct EnvelopeFieldVisitor;

impl Visitor<'_> for EnvelopeFieldVisitor {
    type Value = EnvelopeField;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("id or result")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        match value {
            "id" => Ok(EnvelopeField::Id),
            "result" => Ok(EnvelopeField::Result),
            _ => Err(E::custom("unknown response field")),
        }
    }
}

struct InitializeResult;

impl<'de> Deserialize<'de> for InitializeResult {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(InitializeResultVisitor)
    }
}

struct InitializeResultVisitor;

impl<'de> Visitor<'de> for InitializeResultVisitor {
    type Value = InitializeResult;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the closed stable initialize result")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut seen = [false; 4];

        while let Some(field) = map.next_key::<ResultField>()? {
            let index = field.index();
            if seen[index] {
                return Err(de::Error::custom("duplicate initialize result field"));
            }
            seen[index] = true;
            match field {
                ResultField::CodexHome => {
                    map.next_value::<BoundedAbsolutePath>()?;
                }
                ResultField::PlatformFamily | ResultField::PlatformOs => {
                    map.next_value::<BoundedString<32>>()?;
                }
                ResultField::UserAgent => {
                    map.next_value::<BoundedString<512>>()?;
                }
            }
        }

        if seen.into_iter().all(|value| value) {
            Ok(InitializeResult)
        } else {
            Err(de::Error::custom("missing initialize result field"))
        }
    }
}

#[derive(Clone, Copy)]
enum ResultField {
    CodexHome,
    PlatformFamily,
    PlatformOs,
    UserAgent,
}

impl ResultField {
    const fn index(self) -> usize {
        match self {
            Self::CodexHome => 0,
            Self::PlatformFamily => 1,
            Self::PlatformOs => 2,
            Self::UserAgent => 3,
        }
    }
}

impl<'de> Deserialize<'de> for ResultField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_identifier(ResultFieldVisitor)
    }
}

struct ResultFieldVisitor;

impl Visitor<'_> for ResultFieldVisitor {
    type Value = ResultField;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a reviewed initialize result field")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        match value {
            "codexHome" => Ok(ResultField::CodexHome),
            "platformFamily" => Ok(ResultField::PlatformFamily),
            "platformOs" => Ok(ResultField::PlatformOs),
            "userAgent" => Ok(ResultField::UserAgent),
            _ => Err(E::custom("unknown initialize result field")),
        }
    }
}

struct BoundedString<const MAX_BYTES: usize>;

struct BoundedAbsolutePath;

impl<'de> Deserialize<'de> for BoundedAbsolutePath {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_str(BoundedAbsolutePathVisitor)
    }
}

struct BoundedAbsolutePathVisitor;

impl Visitor<'_> for BoundedAbsolutePathVisitor {
    type Value = BoundedAbsolutePath;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a bounded absolute POSIX, drive-letter, or UNC path")
    }

    fn visit_borrowed_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        validate_absolute_path::<E>(value)
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        validate_absolute_path::<E>(value)
    }
}

fn validate_absolute_path<E>(value: &str) -> Result<BoundedAbsolutePath, E>
where
    E: de::Error,
{
    validate_string_bounds::<E, 4096>(value)?;
    let bytes = value.as_bytes();
    let is_posix = bytes.first() == Some(&b'/');
    let is_drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\');
    let is_unc = bytes.starts_with(b"\\\\") && bytes.len() > 2;

    if is_posix || is_drive || is_unc {
        Ok(BoundedAbsolutePath)
    } else {
        Err(E::custom("codex home is not an absolute path"))
    }
}

impl<'de, const MAX_BYTES: usize> Deserialize<'de> for BoundedString<MAX_BYTES> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_str(BoundedStringVisitor::<MAX_BYTES>)
    }
}

struct BoundedStringVisitor<const MAX_BYTES: usize>;

impl<const MAX_BYTES: usize> Visitor<'_> for BoundedStringVisitor<MAX_BYTES> {
    type Value = BoundedString<MAX_BYTES>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a bounded, non-empty string without control characters")
    }

    fn visit_borrowed_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        validate_bounded_string::<E, MAX_BYTES>(value)
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        validate_bounded_string::<E, MAX_BYTES>(value)
    }
}

fn validate_bounded_string<E, const MAX_BYTES: usize>(
    value: &str,
) -> Result<BoundedString<MAX_BYTES>, E>
where
    E: de::Error,
{
    validate_string_bounds::<E, MAX_BYTES>(value)?;
    Ok(BoundedString)
}

fn validate_string_bounds<E, const MAX_BYTES: usize>(value: &str) -> Result<(), E>
where
    E: de::Error,
{
    if value.is_empty() || value.len() > MAX_BYTES || value.chars().any(char::is_control) {
        return Err(E::custom("string is outside the accepted bounds"));
    }
    Ok(())
}
