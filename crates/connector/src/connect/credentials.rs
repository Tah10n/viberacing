//! Fixed-shape installation and account credentials in the operating-system native store.

use std::str;

use ed25519_dalek::SECRET_KEY_LENGTH;

use crate::reader::{AccountingScope, AgentProvider};

use super::discovery::DiscoveredAccount;
use super::{
    ConnectorCliError, Origin, all_zero, copy_range, exact_text, map_credential_delete_result,
    valid_pairing_id, valid_public_id, valid_user_code,
};

pub(super) const MAX_ACCOUNT_SLOTS: usize = 16;

const KEYRING_SERVICE: &str = "viberacing.connector.installation.v2";
const INSTALLATION_ENTRY_ACCOUNT: &str = "installation-default";
const ACCOUNT_ENTRY_PREFIX: &str = "account-";

const INSTALLATION_MAGIC: &[u8; 8] = b"VBRINS02";
const INSTALLATION_VERSION: u8 = 1;
const INSTALLATION_MAGIC_RANGE: std::ops::Range<usize> = 0..8;
const INSTALLATION_VERSION_INDEX: usize = 8;
const INSTALLATION_STATE_INDEX: usize = 9;
const ORIGIN_LENGTH_RANGE: std::ops::Range<usize> = 10..12;
const ORIGIN_RANGE: std::ops::Range<usize> = 12..524;
const INSTALLATION_ORIGIN_DIGEST_RANGE: std::ops::Range<usize> = 524..556;
const CLIENT_RATE_ID_RANGE: std::ops::Range<usize> = 556..572;
const INSTALLATION_SECRET_RANGE: std::ops::Range<usize> = 572..604;
const PAIRING_ID_RANGE: std::ops::Range<usize> = 604..631;
const POLL_TOKEN_RANGE: std::ops::Range<usize> = 631..663;
const CHALLENGE_RANGE: std::ops::Range<usize> = 663..695;
const USER_CODE_RANGE: std::ops::Range<usize> = 695..709;
const DEADLINE_RANGE: std::ops::Range<usize> = 709..717;
const MANIFEST_DIGEST_RANGE: std::ops::Range<usize> = 717..749;
const SLOT_STATES_RANGE: std::ops::Range<usize> = 749..765;
const CANDIDATE_IDS_RANGE: std::ops::Range<usize> = 765..1197;
const INSTALLATION_RECORD_BYTES: usize = 1197;

const ACCOUNT_MAGIC: &[u8; 8] = b"VBRACC02";
const ACCOUNT_VERSION: u8 = 1;
const ACCOUNT_MAGIC_RANGE: std::ops::Range<usize> = 0..8;
const ACCOUNT_VERSION_INDEX: usize = 8;
const ACCOUNT_STATE_INDEX: usize = 9;
const ACCOUNT_ORIGIN_DIGEST_RANGE: std::ops::Range<usize> = 10..42;
const ACCOUNT_CANDIDATE_ID_RANGE: std::ops::Range<usize> = 42..69;
const ACCOUNT_PROVIDER_INDEX: usize = 69;
const READER_LENGTH_INDEX: usize = 70;
const READER_RANGE: std::ops::Range<usize> = 71..135;
const ACCOUNTING_REVISION_RANGE: std::ops::Range<usize> = 135..139;
const SCOPE_INDEX: usize = 139;
const LABEL_LENGTH_INDEX: usize = 140;
const LABEL_RANGE: std::ops::Range<usize> = 141..205;
const ACCOUNT_SECRET_RANGE: std::ops::Range<usize> = 205..237;
const AGENT_ACCOUNT_ID_RANGE: std::ops::Range<usize> = 237..263;
const DEVICE_ID_RANGE: std::ops::Range<usize> = 263..289;
const DEVICE_KEY_ID_RANGE: std::ops::Range<usize> = 289..315;
const LAST_SYNC_RANGE: std::ops::Range<usize> = 315..323;
const ACCOUNT_RECORD_BYTES: usize = 323;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(super) enum InstallationState {
    Prepared = 1,
    Starting = 2,
    Pending = 3,
    Active = 4,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(super) enum SlotState {
    Empty = 0,
    Pending = 1,
    Active = 2,
}

pub(super) struct InstallationRecord {
    pub(super) state: InstallationState,
    origin_length: u16,
    origin: [u8; 512],
    pub(super) origin_digest: [u8; 32],
    pub(super) client_rate_id: [u8; 16],
    pub(super) secret_key: [u8; SECRET_KEY_LENGTH],
    pub(super) pairing_id: [u8; 27],
    pub(super) poll_token: [u8; 32],
    pub(super) challenge: [u8; 32],
    pub(super) user_code: [u8; 14],
    pub(super) deadline: u64,
    pub(super) manifest_digest: [u8; 32],
    slot_states: [SlotState; MAX_ACCOUNT_SLOTS],
    candidate_ids: [[u8; 27]; MAX_ACCOUNT_SLOTS],
}

impl InstallationRecord {
    pub(super) fn new(origin: &Origin) -> Result<Self, ConnectorCliError> {
        let origin_bytes = origin.value.as_bytes();
        let origin_length =
            u16::try_from(origin_bytes.len()).map_err(|_| ConnectorCliError::InvalidOrigin)?;
        let mut origin_buffer = [0_u8; 512];
        origin_buffer[..origin_bytes.len()].copy_from_slice(origin_bytes);
        let mut client_rate_id = [0_u8; 16];
        let mut secret_key = [0_u8; SECRET_KEY_LENGTH];
        getrandom::fill(&mut client_rate_id).map_err(|_| ConnectorCliError::EntropyUnavailable)?;
        getrandom::fill(&mut secret_key).map_err(|_| ConnectorCliError::EntropyUnavailable)?;
        if all_zero(&client_rate_id) || all_zero(&secret_key) {
            client_rate_id.fill(0);
            secret_key.fill(0);
            return Err(ConnectorCliError::EntropyUnavailable);
        }
        Ok(Self {
            state: InstallationState::Prepared,
            origin_length,
            origin: origin_buffer,
            origin_digest: super::digest_origin(origin),
            client_rate_id,
            secret_key,
            pairing_id: [0; 27],
            poll_token: [0; 32],
            challenge: [0; 32],
            user_code: [0; 14],
            deadline: 0,
            manifest_digest: [0; 32],
            slot_states: [SlotState::Empty; MAX_ACCOUNT_SLOTS],
            candidate_ids: [[0; 27]; MAX_ACCOUNT_SLOTS],
        })
    }

    pub(super) fn origin(&self) -> Result<Origin, ConnectorCliError> {
        let length = usize::from(self.origin_length);
        if length == 0 || length > self.origin.len() {
            return Err(ConnectorCliError::SecureStorageInvalid);
        }
        let value = str::from_utf8(&self.origin[..length])
            .map_err(|_| ConnectorCliError::SecureStorageInvalid)?;
        Origin::parse(value).map_err(|_| ConnectorCliError::SecureStorageInvalid)
    }

    pub(super) fn pairing_id(&self) -> Result<&str, ConnectorCliError> {
        str::from_utf8(&self.pairing_id).map_err(|_| ConnectorCliError::SecureStorageInvalid)
    }

    pub(super) fn user_code(&self) -> Result<&str, ConnectorCliError> {
        str::from_utf8(&self.user_code).map_err(|_| ConnectorCliError::SecureStorageInvalid)
    }

    pub(super) fn slot_state(&self, slot: usize) -> Option<SlotState> {
        self.slot_states.get(slot).copied()
    }

    pub(super) fn candidate_id(&self, slot: usize) -> Result<Option<&str>, ConnectorCliError> {
        let state = self
            .slot_states
            .get(slot)
            .copied()
            .ok_or(ConnectorCliError::SecureStorageInvalid)?;
        if state == SlotState::Empty {
            return Ok(None);
        }
        str::from_utf8(&self.candidate_ids[slot])
            .map(Some)
            .map_err(|_| ConnectorCliError::SecureStorageInvalid)
    }

    pub(super) fn populated_slots(&self) -> impl Iterator<Item = usize> + '_ {
        self.slot_states
            .iter()
            .enumerate()
            .filter_map(|(slot, state)| (*state != SlotState::Empty).then_some(slot))
    }

    pub(super) fn active_slots(&self) -> impl Iterator<Item = usize> + '_ {
        self.slot_states
            .iter()
            .enumerate()
            .filter_map(|(slot, state)| (*state == SlotState::Active).then_some(slot))
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn make_starting(
        &mut self,
        deadline: u64,
        manifest_digest: [u8; 32],
        candidate_ids: &[String],
    ) -> Result<(), ConnectorCliError> {
        if candidate_ids.is_empty()
            || candidate_ids.len() > MAX_ACCOUNT_SLOTS
            || deadline == 0
            || all_zero(&manifest_digest)
        {
            return Err(ConnectorCliError::SyncPreparationUnavailable);
        }
        self.clear_pairing();
        self.deadline = deadline;
        self.manifest_digest = manifest_digest;
        for (slot, candidate_id) in candidate_ids.iter().enumerate() {
            self.candidate_ids[slot] = exact_text(candidate_id)?;
            self.slot_states[slot] = SlotState::Pending;
        }
        self.state = InstallationState::Starting;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn make_pending(
        &mut self,
        pairing_id: &str,
        poll_token: [u8; 32],
        challenge: [u8; 32],
        user_code: &str,
        deadline: u64,
        manifest_digest: [u8; 32],
        candidate_ids: &[String],
    ) -> Result<(), ConnectorCliError> {
        if candidate_ids.is_empty()
            || candidate_ids.len() > MAX_ACCOUNT_SLOTS
            || deadline == 0
            || all_zero(&poll_token)
            || all_zero(&challenge)
            || all_zero(&manifest_digest)
        {
            return Err(ConnectorCliError::InvalidServiceResponse);
        }
        let expected_ids = candidate_ids
            .iter()
            .enumerate()
            .all(|(slot, candidate_id)| {
                self.slot_states.get(slot) == Some(&SlotState::Pending)
                    && self.candidate_ids[slot].as_slice() == candidate_id.as_bytes()
            });
        if self.state != InstallationState::Starting
            || self.manifest_digest != manifest_digest
            || !expected_ids
        {
            return Err(ConnectorCliError::InvalidServiceResponse);
        }
        self.clear_pending_transport();
        self.pairing_id = exact_text(pairing_id)?;
        self.poll_token = poll_token;
        self.challenge = challenge;
        self.user_code = exact_text(user_code)?;
        self.deadline = deadline;
        self.manifest_digest = manifest_digest;
        self.state = InstallationState::Pending;
        Ok(())
    }

    pub(super) fn finish_activation(
        &mut self,
        active_slots: &[usize],
        skipped_slots: &[usize],
    ) -> Result<(), ConnectorCliError> {
        let pending_slots = self
            .slot_states
            .iter()
            .filter(|state| **state == SlotState::Pending)
            .count();
        if active_slots.len() + skipped_slots.len() != pending_slots
            || active_slots
                .iter()
                .chain(skipped_slots)
                .any(|slot| self.slot_states.get(*slot) != Some(&SlotState::Pending))
        {
            return Err(ConnectorCliError::InvalidServiceResponse);
        }
        for slot in active_slots {
            self.slot_states[*slot] = SlotState::Active;
        }
        for slot in skipped_slots {
            self.slot_states[*slot] = SlotState::Empty;
            self.candidate_ids[*slot].fill(0);
        }
        self.clear_pending_transport();
        self.state = if active_slots.is_empty() {
            InstallationState::Prepared
        } else {
            InstallationState::Active
        };
        Ok(())
    }

    pub(super) fn reset_expired(&mut self) {
        self.clear_pairing();
        self.state = InstallationState::Prepared;
    }

    fn clear_pairing(&mut self) {
        self.clear_pending_transport();
        self.slot_states.fill(SlotState::Empty);
        self.candidate_ids
            .iter_mut()
            .for_each(|value| value.fill(0));
    }

    fn clear_pending_transport(&mut self) {
        self.pairing_id.fill(0);
        self.poll_token.fill(0);
        self.challenge.fill(0);
        self.user_code.fill(0);
        self.deadline = 0;
        self.manifest_digest.fill(0);
    }

    pub(super) fn encode(&self) -> [u8; INSTALLATION_RECORD_BYTES] {
        let mut output = [0_u8; INSTALLATION_RECORD_BYTES];
        output[INSTALLATION_MAGIC_RANGE].copy_from_slice(INSTALLATION_MAGIC);
        output[INSTALLATION_VERSION_INDEX] = INSTALLATION_VERSION;
        output[INSTALLATION_STATE_INDEX] = self.state as u8;
        output[ORIGIN_LENGTH_RANGE].copy_from_slice(&self.origin_length.to_le_bytes());
        output[ORIGIN_RANGE].copy_from_slice(&self.origin);
        output[INSTALLATION_ORIGIN_DIGEST_RANGE].copy_from_slice(&self.origin_digest);
        output[CLIENT_RATE_ID_RANGE].copy_from_slice(&self.client_rate_id);
        output[INSTALLATION_SECRET_RANGE].copy_from_slice(&self.secret_key);
        output[PAIRING_ID_RANGE].copy_from_slice(&self.pairing_id);
        output[POLL_TOKEN_RANGE].copy_from_slice(&self.poll_token);
        output[CHALLENGE_RANGE].copy_from_slice(&self.challenge);
        output[USER_CODE_RANGE].copy_from_slice(&self.user_code);
        output[DEADLINE_RANGE].copy_from_slice(&self.deadline.to_le_bytes());
        output[MANIFEST_DIGEST_RANGE].copy_from_slice(&self.manifest_digest);
        for (slot, state) in self.slot_states.iter().enumerate() {
            output[SLOT_STATES_RANGE.start + slot] = *state as u8;
            let start = CANDIDATE_IDS_RANGE.start + slot * 27;
            output[start..start + 27].copy_from_slice(&self.candidate_ids[slot]);
        }
        output
    }

    pub(super) fn decode(bytes: &[u8]) -> Result<Self, ConnectorCliError> {
        if bytes.len() != INSTALLATION_RECORD_BYTES
            || bytes[INSTALLATION_MAGIC_RANGE] != *INSTALLATION_MAGIC
            || bytes[INSTALLATION_VERSION_INDEX] != INSTALLATION_VERSION
        {
            return Err(ConnectorCliError::SecureStorageInvalid);
        }
        let state = match bytes[INSTALLATION_STATE_INDEX] {
            1 => InstallationState::Prepared,
            2 => InstallationState::Starting,
            3 => InstallationState::Pending,
            4 => InstallationState::Active,
            _ => return Err(ConnectorCliError::SecureStorageInvalid),
        };
        let mut slot_states = [SlotState::Empty; MAX_ACCOUNT_SLOTS];
        let mut candidate_ids = [[0_u8; 27]; MAX_ACCOUNT_SLOTS];
        for slot in 0..MAX_ACCOUNT_SLOTS {
            slot_states[slot] = match bytes[SLOT_STATES_RANGE.start + slot] {
                0 => SlotState::Empty,
                1 => SlotState::Pending,
                2 => SlotState::Active,
                _ => return Err(ConnectorCliError::SecureStorageInvalid),
            };
            let start = CANDIDATE_IDS_RANGE.start + slot * 27;
            candidate_ids[slot].copy_from_slice(&bytes[start..start + 27]);
        }
        let mut record = Self {
            state,
            origin_length: u16::from_le_bytes(copy_range(bytes, ORIGIN_LENGTH_RANGE)),
            origin: copy_range(bytes, ORIGIN_RANGE),
            origin_digest: copy_range(bytes, INSTALLATION_ORIGIN_DIGEST_RANGE),
            client_rate_id: copy_range(bytes, CLIENT_RATE_ID_RANGE),
            secret_key: copy_range(bytes, INSTALLATION_SECRET_RANGE),
            pairing_id: copy_range(bytes, PAIRING_ID_RANGE),
            poll_token: copy_range(bytes, POLL_TOKEN_RANGE),
            challenge: copy_range(bytes, CHALLENGE_RANGE),
            user_code: copy_range(bytes, USER_CODE_RANGE),
            deadline: u64::from_le_bytes(copy_range(bytes, DEADLINE_RANGE)),
            manifest_digest: copy_range(bytes, MANIFEST_DIGEST_RANGE),
            slot_states,
            candidate_ids,
        };
        if !record.valid() {
            record.clear();
            return Err(ConnectorCliError::SecureStorageInvalid);
        }
        Ok(record)
    }

    fn valid(&self) -> bool {
        let Ok(origin) = self.origin() else {
            return false;
        };
        if self.origin_length == 0
            || usize::from(self.origin_length) > self.origin.len()
            || self.origin[usize::from(self.origin_length)..]
                .iter()
                .any(|byte| *byte != 0)
            || self.origin_digest != super::digest_origin(&origin)
            || all_zero(&self.client_rate_id)
            || all_zero(&self.secret_key)
        {
            return false;
        }
        let slots_valid = self
            .slot_states
            .iter()
            .enumerate()
            .all(|(slot, state)| match state {
                SlotState::Empty => all_zero(&self.candidate_ids[slot]),
                SlotState::Pending | SlotState::Active => str::from_utf8(&self.candidate_ids[slot])
                    .is_ok_and(|value| valid_prefixed_id(value, "cand_", 27)),
            });
        if !slots_valid {
            return false;
        }
        let pending_transport_clear = all_zero(&self.pairing_id)
            && all_zero(&self.poll_token)
            && all_zero(&self.challenge)
            && all_zero(&self.user_code)
            && self.deadline == 0
            && all_zero(&self.manifest_digest);
        match self.state {
            InstallationState::Prepared => {
                pending_transport_clear
                    && self
                        .slot_states
                        .iter()
                        .all(|state| *state == SlotState::Empty)
            }
            InstallationState::Starting => {
                all_zero(&self.pairing_id)
                    && all_zero(&self.poll_token)
                    && all_zero(&self.challenge)
                    && all_zero(&self.user_code)
                    && self.deadline > 0
                    && !all_zero(&self.manifest_digest)
                    && self.slot_states.contains(&SlotState::Pending)
                    && self
                        .slot_states
                        .iter()
                        .all(|state| matches!(state, SlotState::Empty | SlotState::Pending))
            }
            InstallationState::Pending => {
                self.deadline > 0
                    && str::from_utf8(&self.pairing_id).is_ok_and(valid_pairing_id)
                    && str::from_utf8(&self.user_code).is_ok_and(valid_user_code)
                    && !all_zero(&self.poll_token)
                    && !all_zero(&self.challenge)
                    && !all_zero(&self.manifest_digest)
                    && self.slot_states.contains(&SlotState::Pending)
                    && self
                        .slot_states
                        .iter()
                        .all(|state| matches!(state, SlotState::Empty | SlotState::Pending))
            }
            InstallationState::Active => {
                pending_transport_clear
                    && self.slot_states.contains(&SlotState::Active)
                    && self
                        .slot_states
                        .iter()
                        .all(|state| matches!(state, SlotState::Empty | SlotState::Active))
            }
        }
    }

    fn clear(&mut self) {
        self.origin.fill(0);
        self.origin_length = 0;
        self.origin_digest.fill(0);
        self.client_rate_id.fill(0);
        self.secret_key.fill(0);
        self.clear_pairing();
    }
}

impl Drop for InstallationRecord {
    fn drop(&mut self) {
        self.clear();
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(super) enum AccountState {
    Pending = 1,
    Active = 2,
}

pub(super) struct AccountCredential {
    pub(super) state: AccountState,
    pub(super) origin_digest: [u8; 32],
    pub(super) candidate_id: [u8; 27],
    provider: AgentProvider,
    reader_length: u8,
    reader_version: [u8; 64],
    pub(super) accounting_revision: u32,
    scope_kind: AccountingScope,
    label_length: u8,
    safe_display_label: [u8; 64],
    pub(super) secret_key: [u8; SECRET_KEY_LENGTH],
    pub(super) agent_account_id: [u8; 26],
    pub(super) device_id: [u8; 26],
    pub(super) device_key_id: [u8; 26],
    pub(super) last_sync_epoch_seconds: u64,
}

impl AccountCredential {
    pub(super) fn new_pending(
        origin_digest: [u8; 32],
        candidate_id: &str,
        account: &DiscoveredAccount,
        secret_key: [u8; SECRET_KEY_LENGTH],
    ) -> Result<Self, ConnectorCliError> {
        if all_zero(&secret_key) {
            return Err(ConnectorCliError::EntropyUnavailable);
        }
        let reader_length = u8::try_from(account.reader_version.len())
            .map_err(|_| ConnectorCliError::SecureStorageInvalid)?;
        let label_length = u8::try_from(account.safe_display_label.len())
            .map_err(|_| ConnectorCliError::SecureStorageInvalid)?;
        let mut reader_version = [0_u8; 64];
        reader_version[..usize::from(reader_length)]
            .copy_from_slice(account.reader_version.as_bytes());
        let mut safe_display_label = [0_u8; 64];
        safe_display_label[..usize::from(label_length)]
            .copy_from_slice(account.safe_display_label.as_bytes());
        let record = Self {
            state: AccountState::Pending,
            origin_digest,
            candidate_id: exact_text(candidate_id)?,
            provider: account.provider,
            reader_length,
            reader_version,
            accounting_revision: account.accounting_revision,
            scope_kind: account.scope_kind,
            label_length,
            safe_display_label,
            secret_key,
            agent_account_id: [0; 26],
            device_id: [0; 26],
            device_key_id: [0; 26],
            last_sync_epoch_seconds: 0,
        };
        if !record.valid(&origin_digest) {
            return Err(ConnectorCliError::SecureStorageInvalid);
        }
        Ok(record)
    }

    pub(super) fn candidate_id(&self) -> Result<&str, ConnectorCliError> {
        str::from_utf8(&self.candidate_id).map_err(|_| ConnectorCliError::SecureStorageInvalid)
    }

    pub(super) const fn provider(&self) -> AgentProvider {
        self.provider
    }

    pub(super) const fn scope_kind(&self) -> AccountingScope {
        self.scope_kind
    }

    pub(super) fn reader_version(&self) -> Result<&str, ConnectorCliError> {
        str::from_utf8(&self.reader_version[..usize::from(self.reader_length)])
            .map_err(|_| ConnectorCliError::SecureStorageInvalid)
    }

    pub(super) fn safe_display_label(&self) -> Result<&str, ConnectorCliError> {
        str::from_utf8(&self.safe_display_label[..usize::from(self.label_length)])
            .map_err(|_| ConnectorCliError::SecureStorageInvalid)
    }

    pub(super) fn make_active(
        &mut self,
        agent_account_id: &str,
        device_id: &str,
        device_key_id: &str,
    ) -> Result<(), ConnectorCliError> {
        self.agent_account_id = exact_text(agent_account_id)?;
        self.device_id = exact_text(device_id)?;
        self.device_key_id = exact_text(device_key_id)?;
        self.state = AccountState::Active;
        if !self.valid(&self.origin_digest) {
            return Err(ConnectorCliError::InvalidServiceResponse);
        }
        Ok(())
    }

    pub(super) fn mark_synced(&mut self, epoch_seconds: u64) {
        self.last_sync_epoch_seconds = epoch_seconds;
    }

    pub(super) fn encode(&self) -> [u8; ACCOUNT_RECORD_BYTES] {
        let mut output = [0_u8; ACCOUNT_RECORD_BYTES];
        output[ACCOUNT_MAGIC_RANGE].copy_from_slice(ACCOUNT_MAGIC);
        output[ACCOUNT_VERSION_INDEX] = ACCOUNT_VERSION;
        output[ACCOUNT_STATE_INDEX] = self.state as u8;
        output[ACCOUNT_ORIGIN_DIGEST_RANGE].copy_from_slice(&self.origin_digest);
        output[ACCOUNT_CANDIDATE_ID_RANGE].copy_from_slice(&self.candidate_id);
        output[ACCOUNT_PROVIDER_INDEX] = match self.provider {
            AgentProvider::Codex => 1,
        };
        output[READER_LENGTH_INDEX] = self.reader_length;
        output[READER_RANGE].copy_from_slice(&self.reader_version);
        output[ACCOUNTING_REVISION_RANGE].copy_from_slice(&self.accounting_revision.to_le_bytes());
        output[SCOPE_INDEX] = match self.scope_kind {
            AccountingScope::AgentAccount => 1,
        };
        output[LABEL_LENGTH_INDEX] = self.label_length;
        output[LABEL_RANGE].copy_from_slice(&self.safe_display_label);
        output[ACCOUNT_SECRET_RANGE].copy_from_slice(&self.secret_key);
        output[AGENT_ACCOUNT_ID_RANGE].copy_from_slice(&self.agent_account_id);
        output[DEVICE_ID_RANGE].copy_from_slice(&self.device_id);
        output[DEVICE_KEY_ID_RANGE].copy_from_slice(&self.device_key_id);
        output[LAST_SYNC_RANGE].copy_from_slice(&self.last_sync_epoch_seconds.to_le_bytes());
        output
    }

    pub(super) fn decode(
        bytes: &[u8],
        expected_origin: &[u8; 32],
    ) -> Result<Self, ConnectorCliError> {
        if bytes.len() != ACCOUNT_RECORD_BYTES
            || bytes[ACCOUNT_MAGIC_RANGE] != *ACCOUNT_MAGIC
            || bytes[ACCOUNT_VERSION_INDEX] != ACCOUNT_VERSION
        {
            return Err(ConnectorCliError::SecureStorageInvalid);
        }
        let state = match bytes[ACCOUNT_STATE_INDEX] {
            1 => AccountState::Pending,
            2 => AccountState::Active,
            _ => return Err(ConnectorCliError::SecureStorageInvalid),
        };
        let provider = match bytes[ACCOUNT_PROVIDER_INDEX] {
            1 => AgentProvider::Codex,
            _ => return Err(ConnectorCliError::SecureStorageInvalid),
        };
        let scope_kind = match bytes[SCOPE_INDEX] {
            1 => AccountingScope::AgentAccount,
            _ => return Err(ConnectorCliError::SecureStorageInvalid),
        };
        let mut record = Self {
            state,
            origin_digest: copy_range(bytes, ACCOUNT_ORIGIN_DIGEST_RANGE),
            candidate_id: copy_range(bytes, ACCOUNT_CANDIDATE_ID_RANGE),
            provider,
            reader_length: bytes[READER_LENGTH_INDEX],
            reader_version: copy_range(bytes, READER_RANGE),
            accounting_revision: u32::from_le_bytes(copy_range(bytes, ACCOUNTING_REVISION_RANGE)),
            scope_kind,
            label_length: bytes[LABEL_LENGTH_INDEX],
            safe_display_label: copy_range(bytes, LABEL_RANGE),
            secret_key: copy_range(bytes, ACCOUNT_SECRET_RANGE),
            agent_account_id: copy_range(bytes, AGENT_ACCOUNT_ID_RANGE),
            device_id: copy_range(bytes, DEVICE_ID_RANGE),
            device_key_id: copy_range(bytes, DEVICE_KEY_ID_RANGE),
            last_sync_epoch_seconds: u64::from_le_bytes(copy_range(bytes, LAST_SYNC_RANGE)),
        };
        if !record.valid(expected_origin) {
            record.clear();
            return Err(ConnectorCliError::SecureStorageInvalid);
        }
        Ok(record)
    }

    fn valid(&self, expected_origin: &[u8; 32]) -> bool {
        let reader_length = usize::from(self.reader_length);
        let label_length = usize::from(self.label_length);
        if reader_length > self.reader_version.len() || label_length > self.safe_display_label.len()
        {
            return false;
        }
        let reader = str::from_utf8(&self.reader_version[..reader_length]).ok();
        let label = str::from_utf8(&self.safe_display_label[..label_length]).ok();
        let base_valid = &self.origin_digest == expected_origin
            && str::from_utf8(&self.candidate_id)
                .is_ok_and(|value| valid_prefixed_id(value, "cand_", 27))
            && reader.is_some_and(valid_reader_version)
            && self.accounting_revision > 0
            && self.accounting_revision <= 999_999
            && self.scope_kind == AccountingScope::AgentAccount
            && label.is_some_and(|value| {
                !value.is_empty() && value.len() <= 64 && !value.chars().any(char::is_control)
            })
            && self.reader_version[reader_length..]
                .iter()
                .all(|byte| *byte == 0)
            && self.safe_display_label[label_length..]
                .iter()
                .all(|byte| *byte == 0)
            && !all_zero(&self.secret_key);
        if !base_valid {
            return false;
        }
        match self.state {
            AccountState::Pending => {
                all_zero(&self.agent_account_id)
                    && all_zero(&self.device_id)
                    && all_zero(&self.device_key_id)
                    && self.last_sync_epoch_seconds == 0
            }
            AccountState::Active => {
                str::from_utf8(&self.agent_account_id)
                    .is_ok_and(|value| valid_public_id(value, "acc_"))
                    && str::from_utf8(&self.device_id)
                        .is_ok_and(|value| valid_public_id(value, "dev_"))
                    && str::from_utf8(&self.device_key_id)
                        .is_ok_and(|value| valid_public_id(value, "key_"))
            }
        }
    }

    fn clear(&mut self) {
        self.origin_digest.fill(0);
        self.candidate_id.fill(0);
        self.reader_version.fill(0);
        self.safe_display_label.fill(0);
        self.secret_key.fill(0);
        self.agent_account_id.fill(0);
        self.device_id.fill(0);
        self.device_key_id.fill(0);
        self.last_sync_epoch_seconds = 0;
    }
}

impl Drop for AccountCredential {
    fn drop(&mut self) {
        self.clear();
    }
}

pub(super) trait CredentialStore {
    fn load_installation(&mut self) -> Result<Option<InstallationRecord>, ConnectorCliError>;
    fn save_installation(&mut self, record: &InstallationRecord) -> Result<(), ConnectorCliError>;
    fn load_account(
        &mut self,
        slot: usize,
        expected_origin: &[u8; 32],
    ) -> Result<Option<AccountCredential>, ConnectorCliError>;
    fn save_account(
        &mut self,
        slot: usize,
        record: &AccountCredential,
    ) -> Result<(), ConnectorCliError>;
    fn delete_account(&mut self, slot: usize) -> Result<(), ConnectorCliError>;
    fn delete_all(&mut self) -> Result<(), ConnectorCliError>;
}

pub(super) struct OsCredentialStore {
    installation: keyring::Entry,
    accounts: Vec<keyring::Entry>,
}

impl OsCredentialStore {
    pub(super) fn new() -> Result<Self, ConnectorCliError> {
        let installation = keyring::Entry::new(KEYRING_SERVICE, INSTALLATION_ENTRY_ACCOUNT)
            .map_err(|_| ConnectorCliError::SecureStorageUnavailable)?;
        let accounts = (0..MAX_ACCOUNT_SLOTS)
            .map(|slot| {
                keyring::Entry::new(KEYRING_SERVICE, &format!("{ACCOUNT_ENTRY_PREFIX}{slot:02}"))
                    .map_err(|_| ConnectorCliError::SecureStorageUnavailable)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            installation,
            accounts,
        })
    }

    fn account(&self, slot: usize) -> Result<&keyring::Entry, ConnectorCliError> {
        self.accounts
            .get(slot)
            .ok_or(ConnectorCliError::SecureStorageInvalid)
    }
}

impl CredentialStore for OsCredentialStore {
    fn load_installation(&mut self) -> Result<Option<InstallationRecord>, ConnectorCliError> {
        let mut bytes = match self.installation.get_secret() {
            Ok(bytes) => bytes,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(_) => return Err(ConnectorCliError::SecureStorageUnavailable),
        };
        let result = InstallationRecord::decode(&bytes).map(Some);
        bytes.fill(0);
        result
    }

    fn save_installation(&mut self, record: &InstallationRecord) -> Result<(), ConnectorCliError> {
        let mut encoded = record.encode();
        let result = self
            .installation
            .set_secret(&encoded)
            .map_err(|_| ConnectorCliError::SecureStorageUnavailable);
        encoded.fill(0);
        result
    }

    fn load_account(
        &mut self,
        slot: usize,
        expected_origin: &[u8; 32],
    ) -> Result<Option<AccountCredential>, ConnectorCliError> {
        let mut bytes = match self.account(slot)?.get_secret() {
            Ok(bytes) => bytes,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(_) => return Err(ConnectorCliError::SecureStorageUnavailable),
        };
        let result = AccountCredential::decode(&bytes, expected_origin).map(Some);
        bytes.fill(0);
        result
    }

    fn save_account(
        &mut self,
        slot: usize,
        record: &AccountCredential,
    ) -> Result<(), ConnectorCliError> {
        let mut encoded = record.encode();
        let result = self
            .account(slot)?
            .set_secret(&encoded)
            .map_err(|_| ConnectorCliError::SecureStorageUnavailable);
        encoded.fill(0);
        result
    }

    fn delete_account(&mut self, slot: usize) -> Result<(), ConnectorCliError> {
        map_credential_delete_result(&self.account(slot)?.delete_credential())
    }

    fn delete_all(&mut self) -> Result<(), ConnectorCliError> {
        let mut failed = false;
        for entry in &self.accounts {
            if map_credential_delete_result(&entry.delete_credential()).is_err() {
                failed = true;
            }
        }
        if map_credential_delete_result(&self.installation.delete_credential()).is_err() {
            failed = true;
        }
        if failed {
            Err(ConnectorCliError::SecureStorageUnavailable)
        } else {
            Ok(())
        }
    }
}

fn valid_prefixed_id(value: &str, prefix: &str, length: usize) -> bool {
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

#[cfg(test)]
mod tests {
    use crate::reader::{
        CanonicalDailyUsage, CanonicalDailyUsageEntry, FingerprintKind, ReaderStatus,
    };

    use super::*;

    fn origin() -> Origin {
        Origin::parse("https://race.example").unwrap()
    }

    fn account() -> DiscoveredAccount {
        DiscoveredAccount {
            provider: AgentProvider::Codex,
            reader_version: "codex_app_server_0_144_5_v1",
            accounting_revision: 1,
            scope_kind: AccountingScope::AgentAccount,
            fingerprint_kind: FingerprintKind::Unavailable,
            account_fingerprint_digest: None,
            safe_display_label: "Codex account".to_owned(),
            status: ReaderStatus::Ready,
            daily_usage: CanonicalDailyUsage::new(vec![
                CanonicalDailyUsageEntry::new("2026-07-14".to_owned(), "456".to_owned()).unwrap(),
            ])
            .unwrap(),
        }
    }

    #[test]
    fn fixed_installation_record_round_trips_pending_and_active_slots() {
        let origin = origin();
        let mut record = InstallationRecord::new(&origin).unwrap();
        let encoded = record.encode();
        let decoded = InstallationRecord::decode(&encoded).unwrap();
        assert_eq!(decoded.origin().unwrap().value, origin.value);
        record
            .make_starting(
                42,
                [3; 32],
                &[
                    "cand_AAAAAAAAAAAAAAAAAAAAAA".to_owned(),
                    "cand_BBBBBBBBBBBBBBBBBBBBBB".to_owned(),
                ],
            )
            .unwrap();
        record
            .make_pending(
                "pair_AAAAAAAAAAAAAAAAAAAAAA",
                [1; 32],
                [2; 32],
                "ABCD-EFGH-JKLM",
                42,
                [3; 32],
                &[
                    "cand_AAAAAAAAAAAAAAAAAAAAAA".to_owned(),
                    "cand_BBBBBBBBBBBBBBBBBBBBBB".to_owned(),
                ],
            )
            .unwrap();
        let encoded = record.encode();
        let mut decoded = InstallationRecord::decode(&encoded).unwrap();
        assert_eq!(decoded.slot_state(0), Some(SlotState::Pending));
        assert_eq!(decoded.slot_state(1), Some(SlotState::Pending));
        decoded.finish_activation(&[1], &[0]).unwrap();
        assert_eq!(decoded.state, InstallationState::Active);
        assert_eq!(decoded.active_slots().collect::<Vec<_>>(), vec![1]);
        assert_eq!(
            InstallationRecord::decode(&decoded.encode())
                .unwrap()
                .active_slots()
                .collect::<Vec<_>>(),
            vec![1]
        );
    }

    #[test]
    fn fixed_account_record_round_trips_and_rejects_origin_or_padding_drift() {
        let origin = origin();
        let digest = super::super::digest_origin(&origin);
        let mut record = AccountCredential::new_pending(
            digest,
            "cand_AAAAAAAAAAAAAAAAAAAAAA",
            &account(),
            [7; 32],
        )
        .unwrap();
        record
            .make_active(
                "acc_AAAAAAAAAAAAAAAAAAAAAA",
                "dev_BBBBBBBBBBBBBBBBBBBBBB",
                "key_CCCCCCCCCCCCCCCCCCCCCC",
            )
            .unwrap();
        record.mark_synced(123);
        let mut encoded = record.encode();
        let decoded = AccountCredential::decode(&encoded, &digest).unwrap();
        assert_eq!(decoded.state, AccountState::Active);
        assert_eq!(decoded.safe_display_label().unwrap(), "Codex account");
        let foreign = super::super::digest_origin(&Origin::parse("https://other.example").unwrap());
        assert_eq!(
            AccountCredential::decode(&encoded, &foreign).err(),
            Some(ConnectorCliError::SecureStorageInvalid)
        );
        encoded[READER_RANGE.end - 1] = 1;
        assert_eq!(
            AccountCredential::decode(&encoded, &digest).err(),
            Some(ConnectorCliError::SecureStorageInvalid)
        );
        let mut invalid_reader_length = record.encode();
        invalid_reader_length[READER_LENGTH_INDEX] = u8::MAX;
        assert_eq!(
            AccountCredential::decode(&invalid_reader_length, &digest).err(),
            Some(ConnectorCliError::SecureStorageInvalid)
        );
        let mut invalid_label_length = record.encode();
        invalid_label_length[LABEL_LENGTH_INDEX] = u8::MAX;
        assert_eq!(
            AccountCredential::decode(&invalid_label_length, &digest).err(),
            Some(ConnectorCliError::SecureStorageInvalid)
        );
    }

    #[test]
    fn invalid_installation_origin_length_fails_without_panicking() {
        let record = InstallationRecord::new(&origin()).unwrap();
        let mut encoded = record.encode();
        encoded[ORIGIN_LENGTH_RANGE].copy_from_slice(&u16::MAX.to_le_bytes());
        assert_eq!(
            InstallationRecord::decode(&encoded).err(),
            Some(ConnectorCliError::SecureStorageInvalid)
        );
    }
}
