//! Provider-neutral, privacy-minimized boundary shared by built-in usage readers.
//!
//! Provider-specific records stay inside their reviewed reader module. Only the closed types in
//! this module may cross into discovery-manifest or Usage Sync composition.

use std::fmt;

/// Maximum number of UTC days one reader result may carry into one Usage Sync request.
pub const MAX_CANONICAL_DAILY_USAGE_ENTRIES: usize = 31;

const MAX_TOKEN_DIGITS: usize = 30;
const MAX_SAFE_LABEL_BYTES: usize = 64;
const READER_VERSION_MAX_BYTES: usize = 64;
const MAX_CANONICAL_DAY_DISTANCE: i32 = 31;

/// A coding-agent provider with a repository-implemented competitive reader.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum AgentProvider {
    /// `OpenAI` Codex through its exact reviewed local App Server protocol.
    Codex,
}

impl AgentProvider {
    /// Returns the canonical protocol identifier.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
        }
    }
}

/// Closed provider-registry state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderState {
    /// A complete reviewed reader and its evidence exist.
    Supported,
    /// The product is known but cannot produce competitive usage.
    Recognized,
    /// A previously admitted combination is blocked.
    Disabled,
}

impl ProviderState {
    /// Returns the canonical registry value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Supported => "supported",
            Self::Recognized => "recognized",
            Self::Disabled => "disabled",
        }
    }
}

/// One immutable built-in provider-registry row.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProviderRegistryEntry {
    code: &'static str,
    display_name: &'static str,
    state: ProviderState,
}

impl ProviderRegistryEntry {
    /// Returns the canonical provider code.
    #[must_use]
    pub const fn code(self) -> &'static str {
        self.code
    }

    /// Returns the public product name.
    #[must_use]
    pub const fn display_name(self) -> &'static str {
        self.display_name
    }

    /// Returns whether this provider can produce competitive usage.
    #[must_use]
    pub const fn state(self) -> ProviderState {
        self.state
    }
}

/// Closed built-in registry. Recognition grants no executable or sync capability.
pub const BUILT_IN_PROVIDER_REGISTRY: [ProviderRegistryEntry; 6] = [
    ProviderRegistryEntry {
        code: "codex",
        display_name: "Codex",
        state: ProviderState::Recognized,
    },
    ProviderRegistryEntry {
        code: "claude_code",
        display_name: "Claude Code",
        state: ProviderState::Recognized,
    },
    ProviderRegistryEntry {
        code: "opencode",
        display_name: "opencode",
        state: ProviderState::Recognized,
    },
    ProviderRegistryEntry {
        code: "qwen_code",
        display_name: "Qwen Code",
        state: ProviderState::Recognized,
    },
    ProviderRegistryEntry {
        code: "cline",
        display_name: "Cline",
        state: ProviderState::Recognized,
    },
    ProviderRegistryEntry {
        code: "aider",
        display_name: "Aider",
        state: ProviderState::Recognized,
    },
];

/// The sole competitive accounting scope admitted in connector V1.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AccountingScope {
    /// One non-overlapping logical account of one coding agent.
    AgentAccount,
}

impl AccountingScope {
    /// Returns the canonical contract value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AgentAccount => "agent_account",
        }
    }
}

/// Safe account-domain evidence available to the approval flow.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FingerprintKind {
    /// A high-entropy stable opaque provider identifier was safely derived.
    StableOpaque,
    /// No safe stable identifier exists; approval must explicitly create or attach.
    Unavailable,
}

impl FingerprintKind {
    /// Returns the canonical contract value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::StableOpaque => "stable_opaque",
            Self::Unavailable => "unavailable",
        }
    }
}

/// Coarse non-sensitive reader state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReaderStatus {
    /// The requested account and UTC window are ready for sync.
    Ready,
    /// The local source does not contain a complete requested period.
    IncompletePeriod,
    /// The reviewed reader failed without exposing provider data.
    ReaderError,
    /// The provider is not locally available.
    Unavailable,
    /// The observed accounting domain may overlap another domain.
    UnsupportedScope,
    /// The observed local schema or agent version is not admitted.
    UnsupportedVersion,
}

impl ReaderStatus {
    /// Returns the canonical contract value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::IncompletePeriod => "incomplete_period",
            Self::ReaderError => "reader_error",
            Self::Unavailable => "unavailable",
            Self::UnsupportedScope => "unsupported_scope",
            Self::UnsupportedVersion => "unsupported_version",
        }
    }
}

/// Stable non-reflective failures emitted by built-in readers.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReaderError {
    /// Reader metadata did not match its reviewed closed registry entry.
    InvalidReader,
    /// A candidate contained unsafe or malformed metadata.
    InvalidCandidate,
    /// The requested UTC window was malformed or wider than the contract.
    InvalidUtcWindow,
    /// The selected account does not belong to this reader instance.
    UnknownAccount,
    /// Provider data failed exact schema or accounting validation.
    InvalidProviderData,
    /// The exact local surface was unavailable.
    Unavailable,
    /// The exact local version or schema is not supported.
    UnsupportedVersion,
}

impl fmt::Display for ReaderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidReader => "reader metadata is invalid",
            Self::InvalidCandidate => "reader candidate is invalid",
            Self::InvalidUtcWindow => "reader UTC window is invalid",
            Self::UnknownAccount => "reader account selection is invalid",
            Self::InvalidProviderData => "provider usage data is invalid",
            Self::Unavailable => "provider usage source is unavailable",
            Self::UnsupportedVersion => "provider usage source version is unsupported",
        })
    }
}

impl std::error::Error for ReaderError {}

/// Opaque local handle used only to call the same in-memory reader instance.
///
/// It is intentionally not serializable and contains no raw provider identifier.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct ReaderAccountHandle(u8);

impl ReaderAccountHandle {
    pub(crate) const fn singleton() -> Self {
        Self(0)
    }
}

impl fmt::Debug for ReaderAccountHandle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ReaderAccountHandle(..)")
    }
}

/// One privacy-minimized discovered account candidate.
#[derive(Clone, Eq, PartialEq)]
pub struct CanonicalAccountCandidate {
    handle: ReaderAccountHandle,
    fingerprint_kind: FingerprintKind,
    account_fingerprint_digest: Option<String>,
    safe_display_label: String,
}

impl CanonicalAccountCandidate {
    /// Creates a candidate only after validating its safe display and fingerprint boundary.
    ///
    /// # Errors
    ///
    /// Returns [`ReaderError::InvalidCandidate`] for an unsafe label, a noncanonical digest, or a
    /// fingerprint-kind/digest mismatch.
    pub fn new(
        handle: ReaderAccountHandle,
        fingerprint_kind: FingerprintKind,
        account_fingerprint_digest: Option<String>,
        safe_display_label: String,
    ) -> Result<Self, ReaderError> {
        if safe_display_label.is_empty()
            || safe_display_label.len() > MAX_SAFE_LABEL_BYTES
            || safe_display_label.chars().any(char::is_control)
        {
            return Err(ReaderError::InvalidCandidate);
        }
        let digest_is_valid = account_fingerprint_digest.as_deref().is_some_and(|value| {
            value.len() == 64
                && value
                    .as_bytes()
                    .iter()
                    .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        });
        if !matches!(
            (fingerprint_kind, account_fingerprint_digest.is_some()),
            (FingerprintKind::StableOpaque, true) | (FingerprintKind::Unavailable, false)
        ) || (account_fingerprint_digest.is_some() && !digest_is_valid)
        {
            return Err(ReaderError::InvalidCandidate);
        }
        Ok(Self {
            handle,
            fingerprint_kind,
            account_fingerprint_digest,
            safe_display_label,
        })
    }

    /// Returns the opaque handle for calls back into the same reader.
    #[must_use]
    pub const fn handle(&self) -> ReaderAccountHandle {
        self.handle
    }

    /// Returns the safe fingerprint policy.
    #[must_use]
    pub const fn fingerprint_kind(&self) -> FingerprintKind {
        self.fingerprint_kind
    }

    /// Returns the optional lowercase SHA-256 digest of a safe opaque identifier.
    #[must_use]
    pub fn account_fingerprint_digest(&self) -> Option<&str> {
        self.account_fingerprint_digest.as_deref()
    }

    /// Returns the bounded local display label.
    #[must_use]
    pub fn safe_display_label(&self) -> &str {
        &self.safe_display_label
    }
}

impl fmt::Debug for CanonicalAccountCandidate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CanonicalAccountCandidate")
            .field("fingerprint_kind", &self.fingerprint_kind)
            .field(
                "has_fingerprint",
                &self.account_fingerprint_digest.is_some(),
            )
            .finish_non_exhaustive()
    }
}

/// Inclusive bounded UTC-date window requested from one reader.
#[derive(Clone, Eq, PartialEq)]
pub struct UtcUsageWindow {
    first_date: String,
    last_date: String,
}

impl UtcUsageWindow {
    /// Creates an inclusive UTC window of at most 31 calendar days.
    ///
    /// The caller supplies its already server-policy-bounded dates. This boundary validates exact
    /// canonical dates and ordering but never widens the window from local clock or timezone data.
    ///
    /// # Errors
    ///
    /// Returns [`ReaderError::InvalidUtcWindow`] for invalid dates, reverse ordering, or a window
    /// wider than 31 days.
    pub fn new(first_date: String, last_date: String) -> Result<Self, ReaderError> {
        let first_ordinal = utc_date_ordinal(&first_date).ok_or(ReaderError::InvalidUtcWindow)?;
        let last_ordinal = utc_date_ordinal(&last_date).ok_or(ReaderError::InvalidUtcWindow)?;
        if first_ordinal > last_ordinal
            || last_ordinal - first_ordinal >= MAX_CANONICAL_DAY_DISTANCE
        {
            return Err(ReaderError::InvalidUtcWindow);
        }
        Ok(Self {
            first_date,
            last_date,
        })
    }

    /// Returns the first included UTC date.
    #[must_use]
    pub fn first_date(&self) -> &str {
        &self.first_date
    }

    /// Returns the last included UTC date.
    #[must_use]
    pub fn last_date(&self) -> &str {
        &self.last_date
    }

    pub(crate) fn contains(&self, value: &str) -> bool {
        self.first_date.as_str() <= value && value <= self.last_date.as_str()
    }
}

impl fmt::Debug for UtcUsageWindow {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("UtcUsageWindow(..)")
    }
}

/// One exact provider-neutral cumulative UTC-day token total.
///
/// This type deliberately does not implement `Serialize` or `Debug`. The Usage Sync composer is
/// the only boundary that can turn it into network bytes.
#[derive(Clone, Eq, PartialEq)]
pub struct CanonicalDailyUsageEntry {
    usage_date: String,
    daily_token_total: String,
}

impl CanonicalDailyUsageEntry {
    /// Creates one exact canonical decimal total for one UTC calendar date.
    ///
    /// # Errors
    ///
    /// Returns [`ReaderError::InvalidProviderData`] for an invalid date, sign, decimal point,
    /// exponent, leading zero, non-digit, or value wider than the V1 numeric contract.
    pub fn new(usage_date: String, daily_token_total: String) -> Result<Self, ReaderError> {
        if utc_date_ordinal(&usage_date).is_none() || !valid_token_total(&daily_token_total) {
            return Err(ReaderError::InvalidProviderData);
        }
        Ok(Self {
            usage_date,
            daily_token_total,
        })
    }

    /// Returns the exact UTC calendar date.
    #[must_use]
    pub fn usage_date(&self) -> &str {
        &self.usage_date
    }

    /// Returns the exact canonical decimal token total.
    #[must_use]
    pub fn daily_token_total(&self) -> &str {
        &self.daily_token_total
    }
}

/// Sorted, unique, provider-neutral cumulative daily usage.
///
/// This type deliberately cannot carry prompt, response, code, path, repository, model, email,
/// login, key, token, conversation, file-content, or tool-output fields.
#[derive(Clone, Eq, PartialEq)]
pub struct CanonicalDailyUsage {
    entries: Vec<CanonicalDailyUsageEntry>,
}

impl CanonicalDailyUsage {
    /// Creates a sorted unique result with at most 31 dates.
    ///
    /// Empty usage is valid reader output but is rejected by the network composer.
    ///
    /// # Errors
    ///
    /// Returns [`ReaderError::InvalidProviderData`] for too many or duplicate dates.
    pub fn new(mut entries: Vec<CanonicalDailyUsageEntry>) -> Result<Self, ReaderError> {
        if entries.len() > MAX_CANONICAL_DAILY_USAGE_ENTRIES {
            return Err(ReaderError::InvalidProviderData);
        }
        entries.sort_unstable_by(|left, right| left.usage_date.cmp(&right.usage_date));
        if entries
            .windows(2)
            .any(|pair| pair[0].usage_date == pair[1].usage_date)
        {
            return Err(ReaderError::InvalidProviderData);
        }
        Ok(Self { entries })
    }

    /// Returns the admitted exact entries in ascending date order.
    #[must_use]
    pub fn entries(&self) -> &[CanonicalDailyUsageEntry] {
        &self.entries
    }

    /// Returns the admitted entry count.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Reports whether the local source contains no usage for the requested window.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl fmt::Debug for CanonicalDailyUsage {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CanonicalDailyUsage")
            .field("entry_count", &self.entries.len())
            .finish_non_exhaustive()
    }
}

/// Closed non-sensitive diagnostic result.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReaderDiagnostic {
    provider: AgentProvider,
    status: ReaderStatus,
}

impl ReaderDiagnostic {
    /// Creates a provider/status-only diagnostic.
    #[must_use]
    pub const fn new(provider: AgentProvider, status: ReaderStatus) -> Self {
        Self { provider, status }
    }

    /// Returns the reader provider.
    #[must_use]
    pub const fn provider(self) -> AgentProvider {
        self.provider
    }

    /// Returns the coarse safe status.
    #[must_use]
    pub const fn status(self) -> ReaderStatus {
        self.status
    }
}

/// Internal interface implemented only by reviewed built-in Rust reader modules.
///
/// There is intentionally no dynamic library, script, WASM, shell, path-configured executable, or
/// downloaded-plugin constructor.
pub trait AgentUsageReader {
    /// Returns the fixed built-in provider.
    fn provider(&self) -> AgentProvider;

    /// Returns the immutable reader-contract version.
    fn reader_version(&self) -> &'static str;

    /// Returns the immutable accounting revision.
    fn accounting_revision(&self) -> u32;

    /// Returns the non-overlapping competitive scope.
    fn scope_kind(&self) -> AccountingScope;

    /// Discovers only privacy-minimized account candidates.
    ///
    /// # Errors
    ///
    /// Returns a stable [`ReaderError`] without provider data.
    fn discover_accounts(&self) -> Result<Vec<CanonicalAccountCandidate>, ReaderError>;

    /// Reads cumulative daily totals for one discovered account and bounded UTC window.
    ///
    /// # Errors
    ///
    /// Returns a stable [`ReaderError`] without provider data.
    fn read_daily_usage(
        &self,
        account: ReaderAccountHandle,
        utc_window: &UtcUsageWindow,
    ) -> Result<CanonicalDailyUsage, ReaderError>;

    /// Returns a provider/status-only diagnostic for one discovered account.
    fn diagnose(&self, account: ReaderAccountHandle) -> ReaderDiagnostic;
}

/// Validates one reader's immutable registry metadata.
///
/// # Errors
///
/// Returns [`ReaderError::InvalidReader`] for unreviewed version, revision, or scope values.
pub fn validate_reader_metadata(reader: &dyn AgentUsageReader) -> Result<(), ReaderError> {
    let version = reader.reader_version();
    if version.len() < 3
        || version.len() > READER_VERSION_MAX_BYTES
        || !version
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_lowercase)
        || !version
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_')
        || reader.accounting_revision() == 0
        || reader.scope_kind() != AccountingScope::AgentAccount
    {
        return Err(ReaderError::InvalidReader);
    }
    Ok(())
}

fn valid_token_total(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_TOKEN_DIGITS
        && value.as_bytes().iter().all(u8::is_ascii_digit)
        && (value == "0" || !value.starts_with('0'))
}

fn utc_date_ordinal(value: &str) -> Option<i32> {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || &bytes[0..2] != b"20"
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| index != 4 && index != 7 && !byte.is_ascii_digit())
    {
        return None;
    }
    let year = i32::from(bytes[0] - b'0') * 1_000
        + i32::from(bytes[1] - b'0') * 100
        + i32::from(bytes[2] - b'0') * 10
        + i32::from(bytes[3] - b'0');
    let month = i32::from(bytes[5] - b'0') * 10 + i32::from(bytes[6] - b'0');
    let day = i32::from(bytes[8] - b'0') * 10 + i32::from(bytes[9] - b'0');
    let maximum_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 => 29,
        2 => 28,
        _ => return None,
    };
    if !(1..=maximum_day).contains(&day) {
        return None;
    }
    let adjusted_year = year - i32::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    Some(era * 146_097 + day_of_era)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct SyntheticReader;

    impl AgentUsageReader for SyntheticReader {
        fn provider(&self) -> AgentProvider {
            AgentProvider::Codex
        }

        fn reader_version(&self) -> &'static str {
            "synthetic_v1"
        }

        fn accounting_revision(&self) -> u32 {
            1
        }

        fn scope_kind(&self) -> AccountingScope {
            AccountingScope::AgentAccount
        }

        fn discover_accounts(&self) -> Result<Vec<CanonicalAccountCandidate>, ReaderError> {
            Ok(vec![CanonicalAccountCandidate::new(
                ReaderAccountHandle::singleton(),
                FingerprintKind::Unavailable,
                None,
                "Synthetic account".to_owned(),
            )?])
        }

        fn read_daily_usage(
            &self,
            account: ReaderAccountHandle,
            utc_window: &UtcUsageWindow,
        ) -> Result<CanonicalDailyUsage, ReaderError> {
            if account != ReaderAccountHandle::singleton() {
                return Err(ReaderError::UnknownAccount);
            }
            let entries = [
                ("2026-07-13", "123"),
                ("2026-07-14", "456"),
                ("2026-07-15", "789"),
            ]
            .into_iter()
            .filter(|(date, _)| utc_window.contains(date))
            .map(|(date, total)| CanonicalDailyUsageEntry::new(date.to_owned(), total.to_owned()))
            .collect::<Result<Vec<_>, _>>()?;
            CanonicalDailyUsage::new(entries)
        }

        fn diagnose(&self, account: ReaderAccountHandle) -> ReaderDiagnostic {
            ReaderDiagnostic::new(
                self.provider(),
                if account == ReaderAccountHandle::singleton() {
                    ReaderStatus::Ready
                } else {
                    ReaderStatus::ReaderError
                },
            )
        }
    }

    #[test]
    fn registry_is_closed_and_recognition_grants_no_support() {
        assert_eq!(
            BUILT_IN_PROVIDER_REGISTRY
                .iter()
                .map(|entry| (entry.code(), entry.display_name(), entry.state().as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("codex", "Codex", "recognized"),
                ("claude_code", "Claude Code", "recognized"),
                ("opencode", "opencode", "recognized"),
                ("qwen_code", "Qwen Code", "recognized"),
                ("cline", "Cline", "recognized"),
                ("aider", "Aider", "recognized"),
            ]
        );
        assert_eq!(AgentProvider::Codex.as_str(), "codex");
        assert_eq!(ProviderState::Supported.as_str(), "supported");
        assert_eq!(ProviderState::Disabled.as_str(), "disabled");
    }

    #[test]
    fn validates_trait_metadata_and_filters_one_utc_window() {
        let reader = SyntheticReader;
        validate_reader_metadata(&reader).expect("fixed reader metadata must be valid");
        let candidate = reader
            .discover_accounts()
            .expect("synthetic discovery must succeed")
            .pop()
            .expect("one account must be discovered");
        assert_eq!(candidate.safe_display_label(), "Synthetic account");
        assert_eq!(candidate.fingerprint_kind(), FingerprintKind::Unavailable);
        assert_eq!(candidate.account_fingerprint_digest(), None);
        assert_eq!(
            format!("{candidate:?}"),
            "CanonicalAccountCandidate { fingerprint_kind: Unavailable, has_fingerprint: false, .. }"
        );

        let window = UtcUsageWindow::new("2026-07-14".to_owned(), "2026-07-15".to_owned())
            .expect("two-day UTC window must be valid");
        let usage = reader
            .read_daily_usage(candidate.handle(), &window)
            .expect("known account must read");
        assert_eq!(usage.len(), 2);
        assert_eq!(usage.entries()[0].usage_date(), "2026-07-14");
        assert_eq!(usage.entries()[0].daily_token_total(), "456");
        assert_eq!(
            format!("{usage:?}"),
            "CanonicalDailyUsage { entry_count: 2, .. }"
        );
        assert_eq!(
            reader.diagnose(candidate.handle()),
            ReaderDiagnostic::new(AgentProvider::Codex, ReaderStatus::Ready)
        );
    }

    #[test]
    fn rejects_unsafe_candidate_date_decimal_and_collection_shapes() {
        assert_eq!(
            CanonicalAccountCandidate::new(
                ReaderAccountHandle::singleton(),
                FingerprintKind::Unavailable,
                Some("a".repeat(64)),
                "Codex".to_owned(),
            )
            .err(),
            Some(ReaderError::InvalidCandidate)
        );
        assert_eq!(
            CanonicalAccountCandidate::new(
                ReaderAccountHandle::singleton(),
                FingerprintKind::StableOpaque,
                Some("A".repeat(64)),
                "Codex".to_owned(),
            )
            .err(),
            Some(ReaderError::InvalidCandidate)
        );
        assert_eq!(
            CanonicalAccountCandidate::new(
                ReaderAccountHandle::singleton(),
                FingerprintKind::Unavailable,
                None,
                "unsafe\nlabel".to_owned(),
            )
            .err(),
            Some(ReaderError::InvalidCandidate)
        );

        for (date, total) in [
            ("2026-02-29", "1"),
            ("2026-01-01", ""),
            ("2026-01-01", "01"),
            ("2026-01-01", "-1"),
            ("2026-01-01", "1.0"),
            ("2026-01-01", "1e2"),
            ("2026-01-01", "1_000"),
            ("2026-01-01", "1111111111111111111111111111111"),
        ] {
            assert_eq!(
                CanonicalDailyUsageEntry::new(date.to_owned(), total.to_owned()).err(),
                Some(ReaderError::InvalidProviderData)
            );
        }
        assert!(CanonicalDailyUsageEntry::new("2024-02-29".to_owned(), "0".to_owned()).is_ok());

        let duplicate = CanonicalDailyUsageEntry::new("2026-01-01".to_owned(), "1".to_owned())
            .expect("fixture entry must be valid");
        assert_eq!(
            CanonicalDailyUsage::new(vec![duplicate.clone(), duplicate]).err(),
            Some(ReaderError::InvalidProviderData)
        );
        assert_eq!(
            UtcUsageWindow::new("2026-01-31".to_owned(), "2026-03-03".to_owned(),).err(),
            Some(ReaderError::InvalidUtcWindow)
        );
    }

    #[test]
    fn safe_enums_emit_only_closed_contract_values() {
        assert_eq!(AccountingScope::AgentAccount.as_str(), "agent_account");
        assert_eq!(FingerprintKind::StableOpaque.as_str(), "stable_opaque");
        assert_eq!(FingerprintKind::Unavailable.as_str(), "unavailable");
        assert_eq!(ReaderStatus::Ready.as_str(), "ready");
        assert_eq!(ReaderStatus::IncompletePeriod.as_str(), "incomplete_period");
        assert_eq!(ReaderStatus::ReaderError.as_str(), "reader_error");
        assert_eq!(ReaderStatus::Unavailable.as_str(), "unavailable");
        assert_eq!(ReaderStatus::UnsupportedScope.as_str(), "unsupported_scope");
        assert_eq!(
            ReaderStatus::UnsupportedVersion.as_str(),
            "unsupported_version"
        );
        assert_eq!(
            ReaderError::UnsupportedVersion.to_string(),
            "provider usage source version is unsupported"
        );
        assert_eq!(
            ReaderError::Unavailable.to_string(),
            "provider usage source is unavailable"
        );
        assert_eq!(
            ReaderError::UnknownAccount.to_string(),
            "reader account selection is invalid"
        );
    }
}
