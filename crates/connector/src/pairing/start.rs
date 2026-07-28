//! Canonical discovery manifest and installation-key proof for one batch-pairing start.

use std::fmt;

use ed25519_dalek::Signer;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::reader::{
    AccountingScope, AgentProvider, CanonicalDailyUsageEntry, FingerprintKind, ReaderStatus,
};
use crate::sync::encode_base64url;

use super::PendingInstallationSigningKey;

/// Version 1 domain-separation prefix for pairing-start key possession.
pub const PAIRING_START_POSSESSION_MESSAGE_PREFIX: &str = "viberacing-pairing-start-possession-v1";

/// Maximum number of account candidates in one discovery manifest.
pub const MAX_DISCOVERY_CANDIDATES: usize = 16;

const MAX_DISCOVERY_MANIFEST_BYTES: usize = 16 * 1024;
const IDENTIFIER_RANDOM_BYTES: usize = 16;

/// Privacy-minimized preview for one discovered account.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveryPreviewV1 {
    current_week_token_total: String,
    last_usage_date: Option<String>,
    status: &'static str,
}

/// One account candidate in the canonical discovery manifest.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveryCandidateV1 {
    candidate_id: String,
    provider: &'static str,
    reader_version: &'static str,
    accounting_revision: u32,
    scope_kind: &'static str,
    fingerprint_kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    account_fingerprint_digest: Option<String>,
    safe_display_label: String,
    sync_public_key: String,
    preview: DiscoveryPreviewV1,
}

impl DiscoveryCandidateV1 {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        candidate_id: String,
        provider: AgentProvider,
        reader_version: &'static str,
        accounting_revision: u32,
        scope_kind: AccountingScope,
        fingerprint_kind: FingerprintKind,
        account_fingerprint_digest: Option<String>,
        safe_display_label: String,
        sync_public_key: String,
        current_week_token_total: String,
        last_usage_date: Option<String>,
        status: ReaderStatus,
    ) -> Result<Self, PairingStartSigningError> {
        let fingerprint_matches = matches!(
            (fingerprint_kind, account_fingerprint_digest.as_deref()),
            (FingerprintKind::Unavailable, None)
        ) || matches!(
            (fingerprint_kind, account_fingerprint_digest.as_deref()),
            (FingerprintKind::StableOpaque, Some(value)) if valid_lower_hex(value, 64)
        );
        if !valid_prefixed_identifier(&candidate_id, "cand_", 27)
            || !valid_reader_version(reader_version)
            || accounting_revision == 0
            || accounting_revision > 999_999
            || scope_kind != AccountingScope::AgentAccount
            || !fingerprint_matches
            || safe_display_label.is_empty()
            || safe_display_label.len() > 64
            || safe_display_label.chars().any(char::is_control)
            || !valid_base64url(&sync_public_key, 43)
            || !valid_decimal(&current_week_token_total, 60)
            || last_usage_date.as_deref().is_some_and(|value| {
                CanonicalDailyUsageEntry::new(value.to_owned(), "0".to_owned()).is_err()
            })
        {
            return Err(PairingStartSigningError::InvalidManifest);
        }
        Ok(Self {
            candidate_id,
            provider: provider.as_str(),
            reader_version,
            accounting_revision,
            scope_kind: scope_kind.as_str(),
            fingerprint_kind: fingerprint_kind.as_str(),
            account_fingerprint_digest,
            safe_display_label,
            sync_public_key,
            preview: DiscoveryPreviewV1 {
                current_week_token_total,
                last_usage_date,
                status: status.as_str(),
            },
        })
    }

    pub(crate) fn candidate_id(&self) -> &str {
        &self.candidate_id
    }
}

/// Exact version 1 privacy-minimized discovery manifest.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveryManifestV1 {
    schema_version: u8,
    installation_public_key: String,
    connector_version: &'static str,
    os_family: &'static str,
    architecture: &'static str,
    candidates: Vec<DiscoveryCandidateV1>,
}

impl DiscoveryManifestV1 {
    pub(crate) fn new(
        installation_public_key: String,
        os_family: &'static str,
        architecture: &'static str,
        candidates: Vec<DiscoveryCandidateV1>,
    ) -> Result<Self, PairingStartSigningError> {
        let unique = candidates.iter().enumerate().all(|(index, candidate)| {
            candidates[..index].iter().all(|seen| {
                seen.candidate_id() != candidate.candidate_id()
                    && seen.sync_public_key != candidate.sync_public_key
            })
        });
        if !valid_base64url(&installation_public_key, 43)
            || !matches!(os_family, "linux" | "macos" | "windows")
            || !matches!(architecture, "aarch64" | "x86_64")
            || candidates.is_empty()
            || candidates.len() > MAX_DISCOVERY_CANDIDATES
            || !unique
        {
            return Err(PairingStartSigningError::InvalidManifest);
        }
        Ok(Self {
            schema_version: 1,
            installation_public_key,
            connector_version: env!("CARGO_PKG_VERSION"),
            os_family,
            architecture,
            candidates,
        })
    }
}

/// Exact version 1 installation-key proof embedded in one start request.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingStartPossessionProof {
    signed_at: String,
    nonce: String,
    signature: String,
}

/// Signed, canonical material for one pairing-start HTTP request.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedPairingStart {
    schema_version: u8,
    #[serde(rename = "discoveryManifest")]
    manifest: DiscoveryManifestV1,
    #[serde(rename = "installationPossessionProof")]
    proof: PairingStartPossessionProof,
    client_rate_identifier: String,
    #[serde(skip)]
    manifest_digest: [u8; 32],
}

impl PreparedPairingStart {
    #[cfg(test)]
    pub(crate) fn manifest(&self) -> &DiscoveryManifestV1 {
        &self.manifest
    }

    #[cfg(test)]
    pub(crate) const fn proof(&self) -> &PairingStartPossessionProof {
        &self.proof
    }

    #[cfg(test)]
    pub(crate) fn client_rate_identifier(&self) -> &str {
        &self.client_rate_identifier
    }

    pub(crate) const fn manifest_digest(&self) -> &[u8; 32] {
        &self.manifest_digest
    }
}

/// Stable, non-reflective pairing-start composition or signing failure.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PairingStartSigningError {
    /// The discovery manifest was outside the exact V1 contract.
    InvalidManifest,
    /// The signed time, rate identifier, or nonce was outside the exact V1 contract.
    InvalidContext,
    /// The installation key did not match the public key committed by the manifest.
    KeyMismatch,
}

impl fmt::Display for PairingStartSigningError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("pairing start possession context is invalid")
    }
}

impl std::error::Error for PairingStartSigningError {}

/// Signer for the exact version 1 pairing-start possession message.
pub struct PairingStartV1Signer;

impl PairingStartV1Signer {
    /// Consumes one installation key and signs one complete discovery manifest.
    ///
    /// # Errors
    ///
    /// Returns a stable [`PairingStartSigningError`] if the canonical manifest is over budget, the
    /// context is malformed, or the installation public key does not match the consumed key.
    pub(crate) fn sign(
        key_capability: PendingInstallationSigningKey,
        manifest: DiscoveryManifestV1,
        client_rate_identifier: String,
        signed_at: String,
        mut nonce: [u8; IDENTIFIER_RANDOM_BYTES],
    ) -> Result<PreparedPairingStart, PairingStartSigningError> {
        if !valid_base64url(&client_rate_identifier, 22)
            || !valid_utc_millisecond_timestamp(&signed_at)
            || nonce.iter().all(|byte| *byte == 0)
        {
            nonce.fill(0);
            return Err(PairingStartSigningError::InvalidContext);
        }
        let PendingInstallationSigningKey { signing_key } = key_capability;
        let mut expected_public_key =
            encode_base64url(&signing_key.verifying_key().to_bytes()).into_bytes();
        if manifest.installation_public_key.as_bytes() != expected_public_key {
            expected_public_key.fill(0);
            nonce.fill(0);
            return Err(PairingStartSigningError::KeyMismatch);
        }
        expected_public_key.fill(0);

        let mut canonical_manifest =
            serde_json::to_vec(&manifest).map_err(|_| PairingStartSigningError::InvalidManifest)?;
        if canonical_manifest.len() > MAX_DISCOVERY_MANIFEST_BYTES {
            canonical_manifest.fill(0);
            nonce.fill(0);
            return Err(PairingStartSigningError::InvalidManifest);
        }
        let mut manifest_digest: [u8; 32] = Sha256::digest(&canonical_manifest).into();
        canonical_manifest.fill(0);
        let mut manifest_digest_hex = encode_lower_hex(&manifest_digest).into_bytes();
        let mut nonce_encoded = encode_base64url(&nonce).into_bytes();
        nonce.fill(0);

        let mut message = Vec::with_capacity(
            PAIRING_START_POSSESSION_MESSAGE_PREFIX.len()
                + manifest_digest_hex.len()
                + client_rate_identifier.len()
                + signed_at.len()
                + nonce_encoded.len()
                + 4,
        );
        message.extend_from_slice(PAIRING_START_POSSESSION_MESSAGE_PREFIX.as_bytes());
        message.push(b'\n');
        message.extend_from_slice(&manifest_digest_hex);
        message.push(b'\n');
        message.extend_from_slice(client_rate_identifier.as_bytes());
        message.push(b'\n');
        message.extend_from_slice(signed_at.as_bytes());
        message.push(b'\n');
        message.extend_from_slice(&nonce_encoded);
        let signature = encode_base64url(&signing_key.sign(&message).to_bytes());
        message.fill(0);
        manifest_digest_hex.fill(0);
        let nonce = String::from_utf8(std::mem::take(&mut nonce_encoded))
            .map_err(|_| PairingStartSigningError::InvalidContext)?;

        let prepared = PreparedPairingStart {
            schema_version: 1,
            manifest,
            proof: PairingStartPossessionProof {
                signed_at,
                nonce,
                signature,
            },
            client_rate_identifier,
            manifest_digest,
        };
        manifest_digest.fill(0);
        Ok(prepared)
    }
}

fn valid_prefixed_identifier(value: &str, prefix: &str, length: usize) -> bool {
    value.len() == length
        && value.starts_with(prefix)
        && value[prefix.len()..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_reader_version(value: &str) -> bool {
    (3..=64).contains(&value.len())
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn valid_base64url(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn valid_decimal(value: &str, maximum_digits: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum_digits
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
}

fn encode_lower_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use fmt::Write as _;
        write!(output, "{byte:02x}").expect("writing to a String cannot fail");
    }
    output
}

fn valid_utc_millisecond_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 24
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
        && bytes[16] == b':'
        && bytes[19] == b'.'
        && bytes[23] == b'Z'
        && bytes.iter().copied().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7 | 10 | 13 | 16 | 19 | 23) || byte.is_ascii_digit()
        })
        && CanonicalDailyUsageEntry::new(value[..10].to_owned(), "0".to_owned()).is_ok()
        && decimal(bytes, 11, 2) < 24
        && decimal(bytes, 14, 2) < 60
        && decimal(bytes, 17, 2) < 60
}

fn decimal(bytes: &[u8], start: usize, length: usize) -> u32 {
    bytes[start..start + length]
        .iter()
        .fold(0, |value, byte| value * 10 + u32::from(*byte - b'0'))
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::reader::{AccountingScope, AgentProvider, FingerprintKind, ReaderStatus};

    const TEST_KEY_LABEL: &[u8] = b"viberacing-test-only-pairing-start-key-v1";

    fn test_key() -> PendingInstallationSigningKey {
        let digest = Sha256::digest(TEST_KEY_LABEL);
        let mut secret = [0_u8; 32];
        secret.copy_from_slice(&digest);
        PendingInstallationSigningKey::from_secret_key(secret)
    }

    fn candidate(id: &str) -> DiscoveryCandidateV1 {
        candidate_with_key(id, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned())
    }

    fn candidate_with_key(id: &str, sync_public_key: String) -> DiscoveryCandidateV1 {
        DiscoveryCandidateV1::new(
            id.to_owned(),
            AgentProvider::Codex,
            "codex_app_server_0_144_5_v1",
            1,
            AccountingScope::AgentAccount,
            FingerprintKind::Unavailable,
            None,
            "Codex account".to_owned(),
            sync_public_key,
            "579".to_owned(),
            Some("2026-07-14".to_owned()),
            ReaderStatus::Ready,
        )
        .unwrap()
    }

    fn manifest() -> DiscoveryManifestV1 {
        let public_key = encode_base64url(&test_key().verifying_key_bytes());
        DiscoveryManifestV1::new(
            public_key,
            "windows",
            "x86_64",
            vec![candidate("cand_AAAAAAAAAAAAAAAAAAAAAA")],
        )
        .unwrap()
    }

    fn decode_test_base64url(value: &str) -> Vec<u8> {
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut output = Vec::new();
        let mut accumulator = 0_u32;
        let mut bits = 0_u8;
        for byte in value.bytes() {
            let index = alphabet
                .iter()
                .position(|candidate| *candidate == byte)
                .expect("test vector must contain canonical base64url");
            accumulator = (accumulator << 6) | u32::try_from(index).expect("index fits in u32");
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                output.push(((accumulator >> bits) & 0xff) as u8);
            }
        }
        output
    }

    #[test]
    fn signs_exact_manifest_digest_and_context_without_raw_provider_data() {
        let signed_at = "2026-07-28T12:34:56.789Z".to_owned();
        let client_id = "AQEBAQEBAQEBAQEBAQEBAQ".to_owned();
        let nonce = [2_u8; 16];
        let prepared =
            PairingStartV1Signer::sign(test_key(), manifest(), client_id.clone(), signed_at, nonce)
                .unwrap();
        let manifest_json = serde_json::to_vec(prepared.manifest()).unwrap();
        let digest = Sha256::digest(&manifest_json);
        assert_eq!(prepared.manifest_digest().as_slice(), digest.as_slice());

        let request = serde_json::json!({
            "schemaVersion": 1,
            "discoveryManifest": prepared.manifest(),
            "installationPossessionProof": prepared.proof(),
            "clientRateIdentifier": prepared.client_rate_identifier(),
        });
        let rendered = serde_json::to_string(&request).unwrap();
        assert!(rendered.contains("\"candidateId\":\"cand_AAAAAAAAAAAAAAAAAAAAAA\""));
        for forbidden in [
            "email",
            "login",
            "repository",
            "prompt",
            "conversation",
            "accessToken",
            "apiKey",
        ] {
            assert!(!rendered.contains(forbidden));
        }

        let proof: Value = serde_json::to_value(prepared.proof()).unwrap();
        let digest_hex = encode_lower_hex(&digest);
        let message = [
            PAIRING_START_POSSESSION_MESSAGE_PREFIX,
            &digest_hex,
            &client_id,
            proof["signedAt"].as_str().unwrap(),
            proof["nonce"].as_str().unwrap(),
        ]
        .join("\n");
        let signature = decode_test_base64url(proof["signature"].as_str().unwrap());
        let signature = ed25519_dalek::Signature::from_slice(&signature).unwrap();
        test_key()
            .signing_key
            .verifying_key()
            .verify_strict(message.as_bytes(), &signature)
            .unwrap();
    }

    #[test]
    fn rejects_duplicate_candidates_key_mismatch_and_invalid_context() {
        let public_key = encode_base64url(&test_key().verifying_key_bytes());
        assert_eq!(
            DiscoveryManifestV1::new(
                public_key,
                "windows",
                "x86_64",
                vec![
                    candidate("cand_AAAAAAAAAAAAAAAAAAAAAA"),
                    candidate("cand_AAAAAAAAAAAAAAAAAAAAAA"),
                ],
            )
            .err(),
            Some(PairingStartSigningError::InvalidManifest)
        );
        assert_eq!(
            DiscoveryManifestV1::new(
                encode_base64url(&test_key().verifying_key_bytes()),
                "windows",
                "x86_64",
                vec![
                    candidate("cand_AAAAAAAAAAAAAAAAAAAAAA"),
                    candidate("cand_BBBBBBBBBBBBBBBBBBBBBB"),
                ],
            )
            .err(),
            Some(PairingStartSigningError::InvalidManifest)
        );
        let other_public_key = encode_base64url(&[9_u8; 32]);
        let other_manifest = DiscoveryManifestV1::new(
            other_public_key,
            "windows",
            "x86_64",
            vec![candidate("cand_AAAAAAAAAAAAAAAAAAAAAA")],
        )
        .unwrap();
        assert_eq!(
            PairingStartV1Signer::sign(
                test_key(),
                other_manifest,
                "AQEBAQEBAQEBAQEBAQEBAQ".to_owned(),
                "2026-07-28T12:34:56.789Z".to_owned(),
                [2; 16],
            )
            .err(),
            Some(PairingStartSigningError::KeyMismatch)
        );
        assert_eq!(
            PairingStartV1Signer::sign(
                test_key(),
                manifest(),
                "invalid".to_owned(),
                "2026-07-28T12:34:56.789Z".to_owned(),
                [2; 16],
            )
            .err(),
            Some(PairingStartSigningError::InvalidContext)
        );
    }

    #[test]
    fn maximum_batch_fits_the_final_transport_budget() {
        let candidates = (0_u8..16)
            .map(|index| {
                candidate_with_key(
                    &format!("cand_{index:022}"),
                    encode_base64url(&[index + 1; 32]),
                )
            })
            .collect();
        let manifest = DiscoveryManifestV1::new(
            encode_base64url(&test_key().verifying_key_bytes()),
            "windows",
            "x86_64",
            candidates,
        )
        .unwrap();
        let prepared = PairingStartV1Signer::sign(
            test_key(),
            manifest,
            "AQEBAQEBAQEBAQEBAQEBAQ".to_owned(),
            "2026-07-28T12:34:56.789Z".to_owned(),
            [2; 16],
        )
        .unwrap();
        let body = serde_json::to_vec(&prepared).unwrap();
        assert!(body.len() > 1024);
        assert!(body.len() <= 32 * 1024);
    }
}
