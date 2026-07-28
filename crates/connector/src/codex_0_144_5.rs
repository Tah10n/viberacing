//! Candidate-only parser for the stable Codex App Server `0.144.5` account schemas.

use std::{fmt, marker::PhantomData};

use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};

use super::{EnvelopeField, ProtocolError, validate_frame};

const ACCOUNT_READ_REQUEST: &[u8] =
    b"{\"id\":1,\"method\":\"account/read\",\"params\":{\"refreshToken\":false}}\n";
const USAGE_READ_REQUEST: &[u8] = b"{\"id\":2,\"method\":\"account/usage/read\",\"params\":null}\n";

macro_rules! string_enum {
    ($type:ty, $visitor:ident, { $($value:literal => $result:expr,)+ }) => {
        impl<'de> Deserialize<'de> for $type {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                deserializer.deserialize_str($visitor)
            }
        }

        struct $visitor;

        impl Visitor<'_> for $visitor {
            type Value = $type;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a reviewed string enum value")
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                match value {
                    $($value => Ok($result),)+
                    _ => Err(E::custom("unknown string enum value")),
                }
            }
        }
    };
}

macro_rules! string_unit {
    ($type:ty, $visitor:ident, [$($value:literal,)+]) => {
        impl<'de> Deserialize<'de> for $type {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                deserializer.deserialize_str($visitor)
            }
        }

        struct $visitor;

        impl Visitor<'_> for $visitor {
            type Value = $type;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a reviewed string enum value")
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                match value {
                    $($value => Ok(Default::default()),)+
                    _ => Err(E::custom("unknown string enum value")),
                }
            }
        }
    };
}

/// Maximum daily buckets admitted into a `UsageSyncV1` payload.
pub const MAX_DAILY_USAGE_ENTRIES: usize = 31;

/// Largest exact token integer admitted by the language-neutral sync contract.
pub const MAX_SYNC_TOKEN_VALUE: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum AccountUsageState {
    #[default]
    ReadyForAccount,
    AwaitingAccount,
    ReadyForUsage,
    AwaitingUsage,
    Complete,
    Failed,
}

/// Candidate state machine for the exact Codex App Server `0.144.5` account schema extract.
///
/// A caller can obtain this type only by consuming a completed [`super::ConnectorHandshake`]. Any
/// invalid remote account or usage frame permanently fails the instance. No account email, plan,
/// summary statistic, or upstream field outside the bounded daily buckets is retained.
#[derive(Debug, Default)]
pub struct CandidateCodex01445AccountUsage {
    state: AccountUsageState,
}

impl CandidateCodex01445AccountUsage {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Emits the fixed `account/read` request with proactive token refresh disabled.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::InvalidState`] unless this is the first account operation.
    pub fn start_account_read(&mut self) -> Result<&'static [u8], ProtocolError> {
        if self.state != AccountUsageState::ReadyForAccount {
            return Err(ProtocolError::InvalidState);
        }
        self.state = AccountUsageState::AwaitingAccount;
        Ok(ACCOUNT_READ_REQUEST)
    }

    /// Validates the fixed-ID account response and confirms an authenticated `ChatGPT` account.
    ///
    /// Email and plan values are shape-checked and immediately discarded. API-key, Amazon Bedrock,
    /// missing, or reauthentication-required states fail locally before usage is requested.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::InvalidState`] unless [`Self::start_account_read`] emitted the
    /// pending request. Invalid remote input permanently fails this adapter. A structurally valid
    /// non-ChatGPT account returns [`ProtocolError::UnsupportedAccountMode`] and also fails it.
    pub fn accept_account_read_response(&mut self, frame: &[u8]) -> Result<(), ProtocolError> {
        if self.state != AccountUsageState::AwaitingAccount {
            return Err(ProtocolError::InvalidState);
        }

        match decode_response::<AccountMode, 1>(frame) {
            Ok(AccountMode::ChatGpt) => {
                self.state = AccountUsageState::ReadyForUsage;
                Ok(())
            }
            Ok(AccountMode::Unsupported) => {
                self.state = AccountUsageState::Failed;
                Err(ProtocolError::UnsupportedAccountMode)
            }
            Err(error) => {
                self.state = AccountUsageState::Failed;
                Err(error)
            }
        }
    }

    /// Emits the fixed `account/usage/read` request after `ChatGPT` mode is confirmed.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::InvalidState`] unless the account response completed successfully.
    pub fn start_usage_read(&mut self) -> Result<&'static [u8], ProtocolError> {
        if self.state != AccountUsageState::ReadyForUsage {
            return Err(ProtocolError::InvalidState);
        }
        self.state = AccountUsageState::AwaitingUsage;
        Ok(USAGE_READ_REQUEST)
    }

    /// Validates and minimizes the fixed-ID usage response.
    ///
    /// Returned buckets are sorted by `codexReportedDate`, contain no duplicate dates, and already
    /// satisfy the count, calendar, and integer bounds of the public connector sync contract.
    /// Summary fields are shape-checked and discarded. A missing or null daily-bucket field returns
    /// an empty result so a later sync composer can choose not to upload.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::InvalidState`] unless [`Self::start_usage_read`] emitted the pending
    /// request. Invalid remote input permanently fails this adapter.
    pub fn accept_usage_read_response(
        &mut self,
        frame: &[u8],
    ) -> Result<DailyUsage, ProtocolError> {
        if self.state != AccountUsageState::AwaitingUsage {
            return Err(ProtocolError::InvalidState);
        }

        match decode_response::<UsageReadResult, 2>(frame) {
            Ok(result) => {
                self.state = AccountUsageState::Complete;
                Ok(DailyUsage {
                    entries: result.entries,
                })
            }
            Err(error) => {
                self.state = AccountUsageState::Failed;
                Err(error)
            }
        }
    }

    /// Reports whether both reviewed account reads completed successfully.
    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.state == AccountUsageState::Complete
    }
}

/// Privacy-minimized daily usage returned by the candidate adapter.
#[derive(Clone, Eq, PartialEq)]
pub struct DailyUsage {
    entries: Vec<DailyUsageEntry>,
}

impl DailyUsage {
    /// Returns the normalized daily entries in ascending date order.
    #[must_use]
    pub fn entries(&self) -> &[DailyUsageEntry] {
        &self.entries
    }

    /// Returns the number of admitted daily entries.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Reports whether Codex returned no daily usage buckets.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl fmt::Debug for DailyUsage {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DailyUsage")
            .field("entry_count", &self.entries.len())
            .finish_non_exhaustive()
    }
}

/// One private daily usage value ready for the signed sync composer.
///
/// `Debug` is deliberately not implemented so exact private usage does not enter diagnostics by
/// accident.
#[derive(Clone, Eq, PartialEq)]
pub struct DailyUsageEntry {
    codex_reported_date: String,
    tokens: u64,
}

impl DailyUsageEntry {
    /// Returns the strict `YYYY-MM-DD` calendar label reported by Codex.
    #[must_use]
    pub fn codex_reported_date(&self) -> &str {
        &self.codex_reported_date
    }

    /// Returns the exact private token value for this reported date.
    #[must_use]
    pub fn tokens(&self) -> u64 {
        self.tokens
    }
}

fn decode_response<T, const REQUEST_ID: u64>(frame: &[u8]) -> Result<T, ProtocolError>
where
    T: for<'de> Deserialize<'de>,
{
    let payload = validate_frame(frame)?;
    let mut deserializer = serde_json::Deserializer::from_slice(payload);
    ResponseEnvelope::<T, REQUEST_ID>::deserialize(&mut deserializer)
        .and_then(|envelope| {
            deserializer.end()?;
            Ok(envelope.result)
        })
        .map_err(|_| ProtocolError::InvalidMessage)
}

struct ResponseEnvelope<T, const REQUEST_ID: u64> {
    result: T,
}

impl<'de, T, const REQUEST_ID: u64> Deserialize<'de> for ResponseEnvelope<T, REQUEST_ID>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(ResponseEnvelopeVisitor::<T, REQUEST_ID>(PhantomData))
    }
}

struct ResponseEnvelopeVisitor<T, const REQUEST_ID: u64>(PhantomData<T>);

impl<'de, T, const REQUEST_ID: u64> Visitor<'de> for ResponseEnvelopeVisitor<T, REQUEST_ID>
where
    T: Deserialize<'de>,
{
    type Value = ResponseEnvelope<T, REQUEST_ID>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a closed fixed-id response envelope")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut saw_id = false;
        let mut result = None;
        while let Some(field) = map.next_key::<EnvelopeField>()? {
            match field {
                EnvelopeField::Id if !saw_id => {
                    saw_id = true;
                    if map.next_value::<u64>()? != REQUEST_ID {
                        return Err(de::Error::custom("unexpected request id"));
                    }
                }
                EnvelopeField::Result if result.is_none() => {
                    result = Some(map.next_value::<T>()?);
                }
                _ => return Err(de::Error::custom("duplicate response field")),
            }
        }

        match (saw_id, result) {
            (true, Some(result)) => Ok(ResponseEnvelope { result }),
            _ => Err(de::Error::custom("missing response field")),
        }
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum AccountMode {
    ChatGpt,
    Unsupported,
}

impl<'de> Deserialize<'de> for AccountMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(AccountReadResultVisitor)
    }
}

struct AccountReadResultVisitor;

impl<'de> Visitor<'de> for AccountReadResultVisitor {
    type Value = AccountMode;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the closed Codex 0.144.5 account result")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut account = None;
        let mut requires_auth = None;
        while let Some(field) = map.next_key::<AccountResultField>()? {
            match field {
                AccountResultField::Account if account.is_none() => {
                    account = Some(map.next_value::<Option<Account>>()?);
                }
                AccountResultField::RequiresOpenaiAuth if requires_auth.is_none() => {
                    requires_auth = Some(map.next_value::<bool>()?);
                }
                _ => return Err(de::Error::custom("duplicate account result field")),
            }
        }

        let requires_auth =
            requires_auth.ok_or_else(|| de::Error::custom("missing account result field"))?;
        if requires_auth {
            return Ok(AccountMode::Unsupported);
        }
        Ok(match account.flatten().map(|value| value.mode) {
            Some(AccountMode::ChatGpt) => AccountMode::ChatGpt,
            _ => AccountMode::Unsupported,
        })
    }
}

enum AccountResultField {
    Account,
    RequiresOpenaiAuth,
}

impl<'de> Deserialize<'de> for AccountResultField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_identifier(AccountResultFieldVisitor)
    }
}

struct AccountResultFieldVisitor;

impl Visitor<'_> for AccountResultFieldVisitor {
    type Value = AccountResultField;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("account or requiresOpenaiAuth")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        match value {
            "account" => Ok(AccountResultField::Account),
            "requiresOpenaiAuth" => Ok(AccountResultField::RequiresOpenaiAuth),
            _ => Err(E::custom("unknown account result field")),
        }
    }
}

struct Account {
    mode: AccountMode,
}

impl<'de> Deserialize<'de> for Account {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(AccountVisitor)
    }
}

struct AccountVisitor;

impl<'de> Visitor<'de> for AccountVisitor {
    type Value = Account;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a closed Codex 0.144.5 account variant")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut account_type = None;
        let mut saw_email = false;
        let mut saw_plan = false;
        let mut saw_credential_source = false;
        while let Some(field) = map.next_key::<AccountField>()? {
            match field {
                AccountField::Type if account_type.is_none() => {
                    account_type = Some(map.next_value::<AccountType>()?);
                }
                AccountField::Email if !saw_email => {
                    saw_email = true;
                    map.next_value::<NullableDiscardedEmail>()?;
                }
                AccountField::PlanType if !saw_plan => {
                    saw_plan = true;
                    map.next_value::<PlanType>()?;
                }
                AccountField::CredentialSource if !saw_credential_source => {
                    saw_credential_source = true;
                    map.next_value::<CredentialSource>()?;
                }
                _ => return Err(de::Error::custom("duplicate account field")),
            }
        }

        let account_type = account_type.ok_or_else(|| de::Error::custom("missing account type"))?;
        let mode = match account_type {
            AccountType::ChatGpt if saw_email && saw_plan && !saw_credential_source => {
                AccountMode::ChatGpt
            }
            AccountType::ApiKey if !saw_email && !saw_plan && !saw_credential_source => {
                AccountMode::Unsupported
            }
            AccountType::AmazonBedrock if !saw_email && !saw_plan => AccountMode::Unsupported,
            _ => return Err(de::Error::custom("account variant shape is invalid")),
        };
        Ok(Account { mode })
    }
}

enum AccountField {
    Type,
    Email,
    PlanType,
    CredentialSource,
}

impl<'de> Deserialize<'de> for AccountField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_identifier(AccountFieldVisitor)
    }
}

struct AccountFieldVisitor;

impl Visitor<'_> for AccountFieldVisitor {
    type Value = AccountField;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a reviewed account field")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        match value {
            "type" => Ok(AccountField::Type),
            "email" => Ok(AccountField::Email),
            "planType" => Ok(AccountField::PlanType),
            "credentialSource" => Ok(AccountField::CredentialSource),
            _ => Err(E::custom("unknown account field")),
        }
    }
}

#[derive(Clone, Copy)]
enum AccountType {
    ApiKey,
    ChatGpt,
    AmazonBedrock,
}

string_enum!(AccountType, AccountTypeVisitor, {
    "apiKey" => AccountType::ApiKey,
    "chatgpt" => AccountType::ChatGpt,
    "amazonBedrock" => AccountType::AmazonBedrock,
});

struct PlanType;

string_unit!(
    PlanType,
    PlanTypeVisitor,
    [
        "free",
        "go",
        "plus",
        "pro",
        "prolite",
        "team",
        "self_serve_business_usage_based",
        "business",
        "enterprise_cbp_usage_based",
        "enterprise",
        "edu",
        "unknown",
    ]
);

struct CredentialSource;

string_unit!(
    CredentialSource,
    CredentialSourceVisitor,
    ["codexManaged", "awsManaged",]
);

impl Default for PlanType {
    fn default() -> Self {
        Self
    }
}

impl Default for CredentialSource {
    fn default() -> Self {
        Self
    }
}

struct NullableDiscardedEmail;

impl<'de> Deserialize<'de> for NullableDiscardedEmail {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_option(NullableDiscardedEmailVisitor)
    }
}

struct NullableDiscardedEmailVisitor;

impl<'de> Visitor<'de> for NullableDiscardedEmailVisitor {
    type Value = NullableDiscardedEmail;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a bounded nullable email that is immediately discarded")
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(NullableDiscardedEmail)
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(NullableDiscardedEmail)
    }

    fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_str(DiscardedEmailVisitor)
    }
}

struct DiscardedEmailVisitor;

impl Visitor<'_> for DiscardedEmailVisitor {
    type Value = NullableDiscardedEmail;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a bounded account email")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        if value.is_empty() || value.len() > 320 || value.chars().any(char::is_control) {
            return Err(E::custom("account email is outside accepted bounds"));
        }
        Ok(NullableDiscardedEmail)
    }
}

struct UsageReadResult {
    entries: Vec<DailyUsageEntry>,
}

impl<'de> Deserialize<'de> for UsageReadResult {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(UsageReadResultVisitor)
    }
}

struct UsageReadResultVisitor;

impl<'de> Visitor<'de> for UsageReadResultVisitor {
    type Value = UsageReadResult;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the closed Codex 0.144.5 usage result")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut daily_buckets = None;
        let mut saw_summary = false;
        while let Some(field) = map.next_key::<UsageResultField>()? {
            match field {
                UsageResultField::DailyUsageBuckets if daily_buckets.is_none() => {
                    daily_buckets = Some(map.next_value::<Option<DailyBuckets>>()?);
                }
                UsageResultField::Summary if !saw_summary => {
                    saw_summary = true;
                    map.next_value::<UsageSummary>()?;
                }
                _ => return Err(de::Error::custom("duplicate usage result field")),
            }
        }
        if !saw_summary {
            return Err(de::Error::custom("missing usage summary"));
        }

        let mut entries = daily_buckets
            .flatten()
            .map_or_else(Vec::new, |value| value.0);
        entries.sort_unstable_by(|left, right| {
            left.codex_reported_date.cmp(&right.codex_reported_date)
        });
        if entries
            .windows(2)
            .any(|pair| pair[0].codex_reported_date == pair[1].codex_reported_date)
        {
            return Err(de::Error::custom("duplicate reported date"));
        }
        Ok(UsageReadResult { entries })
    }
}

enum UsageResultField {
    DailyUsageBuckets,
    Summary,
}

impl<'de> Deserialize<'de> for UsageResultField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_identifier(UsageResultFieldVisitor)
    }
}

struct UsageResultFieldVisitor;

impl Visitor<'_> for UsageResultFieldVisitor {
    type Value = UsageResultField;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("dailyUsageBuckets or summary")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        match value {
            "dailyUsageBuckets" => Ok(UsageResultField::DailyUsageBuckets),
            "summary" => Ok(UsageResultField::Summary),
            _ => Err(E::custom("unknown usage result field")),
        }
    }
}

struct DailyBuckets(Vec<DailyUsageEntry>);

impl<'de> Deserialize<'de> for DailyBuckets {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_seq(DailyBucketsVisitor)
    }
}

struct DailyBucketsVisitor;

impl<'de> Visitor<'de> for DailyBucketsVisitor {
    type Value = DailyBuckets;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("at most 31 bounded daily usage buckets")
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        if sequence
            .size_hint()
            .is_some_and(|size| size > MAX_DAILY_USAGE_ENTRIES)
        {
            return Err(de::Error::custom("too many daily usage buckets"));
        }
        let mut entries = Vec::with_capacity(
            sequence
                .size_hint()
                .unwrap_or(0)
                .min(MAX_DAILY_USAGE_ENTRIES),
        );
        while let Some(entry) = sequence.next_element::<DailyUsageEntry>()? {
            if entries.len() == MAX_DAILY_USAGE_ENTRIES {
                return Err(de::Error::custom("too many daily usage buckets"));
            }
            entries.push(entry);
        }
        Ok(DailyBuckets(entries))
    }
}

impl<'de> Deserialize<'de> for DailyUsageEntry {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(DailyUsageEntryVisitor)
    }
}

struct DailyUsageEntryVisitor;

impl<'de> Visitor<'de> for DailyUsageEntryVisitor {
    type Value = DailyUsageEntry;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a closed bounded daily usage bucket")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut start_date = None;
        let mut tokens = None;
        while let Some(field) = map.next_key::<DailyBucketField>()? {
            match field {
                DailyBucketField::StartDate if start_date.is_none() => {
                    start_date = Some(map.next_value::<ReportedDate>()?.0);
                }
                DailyBucketField::Tokens if tokens.is_none() => {
                    tokens = Some(map.next_value::<SafeUnsigned>()?.0);
                }
                _ => return Err(de::Error::custom("duplicate daily bucket field")),
            }
        }
        Ok(DailyUsageEntry {
            codex_reported_date: start_date
                .ok_or_else(|| de::Error::custom("missing daily bucket field"))?,
            tokens: tokens.ok_or_else(|| de::Error::custom("missing daily bucket field"))?,
        })
    }
}

enum DailyBucketField {
    StartDate,
    Tokens,
}

impl<'de> Deserialize<'de> for DailyBucketField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_identifier(DailyBucketFieldVisitor)
    }
}

struct DailyBucketFieldVisitor;

impl Visitor<'_> for DailyBucketFieldVisitor {
    type Value = DailyBucketField;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("startDate or tokens")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        match value {
            "startDate" => Ok(DailyBucketField::StartDate),
            "tokens" => Ok(DailyBucketField::Tokens),
            _ => Err(E::custom("unknown daily bucket field")),
        }
    }
}

struct ReportedDate(String);

impl<'de> Deserialize<'de> for ReportedDate {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_str(ReportedDateVisitor)
    }
}

struct ReportedDateVisitor;

impl Visitor<'_> for ReportedDateVisitor {
    type Value = ReportedDate;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a valid 20xx YYYY-MM-DD calendar label")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        if valid_reported_date(value) {
            Ok(ReportedDate(value.to_owned()))
        } else {
            Err(E::custom("reported date is invalid"))
        }
    }
}

pub(crate) fn valid_reported_date(value: &str) -> bool {
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
        return false;
    }
    let year = u16::from(bytes[0] - b'0') * 1000
        + u16::from(bytes[1] - b'0') * 100
        + u16::from(bytes[2] - b'0') * 10
        + u16::from(bytes[3] - b'0');
    let month = (bytes[5] - b'0') * 10 + (bytes[6] - b'0');
    let day = (bytes[8] - b'0') * 10 + (bytes[9] - b'0');
    let maximum_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1 && day <= maximum_day
}

struct SafeUnsigned(u64);

impl<'de> Deserialize<'de> for SafeUnsigned {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u64::deserialize(deserializer)?;
        if value > MAX_SYNC_TOKEN_VALUE {
            return Err(de::Error::custom("integer exceeds the sync contract"));
        }
        Ok(SafeUnsigned(value))
    }
}

struct UsageSummary;

impl<'de> Deserialize<'de> for UsageSummary {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(UsageSummaryVisitor)
    }
}

struct UsageSummaryVisitor;

impl<'de> Visitor<'de> for UsageSummaryVisitor {
    type Value = UsageSummary;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the closed nullable usage summary")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut seen = [false; 5];
        while let Some(field) = map.next_key::<UsageSummaryField>()? {
            let index = field.index();
            if seen[index] {
                return Err(de::Error::custom("duplicate usage summary field"));
            }
            seen[index] = true;
            map.next_value::<Option<SafeUnsigned>>()?;
        }
        Ok(UsageSummary)
    }
}

#[derive(Clone, Copy)]
enum UsageSummaryField {
    CurrentStreakDays,
    LifetimeTokens,
    LongestRunningTurnSec,
    LongestStreakDays,
    PeakDailyTokens,
}

impl UsageSummaryField {
    const fn index(self) -> usize {
        match self {
            Self::CurrentStreakDays => 0,
            Self::LifetimeTokens => 1,
            Self::LongestRunningTurnSec => 2,
            Self::LongestStreakDays => 3,
            Self::PeakDailyTokens => 4,
        }
    }
}

impl<'de> Deserialize<'de> for UsageSummaryField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_identifier(UsageSummaryFieldVisitor)
    }
}

struct UsageSummaryFieldVisitor;

impl Visitor<'_> for UsageSummaryFieldVisitor {
    type Value = UsageSummaryField;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a reviewed usage summary field")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        match value {
            "currentStreakDays" => Ok(UsageSummaryField::CurrentStreakDays),
            "lifetimeTokens" => Ok(UsageSummaryField::LifetimeTokens),
            "longestRunningTurnSec" => Ok(UsageSummaryField::LongestRunningTurnSec),
            "longestStreakDays" => Ok(UsageSummaryField::LongestStreakDays),
            "peakDailyTokens" => Ok(UsageSummaryField::PeakDailyTokens),
            _ => Err(E::custom("unknown usage summary field")),
        }
    }
}
