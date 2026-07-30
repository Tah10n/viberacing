//! One-use installation-key proof over an approved batch-pairing challenge.

use std::fmt;

use ed25519_dalek::{Signer, SigningKey};

use crate::sync::encode_base64url;

mod start;

pub(crate) use start::{
    DiscoveryCandidateV1, DiscoveryManifestV1, PairingStartV1Signer, PreparedPairingStart,
};
pub use start::{
    MAX_DISCOVERY_CANDIDATES, PAIRING_START_POSSESSION_MESSAGE_PREFIX, PairingStartSigningError,
};

/// Version 1 domain-separation prefix for pairing-poll key possession.
pub const PAIRING_POLL_POSSESSION_MESSAGE_PREFIX: &str = "viberacing-pairing-poll-possession-v1";

/// Exact byte length of a version 1 server pairing challenge.
pub const PAIRING_CHALLENGE_BYTES: usize = 32;

/// One-use capability containing a pending installation signing key.
///
/// This type has no public constructor, secret accessor, `Clone`, `Debug`, or serialization.
pub struct PendingInstallationSigningKey {
    signing_key: SigningKey,
}

impl PendingInstallationSigningKey {
    pub(crate) fn from_secret_key(mut secret_key: [u8; ed25519_dalek::SECRET_KEY_LENGTH]) -> Self {
        let signing_key = SigningKey::from_bytes(&secret_key);
        secret_key.fill(0);
        Self { signing_key }
    }

    pub(crate) fn verifying_key_bytes(&self) -> [u8; ed25519_dalek::PUBLIC_KEY_LENGTH] {
        self.signing_key.verifying_key().to_bytes()
    }
}

/// One-use server-provided batch-pairing identifier and challenge.
///
/// This type has no public constructor, accessor, `Clone`, `Debug`, or serialization.
pub struct ReviewedPairingPollChallenge {
    pairing_id: String,
    challenge: [u8; PAIRING_CHALLENGE_BYTES],
}

impl ReviewedPairingPollChallenge {
    pub(crate) fn from_reviewed_response(
        pairing_id: &str,
        challenge: [u8; PAIRING_CHALLENGE_BYTES],
    ) -> Self {
        Self {
            pairing_id: pairing_id.to_owned(),
            challenge,
        }
    }
}

impl Drop for ReviewedPairingPollChallenge {
    fn drop(&mut self) {
        self.challenge.fill(0);
    }
}

/// Exact pairing identifier and Ed25519 possession signature for one poll request.
pub struct PairingPollPossessionProof {
    pairing_id: String,
    signature: String,
}

impl PairingPollPossessionProof {
    /// Returns the canonical opaque pairing identifier.
    #[must_use]
    pub fn pairing_id(&self) -> &str {
        &self.pairing_id
    }

    /// Returns the canonical unpadded base64url Ed25519 signature.
    #[must_use]
    pub fn signature(&self) -> &str {
        &self.signature
    }
}

/// Stable, non-reflective failures from pairing-poll possession signing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PairingPollSigningError {
    /// The response supplied a noncanonical pairing identifier.
    InvalidPairingId,
}

impl fmt::Display for PairingPollSigningError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("pairing poll possession context is invalid")
    }
}

impl std::error::Error for PairingPollSigningError {}

/// Signer for the exact version 1 pairing-poll key-possession message.
pub struct PairingPollV1Signer;

impl PairingPollV1Signer {
    /// Consumes one pending installation key and one reviewed server challenge.
    ///
    /// The signed LF-separated message binds the poll domain, exact opaque pairing identifier,
    /// exact 32-byte challenge, and installation public key derived from the consumed private key.
    ///
    /// # Errors
    ///
    /// Returns [`PairingPollSigningError::InvalidPairingId`] for any identifier outside the exact
    /// `pair_<22 base64url>` grammar. The invalid value is never reflected.
    pub fn sign(
        key_capability: PendingInstallationSigningKey,
        mut context: ReviewedPairingPollChallenge,
    ) -> Result<PairingPollPossessionProof, PairingPollSigningError> {
        if !valid_pairing_id(&context.pairing_id) {
            return Err(PairingPollSigningError::InvalidPairingId);
        }

        let PendingInstallationSigningKey { signing_key } = key_capability;
        let mut challenge = encode_base64url(&context.challenge).into_bytes();
        let mut public_key = encode_base64url(&signing_key.verifying_key().to_bytes()).into_bytes();
        let mut message = Vec::with_capacity(
            PAIRING_POLL_POSSESSION_MESSAGE_PREFIX.len()
                + context.pairing_id.len()
                + challenge.len()
                + public_key.len()
                + 3,
        );
        message.extend_from_slice(PAIRING_POLL_POSSESSION_MESSAGE_PREFIX.as_bytes());
        message.push(b'\n');
        message.extend_from_slice(context.pairing_id.as_bytes());
        message.push(b'\n');
        message.extend_from_slice(&challenge);
        message.push(b'\n');
        message.extend_from_slice(&public_key);

        let signature = signing_key.sign(&message);
        message.fill(0);
        challenge.fill(0);
        public_key.fill(0);
        context.challenge.fill(0);

        Ok(PairingPollPossessionProof {
            pairing_id: std::mem::take(&mut context.pairing_id),
            signature: encode_base64url(&signature.to_bytes()),
        })
    }
}

pub(crate) fn valid_pairing_id(value: &str) -> bool {
    value.len() == 27
        && value.starts_with("pair_")
        && value[5..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use sha2::{Digest, Sha256};

    use super::*;

    const PAIRING_ID: &str = "pair_AAAAAAAAAAAAAAAAAAAAAA";
    const TEST_SIGNING_KEY_LABEL: &[u8] = b"viberacing-test-only-device-signing-key-v1";

    fn sequential_challenge() -> [u8; PAIRING_CHALLENGE_BYTES] {
        std::array::from_fn(|index| u8::try_from(index).expect("challenge index fits in one byte"))
    }

    fn test_signing_key() -> PendingInstallationSigningKey {
        let digest = Sha256::digest(TEST_SIGNING_KEY_LABEL);
        let mut secret_key = [0_u8; ed25519_dalek::SECRET_KEY_LENGTH];
        secret_key.copy_from_slice(&digest);
        PendingInstallationSigningKey::from_secret_key(secret_key)
    }

    fn shared_test_vector() -> Value {
        serde_json::from_str(include_str!(
            "../../../contracts/v1/connector-pairing-possession.test-vector.json"
        ))
        .expect("shared pairing possession vector must remain valid JSON")
    }

    #[test]
    fn signs_the_exact_shared_pairing_poll_vector() {
        let key = test_signing_key();
        let public_key = encode_base64url(&key.verifying_key_bytes());
        let proof = PairingPollV1Signer::sign(
            key,
            ReviewedPairingPollChallenge::from_reviewed_response(
                PAIRING_ID,
                sequential_challenge(),
            ),
        )
        .expect("canonical synthetic pairing challenge must sign");
        let vector = shared_test_vector();

        assert_eq!(vector["schemaVersion"], 1);
        assert_eq!(
            vector["protocolId"],
            "viberacing-device-pairing-possession-v1"
        );
        assert_eq!(vector["pairingId"], PAIRING_ID);
        assert_eq!(
            vector["pairingChallengeBytes"],
            serde_json::json!(sequential_challenge())
        );
        assert_eq!(
            vector["pairingChallenge"],
            encode_base64url(&sequential_challenge())
        );
        assert_eq!(vector["installationPublicKey"], public_key);
        assert_eq!(proof.pairing_id(), PAIRING_ID);
        assert_eq!(vector["possessionSignature"], proof.signature());

        let expected_message = vector["possessionMessage"]
            .as_str()
            .expect("shared pairing message must be text");
        let signature_bytes = decode_test_base64url(proof.signature());
        let signature = ed25519_dalek::Signature::from_slice(&signature_bytes)
            .expect("production signature must have the exact length");
        test_signing_key()
            .signing_key
            .verifying_key()
            .verify_strict(expected_message.as_bytes(), &signature)
            .expect("shared pairing proof must verify under strict semantics");
        assert!(!expected_message.ends_with('\n'));
    }

    #[test]
    fn shares_the_same_synthetic_public_key_as_the_sync_vector() {
        let pairing = shared_test_vector();
        let sync: Value = serde_json::from_str(include_str!(
            "../../../contracts/v1/connector-usage-sync-device-request.test-vector.json"
        ))
        .expect("shared Usage Sync vector must remain valid JSON");
        assert_eq!(
            pairing["installationPublicKey"],
            sync["devicePublicKeyBase64Url"]
        );
    }

    #[test]
    fn rejects_noncanonical_pairing_identifiers_without_reflection() {
        for invalid in [
            "pair_AAAAAAAAAAAAAAAAAAAAA",
            "pair_AAAAAAAAAAAAAAAAAAAAAAA",
            "PAIR_AAAAAAAAAAAAAAAAAAAAAA",
            "pair_AAAAAAAAAAAAAAAAAAAAA!",
            "pair_AAAAAAAAAAAAAAAAAAAAé",
            "00000000-0000-4000-8000-000000001001",
        ] {
            let error = PairingPollV1Signer::sign(
                test_signing_key(),
                ReviewedPairingPollChallenge::from_reviewed_response(
                    invalid,
                    sequential_challenge(),
                ),
            )
            .err()
            .expect("invalid pairing identifier must fail closed");
            assert_eq!(error, PairingPollSigningError::InvalidPairingId);
            assert!(!error.to_string().contains(invalid));
            assert!(!format!("{error:?}").contains(invalid));
        }
    }

    #[test]
    fn binds_the_exact_challenge_and_installation_public_key() {
        let first = PairingPollV1Signer::sign(
            test_signing_key(),
            ReviewedPairingPollChallenge::from_reviewed_response(
                PAIRING_ID,
                sequential_challenge(),
            ),
        )
        .expect("first challenge must sign");
        let mut changed_challenge = sequential_challenge();
        changed_challenge[31] ^= 1;
        let second = PairingPollV1Signer::sign(
            test_signing_key(),
            ReviewedPairingPollChallenge::from_reviewed_response(PAIRING_ID, changed_challenge),
        )
        .expect("changed challenge must sign independently");
        let other_secret = Sha256::digest(b"viberacing-test-only-other-pairing-key-v1");
        let mut other_key_bytes = [0_u8; ed25519_dalek::SECRET_KEY_LENGTH];
        other_key_bytes.copy_from_slice(&other_secret);
        let third = PairingPollV1Signer::sign(
            PendingInstallationSigningKey::from_secret_key(other_key_bytes),
            ReviewedPairingPollChallenge::from_reviewed_response(
                PAIRING_ID,
                sequential_challenge(),
            ),
        )
        .expect("other key must sign independently");

        assert_ne!(first.signature(), second.signature());
        assert_ne!(first.signature(), third.signature());
    }

    #[test]
    fn constants_match_the_versioned_pairing_policy() {
        let policy: Value = serde_json::from_str(include_str!(
            "../../../contracts/v1/connector-pairing-authentication.json"
        ))
        .expect("pairing authentication policy must remain valid JSON");

        assert_eq!(
            policy["pollProof"]["messagePrefix"],
            PAIRING_POLL_POSSESSION_MESSAGE_PREFIX
        );
        assert_eq!(policy["pairingIdPattern"], "^pair_[A-Za-z0-9_-]{22}$");
        assert_eq!(policy["challengeBytes"], PAIRING_CHALLENGE_BYTES);
        assert_eq!(policy["publicKeyBytes"], ed25519_dalek::PUBLIC_KEY_LENGTH);
        assert_eq!(policy["signatureBytes"], ed25519_dalek::SIGNATURE_LENGTH);
        assert_eq!(policy["algorithm"], "Ed25519");
        assert_eq!(policy["binaryEncoding"], "base64url-unpadded");
        assert_eq!(policy["canonicalMessageSeparator"], "LF");
        assert_eq!(policy["canonicalMessageTrailingSeparator"], false);
        assert_eq!(
            policy["pollProof"]["canonicalFields"],
            serde_json::json!([
                "messagePrefix",
                "pairingId",
                "pairingChallenge",
                "installationPublicKey"
            ])
        );
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
}
