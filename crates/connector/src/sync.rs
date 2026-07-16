//! Exact-body composition for an isolated signed Community sync request.

use std::fmt;

use serde::ser::{Serialize, SerializeSeq, SerializeStruct, Serializer};
use sha2::{Digest, Sha256};

use crate::codex_0_144_4::{CANDIDATE_CODEX_VERSION, valid_reported_date};
use crate::{DailyUsage, DailyUsageEntry, MAX_DAILY_USAGE_ENTRIES, MAX_SYNC_TOKEN_VALUE};

mod signing;

pub use signing::{
    CandidateCommunitySyncV1Signer, DEVICE_PUBLIC_KEY_BYTES, DEVICE_SIGNATURE_ALGORITHM,
    DEVICE_SIGNATURE_BYTES, ReviewedDeviceSigningKey, SignedCommunitySync, SyncSigningError,
};

/// Fixed HTTP method for the version 1 Community sync operation.
pub const COMMUNITY_SYNC_METHOD: &str = "POST";

/// Fixed request target for the version 1 Community sync operation.
pub const COMMUNITY_SYNC_REQUEST_TARGET: &str = "/v1/community/sync";

/// Fixed request media type for the version 1 Community sync operation.
pub const COMMUNITY_SYNC_MEDIA_TYPE: &str = "application/json";

/// Maximum exact JSON body size admitted by the Community sync authentication policy.
pub const MAX_COMMUNITY_SYNC_BODY_BYTES: usize = 8 * 1024;

/// Domain-separation prefix for the version 1 device signature message.
pub const DEVICE_SIGNATURE_MESSAGE_PREFIX: &str = "viberacing-device-request-v1";

/// Exact byte length of a Community sync device nonce.
pub const DEVICE_NONCE_BYTES: usize = 16;

const CONNECTOR_SYNC_SCHEMA_VERSION: u8 = 1;
const CONNECTOR_VERSION: &str = env!("CARGO_PKG_VERSION");
const SOURCE_ID_PREFIX: &str = "src_";
const SYNC_ID_PREFIX: &str = "syn_";
const DEVICE_ID_PREFIX: &str = "dev_";
const IDENTIFIER_LENGTH: usize = 26;
const IDENTIFIER_SUFFIX_LENGTH: usize = 22;
const BASE64URL_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// One-use capability containing future-reviewed source, device, clock, identifier, and nonce
/// inputs for a Community sync request.
///
/// This type deliberately has no public constructor, accessor, `Clone`, or `Debug`. A future
/// source-bound device boundary must load the paired identifiers, obtain canonical UTC time, and
/// generate a fresh cryptographic sync identifier and nonce before constructing it inside this
/// crate. The composer is therefore executable under tests but cannot create a caller-selected or
/// replay-prone request today.
pub struct ReviewedCommunitySyncContext {
    source_id: String,
    sync_id: String,
    observed_at: String,
    device_id: String,
    device_nonce: [u8; DEVICE_NONCE_BYTES],
}

/// Exact unsigned Community sync material ready for the isolated Ed25519 signer.
///
/// The body and signature message contain private usage and security material. This type does not
/// implement `Debug`, `Display`, `Clone`, serialization, or public accessors. It can only be
/// consumed by [`CandidateCommunitySyncV1Signer`]; callers must not log or transmit it.
pub struct PreparedCommunitySync {
    body: Vec<u8>,
    device_signature_message: Vec<u8>,
    device_id: String,
    device_nonce: String,
    observed_at: String,
    sync_id: String,
}

impl Drop for PreparedCommunitySync {
    fn drop(&mut self) {
        self.body.fill(0);
        self.device_signature_message.fill(0);
    }
}

/// Stable, non-reflective failures from exact Community sync preparation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SyncPreparationError {
    /// The reviewed source identifier did not match the closed version 1 grammar.
    InvalidSourceId,
    /// The reviewed sync identifier did not match the closed version 1 grammar.
    InvalidSyncId,
    /// The reviewed observation time was not canonical millisecond UTC.
    InvalidObservedAt,
    /// The reviewed device identifier did not match the closed version 1 grammar.
    InvalidDeviceId,
    /// Daily usage was empty, unbounded, unsorted, duplicated, or outside contract bounds.
    InvalidDailyUsage,
    /// Exact JSON serialization failed.
    SerializationFailed,
    /// The exact serialized body exceeded the versioned authentication-policy budget.
    BodyLimitExceeded,
}

impl fmt::Display for SyncPreparationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidSourceId => "community sync source identifier is invalid",
            Self::InvalidSyncId => "community sync identifier is invalid",
            Self::InvalidObservedAt => "community sync timestamp is invalid",
            Self::InvalidDeviceId => "community sync device identifier is invalid",
            Self::InvalidDailyUsage => "community sync daily usage is invalid",
            Self::SerializationFailed => "community sync serialization failed",
            Self::BodyLimitExceeded => "community sync body exceeds the size limit",
        })
    }
}

impl std::error::Error for SyncPreparationError {}

/// Candidate-only exact-body composer for `ConnectorSyncV1` and its device signature message.
pub struct CandidateCommunitySyncV1Composer;

impl CandidateCommunitySyncV1Composer {
    /// Consumes one reviewed context and minimized daily usage into bounded unsigned request
    /// material for the isolated signer.
    ///
    /// The body uses the fixed connector crate version and candidate Codex `0.144.4` version. The
    /// SHA-256 digest is calculated over the exact returned body bytes, then bound into the exact
    /// version 1 LF-separated message. No key is loaded and no signature, HTTP request, persistence,
    /// key-store access, HTTP request, persistence, log, or network operation is created.
    ///
    /// # Errors
    ///
    /// Returns a stable [`SyncPreparationError`] when reviewed identifiers, time, usage, exact JSON,
    /// or the body-size budget fail closed. Submitted values and private usage are never reflected
    /// in the error.
    pub fn compose(
        context: ReviewedCommunitySyncContext,
        daily_usage: DailyUsage,
    ) -> Result<PreparedCommunitySync, SyncPreparationError> {
        validate_context(&context)?;
        if !valid_daily_usage(&daily_usage) {
            return Err(SyncPreparationError::InvalidDailyUsage);
        }
        let body = {
            let daily_entries = daily_usage.into_entries();
            serde_json::to_vec(&ConnectorSyncBody {
                source_id: &context.source_id,
                sync_id: &context.sync_id,
                observed_at: &context.observed_at,
                daily_entries: &daily_entries,
            })
            .map_err(|_| SyncPreparationError::SerializationFailed)?
        };
        if body.is_empty() || body.len() > MAX_COMMUNITY_SYNC_BODY_BYTES {
            return Err(SyncPreparationError::BodyLimitExceeded);
        }

        let body_digest = Sha256::digest(&body);
        let body_digest_base64url = encode_base64url(body_digest.as_ref());
        let device_nonce = encode_base64url(&context.device_nonce);
        let device_signature_message = [
            DEVICE_SIGNATURE_MESSAGE_PREFIX,
            COMMUNITY_SYNC_METHOD,
            COMMUNITY_SYNC_REQUEST_TARGET,
            &body_digest_base64url,
            &context.device_id,
            &device_nonce,
            &context.observed_at,
            &context.sync_id,
        ]
        .join("\n")
        .into_bytes();

        Ok(PreparedCommunitySync {
            body,
            device_signature_message,
            device_id: context.device_id,
            device_nonce,
            observed_at: context.observed_at,
            sync_id: context.sync_id,
        })
    }
}

fn validate_context(context: &ReviewedCommunitySyncContext) -> Result<(), SyncPreparationError> {
    if !valid_identifier(&context.source_id, SOURCE_ID_PREFIX) {
        return Err(SyncPreparationError::InvalidSourceId);
    }
    if !valid_identifier(&context.sync_id, SYNC_ID_PREFIX) {
        return Err(SyncPreparationError::InvalidSyncId);
    }
    if !valid_timestamp(&context.observed_at) {
        return Err(SyncPreparationError::InvalidObservedAt);
    }
    if !valid_identifier(&context.device_id, DEVICE_ID_PREFIX) {
        return Err(SyncPreparationError::InvalidDeviceId);
    }
    Ok(())
}

fn valid_identifier(value: &str, prefix: &str) -> bool {
    value.len() == IDENTIFIER_LENGTH
        && value.starts_with(prefix)
        && value.len() - prefix.len() == IDENTIFIER_SUFFIX_LENGTH
        && value[prefix.len()..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
        || bytes.iter().enumerate().any(|(index, byte)| {
            !matches!(index, 4 | 7 | 10 | 13 | 16 | 19 | 23) && !byte.is_ascii_digit()
        })
    {
        return false;
    }

    let hour = (bytes[11] - b'0') * 10 + (bytes[12] - b'0');
    let minute = (bytes[14] - b'0') * 10 + (bytes[15] - b'0');
    let second = (bytes[17] - b'0') * 10 + (bytes[18] - b'0');
    valid_reported_date(&value[..10]) && hour <= 23 && minute <= 59 && second <= 59
}

fn valid_daily_usage(daily_usage: &DailyUsage) -> bool {
    let entries = daily_usage.entries();
    !entries.is_empty()
        && entries.len() <= MAX_DAILY_USAGE_ENTRIES
        && entries.iter().all(|entry| {
            valid_reported_date(entry.codex_reported_date())
                && entry.tokens() <= MAX_SYNC_TOKEN_VALUE
        })
        && entries
            .windows(2)
            .all(|pair| pair[0].codex_reported_date() < pair[1].codex_reported_date())
}

fn encode_base64url(input: &[u8]) -> String {
    let mut output = String::with_capacity(input.len().saturating_mul(4).div_ceil(3));
    let mut chunks = input.chunks_exact(3);
    for chunk in &mut chunks {
        let value = (u32::from(chunk[0]) << 16) | (u32::from(chunk[1]) << 8) | u32::from(chunk[2]);
        output.push(char::from(
            BASE64URL_ALPHABET[((value >> 18) & 0x3f) as usize],
        ));
        output.push(char::from(
            BASE64URL_ALPHABET[((value >> 12) & 0x3f) as usize],
        ));
        output.push(char::from(
            BASE64URL_ALPHABET[((value >> 6) & 0x3f) as usize],
        ));
        output.push(char::from(BASE64URL_ALPHABET[(value & 0x3f) as usize]));
    }

    match chunks.remainder() {
        [first] => {
            let value = u32::from(*first) << 16;
            output.push(char::from(
                BASE64URL_ALPHABET[((value >> 18) & 0x3f) as usize],
            ));
            output.push(char::from(
                BASE64URL_ALPHABET[((value >> 12) & 0x3f) as usize],
            ));
        }
        [first, second] => {
            let value = (u32::from(*first) << 16) | (u32::from(*second) << 8);
            output.push(char::from(
                BASE64URL_ALPHABET[((value >> 18) & 0x3f) as usize],
            ));
            output.push(char::from(
                BASE64URL_ALPHABET[((value >> 12) & 0x3f) as usize],
            ));
            output.push(char::from(
                BASE64URL_ALPHABET[((value >> 6) & 0x3f) as usize],
            ));
        }
        [] => {}
        _ => unreachable!("chunks_exact remainder is shorter than the chunk size"),
    }
    output
}

struct ConnectorSyncBody<'a> {
    source_id: &'a str,
    sync_id: &'a str,
    observed_at: &'a str,
    daily_entries: &'a [DailyUsageEntry],
}

impl Serialize for ConnectorSyncBody<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("ConnectorSyncV1", 7)?;
        state.serialize_field("schemaVersion", &CONNECTOR_SYNC_SCHEMA_VERSION)?;
        state.serialize_field("sourceId", self.source_id)?;
        state.serialize_field("syncId", self.sync_id)?;
        state.serialize_field("observedAt", self.observed_at)?;
        state.serialize_field("connectorVersion", CONNECTOR_VERSION)?;
        state.serialize_field("codexVersion", CANDIDATE_CODEX_VERSION)?;
        state.serialize_field("dailyEntries", &DailyEntries(self.daily_entries))?;
        state.end()
    }
}

struct DailyEntries<'a>(&'a [DailyUsageEntry]);

impl Serialize for DailyEntries<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for entry in self.0 {
            sequence.serialize_element(&DailyEntry(entry))?;
        }
        sequence.end()
    }
}

struct DailyEntry<'a>(&'a DailyUsageEntry);

impl Serialize for DailyEntry<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("ConnectorSyncDailyEntryV1", 2)?;
        state.serialize_field("codexReportedDate", self.0.codex_reported_date())?;
        state.serialize_field("tokens", &self.0.tokens())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::ConnectorHandshake;

    const INITIALIZE_RESPONSE: &[u8] = b"{\"id\":0,\"result\":{\"codexHome\":\"/synthetic/codex-home\",\"platformFamily\":\"unix\",\"platformOs\":\"linux\",\"userAgent\":\"codex-cli/0.144.4\"}}\n";
    const ACCOUNT_RESPONSE: &[u8] = b"{\"id\":1,\"result\":{\"account\":{\"email\":\"racer@example.invalid\",\"planType\":\"plus\",\"type\":\"chatgpt\"},\"requiresOpenaiAuth\":false}}\n";
    const SOURCE_ID: &str = "src_AAAAAAAAAAAAAAAAAAAAAA";
    const SYNC_ID: &str = "syn_BBBBBBBBBBBBBBBBBBBBBB";
    const OBSERVED_AT: &str = "2026-07-15T12:34:56.789Z";
    const DEVICE_ID: &str = "dev_CCCCCCCCCCCCCCCCCCCCCC";
    const OTHER_DEVICE_ID: &str = "dev_DDDDDDDDDDDDDDDDDDDDDD";
    const EXPECTED_NONCE: &str = "AAECAwQFBgcICQoLDA0ODw";
    const TEST_SIGNING_KEY_LABEL: &[u8] = b"viberacing-test-only-device-signing-key-v1";

    type ContextMutation = fn(&mut ReviewedCommunitySyncContext);

    const fn sequential_nonce() -> [u8; DEVICE_NONCE_BYTES] {
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    }

    impl ReviewedCommunitySyncContext {
        fn for_test() -> Self {
            Self {
                source_id: SOURCE_ID.to_owned(),
                sync_id: SYNC_ID.to_owned(),
                observed_at: OBSERVED_AT.to_owned(),
                device_id: DEVICE_ID.to_owned(),
                device_nonce: sequential_nonce(),
            }
        }
    }

    fn usage_from_buckets(buckets: &str) -> DailyUsage {
        let mut handshake = ConnectorHandshake::new();
        handshake.start().expect("handshake request must start");
        handshake
            .accept_initialize_response(INITIALIZE_RESPONSE)
            .expect("synthetic initialization must be accepted");
        let mut account_usage = handshake
            .into_codex_0_144_4_account_usage()
            .expect("completed handshake must enter candidate adapter");
        account_usage
            .start_account_read()
            .expect("account request must start");
        account_usage
            .accept_account_read_response(ACCOUNT_RESPONSE)
            .expect("synthetic account must be accepted");
        account_usage
            .start_usage_read()
            .expect("usage request must start");
        let response = format!(
            "{{\"id\":2,\"result\":{{\"dailyUsageBuckets\":{buckets},\"summary\":{{}}}}}}\n"
        );
        account_usage
            .accept_usage_read_response(response.as_bytes())
            .expect("synthetic daily usage must be accepted")
    }

    fn standard_usage() -> DailyUsage {
        usage_from_buckets(
            "[{\"startDate\":\"2026-07-14\",\"tokens\":456},{\"startDate\":\"2026-07-13\",\"tokens\":123}]",
        )
    }

    fn test_signing_key(device_id: &str) -> ReviewedDeviceSigningKey {
        let digest = Sha256::digest(TEST_SIGNING_KEY_LABEL);
        let mut secret_key = [0_u8; ed25519_dalek::SECRET_KEY_LENGTH];
        secret_key.copy_from_slice(&digest);
        ReviewedDeviceSigningKey::for_test(device_id, secret_key)
    }

    fn shared_test_vector() -> Value {
        serde_json::from_str(include_str!(
            "../../../contracts/v1/connector-sync-device-request.test-vector.json"
        ))
        .expect("shared Community sync vector must remain valid JSON")
    }

    #[test]
    fn composes_the_exact_body_digest_and_device_message() {
        let prepared = CandidateCommunitySyncV1Composer::compose(
            ReviewedCommunitySyncContext::for_test(),
            standard_usage(),
        )
        .expect("reviewed synthetic inputs must compose");

        let vector = shared_test_vector();
        let expected_body = vector["body"]
            .as_str()
            .expect("shared vector body must be a string");
        let expected_digest = vector["bodyDigestBase64Url"]
            .as_str()
            .expect("shared vector digest must be a string");
        let expected_message = vector["deviceSignatureMessage"]
            .as_str()
            .expect("shared vector message must be a string");

        assert_eq!(vector["schemaVersion"], CONNECTOR_SYNC_SCHEMA_VERSION);
        assert_eq!(vector["sourceId"], SOURCE_ID);
        assert_eq!(vector["syncId"], SYNC_ID);
        assert_eq!(vector["observedAt"], OBSERVED_AT);
        assert_eq!(vector["deviceId"], DEVICE_ID);
        assert_eq!(
            vector["deviceNonceBytes"],
            serde_json::json!(sequential_nonce())
        );
        assert_eq!(vector["deviceNonceBase64Url"], EXPECTED_NONCE);
        assert_eq!(prepared.body, expected_body.as_bytes());
        assert_eq!(
            encode_base64url(Sha256::digest(&prepared.body).as_ref()),
            expected_digest
        );
        assert_eq!(
            prepared.device_signature_message,
            expected_message.as_bytes()
        );
        assert_eq!(prepared.device_id, DEVICE_ID);
        assert_eq!(prepared.device_nonce, EXPECTED_NONCE);
        assert_eq!(prepared.observed_at, OBSERVED_AT);
        assert_eq!(prepared.sync_id, SYNC_ID);
        assert!(prepared.body.len() <= MAX_COMMUNITY_SYNC_BODY_BYTES);
        assert!(!prepared.device_signature_message.ends_with(b"\n"));
    }

    #[test]
    fn signs_the_exact_shared_device_request_vector() {
        let prepared = CandidateCommunitySyncV1Composer::compose(
            ReviewedCommunitySyncContext::for_test(),
            standard_usage(),
        )
        .expect("reviewed synthetic inputs must compose");
        let key = test_signing_key(DEVICE_ID);
        let public_key = encode_base64url(&key.verifying_key_bytes());
        let signed = CandidateCommunitySyncV1Signer::sign(key, prepared)
            .expect("device-bound synthetic key must sign");

        let vector = shared_test_vector();
        let expected_body = vector["body"]
            .as_str()
            .expect("shared vector body must be a string");
        assert_eq!(
            public_key,
            vector["devicePublicKeyBase64Url"]
                .as_str()
                .expect("shared vector public key must be a string")
        );
        assert_eq!(
            signed.device_signature(),
            vector["deviceSignatureBase64Url"]
                .as_str()
                .expect("shared vector signature must be a string")
        );
        assert_eq!(signed.body(), expected_body.as_bytes());
        assert_eq!(signed.device_id(), DEVICE_ID);
        assert_eq!(signed.device_nonce(), EXPECTED_NONCE);
        assert_eq!(signed.device_timestamp(), OBSERVED_AT);
        assert_eq!(signed.idempotency_key(), SYNC_ID);
    }

    #[test]
    fn rejects_a_key_bound_to_another_device_without_reflection() {
        let prepared = CandidateCommunitySyncV1Composer::compose(
            ReviewedCommunitySyncContext::for_test(),
            standard_usage(),
        )
        .expect("reviewed synthetic inputs must compose");
        let error =
            CandidateCommunitySyncV1Signer::sign(test_signing_key(OTHER_DEVICE_ID), prepared)
                .err()
                .expect("a differently bound key must fail closed");

        assert_eq!(error, SyncSigningError::DeviceBindingMismatch);
        assert!(!error.to_string().contains(DEVICE_ID));
        assert!(!error.to_string().contains(OTHER_DEVICE_ID));
        assert!(!format!("{error:?}").contains(DEVICE_ID));
        assert!(!format!("{error:?}").contains(OTHER_DEVICE_ID));
    }

    #[test]
    fn different_production_parsed_usage_changes_the_signature() {
        let first = CandidateCommunitySyncV1Signer::sign(
            test_signing_key(DEVICE_ID),
            CandidateCommunitySyncV1Composer::compose(
                ReviewedCommunitySyncContext::for_test(),
                usage_from_buckets("[{\"startDate\":\"2026-07-14\",\"tokens\":456}]"),
            )
            .expect("first usage must compose"),
        )
        .expect("first usage must sign");
        let second = CandidateCommunitySyncV1Signer::sign(
            test_signing_key(DEVICE_ID),
            CandidateCommunitySyncV1Composer::compose(
                ReviewedCommunitySyncContext::for_test(),
                usage_from_buckets("[{\"startDate\":\"2026-07-14\",\"tokens\":457}]"),
            )
            .expect("second usage must compose"),
        )
        .expect("second usage must sign");

        assert_ne!(first.body(), second.body());
        assert_ne!(first.device_signature(), second.device_signature());
    }

    #[test]
    fn rejects_invalid_context_fields_without_reflecting_them() {
        let cases: [(ContextMutation, SyncPreparationError); 4] = [
            (
                |context: &mut ReviewedCommunitySyncContext| context.source_id = "private".into(),
                SyncPreparationError::InvalidSourceId,
            ),
            (
                |context: &mut ReviewedCommunitySyncContext| context.sync_id = "private".into(),
                SyncPreparationError::InvalidSyncId,
            ),
            (
                |context: &mut ReviewedCommunitySyncContext| {
                    context.observed_at = "2026-02-29T12:34:56.789Z".into();
                },
                SyncPreparationError::InvalidObservedAt,
            ),
            (
                |context: &mut ReviewedCommunitySyncContext| context.device_id = "private".into(),
                SyncPreparationError::InvalidDeviceId,
            ),
        ];

        for (mutate, expected) in cases {
            let mut context = ReviewedCommunitySyncContext::for_test();
            mutate(&mut context);
            let error = CandidateCommunitySyncV1Composer::compose(context, standard_usage())
                .err()
                .expect("invalid reviewed context must fail closed");
            assert_eq!(error, expected);
            assert!(!error.to_string().contains("private"));
            assert!(!format!("{error:?}").contains("private"));
        }

        assert!(valid_identifier(SOURCE_ID, SOURCE_ID_PREFIX));
        assert!(valid_identifier(SYNC_ID, SYNC_ID_PREFIX));
        assert!(valid_identifier(DEVICE_ID, DEVICE_ID_PREFIX));
        assert!(!valid_identifier(DEVICE_ID, SOURCE_ID_PREFIX));
        assert!(!valid_identifier(&SOURCE_ID[..25], SOURCE_ID_PREFIX));

        let mut invalid_character = SOURCE_ID.to_owned();
        invalid_character.replace_range(25..26, "!");
        assert!(!valid_identifier(&invalid_character, SOURCE_ID_PREFIX));

        let mut non_ascii = SOURCE_ID.to_owned();
        non_ascii.replace_range(24..26, "é");
        assert!(!valid_identifier(&non_ascii, SOURCE_ID_PREFIX));
    }

    #[test]
    fn enforces_canonical_timestamp_boundaries() {
        for invalid in [
            "2026-07-15T24:00:00.000Z",
            "2026-07-15T23:60:00.000Z",
            "2026-07-15T23:59:60.000Z",
            "2026-07-15T23:59:59Z",
            "2026-07-15T23:59:59.000+00:00",
            "2100-01-01T00:00:00.000Z",
        ] {
            let mut context = ReviewedCommunitySyncContext::for_test();
            context.observed_at = invalid.to_owned();
            assert_eq!(
                CandidateCommunitySyncV1Composer::compose(context, standard_usage()).err(),
                Some(SyncPreparationError::InvalidObservedAt)
            );
        }

        let mut leap_day = ReviewedCommunitySyncContext::for_test();
        leap_day.observed_at = "2024-02-29T00:00:00.000Z".to_owned();
        let prepared = CandidateCommunitySyncV1Composer::compose(leap_day, standard_usage())
            .expect("canonical leap-day timestamp must be admitted");
        assert_eq!(prepared.observed_at, "2024-02-29T00:00:00.000Z");
    }

    #[test]
    fn rejects_empty_usage_and_admits_the_contract_maximum() {
        let empty = usage_from_buckets("[]");
        assert_eq!(
            CandidateCommunitySyncV1Composer::compose(
                ReviewedCommunitySyncContext::for_test(),
                empty
            )
            .err(),
            Some(SyncPreparationError::InvalidDailyUsage)
        );

        let buckets = (1_u8..=31)
            .map(|day| {
                format!("{{\"startDate\":\"2026-07-{day:02}\",\"tokens\":{MAX_SYNC_TOKEN_VALUE}}}")
            })
            .collect::<Vec<_>>()
            .join(",");
        let maximum = usage_from_buckets(&format!("[{buckets}]"));
        let prepared = CandidateCommunitySyncV1Composer::compose(
            ReviewedCommunitySyncContext::for_test(),
            maximum,
        )
        .expect("maximum contract usage must fit the transport body budget");
        assert!(prepared.body.len() <= MAX_COMMUNITY_SYNC_BODY_BYTES);
        assert_eq!(
            serde_json::from_slice::<Value>(&prepared.body)
                .expect("prepared bytes must remain JSON")["dailyEntries"]
                .as_array()
                .expect("daily entries must be an array")
                .len(),
            MAX_DAILY_USAGE_ENTRIES
        );
    }

    #[test]
    fn base64url_encoder_matches_fixed_binary_boundaries() {
        assert_eq!(encode_base64url(&[]), "");
        assert_eq!(encode_base64url(&[0]), "AA");
        assert_eq!(encode_base64url(&[0, 1]), "AAE");
        assert_eq!(encode_base64url(&[0, 1, 2]), "AAEC");
        assert_eq!(
            encode_base64url(&[0xff; DEVICE_NONCE_BYTES]),
            "_____________________w"
        );
        assert_eq!(encode_base64url(&sequential_nonce()), EXPECTED_NONCE);
    }

    #[test]
    fn executable_constants_match_the_versioned_authentication_policy() {
        let policy: Value = serde_json::from_str(include_str!(
            "../../../contracts/v1/connector-sync-authentication.json"
        ))
        .expect("authentication policy must remain valid JSON");

        assert_eq!(policy["method"], COMMUNITY_SYNC_METHOD);
        assert_eq!(policy["requestTarget"], COMMUNITY_SYNC_REQUEST_TARGET);
        assert_eq!(policy["mediaType"], COMMUNITY_SYNC_MEDIA_TYPE);
        assert_eq!(policy["maximumBodyBytes"], MAX_COMMUNITY_SYNC_BODY_BYTES);
        assert_eq!(
            policy["deviceSignature"]["messagePrefix"],
            DEVICE_SIGNATURE_MESSAGE_PREFIX
        );
        assert_eq!(
            policy["deviceSignature"]["algorithm"],
            DEVICE_SIGNATURE_ALGORITHM
        );
        assert_eq!(
            policy["deviceSignature"]["publicKeyBytes"],
            DEVICE_PUBLIC_KEY_BYTES
        );
        assert_eq!(
            policy["deviceSignature"]["signatureBytes"],
            DEVICE_SIGNATURE_BYTES
        );
        assert_eq!(policy["deviceSignature"]["nonceBytes"], DEVICE_NONCE_BYTES);
        assert_eq!(
            policy["deviceSignature"]["canonicalFields"],
            serde_json::json!([
                "messagePrefix",
                "method",
                "requestTarget",
                "bodyDigestBase64Url",
                "deviceId",
                "nonce",
                "timestamp",
                "idempotencyKey"
            ])
        );
        assert_eq!(policy["canonicalMessageSeparator"], "LF");
        assert_eq!(policy["canonicalMessageTrailingSeparator"], false);
        assert_eq!(policy["binaryEncoding"], "base64url-unpadded");
        assert_eq!(policy["digestEncoding"], "base64url-unpadded");
    }
}
