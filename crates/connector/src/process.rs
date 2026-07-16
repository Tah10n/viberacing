//! Bounded one-shot process supervision for a future reviewed Codex executable.

use std::ffi::{OsStr, OsString};
use std::fmt;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::{ConnectorHandshake, DailyUsage, MAX_FRAME_BYTES, ProtocolError};

const APP_SERVER_ARGUMENT: &str = "app-server";
const READER_CHUNK_BYTES: usize = 1024;
const REAP_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Maximum time allowed for one App Server response frame.
pub const APP_SERVER_RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);

/// Maximum total lifetime allowed for the one-shot App Server child.
pub const APP_SERVER_LIFETIME: Duration = Duration::from_secs(45);

/// Grace period after stdin closes before the supervisor forcibly terminates the child.
pub const APP_SERVER_EXIT_GRACE: Duration = Duration::from_millis(500);

/// Maximum App Server stderr bytes drained and discarded before the child is terminated.
pub const MAX_APP_SERVER_STDERR_BYTES: usize = 8 * 1024;

/// Maximum stdout frames admitted during the fixed initialize/account/usage exchange.
pub const MAX_APP_SERVER_STDOUT_FRAMES: usize = 3;

/// Capability for a canonical executable, isolated working directory, and explicit environment
/// values accepted by a future discovery and admission boundary.
///
/// This type deliberately has no public constructor. The process supervisor is therefore present
/// for review and synthetic testing but cannot launch a caller-selected path. A later path-review
/// slice must resolve links, reject untrusted writable components, verify the selected artifact and
/// version, and only then construct this capability inside the crate.
pub struct ReviewedCodexLaunch {
    executable: PathBuf,
    working_directory: PathBuf,
    environment: Vec<(OsString, OsString)>,
}

/// Stable, non-reflective failures from candidate one-shot collection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CollectionError {
    /// The reviewed child could not be launched or supervised.
    LaunchFailed,
    /// A fixed protocol frame could not be written to child stdin.
    WriteFailed,
    /// The response or whole-child deadline expired.
    TimedOut,
    /// Child stdout exceeded its frame-size or frame-count budget.
    StdoutLimitExceeded,
    /// Child stderr exceeded its discard-only byte budget.
    StderrLimitExceeded,
    /// The child or an output pipe ended before the fixed exchange completed.
    ChildExited,
    /// The child could not be terminated, reaped, or joined cleanly.
    CleanupFailed,
    /// A bounded protocol state machine rejected the child response.
    Protocol(ProtocolError),
}

impl fmt::Display for CollectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LaunchFailed => formatter.write_str("app-server process launch failed"),
            Self::WriteFailed => formatter.write_str("app-server input failed"),
            Self::TimedOut => formatter.write_str("app-server process timed out"),
            Self::StdoutLimitExceeded => {
                formatter.write_str("app-server stdout exceeded its limit")
            }
            Self::StderrLimitExceeded => {
                formatter.write_str("app-server stderr exceeded its limit")
            }
            Self::ChildExited => formatter.write_str("app-server process exited unexpectedly"),
            Self::CleanupFailed => formatter.write_str("app-server process cleanup failed"),
            Self::Protocol(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for CollectionError {}

impl From<ProtocolError> for CollectionError {
    fn from(error: ProtocolError) -> Self {
        Self::Protocol(error)
    }
}

/// One-shot collector for the candidate Codex `0.144.4` initialize/account/usage sequence.
///
/// The collector always uses the fixed `app-server` argument, local pipes, a fixed reviewed working
/// directory, a cleared and allowlisted environment, and the public process budgets in this module.
/// It returns only normalized daily usage after the child has been reaped. The launch capability is
/// intentionally unavailable until executable admission is implemented.
pub struct CandidateCodex01444Collector;

impl CandidateCodex01444Collector {
    /// Launches the reviewed candidate and performs exactly one bounded collection.
    ///
    /// # Errors
    ///
    /// Returns a stable [`CollectionError`] for launch, I/O, deadline, output-budget, cleanup, or
    /// fail-closed protocol failures. Child output, environment values, paths, and operating-system
    /// error details are never included in the returned error.
    pub fn collect(launch: ReviewedCodexLaunch) -> Result<DailyUsage, CollectionError> {
        Self::collect_with_limits(launch, ProcessLimits::PRODUCTION)
    }

    fn collect_with_limits(
        launch: ReviewedCodexLaunch,
        limits: ProcessLimits,
    ) -> Result<DailyUsage, CollectionError> {
        let specification = LaunchSpecification::from_reviewed(launch);
        let child = SupervisedChild::launch(specification.into_command(), limits)?;
        collect_from_child(child)
    }
}

fn collect_from_child(mut child: SupervisedChild) -> Result<DailyUsage, CollectionError> {
    match run_candidate_protocol(&mut child) {
        Ok(usage) => {
            child.finish()?;
            Ok(usage)
        }
        Err(error) => child.fail(error),
    }
}

fn run_candidate_protocol(child: &mut SupervisedChild) -> Result<DailyUsage, CollectionError> {
    let mut handshake = ConnectorHandshake::new();
    child.write_frame(handshake.start()?)?;

    let initialize_response = child.read_frame()?;
    let initialized = handshake.accept_initialize_response(&initialize_response)?;
    child.write_frame(initialized)?;

    let mut account_usage = handshake.into_codex_0_144_4_account_usage()?;
    child.write_frame(account_usage.start_account_read()?)?;

    let account_response = child.read_frame()?;
    account_usage.accept_account_read_response(&account_response)?;
    child.write_frame(account_usage.start_usage_read()?)?;

    let usage_response = child.read_frame()?;
    let usage = account_usage.accept_usage_read_response(&usage_response)?;
    Ok(usage)
}

#[derive(Clone, Copy)]
struct ProcessLimits {
    response_timeout: Duration,
    lifetime: Duration,
    exit_grace: Duration,
}

impl ProcessLimits {
    const PRODUCTION: Self = Self {
        response_timeout: APP_SERVER_RESPONSE_TIMEOUT,
        lifetime: APP_SERVER_LIFETIME,
        exit_grace: APP_SERVER_EXIT_GRACE,
    };
}

struct LaunchSpecification {
    executable: PathBuf,
    working_directory: PathBuf,
    environment: Vec<(OsString, OsString)>,
}

impl LaunchSpecification {
    fn from_reviewed(launch: ReviewedCodexLaunch) -> Self {
        Self {
            executable: launch.executable,
            working_directory: launch.working_directory,
            environment: sanitize_environment(launch.environment),
        }
    }

    fn into_command(self) -> Command {
        let mut command = Command::new(self.executable);
        command
            .arg(APP_SERVER_ARGUMENT)
            .current_dir(self.working_directory)
            .env_clear()
            .envs(self.environment)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;

            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        command
    }
}

#[cfg(windows)]
const ALLOWED_ENVIRONMENT_KEYS: &[&str] = &[
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERPROFILE",
];

#[cfg(target_os = "macos")]
const ALLOWED_ENVIRONMENT_KEYS: &[&str] = &["HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR"];

#[cfg(all(unix, not(target_os = "macos")))]
const ALLOWED_ENVIRONMENT_KEYS: &[&str] = &[
    "HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
];

#[cfg(not(any(windows, unix)))]
const ALLOWED_ENVIRONMENT_KEYS: &[&str] = &[];

fn sanitize_environment<I>(explicit_environment: I) -> Vec<(OsString, OsString)>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    let explicit_environment: Vec<_> = explicit_environment.into_iter().collect();
    ALLOWED_ENVIRONMENT_KEYS
        .iter()
        .filter_map(|allowed| {
            explicit_environment
                .iter()
                .find(|(key, _)| environment_key_matches(key, allowed))
                .map(|(_, value)| (OsString::from(allowed), value.clone()))
        })
        .collect()
}

fn environment_key_matches(candidate: &OsStr, allowed: &str) -> bool {
    let Some(candidate) = candidate.to_str() else {
        return false;
    };

    #[cfg(windows)]
    {
        candidate.eq_ignore_ascii_case(allowed)
    }

    #[cfg(not(windows))]
    {
        candidate == allowed
    }
}

enum ProcessEvent {
    Frame(Vec<u8>),
    StdoutLimitExceeded,
    StderrLimitExceeded,
    UnterminatedStdout,
    OutputFailed,
    StdoutClosed,
}

struct SupervisedChild {
    child: Child,
    stdin: Option<ChildStdin>,
    events: Option<Receiver<ProcessEvent>>,
    stdout_thread: Option<JoinHandle<()>>,
    stderr_thread: Option<JoinHandle<()>>,
    limits: ProcessLimits,
    launched_at: Instant,
    reaped: bool,
}

impl SupervisedChild {
    fn launch(mut command: Command, limits: ProcessLimits) -> Result<Self, CollectionError> {
        let launched_at = Instant::now();
        let mut child = command.spawn().map_err(|_| CollectionError::LaunchFailed)?;
        let Some(stdin) = child.stdin.take() else {
            abort_unmanaged_child(&mut child);
            return Err(CollectionError::LaunchFailed);
        };
        let Some(stdout) = child.stdout.take() else {
            drop(stdin);
            abort_unmanaged_child(&mut child);
            return Err(CollectionError::LaunchFailed);
        };
        let Some(stderr) = child.stderr.take() else {
            drop(stdin);
            drop(stdout);
            abort_unmanaged_child(&mut child);
            return Err(CollectionError::LaunchFailed);
        };

        let (sender, receiver) = mpsc::channel();
        let stdout_sender = sender.clone();
        let stdout_thread = thread::Builder::new()
            .name(String::from("viberacing-app-server-stdout"))
            .spawn(move || read_stdout(stdout, &stdout_sender));
        let Ok(stdout_thread) = stdout_thread else {
            drop(stdin);
            drop(stderr);
            drop(receiver);
            abort_unmanaged_child(&mut child);
            return Err(CollectionError::LaunchFailed);
        };

        let stderr_thread = thread::Builder::new()
            .name(String::from("viberacing-app-server-stderr"))
            .spawn(move || read_stderr(stderr, &sender));
        let Ok(stderr_thread) = stderr_thread else {
            drop(stdin);
            drop(receiver);
            abort_unmanaged_child(&mut child);
            let _ = stdout_thread.join();
            return Err(CollectionError::LaunchFailed);
        };

        Ok(Self {
            child,
            stdin: Some(stdin),
            events: Some(receiver),
            stdout_thread: Some(stdout_thread),
            stderr_thread: Some(stderr_thread),
            limits,
            launched_at,
            reaped: false,
        })
    }

    fn write_frame(&mut self, frame: &'static [u8]) -> Result<(), CollectionError> {
        let result = self.stdin.as_mut().map_or_else(
            || Err(()),
            |stdin| {
                stdin
                    .write_all(frame)
                    .and_then(|()| stdin.flush())
                    .map_err(|_| ())
            },
        );

        if result.is_err() {
            return self.fail(CollectionError::WriteFailed);
        }
        Ok(())
    }

    fn read_frame(&mut self) -> Result<Vec<u8>, CollectionError> {
        let now = Instant::now();
        let response_deadline = now.checked_add(self.limits.response_timeout).unwrap_or(now);
        let lifetime_deadline = self
            .launched_at
            .checked_add(self.limits.lifetime)
            .unwrap_or(self.launched_at);
        let deadline = response_deadline.min(lifetime_deadline);
        let wait = deadline.saturating_duration_since(now);
        if wait.is_zero() {
            return self.fail(CollectionError::TimedOut);
        }

        let event = self
            .events
            .as_ref()
            .ok_or(CollectionError::ChildExited)
            .and_then(|receiver| {
                receiver.recv_timeout(wait).map_err(|error| match error {
                    RecvTimeoutError::Timeout => CollectionError::TimedOut,
                    RecvTimeoutError::Disconnected => CollectionError::ChildExited,
                })
            });

        match event {
            Ok(ProcessEvent::Frame(frame)) => Ok(frame),
            Ok(ProcessEvent::StdoutLimitExceeded) => {
                self.fail(CollectionError::StdoutLimitExceeded)
            }
            Ok(ProcessEvent::StderrLimitExceeded) => {
                self.fail(CollectionError::StderrLimitExceeded)
            }
            Ok(ProcessEvent::UnterminatedStdout) => {
                self.fail(CollectionError::Protocol(ProtocolError::InvalidFrame))
            }
            Ok(ProcessEvent::OutputFailed | ProcessEvent::StdoutClosed) => {
                self.fail(CollectionError::ChildExited)
            }
            Err(error) => self.fail(error),
        }
    }

    fn finish(mut self) -> Result<(), CollectionError> {
        self.stdin.take();
        let started = Instant::now();
        let graceful_deadline = started
            .checked_add(self.limits.exit_grace)
            .unwrap_or(started);
        let lifetime_deadline = self
            .launched_at
            .checked_add(self.limits.lifetime)
            .unwrap_or(self.launched_at);
        let deadline = graceful_deadline.min(lifetime_deadline);

        loop {
            if let Some(error) = self.pending_finish_error() {
                return self.fail(error);
            }
            match self.child.try_wait() {
                Ok(Some(status)) => {
                    self.reaped = true;
                    self.join_readers()?;
                    if let Some(error) = self.pending_finish_error() {
                        return Err(error);
                    }
                    return if status.success() {
                        Ok(())
                    } else {
                        Err(CollectionError::ChildExited)
                    };
                }
                Ok(None) if Instant::now() < deadline => {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    thread::sleep(REAP_POLL_INTERVAL.min(remaining));
                }
                Ok(None) => {
                    self.terminate_and_reap()?;
                    if let Some(error) = self.pending_finish_error() {
                        return Err(error);
                    }
                    return Ok(());
                }
                Err(_) => return Err(CollectionError::CleanupFailed),
            }
        }
    }

    fn pending_finish_error(&self) -> Option<CollectionError> {
        let receiver = self.events.as_ref()?;
        loop {
            match receiver.try_recv() {
                Ok(ProcessEvent::StdoutClosed) => {}
                Ok(ProcessEvent::Frame(_) | ProcessEvent::StdoutLimitExceeded) => {
                    return Some(CollectionError::StdoutLimitExceeded);
                }
                Ok(ProcessEvent::StderrLimitExceeded) => {
                    return Some(CollectionError::StderrLimitExceeded);
                }
                Ok(ProcessEvent::UnterminatedStdout) => {
                    return Some(CollectionError::Protocol(ProtocolError::InvalidFrame));
                }
                Ok(ProcessEvent::OutputFailed) => return Some(CollectionError::ChildExited),
                Err(TryRecvError::Empty | TryRecvError::Disconnected) => return None,
            }
        }
    }

    fn fail<T>(&mut self, error: CollectionError) -> Result<T, CollectionError> {
        match self.terminate_and_reap() {
            Ok(()) => Err(error),
            Err(cleanup_error) => Err(cleanup_error),
        }
    }

    fn terminate_and_reap(&mut self) -> Result<(), CollectionError> {
        self.stdin.take();
        let mut cleanup_failed = false;

        if !self.reaped {
            let initial_poll = self.child.try_wait();
            if initial_poll.is_ok_and(|status| status.is_some()) {
                self.reaped = true;
            } else if self.child.kill().is_ok() {
                match self.child.wait() {
                    Ok(_) => self.reaped = true,
                    Err(_) => cleanup_failed = true,
                }
            } else {
                self.reaped = self.child.try_wait().is_ok_and(|status| status.is_some());
                cleanup_failed = !self.reaped;
            }
        }

        if self.join_readers().is_err() {
            cleanup_failed = true;
        }

        if cleanup_failed || !self.reaped {
            Err(CollectionError::CleanupFailed)
        } else {
            Ok(())
        }
    }

    fn join_readers(&mut self) -> Result<(), CollectionError> {
        let stdout_joined = self
            .stdout_thread
            .take()
            .is_none_or(|thread| thread.join().is_ok());
        let stderr_joined = self
            .stderr_thread
            .take()
            .is_none_or(|thread| thread.join().is_ok());

        if stdout_joined && stderr_joined {
            Ok(())
        } else {
            Err(CollectionError::CleanupFailed)
        }
    }
}

impl Drop for SupervisedChild {
    fn drop(&mut self) {
        let _ = self.terminate_and_reap();
    }
}

fn abort_unmanaged_child(child: &mut Child) {
    if child.kill().is_ok() {
        let _ = child.wait();
    } else {
        let _ = child.try_wait();
    }
}

fn read_stdout(mut stdout: impl Read, sender: &Sender<ProcessEvent>) {
    let mut chunk = [0_u8; READER_CHUNK_BYTES];
    let mut frame = Vec::with_capacity(MAX_FRAME_BYTES.min(READER_CHUNK_BYTES));
    let mut frame_count = 0_usize;

    loop {
        let count = match stdout.read(&mut chunk) {
            Ok(0) => {
                let event = if frame.is_empty() {
                    ProcessEvent::StdoutClosed
                } else {
                    ProcessEvent::UnterminatedStdout
                };
                let _ = sender.send(event);
                return;
            }
            Ok(count) => count,
            Err(_) => {
                let _ = sender.send(ProcessEvent::OutputFailed);
                return;
            }
        };

        for byte in &chunk[..count] {
            frame.push(*byte);
            if frame.len() > MAX_FRAME_BYTES {
                let _ = sender.send(ProcessEvent::StdoutLimitExceeded);
                return;
            }
            if *byte == b'\n' {
                frame_count += 1;
                if frame_count > MAX_APP_SERVER_STDOUT_FRAMES {
                    let _ = sender.send(ProcessEvent::StdoutLimitExceeded);
                    return;
                }
                if sender
                    .send(ProcessEvent::Frame(std::mem::take(&mut frame)))
                    .is_err()
                {
                    return;
                }
            }
        }
    }
}

fn read_stderr(mut stderr: impl Read, sender: &Sender<ProcessEvent>) {
    let mut chunk = [0_u8; READER_CHUNK_BYTES];
    let mut observed = 0_usize;

    loop {
        let remaining = MAX_APP_SERVER_STDERR_BYTES.saturating_sub(observed);
        let read_limit = remaining.saturating_add(1).min(READER_CHUNK_BYTES);
        match stderr.read(&mut chunk[..read_limit]) {
            Ok(0) => return,
            Ok(count) => {
                observed = observed.saturating_add(count);
                if observed > MAX_APP_SERVER_STDERR_BYTES {
                    let _ = sender.send(ProcessEvent::StderrLimitExceeded);
                    return;
                }
            }
            Err(_) => {
                let _ = sender.send(ProcessEvent::OutputFailed);
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    const TEST_LIMITS: ProcessLimits = ProcessLimits {
        response_timeout: Duration::from_millis(300),
        lifetime: Duration::from_secs(2),
        exit_grace: Duration::from_millis(100),
    };

    static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(scenario: &str) -> Self {
            let counter = NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "viberacing-process-{scenario}-{}-{counter}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("synthetic process directory must be created");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    impl ReviewedCodexLaunch {
        fn for_test(executable: PathBuf, working_directory: PathBuf) -> Self {
            Self {
                executable,
                working_directory,
                environment: Vec::new(),
            }
        }

        fn for_environment_test(
            executable: PathBuf,
            working_directory: PathBuf,
            environment: Vec<(OsString, OsString)>,
        ) -> Self {
            Self {
                executable,
                working_directory,
                environment,
            }
        }
    }

    #[cfg(feature = "process-test-fixture")]
    fn fixture_executable() -> PathBuf {
        let current = std::env::current_exe().expect("current test executable must resolve");
        let dependencies = current
            .parent()
            .expect("test executable must have a parent directory");
        let target_profile = if dependencies.file_name() == Some(OsStr::new("deps")) {
            dependencies
                .parent()
                .expect("dependency directory must have a profile parent")
        } else {
            dependencies
        };
        let executable = target_profile.join(format!(
            "viberacing-connector-process-fixture{}",
            std::env::consts::EXE_SUFFIX
        ));
        assert!(
            executable.is_file(),
            "run connector tests with --all-targets --all-features"
        );
        executable
    }

    #[cfg(feature = "process-test-fixture")]
    fn launch_for(scenario: &str) -> (ReviewedCodexLaunch, TestDirectory) {
        let directory = TestDirectory::new(scenario);
        let launch = ReviewedCodexLaunch::for_test(fixture_executable(), directory.0.clone());
        (launch, directory)
    }

    #[test]
    fn command_is_fixed_and_environment_is_allowlisted() {
        let directory = TestDirectory::new("command");
        let environment = vec![
            (OsString::from("HOME"), OsString::from("home-value")),
            (
                OsString::from("USERPROFILE"),
                OsString::from("profile-value"),
            ),
            (
                OsString::from("CODEX_HOME"),
                OsString::from("forbidden-override"),
            ),
            (
                OsString::from("OPENAI_API_KEY"),
                OsString::from("forbidden-secret"),
            ),
            (
                OsString::from("GITHUB_TOKEN"),
                OsString::from("forbidden-secret"),
            ),
            (OsString::from("PATH"), OsString::from("forbidden-path")),
        ];
        let launch = ReviewedCodexLaunch::for_environment_test(
            PathBuf::from("synthetic-codex"),
            directory.0.clone(),
            environment,
        );

        let specification = LaunchSpecification::from_reviewed(launch);
        assert_eq!(specification.executable, PathBuf::from("synthetic-codex"));
        assert_eq!(specification.working_directory, directory.0);
        assert!(specification.environment.len() <= 1);
        assert!(specification.environment.iter().all(|(key, value)| {
            ALLOWED_ENVIRONMENT_KEYS
                .iter()
                .any(|allowed| environment_key_matches(key, allowed))
                && value != "forbidden-override"
                && value != "forbidden-secret"
                && value != "forbidden-path"
        }));

        let command = specification.into_command();
        assert_eq!(command.get_program(), OsStr::new("synthetic-codex"));
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![OsStr::new(APP_SERVER_ARGUMENT)]
        );
        assert_eq!(command.get_current_dir(), Some(directory.0.as_path()));
        assert!(command.get_envs().all(|(key, value)| {
            ALLOWED_ENVIRONMENT_KEYS
                .iter()
                .any(|allowed| environment_key_matches(key, allowed))
                && value.is_some()
        }));
    }

    #[test]
    #[cfg(feature = "process-test-fixture")]
    fn completes_fixed_one_shot_exchange_and_discards_stderr() {
        let (launch, _directory) = launch_for("happy");
        let usage = CandidateCodex01444Collector::collect_with_limits(launch, TEST_LIMITS)
            .expect("synthetic candidate exchange must succeed");

        assert_eq!(usage.len(), 2);
        assert_eq!(usage.entries()[0].codex_reported_date(), "2026-07-13");
        assert_eq!(usage.entries()[0].tokens(), 123);
        assert_eq!(usage.entries()[1].codex_reported_date(), "2026-07-14");
        assert_eq!(usage.entries()[1].tokens(), 456);
        assert_eq!(format!("{usage:?}"), "DailyUsage { entry_count: 2, .. }");
        assert!(!format!("{usage:?}").contains("private-stderr-marker"));
    }

    #[test]
    #[cfg(feature = "process-test-fixture")]
    fn times_out_and_reaps_a_silent_child() {
        let (launch, _directory) = launch_for("timeout");
        let started = Instant::now();
        let error = CandidateCodex01444Collector::collect_with_limits(launch, TEST_LIMITS)
            .expect_err("silent helper must time out");

        assert_eq!(error, CollectionError::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    #[cfg(feature = "process-test-fixture")]
    fn rejects_stdout_and_stderr_overload_without_retaining_bytes() {
        for (scenario, expected) in [
            ("stdout-overload", CollectionError::StdoutLimitExceeded),
            ("stderr-overload", CollectionError::StderrLimitExceeded),
        ] {
            let (launch, _directory) = launch_for(scenario);
            let error = CandidateCodex01444Collector::collect_with_limits(launch, TEST_LIMITS)
                .expect_err("output overload must fail closed");
            assert_eq!(error, expected);
            assert!(!error.to_string().contains("private-output-marker"));
        }
    }

    #[test]
    #[cfg(feature = "process-test-fixture")]
    fn rejects_output_overload_that_arrives_after_the_usage_response() {
        for (scenario, expected) in [
            ("late-stdout-overload", CollectionError::StdoutLimitExceeded),
            ("late-stderr-overload", CollectionError::StderrLimitExceeded),
        ] {
            let (launch, _directory) = launch_for(scenario);
            let error = CandidateCodex01444Collector::collect_with_limits(launch, TEST_LIMITS)
                .expect_err("late output overload must fail before returning data");
            assert_eq!(error, expected);
            assert!(!error.to_string().contains("private-output-marker"));
        }
    }

    #[test]
    #[cfg(feature = "process-test-fixture")]
    fn rejects_early_exit_and_nonreflective_protocol_failure() {
        let (launch, _directory) = launch_for("early-exit");
        let early_exit = CandidateCodex01444Collector::collect_with_limits(launch, TEST_LIMITS)
            .expect_err("early exit must fail closed");
        assert!(matches!(
            early_exit,
            CollectionError::WriteFailed | CollectionError::ChildExited
        ));

        let (launch, _directory) = launch_for("malformed");
        let malformed = CandidateCodex01444Collector::collect_with_limits(launch, TEST_LIMITS)
            .expect_err("malformed frame must fail closed");
        assert_eq!(
            malformed,
            CollectionError::Protocol(ProtocolError::InvalidMessage)
        );
        assert!(!malformed.to_string().contains("private-output-marker"));
        assert!(!format!("{malformed:?}").contains("private-output-marker"));
    }

    #[test]
    #[cfg(feature = "process-test-fixture")]
    fn forcibly_reaps_a_child_that_ignores_closed_stdin() {
        let (launch, _directory) = launch_for("linger");
        let started = Instant::now();
        let usage = CandidateCodex01444Collector::collect_with_limits(launch, TEST_LIMITS)
            .expect("valid data must survive bounded forced cleanup");

        assert_eq!(usage.len(), 2);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    #[cfg(feature = "process-test-fixture")]
    fn rejects_a_nonzero_exit_after_valid_usage() {
        let (launch, _directory) = launch_for("late-failure");
        let error = CandidateCodex01444Collector::collect_with_limits(launch, TEST_LIMITS)
            .expect_err("nonzero child exit must invalidate otherwise valid output");

        assert_eq!(error, CollectionError::ChildExited);
    }

    #[test]
    fn launch_failures_do_not_disclose_the_selected_path() {
        let directory = TestDirectory::new("missing");
        let marker = "private-path-marker";
        let launch = ReviewedCodexLaunch::for_test(directory.0.join(marker), directory.0.clone());
        let error = CandidateCodex01444Collector::collect_with_limits(launch, TEST_LIMITS)
            .expect_err("missing executable must not launch");

        assert_eq!(error, CollectionError::LaunchFailed);
        assert!(!error.to_string().contains(marker));
        assert!(!format!("{error:?}").contains(marker));
    }
}
