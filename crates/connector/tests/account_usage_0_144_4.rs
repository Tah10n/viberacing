use viberacing_connector::{
    CandidateCodex01444AccountUsage, ConnectorHandshake, MAX_DAILY_USAGE_ENTRIES, MAX_FRAME_BYTES,
    MAX_SYNC_TOKEN_VALUE, ProtocolError,
};

const INITIALIZE_RESPONSE: &[u8] = b"{\"id\":0,\"result\":{\"codexHome\":\"X:\\\\synthetic\\\\codex-home\",\"platformFamily\":\"windows\",\"platformOs\":\"windows\",\"userAgent\":\"codex-cli/0.144.4\"}}\n";
const ACCOUNT_CHATGPT: &[u8] =
    include_bytes!("../../../compat/codex/0.144.4/fixtures/account-chatgpt.jsonl");
const ACCOUNT_NULL_EMAIL: &[u8] =
    include_bytes!("../../../compat/codex/0.144.4/fixtures/account-null-email.jsonl");
const ACCOUNT_UNSUPPORTED: &[u8] =
    include_bytes!("../../../compat/codex/0.144.4/fixtures/account-unsupported.jsonl");
const ACCOUNT_UNKNOWN_FIELD: &[u8] =
    include_bytes!("../../../compat/codex/0.144.4/fixtures/account-unknown-field.jsonl");
const USAGE_DAILY: &[u8] =
    include_bytes!("../../../compat/codex/0.144.4/fixtures/usage-daily.jsonl");
const USAGE_NULLABLE: &[u8] =
    include_bytes!("../../../compat/codex/0.144.4/fixtures/usage-nullable.jsonl");
const USAGE_MISSING_FIELD: &[u8] =
    include_bytes!("../../../compat/codex/0.144.4/fixtures/usage-missing-field.jsonl");
const USAGE_MALFORMED_DATE: &[u8] =
    include_bytes!("../../../compat/codex/0.144.4/fixtures/usage-malformed-date.jsonl");
const USAGE_UNKNOWN_FIELD: &[u8] =
    include_bytes!("../../../compat/codex/0.144.4/fixtures/usage-unknown-field.jsonl");

fn candidate() -> CandidateCodex01444AccountUsage {
    let mut handshake = ConnectorHandshake::new();
    handshake.start().expect("fresh handshake must start");
    handshake
        .accept_initialize_response(INITIALIZE_RESPONSE)
        .expect("reviewed initialization fixture must pass");
    handshake
        .into_codex_0_144_4_account_usage()
        .expect("completed handshake must convert")
}

fn awaiting_account() -> CandidateCodex01444AccountUsage {
    let mut candidate = candidate();
    candidate
        .start_account_read()
        .expect("fresh candidate must request account mode");
    candidate
}

fn awaiting_usage() -> CandidateCodex01444AccountUsage {
    let mut candidate = awaiting_account();
    candidate
        .accept_account_read_response(ACCOUNT_CHATGPT)
        .expect("reviewed ChatGPT account fixture must pass");
    candidate
        .start_usage_read()
        .expect("confirmed ChatGPT mode must allow usage read");
    candidate
}

fn framed(json: &str) -> Vec<u8> {
    let mut frame = json.as_bytes().to_vec();
    frame.push(b'\n');
    frame
}

#[test]
fn requires_the_handshake_and_emits_only_fixed_candidate_requests() {
    assert!(matches!(
        ConnectorHandshake::new().into_codex_0_144_4_account_usage(),
        Err(ProtocolError::InvalidState)
    ));

    let mut candidate = candidate();
    assert_eq!(
        candidate.start_account_read(),
        Ok(
            b"{\"id\":1,\"method\":\"account/read\",\"params\":{\"refreshToken\":false}}\n"
                .as_slice()
        ),
    );
    assert_eq!(
        candidate.start_account_read(),
        Err(ProtocolError::InvalidState)
    );
    candidate
        .accept_account_read_response(ACCOUNT_CHATGPT)
        .expect("fixed account response must pass");
    assert_eq!(
        candidate.start_usage_read(),
        Ok(b"{\"id\":2,\"method\":\"account/usage/read\",\"params\":null}\n".as_slice()),
    );
    assert_eq!(
        candidate.start_usage_read(),
        Err(ProtocolError::InvalidState)
    );
    assert!(!candidate.is_complete());
}

#[test]
fn minimizes_sorts_and_redacts_the_positive_usage_fixture() {
    let mut candidate = awaiting_usage();
    let usage = candidate
        .accept_usage_read_response(USAGE_DAILY)
        .expect("reviewed usage fixture must pass");

    assert!(candidate.is_complete());
    assert_eq!(usage.len(), 2);
    assert!(!usage.is_empty());
    assert_eq!(usage.entries()[0].codex_reported_date(), "2026-07-13");
    assert_eq!(usage.entries()[0].tokens(), 123);
    assert_eq!(usage.entries()[1].codex_reported_date(), "2026-07-14");
    assert_eq!(usage.entries()[1].tokens(), 456);

    let diagnostic = format!("{usage:?}");
    assert_eq!(diagnostic, "DailyUsage { entry_count: 2, .. }");
    for private_value in ["2026-07-13", "2026-07-14", "123", "456", "579"] {
        assert!(!diagnostic.contains(private_value));
    }
    assert_eq!(
        candidate.accept_usage_read_response(USAGE_DAILY),
        Err(ProtocolError::InvalidState),
    );
}

#[test]
fn accepts_nullable_upstream_fields_without_retaining_them() {
    let mut nullable_account = awaiting_account();
    nullable_account
        .accept_account_read_response(ACCOUNT_NULL_EMAIL)
        .expect("nullable email and unknown plan enum must be discarded");
    nullable_account
        .start_usage_read()
        .expect("nullable account fixture still proves ChatGPT mode");
    let usage = nullable_account
        .accept_usage_read_response(USAGE_NULLABLE)
        .expect("nullable summary and buckets must pass");
    assert!(usage.is_empty());
    assert!(usage.entries().is_empty());
    assert!(nullable_account.is_complete());

    for frame in [
        framed(r#"{"id":2,"result":{"summary":{}}}"#),
        framed(r#"{"id":2,"result":{"dailyUsageBuckets":[],"summary":{}}}"#),
    ] {
        let mut candidate = awaiting_usage();
        let usage = candidate
            .accept_usage_read_response(&frame)
            .expect("missing or empty optional buckets must produce no uploadable entries");
        assert!(usage.is_empty());
        assert!(candidate.is_complete());
    }
}

#[test]
fn rejects_unsupported_account_modes_before_usage_and_fails_terminally() {
    for frame in [
        ACCOUNT_UNSUPPORTED.to_vec(),
        framed(
            r#"{"id":1,"result":{"account":{"type":"amazonBedrock"},"requiresOpenaiAuth":false}}"#,
        ),
        framed(r#"{"id":1,"result":{"requiresOpenaiAuth":false}}"#),
        framed(r#"{"id":1,"result":{"account":null,"requiresOpenaiAuth":false}}"#),
        framed(
            r#"{"id":1,"result":{"account":{"email":null,"planType":"plus","type":"chatgpt"},"requiresOpenaiAuth":true}}"#,
        ),
    ] {
        let mut candidate = awaiting_account();
        assert_eq!(
            candidate.accept_account_read_response(&frame),
            Err(ProtocolError::UnsupportedAccountMode)
        );
        assert_eq!(
            candidate.start_usage_read(),
            Err(ProtocolError::InvalidState)
        );
        assert_eq!(
            candidate.accept_account_read_response(ACCOUNT_CHATGPT),
            Err(ProtocolError::InvalidState)
        );
    }
}

#[test]
fn rejects_malformed_account_shapes_without_reflecting_private_fields() {
    let cases = [
        ACCOUNT_UNKNOWN_FIELD.to_vec(),
        framed(
            r#"{"id":7,"result":{"account":{"email":null,"planType":"plus","type":"chatgpt"},"requiresOpenaiAuth":false}}"#,
        ),
        framed(
            r#"{"id":1,"result":{"account":{"email":null,"planType":"future","type":"chatgpt"},"requiresOpenaiAuth":false}}"#,
        ),
        framed(
            r#"{"id":1,"result":{"account":{"planType":"plus","type":"chatgpt"},"requiresOpenaiAuth":false}}"#,
        ),
        framed(
            r#"{"id":1,"result":{"account":{"email":null,"email":null,"planType":"plus","type":"chatgpt"},"requiresOpenaiAuth":false}}"#,
        ),
        framed(
            r#"{"id":1,"result":{"account":{"email":null,"planType":"plus","type":"chatgpt"},"requiresOpenaiAuth":false,"requiresOpenaiAuth":false}}"#,
        ),
        framed(r#"{"id":1,"error":{"message":"synthetic-private-marker"}}"#),
        framed(
            r#"{"jsonrpc":"2.0","id":1,"result":{"account":{"email":null,"planType":"plus","type":"chatgpt"},"requiresOpenaiAuth":false}}"#,
        ),
    ];

    for frame in cases {
        let mut candidate = awaiting_account();
        let error = candidate
            .accept_account_read_response(&frame)
            .expect_err("open, duplicate, or mismatched account input must fail");
        assert_eq!(error, ProtocolError::InvalidMessage);
        assert_eq!(error.to_string(), "app-server message is invalid");
        assert!(!error.to_string().contains("synthetic-private-marker"));
        assert_eq!(
            candidate.accept_account_read_response(ACCOUNT_CHATGPT),
            Err(ProtocolError::InvalidState)
        );
    }
}

#[test]
fn enforces_email_bounds_without_exposing_the_value() {
    for email in [String::new(), "x".repeat(321), "line\nbreak".to_owned()] {
        let frame = framed(&format!(
            "{{\"id\":1,\"result\":{{\"account\":{{\"email\":{},\"planType\":\"plus\",\"type\":\"chatgpt\"}},\"requiresOpenaiAuth\":false}}}}",
            serde_json::to_string(&email).expect("synthetic string must serialize")
        ));
        let mut candidate = awaiting_account();
        let error = candidate
            .accept_account_read_response(&frame)
            .expect_err("unbounded account email must fail");
        assert_eq!(error, ProtocolError::InvalidMessage);
        if !email.is_empty() {
            assert!(!error.to_string().contains(&email));
        }
    }
}

#[test]
fn rejects_checked_in_missing_malformed_and_unknown_usage_fixtures() {
    for frame in [
        USAGE_MISSING_FIELD,
        USAGE_MALFORMED_DATE,
        USAGE_UNKNOWN_FIELD,
    ] {
        let mut candidate = awaiting_usage();
        let error = candidate
            .accept_usage_read_response(frame)
            .expect_err("negative compatibility fixture must fail");
        assert_eq!(error, ProtocolError::InvalidMessage);
        assert!(!error.to_string().contains("synthetic-private-marker"));
        assert_eq!(
            candidate.accept_usage_read_response(USAGE_DAILY),
            Err(ProtocolError::InvalidState)
        );
    }
}

#[test]
fn enforces_generated_frame_collection_identity_and_integer_cases() {
    let duplicate_date = framed(
        r#"{"id":2,"result":{"dailyUsageBuckets":[{"startDate":"2026-07-14","tokens":1},{"startDate":"2026-07-14","tokens":2}],"summary":{}}}"#,
    );
    let invalid_id = framed(r#"{"id":3,"result":{"dailyUsageBuckets":[],"summary":{}}}"#);
    let unsafe_integer = framed(&format!(
        "{{\"id\":2,\"result\":{{\"dailyUsageBuckets\":[{{\"startDate\":\"2026-07-14\",\"tokens\":{}}}],\"summary\":{{}}}}}}",
        MAX_SYNC_TOKEN_VALUE + 1
    ));
    let duplicate_key = framed(
        r#"{"id":2,"result":{"dailyUsageBuckets":[{"startDate":"2026-07-14","tokens":1,"\u0074okens":1}],"summary":{}}}"#,
    );
    let too_many_entries = framed(&format!(
        "{{\"id\":2,\"result\":{{\"dailyUsageBuckets\":[{}],\"summary\":{{}}}}}}",
        (0..=MAX_DAILY_USAGE_ENTRIES)
            .map(|_| r#"{"startDate":"2026-07-14","tokens":1}"#)
            .collect::<Vec<_>>()
            .join(",")
    ));
    let invalid_utf8 = vec![b'{', b'"', 0xff, b'"', b':', b'0', b'}', b'\n'];
    let mut oversized = vec![b'x'; MAX_FRAME_BYTES];
    oversized.push(b'\n');

    for (frame, expected) in [
        (duplicate_date, ProtocolError::InvalidMessage),
        (invalid_id, ProtocolError::InvalidMessage),
        (unsafe_integer, ProtocolError::InvalidMessage),
        (duplicate_key, ProtocolError::InvalidMessage),
        (too_many_entries, ProtocolError::InvalidMessage),
        (invalid_utf8, ProtocolError::InvalidMessage),
        (oversized, ProtocolError::FrameTooLarge),
    ] {
        let mut candidate = awaiting_usage();
        assert_eq!(candidate.accept_usage_read_response(&frame), Err(expected));
        assert!(!candidate.is_complete());
    }
}

#[test]
fn accepts_calendar_and_integer_boundaries_but_rejects_invalid_dates() {
    let boundary_json = r#"{"id":2,"result":{"dailyUsageBuckets":[{"startDate":"2096-02-29","tokens":__MAX__},{"startDate":"2000-01-01","tokens":0}],"summary":{"lifetimeTokens":__MAX__}}}"#
        .replace("__MAX__", &MAX_SYNC_TOKEN_VALUE.to_string());
    let boundary = framed(&boundary_json);
    let mut candidate = awaiting_usage();
    let usage = candidate
        .accept_usage_read_response(&boundary)
        .expect("calendar and safe-integer boundaries must pass");
    assert_eq!(usage.entries()[0].codex_reported_date(), "2000-01-01");
    assert_eq!(usage.entries()[0].tokens(), 0);
    assert_eq!(usage.entries()[1].codex_reported_date(), "2096-02-29");
    assert_eq!(usage.entries()[1].tokens(), MAX_SYNC_TOKEN_VALUE);

    for date in [
        "1999-12-31",
        "2100-01-01",
        "2025-02-29",
        "2026-00-01",
        "2026-13-01",
        "2026-04-31",
        "2026-01-00",
        "2026-1-01",
    ] {
        let frame = framed(&format!(
            "{{\"id\":2,\"result\":{{\"dailyUsageBuckets\":[{{\"startDate\":\"{date}\",\"tokens\":1}}],\"summary\":{{}}}}}}"
        ));
        let mut candidate = awaiting_usage();
        assert_eq!(
            candidate.accept_usage_read_response(&frame),
            Err(ProtocolError::InvalidMessage),
            "date must fail: {date}"
        );
    }
}

#[test]
fn rejects_open_duplicate_or_unbounded_summary_and_bucket_values() {
    let cases = [
        r#"{"id":2,"result":{"dailyUsageBuckets":[],"summary":{"future":1}}}"#.to_owned(),
        r#"{"id":2,"result":{"dailyUsageBuckets":[],"summary":{"lifetimeTokens":1,"lifetimeTokens":1}}}"#.to_owned(),
        format!(
            "{{\"id\":2,\"result\":{{\"dailyUsageBuckets\":[],\"summary\":{{\"lifetimeTokens\":{}}}}}}}",
            MAX_SYNC_TOKEN_VALUE + 1
        ),
        r#"{"id":2,"result":{"dailyUsageBuckets":[{"startDate":"2026-07-14","tokens":-1}],"summary":{}}}"#.to_owned(),
        r#"{"id":2,"result":{"dailyUsageBuckets":[{"startDate":"2026-07-14","tokens":1.0}],"summary":{}}}"#.to_owned(),
        r#"{"id":2,"result":{"dailyUsageBuckets":{},"summary":{}}}"#.to_owned(),
        r#"{"id":2,"result":{"dailyUsageBuckets":[],"dailyUsageBuckets":[],"summary":{}}}"#.to_owned(),
        r#"{"id":2,"result":{"dailyUsageBuckets":[]}}"#.to_owned(),
        r#"{"id":2,"result":{"dailyUsageBuckets":[],"summary":{},"future":true}}"#.to_owned(),
    ];

    for json in cases {
        let mut candidate = awaiting_usage();
        assert_eq!(
            candidate.accept_usage_read_response(&framed(&json)),
            Err(ProtocolError::InvalidMessage)
        );
    }
}
