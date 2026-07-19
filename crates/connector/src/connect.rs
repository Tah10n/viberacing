//! Bounded connector pairing command with operating-system credential storage.

use std::ffi::OsString;
use std::fmt;
use std::io::{self, Write};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::str;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ed25519_dalek::SECRET_KEY_LENGTH;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ureq::Agent;
use ureq::http::Uri;
use ureq::tls::{RootCerts, TlsConfig};

use crate::admission::{ADMITTED_CODEX_VERSION, AdmissionError, admit_candidate_selection};
use crate::car_proposal::CarRecipeSelection;
use crate::pairing::{
    CandidatePairingPossessionV1Signer, PAIRING_CHALLENGE_BYTES, PendingDevicePairingSigningKey,
    ReviewedPairingChallenge, valid_pairing_id,
};
use crate::sync::encode_base64url;

mod car_proposal_command;
mod sync_command;

const START_PATH: &str = "/v1/connector/pairing/start";
const POLL_PATH: &str = "/v1/connector/pairing/poll";
const CONNECT_PATH: &str = "/connect";
const JSON_MEDIA_TYPE: &str = "application/json";
const CLIENT_ID_HEADER: &str = "x-viberacing-client-id";
const REQUEST_ID_HEADER: &str = "x-request-id";
const KEYRING_SERVICE: &str = "viberacing.connector.pairing.v1";
const KEYRING_ACCOUNT_PREFIX: &str = "device-";
const ACCOUNT_DOMAIN: &[u8] = b"viberacing-connector-keyring-account-v1\0";
const ORIGIN_DOMAIN: &[u8] = b"viberacing-connector-origin-v1\0";
const USAGE: &str = "Usage:\n  viberacing-connector connect --origin <https-origin> --label <device-label>\n  viberacing-connector forget-local --origin <https-origin> --label <device-label>\n  viberacing-connector check-codex [--codex <absolute-path>] [--diagnostic-preview]\n  viberacing-connector sync --origin <https-origin> --label <device-label> [--codex <absolute-path>]\n  viberacing-connector propose-car --origin <https-origin> --label <device-label> --chassis <formula|rally|roadster> --nose <classic|scoop|wedge> --cockpit <canopy|open|rally> --wing <high|low|none> --wheels <all-terrain|slick|street> --palette <magenta|mint|redline|sunburst|turbo-blue> --trail <grid|none|spark> --seed <0..65535>";
const MAX_ORIGIN_BYTES: usize = 512;
const MAX_LABEL_CHARACTERS: usize = 64;
const MAX_REQUEST_BYTES: usize = 1024;
const MAX_RESPONSE_BYTES: u64 = 2048;
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const PAIRING_LIFETIME_SECONDS: u64 = 8 * 60;
const MAX_POLL_ATTEMPTS: usize = 240;

const RECORD_MAGIC: &[u8; 8] = b"VBRPAIR1";
const RECORD_VERSION: u8 = 1;
const MAGIC_RANGE: std::ops::Range<usize> = 0..8;
const VERSION_INDEX: usize = 8;
const STATE_INDEX: usize = 9;
const ORIGIN_RANGE: std::ops::Range<usize> = 10..42;
const CLIENT_ID_RANGE: std::ops::Range<usize> = 42..58;
const SECRET_KEY_RANGE: std::ops::Range<usize> = 58..90;
const PAIRING_ID_RANGE: std::ops::Range<usize> = 90..126;
const POLL_TOKEN_RANGE: std::ops::Range<usize> = 126..158;
const CHALLENGE_RANGE: std::ops::Range<usize> = 158..190;
const USER_CODE_RANGE: std::ops::Range<usize> = 190..204;
const DEADLINE_RANGE: std::ops::Range<usize> = 204..212;
const SOURCE_ID_RANGE: std::ops::Range<usize> = 212..238;
const DEVICE_ID_RANGE: std::ops::Range<usize> = 238..264;
const RECORD_BYTES: usize = 264;

/// Stable, non-reflective failures from the bounded connector command.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConnectorCliError {
    /// The command line does not match one of the five bounded commands.
    InvalidArguments,
    /// The supplied server origin is not an HTTPS origin or permitted loopback HTTP origin.
    InvalidOrigin,
    /// The supplied device label is empty, unsafe, or exceeds the contract bound.
    InvalidLabel,
    /// The current operating system or CPU architecture is outside the connector contract.
    UnsupportedPlatform,
    /// Operating-system cryptographic randomness was unavailable.
    EntropyUnavailable,
    /// The platform credential store could not be opened, read, written, or cleared.
    SecureStorageUnavailable,
    /// The stored connector credential does not match the closed versioned record.
    SecureStorageInvalid,
    /// The pairing service could not be reached within the bounded request policy.
    ServiceUnavailable,
    /// The service returned a response outside the versioned pairing contract.
    InvalidServiceResponse,
    /// The short-lived pairing transaction expired before approval completed.
    PairingExpired,
    /// No active source-bound credential exists for the requested origin and label.
    NotConnected,
    /// No discovered or explicitly selected Codex artifact passed exact admission.
    CodexNotAdmitted,
    /// The reviewed Codex process did not produce bounded usable data.
    CodexUnavailable,
    /// The active account currently has no bounded daily usage to submit.
    NoUsage,
    /// Fresh request time or identifier material could not be created safely.
    SyncPreparationUnavailable,
    /// The synchronization endpoint was unavailable or rejected the request.
    SyncUnavailable,
    /// The synchronization acknowledgement was outside the closed response contract.
    InvalidSyncResponse,
    /// The closed `CarRecipe` request could not be prepared safely.
    ProposalPreparationUnavailable,
    /// The proposal endpoint was unavailable or rejected the request.
    ProposalUnavailable,
    /// The proposal acknowledgement was outside the closed response contract.
    InvalidProposalResponse,
    /// Connector output could not be written.
    OutputUnavailable,
}

impl fmt::Display for ConnectorCliError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidArguments => USAGE,
            Self::InvalidOrigin => "the connector origin is invalid",
            Self::InvalidLabel => "the device label is invalid",
            Self::UnsupportedPlatform => "this connector platform is unsupported",
            Self::EntropyUnavailable => "secure device-key generation is unavailable",
            Self::SecureStorageUnavailable => {
                "the operating-system credential store is unavailable"
            }
            Self::SecureStorageInvalid => "the stored connector credential is invalid",
            Self::ServiceUnavailable => "the pairing service is temporarily unavailable",
            Self::InvalidServiceResponse => "the pairing service response is invalid",
            Self::PairingExpired => "the pairing request expired; run connect again",
            Self::NotConnected => "this device is not connected; run connect first",
            Self::CodexNotAdmitted => "no exact Codex executable was admitted",
            Self::CodexUnavailable => "Codex usage is temporarily unavailable",
            Self::NoUsage => "Codex reported no daily usage to sync",
            Self::SyncPreparationUnavailable => "usage could not be prepared safely",
            Self::SyncUnavailable => "the sync service is temporarily unavailable",
            Self::InvalidSyncResponse => "the sync service response is invalid",
            Self::ProposalPreparationUnavailable => "the car proposal could not be prepared safely",
            Self::ProposalUnavailable => "the car proposal service is temporarily unavailable",
            Self::InvalidProposalResponse => "the car proposal response is invalid",
            Self::OutputUnavailable => "connector output is unavailable",
        })
    }
}

impl std::error::Error for ConnectorCliError {}

/// Runs a bounded connector CLI command using process arguments and standard output.
///
/// `connect` creates or resumes one device credential. `sync` admits one exact Codex candidate,
/// collects only bounded daily usage, signs it with that active credential, and submits it once.
/// `check-codex` performs only the same point-in-time candidate artifact admission, without opening
/// credential storage, starting Codex, reading an account, persisting data, or using the network.
/// Its explicit diagnostic preview contains only fixed version/admission state and remains local
/// standard output for review before the user chooses whether to share it.
/// `propose-car` signs and submits one exact enum-only `CarRecipe` with the same active credential.
/// `forget-local` removes only the exact local origin/label credential and performs no server call.
///
/// # Errors
///
/// Returns a stable [`ConnectorCliError`] when arguments, the platform, storage, transport,
/// response validation, pairing expiry, or output fails closed.
pub fn run_connector_cli() -> Result<(), ConnectorCliError> {
    match parse_command(std::env::args_os().skip(1))? {
        ParsedCommand::Help => writeln!(io::stdout().lock(), "{USAGE}")
            .map_err(|_| ConnectorCliError::OutputUnavailable),
        ParsedCommand::Connect { label, origin } => {
            let origin = Origin::parse(&origin)?;
            validate_label(&label)?;
            let (os_family, architecture) = platform()?;
            let mut store = OsCredentialStore::new(&origin, &label)?;
            let mut transport = HttpPairingTransport::new(&origin);
            run_connect(
                &origin,
                &label,
                os_family,
                architecture,
                &mut store,
                &mut transport,
                &mut io::stdout().lock(),
            )
        }
        ParsedCommand::ForgetLocal { label, origin } => {
            let origin = Origin::parse(&origin)?;
            validate_label(&label)?;
            let mut store = OsCredentialStore::new(&origin, &label)?;
            run_forget_local(&mut store, &mut io::stdout().lock())
        }
        ParsedCommand::CheckCodex {
            codex_path,
            diagnostic_preview,
        } => run_codex_check(
            codex_path.as_deref(),
            diagnostic_preview,
            &mut io::stdout().lock(),
        ),
        ParsedCommand::Sync {
            codex_path,
            label,
            origin,
        } => {
            let origin = Origin::parse(&origin)?;
            validate_label(&label)?;
            let mut store = OsCredentialStore::new(&origin, &label)?;
            sync_command::run_sync(
                &origin,
                codex_path.as_deref(),
                &mut store,
                &mut io::stdout().lock(),
            )
        }
        ParsedCommand::ProposeCar {
            label,
            origin,
            recipe,
        } => {
            let origin = Origin::parse(&origin)?;
            validate_label(&label)?;
            let mut store = OsCredentialStore::new(&origin, &label)?;
            car_proposal_command::run_car_proposal(
                &origin,
                recipe,
                &mut store,
                &mut io::stdout().lock(),
            )
        }
    }
}

enum ParsedCommand {
    Help,
    Connect {
        label: String,
        origin: String,
    },
    ForgetLocal {
        label: String,
        origin: String,
    },
    CheckCodex {
        codex_path: Option<PathBuf>,
        diagnostic_preview: bool,
    },
    Sync {
        codex_path: Option<PathBuf>,
        label: String,
        origin: String,
    },
    ProposeCar {
        label: String,
        origin: String,
        recipe: CarRecipeSelection,
    },
}

#[derive(Default)]
struct PendingCarRecipeSelection {
    chassis: Option<String>,
    nose: Option<String>,
    cockpit: Option<String>,
    wing: Option<String>,
    wheels: Option<String>,
    palette: Option<String>,
    trail: Option<String>,
    seed: Option<u16>,
}

impl PendingCarRecipeSelection {
    fn finish(self) -> Result<CarRecipeSelection, ConnectorCliError> {
        CarRecipeSelection::from_exact_values(
            self.chassis
                .as_deref()
                .ok_or(ConnectorCliError::InvalidArguments)?,
            self.nose
                .as_deref()
                .ok_or(ConnectorCliError::InvalidArguments)?,
            self.cockpit
                .as_deref()
                .ok_or(ConnectorCliError::InvalidArguments)?,
            self.wing
                .as_deref()
                .ok_or(ConnectorCliError::InvalidArguments)?,
            self.wheels
                .as_deref()
                .ok_or(ConnectorCliError::InvalidArguments)?,
            self.palette
                .as_deref()
                .ok_or(ConnectorCliError::InvalidArguments)?,
            self.trail
                .as_deref()
                .ok_or(ConnectorCliError::InvalidArguments)?,
            self.seed.ok_or(ConnectorCliError::InvalidArguments)?,
        )
        .ok_or(ConnectorCliError::InvalidArguments)
    }
}

fn parse_command(
    arguments: impl IntoIterator<Item = OsString>,
) -> Result<ParsedCommand, ConnectorCliError> {
    let arguments = collect_cli_arguments(arguments)?;
    if arguments.as_slice() == ["--help"] || arguments.as_slice() == ["-h"] {
        return Ok(ParsedCommand::Help);
    }
    let command = arguments
        .first()
        .map(String::as_str)
        .ok_or(ConnectorCliError::InvalidArguments)?;
    if !is_bounded_command(command) {
        return Err(ConnectorCliError::InvalidArguments);
    }

    let mut origin = None;
    let mut label = None;
    let mut codex_path = None;
    let mut diagnostic_preview = false;
    let mut pending_recipe = PendingCarRecipeSelection::default();
    let mut index = 1;
    while index < arguments.len() {
        let flag = arguments
            .get(index)
            .ok_or(ConnectorCliError::InvalidArguments)?;
        if flag == "--diagnostic-preview" && command == "check-codex" && !diagnostic_preview {
            diagnostic_preview = true;
            index += 1;
            continue;
        }
        let value = arguments
            .get(index + 1)
            .ok_or(ConnectorCliError::InvalidArguments)?;
        match flag.as_str() {
            "--origin" if origin.is_none() => origin = Some(value.clone()),
            "--label" if label.is_none() => label = Some(value.clone()),
            "--codex"
                if matches!(command, "check-codex" | "sync")
                    && codex_path.is_none()
                    && value.len() <= 1024 =>
            {
                codex_path = Some(PathBuf::from(value));
            }
            "--chassis" if command == "propose-car" && pending_recipe.chassis.is_none() => {
                pending_recipe.chassis = Some(value.clone());
            }
            "--nose" if command == "propose-car" && pending_recipe.nose.is_none() => {
                pending_recipe.nose = Some(value.clone());
            }
            "--cockpit" if command == "propose-car" && pending_recipe.cockpit.is_none() => {
                pending_recipe.cockpit = Some(value.clone());
            }
            "--wing" if command == "propose-car" && pending_recipe.wing.is_none() => {
                pending_recipe.wing = Some(value.clone());
            }
            "--wheels" if command == "propose-car" && pending_recipe.wheels.is_none() => {
                pending_recipe.wheels = Some(value.clone());
            }
            "--palette" if command == "propose-car" && pending_recipe.palette.is_none() => {
                pending_recipe.palette = Some(value.clone());
            }
            "--trail" if command == "propose-car" && pending_recipe.trail.is_none() => {
                pending_recipe.trail = Some(value.clone());
            }
            "--seed" if command == "propose-car" && pending_recipe.seed.is_none() => {
                let parsed = value
                    .parse::<u16>()
                    .ok()
                    .filter(|parsed| parsed.to_string() == *value)
                    .ok_or(ConnectorCliError::InvalidArguments)?;
                pending_recipe.seed = Some(parsed);
            }
            _ => return Err(ConnectorCliError::InvalidArguments),
        }
        index += 2;
    }

    match (command, origin, label, codex_path) {
        ("connect", Some(origin), Some(label), None) => {
            Ok(ParsedCommand::Connect { label, origin })
        }
        ("forget-local", Some(origin), Some(label), None) => {
            Ok(ParsedCommand::ForgetLocal { label, origin })
        }
        ("check-codex", None, None, codex_path) => Ok(ParsedCommand::CheckCodex {
            codex_path,
            diagnostic_preview,
        }),
        ("sync", Some(origin), Some(label), codex_path) => Ok(ParsedCommand::Sync {
            codex_path,
            label,
            origin,
        }),
        ("propose-car", Some(origin), Some(label), None) => {
            let recipe = pending_recipe.finish()?;
            Ok(ParsedCommand::ProposeCar {
                label,
                origin,
                recipe,
            })
        }
        _ => Err(ConnectorCliError::InvalidArguments),
    }
}

fn collect_cli_arguments(
    arguments: impl IntoIterator<Item = OsString>,
) -> Result<Vec<String>, ConnectorCliError> {
    arguments
        .into_iter()
        .map(OsString::into_string)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ConnectorCliError::InvalidArguments)
}

fn is_bounded_command(command: &str) -> bool {
    matches!(
        command,
        "connect" | "forget-local" | "check-codex" | "sync" | "propose-car"
    )
}

#[derive(Clone)]
struct Origin {
    value: String,
}

impl Origin {
    fn parse(value: &str) -> Result<Self, ConnectorCliError> {
        if value.is_empty()
            || value.len() > MAX_ORIGIN_BYTES
            || !value.is_ascii()
            || value.trim() != value
        {
            return Err(ConnectorCliError::InvalidOrigin);
        }
        let uri = value
            .parse::<Uri>()
            .map_err(|_| ConnectorCliError::InvalidOrigin)?;
        let scheme = uri
            .scheme_str()
            .ok_or(ConnectorCliError::InvalidOrigin)?
            .to_ascii_lowercase();
        let authority = uri.authority().ok_or(ConnectorCliError::InvalidOrigin)?;
        if authority.as_str().contains('@') || uri.path() != "/" || uri.query().is_some() {
            return Err(ConnectorCliError::InvalidOrigin);
        }
        let raw_host = authority.host();
        if raw_host.is_empty() {
            return Err(ConnectorCliError::InvalidOrigin);
        }
        let host = raw_host
            .strip_prefix('[')
            .and_then(|candidate| candidate.strip_suffix(']'))
            .unwrap_or(raw_host)
            .to_ascii_lowercase();
        if scheme != "https" && (scheme != "http" || !is_loopback_host(&host)) {
            return Err(ConnectorCliError::InvalidOrigin);
        }
        let host_for_origin = if host.contains(':') {
            format!("[{host}]")
        } else {
            host
        };
        let default_port = if scheme == "https" { 443 } else { 80 };
        let port = authority
            .port_u16()
            .filter(|candidate| *candidate != default_port)
            .map_or_else(String::new, |candidate| format!(":{candidate}"));
        Ok(Self {
            value: format!("{scheme}://{host_for_origin}{port}"),
        })
    }
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn validate_label(value: &str) -> Result<(), ConnectorCliError> {
    let character_count = value.chars().count();
    if character_count == 0
        || character_count > MAX_LABEL_CHARACTERS
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        Err(ConnectorCliError::InvalidLabel)
    } else {
        Ok(())
    }
}

fn platform() -> Result<(&'static str, &'static str), ConnectorCliError> {
    let os_family = match std::env::consts::OS {
        "linux" => "linux",
        "macos" => "macos",
        "windows" => "windows",
        _ => return Err(ConnectorCliError::UnsupportedPlatform),
    };
    let architecture = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        _ => return Err(ConnectorCliError::UnsupportedPlatform),
    };
    Ok((os_family, architecture))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
enum RecordState {
    Prepared = 1,
    Pending = 2,
    Active = 3,
}

struct CredentialRecord {
    state: RecordState,
    origin_digest: [u8; 32],
    client_id: [u8; 16],
    secret_key: [u8; SECRET_KEY_LENGTH],
    pairing_id: [u8; 36],
    poll_token: [u8; 32],
    challenge: [u8; PAIRING_CHALLENGE_BYTES],
    user_code: [u8; 14],
    deadline: u64,
    source_id: [u8; 26],
    device_id: [u8; 26],
}

impl CredentialRecord {
    fn new(origin_digest: [u8; 32]) -> Result<Self, ConnectorCliError> {
        let mut client_id = [0_u8; 16];
        let mut secret_key = [0_u8; SECRET_KEY_LENGTH];
        getrandom::fill(&mut client_id).map_err(|_| ConnectorCliError::EntropyUnavailable)?;
        getrandom::fill(&mut secret_key).map_err(|_| ConnectorCliError::EntropyUnavailable)?;
        if all_zero(&client_id) || all_zero(&secret_key) {
            client_id.fill(0);
            secret_key.fill(0);
            return Err(ConnectorCliError::EntropyUnavailable);
        }
        Ok(Self {
            state: RecordState::Prepared,
            origin_digest,
            client_id,
            secret_key,
            pairing_id: [0; 36],
            poll_token: [0; 32],
            challenge: [0; PAIRING_CHALLENGE_BYTES],
            user_code: [0; 14],
            deadline: 0,
            source_id: [0; 26],
            device_id: [0; 26],
        })
    }

    fn make_prepared(&mut self) {
        self.state = RecordState::Prepared;
        self.pairing_id.fill(0);
        self.poll_token.fill(0);
        self.challenge.fill(0);
        self.user_code.fill(0);
        self.deadline = 0;
        self.source_id.fill(0);
        self.device_id.fill(0);
    }

    fn make_pending(
        &mut self,
        response: &StartResponse,
        deadline: u64,
    ) -> Result<(), ConnectorCliError> {
        self.pairing_id = exact_text(&response.pairing_id)?;
        self.poll_token = decode_base64url(&response.poll_token)
            .ok_or(ConnectorCliError::InvalidServiceResponse)?;
        self.challenge = decode_base64url(&response.pairing_challenge_base64_url)
            .ok_or(ConnectorCliError::InvalidServiceResponse)?;
        self.user_code = exact_text(&response.user_code)?;
        self.deadline = deadline;
        self.source_id.fill(0);
        self.device_id.fill(0);
        self.state = RecordState::Pending;
        Ok(())
    }

    fn make_active(&mut self, source_id: &str, device_id: &str) -> Result<(), ConnectorCliError> {
        self.source_id = exact_text(source_id)?;
        self.device_id = exact_text(device_id)?;
        self.pairing_id.fill(0);
        self.poll_token.fill(0);
        self.challenge.fill(0);
        self.user_code.fill(0);
        self.deadline = 0;
        self.state = RecordState::Active;
        Ok(())
    }

    fn pairing_id(&self) -> Result<&str, ConnectorCliError> {
        str::from_utf8(&self.pairing_id).map_err(|_| ConnectorCliError::SecureStorageInvalid)
    }

    fn user_code(&self) -> Result<&str, ConnectorCliError> {
        str::from_utf8(&self.user_code).map_err(|_| ConnectorCliError::SecureStorageInvalid)
    }

    fn encode(&self) -> [u8; RECORD_BYTES] {
        let mut output = [0_u8; RECORD_BYTES];
        output[MAGIC_RANGE].copy_from_slice(RECORD_MAGIC);
        output[VERSION_INDEX] = RECORD_VERSION;
        output[STATE_INDEX] = self.state as u8;
        output[ORIGIN_RANGE].copy_from_slice(&self.origin_digest);
        output[CLIENT_ID_RANGE].copy_from_slice(&self.client_id);
        output[SECRET_KEY_RANGE].copy_from_slice(&self.secret_key);
        output[PAIRING_ID_RANGE].copy_from_slice(&self.pairing_id);
        output[POLL_TOKEN_RANGE].copy_from_slice(&self.poll_token);
        output[CHALLENGE_RANGE].copy_from_slice(&self.challenge);
        output[USER_CODE_RANGE].copy_from_slice(&self.user_code);
        output[DEADLINE_RANGE].copy_from_slice(&self.deadline.to_le_bytes());
        output[SOURCE_ID_RANGE].copy_from_slice(&self.source_id);
        output[DEVICE_ID_RANGE].copy_from_slice(&self.device_id);
        output
    }

    fn decode(bytes: &[u8], expected_origin: &[u8; 32]) -> Result<Self, ConnectorCliError> {
        if bytes.len() != RECORD_BYTES
            || bytes[MAGIC_RANGE] != *RECORD_MAGIC
            || bytes[VERSION_INDEX] != RECORD_VERSION
        {
            return Err(ConnectorCliError::SecureStorageInvalid);
        }
        let state = match bytes[STATE_INDEX] {
            1 => RecordState::Prepared,
            2 => RecordState::Pending,
            3 => RecordState::Active,
            _ => return Err(ConnectorCliError::SecureStorageInvalid),
        };
        let mut record = Self {
            state,
            origin_digest: copy_range(bytes, ORIGIN_RANGE),
            client_id: copy_range(bytes, CLIENT_ID_RANGE),
            secret_key: copy_range(bytes, SECRET_KEY_RANGE),
            pairing_id: copy_range(bytes, PAIRING_ID_RANGE),
            poll_token: copy_range(bytes, POLL_TOKEN_RANGE),
            challenge: copy_range(bytes, CHALLENGE_RANGE),
            user_code: copy_range(bytes, USER_CODE_RANGE),
            deadline: u64::from_le_bytes(copy_range(bytes, DEADLINE_RANGE)),
            source_id: copy_range(bytes, SOURCE_ID_RANGE),
            device_id: copy_range(bytes, DEVICE_ID_RANGE),
        };
        if !record.valid(expected_origin) {
            record.clear();
            return Err(ConnectorCliError::SecureStorageInvalid);
        }
        Ok(record)
    }

    fn valid(&self, expected_origin: &[u8; 32]) -> bool {
        if &self.origin_digest != expected_origin
            || all_zero(&self.client_id)
            || all_zero(&self.secret_key)
        {
            return false;
        }
        let pending_fields_clear = all_zero(&self.pairing_id)
            && all_zero(&self.poll_token)
            && all_zero(&self.challenge)
            && all_zero(&self.user_code)
            && self.deadline == 0;
        let binding_fields_clear = all_zero(&self.source_id) && all_zero(&self.device_id);
        match self.state {
            RecordState::Prepared => pending_fields_clear && binding_fields_clear,
            RecordState::Pending => {
                binding_fields_clear
                    && self.deadline > 0
                    && str::from_utf8(&self.pairing_id).is_ok_and(valid_pairing_id)
                    && str::from_utf8(&self.user_code).is_ok_and(valid_user_code)
                    && !all_zero(&self.poll_token)
                    && !all_zero(&self.challenge)
            }
            RecordState::Active => {
                pending_fields_clear
                    && str::from_utf8(&self.source_id)
                        .is_ok_and(|value| valid_public_id(value, "src_"))
                    && str::from_utf8(&self.device_id)
                        .is_ok_and(|value| valid_public_id(value, "dev_"))
            }
        }
    }

    fn clear(&mut self) {
        self.origin_digest.fill(0);
        self.client_id.fill(0);
        self.secret_key.fill(0);
        self.pairing_id.fill(0);
        self.poll_token.fill(0);
        self.challenge.fill(0);
        self.user_code.fill(0);
        self.deadline = 0;
        self.source_id.fill(0);
        self.device_id.fill(0);
    }
}

impl Drop for CredentialRecord {
    fn drop(&mut self) {
        self.clear();
    }
}

fn copy_range<const N: usize>(input: &[u8], range: std::ops::Range<usize>) -> [u8; N] {
    let mut output = [0_u8; N];
    output.copy_from_slice(&input[range]);
    output
}

fn exact_text<const N: usize>(value: &str) -> Result<[u8; N], ConnectorCliError> {
    value
        .as_bytes()
        .try_into()
        .map_err(|_| ConnectorCliError::InvalidServiceResponse)
}

fn all_zero(value: &[u8]) -> bool {
    value.iter().all(|byte| *byte == 0)
}

trait CredentialStore {
    fn load(
        &mut self,
        expected_origin: &[u8; 32],
    ) -> Result<Option<CredentialRecord>, ConnectorCliError>;
    fn save(&mut self, record: &CredentialRecord) -> Result<(), ConnectorCliError>;
    fn delete(&mut self) -> Result<(), ConnectorCliError>;
}

struct OsCredentialStore {
    entry: keyring::Entry,
}

impl OsCredentialStore {
    fn new(origin: &Origin, label: &str) -> Result<Self, ConnectorCliError> {
        let account = credential_account(origin, label);
        let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
            .map_err(|_| ConnectorCliError::SecureStorageUnavailable)?;
        Ok(Self { entry })
    }
}

impl CredentialStore for OsCredentialStore {
    fn load(
        &mut self,
        expected_origin: &[u8; 32],
    ) -> Result<Option<CredentialRecord>, ConnectorCliError> {
        let mut bytes = match self.entry.get_secret() {
            Ok(bytes) => bytes,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(_) => return Err(ConnectorCliError::SecureStorageUnavailable),
        };
        let result = CredentialRecord::decode(&bytes, expected_origin).map(Some);
        bytes.fill(0);
        result
    }

    fn save(&mut self, record: &CredentialRecord) -> Result<(), ConnectorCliError> {
        let mut encoded = record.encode();
        let result = self
            .entry
            .set_secret(&encoded)
            .map_err(|_| ConnectorCliError::SecureStorageUnavailable);
        encoded.fill(0);
        result
    }

    fn delete(&mut self) -> Result<(), ConnectorCliError> {
        map_credential_delete_result(&self.entry.delete_credential())
    }
}

fn map_credential_delete_result(result: &keyring::Result<()>) -> Result<(), ConnectorCliError> {
    match result {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(ConnectorCliError::SecureStorageUnavailable),
    }
}

fn credential_account(origin: &Origin, label: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(ACCOUNT_DOMAIN);
    hasher.update(origin.value.as_bytes());
    hasher.update([0]);
    hasher.update(label.as_bytes());
    let mut digest = hasher.finalize();
    let mut account = String::with_capacity(KEYRING_ACCOUNT_PREFIX.len() + digest.len() * 2);
    account.push_str(KEYRING_ACCOUNT_PREFIX);
    for byte in &digest {
        use fmt::Write as _;
        write!(account, "{byte:02x}").expect("writing to a String cannot fail");
    }
    digest.fill(0);
    account
}

fn digest_origin(origin: &Origin) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(ORIGIN_DOMAIN);
    hasher.update(origin.value.as_bytes());
    hasher.finalize().into()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartRequest<'a> {
    schema_version: u8,
    device_public_key_base64_url: &'a str,
    device_label: &'a str,
    connector_version: &'static str,
    os_family: &'static str,
    architecture: &'static str,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct StartResponse {
    schema_version: u8,
    request_id: String,
    pairing_id: String,
    poll_token: String,
    pairing_challenge_base64_url: String,
    user_code: String,
    expires_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PollRequest<'a> {
    schema_version: u8,
    poll_token: &'a str,
    possession_signature: &'a str,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PollResponse {
    schema_version: u8,
    request_id: String,
    device_bindings: Vec<DeviceBinding>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DeviceBinding {
    source_id: String,
    device_id: String,
}

enum StartTransportOutcome {
    Created(StartResponse),
    Retryable,
}

enum PollTransportOutcome {
    Pending,
    Activated(DeviceBinding),
    Expired,
    Retryable,
}

#[derive(Clone, Copy)]
enum TransportError {
    Unavailable,
    InvalidResponse,
}

trait PairingTransport {
    fn start(
        &mut self,
        client_id: &str,
        request: &StartRequest<'_>,
    ) -> Result<StartTransportOutcome, TransportError>;
    fn poll(
        &mut self,
        client_id: &str,
        request: &PollRequest<'_>,
    ) -> Result<PollTransportOutcome, TransportError>;
}

struct HttpPairingTransport {
    agent: Agent,
    origin: String,
}

struct SuccessBody {
    body: Vec<u8>,
    request_id: String,
}

enum HttpOutcome {
    Success(SuccessBody),
    Retryable,
    Expired,
}

impl HttpPairingTransport {
    fn new(origin: &Origin) -> Self {
        Self {
            agent: new_http_agent(),
            origin: origin.value.clone(),
        }
    }

    fn post(
        &self,
        path: &str,
        client_id: &str,
        request: &impl Serialize,
        expired_on_bad_request: bool,
    ) -> Result<HttpOutcome, TransportError> {
        let mut body = serde_json::to_vec(request).map_err(|_| TransportError::InvalidResponse)?;
        if body.len() > MAX_REQUEST_BYTES {
            body.fill(0);
            return Err(TransportError::InvalidResponse);
        }
        let response = self
            .agent
            .post(format!("{}{path}", self.origin))
            .content_type(JSON_MEDIA_TYPE)
            .header("accept", JSON_MEDIA_TYPE)
            .header(CLIENT_ID_HEADER, client_id)
            .send(body.as_slice());
        body.fill(0);
        let mut response = response.map_err(|error| map_transport_error(&error))?;
        let status = response.status().as_u16();
        if matches!(status, 429 | 503) {
            return Ok(HttpOutcome::Retryable);
        }
        if status == 400 && expired_on_bad_request {
            return Ok(HttpOutcome::Expired);
        }
        if status != 200 || !valid_json_content_type(response.headers().get("content-type")) {
            return Err(TransportError::InvalidResponse);
        }
        let request_id = response
            .headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .filter(|value| valid_public_id(value, "req_"))
            .ok_or(TransportError::InvalidResponse)?
            .to_owned();
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_RESPONSE_BYTES + 1)
            .read_to_vec()
            .map_err(|_| TransportError::InvalidResponse)?;
        if body.len() as u64 > MAX_RESPONSE_BYTES {
            return Err(TransportError::InvalidResponse);
        }
        Ok(HttpOutcome::Success(SuccessBody { body, request_id }))
    }
}

fn new_http_agent() -> Agent {
    Agent::config_builder()
        .proxy(None)
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_global(Some(HTTP_TIMEOUT))
        .timeout_connect(Some(CONNECT_TIMEOUT))
        .max_response_header_size(16 * 1024)
        .user_agent(concat!("viberacing-connector/", env!("CARGO_PKG_VERSION")))
        .accept(JSON_MEDIA_TYPE)
        .tls_config(
            TlsConfig::builder()
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .build()
        .new_agent()
}

impl PairingTransport for HttpPairingTransport {
    fn start(
        &mut self,
        client_id: &str,
        request: &StartRequest<'_>,
    ) -> Result<StartTransportOutcome, TransportError> {
        match self.post(START_PATH, client_id, request, false)? {
            HttpOutcome::Success(success) => {
                let response: StartResponse = serde_json::from_slice(&success.body)
                    .map_err(|_| TransportError::InvalidResponse)?;
                if !valid_start_response(&response) || response.request_id != success.request_id {
                    return Err(TransportError::InvalidResponse);
                }
                Ok(StartTransportOutcome::Created(response))
            }
            HttpOutcome::Retryable => Ok(StartTransportOutcome::Retryable),
            HttpOutcome::Expired => Err(TransportError::InvalidResponse),
        }
    }

    fn poll(
        &mut self,
        client_id: &str,
        request: &PollRequest<'_>,
    ) -> Result<PollTransportOutcome, TransportError> {
        match self.post(POLL_PATH, client_id, request, true)? {
            HttpOutcome::Success(success) => {
                let response: PollResponse = serde_json::from_slice(&success.body)
                    .map_err(|_| TransportError::InvalidResponse)?;
                if !valid_poll_response(&response) || response.request_id != success.request_id {
                    return Err(TransportError::InvalidResponse);
                }
                match response.device_bindings.into_iter().next() {
                    Some(binding) => Ok(PollTransportOutcome::Activated(binding)),
                    None => Ok(PollTransportOutcome::Pending),
                }
            }
            HttpOutcome::Retryable => Ok(PollTransportOutcome::Retryable),
            HttpOutcome::Expired => Ok(PollTransportOutcome::Expired),
        }
    }
}

fn map_transport_error(error: &ureq::Error) -> TransportError {
    match error {
        ureq::Error::Timeout(_)
        | ureq::Error::Io(_)
        | ureq::Error::HostNotFound
        | ureq::Error::ConnectionFailed => TransportError::Unavailable,
        _ => TransportError::InvalidResponse,
    }
}

fn valid_json_content_type(value: Option<&ureq::http::HeaderValue>) -> bool {
    value
        .and_then(|header| header.to_str().ok())
        .is_some_and(|header| {
            header.eq_ignore_ascii_case(JSON_MEDIA_TYPE)
                || header.eq_ignore_ascii_case("application/json; charset=utf-8")
        })
}

fn valid_start_response(response: &StartResponse) -> bool {
    response.schema_version == 1
        && valid_public_id(&response.request_id, "req_")
        && valid_pairing_id(&response.pairing_id)
        && decode_base64url::<32>(&response.poll_token).is_some_and(|value| !all_zero(&value))
        && decode_base64url::<32>(&response.pairing_challenge_base64_url)
            .is_some_and(|value| !all_zero(&value))
        && valid_user_code(&response.user_code)
        && valid_utc_millisecond_timestamp(&response.expires_at)
}

fn valid_poll_response(response: &PollResponse) -> bool {
    response.schema_version == 1
        && valid_public_id(&response.request_id, "req_")
        && response.device_bindings.len() <= 1
        && response.device_bindings.iter().all(|binding| {
            valid_public_id(&binding.source_id, "src_")
                && valid_public_id(&binding.device_id, "dev_")
        })
}

fn valid_public_id(value: &str, prefix: &str) -> bool {
    value.len() == 26
        && value.starts_with(prefix)
        && value[prefix.len()..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_user_code(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 14
        && bytes[4] == b'-'
        && bytes[9] == b'-'
        && bytes.iter().copied().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 9)
                || matches!(byte, b'A'..=b'H' | b'J'..=b'N' | b'P'..=b'Z' | b'2'..=b'9')
        })
}

fn valid_utc_millisecond_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
        || bytes.iter().copied().enumerate().any(|(index, byte)| {
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
    year >= 1970
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

fn decode_base64url<const N: usize>(value: &str) -> Option<[u8; N]> {
    if value.len() != (N * 8).div_ceil(6)
        || value.bytes().any(|byte| base64url_value(byte).is_none())
    {
        return None;
    }
    let mut output = [0_u8; N];
    let mut accumulator = 0_u32;
    let mut bits = 0_u8;
    let mut output_index = 0;
    for byte in value.bytes() {
        accumulator = (accumulator << 6) | u32::from(base64url_value(byte)?);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            if output_index >= N {
                return None;
            }
            output[output_index] = ((accumulator >> bits) & 0xff) as u8;
            output_index += 1;
        }
    }
    let unused_mask = (1_u32 << bits) - 1;
    (output_index == N && accumulator & unused_mask == 0).then_some(output)
}

fn base64url_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'-' => Some(62),
        b'_' => Some(63),
        _ => None,
    }
}

fn run_connect(
    origin: &Origin,
    label: &str,
    os_family: &'static str,
    architecture: &'static str,
    store: &mut dyn CredentialStore,
    transport: &mut dyn PairingTransport,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    let origin_digest = digest_origin(origin);
    let mut record = if let Some(record) = store.load(&origin_digest)? {
        record
    } else {
        let record = CredentialRecord::new(origin_digest)?;
        store.save(&record)?;
        record
    };

    if record.state == RecordState::Active {
        return write_line(output, "This device is already connected.");
    }
    if record.state == RecordState::Pending && now_epoch_seconds()? >= record.deadline {
        record.make_prepared();
        store.save(&record)?;
    }
    if record.state == RecordState::Prepared {
        start_pairing(
            label,
            os_family,
            architecture,
            &mut record,
            store,
            transport,
        )?;
    }

    writeln!(
        output,
        "Open {}{CONNECT_PATH} and enter code {}.",
        origin.value,
        record.user_code()?
    )
    .map_err(|_| ConnectorCliError::OutputUnavailable)?;
    write_line(output, "Waiting for approval...")?;

    let pairing_id = record.pairing_id()?.to_owned();
    let key = PendingDevicePairingSigningKey::from_secret_key(record.secret_key);
    let context = ReviewedPairingChallenge::from_reviewed_response(&pairing_id, record.challenge);
    let proof = CandidatePairingPossessionV1Signer::sign(key, context)
        .map_err(|_| ConnectorCliError::SecureStorageInvalid)?;
    let poll_token = encode_base64url(&record.poll_token);
    let client_id = encode_base64url(&record.client_id);
    let request = PollRequest {
        schema_version: 1,
        poll_token: &poll_token,
        possession_signature: proof.signature(),
    };

    for attempt in 0..MAX_POLL_ATTEMPTS {
        if now_epoch_seconds()? >= record.deadline {
            return expire_pairing(&mut record, store);
        }
        match transport
            .poll(&client_id, &request)
            .map_err(map_cli_transport_error)?
        {
            PollTransportOutcome::Activated(binding) => {
                record.make_active(&binding.source_id, &binding.device_id)?;
                store.save(&record)?;
                return write_line(output, "Device connected.");
            }
            PollTransportOutcome::Expired => return expire_pairing(&mut record, store),
            PollTransportOutcome::Pending | PollTransportOutcome::Retryable => {
                if attempt + 1 < MAX_POLL_ATTEMPTS {
                    thread::sleep(POLL_INTERVAL);
                }
            }
        }
    }
    expire_pairing(&mut record, store)
}

fn start_pairing(
    label: &str,
    os_family: &'static str,
    architecture: &'static str,
    record: &mut CredentialRecord,
    store: &mut dyn CredentialStore,
    transport: &mut dyn PairingTransport,
) -> Result<(), ConnectorCliError> {
    let key = PendingDevicePairingSigningKey::from_secret_key(record.secret_key);
    let public_key = encode_base64url(&key.verifying_key_bytes());
    let client_id = encode_base64url(&record.client_id);
    let request = StartRequest {
        schema_version: 1,
        device_public_key_base64_url: &public_key,
        device_label: label,
        connector_version: env!("CARGO_PKG_VERSION"),
        os_family,
        architecture,
    };
    let response = match transport
        .start(&client_id, &request)
        .map_err(map_cli_transport_error)?
    {
        StartTransportOutcome::Created(response) => response,
        StartTransportOutcome::Retryable => return Err(ConnectorCliError::ServiceUnavailable),
    };
    let deadline = now_epoch_seconds()?
        .checked_add(PAIRING_LIFETIME_SECONDS)
        .ok_or(ConnectorCliError::ServiceUnavailable)?;
    record.make_pending(&response, deadline)?;
    store.save(record)
}

fn expire_pairing(
    record: &mut CredentialRecord,
    store: &mut dyn CredentialStore,
) -> Result<(), ConnectorCliError> {
    record.make_prepared();
    store.save(record)?;
    Err(ConnectorCliError::PairingExpired)
}

fn map_cli_transport_error(error: TransportError) -> ConnectorCliError {
    match error {
        TransportError::Unavailable => ConnectorCliError::ServiceUnavailable,
        TransportError::InvalidResponse => ConnectorCliError::InvalidServiceResponse,
    }
}

fn now_epoch_seconds() -> Result<u64, ConnectorCliError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| ConnectorCliError::ServiceUnavailable)
}

fn write_line(output: &mut dyn Write, value: &str) -> Result<(), ConnectorCliError> {
    writeln!(output, "{value}").map_err(|_| ConnectorCliError::OutputUnavailable)
}

fn run_forget_local(
    store: &mut dyn CredentialStore,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    store.delete()?;
    write_line(
        output,
        "No credential remains in this local store. This did not revoke server device authority; review your Vibe Racing account.",
    )
}

fn map_admission_error(error: AdmissionError) -> ConnectorCliError {
    match error {
        AdmissionError::UnsupportedPlatform => ConnectorCliError::UnsupportedPlatform,
        AdmissionError::DiscoveryUnavailable
        | AdmissionError::InvalidPath
        | AdmissionError::UnsupportedArtifact => ConnectorCliError::CodexNotAdmitted,
    }
}

fn run_codex_check(
    codex_path: Option<&Path>,
    diagnostic_preview: bool,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    run_codex_check_with(codex_path, diagnostic_preview, output, |selection| {
        admit_candidate_selection(selection).map(drop)
    })
}

fn run_codex_check_with(
    codex_path: Option<&Path>,
    diagnostic_preview: bool,
    output: &mut dyn Write,
    admit: impl FnOnce(Option<&Path>) -> Result<(), AdmissionError>,
) -> Result<(), ConnectorCliError> {
    match admit(codex_path) {
        Ok(()) if diagnostic_preview => {
            write_codex_diagnostic_preview(output, CodexDiagnosticAdmission::Passed)
        }
        Ok(()) => write_line(
            output,
            &format!(
                "Candidate Codex {ADMITTED_CODEX_VERSION} artifact admission passed; no Codex version is supported."
            ),
        ),
        Err(error) if diagnostic_preview => {
            let admission = match error {
                AdmissionError::UnsupportedPlatform => {
                    CodexDiagnosticAdmission::UnsupportedPlatform
                }
                AdmissionError::DiscoveryUnavailable
                | AdmissionError::InvalidPath
                | AdmissionError::UnsupportedArtifact => CodexDiagnosticAdmission::NotAdmitted,
            };
            write_codex_diagnostic_preview(output, admission)?;
            Err(map_admission_error(error))
        }
        Err(error) => Err(map_admission_error(error)),
    }
}

#[derive(Clone, Copy)]
enum CodexDiagnosticAdmission {
    Passed,
    NotAdmitted,
    UnsupportedPlatform,
}

impl CodexDiagnosticAdmission {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Passed => "passed",
            Self::NotAdmitted => "not-admitted",
            Self::UnsupportedPlatform => "unsupported-platform",
        }
    }
}

fn write_codex_diagnostic_preview(
    output: &mut dyn Write,
    candidate_admission: CodexDiagnosticAdmission,
) -> Result<(), ConnectorCliError> {
    let candidate_admission = candidate_admission.as_str();
    write!(
        output,
        "Vibe Racing connector diagnostic preview v1\n\
connector-version: {}\n\
candidate-platform-contract: windows-x86_64\n\
candidate-codex-version: {ADMITTED_CODEX_VERSION}\n\
candidate-admission: {candidate_admission}\n\
supported-codex-versions: none\n\
included-data: fixed-version-and-admission-state-only\n\
excluded-data: paths,digests,environment,credentials,account,usage\n\
side-effects: no-codex-process,no-credential-access,no-persistence,no-network\n\
review-before-sharing: required\n",
        env!("CARGO_PKG_VERSION"),
    )
    .map_err(|_| ConnectorCliError::OutputUnavailable)
}

#[cfg(test)]
mod tests {
    use super::*;

    const REQUEST_ID: &str = "req_AAAAAAAAAAAAAAAAAAAAAA";
    const PAIRING_ID: &str = "00000000-0000-4000-8000-000000001001";
    const POLL_TOKEN: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    const CHALLENGE: &str = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
    const USER_CODE: &str = "ABCD-EFGH-JKLM";
    const SOURCE_ID: &str = "src_AAAAAAAAAAAAAAAAAAAAAA";
    const DEVICE_ID: &str = "dev_BBBBBBBBBBBBBBBBBBBBBB";

    struct MemoryStore {
        bytes: Option<Vec<u8>>,
        saves: usize,
    }

    impl CredentialStore for MemoryStore {
        fn load(
            &mut self,
            expected_origin: &[u8; 32],
        ) -> Result<Option<CredentialRecord>, ConnectorCliError> {
            self.bytes
                .as_deref()
                .map(|bytes| CredentialRecord::decode(bytes, expected_origin))
                .transpose()
        }

        fn save(&mut self, record: &CredentialRecord) -> Result<(), ConnectorCliError> {
            self.bytes = Some(record.encode().to_vec());
            self.saves += 1;
            Ok(())
        }

        fn delete(&mut self) -> Result<(), ConnectorCliError> {
            self.bytes = None;
            Ok(())
        }
    }

    struct ImmediateTransport {
        starts: usize,
        polls: usize,
    }

    impl PairingTransport for ImmediateTransport {
        fn start(
            &mut self,
            client_id: &str,
            request: &StartRequest<'_>,
        ) -> Result<StartTransportOutcome, TransportError> {
            self.starts += 1;
            assert_eq!(client_id.len(), 22);
            assert_eq!(request.schema_version, 1);
            assert_eq!(request.device_public_key_base64_url.len(), 43);
            assert_eq!(request.device_label, "Desktop");
            Ok(StartTransportOutcome::Created(start_response()))
        }

        fn poll(
            &mut self,
            client_id: &str,
            request: &PollRequest<'_>,
        ) -> Result<PollTransportOutcome, TransportError> {
            self.polls += 1;
            assert_eq!(client_id.len(), 22);
            assert_eq!(request.schema_version, 1);
            assert_eq!(request.poll_token, POLL_TOKEN);
            assert_eq!(request.possession_signature.len(), 86);
            Ok(PollTransportOutcome::Activated(DeviceBinding {
                source_id: SOURCE_ID.to_owned(),
                device_id: DEVICE_ID.to_owned(),
            }))
        }
    }

    fn start_response() -> StartResponse {
        StartResponse {
            schema_version: 1,
            request_id: REQUEST_ID.to_owned(),
            pairing_id: PAIRING_ID.to_owned(),
            poll_token: POLL_TOKEN.to_owned(),
            pairing_challenge_base64_url: CHALLENGE.to_owned(),
            user_code: USER_CODE.to_owned(),
            expires_at: "2030-01-02T03:04:05.006Z".to_owned(),
        }
    }

    fn test_origin() -> Origin {
        Origin::parse("https://race.example").expect("synthetic HTTPS origin must validate")
    }

    #[test]
    fn parses_existing_bounded_commands() {
        let command = parse_command([
            "connect".into(),
            "--label".into(),
            "Desktop".into(),
            "--origin".into(),
            "https://race.example".into(),
        ])
        .expect("exact connect arguments must parse");
        assert!(matches!(command, ParsedCommand::Connect { .. }));
        let command = parse_command([
            "sync".into(),
            "--codex".into(),
            "C:\\synthetic\\codex.exe".into(),
            "--label".into(),
            "Desktop".into(),
            "--origin".into(),
            "https://race.example".into(),
        ])
        .expect("exact sync arguments must parse");
        assert!(matches!(command, ParsedCommand::Sync { .. }));
        let command = parse_command([
            "propose-car".into(),
            "--origin".into(),
            "https://race.example".into(),
            "--label".into(),
            "Desktop".into(),
            "--chassis".into(),
            "formula".into(),
            "--nose".into(),
            "wedge".into(),
            "--cockpit".into(),
            "canopy".into(),
            "--wing".into(),
            "high".into(),
            "--wheels".into(),
            "slick".into(),
            "--palette".into(),
            "turbo-blue".into(),
            "--trail".into(),
            "spark".into(),
            "--seed".into(),
            "4242".into(),
        ])
        .expect("exact proposal arguments must parse");
        assert!(matches!(command, ParsedCommand::ProposeCar { .. }));
        assert!(matches!(
            parse_command([
                "connect".into(),
                "--origin".into(),
                "https://race.example".into()
            ]),
            Err(ConnectorCliError::InvalidArguments)
        ));
        assert!(matches!(
            parse_command(["sync".into()]),
            Err(ConnectorCliError::InvalidArguments)
        ));
        assert!(matches!(
            parse_command([
                "propose-car".into(),
                "--origin".into(),
                "https://race.example".into(),
                "--label".into(),
                "Desktop".into(),
                "--chassis".into(),
                "formula".into(),
                "--nose".into(),
                "wedge".into(),
                "--cockpit".into(),
                "canopy".into(),
                "--wing".into(),
                "high".into(),
                "--wheels".into(),
                "slick".into(),
                "--palette".into(),
                "private-color".into(),
                "--trail".into(),
                "spark".into(),
                "--seed".into(),
                "0042".into(),
            ]),
            Err(ConnectorCliError::InvalidArguments)
        ));
        assert!(matches!(
            parse_command([
                "connect".into(),
                "--origin".into(),
                "https://race.example".into(),
                "--label".into(),
                "Desktop".into(),
                "--codex".into(),
                "C:\\synthetic\\codex.exe".into()
            ]),
            Err(ConnectorCliError::InvalidArguments)
        ));
        assert!(matches!(
            parse_command(["--help".into()]),
            Ok(ParsedCommand::Help)
        ));
    }

    #[test]
    fn parses_sync_with_bounded_discovery_and_explicit_fallback() {
        let command = parse_command([
            "sync".into(),
            "--label".into(),
            "Desktop".into(),
            "--origin".into(),
            "https://race.example".into(),
        ])
        .expect("exact discovery sync arguments must parse");
        assert!(matches!(
            command,
            ParsedCommand::Sync {
                codex_path: None,
                ..
            }
        ));

        let command = parse_command([
            "sync".into(),
            "--codex".into(),
            "C:\\synthetic\\codex.exe".into(),
            "--label".into(),
            "Desktop".into(),
            "--origin".into(),
            "https://race.example".into(),
        ])
        .expect("exact explicit-path sync arguments must parse");
        assert!(matches!(
            command,
            ParsedCommand::Sync {
                codex_path: Some(_),
                ..
            }
        ));
    }

    #[test]
    fn parses_only_the_bounded_codex_check_command() {
        let command = parse_command(["check-codex".into()])
            .expect("default candidate diagnostic arguments must parse");
        assert!(matches!(
            command,
            ParsedCommand::CheckCodex {
                codex_path: None,
                diagnostic_preview: false,
            }
        ));
        assert!(
            ConnectorCliError::InvalidArguments
                .to_string()
                .contains(
                    "\n  viberacing-connector check-codex [--codex <absolute-path>] [--diagnostic-preview]\n"
                )
        );

        let explicit_path = "C:\\synthetic-private\\codex.exe";
        let command = parse_command(["check-codex".into(), "--codex".into(), explicit_path.into()])
            .expect("explicit candidate diagnostic arguments must parse");
        match command {
            ParsedCommand::CheckCodex {
                codex_path: Some(path),
                diagnostic_preview: false,
            } => assert_eq!(path, PathBuf::from(explicit_path)),
            _ => panic!("the explicit diagnostic path must remain confined to check-codex"),
        }

        for arguments in [
            vec!["check-codex".into(), "--diagnostic-preview".into()],
            vec![
                "check-codex".into(),
                "--diagnostic-preview".into(),
                "--codex".into(),
                explicit_path.into(),
            ],
            vec![
                "check-codex".into(),
                "--codex".into(),
                explicit_path.into(),
                "--diagnostic-preview".into(),
            ],
        ] {
            assert!(matches!(
                parse_command(arguments),
                Ok(ParsedCommand::CheckCodex {
                    diagnostic_preview: true,
                    ..
                })
            ));
        }

        for arguments in [
            vec!["check-codex".into(), "--codex".into()],
            vec![
                "check-codex".into(),
                "--diagnostic-preview".into(),
                "true".into(),
            ],
            vec![
                "check-codex".into(),
                "--diagnostic-preview".into(),
                "--diagnostic-preview".into(),
            ],
            vec![
                "sync".into(),
                "--origin".into(),
                "https://race.example".into(),
                "--label".into(),
                "Desktop".into(),
                "--diagnostic-preview".into(),
                "true".into(),
            ],
            vec![
                "check-codex".into(),
                "--codex".into(),
                explicit_path.into(),
                "--codex".into(),
                explicit_path.into(),
            ],
            vec![
                "check-codex".into(),
                "--origin".into(),
                "https://race.example".into(),
            ],
            vec!["check-codex".into(), "--label".into(), "Desktop".into()],
            vec![
                "check-codex".into(),
                "--codex".into(),
                "C:\\synthetic\\codex.exe".into(),
                "unexpected".into(),
            ],
            vec![
                "check-codex".into(),
                "--codex".into(),
                "é".repeat(513).into(),
            ],
        ] {
            assert!(matches!(
                parse_command(arguments),
                Err(ConnectorCliError::InvalidArguments)
            ));
        }
    }

    #[test]
    fn codex_check_is_one_non_reflective_point_in_time_admission() {
        let selected = PathBuf::from("C:\\synthetic-private\\codex.exe");
        let mut calls = 0;
        let mut output = Vec::new();
        run_codex_check_with(Some(&selected), false, &mut output, |candidate| {
            calls += 1;
            assert_eq!(candidate, Some(selected.as_path()));
            Ok(())
        })
        .expect("an admitted diagnostic candidate must succeed");
        assert_eq!(calls, 1);
        let rendered = String::from_utf8(output).expect("fixed output must be UTF-8");
        assert_eq!(
            rendered,
            "Candidate Codex 0.144.5 artifact admission passed; no Codex version is supported.\n"
        );
        assert!(!rendered.contains("synthetic-private"));

        let mut default_output = Vec::new();
        run_codex_check_with(None, false, &mut default_output, |candidate| {
            assert_eq!(candidate, None);
            Ok(())
        })
        .expect("default diagnostic selection must use the same admission boundary");
        assert_eq!(default_output, rendered.as_bytes());
    }

    #[test]
    fn codex_check_maps_failures_without_partial_output() {
        for (admission_error, expected) in [
            (
                AdmissionError::DiscoveryUnavailable,
                ConnectorCliError::CodexNotAdmitted,
            ),
            (
                AdmissionError::InvalidPath,
                ConnectorCliError::CodexNotAdmitted,
            ),
            (
                AdmissionError::UnsupportedArtifact,
                ConnectorCliError::CodexNotAdmitted,
            ),
            (
                AdmissionError::UnsupportedPlatform,
                ConnectorCliError::UnsupportedPlatform,
            ),
        ] {
            let mut output = Vec::new();
            assert_eq!(
                run_codex_check_with(None, false, &mut output, |_| Err(admission_error)),
                Err(expected)
            );
            assert!(output.is_empty());
        }

        assert_eq!(
            run_codex_check_with(None, false, &mut UnwritableOutput, |_| Ok(())),
            Err(ConnectorCliError::OutputUnavailable)
        );
    }

    #[test]
    fn codex_diagnostic_preview_is_closed_redacted_and_keeps_failure_status() {
        let selected = PathBuf::from("C:\\synthetic-private\\codex.exe");
        let expected = |admission: &str| {
            format!(
                "Vibe Racing connector diagnostic preview v1\n\
connector-version: 0.0.0\n\
candidate-platform-contract: windows-x86_64\n\
candidate-codex-version: 0.144.5\n\
candidate-admission: {admission}\n\
supported-codex-versions: none\n\
included-data: fixed-version-and-admission-state-only\n\
excluded-data: paths,digests,environment,credentials,account,usage\n\
side-effects: no-codex-process,no-credential-access,no-persistence,no-network\n\
review-before-sharing: required\n"
            )
        };

        let mut passed = Vec::new();
        run_codex_check_with(Some(&selected), true, &mut passed, |candidate| {
            assert_eq!(candidate, Some(selected.as_path()));
            Ok(())
        })
        .expect("an admitted candidate must produce a diagnostic preview");
        assert_eq!(
            String::from_utf8(passed).expect("preview must remain UTF-8"),
            expected("passed")
        );

        for (error, admission, expected_error) in [
            (
                AdmissionError::InvalidPath,
                "not-admitted",
                ConnectorCliError::CodexNotAdmitted,
            ),
            (
                AdmissionError::UnsupportedPlatform,
                "unsupported-platform",
                ConnectorCliError::UnsupportedPlatform,
            ),
        ] {
            let mut failed = Vec::new();
            assert_eq!(
                run_codex_check_with(Some(&selected), true, &mut failed, |_| Err(error)),
                Err(expected_error)
            );
            let rendered = String::from_utf8(failed).expect("preview must remain UTF-8");
            assert_eq!(rendered, expected(admission));
            assert!(!rendered.contains("synthetic-private"));
        }

        assert_eq!(
            run_codex_check_with(None, true, &mut UnwritableOutput, |_| {
                Err(AdmissionError::InvalidPath)
            }),
            Err(ConnectorCliError::OutputUnavailable)
        );
    }

    #[test]
    fn parses_only_the_bounded_forget_local_command() {
        let command = parse_command([
            "forget-local".into(),
            "--origin".into(),
            "https://race.example".into(),
            "--label".into(),
            "Desktop".into(),
        ])
        .expect("exact local-forget arguments must parse");
        assert!(matches!(command, ParsedCommand::ForgetLocal { .. }));

        for arguments in [
            vec![
                "forget-local".into(),
                "--origin".into(),
                "https://race.example".into(),
            ],
            vec![
                "forget-local".into(),
                "--origin".into(),
                "https://race.example".into(),
                "--origin".into(),
                "https://other.example".into(),
                "--label".into(),
                "Desktop".into(),
            ],
            vec![
                "forget-local".into(),
                "--origin".into(),
                "https://race.example".into(),
                "--label".into(),
                "Desktop".into(),
                "--codex".into(),
                "C:\\synthetic\\codex.exe".into(),
            ],
        ] {
            assert!(matches!(
                parse_command(arguments),
                Err(ConnectorCliError::InvalidArguments)
            ));
        }
    }

    struct DeleteOnlyStore {
        deletes: usize,
        fail: bool,
    }

    struct UnwritableOutput;

    impl Write for UnwritableOutput {
        fn write(&mut self, _buffer: &[u8]) -> io::Result<usize> {
            Err(io::Error::other("synthetic unavailable output"))
        }

        fn flush(&mut self) -> io::Result<()> {
            Err(io::Error::other("synthetic unavailable output"))
        }
    }

    impl CredentialStore for DeleteOnlyStore {
        fn load(
            &mut self,
            _expected_origin: &[u8; 32],
        ) -> Result<Option<CredentialRecord>, ConnectorCliError> {
            unreachable!("local credential removal must not load key material")
        }

        fn save(&mut self, _record: &CredentialRecord) -> Result<(), ConnectorCliError> {
            unreachable!("local credential removal must not write key material")
        }

        fn delete(&mut self) -> Result<(), ConnectorCliError> {
            self.deletes += 1;
            if self.fail {
                Err(ConnectorCliError::SecureStorageUnavailable)
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn forgets_only_the_local_credential_with_non_reflective_output() {
        let mut store = DeleteOnlyStore {
            deletes: 0,
            fail: false,
        };
        let mut output = Vec::new();
        run_forget_local(&mut store, &mut output)
            .expect("an exact local credential deletion must succeed");
        assert_eq!(store.deletes, 1);
        assert_eq!(
            String::from_utf8(output).expect("output must be UTF-8"),
            "No credential remains in this local store. This did not revoke server device authority; review your Vibe Racing account.\n"
        );

        let mut unavailable = DeleteOnlyStore {
            deletes: 0,
            fail: true,
        };
        let mut failed_output = Vec::new();
        assert_eq!(
            run_forget_local(&mut unavailable, &mut failed_output).err(),
            Some(ConnectorCliError::SecureStorageUnavailable)
        );
        assert_eq!(unavailable.deletes, 1);
        assert!(failed_output.is_empty());

        let mut deleted_without_output = DeleteOnlyStore {
            deletes: 0,
            fail: false,
        };
        assert_eq!(
            run_forget_local(&mut deleted_without_output, &mut UnwritableOutput).err(),
            Some(ConnectorCliError::OutputUnavailable)
        );
        assert_eq!(deleted_without_output.deletes, 1);
    }

    #[test]
    fn native_delete_mapping_is_idempotent_and_fail_closed() {
        assert_eq!(map_credential_delete_result(&Ok(())), Ok(()));
        assert_eq!(
            map_credential_delete_result(&Err(keyring::Error::NoEntry)),
            Ok(())
        );
        assert_eq!(
            map_credential_delete_result(&Err(keyring::Error::BadEncoding(Vec::new()))),
            Err(ConnectorCliError::SecureStorageUnavailable)
        );
    }

    #[test]
    fn accepts_https_and_loopback_http_origins_only() {
        assert_eq!(
            Origin::parse("HTTPS://Race.Example:443")
                .expect("HTTPS default port must canonicalize")
                .value,
            "https://race.example"
        );
        assert_eq!(
            Origin::parse("http://127.0.0.1:3000")
                .expect("literal loopback development origin must validate")
                .value,
            "http://127.0.0.1:3000"
        );
        assert_eq!(
            Origin::parse("http://[::1]:3000")
                .expect("IPv6 loopback development origin must validate")
                .value,
            "http://[::1]:3000"
        );
        for invalid in [
            "http://race.example",
            "https://race.example/path",
            "https://race.example/?query=1",
            "https://user@example.invalid",
            "ftp://race.example",
        ] {
            assert_eq!(
                Origin::parse(invalid).err(),
                Some(ConnectorCliError::InvalidOrigin)
            );
        }
    }

    #[test]
    fn credential_record_round_trips_and_rejects_foreign_or_corrupt_bytes() {
        let origin = test_origin();
        let digest = digest_origin(&origin);
        let mut record = CredentialRecord::new(digest).expect("test entropy must be available");
        record
            .make_pending(&start_response(), u64::MAX)
            .expect("valid response must enter pending state");
        let mut encoded = record.encode();
        let decoded = CredentialRecord::decode(&encoded, &digest)
            .expect("closed credential record must round trip");
        assert_eq!(decoded.state, RecordState::Pending);
        assert_eq!(
            decoded.user_code().expect("stored code must be UTF-8"),
            USER_CODE
        );
        let foreign = digest_origin(&Origin::parse("https://other.example").expect("valid origin"));
        assert_eq!(
            CredentialRecord::decode(&encoded, &foreign).err(),
            Some(ConnectorCliError::SecureStorageInvalid)
        );
        encoded[STATE_INDEX] = 9;
        assert_eq!(
            CredentialRecord::decode(&encoded, &digest).err(),
            Some(ConnectorCliError::SecureStorageInvalid)
        );
        encoded.fill(0);
    }

    #[test]
    fn validates_closed_start_and_poll_responses() {
        assert!(valid_start_response(&start_response()));
        let pending = PollResponse {
            schema_version: 1,
            request_id: REQUEST_ID.to_owned(),
            device_bindings: Vec::new(),
        };
        assert!(valid_poll_response(&pending));
        let activated = PollResponse {
            schema_version: 1,
            request_id: REQUEST_ID.to_owned(),
            device_bindings: vec![DeviceBinding {
                source_id: SOURCE_ID.to_owned(),
                device_id: DEVICE_ID.to_owned(),
            }],
        };
        assert!(valid_poll_response(&activated));
        let mut invalid = start_response();
        invalid.expires_at = "2030-02-30T03:04:05.006Z".to_owned();
        assert!(!valid_start_response(&invalid));
    }

    #[test]
    fn creates_persists_and_activates_one_device_without_exposing_bindings() {
        let origin = test_origin();
        let mut store = MemoryStore {
            bytes: None,
            saves: 0,
        };
        let mut transport = ImmediateTransport {
            starts: 0,
            polls: 0,
        };
        let mut output = Vec::new();
        run_connect(
            &origin,
            "Desktop",
            "windows",
            "x86_64",
            &mut store,
            &mut transport,
            &mut output,
        )
        .expect("immediate synthetic approval must connect");
        assert_eq!(transport.starts, 1);
        assert_eq!(transport.polls, 1);
        assert_eq!(store.saves, 3);
        let text = String::from_utf8(output).expect("connector output must be UTF-8");
        assert!(text.contains("https://race.example/connect"));
        assert!(text.contains(USER_CODE));
        assert!(text.contains("Device connected."));
        assert!(!text.contains(SOURCE_ID));
        assert!(!text.contains(DEVICE_ID));
        assert!(!text.contains(POLL_TOKEN));
        let stored = CredentialRecord::decode(
            store
                .bytes
                .as_deref()
                .expect("active record must be stored"),
            &digest_origin(&origin),
        )
        .expect("active record must remain valid");
        assert_eq!(stored.state, RecordState::Active);
    }

    #[test]
    fn active_device_returns_without_network_calls() {
        let origin = test_origin();
        let digest = digest_origin(&origin);
        let mut record = CredentialRecord::new(digest).expect("test entropy must be available");
        record
            .make_active(SOURCE_ID, DEVICE_ID)
            .expect("synthetic binding must validate");
        let mut store = MemoryStore {
            bytes: Some(record.encode().to_vec()),
            saves: 0,
        };
        let mut transport = ImmediateTransport {
            starts: 0,
            polls: 0,
        };
        let mut output = Vec::new();
        run_connect(
            &origin,
            "Desktop",
            "windows",
            "x86_64",
            &mut store,
            &mut transport,
            &mut output,
        )
        .expect("active device must return cleanly");
        assert_eq!(transport.starts, 0);
        assert_eq!(transport.polls, 0);
        assert_eq!(store.saves, 0);
        assert_eq!(
            String::from_utf8(output).expect("output must be UTF-8"),
            "This device is already connected.\n"
        );
    }

    #[test]
    fn base64url_decoder_rejects_noncanonical_tail_bits() {
        assert_eq!(
            decode_base64url::<32>(POLL_TOKEN),
            Some(std::array::from_fn(|index| {
                u8::try_from(index).expect("32-byte fixture index fits in u8")
            }))
        );
        let mut noncanonical = POLL_TOKEN.to_owned();
        noncanonical.replace_range(42.., "9");
        assert!(decode_base64url::<32>(&noncanonical).is_none());
        assert!(decode_base64url::<32>(&format!("{POLL_TOKEN}=")).is_none());
    }
}
