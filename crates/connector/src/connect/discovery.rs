//! Built-in account discovery and privacy-minimized usage collection.

use std::fs;
use std::path::{Path, PathBuf};

use crate::admission::{ADMITTED_CODEX_VERSION, admit_candidate_selection};
use crate::codex_reader::CodexAppServer01445Reader;
use crate::process::{
    CandidateCodex01445Collector, ReviewedCodexLaunch, current_allowed_environment,
};
use crate::reader::{
    AccountingScope, AgentProvider, AgentUsageReader, CanonicalDailyUsage, FingerprintKind,
    ReaderStatus, UtcUsageWindow, validate_reader_metadata,
};
use crate::sync::encode_base64url;

use super::{ConnectorCliError, map_admission_error};

const TEMP_DIRECTORY_ATTEMPTS: usize = 4;

/// One safe built-in account plus only its canonical cumulative daily totals.
pub(super) struct DiscoveredAccount {
    pub(super) provider: AgentProvider,
    pub(super) reader_version: &'static str,
    pub(super) accounting_revision: u32,
    pub(super) scope_kind: AccountingScope,
    pub(super) fingerprint_kind: FingerprintKind,
    pub(super) account_fingerprint_digest: Option<String>,
    pub(super) safe_display_label: String,
    pub(super) status: ReaderStatus,
    pub(super) daily_usage: CanonicalDailyUsage,
}

impl DiscoveredAccount {
    pub(super) fn last_usage_date(&self) -> Option<String> {
        self.daily_usage
            .entries()
            .last()
            .map(|entry| entry.usage_date().to_owned())
    }

    pub(super) fn total_for_dates(
        &self,
        first_date: &str,
        last_date: &str,
    ) -> Result<String, ConnectorCliError> {
        let mut total = 0_u128;
        for entry in self
            .daily_usage
            .entries()
            .iter()
            .filter(|entry| first_date <= entry.usage_date() && entry.usage_date() <= last_date)
        {
            let value = entry
                .daily_token_total()
                .parse::<u128>()
                .map_err(|_| ConnectorCliError::CodexUnavailable)?;
            total = total
                .checked_add(value)
                .ok_or(ConnectorCliError::CodexUnavailable)?;
        }
        Ok(total.to_string())
    }
}

pub(super) fn collect_supported_accounts(
    codex_path: Option<&Path>,
) -> Result<Vec<DiscoveredAccount>, ConnectorCliError> {
    Ok(vec![collect_codex_account(codex_path)?])
}

pub(super) fn collect_codex_account(
    codex_path: Option<&Path>,
) -> Result<DiscoveredAccount, ConnectorCliError> {
    let admitted = admit_candidate_selection(codex_path).map_err(map_admission_error)?;
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
    let provider_usage = collection.map_err(|_| ConnectorCliError::CodexUnavailable)?;
    let first_date = provider_usage
        .entries()
        .first()
        .ok_or(ConnectorCliError::NoUsage)?
        .codex_reported_date()
        .to_owned();
    let last_date = provider_usage
        .entries()
        .last()
        .ok_or(ConnectorCliError::NoUsage)?
        .codex_reported_date()
        .to_owned();
    let reader = CodexAppServer01445Reader::from_collected(provider_usage);
    validate_reader_metadata(&reader).map_err(|_| ConnectorCliError::CodexUnavailable)?;
    let candidate = reader
        .discover_accounts()
        .map_err(|_| ConnectorCliError::CodexUnavailable)?
        .pop()
        .ok_or(ConnectorCliError::CodexUnavailable)?;
    let status = reader.diagnose(candidate.handle()).status();
    let window = UtcUsageWindow::new(first_date, last_date)
        .map_err(|_| ConnectorCliError::CodexUnavailable)?;
    let daily_usage = reader
        .read_daily_usage(candidate.handle(), &window)
        .map_err(|_| ConnectorCliError::CodexUnavailable)?;
    if daily_usage.is_empty() {
        return Err(ConnectorCliError::NoUsage);
    }
    Ok(DiscoveredAccount {
        provider: reader.provider(),
        reader_version: reader.reader_version(),
        accounting_revision: reader.accounting_revision(),
        scope_kind: reader.scope_kind(),
        fingerprint_kind: candidate.fingerprint_kind(),
        account_fingerprint_digest: candidate.account_fingerprint_digest().map(str::to_owned),
        safe_display_label: candidate.safe_display_label().to_owned(),
        status,
        daily_usage,
    })
}

pub(super) fn admitted_codex_version() -> &'static str {
    ADMITTED_CODEX_VERSION
}

struct EmptyWorkingDirectory {
    path: Option<PathBuf>,
}

impl EmptyWorkingDirectory {
    fn create() -> Result<Self, ConnectorCliError> {
        for _ in 0..TEMP_DIRECTORY_ATTEMPTS {
            let mut random = [0_u8; 16];
            getrandom::fill(&mut random).map_err(|_| ConnectorCliError::EntropyUnavailable)?;
            let path = std::env::temp_dir().join(format!(
                "viberacing-connector-{}",
                encode_base64url(&random)
            ));
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

#[cfg(test)]
mod tests {
    use crate::reader::{AccountingScope, AgentProvider, FingerprintKind, ReaderStatus};

    use super::*;

    #[test]
    fn sums_only_the_requested_preview_dates_without_rounding() {
        let account = DiscoveredAccount {
            provider: AgentProvider::Codex,
            reader_version: "codex_app_server_0_144_5_v1",
            accounting_revision: 1,
            scope_kind: AccountingScope::AgentAccount,
            fingerprint_kind: FingerprintKind::Unavailable,
            account_fingerprint_digest: None,
            safe_display_label: "Codex account".to_owned(),
            status: ReaderStatus::Ready,
            daily_usage: CanonicalDailyUsage::new(vec![
                crate::reader::CanonicalDailyUsageEntry::new(
                    "2026-07-12".to_owned(),
                    "999".to_owned(),
                )
                .unwrap(),
                crate::reader::CanonicalDailyUsageEntry::new(
                    "2026-07-13".to_owned(),
                    "123456789012345678".to_owned(),
                )
                .unwrap(),
                crate::reader::CanonicalDailyUsageEntry::new(
                    "2026-07-14".to_owned(),
                    "456".to_owned(),
                )
                .unwrap(),
            ])
            .unwrap(),
        };
        assert_eq!(
            account.total_for_dates("2026-07-13", "2026-07-19").unwrap(),
            "123456789012346134"
        );
        assert_eq!(account.last_usage_date().as_deref(), Some("2026-07-14"));
    }
}
