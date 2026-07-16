//! Synthetic executable used only by the connector process-supervisor tests.

use std::env;
use std::io::{self, BufRead, Write};
use std::thread;
use std::time::Duration;

const INITIALIZE_REQUEST: &str = concat!(
    "{\"id\":0,\"method\":\"initialize\",\"params\":{\"clientInfo\":{",
    "\"name\":\"viberacing_connector\",\"title\":\"Vibe Racing Connector\",",
    "\"version\":\"",
    env!("CARGO_PKG_VERSION"),
    "\"}}}"
);
const INITIALIZED_NOTIFICATION: &str = "{\"method\":\"initialized\",\"params\":{}}";
const ACCOUNT_REQUEST: &str =
    "{\"id\":1,\"method\":\"account/read\",\"params\":{\"refreshToken\":false}}";
const USAGE_REQUEST: &str = "{\"id\":2,\"method\":\"account/usage/read\",\"params\":null}";
const INITIALIZE_RESPONSE: &[u8] = b"{\"id\":0,\"result\":{\"codexHome\":\"/synthetic/codex-home\",\"platformFamily\":\"unix\",\"platformOs\":\"linux\",\"userAgent\":\"codex-cli/0.144.4\"}}\n";
const ACCOUNT_RESPONSE: &[u8] = b"{\"id\":1,\"result\":{\"account\":{\"email\":\"racer@example.invalid\",\"planType\":\"plus\",\"type\":\"chatgpt\"},\"requiresOpenaiAuth\":false}}\n";
const USAGE_RESPONSE: &[u8] = b"{\"id\":2,\"result\":{\"dailyUsageBuckets\":[{\"startDate\":\"2026-07-14\",\"tokens\":456},{\"startDate\":\"2026-07-13\",\"tokens\":123}],\"summary\":{\"currentStreakDays\":2,\"lifetimeTokens\":579,\"longestRunningTurnSec\":30,\"longestStreakDays\":2,\"peakDailyTokens\":456}}}\n";

fn scenario_name() -> String {
    env::current_dir()
        .ok()
        .and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_default()
}

fn invocation_is_isolated() -> bool {
    let mut arguments = env::args_os();
    let _program = arguments.next();
    arguments.next().as_deref() == Some(std::ffi::OsStr::new("app-server"))
        && arguments.next().is_none()
        && env::var_os("PATH").is_none()
        && env::var_os("CODEX_HOME").is_none()
        && env::var_os("OPENAI_API_KEY").is_none()
        && env::var_os("GITHUB_TOKEN").is_none()
}

fn main() {
    if !invocation_is_isolated() {
        std::process::exit(64);
    }

    let scenario = scenario_name();
    if scenario.contains("early-exit") {
        return;
    }

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    let Some(Ok(initialize)) = lines.next() else {
        return;
    };
    if initialize != INITIALIZE_REQUEST {
        std::process::exit(65);
    }

    if scenario.contains("timeout") {
        thread::sleep(Duration::from_secs(5));
        return;
    }
    if scenario.contains("stdout-overload") {
        let mut stdout = io::stdout().lock();
        let mut output = vec![b'x'; 16 * 1024 + 1];
        output[..21].copy_from_slice(b"private-output-marker");
        let _ = stdout.write_all(&output);
        let _ = stdout.flush();
        thread::sleep(Duration::from_secs(5));
        return;
    }
    if scenario.contains("stderr-overload") {
        let mut stderr = io::stderr().lock();
        let mut output = vec![b'x'; 8 * 1024 + 1];
        output[..21].copy_from_slice(b"private-output-marker");
        let _ = stderr.write_all(&output);
        let _ = stderr.flush();
        thread::sleep(Duration::from_secs(5));
        return;
    }
    if scenario.contains("malformed") {
        let mut stdout = io::stdout().lock();
        let _ = stdout.write_all(b"{\"private-output-marker\":true}\n");
        let _ = stdout.flush();
        thread::sleep(Duration::from_secs(5));
        return;
    }

    let mut stdout = io::stdout().lock();
    let mut stderr = io::stderr().lock();
    if stdout.write_all(INITIALIZE_RESPONSE).is_err() || stdout.flush().is_err() {
        return;
    }
    let _ = stderr.write_all(b"private-stderr-marker");
    let _ = stderr.flush();

    let Some(Ok(initialized)) = lines.next() else {
        return;
    };
    let Some(Ok(account)) = lines.next() else {
        return;
    };
    if initialized != INITIALIZED_NOTIFICATION || account != ACCOUNT_REQUEST {
        std::process::exit(66);
    }
    if stdout.write_all(ACCOUNT_RESPONSE).is_err() || stdout.flush().is_err() {
        return;
    }

    let Some(Ok(usage)) = lines.next() else {
        return;
    };
    if usage != USAGE_REQUEST {
        std::process::exit(67);
    }
    if stdout.write_all(USAGE_RESPONSE).is_err() || stdout.flush().is_err() {
        return;
    }

    if scenario.contains("late-stdout-overload") {
        let _ = stdout.write_all(b"{\"private-output-marker\":true}\n");
        let _ = stdout.flush();
        thread::sleep(Duration::from_secs(5));
        return;
    }
    if scenario.contains("late-stderr-overload") {
        let mut output = vec![b'x'; 8 * 1024 + 1];
        output[..21].copy_from_slice(b"private-output-marker");
        let _ = stderr.write_all(&output);
        let _ = stderr.flush();
        thread::sleep(Duration::from_secs(5));
        return;
    }
    if scenario.contains("late-failure") {
        std::process::exit(69);
    }

    if scenario.contains("linger") {
        thread::sleep(Duration::from_secs(5));
        return;
    }
    for line in lines {
        if line.is_err() {
            return;
        }
    }
}
