//! One-use device signing for an already prepared Community sync request.

use std::fmt;

use ed25519_dalek::{Signer, SigningKey};

use super::{PreparedCommunitySync, encode_base64url};

/// Device-signature algorithm fixed by the version 1 authentication policy.
pub const DEVICE_SIGNATURE_ALGORITHM: &str = "Ed25519";

/// Exact byte length of a version 1 Ed25519 public key.
pub const DEVICE_PUBLIC_KEY_BYTES: usize = ed25519_dalek::PUBLIC_KEY_LENGTH;

/// Exact byte length of a version 1 Ed25519 signature.
pub const DEVICE_SIGNATURE_BYTES: usize = ed25519_dalek::SIGNATURE_LENGTH;

/// One-use capability containing a reviewed device signing key from a source-bound pairing.
///
/// This type deliberately has no public constructor, accessor, `Clone`, `Debug`, or serialization.
/// The private one-shot sync command loads an active paired key and its exact device identifier from
/// the native credential record, then constructs this capability without exposing private key
/// bytes. The capability is consumed by [`CandidateCommunitySyncV1Signer`], and the upstream
/// signing key is zeroized when it is dropped.
pub struct ReviewedDeviceSigningKey {
    device_id: String,
    signing_key: SigningKey,
}

impl ReviewedDeviceSigningKey {
    pub(crate) fn from_active_device(
        device_id: String,
        mut secret_key: [u8; ed25519_dalek::SECRET_KEY_LENGTH],
    ) -> Self {
        let signing_key = SigningKey::from_bytes(&secret_key);
        secret_key.fill(0);
        Self {
            device_id,
            signing_key,
        }
    }
}

#[cfg(test)]
impl ReviewedDeviceSigningKey {
    pub(super) fn for_test(
        device_id: &str,
        secret_key: [u8; ed25519_dalek::SECRET_KEY_LENGTH],
    ) -> Self {
        Self::from_active_device(device_id.to_owned(), secret_key)
    }

    pub(super) fn verifying_key_bytes(&self) -> [u8; DEVICE_PUBLIC_KEY_BYTES] {
        self.signing_key.verifying_key().to_bytes()
    }
}

/// Exact signed Community sync body and device-authentication header values.
///
/// The body contains private usage material. This type does not implement `Debug`, `Display`,
/// `Clone`, or serialization. Its read-only accessors exist solely for the bounded one-shot HTTP
/// transport.
pub struct SignedCommunitySync {
    body: Vec<u8>,
    device_id: String,
    device_nonce: String,
    device_signature: String,
    device_timestamp: String,
    idempotency_key: String,
}

impl SignedCommunitySync {
    /// Returns the exact signed JSON request body.
    #[must_use]
    pub fn body(&self) -> &[u8] {
        &self.body
    }

    /// Returns the validated public device identifier header value.
    #[must_use]
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    /// Returns the canonical unpadded base64url device nonce header value.
    #[must_use]
    pub fn device_nonce(&self) -> &str {
        &self.device_nonce
    }

    /// Returns the canonical unpadded base64url Ed25519 signature header value.
    #[must_use]
    pub fn device_signature(&self) -> &str {
        &self.device_signature
    }

    /// Returns the canonical device timestamp header value.
    #[must_use]
    pub fn device_timestamp(&self) -> &str {
        &self.device_timestamp
    }

    /// Returns the idempotency-key header value.
    #[must_use]
    pub fn idempotency_key(&self) -> &str {
        &self.idempotency_key
    }
}

impl Drop for SignedCommunitySync {
    fn drop(&mut self) {
        self.body.fill(0);
    }
}

/// Stable, non-reflective failures from device signing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SyncSigningError {
    /// The loaded key capability was not bound to the prepared request's device identifier.
    DeviceBindingMismatch,
}

impl fmt::Display for SyncSigningError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("community sync signing key is not bound to the request device")
    }
}

impl std::error::Error for SyncSigningError {}

/// Candidate-only signer for an exact prepared version 1 Community sync request.
pub struct CandidateCommunitySyncV1Signer;

impl CandidateCommunitySyncV1Signer {
    /// Consumes one device-bound key capability and one exact prepared request.
    ///
    /// Only the prepared LF-separated device message is signed. The returned body is the same
    /// allocation whose digest was included in that message, and every returned header value is
    /// moved from the same prepared request. The signing key is consumed and zeroized on drop.
    ///
    /// # Errors
    ///
    /// Returns [`SyncSigningError::DeviceBindingMismatch`] when the reviewed key capability is not
    /// bound to the exact prepared device identifier. Neither identifier is reflected.
    pub fn sign(
        key_capability: ReviewedDeviceSigningKey,
        mut prepared: PreparedCommunitySync,
    ) -> Result<SignedCommunitySync, SyncSigningError> {
        if key_capability.device_id != prepared.device_id {
            return Err(SyncSigningError::DeviceBindingMismatch);
        }

        let ReviewedDeviceSigningKey {
            device_id: _,
            signing_key,
        } = key_capability;
        let signature = signing_key.sign(&prepared.device_signature_message);

        Ok(SignedCommunitySync {
            body: std::mem::take(&mut prepared.body),
            device_id: std::mem::take(&mut prepared.device_id),
            device_nonce: std::mem::take(&mut prepared.device_nonce),
            device_signature: encode_base64url(&signature.to_bytes()),
            device_timestamp: std::mem::take(&mut prepared.observed_at),
            idempotency_key: std::mem::take(&mut prepared.sync_id),
        })
    }
}
