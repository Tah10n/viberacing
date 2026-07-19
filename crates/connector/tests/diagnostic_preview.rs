#![forbid(unsafe_code)]

use std::fmt::Write as _;
use std::path::PathBuf;
use std::process::Command;

fn missing_candidate_path() -> PathBuf {
    for _ in 0..8 {
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random).expect("test path randomness must be available");
        let mut suffix = String::with_capacity(32);
        for byte in random {
            write!(&mut suffix, "{byte:02x}").expect("writing to a String cannot fail");
        }
        #[cfg(windows)]
        let candidate = PathBuf::from(format!(
            "C:\\viberacing-diagnostic-missing-{suffix}{}",
            std::env::consts::EXE_SUFFIX
        ));
        #[cfg(not(windows))]
        let candidate = PathBuf::from(format!(
            "/viberacing-diagnostic-missing-{suffix}{}",
            std::env::consts::EXE_SUFFIX
        ));
        if !candidate.exists() {
            return candidate;
        }
    }
    panic!("a unique missing candidate path could not be selected");
}

#[test]
fn explicit_diagnostic_preview_is_redacted_and_preserves_failed_admission() {
    let missing_candidate = missing_candidate_path();
    let result = Command::new(env!("CARGO_BIN_EXE_viberacing-connector"))
        .args(["check-codex", "--codex"])
        .arg(&missing_candidate)
        .arg("--diagnostic-preview")
        .env_clear()
        .output()
        .expect("the target-built connector must execute");

    #[cfg(all(windows, target_arch = "x86_64"))]
    let (admission, error) = ("not-admitted", "no exact Codex executable was admitted\n");
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    let (admission, error) = (
        "unsupported-platform",
        "this connector platform is unsupported\n",
    );

    let expected = format!(
        "Vibe Racing connector diagnostic preview v1\n\
connector-version: {}\n\
candidate-platform-contract: windows-x86_64\n\
candidate-codex-version: 0.144.5\n\
candidate-admission: {admission}\n\
supported-codex-versions: none\n\
included-data: fixed-version-and-admission-state-only\n\
excluded-data: paths,digests,environment,credentials,account,usage\n\
side-effects: no-codex-process,no-credential-access,no-persistence,no-network\n\
review-before-sharing: required\n",
        env!("CARGO_PKG_VERSION"),
    );

    assert!(!result.status.success());
    assert_eq!(
        String::from_utf8(result.stdout).expect("preview output must be UTF-8"),
        expected
    );
    assert_eq!(
        String::from_utf8(result.stderr).expect("error output must be UTF-8"),
        error
    );
    assert!(!missing_candidate.exists());
}
