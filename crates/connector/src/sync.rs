//! Exact-body composition for one provider-neutral signed Usage Sync request.

use std::fmt;

use serde::ser::{Serialize, SerializeSeq, SerializeStruct, Serializer};
use sha2::{Digest, Sha256};

use crate::{CanonicalDailyUsage, CanonicalDailyUsageEntry};

mod signing;

pub use signing::{
    DEVICE_PUBLIC_KEY_BYTES, DEVICE_SIGNATURE_ALGORITHM, DEVICE_SIGNATURE_BYTES,
    ReviewedDeviceSigningKey, SignedUsageSync, UsageSyncSigningError, UsageSyncV1Signer,
};

/// Fixed HTTP method for the final version 1 Usage Sync operation.
pub const USAGE_SYNC_METHOD: &str = "POST";

/// Sole fixed request target for the final version 1 Usage Sync operation.
pub const USAGE_SYNC_REQUEST_TARGET: &str = "/v1/usage";

/// Fixed request media type for the final version 1 Usage Sync operation.
pub const USAGE_SYNC_MEDIA_TYPE: &str = "application/json";

/// Maximum exact JSON body size admitted by the Usage Sync authentication policy.
pub const MAX_USAGE_SYNC_BODY_BYTES: usize = 8 * 1024;

/// Domain-separation prefix for the version 1 device signature message.
pub const DEVICE_SIGNATURE_MESSAGE_PREFIX: &str = "viberacing-device-request-v1";

/// Exact byte length of a Usage Sync device nonce.
pub const DEVICE_NONCE_BYTES: usize = 16;

const USAGE_SYNC_SCHEMA_VERSION: u8 = 1;
const CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const AGENT_ACCOUNT_ID_PREFIX: &str = "acc_";
const SYNC_ID_PREFIX: &str = "syn_";
const DEVICE_ID_PREFIX: &str = "dev_";
const IDENTIFIER_LENGTH: usize = 26;
const IDENTIFIER_SUFFIX_LENGTH: usize = 22;
const MAX_READER_VERSION_BYTES: usize = 64;
const BASE64URL_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// One-use capability containing reviewed account, reader, device, clock, identifier, and nonce
/// inputs for a Usage Sync request.
///
/// This type deliberately has no public constructor, accessor, `Clone`, or `Debug`. The private
/// one-shot sync command loads one active account-scoped device binding, obtains canonical UTC
/// time, and generates a fresh cryptographic sync identifier and nonce before constructing it
/// inside this crate.
pub struct ReviewedUsageSyncContext {
    agent_account_id: String,
    reader_version: String,
    sync_id: String,
    observed_at: String,
    device_id: String,
    device_nonce: [u8; DEVICE_NONCE_BYTES],
}

impl ReviewedUsageSyncContext {
    pub(crate) fn from_active_account(
        agent_account_id: String,
        reader_version: String,
        sync_id: String,
        observed_at: String,
        device_id: String,
        device_nonce: [u8; DEVICE_NONCE_BYTES],
    ) -> Self {
        Self {
            agent_account_id,
            reader_version,
            sync_id,
            observed_at,
            device_id,
            device_nonce,
        }
    }
}

/// Exact unsigned Usage Sync material ready for the isolated Ed25519 signer.
///
/// The body and signature message contain private usage and security material. This type does not
/// implement `Debug`, `Display`, `Clone`, serialization, or public accessors. It can only be
/// consumed by [`UsageSyncV1Signer`].
pub struct PreparedUsageSync {
    body: Vec<u8>,
    device_signature_message: Vec<u8>,
    device_id: String,
    device_nonce: String,
    observed_at: String,
    sync_id: String,
}

impl Drop for PreparedUsageSync {
    fn drop(&mut self) {
        self.body.fill(0);
        self.device_signature_message.fill(0);
    }
}

/// Stable, non-reflective failures from exact Usage Sync preparation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UsageSyncPreparationError {
    /// The reviewed `AgentAccount` identifier did not match the closed V1 grammar.
    InvalidAgentAccountId,
    /// The immutable reader version did not match the closed V1 grammar.
    InvalidReaderVersion,
    /// The reviewed sync identifier did not match the closed V1 grammar.
    InvalidSyncId,
    /// The reviewed observation time was not canonical millisecond UTC.
    InvalidObservedAt,
    /// The reviewed device identifier did not match the closed V1 grammar.
    InvalidDeviceId,
    /// Daily usage was empty or outside the canonical collection bounds.
    InvalidDailyUsage,
    /// Exact JSON serialization failed.
    SerializationFailed,
    /// The exact serialized body exceeded the authentication-policy budget.
    BodyLimitExceeded,
}

impl fmt::Display for UsageSyncPreparationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidAgentAccountId => "usage sync account identifier is invalid",
            Self::InvalidReaderVersion => "usage sync reader version is invalid",
            Self::InvalidSyncId => "usage sync identifier is invalid",
            Self::InvalidObservedAt => "usage sync timestamp is invalid",
            Self::InvalidDeviceId => "usage sync device identifier is invalid",
            Self::InvalidDailyUsage => "usage sync daily totals are invalid",
            Self::SerializationFailed => "usage sync serialization failed",
            Self::BodyLimitExceeded => "usage sync body exceeds the size limit",
        })
    }
}

impl std::error::Error for UsageSyncPreparationError {}

/// Exact-body composer for final `UsageSyncV1` and its device-signature message.
pub struct UsageSyncV1Composer;

impl UsageSyncV1Composer {
    /// Consumes one reviewed context and one provider-neutral canonical usage value.
    ///
    /// Provider, accounting revision, scope, profile, rank, trust, model, component breakdown, and
    /// raw identity cannot enter this body. The SHA-256 digest is calculated over the exact returned
    /// bytes and bound into the final LF-separated device message.
    ///
    /// # Errors
    ///
    /// Returns a stable [`UsageSyncPreparationError`] when reviewed identifiers, reader version,
    /// time, usage, exact JSON, or body-size limits fail closed.
    pub fn compose(
        context: ReviewedUsageSyncContext,
        daily_usage: &CanonicalDailyUsage,
    ) -> Result<PreparedUsageSync, UsageSyncPreparationError> {
        validate_context(&context)?;
        if daily_usage.is_empty() {
            return Err(UsageSyncPreparationError::InvalidDailyUsage);
        }
        let body = serde_json::to_vec(&UsageSyncBody {
            agent_account_id: &context.agent_account_id,
            sync_id: &context.sync_id,
            observed_at: &context.observed_at,
            reader_version: &context.reader_version,
            daily_entries: daily_usage.entries(),
        })
        .map_err(|_| UsageSyncPreparationError::SerializationFailed)?;
        if body.is_empty() || body.len() > MAX_USAGE_SYNC_BODY_BYTES {
            return Err(UsageSyncPreparationError::BodyLimitExceeded);
        }

        let body_digest = Sha256::digest(&body);
        let body_digest_base64url = encode_base64url(body_digest.as_ref());
        let device_nonce = encode_base64url(&context.device_nonce);
        let device_signature_message = [
            DEVICE_SIGNATURE_MESSAGE_PREFIX,
            USAGE_SYNC_METHOD,
            USAGE_SYNC_REQUEST_TARGET,
            &body_digest_base64url,
            &context.device_id,
            &device_nonce,
            &context.observed_at,
            &context.sync_id,
        ]
        .join("\n")
        .into_bytes();

        Ok(PreparedUsageSync {
            body,
            device_signature_message,
            device_id: context.device_id,
            device_nonce,
            observed_at: context.observed_at,
            sync_id: context.sync_id,
        })
    }
}

fn validate_context(context: &ReviewedUsageSyncContext) -> Result<(), UsageSyncPreparationError> {
    if !valid_identifier(&context.agent_account_id, AGENT_ACCOUNT_ID_PREFIX) {
        return Err(UsageSyncPreparationError::InvalidAgentAccountId);
    }
    if !valid_reader_version(&context.reader_version) {
        return Err(UsageSyncPreparationError::InvalidReaderVersion);
    }
    if !valid_identifier(&context.sync_id, SYNC_ID_PREFIX) {
        return Err(UsageSyncPreparationError::InvalidSyncId);
    }
    if !valid_timestamp(&context.observed_at) {
        return Err(UsageSyncPreparationError::InvalidObservedAt);
    }
    if !valid_identifier(&context.device_id, DEVICE_ID_PREFIX) {
        return Err(UsageSyncPreparationError::InvalidDeviceId);
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

fn valid_reader_version(value: &str) -> bool {
    value.len() >= 3
        && value.len() <= MAX_READER_VERSION_BYTES
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
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
    valid_date(&value[..10]) && hour <= 23 && minute <= 59 && second <= 59
}

fn valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || &bytes[0..2] != b"20"
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| index != 4 && index != 7 && !byte.is_ascii_digit())
    {
        return false;
    }
    let year = u16::from(bytes[0] - b'0') * 1_000
        + u16::from(bytes[1] - b'0') * 100
        + u16::from(bytes[2] - b'0') * 10
        + u16::from(bytes[3] - b'0');
    let month = (bytes[5] - b'0') * 10 + (bytes[6] - b'0');
    let day = (bytes[8] - b'0') * 10 + (bytes[9] - b'0');
    let maximum_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1 && day <= maximum_day
}

pub(crate) fn encode_base64url(input: &[u8]) -> String {
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

struct UsageSyncBody<'a> {
    agent_account_id: &'a str,
    sync_id: &'a str,
    observed_at: &'a str,
    reader_version: &'a str,
    daily_entries: &'a [CanonicalDailyUsageEntry],
}

impl Serialize for UsageSyncBody<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("UsageSyncV1", 7)?;
        state.serialize_field("schemaVersion", &USAGE_SYNC_SCHEMA_VERSION)?;
        state.serialize_field("agentAccountId", self.agent_account_id)?;
        state.serialize_field("syncId", self.sync_id)?;
        state.serialize_field("observedAt", self.observed_at)?;
        state.serialize_field("clientVersion", CLIENT_VERSION)?;
        state.serialize_field("readerVersion", self.reader_version)?;
        state.serialize_field("dailyEntries", &DailyEntries(self.daily_entries))?;
        state.end()
    }
}

struct DailyEntries<'a>(&'a [CanonicalDailyUsageEntry]);

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

struct DailyEntry<'a>(&'a CanonicalDailyUsageEntry);

impl Serialize for DailyEntry<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("UsageSyncDailyEntryV1", 2)?;
        state.serialize_field("usageDate", self.0.usage_date())?;
        state.serialize_field("dailyTokenTotal", self.0.daily_token_total())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::{CanonicalDailyUsage, CanonicalDailyUsageEntry};

    const AGENT_ACCOUNT_ID: &str = "acc_AAAAAAAAAAAAAAAAAAAAAA";
    const READER_VERSION: &str = "codex_app_server_0_144_5_v1";
    const SYNC_ID: &str = "syn_BBBBBBBBBBBBBBBBBBBBBB";
    const OBSERVED_AT: &str = "2026-07-15T12:34:56.789Z";
    const DEVICE_ID: &str = "dev_CCCCCCCCCCCCCCCCCCCCCC";
    const OTHER_DEVICE_ID: &str = "dev_DDDDDDDDDDDDDDDDDDDDDD";
    const EXPECTED_NONCE: &str = "AAECAwQFBgcICQoLDA0ODw";
    const TEST_SIGNING_KEY_LABEL: &[u8] = b"viberacing-test-only-device-signing-key-v1";

    type ContextMutation = fn(&mut ReviewedUsageSyncContext);

    const fn sequential_nonce() -> [u8; DEVICE_NONCE_BYTES] {
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    }

    impl ReviewedUsageSyncContext {
        fn for_test() -> Self {
            Self {
                agent_account_id: AGENT_ACCOUNT_ID.to_owned(),
                reader_version: READER_VERSION.to_owned(),
                sync_id: SYNC_ID.to_owned(),
                observed_at: OBSERVED_AT.to_owned(),
                device_id: DEVICE_ID.to_owned(),
                device_nonce: sequential_nonce(),
            }
        }
    }

    fn standard_usage() -> CanonicalDailyUsage {
        CanonicalDailyUsage::new(
            [("2026-07-13", "123"), ("2026-07-14", "456")]
                .into_iter()
                .map(|(date, total)| {
                    CanonicalDailyUsageEntry::new(date.to_owned(), total.to_owned())
                        .expect("fixed entry must be canonical")
                })
                .collect(),
        )
        .expect("fixed usage must be canonical")
    }

    fn test_signing_key(device_id: &str) -> ReviewedDeviceSigningKey {
        let digest = Sha256::digest(TEST_SIGNING_KEY_LABEL);
        let mut secret_key = [0_u8; ed25519_dalek::SECRET_KEY_LENGTH];
        secret_key.copy_from_slice(&digest);
        ReviewedDeviceSigningKey::for_test(device_id, secret_key)
    }

    fn shared_test_vector() -> Value {
        serde_json::from_str(include_str!(
            "../../../contracts/v1/connector-usage-sync-device-request.test-vector.json"
        ))
        .expect("shared Usage Sync vector must remain valid JSON")
    }

    #[test]
    fn composes_the_exact_provider_neutral_body_and_device_message() {
        let prepared =
            UsageSyncV1Composer::compose(ReviewedUsageSyncContext::for_test(), &standard_usage())
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

        assert_eq!(vector["agentAccountId"], AGENT_ACCOUNT_ID);
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
        assert!(!expected_body.contains("provider"));
        assert!(!expected_body.contains("accountingRevision"));
        assert!(!expected_body.contains("sourceId"));
        assert!(prepared.body.len() <= MAX_USAGE_SYNC_BODY_BYTES);
        assert!(!prepared.device_signature_message.ends_with(b"\n"));
    }

    #[test]
    fn signs_the_exact_shared_device_request_vector() {
        let prepared =
            UsageSyncV1Composer::compose(ReviewedUsageSyncContext::for_test(), &standard_usage())
                .expect("reviewed synthetic inputs must compose");
        let key = test_signing_key(DEVICE_ID);
        let public_key = encode_base64url(&key.verifying_key_bytes());
        let signed =
            UsageSyncV1Signer::sign(key, prepared).expect("device-bound synthetic key must sign");
        let vector = shared_test_vector();

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
        assert_eq!(
            signed.body(),
            vector["body"]
                .as_str()
                .expect("shared vector body must be a string")
                .as_bytes()
        );
        assert_eq!(signed.device_id(), DEVICE_ID);
        assert_eq!(signed.device_nonce(), EXPECTED_NONCE);
        assert_eq!(signed.device_timestamp(), OBSERVED_AT);
        assert_eq!(signed.idempotency_key(), SYNC_ID);
    }

    #[test]
    fn rejects_invalid_context_without_reflection() {
        let cases: [(ContextMutation, UsageSyncPreparationError); 5] = [
            (
                |context| context.agent_account_id = "private".into(),
                UsageSyncPreparationError::InvalidAgentAccountId,
            ),
            (
                |context| context.reader_version = "private-version".into(),
                UsageSyncPreparationError::InvalidReaderVersion,
            ),
            (
                |context| context.sync_id = "private".into(),
                UsageSyncPreparationError::InvalidSyncId,
            ),
            (
                |context| context.observed_at = "2026-02-29T12:34:56.789Z".into(),
                UsageSyncPreparationError::InvalidObservedAt,
            ),
            (
                |context| context.device_id = "private".into(),
                UsageSyncPreparationError::InvalidDeviceId,
            ),
        ];
        for (mutate, expected) in cases {
            let mut context = ReviewedUsageSyncContext::for_test();
            mutate(&mut context);
            let error = UsageSyncV1Composer::compose(context, &standard_usage())
                .err()
                .expect("invalid reviewed context must fail closed");
            assert_eq!(error, expected);
            assert!(!error.to_string().contains("private"));
            assert!(!format!("{error:?}").contains("private"));
        }

        let prepared =
            UsageSyncV1Composer::compose(ReviewedUsageSyncContext::for_test(), &standard_usage())
                .expect("fixed request must prepare");
        let error = UsageSyncV1Signer::sign(test_signing_key(OTHER_DEVICE_ID), prepared)
            .err()
            .expect("another device key must fail");
        assert_eq!(error, UsageSyncSigningError::DeviceBindingMismatch);
        assert!(!error.to_string().contains(DEVICE_ID));
        assert!(!error.to_string().contains(OTHER_DEVICE_ID));
    }

    #[test]
    fn rejects_empty_usage_and_admits_31_exact_decimal_entries() {
        assert_eq!(
            UsageSyncV1Composer::compose(
                ReviewedUsageSyncContext::for_test(),
                &CanonicalDailyUsage::new(Vec::new()).expect("empty reader output is valid"),
            )
            .err(),
            Some(UsageSyncPreparationError::InvalidDailyUsage)
        );
        let entries = (1_u8..=31)
            .map(|day| {
                CanonicalDailyUsageEntry::new(
                    format!("2026-07-{day:02}"),
                    "999999999999999999999999999999".to_owned(),
                )
                .expect("maximum decimal must be canonical")
            })
            .collect();
        let prepared = UsageSyncV1Composer::compose(
            ReviewedUsageSyncContext::for_test(),
            &CanonicalDailyUsage::new(entries).expect("31 unique entries must be accepted"),
        )
        .expect("maximum contract usage must fit the body budget");
        assert!(prepared.body.len() <= MAX_USAGE_SYNC_BODY_BYTES);
    }

    #[test]
    fn enforces_canonical_timestamp_and_identifier_boundaries() {
        for invalid in [
            "2026-07-15T24:00:00.000Z",
            "2026-07-15T23:60:00.000Z",
            "2026-07-15T23:59:60.000Z",
            "2026-07-15T23:59:59Z",
            "2026-07-15T23:59:59.000+00:00",
            "2100-01-01T00:00:00.000Z",
        ] {
            let mut context = ReviewedUsageSyncContext::for_test();
            context.observed_at = invalid.to_owned();
            assert_eq!(
                UsageSyncV1Composer::compose(context, &standard_usage()).err(),
                Some(UsageSyncPreparationError::InvalidObservedAt)
            );
        }
        let mut leap_day = ReviewedUsageSyncContext::for_test();
        leap_day.observed_at = "2024-02-29T00:00:00.000Z".to_owned();
        UsageSyncV1Composer::compose(leap_day, &standard_usage())
            .expect("canonical leap day must be admitted");

        assert!(valid_identifier(AGENT_ACCOUNT_ID, AGENT_ACCOUNT_ID_PREFIX));
        assert!(!valid_identifier(AGENT_ACCOUNT_ID, DEVICE_ID_PREFIX));
        assert!(valid_reader_version(READER_VERSION));
        assert!(!valid_reader_version("Codex_v1"));
    }

    #[test]
    fn base64url_and_policy_constants_match_final_v1() {
        assert_eq!(encode_base64url(&[]), "");
        assert_eq!(encode_base64url(&[0]), "AA");
        assert_eq!(encode_base64url(&[0, 1]), "AAE");
        assert_eq!(encode_base64url(&[0, 1, 2]), "AAEC");
        assert_eq!(encode_base64url(&sequential_nonce()), EXPECTED_NONCE);

        let policy: Value = serde_json::from_str(include_str!(
            "../../../contracts/v1/connector-usage-sync-authentication.json"
        ))
        .expect("authentication policy must remain valid JSON");
        assert_eq!(policy["method"], USAGE_SYNC_METHOD);
        assert_eq!(policy["requestTarget"], USAGE_SYNC_REQUEST_TARGET);
        assert_eq!(policy["mediaType"], USAGE_SYNC_MEDIA_TYPE);
        assert_eq!(policy["maximumBodyBytes"], MAX_USAGE_SYNC_BODY_BYTES);
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
    }
}
