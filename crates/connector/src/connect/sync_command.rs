//! One-shot collection, signing, and upload for an already connected device.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::str;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;

use crate::DailyUsage;
use crate::admission::{ADMITTED_CODEX_VERSION, admit_candidate_selection};
use crate::process::{
    CandidateCodex01445Collector, ReviewedCodexLaunch, current_allowed_environment,
};
use crate::sync::{
    COMMUNITY_SYNC_MEDIA_TYPE, COMMUNITY_SYNC_REQUEST_TARGET, CandidateCommunitySyncV1Composer,
    CandidateCommunitySyncV1Signer, DEVICE_NONCE_BYTES, ReviewedCommunitySyncContext,
    ReviewedDeviceSigningKey, SignedCommunitySync, encode_base64url,
};

use super::{
    ConnectorCliError, CredentialRecord, CredentialStore, Origin, REQUEST_ID_HEADER, RecordState,
    all_zero, digest_origin, map_admission_error, new_http_agent, valid_json_content_type,
    valid_public_id,
};

const DEVICE_ID_HEADER: &str = "x-viberacing-device-id";
const DEVICE_TIMESTAMP_HEADER: &str = "x-viberacing-device-timestamp";
const DEVICE_NONCE_HEADER: &str = "x-viberacing-device-nonce";
const DEVICE_SIGNATURE_HEADER: &str = "x-viberacing-device-signature";
const IDEMPOTENCY_KEY_HEADER: &str = "idempotency-key";
const MAX_SYNC_RESPONSE_BYTES: u64 = 1024;
const TEMP_DIRECTORY_ATTEMPTS: usize = 4;

pub(super) fn run_sync(
    origin: &Origin,
    codex_path: Option<&Path>,
    store: &mut dyn CredentialStore,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    let mut record = store
        .load(&digest_origin(origin))?
        .ok_or(ConnectorCliError::NotConnected)?;
    if record.state != RecordState::Active {
        return Err(ConnectorCliError::NotConnected);
    }

    let admitted = admit_candidate_selection(codex_path).map_err(map_admission_error)?;
    writeln!(output, "Using admitted Codex {ADMITTED_CODEX_VERSION}.")
        .map_err(|_| ConnectorCliError::OutputUnavailable)?;

    let working_directory = EmptyWorkingDirectory::create()?;
    let (executable, artifact_guard) = admitted.into_parts();
    let launch = ReviewedCodexLaunch::from_admitted(
        executable,
        working_directory.path().to_owned(),
        current_allowed_environment(),
        artifact_guard,
    );
    let collection = CandidateCodex01445Collector::collect(launch);
    working_directory.cleanup()?;
    let daily_usage = collection.map_err(|_| ConnectorCliError::CodexUnavailable)?;
    if daily_usage.is_empty() {
        return Err(ConnectorCliError::NoUsage);
    }

    let submitted_entries = daily_usage.len();
    let signed = prepare_fresh_sync(&record, daily_usage)?;
    let result = HttpSyncTransport::new(origin).send(&signed, submitted_entries)?;
    record.clear();
    match result {
        SyncOutcome::Accepted => write_line(output, "Usage synced."),
        SyncOutcome::Duplicate => write_line(output, "Usage was already synced."),
        SyncOutcome::Quarantined => write_line(output, "Usage received for review."),
    }
}

fn prepare_fresh_sync(
    record: &CredentialRecord,
    daily_usage: DailyUsage,
) -> Result<SignedCommunitySync, ConnectorCliError> {
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
    record: &CredentialRecord,
    daily_usage: DailyUsage,
    observed_at: String,
    sync_random: [u8; 16],
    device_nonce: [u8; DEVICE_NONCE_BYTES],
) -> Result<SignedCommunitySync, ConnectorCliError> {
    if record.state != RecordState::Active || daily_usage.is_empty() {
        return Err(if daily_usage.is_empty() {
            ConnectorCliError::NoUsage
        } else {
            ConnectorCliError::NotConnected
        });
    }
    let source_id = str::from_utf8(&record.source_id)
        .map_err(|_| ConnectorCliError::SecureStorageInvalid)?
        .to_owned();
    let device_id = str::from_utf8(&record.device_id)
        .map_err(|_| ConnectorCliError::SecureStorageInvalid)?
        .to_owned();
    let sync_id = format!("syn_{}", encode_base64url(&sync_random));
    let context = ReviewedCommunitySyncContext::from_active_device(
        source_id,
        sync_id,
        observed_at,
        device_id.clone(),
        device_nonce,
    );
    let key = ReviewedDeviceSigningKey::from_active_device(device_id, record.secret_key);
    let prepared = CandidateCommunitySyncV1Composer::compose(context, daily_usage)
        .map_err(|_| ConnectorCliError::SyncPreparationUnavailable)?;
    CandidateCommunitySyncV1Signer::sign(key, prepared)
        .map_err(|_| ConnectorCliError::SecureStorageInvalid)
}

fn format_utc_milliseconds(time: SystemTime) -> Result<String, ConnectorCliError> {
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

struct EmptyWorkingDirectory {
    path: Option<PathBuf>,
}

impl EmptyWorkingDirectory {
    fn create() -> Result<Self, ConnectorCliError> {
        for _ in 0..TEMP_DIRECTORY_ATTEMPTS {
            let mut random = [0_u8; 16];
            getrandom::fill(&mut random).map_err(|_| ConnectorCliError::EntropyUnavailable)?;
            let path =
                std::env::temp_dir().join(format!("viberacing-sync-{}", encode_base64url(&random)));
            random.fill(0);
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self { path: Some(path) }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(ConnectorCliError::SyncPreparationUnavailable),
            }
        }
        Err(ConnectorCliError::SyncPreparationUnavailable)
    }

    fn path(&self) -> &Path {
        self.path.as_deref().expect("working directory must exist")
    }

    fn cleanup(mut self) -> Result<(), ConnectorCliError> {
        let path = self.path.take().expect("working directory must exist");
        fs::remove_dir(path).map_err(|_| ConnectorCliError::CodexUnavailable)
    }
}

impl Drop for EmptyWorkingDirectory {
    fn drop(&mut self) {
        if let Some(path) = self.path.take() {
            let _ = fs::remove_dir(path);
        }
    }
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
        request: &SignedCommunitySync,
        submitted_entries: usize,
    ) -> Result<SyncOutcome, ConnectorCliError> {
        let response = self
            .agent
            .post(format!("{}{COMMUNITY_SYNC_REQUEST_TARGET}", self.origin))
            .content_type(COMMUNITY_SYNC_MEDIA_TYPE)
            .header("accept", COMMUNITY_SYNC_MEDIA_TYPE)
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
    request: &SignedCommunitySync,
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
    {
        return Err(ConnectorCliError::InvalidSyncResponse);
    }
    Ok(response.outcome)
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

    use crate::ConnectorHandshake;

    use super::*;

    const INITIALIZE_RESPONSE: &[u8] = b"{\"id\":0,\"result\":{\"codexHome\":\"/synthetic/codex-home\",\"platformFamily\":\"unix\",\"platformOs\":\"linux\",\"userAgent\":\"codex-cli/0.144.5\"}}\n";
    const ACCOUNT_RESPONSE: &[u8] =
        include_bytes!("../../../../compat/codex/0.144.5/fixtures/account-chatgpt.jsonl");
    const USAGE_RESPONSE: &[u8] =
        include_bytes!("../../../../compat/codex/0.144.5/fixtures/usage-daily.jsonl");
    const SOURCE_ID: &str = "src_AAAAAAAAAAAAAAAAAAAAAA";
    const DEVICE_ID: &str = "dev_BBBBBBBBBBBBBBBBBBBBBB";
    const REQUEST_ID: &str = "req_CCCCCCCCCCCCCCCCCCCCCC";

    fn daily_usage() -> DailyUsage {
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
        adapter.accept_usage_read_response(USAGE_RESPONSE).unwrap()
    }

    fn active_record(origin: &Origin) -> CredentialRecord {
        let mut record = CredentialRecord::new(digest_origin(origin)).unwrap();
        record.make_active(SOURCE_ID, DEVICE_ID).unwrap();
        record
    }

    fn signed_request(origin: &Origin) -> SignedCommunitySync {
        prepare_sync(
            &active_record(origin),
            daily_usage(),
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
    fn prepares_one_exact_source_bound_request_from_the_active_record() {
        let origin = Origin::parse("https://race.example").unwrap();
        let signed = signed_request(&origin);
        let body = str::from_utf8(signed.body()).unwrap();
        assert!(body.contains(SOURCE_ID));
        assert!(body.contains("\"codexVersion\":\"0.144.5\""));
        assert_eq!(signed.device_id(), DEVICE_ID);
        assert!(valid_public_id(signed.idempotency_key(), "syn_"));
        assert_eq!(signed.device_nonce().len(), 22);
        assert_eq!(signed.device_signature().len(), 86);
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
                        assert!(headers.starts_with("POST /v1/community/sync HTTP/1.1\r\n"));
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
        };

        assert_eq!(
            validate_sync_response(&signed, REQUEST_ID, &response, 2).err(),
            Some(ConnectorCliError::InvalidSyncResponse)
        );
    }

    struct EmptyStore;

    impl CredentialStore for EmptyStore {
        fn load(
            &mut self,
            _expected_origin: &[u8; 32],
        ) -> Result<Option<CredentialRecord>, ConnectorCliError> {
            Ok(None)
        }

        fn save(&mut self, _record: &CredentialRecord) -> Result<(), ConnectorCliError> {
            unreachable!("sync never creates a credential")
        }

        fn delete(&mut self) -> Result<(), ConnectorCliError> {
            unreachable!("sync never deletes a credential")
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
