//! One-use proof of a pending device key over an approved pairing challenge.

use std::fmt;

use ed25519_dalek::{Signer, SigningKey};

use crate::sync::encode_base64url;

/// Version 1 domain-separation prefix for pairing key-possession signatures.
pub const PAIRING_POSSESSION_MESSAGE_PREFIX: &str = "viberacing-pairing-possession-v1";

/// Exact byte length of a version 1 server pairing challenge.
pub const PAIRING_CHALLENGE_BYTES: usize = 32;

/// One-use capability containing a pending device key loaded from future reviewed key storage.
///
/// This type deliberately has no public constructor, accessor, `Clone`, `Debug`, or serialization.
/// A future platform key-store boundary must load the exact key whose public half was fixed when the
/// pairing transaction started. Consuming this capability proves possession; it does not approve or
/// activate the transaction and does not establish a source or public device binding.
pub struct PendingDevicePairingSigningKey {
    signing_key: SigningKey,
}

impl PendingDevicePairingSigningKey {
    pub(crate) fn from_secret_key(mut secret_key: [u8; ed25519_dalek::SECRET_KEY_LENGTH]) -> Self {
        let signing_key = SigningKey::from_bytes(&secret_key);
        secret_key.fill(0);
        Self { signing_key }
    }

    pub(crate) fn verifying_key_bytes(&self) -> [u8; ed25519_dalek::PUBLIC_KEY_LENGTH] {
        self.signing_key.verifying_key().to_bytes()
    }
}

/// One-use server-provided pairing identifier and challenge accepted by a future response boundary.
///
/// This type has no public constructor, accessor, `Clone`, `Debug`, or serialization. A future
/// bounded pairing client must construct it only from the same successful poll response that owns
/// the presented poll token. The signer still validates the canonical version-4 identifier.
pub struct ReviewedPairingChallenge {
    pairing_id: String,
    challenge: [u8; PAIRING_CHALLENGE_BYTES],
}

impl Drop for ReviewedPairingChallenge {
    fn drop(&mut self) {
        self.challenge.fill(0);
    }
}

impl ReviewedPairingChallenge {
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

/// Exact pairing identifier and canonical Ed25519 possession signature for a future transport.
///
/// The poll token is intentionally absent: a future activation client must present its separately
/// held one-time token, while the server looks up the immutable challenge and public key before
/// verifying this proof. This type does not expose the signed message or key material.
pub struct PairingPossessionProof {
    pairing_id: String,
    signature: String,
}

impl PairingPossessionProof {
    /// Returns the canonical lower-case version-4 pairing identifier.
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

/// Stable, non-reflective failures from pairing possession signing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PairingPossessionSigningError {
    /// The future pairing response supplied a non-canonical identifier.
    InvalidPairingId,
}

impl fmt::Display for PairingPossessionSigningError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("pairing possession context is invalid")
    }
}

impl std::error::Error for PairingPossessionSigningError {}

/// Candidate-only signer for the exact version 1 pairing key-possession message.
pub struct CandidatePairingPossessionV1Signer;

impl CandidatePairingPossessionV1Signer {
    /// Consumes one pending key capability and one reviewed server challenge.
    ///
    /// The signed LF-separated message binds the domain prefix, canonical transaction identifier,
    /// exact 32-byte challenge, and public key derived from the consumed private key. Temporary raw
    /// challenge and message buffers are overwritten before return where safe Rust permits.
    ///
    /// # Errors
    ///
    /// Returns [`PairingPossessionSigningError::InvalidPairingId`] for any identifier outside the
    /// canonical lower-case version-4 shape. The invalid value is never reflected.
    pub fn sign(
        key_capability: PendingDevicePairingSigningKey,
        mut context: ReviewedPairingChallenge,
    ) -> Result<PairingPossessionProof, PairingPossessionSigningError> {
        if !valid_pairing_id(&context.pairing_id) {
            return Err(PairingPossessionSigningError::InvalidPairingId);
        }

        let PendingDevicePairingSigningKey { signing_key } = key_capability;
        let mut challenge = encode_base64url(&context.challenge).into_bytes();
        let mut public_key = encode_base64url(&signing_key.verifying_key().to_bytes()).into_bytes();
        let mut message = Vec::with_capacity(
            PAIRING_POSSESSION_MESSAGE_PREFIX.len()
                + context.pairing_id.len()
                + challenge.len()
                + public_key.len()
                + 3,
        );
        message.extend_from_slice(PAIRING_POSSESSION_MESSAGE_PREFIX.as_bytes());
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

        Ok(PairingPossessionProof {
            pairing_id: std::mem::take(&mut context.pairing_id),
            signature: encode_base64url(&signature.to_bytes()),
        })
    }
}

pub(crate) fn valid_pairing_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        && bytes.iter().copied().enumerate().all(|(index, byte)| {
            matches!(index, 8 | 13 | 18 | 23)
                || byte.is_ascii_digit()
                || matches!(byte, b'a'..=b'f')
        })
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use sha2::{Digest, Sha256};

    use super::*;

    const PAIRING_ID: &str = "00000000-0000-4000-8000-000000001001";
    const TEST_SIGNING_KEY_LABEL: &[u8] = b"viberacing-test-only-device-signing-key-v1";

    fn sequential_challenge() -> [u8; PAIRING_CHALLENGE_BYTES] {
        std::array::from_fn(|index| u8::try_from(index).expect("challenge index fits in one byte"))
    }

    fn test_signing_key() -> PendingDevicePairingSigningKey {
        let digest = Sha256::digest(TEST_SIGNING_KEY_LABEL);
        let mut secret_key = [0_u8; ed25519_dalek::SECRET_KEY_LENGTH];
        secret_key.copy_from_slice(&digest);
        PendingDevicePairingSigningKey::from_secret_key(secret_key)
    }

    fn shared_test_vector() -> Value {
        serde_json::from_str(include_str!(
            "../../../contracts/v1/connector-pairing-possession.test-vector.json"
        ))
        .expect("shared pairing possession vector must remain valid JSON")
    }

    #[test]
    fn signs_the_exact_shared_pairing_possession_vector() {
        let key = test_signing_key();
        let public_key = encode_base64url(&key.verifying_key_bytes());
        let proof = CandidatePairingPossessionV1Signer::sign(
            key,
            ReviewedPairingChallenge::from_reviewed_response(PAIRING_ID, sequential_challenge()),
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
            vector["pairingChallengeBase64Url"],
            encode_base64url(&sequential_challenge())
        );
        assert_eq!(vector["devicePublicKeyBase64Url"], public_key);
        assert_eq!(proof.pairing_id(), PAIRING_ID);
        assert_eq!(vector["possessionSignatureBase64Url"], proof.signature());

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
        .expect("shared Community sync vector must remain valid JSON");

        assert_eq!(
            pairing["devicePublicKeyBase64Url"],
            sync["devicePublicKeyBase64Url"]
        );
    }

    #[test]
    fn rejects_noncanonical_pairing_identifiers_without_reflection() {
        for invalid in [
            "00000000-0000-3000-8000-000000001001",
            "00000000-0000-4000-7000-000000001001",
            "00000000-0000-4000-8000-00000000100A",
            "000000000000-4000-8000-000000001001",
            "00000000-0000-4000-8000-0000000010010",
            "00000000-0000-4000-8000-00000000100é",
        ] {
            let error = CandidatePairingPossessionV1Signer::sign(
                test_signing_key(),
                ReviewedPairingChallenge::from_reviewed_response(invalid, sequential_challenge()),
            )
            .err()
            .expect("invalid pairing identifier must fail closed");
            assert_eq!(error, PairingPossessionSigningError::InvalidPairingId);
            assert!(!error.to_string().contains(invalid));
            assert!(!format!("{error:?}").contains(invalid));
        }
    }

    #[test]
    fn binds_the_exact_challenge_and_public_key() {
        let first = CandidatePairingPossessionV1Signer::sign(
            test_signing_key(),
            ReviewedPairingChallenge::from_reviewed_response(PAIRING_ID, sequential_challenge()),
        )
        .expect("first challenge must sign");
        let mut changed_challenge = sequential_challenge();
        changed_challenge[31] ^= 1;
        let second = CandidatePairingPossessionV1Signer::sign(
            test_signing_key(),
            ReviewedPairingChallenge::from_reviewed_response(PAIRING_ID, changed_challenge),
        )
        .expect("changed challenge must sign independently");
        let other_secret = Sha256::digest(b"viberacing-test-only-other-pairing-key-v1");
        let mut other_key_bytes = [0_u8; ed25519_dalek::SECRET_KEY_LENGTH];
        other_key_bytes.copy_from_slice(&other_secret);
        let third = CandidatePairingPossessionV1Signer::sign(
            PendingDevicePairingSigningKey::from_secret_key(other_key_bytes),
            ReviewedPairingChallenge::from_reviewed_response(PAIRING_ID, sequential_challenge()),
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

        assert_eq!(policy["messagePrefix"], PAIRING_POSSESSION_MESSAGE_PREFIX);
        assert_eq!(policy["challengeBytes"], PAIRING_CHALLENGE_BYTES);
        assert_eq!(policy["publicKeyBytes"], ed25519_dalek::PUBLIC_KEY_LENGTH);
        assert_eq!(policy["signatureBytes"], ed25519_dalek::SIGNATURE_LENGTH);
        assert_eq!(policy["algorithm"], "Ed25519");
        assert_eq!(policy["binaryEncoding"], "base64url-unpadded");
        assert_eq!(policy["canonicalMessageEncoding"], "UTF-8");
        assert_eq!(policy["canonicalMessageSeparator"], "LF");
        assert_eq!(policy["canonicalMessageTrailingSeparator"], false);
        assert_eq!(
            policy["canonicalFields"],
            serde_json::json!([
                "messagePrefix",
                "pairingId",
                "pairingChallengeBase64Url",
                "devicePublicKeyBase64Url"
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
