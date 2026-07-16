use viberacing_connector::{ConnectorHandshake, MAX_FRAME_BYTES, ProtocolError};

const VALID_RESPONSE: &[u8] = b"{\"id\":0,\"result\":{\"codexHome\":\"X:\\\\synthetic\\\\codex-home\",\"platformFamily\":\"windows\",\"platformOs\":\"windows\",\"userAgent\":\"codex-cli/0.144.4\"}}\n";

fn started_handshake() -> ConnectorHandshake {
    let mut handshake = ConnectorHandshake::new();
    handshake.start().expect("fresh handshake must start");
    handshake
}

fn assert_rejected(frame: &[u8], expected: ProtocolError) {
    let mut handshake = started_handshake();
    assert_eq!(handshake.accept_initialize_response(frame), Err(expected));
    assert!(!handshake.is_initialized());
    assert_eq!(
        handshake.accept_initialize_response(VALID_RESPONSE),
        Err(ProtocolError::InvalidState),
        "a rejected frame must permanently fail this connection",
    );
}

fn framed(json: &str) -> Vec<u8> {
    let mut frame = json.as_bytes().to_vec();
    frame.push(b'\n');
    frame
}

#[test]
fn emits_only_the_reviewed_stable_handshake_messages() {
    let mut handshake = ConnectorHandshake::new();

    let initialize = handshake.start().expect("fresh handshake must start");
    assert_eq!(
        initialize,
        b"{\"id\":0,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"viberacing_connector\",\"title\":\"Vibe Racing Connector\",\"version\":\"0.0.0\"}}}\n",
    );
    assert!(
        !initialize
            .windows(b"capabilities".len())
            .any(|part| part == b"capabilities")
    );
    assert!(
        !initialize
            .windows(b"jsonrpc".len())
            .any(|part| part == b"jsonrpc")
    );
    assert!(!handshake.is_initialized());

    let initialized = handshake
        .accept_initialize_response(VALID_RESPONSE)
        .expect("reviewed response must complete the handshake");
    assert_eq!(initialized, b"{\"method\":\"initialized\",\"params\":{}}\n");
    assert!(handshake.is_initialized());
}

#[test]
fn accepts_field_order_and_safe_unicode_without_retaining_server_values() {
    let frame = b"{\"result\":{\"userAgent\":\"codex/0.144.4\",\"platformOs\":\"linux\",\"platformFamily\":\"unix\",\"codexHome\":\"/synthetic/codex-home-\xE2\x98\x83\"},\"id\":0}\n";
    let mut handshake = started_handshake();

    assert_eq!(
        handshake.accept_initialize_response(frame),
        Ok(b"{\"method\":\"initialized\",\"params\":{}}\n".as_slice()),
    );
    assert!(handshake.is_initialized());
}

#[test]
fn enforces_one_initialization_exchange_per_connection() {
    let mut handshake = ConnectorHandshake::new();
    assert_eq!(
        handshake.accept_initialize_response(VALID_RESPONSE),
        Err(ProtocolError::InvalidState),
    );

    handshake
        .start()
        .expect("state misuse before start is recoverable");
    assert_eq!(handshake.start(), Err(ProtocolError::InvalidState));
    handshake
        .accept_initialize_response(VALID_RESPONSE)
        .expect("valid response remains acceptable after duplicate local start");

    assert_eq!(handshake.start(), Err(ProtocolError::InvalidState));
    assert_eq!(
        handshake.accept_initialize_response(VALID_RESPONSE),
        Err(ProtocolError::InvalidState),
    );
}

#[test]
fn rejects_non_jsonl_and_over_budget_frames_before_parsing() {
    let cases: &[(&[u8], ProtocolError)] = &[
        (b"", ProtocolError::InvalidFrame),
        (b"{}", ProtocolError::InvalidFrame),
        (b"{}\r\n", ProtocolError::InvalidFrame),
        (b"{}\n\n", ProtocolError::InvalidFrame),
        (b" {}\n", ProtocolError::InvalidFrame),
        (b"{} \n", ProtocolError::InvalidFrame),
        (b"{\n}\n", ProtocolError::InvalidFrame),
        (b"{\0}\n", ProtocolError::InvalidFrame),
        (b"\xFF\n", ProtocolError::InvalidFrame),
        (b"{\"\xFF\":0}\n", ProtocolError::InvalidMessage),
    ];

    for (frame, expected) in cases {
        assert_rejected(frame, *expected);
    }

    let mut oversized = vec![b'x'; MAX_FRAME_BYTES];
    oversized.push(b'\n');
    assert_rejected(&oversized, ProtocolError::FrameTooLarge);
}

#[test]
fn rejects_open_or_mismatched_response_envelopes() {
    let cases = [
        "{}",
        r#"{"id":0}"#,
        r#"{"result":{"codexHome":"/x","platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#,
        r#"{"id":1,"result":{"codexHome":"/x","platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#,
        r#"{"id":"0","result":{"codexHome":"/x","platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#,
        r#"{"id":0.0,"result":{"codexHome":"/x","platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#,
        r#"{"id":0,"error":{"code":-1,"message":"do not reflect me"}}"#,
        r#"{"id":0,"method":"initialized"}"#,
        r#"{"jsonrpc":"2.0","id":0,"result":{"codexHome":"/x","platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#,
        r#"{"id":0,"result":{"codexHome":"/x","platformFamily":"unix","platformOs":"linux","userAgent":"codex"},"extra":true}"#,
        r#"{"id":0,"id":0,"result":{"codexHome":"/x","platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#,
        r#"{"id":0,"\u0069d":0,"result":{"codexHome":"/x","platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#,
        r#"{"id":0,"result":{"codexHome":"/x","platformFamily":"unix","platformOs":"linux","userAgent":"codex"},"result":{"codexHome":"/x","platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#,
        r#"{"id":0,"result":null}"#,
        r#"{"id":0,"result":[]}"#,
    ];

    for json in cases {
        assert_rejected(&framed(json), ProtocolError::InvalidMessage);
    }
}

#[test]
fn rejects_incomplete_duplicate_unknown_and_unbounded_result_fields() {
    let cases = [
        r#"{"id":0,"result":{}}"#.to_owned(),
        r#"{"id":0,"result":{"codexHome":"/x","platformFamily":"unix","platformOs":"linux"}}"#.to_owned(),
        r#"{"id":0,"result":{"codexHome":"/x","platformFamily":"unix","platformOs":"linux","userAgent":"codex","capability":true}}"#.to_owned(),
        r#"{"id":0,"result":{"codexHome":"/x","codexHome":"/y","platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#.to_owned(),
        r#"{"id":0,"result":{"codexHome":"/x","\u0063odexHome":"/y","platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#.to_owned(),
        r#"{"id":0,"result":{"codexHome":"","platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#.to_owned(),
        r#"{"id":0,"result":{"codexHome":"relative/path","platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#.to_owned(),
        r#"{"id":0,"result":{"codexHome":1,"platformFamily":"unix","platformOs":"linux","userAgent":"codex"}}"#.to_owned(),
        r#"{"id":0,"result":{"codexHome":"/x","platformFamily":"unix\nspoofed","platformOs":"linux","userAgent":"codex"}}"#.to_owned(),
        format!(
            "{{\"id\":0,\"result\":{{\"codexHome\":\"/x\",\"platformFamily\":\"{}\",\"platformOs\":\"linux\",\"userAgent\":\"codex\"}}}}",
            "p".repeat(33),
        ),
        format!(
            "{{\"id\":0,\"result\":{{\"codexHome\":\"{}\",\"platformFamily\":\"unix\",\"platformOs\":\"linux\",\"userAgent\":\"codex\"}}}}",
            "x".repeat(4097),
        ),
        format!(
            "{{\"id\":0,\"result\":{{\"codexHome\":\"/x\",\"platformFamily\":\"unix\",\"platformOs\":\"linux\",\"userAgent\":\"{}\"}}}}",
            "u".repeat(513),
        ),
    ];

    for json in cases {
        assert_rejected(&framed(&json), ProtocolError::InvalidMessage);
    }
}

#[test]
fn errors_are_stable_and_do_not_reflect_untrusted_content() {
    let marker = "private-marker-that-must-not-escape";
    let frame = framed(&format!(
        "{{\"id\":0,\"error\":{{\"message\":\"{marker}\"}}}}"
    ));
    let mut handshake = started_handshake();
    let error = handshake
        .accept_initialize_response(&frame)
        .expect_err("server error envelope must fail closed");

    assert_eq!(error, ProtocolError::InvalidMessage);
    assert_eq!(error.to_string(), "app-server message is invalid");
    assert!(!error.to_string().contains(marker));
}
