//! Built-in Codex reader over the exact reviewed App Server `0.144.5` adapter output.

use crate::codex_0_144_5::DailyUsage;
use crate::{
    AccountingScope, AgentProvider, AgentUsageReader, CanonicalAccountCandidate,
    CanonicalDailyUsage, CanonicalDailyUsageEntry, FingerprintKind, ReaderAccountHandle,
    ReaderDiagnostic, ReaderError, ReaderStatus, UtcUsageWindow,
};

/// Immutable reader-contract version stored with Codex `AgentAccounts`.
pub const CODEX_APP_SERVER_0_144_5_READER_VERSION: &str = "codex_app_server_0_144_5_v1";

/// Immutable accounting revision for the exact documented daily aggregate.
pub const CODEX_APP_SERVER_0_144_5_ACCOUNTING_REVISION: u32 = 1;

/// Built-in provider-neutral reader for one exact admitted Codex App Server response.
///
/// The provider-specific parser has already discarded account email, plan, summary, local path,
/// and every non-usage value before this type can be constructed. This type retains only sorted UTC
/// dates and exact cumulative token totals.
pub struct CodexAppServer01445Reader {
    usage: DailyUsage,
}

impl CodexAppServer01445Reader {
    pub(crate) fn from_collected(usage: DailyUsage) -> Self {
        Self { usage }
    }
}

impl AgentUsageReader for CodexAppServer01445Reader {
    fn provider(&self) -> AgentProvider {
        AgentProvider::Codex
    }

    fn reader_version(&self) -> &'static str {
        CODEX_APP_SERVER_0_144_5_READER_VERSION
    }

    fn accounting_revision(&self) -> u32 {
        CODEX_APP_SERVER_0_144_5_ACCOUNTING_REVISION
    }

    fn scope_kind(&self) -> AccountingScope {
        AccountingScope::AgentAccount
    }

    fn discover_accounts(&self) -> Result<Vec<CanonicalAccountCandidate>, ReaderError> {
        Ok(vec![CanonicalAccountCandidate::new(
            ReaderAccountHandle::singleton(),
            FingerprintKind::Unavailable,
            None,
            "Codex account".to_owned(),
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
        let entries = self
            .usage
            .entries()
            .iter()
            .filter(|entry| utc_window.contains(entry.codex_reported_date()))
            .map(|entry| {
                CanonicalDailyUsageEntry::new(
                    entry.codex_reported_date().to_owned(),
                    entry.tokens().to_string(),
                )
            })
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

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::{ConnectorHandshake, validate_reader_metadata};

    const INITIALIZE_RESPONSE: &[u8] = b"{\"id\":0,\"result\":{\"codexHome\":\"/synthetic/codex-home\",\"platformFamily\":\"unix\",\"platformOs\":\"linux\",\"userAgent\":\"codex-cli/0.144.5\"}}\n";
    const PRIVACY_SENTINELS: [&str; 6] = [
        "SECRET_PROMPT_SENTINEL",
        "SECRET_CODE_SENTINEL",
        "SECRET_PATH_SENTINEL",
        "SECRET_EMAIL_SENTINEL",
        "SECRET_API_KEY_SENTINEL",
        "SECRET_REPOSITORY_SENTINEL",
    ];

    fn reader_from_frames(account: &[u8], usage: &[u8]) -> CodexAppServer01445Reader {
        let mut handshake = ConnectorHandshake::new();
        handshake.start().expect("handshake must start");
        handshake
            .accept_initialize_response(INITIALIZE_RESPONSE)
            .expect("fixed initialization must pass");
        let mut adapter = handshake
            .into_codex_0_144_5_account_usage()
            .expect("completed handshake must enter the exact adapter");
        adapter
            .start_account_read()
            .expect("account read must start");
        adapter
            .accept_account_read_response(account)
            .expect("exact account frame must pass");
        adapter.start_usage_read().expect("usage read must start");
        let provider_usage = adapter
            .accept_usage_read_response(usage)
            .expect("exact usage frame must pass");
        CodexAppServer01445Reader::from_collected(provider_usage)
    }

    fn privacy_reader() -> CodexAppServer01445Reader {
        reader_from_frames(
            include_bytes!(
                "../../../compat/codex/0.144.5/fixtures/account-privacy-sentinels.jsonl"
            ),
            include_bytes!("../../../compat/codex/0.144.5/fixtures/usage-daily.jsonl"),
        )
    }

    #[test]
    fn exact_codex_reader_discovers_one_explicit_attach_candidate() {
        let reader = privacy_reader();
        validate_reader_metadata(&reader).expect("Codex reader metadata must match the registry");
        assert_eq!(reader.provider(), AgentProvider::Codex);
        assert_eq!(
            reader.reader_version(),
            CODEX_APP_SERVER_0_144_5_READER_VERSION
        );
        assert_eq!(
            reader.accounting_revision(),
            CODEX_APP_SERVER_0_144_5_ACCOUNTING_REVISION
        );
        assert_eq!(reader.scope_kind(), AccountingScope::AgentAccount);

        let candidate = reader
            .discover_accounts()
            .expect("discovery must remain safe")
            .pop()
            .expect("one ChatGPT account must be discovered");
        assert_eq!(candidate.safe_display_label(), "Codex account");
        assert_eq!(candidate.fingerprint_kind(), FingerprintKind::Unavailable);
        assert_eq!(candidate.account_fingerprint_digest(), None);
        assert_eq!(
            reader.diagnose(candidate.handle()).status(),
            ReaderStatus::Ready
        );
    }

    #[test]
    fn exact_codex_reader_emits_only_utc_dates_and_decimal_totals() {
        let reader = privacy_reader();
        let candidate = reader.discover_accounts().unwrap().pop().unwrap();
        let window = UtcUsageWindow::new("2026-07-13".to_owned(), "2026-07-14".to_owned())
            .expect("fixture window must be valid");
        let usage = reader
            .read_daily_usage(candidate.handle(), &window)
            .expect("fixture usage must map");

        assert_eq!(usage.entries().len(), 2);
        assert_eq!(usage.entries()[0].usage_date(), "2026-07-13");
        assert_eq!(usage.entries()[0].daily_token_total(), "123");
        assert_eq!(usage.entries()[1].usage_date(), "2026-07-14");
        assert_eq!(usage.entries()[1].daily_token_total(), "456");
    }

    #[test]
    fn raw_provider_privacy_sentinels_cannot_cross_the_canonical_boundary() {
        let raw_account =
            include_str!("../../../compat/codex/0.144.5/fixtures/account-privacy-sentinels.jsonl");
        for sentinel in PRIVACY_SENTINELS {
            assert!(
                raw_account.contains(sentinel),
                "the raw fixture must exercise every prohibited privacy class"
            );
        }

        let reader = privacy_reader();
        let candidate = reader.discover_accounts().unwrap().pop().unwrap();
        let usage = reader
            .read_daily_usage(
                candidate.handle(),
                &UtcUsageWindow::new("2026-07-13".to_owned(), "2026-07-14".to_owned()).unwrap(),
            )
            .unwrap();
        let safe_projection = serde_json::json!({
            "provider": reader.provider().as_str(),
            "readerVersion": reader.reader_version(),
            "accountingRevision": reader.accounting_revision(),
            "scopeKind": reader.scope_kind().as_str(),
            "fingerprintKind": candidate.fingerprint_kind().as_str(),
            "safeDisplayLabel": candidate.safe_display_label(),
            "status": reader.diagnose(candidate.handle()).status().as_str(),
            "dailyEntries": usage.entries().iter().map(|entry| {
                serde_json::json!({
                    "usageDate": entry.usage_date(),
                    "dailyTokenTotal": entry.daily_token_total(),
                })
            }).collect::<Vec<Value>>(),
        });
        let emitted = serde_json::to_string(&safe_projection).unwrap();
        let diagnostics = format!(
            "{reader:?} {candidate:?} {usage:?}",
            reader = reader.diagnose(candidate.handle())
        );
        for sentinel in PRIVACY_SENTINELS {
            assert!(!emitted.contains(sentinel));
            assert!(!diagnostics.contains(sentinel));
        }
        for forbidden_key in [
            "email",
            "login",
            "path",
            "repository",
            "model",
            "prompt",
            "code",
            "conversation",
            "accessToken",
            "apiKey",
            "raw",
        ] {
            assert!(!emitted.contains(&format!("\"{forbidden_key}\":")));
        }
    }
}
