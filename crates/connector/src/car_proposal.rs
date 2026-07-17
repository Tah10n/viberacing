//! Exact-body composition and one-use signing for a bounded `CarRecipe` proposal.

use std::{fmt, str};

use ed25519_dalek::{Signer, SigningKey};
use serde::ser::{Serialize, SerializeStruct, Serializer};
use sha2::{Digest, Sha256};

use crate::sync::encode_base64url;

pub(crate) const CAR_PROPOSAL_METHOD: &str = "POST";
pub(crate) const CAR_PROPOSAL_REQUEST_TARGET: &str = "/v1/connector/cars/proposals";
pub(crate) const CAR_PROPOSAL_MEDIA_TYPE: &str = "application/json";
pub(crate) const CAR_PROPOSAL_MESSAGE_PREFIX: &str = "viberacing-car-proposal-request-v1";
pub(crate) const MAX_CAR_PROPOSAL_BODY_BYTES: usize = 512;
pub(crate) const CAR_PROPOSAL_NONCE_BYTES: usize = 16;

const SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Copy)]
pub(crate) struct CarRecipeSelection {
    chassis: &'static str,
    nose: &'static str,
    cockpit: &'static str,
    wing: &'static str,
    wheels: &'static str,
    palette: &'static str,
    trail: &'static str,
    seed: u16,
}

impl CarRecipeSelection {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn from_exact_values(
        chassis: &str,
        nose: &str,
        cockpit: &str,
        wing: &str,
        wheels: &str,
        palette: &str,
        trail: &str,
        seed: u16,
    ) -> Option<Self> {
        Some(Self {
            chassis: exact_chassis(chassis)?,
            nose: exact_nose(nose)?,
            cockpit: exact_cockpit(cockpit)?,
            wing: exact_wing(wing)?,
            wheels: exact_wheels(wheels)?,
            palette: exact_palette(palette)?,
            trail: exact_trail(trail)?,
            seed,
        })
    }
}

pub(crate) struct ReviewedCarProposalContext {
    id: String,
    nonce: [u8; CAR_PROPOSAL_NONCE_BYTES],
    timestamp: String,
}

impl ReviewedCarProposalContext {
    pub(crate) fn from_active_device(
        device_id: String,
        device_nonce: [u8; CAR_PROPOSAL_NONCE_BYTES],
        device_timestamp: String,
    ) -> Self {
        Self {
            id: device_id,
            nonce: device_nonce,
            timestamp: device_timestamp,
        }
    }
}

impl Drop for ReviewedCarProposalContext {
    fn drop(&mut self) {
        self.nonce.fill(0);
    }
}

pub(crate) struct ReviewedCarProposalSigningKey {
    device_id: String,
    signing_key: SigningKey,
}

impl ReviewedCarProposalSigningKey {
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

pub(crate) struct PreparedCarProposal {
    body: Vec<u8>,
    device_id: String,
    device_nonce: Vec<u8>,
    device_signature_message: Vec<u8>,
    device_timestamp: String,
}

impl Drop for PreparedCarProposal {
    fn drop(&mut self) {
        self.body.fill(0);
        self.device_nonce.fill(0);
        self.device_signature_message.fill(0);
    }
}

pub(crate) struct SignedCarProposal {
    body: Vec<u8>,
    device_id: String,
    device_nonce: Vec<u8>,
    device_signature: Vec<u8>,
    device_timestamp: String,
}

impl SignedCarProposal {
    pub(crate) fn body(&self) -> &[u8] {
        &self.body
    }

    pub(crate) fn device_id(&self) -> &str {
        &self.device_id
    }

    pub(crate) fn device_nonce(&self) -> &str {
        str::from_utf8(&self.device_nonce).unwrap_or_default()
    }

    pub(crate) fn device_signature(&self) -> &str {
        str::from_utf8(&self.device_signature).unwrap_or_default()
    }

    pub(crate) fn device_timestamp(&self) -> &str {
        &self.device_timestamp
    }

    fn clear_sensitive(&mut self) {
        self.body.fill(0);
        self.device_nonce.fill(0);
        self.device_signature.fill(0);
    }
}

impl Drop for SignedCarProposal {
    fn drop(&mut self) {
        self.clear_sensitive();
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CarProposalPreparationError {
    InvalidDevice,
    InvalidTimestamp,
    SerializationFailed,
    BodyLimitExceeded,
}

impl fmt::Display for CarProposalPreparationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("car proposal preparation failed")
    }
}

impl std::error::Error for CarProposalPreparationError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CarProposalSigningError {
    DeviceBindingMismatch,
}

impl fmt::Display for CarProposalSigningError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("car proposal signing key is not bound to the request device")
    }
}

impl std::error::Error for CarProposalSigningError {}

pub(crate) struct CandidateCarProposalV1Composer;

impl CandidateCarProposalV1Composer {
    pub(crate) fn compose(
        mut context: ReviewedCarProposalContext,
        recipe: CarRecipeSelection,
    ) -> Result<PreparedCarProposal, CarProposalPreparationError> {
        if !valid_device_id(&context.id) {
            return Err(CarProposalPreparationError::InvalidDevice);
        }
        if !valid_timestamp(&context.timestamp) {
            return Err(CarProposalPreparationError::InvalidTimestamp);
        }
        let body = serde_json::to_vec(&recipe)
            .map_err(|_| CarProposalPreparationError::SerializationFailed)?;
        if body.is_empty() || body.len() > MAX_CAR_PROPOSAL_BODY_BYTES {
            return Err(CarProposalPreparationError::BodyLimitExceeded);
        }
        let body_digest = encode_base64url(Sha256::digest(&body).as_ref());
        let device_nonce = encode_base64url(&context.nonce);
        let device_signature_message = [
            CAR_PROPOSAL_MESSAGE_PREFIX,
            CAR_PROPOSAL_METHOD,
            CAR_PROPOSAL_REQUEST_TARGET,
            &body_digest,
            &context.id,
            &device_nonce,
            &context.timestamp,
        ]
        .join("\n")
        .into_bytes();
        context.nonce.fill(0);
        Ok(PreparedCarProposal {
            body,
            device_id: std::mem::take(&mut context.id),
            device_nonce: device_nonce.into_bytes(),
            device_signature_message,
            device_timestamp: std::mem::take(&mut context.timestamp),
        })
    }
}

pub(crate) struct CandidateCarProposalV1Signer;

impl CandidateCarProposalV1Signer {
    pub(crate) fn sign(
        key: ReviewedCarProposalSigningKey,
        mut prepared: PreparedCarProposal,
    ) -> Result<SignedCarProposal, CarProposalSigningError> {
        let ReviewedCarProposalSigningKey {
            device_id,
            signing_key,
        } = key;
        if device_id != prepared.device_id {
            return Err(CarProposalSigningError::DeviceBindingMismatch);
        }
        let signature = signing_key.sign(&prepared.device_signature_message);
        Ok(SignedCarProposal {
            body: std::mem::take(&mut prepared.body),
            device_id: std::mem::take(&mut prepared.device_id),
            device_nonce: std::mem::take(&mut prepared.device_nonce),
            device_signature: encode_base64url(&signature.to_bytes()).into_bytes(),
            device_timestamp: std::mem::take(&mut prepared.device_timestamp),
        })
    }
}

impl Serialize for CarRecipeSelection {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("CarRecipeV1", 9)?;
        state.serialize_field("schemaVersion", &SCHEMA_VERSION)?;
        state.serialize_field("chassis", self.chassis)?;
        state.serialize_field("nose", self.nose)?;
        state.serialize_field("cockpit", self.cockpit)?;
        state.serialize_field("wing", self.wing)?;
        state.serialize_field("wheels", self.wheels)?;
        state.serialize_field("palette", self.palette)?;
        state.serialize_field("trail", self.trail)?;
        state.serialize_field("seed", &self.seed)?;
        state.end()
    }
}

fn valid_device_id(value: &str) -> bool {
    value.len() == 26
        && value.starts_with("dev_")
        && value[4..]
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
    let year = decimal(bytes, 0, 4);
    let month = decimal(bytes, 5, 2);
    let day = decimal(bytes, 8, 2);
    let hour = decimal(bytes, 11, 2);
    let minute = decimal(bytes, 14, 2);
    let second = decimal(bytes, 17, 2);
    (2000..=2099).contains(&year)
        && (1..=12).contains(&month)
        && day >= 1
        && day <= days_in_month(year, month)
        && hour < 24
        && minute < 60
        && second < 60
}

fn decimal(bytes: &[u8], start: usize, length: usize) -> u32 {
    bytes[start..start + length]
        .iter()
        .fold(0, |value, byte| value * 10 + u32::from(*byte - b'0'))
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn exact_chassis(value: &str) -> Option<&'static str> {
    match value {
        "formula" => Some("formula"),
        "rally" => Some("rally"),
        "roadster" => Some("roadster"),
        _ => None,
    }
}

fn exact_nose(value: &str) -> Option<&'static str> {
    match value {
        "classic" => Some("classic"),
        "scoop" => Some("scoop"),
        "wedge" => Some("wedge"),
        _ => None,
    }
}

fn exact_cockpit(value: &str) -> Option<&'static str> {
    match value {
        "canopy" => Some("canopy"),
        "open" => Some("open"),
        "rally" => Some("rally"),
        _ => None,
    }
}

fn exact_wing(value: &str) -> Option<&'static str> {
    match value {
        "high" => Some("high"),
        "low" => Some("low"),
        "none" => Some("none"),
        _ => None,
    }
}

fn exact_wheels(value: &str) -> Option<&'static str> {
    match value {
        "all-terrain" => Some("all-terrain"),
        "slick" => Some("slick"),
        "street" => Some("street"),
        _ => None,
    }
}

fn exact_palette(value: &str) -> Option<&'static str> {
    match value {
        "magenta" => Some("magenta"),
        "mint" => Some("mint"),
        "redline" => Some("redline"),
        "sunburst" => Some("sunburst"),
        "turbo-blue" => Some("turbo-blue"),
        _ => None,
    }
}

fn exact_trail(value: &str) -> Option<&'static str> {
    match value {
        "grid" => Some("grid"),
        "none" => Some("none"),
        "spark" => Some("spark"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    const DEVICE_ID: &str = "dev_CCCCCCCCCCCCCCCCCCCCCC";
    const TIMESTAMP: &str = "2026-07-15T12:34:56.789Z";
    const TEST_KEY_LABEL: &[u8] = b"viberacing-test-only-device-signing-key-v1";

    fn recipe() -> CarRecipeSelection {
        CarRecipeSelection::from_exact_values(
            "formula",
            "wedge",
            "canopy",
            "high",
            "slick",
            "turbo-blue",
            "spark",
            4242,
        )
        .expect("closed recipe must validate")
    }

    fn context(device_id: &str) -> ReviewedCarProposalContext {
        ReviewedCarProposalContext::from_active_device(
            device_id.to_owned(),
            std::array::from_fn(|index| u8::try_from(index).expect("nonce index fits")),
            TIMESTAMP.to_owned(),
        )
    }

    fn key(device_id: &str) -> ReviewedCarProposalSigningKey {
        let digest = Sha256::digest(TEST_KEY_LABEL);
        let mut secret = [0_u8; ed25519_dalek::SECRET_KEY_LENGTH];
        secret.copy_from_slice(&digest);
        ReviewedCarProposalSigningKey::from_active_device(device_id.to_owned(), secret)
    }

    fn vector() -> Value {
        serde_json::from_str(include_str!(
            "../../../contracts/v1/connector-car-proposal-device-request.test-vector.json"
        ))
        .expect("shared proposal vector must remain valid JSON")
    }

    #[test]
    fn composes_and_signs_the_shared_exact_request_vector() {
        let prepared = CandidateCarProposalV1Composer::compose(context(DEVICE_ID), recipe())
            .expect("closed proposal must compose");
        let vector = vector();
        assert_eq!(prepared.body, vector["body"].as_str().unwrap().as_bytes());
        assert_eq!(
            prepared.device_signature_message,
            vector["deviceSignatureMessage"]
                .as_str()
                .unwrap()
                .as_bytes()
        );
        assert!(prepared.body.len() <= MAX_CAR_PROPOSAL_BODY_BYTES);

        let public_key = encode_base64url(&key(DEVICE_ID).signing_key.verifying_key().to_bytes());
        let mut signed = CandidateCarProposalV1Signer::sign(key(DEVICE_ID), prepared)
            .expect("device-bound key must sign");
        assert_eq!(public_key, vector["devicePublicKeyBase64Url"]);
        assert_eq!(signed.body(), vector["body"].as_str().unwrap().as_bytes());
        assert_eq!(signed.device_id(), DEVICE_ID);
        assert_eq!(signed.device_nonce(), vector["deviceNonceBase64Url"]);
        assert_eq!(signed.device_timestamp(), TIMESTAMP);
        assert_eq!(
            signed.device_signature(),
            vector["deviceSignatureBase64Url"]
        );
        signed.clear_sensitive();
        assert!(signed.body.iter().all(|byte| *byte == 0));
        assert!(signed.device_nonce.iter().all(|byte| *byte == 0));
        assert!(signed.device_signature.iter().all(|byte| *byte == 0));
    }

    #[test]
    fn rejects_unknown_recipe_values_and_invalid_context() {
        assert!(
            CarRecipeSelection::from_exact_values(
                "formula", "wedge", "canopy", "high", "slick", "#fff", "spark", 1,
            )
            .is_none()
        );
        assert_eq!(
            CandidateCarProposalV1Composer::compose(context("dev_short"), recipe()).err(),
            Some(CarProposalPreparationError::InvalidDevice)
        );
        let invalid_time = ReviewedCarProposalContext::from_active_device(
            DEVICE_ID.to_owned(),
            [1; CAR_PROPOSAL_NONCE_BYTES],
            "2026-02-30T12:34:56.789Z".to_owned(),
        );
        assert_eq!(
            CandidateCarProposalV1Composer::compose(invalid_time, recipe()).err(),
            Some(CarProposalPreparationError::InvalidTimestamp)
        );
    }

    #[test]
    fn rejects_a_key_bound_to_another_device_without_reflection() {
        let prepared =
            CandidateCarProposalV1Composer::compose(context(DEVICE_ID), recipe()).unwrap();
        let error = CandidateCarProposalV1Signer::sign(key("dev_DDDDDDDDDDDDDDDDDDDDDD"), prepared)
            .err()
            .expect("mismatched key must fail");
        assert_eq!(error, CarProposalSigningError::DeviceBindingMismatch);
        assert!(!error.to_string().contains(DEVICE_ID));
    }

    #[test]
    fn constants_match_the_versioned_authentication_policy() {
        let policy: Value = serde_json::from_str(include_str!(
            "../../../contracts/v1/connector-car-proposal-authentication.json"
        ))
        .expect("proposal policy must remain JSON");
        assert_eq!(policy["method"], CAR_PROPOSAL_METHOD);
        assert_eq!(policy["requestTarget"], CAR_PROPOSAL_REQUEST_TARGET);
        assert_eq!(policy["mediaType"], CAR_PROPOSAL_MEDIA_TYPE);
        assert_eq!(policy["maximumBodyBytes"], MAX_CAR_PROPOSAL_BODY_BYTES);
        assert_eq!(
            policy["deviceSignature"]["messagePrefix"],
            CAR_PROPOSAL_MESSAGE_PREFIX
        );
        assert_eq!(
            policy["deviceSignature"]["nonceBytes"],
            CAR_PROPOSAL_NONCE_BYTES
        );
    }
}
