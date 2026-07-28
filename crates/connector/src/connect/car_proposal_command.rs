//! One-shot signed `CarRecipe` proposal for an already connected device.

use std::io::Write;
use std::str;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;

use crate::car_proposal::{
    CAR_PROPOSAL_MEDIA_TYPE, CAR_PROPOSAL_NONCE_BYTES, CAR_PROPOSAL_REQUEST_TARGET,
    CandidateCarProposalV1Composer, CandidateCarProposalV1Signer, CarRecipeSelection,
    ReviewedCarProposalContext, ReviewedCarProposalSigningKey, SignedCarProposal,
};

use super::{
    ConnectorCliError, CredentialStore, Origin, REQUEST_ID_HEADER, RecordState, all_zero,
    digest_origin, new_http_agent, valid_json_content_type, valid_public_id,
};

const DEVICE_ID_HEADER: &str = "x-viberacing-device-id";
const DEVICE_TIMESTAMP_HEADER: &str = "x-viberacing-device-timestamp";
const DEVICE_NONCE_HEADER: &str = "x-viberacing-device-nonce";
const DEVICE_SIGNATURE_HEADER: &str = "x-viberacing-device-signature";
const MAX_RESPONSE_BYTES: u64 = 512;

pub(super) fn run_car_proposal(
    origin: &Origin,
    recipe: CarRecipeSelection,
    store: &mut dyn CredentialStore,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    let mut record = store
        .load(&digest_origin(origin))?
        .ok_or(ConnectorCliError::NotConnected)?;
    if record.state != RecordState::Active {
        return Err(ConnectorCliError::NotConnected);
    }
    let mut nonce = [0_u8; CAR_PROPOSAL_NONCE_BYTES];
    getrandom::fill(&mut nonce).map_err(|_| ConnectorCliError::EntropyUnavailable)?;
    if all_zero(&nonce) {
        return Err(ConnectorCliError::EntropyUnavailable);
    }
    let device_timestamp = format_utc_milliseconds(SystemTime::now())?;
    let device_id = str::from_utf8(&record.device_id)
        .map_err(|_| ConnectorCliError::SecureStorageInvalid)?
        .to_owned();
    let context =
        ReviewedCarProposalContext::from_active_device(device_id.clone(), nonce, device_timestamp);
    nonce.fill(0);
    let key = ReviewedCarProposalSigningKey::from_active_device(device_id, record.secret_key);
    let prepared = CandidateCarProposalV1Composer::compose(context, recipe)
        .map_err(|_| ConnectorCliError::ProposalPreparationUnavailable)?;
    let signed = CandidateCarProposalV1Signer::sign(key, prepared)
        .map_err(|_| ConnectorCliError::SecureStorageInvalid)?;
    record.clear();
    HttpCarProposalTransport::new(origin).send(&signed)?;
    writeln!(output, "Car proposal submitted. Review it in your account.")
        .map_err(|_| ConnectorCliError::OutputUnavailable)
}

fn format_utc_milliseconds(time: SystemTime) -> Result<String, ConnectorCliError> {
    let elapsed = time
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ConnectorCliError::ProposalPreparationUnavailable)?;
    let total_seconds = i64::try_from(elapsed.as_secs())
        .map_err(|_| ConnectorCliError::ProposalPreparationUnavailable)?;
    let days = total_seconds / 86_400;
    let seconds_of_day = total_seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    if !(2000..=2099).contains(&year) {
        return Err(ConnectorCliError::ProposalPreparationUnavailable);
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProposalResponse {
    schema_version: u8,
    request_id: String,
    outcome: ProposalOutcome,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum ProposalOutcome {
    Accepted,
}

struct HttpCarProposalTransport {
    agent: ureq::Agent,
    origin: String,
}

impl HttpCarProposalTransport {
    fn new(origin: &Origin) -> Self {
        Self {
            agent: new_http_agent(),
            origin: origin.value.clone(),
        }
    }

    fn send(&self, request: &SignedCarProposal) -> Result<(), ConnectorCliError> {
        let response = self
            .agent
            .post(format!("{}{CAR_PROPOSAL_REQUEST_TARGET}", self.origin))
            .content_type(CAR_PROPOSAL_MEDIA_TYPE)
            .header("accept", CAR_PROPOSAL_MEDIA_TYPE)
            .header(DEVICE_ID_HEADER, request.device_id())
            .header(DEVICE_TIMESTAMP_HEADER, request.device_timestamp())
            .header(DEVICE_NONCE_HEADER, request.device_nonce())
            .header(DEVICE_SIGNATURE_HEADER, request.device_signature())
            .send(request.body())
            .map_err(|error| match error {
                ureq::Error::Timeout(_)
                | ureq::Error::Io(_)
                | ureq::Error::HostNotFound
                | ureq::Error::ConnectionFailed => ConnectorCliError::ProposalUnavailable,
                _ => ConnectorCliError::InvalidProposalResponse,
            })?;
        let mut response = response;
        if response.status().as_u16() != 200 {
            return Err(ConnectorCliError::ProposalUnavailable);
        }
        if !valid_json_content_type(response.headers().get("content-type")) {
            return Err(ConnectorCliError::InvalidProposalResponse);
        }
        let request_id = response
            .headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .filter(|value| valid_public_id(value, "req_"))
            .ok_or(ConnectorCliError::InvalidProposalResponse)?
            .to_owned();
        let mut body = response
            .body_mut()
            .with_config()
            .limit(MAX_RESPONSE_BYTES + 1)
            .read_to_vec()
            .map_err(|_| ConnectorCliError::InvalidProposalResponse)?;
        if body.len() as u64 > MAX_RESPONSE_BYTES {
            body.fill(0);
            return Err(ConnectorCliError::InvalidProposalResponse);
        }
        let parsed = serde_json::from_slice::<ProposalResponse>(&body);
        body.fill(0);
        let parsed = parsed.map_err(|_| ConnectorCliError::InvalidProposalResponse)?;
        if parsed.schema_version != 1
            || parsed.request_id != request_id
            || parsed.outcome != ProposalOutcome::Accepted
        {
            return Err(ConnectorCliError::InvalidProposalResponse);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    use super::*;
    use crate::connect::CredentialRecord;

    const DEVICE_ID: &str = "dev_BBBBBBBBBBBBBBBBBBBBBB";
    const AGENT_ACCOUNT_ID: &str = "acc_AAAAAAAAAAAAAAAAAAAAAA";
    const REQUEST_ID: &str = "req_CCCCCCCCCCCCCCCCCCCCCC";

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
        .unwrap()
    }

    fn active_record(origin: &Origin) -> CredentialRecord {
        let mut record = CredentialRecord::new(digest_origin(origin)).unwrap();
        record.make_active(AGENT_ACCOUNT_ID, DEVICE_ID).unwrap();
        record
    }

    fn signed(origin: &Origin) -> SignedCarProposal {
        let record = active_record(origin);
        let context = ReviewedCarProposalContext::from_active_device(
            DEVICE_ID.to_owned(),
            [9; CAR_PROPOSAL_NONCE_BYTES],
            "2026-07-17T12:34:56.789Z".to_owned(),
        );
        let key = ReviewedCarProposalSigningKey::from_active_device(
            DEVICE_ID.to_owned(),
            record.secret_key,
        );
        CandidateCarProposalV1Signer::sign(
            key,
            CandidateCarProposalV1Composer::compose(context, recipe()).unwrap(),
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
            Some(ConnectorCliError::ProposalPreparationUnavailable)
        );
    }

    #[test]
    fn posts_one_exact_signed_request_and_validates_generic_acknowledgement() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = Origin::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let signed = signed(&origin);
        let expected_body = signed.body().to_vec();
        let expected_device = signed.device_id().to_owned();
        let expected_nonce = signed.device_nonce().to_owned();
        let expected_signature = signed.device_signature().to_owned();
        let expected_timestamp = signed.device_timestamp().to_owned();

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
                let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n")
                else {
                    continue;
                };
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
                if request.len() < header_end + content_length {
                    continue;
                }
                assert!(headers.starts_with("POST /v1/connector/cars/proposals HTTP/1.1\r\n"));
                assert_eq!(
                    header_value(headers, DEVICE_ID_HEADER),
                    Some(expected_device.as_str())
                );
                assert_eq!(
                    header_value(headers, DEVICE_NONCE_HEADER),
                    Some(expected_nonce.as_str())
                );
                assert_eq!(
                    header_value(headers, DEVICE_SIGNATURE_HEADER),
                    Some(expected_signature.as_str())
                );
                assert_eq!(
                    header_value(headers, DEVICE_TIMESTAMP_HEADER),
                    Some(expected_timestamp.as_str())
                );
                assert_eq!(
                    &request[header_end..header_end + content_length],
                    expected_body.as_slice()
                );
                assert!(!headers.to_ascii_lowercase().contains("idempotency-key"));
                break;
            }
            let body = format!(
                "{{\"schemaVersion\":1,\"requestId\":\"{REQUEST_ID}\",\"outcome\":\"accepted\"}}"
            );
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nx-request-id: {REQUEST_ID}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });

        HttpCarProposalTransport::new(&origin)
            .send(&signed)
            .unwrap();
        server.join().unwrap();
    }

    #[test]
    fn rejects_mismatched_or_widened_acknowledgements() {
        let request = ProposalResponse {
            schema_version: 1,
            request_id: REQUEST_ID.to_owned(),
            outcome: ProposalOutcome::Accepted,
        };
        assert_eq!(request.schema_version, 1);
        assert!(serde_json::from_str::<ProposalResponse>(
            "{\"schemaVersion\":1,\"requestId\":\"req_CCCCCCCCCCCCCCCCCCCCCC\",\"outcome\":\"accepted\",\"proposalId\":\"private\"}"
        )
        .is_err());
        assert!(serde_json::from_str::<ProposalResponse>(
            "{\"schemaVersion\":1,\"requestId\":\"req_CCCCCCCCCCCCCCCCCCCCCC\",\"outcome\":\"pending\"}"
        )
        .is_err());
    }
}
