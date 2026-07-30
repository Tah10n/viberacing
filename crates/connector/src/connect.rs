//! Bounded connector pairing command with operating-system credential storage.

use std::ffi::OsString;
use std::fmt;
use std::io::{self, Write};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::str;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ureq::Agent;
use ureq::http::Uri;
use ureq::tls::{RootCerts, TlsConfig};

use crate::admission::{ADMITTED_CODEX_VERSION, AdmissionError, admit_candidate_selection};
use crate::car_proposal::CarRecipeSelection;
use crate::pairing::{
    DiscoveryCandidateV1, DiscoveryManifestV1, PairingPollV1Signer, PairingStartV1Signer,
    PendingInstallationSigningKey, PreparedPairingStart, ReviewedPairingPollChallenge,
    valid_pairing_id,
};
use crate::sync::encode_base64url;

mod car_proposal_command;
mod credentials;
mod discovery;
mod sync_command;

use self::credentials::{
    AccountCredential, AccountState, CredentialStore, InstallationRecord, InstallationState,
    MAX_ACCOUNT_SLOTS, OsCredentialStore, SlotState,
};
use self::discovery::{DiscoveredAccount, collect_supported_accounts};

const START_PATH: &str = "/v1/connector/pairing/start";
const POLL_PATH: &str = "/v1/connector/pairing/poll";
const CONNECT_PATH: &str = "/connect";
const JSON_MEDIA_TYPE: &str = "application/json";
const REQUEST_ID_HEADER: &str = "x-request-id";
const ORIGIN_DOMAIN: &[u8] = b"viberacing-connector-origin-v1\0";
const USAGE: &str = "Usage:\n  viberacing-connector connect --origin <https-origin>\n  viberacing-connector sync [--codex <absolute-path>]\n  viberacing-connector status\n  viberacing-connector doctor\n  viberacing-connector account list\n  viberacing-connector account sync <1..16>\n  viberacing-connector disconnect\n  viberacing-connector forget-local\n  viberacing-connector check-codex [--codex <absolute-path>] [--diagnostic-preview]\n  viberacing-connector propose-car --origin <https-origin> --label <device-label> --chassis <formula|rally|roadster> --nose <classic|scoop|wedge> --cockpit <canopy|open|rally> --wing <high|low|none> --wheels <all-terrain|slick|street> --palette <magenta|mint|redline|sunburst|turbo-blue> --trail <grid|none|spark> --seed <0..65535>";
const MAX_ORIGIN_BYTES: usize = 512;
const MAX_LABEL_CHARACTERS: usize = 64;
const MAX_REQUEST_BYTES: usize = 32 * 1024;
const MAX_RESPONSE_BYTES: u64 = 16 * 1024;
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const PAIRING_LIFETIME_SECONDS: u64 = 8 * 60;
const MAX_POLL_ATTEMPTS: usize = 240;

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
    /// A pairing-start request may have committed, so automatic replay is blocked until expiry.
    PairingStartUncertain,
    /// The native store is already bound to a different exact service origin.
    DifferentConfiguredOrigin,
    /// This installation already has at least one active account binding.
    AlreadyConnected,
    /// No built-in reader produced a supported account candidate.
    NoAccounts,
    /// The requested local account selector is absent or inactive.
    InvalidAccountSelector,
    /// A discovered local account cannot be mapped uniquely to one active account credential.
    AccountMappingUnavailable,
    /// No active account-bound credential exists for the requested origin and label.
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
            Self::PairingStartUncertain => {
                "pairing start has an uncertain outcome; wait for expiry before trying again"
            }
            Self::DifferentConfiguredOrigin => {
                "this installation is already configured for a different origin"
            }
            Self::AlreadyConnected => "this installation is already connected",
            Self::NoAccounts => "no supported agent account was discovered",
            Self::InvalidAccountSelector => "the account selector is invalid",
            Self::AccountMappingUnavailable => {
                "the discovered agent account cannot be mapped safely; reconnect it"
            }
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
/// `connect` creates or resumes one installation and bounded account credentials. `sync` admits
/// one exact Codex candidate, collects only bounded daily usage, signs one request per active
/// account credential, and submits each request once.
/// `check-codex` performs only the same point-in-time candidate artifact admission, without opening
/// credential storage, starting Codex, reading an account, persisting data, or using the network.
/// Its explicit diagnostic preview contains only fixed version/admission state and remains local
/// standard output for review before the user chooses whether to share it.
/// `propose-car` signs and submits one exact enum-only `CarRecipe` with the same active credential.
/// `forget-local` removes only the fixed native-store entries and performs no server call.
///
/// # Errors
///
/// Returns a stable [`ConnectorCliError`] when arguments, the platform, storage, transport,
/// response validation, pairing expiry, or output fails closed.
pub fn run_connector_cli() -> Result<(), ConnectorCliError> {
    match parse_command(std::env::args_os().skip(1))? {
        ParsedCommand::Help => writeln!(io::stdout().lock(), "{USAGE}")
            .map_err(|_| ConnectorCliError::OutputUnavailable),
        ParsedCommand::Connect { origin } => run_connect_cli(&origin),
        ParsedCommand::ForgetLocal => {
            let mut store = OsCredentialStore::new()?;
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
        ParsedCommand::Sync { codex_path } => run_sync_cli(codex_path.as_deref()),
        ParsedCommand::Status => {
            let mut store = OsCredentialStore::new()?;
            run_status(&mut store, &mut io::stdout().lock())
        }
        ParsedCommand::Doctor => {
            let mut store = OsCredentialStore::new()?;
            run_doctor(&mut store, &mut io::stdout().lock())
        }
        ParsedCommand::AccountList => {
            let mut store = OsCredentialStore::new()?;
            run_account_list(&mut store, &mut io::stdout().lock())
        }
        ParsedCommand::AccountSync { selector } => run_account_sync_cli(selector),
        ParsedCommand::Disconnect => run_disconnect_cli(),
        ParsedCommand::ProposeCar {
            label,
            origin,
            recipe,
        } => run_propose_car_cli(&origin, &label, recipe),
    }
}

fn run_connect_cli(origin: &str) -> Result<(), ConnectorCliError> {
    let origin = Origin::parse(origin)?;
    let (os_family, architecture) = platform()?;
    let mut store = OsCredentialStore::new()?;
    let mut transport = HttpPairingTransport::new(&origin);
    let mut discover = || collect_supported_accounts(None);
    let mut browser = open_default_browser;
    let mut output = io::stdout().lock();
    let completion = {
        let mut runtime = ConnectRuntime {
            store: &mut store,
            transport: &mut transport,
            discover: &mut discover,
            open_browser: &mut browser,
            output: &mut output,
        };
        run_connect(&origin, os_family, architecture, &mut runtime)?
    };
    sync_command::run_first_sync(&origin, &mut store, &completion, &mut output)?;
    let provider_count = completion
        .active_slots
        .iter()
        .filter_map(|slot| completion.discovered_accounts.get(*slot))
        .map(|account| account.provider)
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    writeln!(
        output,
        "Connected {} account(s) across {provider_count} provider(s); current UTC week total: {} tokens.\nDashboard: {}/account",
        completion.active_slots.len(),
        completion.current_week_token_total,
        origin.value
    )
    .map_err(|_| ConnectorCliError::OutputUnavailable)
}

fn run_sync_cli(codex_path: Option<&Path>) -> Result<(), ConnectorCliError> {
    let mut store = OsCredentialStore::new()?;
    let origin = load_configured_origin(&mut store)?;
    sync_command::run_sync(&origin, codex_path, &mut store, &mut io::stdout().lock())
}

fn run_account_sync_cli(selector: usize) -> Result<(), ConnectorCliError> {
    let mut store = OsCredentialStore::new()?;
    let origin = load_configured_origin(&mut store)?;
    sync_command::run_sync_slot(&origin, selector - 1, &mut store, &mut io::stdout().lock())
}

fn run_disconnect_cli() -> Result<(), ConnectorCliError> {
    let mut store = OsCredentialStore::new()?;
    let mut browser = open_default_browser;
    run_disconnect(&mut store, &mut browser, &mut io::stdout().lock())
}

fn run_propose_car_cli(
    origin: &str,
    label: &str,
    recipe: CarRecipeSelection,
) -> Result<(), ConnectorCliError> {
    let origin = Origin::parse(origin)?;
    validate_label(label)?;
    let mut store = OsCredentialStore::new()?;
    car_proposal_command::run_car_proposal(&origin, recipe, &mut store, &mut io::stdout().lock())
}

enum ParsedCommand {
    Help,
    Connect {
        origin: String,
    },
    ForgetLocal,
    CheckCodex {
        codex_path: Option<PathBuf>,
        diagnostic_preview: bool,
    },
    Sync {
        codex_path: Option<PathBuf>,
    },
    Status,
    Doctor,
    AccountList,
    AccountSync {
        selector: usize,
    },
    Disconnect,
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
    if let Some(command) = parse_fixed_command(&arguments) {
        return command;
    }
    let command = arguments
        .first()
        .map(String::as_str)
        .ok_or(ConnectorCliError::InvalidArguments)?;
    if !is_bounded_command(command) {
        return Err(ConnectorCliError::InvalidArguments);
    }
    parse_parameterized_command(command, &arguments[1..])
}

fn parse_fixed_command(arguments: &[String]) -> Option<Result<ParsedCommand, ConnectorCliError>> {
    if arguments == ["--help"] || arguments == ["-h"] {
        return Some(Ok(ParsedCommand::Help));
    }
    if arguments == ["status"] {
        return Some(Ok(ParsedCommand::Status));
    }
    if arguments == ["doctor"] {
        return Some(Ok(ParsedCommand::Doctor));
    }
    if arguments == ["disconnect"] {
        return Some(Ok(ParsedCommand::Disconnect));
    }
    if arguments == ["forget-local"] {
        return Some(Ok(ParsedCommand::ForgetLocal));
    }
    if arguments == ["account", "list"] {
        return Some(Ok(ParsedCommand::AccountList));
    }
    if arguments.first().is_some_and(|value| value == "account") {
        let selector = (arguments.len() == 3 && arguments[1] == "sync")
            .then(|| arguments[2].parse::<usize>().ok())
            .flatten()
            .filter(|value| (1..=MAX_ACCOUNT_SLOTS).contains(value))
            .filter(|value| value.to_string() == arguments[2]);
        return Some(
            selector
                .map(|selector| ParsedCommand::AccountSync { selector })
                .ok_or(ConnectorCliError::InvalidArguments),
        );
    }
    if arguments == ["sync"] {
        return Some(Ok(ParsedCommand::Sync { codex_path: None }));
    }
    None
}

fn parse_parameterized_command(
    command: &str,
    arguments: &[String],
) -> Result<ParsedCommand, ConnectorCliError> {
    let mut origin = None;
    let mut label = None;
    let mut codex_path = None;
    let mut diagnostic_preview = false;
    let mut pending_recipe = PendingCarRecipeSelection::default();
    let mut index = 0;
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
            "--origin" if matches!(command, "connect" | "propose-car") && origin.is_none() => {
                origin = Some(value.clone());
            }
            "--label" if command == "propose-car" && label.is_none() => {
                label = Some(value.clone());
            }
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
        ("connect", Some(origin), None, None) => Ok(ParsedCommand::Connect { origin }),
        ("check-codex", None, None, codex_path) => Ok(ParsedCommand::CheckCodex {
            codex_path,
            diagnostic_preview,
        }),
        ("sync", None, None, codex_path) => Ok(ParsedCommand::Sync { codex_path }),
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
        "account"
            | "connect"
            | "disconnect"
            | "doctor"
            | "forget-local"
            | "check-codex"
            | "status"
            | "sync"
            | "propose-car"
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

fn map_credential_delete_result(result: &keyring::Result<()>) -> Result<(), ConnectorCliError> {
    match result {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(ConnectorCliError::SecureStorageUnavailable),
    }
}

fn digest_origin(origin: &Origin) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(ORIGIN_DOMAIN);
    hasher.update(origin.value.as_bytes());
    hasher.finalize().into()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct StartResponse {
    schema_version: u8,
    request_id: String,
    pairing_id: String,
    poll_token: String,
    pairing_challenge: String,
    user_code: String,
    approval_url: String,
    expires_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PollRequest<'a> {
    schema_version: u8,
    pairing_id: &'a str,
    poll_token: &'a str,
    possession_signature: &'a str,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
enum PairingState {
    Activated,
    Approved,
    Expired,
    Pending,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PollResponse {
    schema_version: u8,
    request_id: String,
    pairing_state: PairingState,
    candidate_activations: Vec<CandidateActivation>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CandidateActivation {
    candidate_id: String,
    activation_state: ActivationState,
    agent_account_id: Option<String>,
    device_id: Option<String>,
    server_binding_material: Option<ServerBindingMaterial>,
    next_action: NextAction,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
enum ActivationState {
    Active,
    Pending,
    Skipped,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ServerBindingMaterial {
    device_key_id: String,
    usage_endpoint: String,
    signature_protocol: String,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
enum NextAction {
    None,
    ReconnectAccount,
    Sync,
    UpdateConnector,
    Wait,
}

enum StartTransportOutcome {
    Created(StartResponse),
    Retryable,
}

enum PollTransportOutcome {
    Pending,
    Activated(Vec<CandidateActivation>),
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
        request: &PreparedPairingStart,
    ) -> Result<StartTransportOutcome, TransportError>;
    fn poll(&mut self, request: &PollRequest<'_>) -> Result<PollTransportOutcome, TransportError>;
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
        request: &PreparedPairingStart,
    ) -> Result<StartTransportOutcome, TransportError> {
        match self.post(START_PATH, request, false)? {
            HttpOutcome::Success(success) => {
                let response: StartResponse = serde_json::from_slice(&success.body)
                    .map_err(|_| TransportError::InvalidResponse)?;
                if !valid_start_response(&response, &self.origin)
                    || response.request_id != success.request_id
                {
                    return Err(TransportError::InvalidResponse);
                }
                Ok(StartTransportOutcome::Created(response))
            }
            HttpOutcome::Retryable => Ok(StartTransportOutcome::Retryable),
            HttpOutcome::Expired => Err(TransportError::InvalidResponse),
        }
    }

    fn poll(&mut self, request: &PollRequest<'_>) -> Result<PollTransportOutcome, TransportError> {
        match self.post(POLL_PATH, request, true)? {
            HttpOutcome::Success(success) => {
                let response: PollResponse = serde_json::from_slice(&success.body)
                    .map_err(|_| TransportError::InvalidResponse)?;
                if !valid_poll_response(&response) || response.request_id != success.request_id {
                    return Err(TransportError::InvalidResponse);
                }
                match response.pairing_state {
                    PairingState::Activated => Ok(PollTransportOutcome::Activated(
                        response.candidate_activations,
                    )),
                    PairingState::Approved | PairingState::Pending => {
                        Ok(PollTransportOutcome::Pending)
                    }
                    PairingState::Expired => Ok(PollTransportOutcome::Expired),
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

fn valid_start_response(response: &StartResponse, origin: &str) -> bool {
    response.schema_version == 1
        && valid_public_id(&response.request_id, "req_")
        && valid_pairing_id(&response.pairing_id)
        && decode_base64url::<32>(&response.poll_token).is_some_and(|value| !all_zero(&value))
        && decode_base64url::<32>(&response.pairing_challenge)
            .is_some_and(|value| !all_zero(&value))
        && valid_user_code(&response.user_code)
        && response.approval_url == format!("{origin}{CONNECT_PATH}?code={}", response.user_code)
        && valid_utc_millisecond_timestamp(&response.expires_at)
}

fn valid_poll_response(response: &PollResponse) -> bool {
    let array_shape = match response.pairing_state {
        PairingState::Activated => {
            !response.candidate_activations.is_empty()
                && response.candidate_activations.len() <= MAX_ACCOUNT_SLOTS
        }
        PairingState::Approved | PairingState::Expired | PairingState::Pending => {
            response.candidate_activations.is_empty()
        }
    };
    response.schema_version == 1
        && valid_public_id(&response.request_id, "req_")
        && array_shape
        && response
            .candidate_activations
            .iter()
            .enumerate()
            .all(|(index, activation)| {
                valid_prefixed_id(&activation.candidate_id, "cand_", 27)
                    && response.candidate_activations[..index]
                        .iter()
                        .all(|seen| seen.candidate_id != activation.candidate_id)
                    && valid_candidate_activation(activation)
            })
}

fn valid_candidate_activation(activation: &CandidateActivation) -> bool {
    match activation.activation_state {
        ActivationState::Active => {
            activation
                .agent_account_id
                .as_deref()
                .is_some_and(|value| valid_public_id(value, "acc_"))
                && activation
                    .device_id
                    .as_deref()
                    .is_some_and(|value| valid_public_id(value, "dev_"))
                && activation
                    .server_binding_material
                    .as_ref()
                    .is_some_and(|binding| {
                        valid_public_id(&binding.device_key_id, "key_")
                            && binding.usage_endpoint == "/v1/usage"
                            && binding.signature_protocol == "viberacing-usage-sync-auth-v1"
                    })
                && activation.next_action == NextAction::Sync
        }
        ActivationState::Skipped => {
            activation.agent_account_id.is_none()
                && activation.device_id.is_none()
                && activation.server_binding_material.is_none()
                && activation.next_action == NextAction::None
        }
        ActivationState::Pending => false,
    }
}

fn valid_public_id(value: &str, prefix: &str) -> bool {
    value.len() == 26
        && value.starts_with(prefix)
        && value[prefix.len()..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_prefixed_id(value: &str, prefix: &str, expected_length: usize) -> bool {
    value.len() == expected_length
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

struct ConnectCompletion {
    discovered_accounts: Vec<DiscoveredAccount>,
    active_slots: Vec<usize>,
    current_week_token_total: String,
}

struct ConnectRuntime<'a> {
    store: &'a mut dyn CredentialStore,
    transport: &'a mut dyn PairingTransport,
    discover: &'a mut dyn FnMut() -> Result<Vec<DiscoveredAccount>, ConnectorCliError>,
    open_browser: &'a mut dyn FnMut(&str) -> bool,
    output: &'a mut dyn Write,
}

fn run_connect(
    origin: &Origin,
    os_family: &'static str,
    architecture: &'static str,
    runtime: &mut ConnectRuntime<'_>,
) -> Result<ConnectCompletion, ConnectorCliError> {
    let mut installation = if let Some(record) = runtime.store.load_installation()? {
        if record.origin()?.value != origin.value {
            return Err(ConnectorCliError::DifferentConfiguredOrigin);
        }
        record
    } else {
        let record = InstallationRecord::new(origin)?;
        runtime.store.save_installation(&record)?;
        record
    };

    if installation.state == InstallationState::Active {
        return Err(ConnectorCliError::AlreadyConnected);
    }
    if matches!(
        installation.state,
        InstallationState::Starting | InstallationState::Pending
    ) && now_epoch_seconds()? >= installation.deadline
    {
        clear_pending_accounts(&installation, runtime.store)?;
        installation.reset_expired();
        runtime.store.save_installation(&installation)?;
    }
    if installation.state == InstallationState::Starting {
        return Err(ConnectorCliError::PairingStartUncertain);
    }

    let mut discovered_accounts = Vec::new();
    if installation.state == InstallationState::Prepared {
        discovered_accounts = (runtime.discover)()?;
        if discovered_accounts.is_empty() || discovered_accounts.len() > MAX_ACCOUNT_SLOTS {
            return Err(ConnectorCliError::NoAccounts);
        }
        write_discovery_preview(&discovered_accounts, runtime.output)?;
        start_pairing(
            origin,
            os_family,
            architecture,
            &mut installation,
            &discovered_accounts,
            runtime.store,
            runtime.transport,
        )?;
    }

    let approval_url = format!(
        "{}{CONNECT_PATH}?code={}",
        origin.value,
        installation.user_code()?
    );
    writeln!(
        runtime.output,
        "Approve this installation in your browser:\n{approval_url}\nFallback code: {}",
        installation.user_code()?
    )
    .map_err(|_| ConnectorCliError::OutputUnavailable)?;
    let _ = (runtime.open_browser)(&approval_url);
    write_line(runtime.output, "Waiting for one batch approval...")?;

    let active_slots = poll_for_activation(&mut installation, runtime)?;

    if discovered_accounts.is_empty() && !active_slots.is_empty() {
        discovered_accounts = (runtime.discover)()?;
    }
    let (week_start, week_end) = current_utc_week_dates(SystemTime::now())?;
    let current_week_token_total =
        sum_discovered_usage(&discovered_accounts, &week_start, &week_end)?;
    Ok(ConnectCompletion {
        discovered_accounts,
        active_slots,
        current_week_token_total,
    })
}

fn poll_for_activation(
    installation: &mut InstallationRecord,
    runtime: &mut ConnectRuntime<'_>,
) -> Result<Vec<usize>, ConnectorCliError> {
    let pairing_id = installation.pairing_id()?.to_owned();
    let key = PendingInstallationSigningKey::from_secret_key(installation.secret_key);
    let context =
        ReviewedPairingPollChallenge::from_reviewed_response(&pairing_id, installation.challenge);
    let proof = PairingPollV1Signer::sign(key, context)
        .map_err(|_| ConnectorCliError::SecureStorageInvalid)?;
    let poll_token = encode_base64url(&installation.poll_token);
    let request = PollRequest {
        schema_version: 1,
        pairing_id: &pairing_id,
        poll_token: &poll_token,
        possession_signature: proof.signature(),
    };
    for attempt in 0..MAX_POLL_ATTEMPTS {
        if now_epoch_seconds()? >= installation.deadline {
            return expire_pairing(installation, runtime.store);
        }
        match runtime
            .transport
            .poll(&request)
            .map_err(map_cli_transport_error)?
        {
            PollTransportOutcome::Activated(activations) => {
                return apply_activations(installation, activations, runtime.store);
            }
            PollTransportOutcome::Expired => {
                return expire_pairing(installation, runtime.store);
            }
            PollTransportOutcome::Pending | PollTransportOutcome::Retryable => {
                if attempt + 1 < MAX_POLL_ATTEMPTS {
                    thread::sleep(POLL_INTERVAL);
                }
            }
        }
    }
    expire_pairing(installation, runtime.store)
}

fn start_pairing(
    origin: &Origin,
    os_family: &'static str,
    architecture: &'static str,
    installation: &mut InstallationRecord,
    discovered_accounts: &[DiscoveredAccount],
    store: &mut dyn CredentialStore,
    transport: &mut dyn PairingTransport,
) -> Result<(), ConnectorCliError> {
    let prepared = prepare_pairing_start(
        os_family,
        architecture,
        installation,
        discovered_accounts,
        store,
    )?;
    let uncertain_deadline = now_epoch_seconds()?
        .checked_add(10 * 60)
        .ok_or(ConnectorCliError::ServiceUnavailable)?;
    installation.make_starting(
        uncertain_deadline,
        prepared.manifest_digest,
        &prepared.candidate_ids,
    )?;
    store.save_installation(installation)?;

    let response = match transport.start(&prepared.request) {
        Ok(StartTransportOutcome::Created(response)) => response,
        Ok(StartTransportOutcome::Retryable) | Err(_) => {
            return Err(ConnectorCliError::PairingStartUncertain);
        }
    };
    persist_pending_start(origin, installation, store, &prepared, &response)
}

struct PairingStartMaterial {
    request: PreparedPairingStart,
    candidate_ids: Vec<String>,
    manifest_digest: [u8; 32],
}

fn prepare_pairing_start(
    os_family: &'static str,
    architecture: &'static str,
    installation: &InstallationRecord,
    discovered_accounts: &[DiscoveredAccount],
    store: &mut dyn CredentialStore,
) -> Result<PairingStartMaterial, ConnectorCliError> {
    for slot in 0..MAX_ACCOUNT_SLOTS {
        store.delete_account(slot)?;
    }
    let (candidates, candidate_ids) =
        prepare_discovery_candidates(installation, discovered_accounts, store)?;
    let key = PendingInstallationSigningKey::from_secret_key(installation.secret_key);
    let installation_public_key = encode_base64url(&key.verifying_key_bytes());
    let manifest =
        DiscoveryManifestV1::new(installation_public_key, os_family, architecture, candidates)
            .map_err(|_| ConnectorCliError::SyncPreparationUnavailable)?;
    let client_id = encode_base64url(&installation.client_rate_id);
    let signed_at = sync_command::format_utc_milliseconds(SystemTime::now())?;
    let mut nonce = [0_u8; 16];
    getrandom::fill(&mut nonce).map_err(|_| ConnectorCliError::EntropyUnavailable)?;
    let request = PairingStartV1Signer::sign(key, manifest, client_id.clone(), signed_at, nonce)
        .map_err(|_| ConnectorCliError::SyncPreparationUnavailable)?;
    Ok(PairingStartMaterial {
        manifest_digest: *request.manifest_digest(),
        request,
        candidate_ids,
    })
}

fn prepare_discovery_candidates(
    installation: &InstallationRecord,
    discovered_accounts: &[DiscoveredAccount],
    store: &mut dyn CredentialStore,
) -> Result<(Vec<DiscoveryCandidateV1>, Vec<String>), ConnectorCliError> {
    let (week_start, week_end) = current_utc_week_dates(SystemTime::now())?;
    let mut candidates = Vec::with_capacity(discovered_accounts.len());
    let mut candidate_ids = Vec::with_capacity(discovered_accounts.len());
    for (slot, account) in discovered_accounts.iter().enumerate() {
        let candidate_id = fresh_identifier("cand_")?;
        let prepared = prepare_discovery_candidate(
            installation.origin_digest,
            account,
            candidate_id.clone(),
            &week_start,
            &week_end,
        );
        let (record, candidate) = match prepared {
            Ok(value) => value,
            Err(error) => {
                clear_created_accounts(store, slot)?;
                return Err(error);
            }
        };
        if let Err(error) = store.save_account(slot, &record) {
            clear_created_accounts(store, slot + 1)?;
            return Err(error);
        }
        candidate_ids.push(candidate_id);
        candidates.push(candidate);
    }
    Ok((candidates, candidate_ids))
}

fn prepare_discovery_candidate(
    origin_digest: [u8; 32],
    account: &DiscoveredAccount,
    candidate_id: String,
    week_start: &str,
    week_end: &str,
) -> Result<(AccountCredential, DiscoveryCandidateV1), ConnectorCliError> {
    let mut account_secret = [0_u8; 32];
    getrandom::fill(&mut account_secret).map_err(|_| ConnectorCliError::EntropyUnavailable)?;
    if all_zero(&account_secret) {
        account_secret.fill(0);
        return Err(ConnectorCliError::EntropyUnavailable);
    }
    let sync_public_key = {
        let key = ed25519_dalek::SigningKey::from_bytes(&account_secret);
        encode_base64url(&key.verifying_key().to_bytes())
    };
    let record =
        AccountCredential::new_pending(origin_digest, &candidate_id, account, account_secret)?;
    let candidate = DiscoveryCandidateV1::new(
        candidate_id,
        account.provider,
        account.reader_version,
        account.accounting_revision,
        account.scope_kind,
        account.fingerprint_kind,
        account.account_fingerprint_digest.clone(),
        account.safe_display_label.clone(),
        sync_public_key,
        account.total_for_dates(week_start, week_end)?,
        account.last_usage_date(),
        account.status,
    )
    .map_err(|_| ConnectorCliError::SyncPreparationUnavailable)?;
    Ok((record, candidate))
}

fn persist_pending_start(
    origin: &Origin,
    installation: &mut InstallationRecord,
    store: &mut dyn CredentialStore,
    prepared: &PairingStartMaterial,
    response: &StartResponse,
) -> Result<(), ConnectorCliError> {
    if response.approval_url
        != format!("{}{CONNECT_PATH}?code={}", origin.value, response.user_code)
    {
        return Err(ConnectorCliError::InvalidServiceResponse);
    }
    let deadline = now_epoch_seconds()?
        .checked_add(PAIRING_LIFETIME_SECONDS)
        .ok_or(ConnectorCliError::ServiceUnavailable)?;
    let poll_token =
        decode_base64url(&response.poll_token).ok_or(ConnectorCliError::InvalidServiceResponse)?;
    let challenge = decode_base64url(&response.pairing_challenge)
        .ok_or(ConnectorCliError::InvalidServiceResponse)?;
    installation.make_pending(
        &response.pairing_id,
        poll_token,
        challenge,
        &response.user_code,
        deadline,
        prepared.manifest_digest,
        &prepared.candidate_ids,
    )?;
    store.save_installation(installation)
}

fn apply_activations(
    installation: &mut InstallationRecord,
    activations: Vec<CandidateActivation>,
    store: &mut dyn CredentialStore,
) -> Result<Vec<usize>, ConnectorCliError> {
    let pending_slots = installation
        .populated_slots()
        .filter(|slot| installation.slot_state(*slot) == Some(SlotState::Pending))
        .collect::<Vec<_>>();
    if activations.len() != pending_slots.len() {
        return Err(ConnectorCliError::InvalidServiceResponse);
    }
    let mut active_slots = Vec::new();
    let mut skipped_slots = Vec::new();
    for activation in activations {
        let slot = pending_slots
            .iter()
            .copied()
            .find(|slot| {
                installation
                    .candidate_id(*slot)
                    .ok()
                    .flatten()
                    .is_some_and(|value| value == activation.candidate_id)
            })
            .ok_or(ConnectorCliError::InvalidServiceResponse)?;
        if active_slots.contains(&slot) || skipped_slots.contains(&slot) {
            return Err(ConnectorCliError::InvalidServiceResponse);
        }
        match activation.activation_state {
            ActivationState::Active => {
                let mut account = store
                    .load_account(slot, &installation.origin_digest)?
                    .ok_or(ConnectorCliError::SecureStorageInvalid)?;
                if account.candidate_id()? != activation.candidate_id {
                    return Err(ConnectorCliError::SecureStorageInvalid);
                }
                let binding = activation
                    .server_binding_material
                    .as_ref()
                    .ok_or(ConnectorCliError::InvalidServiceResponse)?;
                account.make_active(
                    activation
                        .agent_account_id
                        .as_deref()
                        .ok_or(ConnectorCliError::InvalidServiceResponse)?,
                    activation
                        .device_id
                        .as_deref()
                        .ok_or(ConnectorCliError::InvalidServiceResponse)?,
                    &binding.device_key_id,
                )?;
                store.save_account(slot, &account)?;
                active_slots.push(slot);
            }
            ActivationState::Skipped => {
                store.delete_account(slot)?;
                skipped_slots.push(slot);
            }
            ActivationState::Pending => {
                return Err(ConnectorCliError::InvalidServiceResponse);
            }
        }
    }
    installation.finish_activation(&active_slots, &skipped_slots)?;
    store.save_installation(installation)?;
    Ok(active_slots)
}

fn clear_created_accounts(
    store: &mut dyn CredentialStore,
    count: usize,
) -> Result<(), ConnectorCliError> {
    let mut failed = false;
    for slot in 0..count.min(MAX_ACCOUNT_SLOTS) {
        if store.delete_account(slot).is_err() {
            failed = true;
        }
    }
    if failed {
        Err(ConnectorCliError::SecureStorageUnavailable)
    } else {
        Ok(())
    }
}

fn clear_pending_accounts(
    installation: &InstallationRecord,
    store: &mut dyn CredentialStore,
) -> Result<(), ConnectorCliError> {
    let slots = installation.populated_slots().collect::<Vec<_>>();
    let mut failed = false;
    for slot in slots {
        if store.delete_account(slot).is_err() {
            failed = true;
        }
    }
    if failed {
        Err(ConnectorCliError::SecureStorageUnavailable)
    } else {
        Ok(())
    }
}

fn expire_pairing<T>(
    installation: &mut InstallationRecord,
    store: &mut dyn CredentialStore,
) -> Result<T, ConnectorCliError> {
    clear_pending_accounts(installation, store)?;
    installation.reset_expired();
    store.save_installation(installation)?;
    Err(ConnectorCliError::PairingExpired)
}

fn write_discovery_preview(
    accounts: &[DiscoveredAccount],
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    let (week_start, week_end) = current_utc_week_dates(SystemTime::now())?;
    write_line(output, "Detected accounts:")?;
    for account in accounts {
        let provider = match account.provider {
            crate::reader::AgentProvider::Codex => "Codex",
        };
        writeln!(
            output,
            "  {provider} — {} — {} tokens this week",
            account.safe_display_label,
            account.total_for_dates(&week_start, &week_end)?
        )
        .map_err(|_| ConnectorCliError::OutputUnavailable)?;
    }
    write_line(
        output,
        "Only UTC dates and aggregate token totals will be sent. Prompts, code, repositories, paths, and credentials remain local.",
    )
}

fn sum_discovered_usage(
    accounts: &[DiscoveredAccount],
    first_date: &str,
    last_date: &str,
) -> Result<String, ConnectorCliError> {
    let mut total = 0_u128;
    for account in accounts {
        total = total
            .checked_add(
                account
                    .total_for_dates(first_date, last_date)?
                    .parse::<u128>()
                    .map_err(|_| ConnectorCliError::CodexUnavailable)?,
            )
            .ok_or(ConnectorCliError::CodexUnavailable)?;
    }
    Ok(total.to_string())
}

fn current_utc_week_dates(time: SystemTime) -> Result<(String, String), ConnectorCliError> {
    let seconds = time
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ConnectorCliError::SyncPreparationUnavailable)?
        .as_secs();
    let days = i64::try_from(seconds / 86_400)
        .map_err(|_| ConnectorCliError::SyncPreparationUnavailable)?;
    let monday = days - (days + 3).rem_euclid(7);
    Ok((format_utc_date(monday)?, format_utc_date(monday + 6)?))
}

fn format_utc_date(days_since_unix_epoch: i64) -> Result<String, ConnectorCliError> {
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
    if !(2000..=2099).contains(&year) {
        return Err(ConnectorCliError::SyncPreparationUnavailable);
    }
    Ok(format!("{year:04}-{month:02}-{day:02}"))
}

fn fresh_identifier(prefix: &str) -> Result<String, ConnectorCliError> {
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|_| ConnectorCliError::EntropyUnavailable)?;
    if all_zero(&random) {
        random.fill(0);
        return Err(ConnectorCliError::EntropyUnavailable);
    }
    let identifier = format!("{prefix}{}", encode_base64url(&random));
    random.fill(0);
    Ok(identifier)
}

fn open_default_browser(url: &str) -> bool {
    use std::process::{Command, Stdio};

    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler").arg(url);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("/usr/bin/open");
        command.arg(url);
        command
    } else if cfg!(target_os = "linux") {
        let mut command = Command::new("/usr/bin/xdg-open");
        command.arg(url);
        command
    } else {
        return false;
    };
    command
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
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
    store.delete_all()?;
    write_line(
        output,
        "Local credentials were removed. Server device authority was not revoked; revoke the device in the Vibe Racing dashboard to disconnect completely.",
    )
}

fn load_configured_origin(store: &mut dyn CredentialStore) -> Result<Origin, ConnectorCliError> {
    store
        .load_installation()?
        .ok_or(ConnectorCliError::NotConnected)?
        .origin()
}

fn run_status(
    store: &mut dyn CredentialStore,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    let Some(installation) = store.load_installation()? else {
        return write_line(output, "Connector status: disconnected.");
    };
    let state = match installation.state {
        InstallationState::Prepared => "not_connected",
        InstallationState::Starting => "pairing_start_uncertain",
        InstallationState::Pending => "pairing_pending",
        InstallationState::Active => "connected",
    };
    let mut account_count = 0_usize;
    let mut providers = std::collections::BTreeSet::new();
    let mut last_sync = 0_u64;
    for slot in installation.active_slots() {
        let account = store
            .load_account(slot, &installation.origin_digest)?
            .ok_or(ConnectorCliError::SecureStorageInvalid)?;
        if account.state != AccountState::Active {
            return Err(ConnectorCliError::SecureStorageInvalid);
        }
        account_count += 1;
        providers.insert(account.provider());
        last_sync = last_sync.max(account.last_sync_epoch_seconds);
    }
    let last_sync = if last_sync == 0 {
        "never".to_owned()
    } else {
        sync_command::format_utc_milliseconds(UNIX_EPOCH + Duration::from_secs(last_sync))?
    };
    write!(
        output,
        "Connector status: {state}\nActive accounts: {account_count}\nActive providers: {}\nLast successful sync: {last_sync}\n",
        providers.len()
    )
    .map_err(|_| ConnectorCliError::OutputUnavailable)
}

fn run_doctor(
    store: &mut dyn CredentialStore,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    let (os_family, architecture) = platform()?;
    let installation_state = match store.load_installation()? {
        None => "absent",
        Some(record) => match record.state {
            InstallationState::Prepared => "prepared",
            InstallationState::Starting => "pairing_start_uncertain",
            InstallationState::Pending => "pairing_pending",
            InstallationState::Active => "active",
        },
    };
    let codex_admission = match admit_candidate_selection(None) {
        Ok(_) => "admitted_candidate",
        Err(AdmissionError::UnsupportedPlatform) => "unsupported_platform",
        Err(
            AdmissionError::DiscoveryUnavailable
            | AdmissionError::InvalidPath
            | AdmissionError::UnsupportedArtifact,
        ) => "not_admitted",
    };
    write!(
        output,
        "Connector doctor v1\nPlatform: {os_family}-{architecture}\nNative credential store: available\nInstallation: {installation_state}\nCodex reader: {codex_admission}\nNetwork check: not performed\nSensitive data: not included\n"
    )
    .map_err(|_| ConnectorCliError::OutputUnavailable)
}

fn run_account_list(
    store: &mut dyn CredentialStore,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    let installation = store
        .load_installation()?
        .ok_or(ConnectorCliError::NotConnected)?;
    if installation.state != InstallationState::Active {
        return Err(ConnectorCliError::NotConnected);
    }
    write_line(output, "Connected accounts:")?;
    let mut count = 0_usize;
    for slot in installation.active_slots() {
        let account = store
            .load_account(slot, &installation.origin_digest)?
            .ok_or(ConnectorCliError::SecureStorageInvalid)?;
        if account.state != AccountState::Active {
            return Err(ConnectorCliError::SecureStorageInvalid);
        }
        let provider = match account.provider() {
            crate::reader::AgentProvider::Codex => "Codex",
        };
        let last_sync = if account.last_sync_epoch_seconds == 0 {
            "never".to_owned()
        } else {
            sync_command::format_utc_milliseconds(
                UNIX_EPOCH + Duration::from_secs(account.last_sync_epoch_seconds),
            )?
        };
        writeln!(
            output,
            "  {}. {provider} — {} — connected — reader {} — accounting revision {} — last sync {last_sync}",
            slot + 1,
            account.safe_display_label()?,
            account.reader_version()?,
            account.accounting_revision,
        )
        .map_err(|_| ConnectorCliError::OutputUnavailable)?;
        count += 1;
    }
    if count == 0 {
        return Err(ConnectorCliError::NotConnected);
    }
    Ok(())
}

fn run_disconnect(
    store: &mut dyn CredentialStore,
    open_browser: &mut dyn FnMut(&str) -> bool,
    output: &mut dyn Write,
) -> Result<(), ConnectorCliError> {
    let installation = store
        .load_installation()?
        .ok_or(ConnectorCliError::NotConnected)?;
    if installation.state != InstallationState::Active {
        return Err(ConnectorCliError::NotConnected);
    }
    let dashboard = format!("{}/account#devices", installation.origin()?.value);
    writeln!(
        output,
        "Device revocation requires a fresh passkey in the dashboard. Local credentials remain until revocation is complete.\n{dashboard}"
    )
    .map_err(|_| ConnectorCliError::OutputUnavailable)?;
    let _ = open_browser(&dashboard);
    Ok(())
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
    const PAIRING_ID: &str = "pair_AAAAAAAAAAAAAAAAAAAAAA";
    const POLL_TOKEN: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    const CHALLENGE: &str = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
    const USER_CODE: &str = "ABCD-EFGH-JKLM";
    const CANDIDATE_ID: &str = "cand_AAAAAAAAAAAAAAAAAAAAAA";
    const AGENT_ACCOUNT_ID: &str = "acc_AAAAAAAAAAAAAAAAAAAAAA";
    const DEVICE_ID: &str = "dev_BBBBBBBBBBBBBBBBBBBBBB";
    const DEVICE_KEY_ID: &str = "key_CCCCCCCCCCCCCCCCCCCCCC";

    struct MemoryStore {
        installation: Option<Vec<u8>>,
        accounts: [Option<Vec<u8>>; MAX_ACCOUNT_SLOTS],
        saves: usize,
    }

    impl MemoryStore {
        fn empty() -> Self {
            Self {
                installation: None,
                accounts: std::array::from_fn(|_| None),
                saves: 0,
            }
        }
    }

    impl CredentialStore for MemoryStore {
        fn load_installation(&mut self) -> Result<Option<InstallationRecord>, ConnectorCliError> {
            self.installation
                .as_deref()
                .map(InstallationRecord::decode)
                .transpose()
        }

        fn save_installation(
            &mut self,
            record: &InstallationRecord,
        ) -> Result<(), ConnectorCliError> {
            self.installation = Some(record.encode().to_vec());
            self.saves += 1;
            Ok(())
        }

        fn load_account(
            &mut self,
            slot: usize,
            expected_origin: &[u8; 32],
        ) -> Result<Option<AccountCredential>, ConnectorCliError> {
            self.accounts
                .get(slot)
                .ok_or(ConnectorCliError::SecureStorageInvalid)?
                .as_deref()
                .map(|bytes| AccountCredential::decode(bytes, expected_origin))
                .transpose()
        }

        fn save_account(
            &mut self,
            slot: usize,
            record: &AccountCredential,
        ) -> Result<(), ConnectorCliError> {
            *self
                .accounts
                .get_mut(slot)
                .ok_or(ConnectorCliError::SecureStorageInvalid)? = Some(record.encode().to_vec());
            self.saves += 1;
            Ok(())
        }

        fn delete_account(&mut self, slot: usize) -> Result<(), ConnectorCliError> {
            *self
                .accounts
                .get_mut(slot)
                .ok_or(ConnectorCliError::SecureStorageInvalid)? = None;
            Ok(())
        }

        fn delete_all(&mut self) -> Result<(), ConnectorCliError> {
            self.installation = None;
            self.accounts.fill_with(|| None);
            Ok(())
        }
    }

    struct ImmediateTransport {
        starts: usize,
        polls: usize,
        candidate_id: Option<String>,
    }

    impl PairingTransport for ImmediateTransport {
        fn start(
            &mut self,
            request: &PreparedPairingStart,
        ) -> Result<StartTransportOutcome, TransportError> {
            self.starts += 1;
            let request = serde_json::to_value(request).unwrap();
            assert_eq!(request["schemaVersion"], 1);
            assert_eq!(
                request["discoveryManifest"]["candidates"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
            self.candidate_id = request["discoveryManifest"]["candidates"][0]["candidateId"]
                .as_str()
                .map(str::to_owned);
            assert!(
                self.candidate_id
                    .as_deref()
                    .is_some_and(|value| valid_prefixed_id(value, "cand_", 27))
            );
            assert_eq!(
                request["installationPossessionProof"]["signature"]
                    .as_str()
                    .unwrap()
                    .len(),
                86
            );
            Ok(StartTransportOutcome::Created(start_response()))
        }

        fn poll(
            &mut self,
            request: &PollRequest<'_>,
        ) -> Result<PollTransportOutcome, TransportError> {
            self.polls += 1;
            assert_eq!(request.schema_version, 1);
            assert_eq!(request.pairing_id, PAIRING_ID);
            assert_eq!(request.poll_token, POLL_TOKEN);
            assert_eq!(request.possession_signature.len(), 86);
            Ok(PollTransportOutcome::Activated(vec![CandidateActivation {
                candidate_id: self
                    .candidate_id
                    .clone()
                    .expect("start must capture one candidate"),
                activation_state: ActivationState::Active,
                agent_account_id: Some(AGENT_ACCOUNT_ID.to_owned()),
                device_id: Some(DEVICE_ID.to_owned()),
                server_binding_material: Some(ServerBindingMaterial {
                    device_key_id: DEVICE_KEY_ID.to_owned(),
                    usage_endpoint: "/v1/usage".to_owned(),
                    signature_protocol: "viberacing-usage-sync-auth-v1".to_owned(),
                }),
                next_action: NextAction::Sync,
            }]))
        }
    }

    struct UncertainStartTransport {
        starts: usize,
    }

    impl PairingTransport for UncertainStartTransport {
        fn start(
            &mut self,
            _request: &PreparedPairingStart,
        ) -> Result<StartTransportOutcome, TransportError> {
            self.starts += 1;
            Ok(StartTransportOutcome::Retryable)
        }

        fn poll(
            &mut self,
            _request: &PollRequest<'_>,
        ) -> Result<PollTransportOutcome, TransportError> {
            panic!("an uncertain start must never be polled")
        }
    }

    struct BatchTransport {
        candidate_ids: Vec<String>,
    }

    impl PairingTransport for BatchTransport {
        fn start(
            &mut self,
            request: &PreparedPairingStart,
        ) -> Result<StartTransportOutcome, TransportError> {
            let request = serde_json::to_value(request).expect("start request must serialize");
            self.candidate_ids = request["discoveryManifest"]["candidates"]
                .as_array()
                .expect("candidate manifest must be an array")
                .iter()
                .map(|candidate| {
                    candidate["candidateId"]
                        .as_str()
                        .expect("candidate ID must be a string")
                        .to_owned()
                })
                .collect();
            assert_eq!(self.candidate_ids.len(), 2);
            Ok(StartTransportOutcome::Created(start_response()))
        }

        fn poll(
            &mut self,
            _request: &PollRequest<'_>,
        ) -> Result<PollTransportOutcome, TransportError> {
            Ok(PollTransportOutcome::Activated(vec![
                CandidateActivation {
                    candidate_id: self.candidate_ids[0].clone(),
                    activation_state: ActivationState::Active,
                    agent_account_id: Some(AGENT_ACCOUNT_ID.to_owned()),
                    device_id: Some(DEVICE_ID.to_owned()),
                    server_binding_material: Some(ServerBindingMaterial {
                        device_key_id: DEVICE_KEY_ID.to_owned(),
                        usage_endpoint: "/v1/usage".to_owned(),
                        signature_protocol: "viberacing-usage-sync-auth-v1".to_owned(),
                    }),
                    next_action: NextAction::Sync,
                },
                CandidateActivation {
                    candidate_id: self.candidate_ids[1].clone(),
                    activation_state: ActivationState::Skipped,
                    agent_account_id: None,
                    device_id: None,
                    server_binding_material: None,
                    next_action: NextAction::None,
                },
            ]))
        }
    }

    fn start_response() -> StartResponse {
        StartResponse {
            schema_version: 1,
            request_id: REQUEST_ID.to_owned(),
            pairing_id: PAIRING_ID.to_owned(),
            poll_token: POLL_TOKEN.to_owned(),
            pairing_challenge: CHALLENGE.to_owned(),
            user_code: USER_CODE.to_owned(),
            approval_url: format!("https://race.example/connect?code={USER_CODE}"),
            expires_at: "2030-01-02T03:04:05.006Z".to_owned(),
        }
    }

    fn test_origin() -> Origin {
        Origin::parse("https://race.example").expect("synthetic HTTPS origin must validate")
    }

    fn discovered_account() -> DiscoveredAccount {
        DiscoveredAccount {
            provider: crate::reader::AgentProvider::Codex,
            reader_version: "codex_app_server_0_144_5_v1",
            accounting_revision: 1,
            scope_kind: crate::reader::AccountingScope::AgentAccount,
            fingerprint_kind: crate::reader::FingerprintKind::Unavailable,
            account_fingerprint_digest: None,
            safe_display_label: "Codex account".to_owned(),
            status: crate::reader::ReaderStatus::Ready,
            daily_usage: crate::reader::CanonicalDailyUsage::new(vec![
                crate::reader::CanonicalDailyUsageEntry::new(
                    current_utc_week_dates(SystemTime::now()).unwrap().0,
                    "579".to_owned(),
                )
                .unwrap(),
            ])
            .unwrap(),
        }
    }

    #[test]
    fn parses_the_final_bounded_command_surface() {
        let command = parse_command([
            "connect".into(),
            "--origin".into(),
            "https://race.example".into(),
        ])
        .expect("exact connect arguments must parse");
        assert!(matches!(command, ParsedCommand::Connect { .. }));
        let command = parse_command([
            "sync".into(),
            "--codex".into(),
            "C:\\synthetic\\codex.exe".into(),
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
    }

    #[test]
    fn parses_fixed_account_and_lifecycle_commands() {
        assert!(matches!(
            parse_command([
                "connect".into(),
                "--origin".into(),
                "https://race.example".into()
            ]),
            Ok(ParsedCommand::Connect { .. })
        ));
        assert!(matches!(
            parse_command(["sync".into()]),
            Ok(ParsedCommand::Sync { codex_path: None })
        ));
        assert!(matches!(
            parse_command(["status".into()]),
            Ok(ParsedCommand::Status)
        ));
        assert!(matches!(
            parse_command(["doctor".into()]),
            Ok(ParsedCommand::Doctor)
        ));
        assert!(matches!(
            parse_command(["account".into(), "list".into()]),
            Ok(ParsedCommand::AccountList)
        ));
        assert!(matches!(
            parse_command(["account".into(), "sync".into(), "16".into()]),
            Ok(ParsedCommand::AccountSync { selector: 16 })
        ));
        assert!(matches!(
            parse_command(["disconnect".into()]),
            Ok(ParsedCommand::Disconnect)
        ));
        assert!(matches!(
            parse_command(["forget-local".into()]),
            Ok(ParsedCommand::ForgetLocal)
        ));
        assert!(matches!(
            parse_command(["--help".into()]),
            Ok(ParsedCommand::Help)
        ));
    }

    #[test]
    fn rejects_noncanonical_or_mixed_command_arguments() {
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
    }

    #[test]
    fn parses_sync_with_bounded_discovery_and_explicit_fallback() {
        let command =
            parse_command(["sync".into()]).expect("exact discovery sync arguments must parse");
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
        let command = parse_command(["forget-local".into()])
            .expect("exact local-forget arguments must parse");
        assert!(matches!(command, ParsedCommand::ForgetLocal));

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
        fn load_installation(&mut self) -> Result<Option<InstallationRecord>, ConnectorCliError> {
            unreachable!("local credential removal must not load key material")
        }

        fn save_installation(
            &mut self,
            _record: &InstallationRecord,
        ) -> Result<(), ConnectorCliError> {
            unreachable!("local credential removal must not write key material")
        }

        fn load_account(
            &mut self,
            _slot: usize,
            _expected_origin: &[u8; 32],
        ) -> Result<Option<AccountCredential>, ConnectorCliError> {
            unreachable!("local credential removal must not load key material")
        }

        fn save_account(
            &mut self,
            _slot: usize,
            _record: &AccountCredential,
        ) -> Result<(), ConnectorCliError> {
            unreachable!("local credential removal must not write key material")
        }

        fn delete_account(&mut self, _slot: usize) -> Result<(), ConnectorCliError> {
            unreachable!("local credential removal uses only the fixed all-entry deletion")
        }

        fn delete_all(&mut self) -> Result<(), ConnectorCliError> {
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
            "Local credentials were removed. Server device authority was not revoked; revoke the device in the Vibe Racing dashboard to disconnect completely.\n"
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
    fn installation_record_binds_the_exact_origin_and_starts_empty() {
        let origin = test_origin();
        let record = InstallationRecord::new(&origin).expect("test entropy must be available");
        assert_eq!(record.origin().unwrap().value, origin.value);
        assert_eq!(record.state, InstallationState::Prepared);
        assert_eq!(record.populated_slots().count(), 0);
    }

    #[test]
    fn validates_closed_start_and_poll_responses() {
        assert!(valid_start_response(
            &start_response(),
            "https://race.example"
        ));
        let pending = PollResponse {
            schema_version: 1,
            request_id: REQUEST_ID.to_owned(),
            pairing_state: PairingState::Pending,
            candidate_activations: Vec::new(),
        };
        assert!(valid_poll_response(&pending));
        let activated = PollResponse {
            schema_version: 1,
            request_id: REQUEST_ID.to_owned(),
            pairing_state: PairingState::Activated,
            candidate_activations: vec![CandidateActivation {
                candidate_id: CANDIDATE_ID.to_owned(),
                activation_state: ActivationState::Active,
                agent_account_id: Some(AGENT_ACCOUNT_ID.to_owned()),
                device_id: Some(DEVICE_ID.to_owned()),
                server_binding_material: Some(ServerBindingMaterial {
                    device_key_id: DEVICE_KEY_ID.to_owned(),
                    usage_endpoint: "/v1/usage".to_owned(),
                    signature_protocol: "viberacing-usage-sync-auth-v1".to_owned(),
                }),
                next_action: NextAction::Sync,
            }],
        };
        assert!(valid_poll_response(&activated));
        let mut invalid = start_response();
        invalid.expires_at = "2030-02-30T03:04:05.006Z".to_owned();
        assert!(!valid_start_response(&invalid, "https://race.example"));
    }

    #[test]
    fn pairing_transport_budgets_and_rate_identifier_location_match_the_contract() {
        let policy: serde_json::Value = serde_json::from_str(include_str!(
            "../../../contracts/v1/connector-pairing-transport.json"
        ))
        .expect("pairing transport policy must be valid JSON");
        assert_eq!(
            policy["requestBodyBytes"].as_u64(),
            Some(MAX_REQUEST_BYTES as u64)
        );
        assert_eq!(
            policy["responseBodyBytes"].as_u64(),
            Some(MAX_RESPONSE_BYTES)
        );
        assert_eq!(
            policy["clientRateIdentifierLocation"].as_str(),
            Some("request-body")
        );
    }

    #[test]
    fn creates_persists_and_activates_one_device_without_exposing_bindings() {
        let origin = test_origin();
        let mut store = MemoryStore::empty();
        let mut transport = ImmediateTransport {
            starts: 0,
            polls: 0,
            candidate_id: None,
        };
        let mut discover = || Ok(vec![discovered_account()]);
        let mut opened = Vec::new();
        let mut browser = |url: &str| {
            opened.push(url.to_owned());
            true
        };
        let mut output = Vec::new();
        let completion = {
            let mut runtime = ConnectRuntime {
                store: &mut store,
                transport: &mut transport,
                discover: &mut discover,
                open_browser: &mut browser,
                output: &mut output,
            };
            run_connect(&origin, "windows", "x86_64", &mut runtime)
                .expect("immediate synthetic approval must connect")
        };
        assert_eq!(completion.active_slots, vec![0]);
        assert_eq!(completion.current_week_token_total, "579");
        assert_eq!(transport.starts, 1);
        assert_eq!(transport.polls, 1);
        assert!(store.saves >= 6);
        assert_eq!(
            opened,
            vec![format!("https://race.example/connect?code={USER_CODE}")]
        );
        let text = String::from_utf8(output).expect("connector output must be UTF-8");
        assert!(text.contains("Detected accounts:"));
        assert!(text.contains("Only UTC dates and aggregate token totals"));
        assert!(text.contains("https://race.example/connect?code="));
        assert!(text.contains(USER_CODE));
        assert!(!text.contains(AGENT_ACCOUNT_ID));
        assert!(!text.contains(DEVICE_ID));
        assert!(!text.contains(POLL_TOKEN));
        let stored = store
            .load_installation()
            .unwrap()
            .expect("active installation must be stored");
        assert_eq!(stored.state, InstallationState::Active);
        let account = store
            .load_account(0, &digest_origin(&origin))
            .unwrap()
            .expect("active account credential must be stored");
        assert_eq!(account.state, AccountState::Active);
    }

    #[test]
    fn active_installation_refuses_a_second_pairing_without_discovery_or_network() {
        let origin = test_origin();
        let mut store = MemoryStore::empty();
        let mut transport = ImmediateTransport {
            starts: 0,
            polls: 0,
            candidate_id: None,
        };
        let mut discover = || Ok(vec![discovered_account()]);
        let mut browser = |_url: &str| true;
        let mut output = Vec::new();
        {
            let mut runtime = ConnectRuntime {
                store: &mut store,
                transport: &mut transport,
                discover: &mut discover,
                open_browser: &mut browser,
                output: &mut output,
            };
            run_connect(&origin, "windows", "x86_64", &mut runtime)
                .expect("first pairing must activate");
        }
        let saves = store.saves;
        let mut no_discovery = || -> Result<Vec<DiscoveredAccount>, ConnectorCliError> {
            panic!("active installation must not rediscover")
        };
        let mut retry_output = Vec::new();
        {
            let mut runtime = ConnectRuntime {
                store: &mut store,
                transport: &mut transport,
                discover: &mut no_discovery,
                open_browser: &mut browser,
                output: &mut retry_output,
            };
            assert_eq!(
                run_connect(&origin, "windows", "x86_64", &mut runtime).err(),
                Some(ConnectorCliError::AlreadyConnected)
            );
        }
        assert_eq!(transport.starts, 1);
        assert_eq!(transport.polls, 1);
        assert_eq!(store.saves, saves);
    }

    #[test]
    fn uncertain_pairing_start_is_persisted_and_never_retried_automatically() {
        let origin = test_origin();
        let mut store = MemoryStore::empty();
        let mut transport = UncertainStartTransport { starts: 0 };
        let mut discovery_calls = 0;
        let mut discover = || {
            discovery_calls += 1;
            Ok(vec![discovered_account()])
        };
        let mut browser = |_url: &str| true;
        let mut output = Vec::new();
        {
            let mut runtime = ConnectRuntime {
                store: &mut store,
                transport: &mut transport,
                discover: &mut discover,
                open_browser: &mut browser,
                output: &mut output,
            };
            assert_eq!(
                run_connect(&origin, "windows", "x86_64", &mut runtime).err(),
                Some(ConnectorCliError::PairingStartUncertain)
            );
        }
        let stored = store
            .load_installation()
            .expect("starting record must decode")
            .expect("starting record must persist");
        assert_eq!(stored.state, InstallationState::Starting);
        assert_eq!(transport.starts, 1);
        assert_eq!(discovery_calls, 1);

        let mut forbidden_discovery = || -> Result<Vec<DiscoveredAccount>, ConnectorCliError> {
            panic!("uncertain pairing must not rediscover")
        };
        let mut retry_output = Vec::new();
        let mut runtime = ConnectRuntime {
            store: &mut store,
            transport: &mut transport,
            discover: &mut forbidden_discovery,
            open_browser: &mut browser,
            output: &mut retry_output,
        };
        assert_eq!(
            run_connect(&origin, "windows", "x86_64", &mut runtime).err(),
            Some(ConnectorCliError::PairingStartUncertain)
        );
        assert_eq!(transport.starts, 1);
    }

    #[test]
    fn one_batch_activation_keeps_approved_key_and_deletes_skipped_key() {
        let origin = test_origin();
        let mut store = MemoryStore::empty();
        let mut transport = BatchTransport {
            candidate_ids: Vec::new(),
        };
        let mut second = discovered_account();
        second.safe_display_label = "Codex account 2".to_owned();
        let mut discovered = Some(vec![discovered_account(), second]);
        let mut discover = || discovered.take().ok_or(ConnectorCliError::CodexUnavailable);
        let mut browser = |_url: &str| true;
        let mut output = Vec::new();
        let completion = {
            let mut runtime = ConnectRuntime {
                store: &mut store,
                transport: &mut transport,
                discover: &mut discover,
                open_browser: &mut browser,
                output: &mut output,
            };
            run_connect(&origin, "windows", "x86_64", &mut runtime)
                .expect("one approval must settle the whole batch")
        };
        assert_eq!(completion.active_slots, vec![0]);
        assert_eq!(completion.current_week_token_total, "1158");
        let digest = digest_origin(&origin);
        assert!(
            store
                .load_account(0, &digest)
                .expect("approved account must decode")
                .is_some()
        );
        assert!(
            store
                .load_account(1, &digest)
                .expect("skipped slot lookup must succeed")
                .is_none()
        );
        let installation = store
            .load_installation()
            .expect("installation must decode")
            .expect("installation must remain");
        assert_eq!(installation.state, InstallationState::Active);
        assert_eq!(installation.active_slots().collect::<Vec<_>>(), vec![0]);
    }

    #[test]
    fn status_account_list_and_forget_output_omit_server_and_key_material() {
        let origin = test_origin();
        let mut store = MemoryStore::empty();
        let mut transport = ImmediateTransport {
            starts: 0,
            polls: 0,
            candidate_id: None,
        };
        let mut discover = || Ok(vec![discovered_account()]);
        let mut browser = |_url: &str| true;
        {
            let mut output = Vec::new();
            let mut runtime = ConnectRuntime {
                store: &mut store,
                transport: &mut transport,
                discover: &mut discover,
                open_browser: &mut browser,
                output: &mut output,
            };
            run_connect(&origin, "windows", "x86_64", &mut runtime)
                .expect("fixture installation must activate");
        }
        let mut output = Vec::new();
        run_status(&mut store, &mut output).expect("status must render");
        run_account_list(&mut store, &mut output).expect("account list must render");
        run_forget_local(&mut store, &mut output).expect("forget must render");
        let text = String::from_utf8(output).expect("local output must be UTF-8");
        for private_value in [
            AGENT_ACCOUNT_ID,
            DEVICE_ID,
            DEVICE_KEY_ID,
            POLL_TOKEN,
            CHALLENGE,
        ] {
            assert!(!text.contains(private_value));
        }
        assert!(text.contains("Active accounts: 1"));
        assert!(text.contains("Codex — Codex account"));
        assert!(store.installation.is_none());
        assert!(store.accounts.iter().all(Option::is_none));
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
