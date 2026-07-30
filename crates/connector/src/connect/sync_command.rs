//! One-shot collection, signing, and upload for an already connected device.

use std::io::Write;
use std::path::Path;
use std::str;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;

use crate::CanonicalDailyUsage;
use crate::codex_reader::CODEX_APP_SERVER_0_144_5_READER_VERSION;
use crate::reader::AgentProvider;
use crate::sync::{
    DEVICE_NONCE_BYTES, ReviewedDeviceSigningKey, ReviewedUsageSyncContext, SignedUsageSync,
    USAGE_SYNC_MEDIA_TYPE, USAGE_SYNC_REQUEST_TARGET, UsageSyncV1Composer, UsageSyncV1Signer,
    encode_base64url,
};

use super::discovery::{admitted_codex_version, collect_codex_account};
use super::{
    AccountCredential, AccountState, ConnectCompletion, ConnectorCliError, CredentialStore,
    InstallationState, Origin, REQUEST_ID_HEADER, all_zero, digest_origin, new_http_agent,
    now_epoch_seconds, valid_json_content_type, valid_public_id,
};

const DEVICE_ID_HEADER: &str = "x-viberacing-device-id";
const DEVICE_TIMESTAMP_HEADER: &str = "x-viberacing-device-timestamp";
const DEVICE_NONCE_HEADER: &str = "x-viberacing-device-nonce";
const DEVICE_SIGNATURE_HEADER: &str = "x-viberacing-device-signature";
const IDEMPOTENCY_KEY_HEADER: &str = "idempotency-key";
const MAX_SYNC_RESPONSE_BYTES: u64 = 1024;
pub(super) fn run_sync(
    origin: &Origin,
    codex_path: Option<&Path>,
    store: &mut dyn CredentialStore,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    run_sync_selection(origin, codex_path, store, None, output)
}

pub(super) fn run_sync_slot(
    origin: &Origin,
    slot: usize,
    store: &mut dyn CredentialStore,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    run_sync_selection(origin, None, store, Some(slot), output)
}

fn run_sync_selection(
    origin: &Origin,
    codex_path: Option<&Path>,
    store: &mut dyn CredentialStore,
    selected_slot: Option<usize>,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    let installation = store
        .load_installation()?
        .ok_or(ConnectorCliError::NotConnected)?;
    if installation.state != InstallationState::Active
        || installation.origin()?.value != origin.value
    {
        return Err(ConnectorCliError::NotConnected);
    }

    writeln!(output, "Using admitted Codex {}.", admitted_codex_version())
        .map_err(|_| ConnectorCliError::OutputUnavailable)?;
    let discovered = collect_codex_account(codex_path)?;
    let active_slots = installation.active_slots().collect::<Vec<_>>();
    let mut matching_slots = Vec::new();
    for slot in &active_slots {
        let record = store
            .load_account(*slot, &installation.origin_digest)?
            .ok_or(ConnectorCliError::SecureStorageInvalid)?;
        if record.state != AccountState::Active {
            return Err(ConnectorCliError::SecureStorageInvalid);
        }
        if account_matches_discovery(&record, &discovered)? {
            matching_slots.push(*slot);
        }
    }
    let selected_slots = resolve_sync_slots(&active_slots, &matching_slots, selected_slot)?;
    let mut synced = 0_usize;
    for slot in selected_slots {
        let mut record = store
            .load_account(slot, &installation.origin_digest)?
            .ok_or(ConnectorCliError::SecureStorageInvalid)?;
        if record.state != AccountState::Active
            || record.provider() != AgentProvider::Codex
            || record.reader_version()? != CODEX_APP_SERVER_0_144_5_READER_VERSION
        {
            return Err(ConnectorCliError::SecureStorageInvalid);
        }
        let result = submit_account_usage(origin, &record, &discovered.daily_usage)?;
        record.mark_synced(now_epoch_seconds()?);
        store.save_account(slot, &record)?;
        write_sync_outcome(output, result)?;
        synced += 1;
    }
    if synced == 0 {
        Err(ConnectorCliError::NotConnected)
    } else {
        Ok(())
    }
}

fn account_matches_discovery(
    record: &AccountCredential,
    discovered: &super::DiscoveredAccount,
) -> Result<bool, ConnectorCliError> {
    Ok(record.provider() == discovered.provider
        && record.reader_version()? == discovered.reader_version
        && record.accounting_revision == discovered.accounting_revision
        && record.scope_kind() == discovered.scope_kind
        && record.safe_display_label()? == discovered.safe_display_label)
}

fn resolve_sync_slots(
    active_slots: &[usize],
    matching_slots: &[usize],
    selected_slot: Option<usize>,
) -> Result<Vec<usize>, ConnectorCliError> {
    if active_slots.is_empty() {
        return Err(ConnectorCliError::NotConnected);
    }
    if let Some(selected) = selected_slot {
        if !active_slots.contains(&selected) {
            return Err(ConnectorCliError::InvalidAccountSelector);
        }
        if matching_slots != [selected] {
            return Err(ConnectorCliError::AccountMappingUnavailable);
        }
        return Ok(vec![selected]);
    }
    if active_slots != matching_slots || matching_slots.len() != 1 {
        return Err(ConnectorCliError::AccountMappingUnavailable);
    }
    Ok(matching_slots.to_vec())
}

pub(super) fn run_first_sync(
    origin: &Origin,
    store: &mut dyn CredentialStore,
    completion: &ConnectCompletion,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    for slot in &completion.active_slots {
        let usage = completion
            .discovered_accounts
            .get(*slot)
            .ok_or(ConnectorCliError::CodexUnavailable)?;
        let mut record = store
            .load_account(*slot, &digest_origin(origin))?
            .ok_or(ConnectorCliError::SecureStorageInvalid)?;
        let result = submit_account_usage(origin, &record, &usage.daily_usage)?;
        record.mark_synced(now_epoch_seconds()?);
        store.save_account(*slot, &record)?;
        write_sync_outcome(output, result)?;
    }
    Ok(())
}

fn submit_account_usage(
    origin: &Origin,
    record: &AccountCredential,
    daily_usage: &CanonicalDailyUsage,
) -> Result<SyncOutcome, ConnectorCliError> {
    let submitted_entries = daily_usage.len();
    let signed = prepare_fresh_sync(record, daily_usage)?;
    HttpSyncTransport::new(origin).send(&signed, submitted_entries)
}

fn write_sync_outcome(
    output: &mut dyn Write,
    result: SyncOutcome,
) -> Result<(), ConnectorCliError> {
    match result {
        SyncOutcome::Accepted => write_line(output, "Usage synced."),
        SyncOutcome::Duplicate => write_line(output, "Usage was already synced."),
        SyncOutcome::Quarantined => write_line(output, "Usage received for review."),
    }
}

fn prepare_fresh_sync(
    record: &AccountCredential,
    daily_usage: &CanonicalDailyUsage,
) -> Result<SignedUsageSync, ConnectorCliError> {
    let mut sync_random = [0_u8; 16];
    let mut device_nonce = [0_u8; DEVICE_NONCE_BYTES];
    getrandom::fill(&mut sync_random).map_err(|_| ConnectorCliError::EntropyUnavailable)?;
    getrandom::fill(&mut device_nonce).map_err(|_| ConnectorCliError::EntropyUnavailable)?;
    if all_zero(&sync_random) || all_zero(&device_nonce) {
        sync_random.fill(0);
        device_nonce.fill(0);
        return Err(ConnectorCliError::EntropyUnavailable);
    }
    let observed_at = format_utc_milliseconds(SystemTime::now())?;
    let result = prepare_sync(record, daily_usage, observed_at, sync_random, device_nonce);
    sync_random.fill(0);
    device_nonce.fill(0);
    result
}

fn prepare_sync(
    record: &AccountCredential,
    daily_usage: &CanonicalDailyUsage,
    observed_at: String,
    sync_random: [u8; 16],
    device_nonce: [u8; DEVICE_NONCE_BYTES],
) -> Result<SignedUsageSync, ConnectorCliError> {
    if record.state != AccountState::Active || daily_usage.is_empty() {
        return Err(if daily_usage.is_empty() {
            ConnectorCliError::NoUsage
        } else {
            ConnectorCliError::NotConnected
        });
    }
    let agent_account_id = str::from_utf8(&record.agent_account_id)
        .map_err(|_| ConnectorCliError::SecureStorageInvalid)?
        .to_owned();
    let device_id = str::from_utf8(&record.device_id)
        .map_err(|_| ConnectorCliError::SecureStorageInvalid)?
        .to_owned();
    let sync_id = format!("syn_{}", encode_base64url(&sync_random));
    let context = ReviewedUsageSyncContext::from_active_account(
        agent_account_id,
        record.reader_version()?.to_owned(),
        sync_id,
        observed_at,
        device_id.clone(),
        device_nonce,
    );
    let key = ReviewedDeviceSigningKey::from_active_device(device_id, record.secret_key);
    let prepared = UsageSyncV1Composer::compose(context, daily_usage)
        .map_err(|_| ConnectorCliError::SyncPreparationUnavailable)?;
    UsageSyncV1Signer::sign(key, prepared).map_err(|_| ConnectorCliError::SecureStorageInvalid)
}

pub(super) fn format_utc_milliseconds(time: SystemTime) -> Result<String, ConnectorCliError> {
    let elapsed = time
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ConnectorCliError::SyncPreparationUnavailable)?;
    let total_seconds = i64::try_from(elapsed.as_secs())
        .map_err(|_| ConnectorCliError::SyncPreparationUnavailable)?;
    let days = total_seconds / 86_400;
    let seconds_of_day = total_seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    if !(2000..=2099).contains(&year) {
        return Err(ConnectorCliError::SyncPreparationUnavailable);
    }
    let hour = seconds_of_day / 3600;
    let minute = (seconds_of_day % 3600) / 60;
    let second = seconds_of_day % 60;
    Ok(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{:03}Z",
        elapsed.subsec_millis()
    ))
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i64, i64, i64) {
    let shifted = days_since_unix_epoch + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum SyncOutcome {
    Accepted,
    Duplicate,
    Quarantined,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SyncResponse {
    schema_version: u8,
    request_id: String,
    sync_id: String,
    outcome: SyncOutcome,
    accepted_entries: u8,
    next_allowed_sync_at: Option<String>,
    #[serde(rename = "recoveryAction")]
    _recovery_action: Option<RecoveryAction>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum RecoveryAction {
    UpdateConnector,
    ReconnectAccount,
    ContactSupport,
    RetryLater,
}

struct HttpSyncTransport {
    agent: ureq::Agent,
    origin: String,
}

impl HttpSyncTransport {
    fn new(origin: &Origin) -> Self {
        Self {
            agent: new_http_agent(),
            origin: origin.value.clone(),
        }
    }

    fn send(
        &self,
        request: &SignedUsageSync,
        submitted_entries: usize,
    ) -> Result<SyncOutcome, ConnectorCliError> {
        let response = self
            .agent
            .post(format!("{}{USAGE_SYNC_REQUEST_TARGET}", self.origin))
            .content_type(USAGE_SYNC_MEDIA_TYPE)
            .header("accept", USAGE_SYNC_MEDIA_TYPE)
            .header(DEVICE_ID_HEADER, request.device_id())
            .header(DEVICE_TIMESTAMP_HEADER, request.device_timestamp())
            .header(DEVICE_NONCE_HEADER, request.device_nonce())
            .header(DEVICE_SIGNATURE_HEADER, request.device_signature())
            .header(IDEMPOTENCY_KEY_HEADER, request.idempotency_key())
            .send(request.body())
            .map_err(|error| match error {
                ureq::Error::Timeout(_)
                | ureq::Error::Io(_)
                | ureq::Error::HostNotFound
                | ureq::Error::ConnectionFailed => ConnectorCliError::SyncUnavailable,
                _ => ConnectorCliError::InvalidSyncResponse,
            })?;
        let mut response = response;
        let status = response.status().as_u16();
        if matches!(status, 429 | 500..=599) {
            return Err(ConnectorCliError::SyncUnavailable);
        }
        if status != 200 {
            return Err(ConnectorCliError::SyncUnavailable);
        }
        if !valid_json_content_type(response.headers().get("content-type")) {
            return Err(ConnectorCliError::InvalidSyncResponse);
        }
        let request_id = response
            .headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .filter(|value| valid_public_id(value, "req_"))
            .ok_or(ConnectorCliError::InvalidSyncResponse)?
            .to_owned();
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_SYNC_RESPONSE_BYTES + 1)
            .read_to_vec()
            .map_err(|_| ConnectorCliError::InvalidSyncResponse)?;
        if body.len() as u64 > MAX_SYNC_RESPONSE_BYTES {
            return Err(ConnectorCliError::InvalidSyncResponse);
        }
        let response: SyncResponse =
            serde_json::from_slice(&body).map_err(|_| ConnectorCliError::InvalidSyncResponse)?;
        validate_sync_response(request, &request_id, &response, submitted_entries)
    }
}

fn validate_sync_response(
    request: &SignedUsageSync,
    header_request_id: &str,
    response: &SyncResponse,
    submitted_entries: usize,
) -> Result<SyncOutcome, ConnectorCliError> {
    if response.schema_version != 1
        || response.request_id != header_request_id
        || !valid_public_id(&response.request_id, "req_")
        || response.sync_id != request.idempotency_key()
        || !valid_public_id(&response.sync_id, "syn_")
        || usize::from(response.accepted_entries) > submitted_entries
        || response
            .next_allowed_sync_at
            .as_deref()
            .is_some_and(|value| !valid_utc_minute_timestamp(value))
    {
        return Err(ConnectorCliError::InvalidSyncResponse);
    }
    Ok(response.outcome)
}

fn valid_utc_minute_timestamp(value: &str) -> bool {
    value.len() == 24
        && value.ends_with(":00.000Z")
        && super::valid_utc_millisecond_timestamp(value)
}

fn write_line(output: &mut dyn Write, value: &str) -> Result<(), ConnectorCliError> {
    writeln!(output, "{value}").map_err(|_| ConnectorCliError::OutputUnavailable)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    use crate::{AgentUsageReader, CodexAppServer01445Reader, ConnectorHandshake, UtcUsageWindow};

    use super::super::credentials::InstallationRecord;
    use super::super::discovery::DiscoveredAccount;
    use super::*;

    const INITIALIZE_RESPONSE: &[u8] = b"{\"id\":0,\"result\":{\"codexHome\":\"/synthetic/codex-home\",\"platformFamily\":\"unix\",\"platformOs\":\"linux\",\"userAgent\":\"codex-cli/0.144.5\"}}\n";
    const ACCOUNT_RESPONSE: &[u8] =
        include_bytes!("../../../../compat/codex/0.144.5/fixtures/account-chatgpt.jsonl");
    const USAGE_RESPONSE: &[u8] =
        include_bytes!("../../../../compat/codex/0.144.5/fixtures/usage-daily.jsonl");
    const AGENT_ACCOUNT_ID: &str = "acc_AAAAAAAAAAAAAAAAAAAAAA";
    const DEVICE_ID: &str = "dev_BBBBBBBBBBBBBBBBBBBBBB";
    const DEVICE_KEY_ID: &str = "key_DDDDDDDDDDDDDDDDDDDDDD";
    const CANDIDATE_ID: &str = "cand_EEEEEEEEEEEEEEEEEEEEEE";
    const REQUEST_ID: &str = "req_CCCCCCCCCCCCCCCCCCCCCC";

    fn daily_usage() -> CanonicalDailyUsage {
        let mut handshake = ConnectorHandshake::new();
        handshake.start().unwrap();
        handshake
            .accept_initialize_response(INITIALIZE_RESPONSE)
            .unwrap();
        let mut adapter = handshake.into_codex_0_144_5_account_usage().unwrap();
        adapter.start_account_read().unwrap();
        adapter
            .accept_account_read_response(ACCOUNT_RESPONSE)
            .unwrap();
        adapter.start_usage_read().unwrap();
        let provider_usage = adapter.accept_usage_read_response(USAGE_RESPONSE).unwrap();
        let reader = CodexAppServer01445Reader::from_collected(provider_usage);
        let candidate = reader.discover_accounts().unwrap().pop().unwrap();
        reader
            .read_daily_usage(
                candidate.handle(),
                &UtcUsageWindow::new("2026-07-13".to_owned(), "2026-07-14".to_owned()).unwrap(),
            )
            .unwrap()
    }

    fn active_record(origin: &Origin) -> AccountCredential {
        let account = DiscoveredAccount {
            provider: AgentProvider::Codex,
            reader_version: CODEX_APP_SERVER_0_144_5_READER_VERSION,
            accounting_revision: 1,
            scope_kind: crate::reader::AccountingScope::AgentAccount,
            fingerprint_kind: crate::reader::FingerprintKind::Unavailable,
            account_fingerprint_digest: None,
            safe_display_label: "Codex account".to_owned(),
            status: crate::reader::ReaderStatus::Ready,
            daily_usage: daily_usage(),
        };
        let mut record =
            AccountCredential::new_pending(digest_origin(origin), CANDIDATE_ID, &account, [7; 32])
                .unwrap();
        record
            .make_active(AGENT_ACCOUNT_ID, DEVICE_ID, DEVICE_KEY_ID)
            .unwrap();
        record
    }

    fn signed_request(origin: &Origin) -> SignedUsageSync {
        prepare_sync(
            &active_record(origin),
            &daily_usage(),
            "2026-07-17T12:34:56.789Z".to_owned(),
            [7; 16],
            [9; DEVICE_NONCE_BYTES],
        )
        .unwrap()
    }

    fn header_value<'a>(headers: &'a str, expected_name: &str) -> Option<&'a str> {
        headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case(expected_name)
                .then_some(value.trim())
        })
    }

    #[test]
    fn formats_exact_utc_milliseconds_across_a_leap_day() {
        let time = UNIX_EPOCH + Duration::from_secs(951_827_696) + Duration::from_millis(789);
        assert_eq!(
            format_utc_milliseconds(time).unwrap(),
            "2000-02-29T12:34:56.789Z"
        );
        assert_eq!(
            format_utc_milliseconds(UNIX_EPOCH + Duration::from_secs(946_684_799)).err(),
            Some(ConnectorCliError::SyncPreparationUnavailable)
        );
        assert_eq!(
            format_utc_milliseconds(UNIX_EPOCH + Duration::from_secs(4_102_444_800)).err(),
            Some(ConnectorCliError::SyncPreparationUnavailable)
        );
    }

    #[test]
    fn prepares_one_exact_account_bound_request_from_the_active_record() {
        let origin = Origin::parse("https://race.example").unwrap();
        let signed = signed_request(&origin);
        let body = str::from_utf8(signed.body()).unwrap();
        assert!(body.contains(AGENT_ACCOUNT_ID));
        assert!(body.contains("\"readerVersion\":\"codex_app_server_0_144_5_v1\""));
        assert!(!body.contains("sourceId"));
        assert!(!body.contains("provider"));
        assert_eq!(signed.device_id(), DEVICE_ID);
        assert!(valid_public_id(signed.idempotency_key(), "syn_"));
        assert_eq!(signed.device_nonce().len(), 22);
        assert_eq!(signed.device_signature().len(), 86);
    }

    #[test]
    fn account_mapping_fails_closed_for_duplicate_or_unmatched_local_accounts() {
        assert_eq!(
            resolve_sync_slots(&[0, 1], &[0, 1], None).err(),
            Some(ConnectorCliError::AccountMappingUnavailable)
        );
        assert_eq!(
            resolve_sync_slots(&[0, 1], &[0, 1], Some(0)).err(),
            Some(ConnectorCliError::AccountMappingUnavailable)
        );
        assert_eq!(resolve_sync_slots(&[0, 1], &[0], Some(0)).unwrap(), vec![0]);
        assert_eq!(
            resolve_sync_slots(&[0], &[], Some(0)).err(),
            Some(ConnectorCliError::AccountMappingUnavailable)
        );
        assert_eq!(
            resolve_sync_slots(&[0], &[0], Some(1)).err(),
            Some(ConnectorCliError::InvalidAccountSelector)
        );
    }

    #[test]
    fn posts_only_the_exact_signed_request_and_validates_the_acknowledgement() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let origin = Origin::parse(&format!("http://{address}")).unwrap();
        let signed = signed_request(&origin);
        let expected_body = signed.body().to_vec();
        let expected_device = signed.device_id().to_owned();
        let expected_nonce = signed.device_nonce().to_owned();
        let expected_timestamp = signed.device_timestamp().to_owned();
        let expected_signature = signed.device_signature().to_owned();
        let expected_sync = signed.idempotency_key().to_owned();
        let response_sync = expected_sync.clone();

        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                assert!(count > 0);
                request.extend_from_slice(&buffer[..count]);
                assert!(request.len() <= 32 * 1024);
                if let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    let header_end = header_end + 4;
                    let headers = str::from_utf8(&request[..header_end]).unwrap();
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.strip_prefix("Content-Length: ")
                                .or_else(|| line.strip_prefix("content-length: "))
                        })
                        .unwrap()
                        .trim()
                        .parse::<usize>()
                        .unwrap();
                    if request.len() >= header_end + content_length {
                        assert!(headers.starts_with("POST /v1/usage HTTP/1.1\r\n"));
                        assert_eq!(
                            header_value(headers, DEVICE_ID_HEADER),
                            Some(expected_device.as_str())
                        );
                        assert_eq!(
                            header_value(headers, DEVICE_NONCE_HEADER),
                            Some(expected_nonce.as_str())
                        );
                        assert_eq!(
                            header_value(headers, DEVICE_TIMESTAMP_HEADER),
                            Some(expected_timestamp.as_str())
                        );
                        assert_eq!(
                            header_value(headers, DEVICE_SIGNATURE_HEADER),
                            Some(expected_signature.as_str())
                        );
                        assert_eq!(
                            header_value(headers, IDEMPOTENCY_KEY_HEADER),
                            Some(expected_sync.as_str())
                        );
                        assert!(
                            !headers
                                .to_ascii_lowercase()
                                .contains("x-viberacing-origin-")
                        );
                        assert_eq!(
                            &request[header_end..header_end + content_length],
                            expected_body.as_slice()
                        );
                        break;
                    }
                }
            }
            let body = format!(
                "{{\"schemaVersion\":1,\"requestId\":\"{REQUEST_ID}\",\"syncId\":\"{response_sync}\",\"outcome\":\"accepted\",\"acceptedEntries\":2}}"
            );
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nx-request-id: {REQUEST_ID}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            stream.flush().unwrap();
        });

        assert!(matches!(
            HttpSyncTransport::new(&origin).send(&signed, 2),
            Ok(SyncOutcome::Accepted)
        ));
        server.join().unwrap();
    }

    #[test]
    fn rejects_an_acknowledgement_that_accepts_more_entries_than_were_sent() {
        let origin = Origin::parse("https://race.example").unwrap();
        let signed = signed_request(&origin);
        let response = SyncResponse {
            schema_version: 1,
            request_id: REQUEST_ID.to_owned(),
            sync_id: signed.idempotency_key().to_owned(),
            outcome: SyncOutcome::Accepted,
            accepted_entries: 3,
            next_allowed_sync_at: None,
            _recovery_action: None,
        };

        assert_eq!(
            validate_sync_response(&signed, REQUEST_ID, &response, 2).err(),
            Some(ConnectorCliError::InvalidSyncResponse)
        );
    }

    struct EmptyStore;

    impl CredentialStore for EmptyStore {
        fn load_installation(&mut self) -> Result<Option<InstallationRecord>, ConnectorCliError> {
            Ok(None)
        }

        fn save_installation(
            &mut self,
            _record: &InstallationRecord,
        ) -> Result<(), ConnectorCliError> {
            unreachable!("sync never creates an installation")
        }

        fn load_account(
            &mut self,
            _slot: usize,
            _expected_origin: &[u8; 32],
        ) -> Result<Option<AccountCredential>, ConnectorCliError> {
            Ok(None)
        }

        fn save_account(
            &mut self,
            _slot: usize,
            _record: &AccountCredential,
        ) -> Result<(), ConnectorCliError> {
            unreachable!("sync never creates an account")
        }

        fn delete_account(&mut self, _slot: usize) -> Result<(), ConnectorCliError> {
            unreachable!("sync never deletes a credential")
        }

        fn delete_all(&mut self) -> Result<(), ConnectorCliError> {
            unreachable!("sync never deletes all credentials")
        }
    }

    #[test]
    fn refuses_to_collect_or_upload_before_the_device_is_connected() {
        let origin = Origin::parse("https://race.example").unwrap();
        for codex_path in [None, Some(Path::new("not-an-admitted-path"))] {
            let mut output = Vec::new();
            assert_eq!(
                run_sync(&origin, codex_path, &mut EmptyStore, &mut output).err(),
                Some(ConnectorCliError::NotConnected)
            );
            assert!(output.is_empty());
        }
    }
}
