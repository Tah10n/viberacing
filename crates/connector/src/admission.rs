//! Exact candidate Codex artifact selection and admission.

use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub(crate) const ADMITTED_CODEX_VERSION: &str = "0.144.5";
const DISCOVERY_FILE_NAMES: [&str; 2] = ["codex.exe", "codex-x86_64-pc-windows-msvc.exe"];
const MAX_DISCOVERY_CANDIDATE_PATH_BYTES: usize = 2048;
const MAX_DISCOVERY_DIRECTORIES: usize = 64;
const MAX_DISCOVERY_HASH_CANDIDATES: usize = 4;
const MAX_DISCOVERY_PATH_BYTES: usize = 65_536;
const ADMITTED_WINDOWS_X86_64_BYTES: u64 = 341_195_568;
const ADMITTED_WINDOWS_X86_64_SHA256: [u8; 32] = [
    0xef, 0xdb, 0x35, 0x40, 0xef, 0x74, 0xb9, 0x90, 0x94, 0x08, 0xc8, 0xd3, 0x8d, 0xa7, 0x94, 0x83,
    0x45, 0x47, 0x97, 0xb3, 0x6f, 0x47, 0x1e, 0x3e, 0x00, 0x4f, 0xc2, 0xbf, 0x2b, 0x70, 0xe2, 0x2a,
];

#[derive(Clone, Copy)]
struct ArtifactPolicy {
    bytes: u64,
    sha256: [u8; 32],
}

const WINDOWS_X86_64_POLICY: ArtifactPolicy = ArtifactPolicy {
    bytes: ADMITTED_WINDOWS_X86_64_BYTES,
    sha256: ADMITTED_WINDOWS_X86_64_SHA256,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AdmissionError {
    DiscoveryUnavailable,
    InvalidPath,
    #[allow(dead_code)]
    UnsupportedPlatform,
    UnsupportedArtifact,
}

pub(crate) struct AdmittedCodex {
    canonical_path: PathBuf,
    guard: File,
}

impl AdmittedCodex {
    #[cfg(test)]
    pub(crate) fn path(&self) -> &Path {
        &self.canonical_path
    }

    pub(crate) fn into_parts(self) -> (PathBuf, File) {
        (self.canonical_path, self.guard)
    }
}

pub(crate) fn admit_candidate(path: &Path) -> Result<AdmittedCodex, AdmissionError> {
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        admit_with_policy(path, WINDOWS_X86_64_POLICY)
    }

    #[cfg(not(all(windows, target_arch = "x86_64")))]
    {
        let _ = path;
        Err(AdmissionError::UnsupportedPlatform)
    }
}

pub(crate) fn discover_candidate() -> Result<AdmittedCodex, AdmissionError> {
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        let path_value = std::env::var_os("PATH").ok_or(AdmissionError::DiscoveryUnavailable)?;
        discover_from_path_value(&path_value, WINDOWS_X86_64_POLICY)
    }

    #[cfg(not(all(windows, target_arch = "x86_64")))]
    {
        Err(AdmissionError::UnsupportedPlatform)
    }
}

pub(crate) fn admit_candidate_selection(
    path: Option<&Path>,
) -> Result<AdmittedCodex, AdmissionError> {
    match path {
        Some(path) => admit_candidate(path),
        None => discover_candidate(),
    }
}

fn discover_from_path_value(
    path_value: &OsStr,
    policy: ArtifactPolicy,
) -> Result<AdmittedCodex, AdmissionError> {
    if !encoded_value_fits(path_value, MAX_DISCOVERY_PATH_BYTES) {
        return Err(AdmissionError::DiscoveryUnavailable);
    }
    discover_with_policy(std::env::split_paths(path_value), policy)
}

fn encoded_value_fits(value: &OsStr, limit: usize) -> bool {
    value.len() <= limit
}

fn candidate_path_fits(path: &Path) -> bool {
    encoded_value_fits(path.as_os_str(), MAX_DISCOVERY_CANDIDATE_PATH_BYTES)
}

fn discover_with_policy(
    directories: impl IntoIterator<Item = PathBuf>,
    policy: ArtifactPolicy,
) -> Result<AdmittedCodex, AdmissionError> {
    let mut hashed_candidates = 0_usize;
    let mut seen_candidates = HashSet::new();

    for (index, directory) in directories.into_iter().enumerate() {
        if index >= MAX_DISCOVERY_DIRECTORIES {
            return Err(AdmissionError::DiscoveryUnavailable);
        }
        if !directory.is_absolute() || !candidate_path_fits(&directory) {
            continue;
        }
        for file_name in DISCOVERY_FILE_NAMES {
            let candidate = directory.join(file_name);
            if !candidate_path_fits(&candidate) {
                continue;
            }
            let canonical_candidate = match std::fs::canonicalize(candidate) {
                Ok(value)
                    if candidate_path_fits(&value) && seen_candidates.insert(value.clone()) =>
                {
                    value
                }
                Ok(_) | Err(_) => continue,
            };
            match std::fs::metadata(&canonical_candidate) {
                Ok(value) if value.is_file() && value.len() == policy.bytes => {}
                Ok(_) | Err(_) => continue,
            }
            hashed_candidates += 1;
            if hashed_candidates > MAX_DISCOVERY_HASH_CANDIDATES {
                return Err(AdmissionError::DiscoveryUnavailable);
            }
            if let Ok(admitted) = admit_with_policy(&canonical_candidate, policy) {
                return Ok(admitted);
            }
        }
    }

    Err(AdmissionError::DiscoveryUnavailable)
}

fn admit_with_policy(path: &Path, policy: ArtifactPolicy) -> Result<AdmittedCodex, AdmissionError> {
    if !path.is_absolute() {
        return Err(AdmissionError::InvalidPath);
    }
    let canonical_path = std::fs::canonicalize(path).map_err(|_| AdmissionError::InvalidPath)?;
    let mut guard = open_guarded(&canonical_path).map_err(|_| AdmissionError::InvalidPath)?;
    let metadata = guard.metadata().map_err(|_| AdmissionError::InvalidPath)?;
    if !metadata.is_file() || metadata.len() != policy.bytes {
        return Err(AdmissionError::UnsupportedArtifact);
    }

    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    loop {
        let count = guard
            .read(&mut buffer)
            .map_err(|_| AdmissionError::UnsupportedArtifact)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    buffer.fill(0);
    let digest: [u8; 32] = hasher.finalize().into();
    if digest != policy.sha256 {
        return Err(AdmissionError::UnsupportedArtifact);
    }

    Ok(AdmittedCodex {
        canonical_path,
        guard,
    })
}

fn open_guarded(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;

        const FILE_SHARE_READ: u32 = 0x0000_0001;
        options.share_mode(FILE_SHARE_READ);
    }
    options.open(path)
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static NEXT_FILE: AtomicU64 = AtomicU64::new(1);

    struct TestFile(PathBuf);

    impl TestFile {
        fn create(contents: &[u8]) -> Self {
            let mut path = std::env::temp_dir();
            path.push(format!(
                "viberacing-admission-test-{}-{}",
                std::process::id(),
                NEXT_FILE.fetch_add(1, Ordering::Relaxed)
            ));
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&path)
                .expect("synthetic artifact must be created");
            file.write_all(contents)
                .expect("synthetic artifact must be written");
            file.flush().expect("synthetic artifact must be flushed");
            Self(path)
        }
    }

    impl Drop for TestFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn create() -> Self {
            let mut path = std::env::temp_dir();
            path.push(format!(
                "viberacing-discovery-test-{}-{}",
                std::process::id(),
                NEXT_FILE.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).expect("synthetic discovery directory must be created");
            Self(path)
        }

        fn write(&self, file_name: &str, contents: &[u8]) -> PathBuf {
            let path = self.0.join(file_name);
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&path)
                .expect("synthetic discovery candidate must be created");
            file.write_all(contents)
                .expect("synthetic discovery candidate must be written");
            file.flush()
                .expect("synthetic discovery candidate must be flushed");
            path
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn admits_only_an_absolute_exact_artifact() {
        let fixture = TestFile::create(b"synthetic exact Codex artifact");
        let policy = ArtifactPolicy {
            bytes: 30,
            sha256: Sha256::digest(b"synthetic exact Codex artifact").into(),
        };
        let admitted = admit_with_policy(&fixture.0, policy).expect("exact artifact must pass");
        assert_eq!(admitted.path(), fixture.0.canonicalize().unwrap());

        let wrong_policy = ArtifactPolicy {
            sha256: [0; 32],
            ..policy
        };
        assert_eq!(
            admit_with_policy(&fixture.0, wrong_policy).err(),
            Some(AdmissionError::UnsupportedArtifact)
        );
        assert_eq!(
            admit_with_policy(Path::new("relative-codex.exe"), policy).err(),
            Some(AdmissionError::InvalidPath)
        );
    }

    #[test]
    fn discovers_only_the_exact_fixed_name_from_bounded_absolute_directories() {
        let wrapper_directory = TestDirectory::create();
        wrapper_directory.write("codex.cmd", b"synthetic exact Codex artifact");
        wrapper_directory.write("codex", b"synthetic exact Codex artifact");
        wrapper_directory.write("renamed.exe", b"synthetic exact Codex artifact");
        let wrong_directory = TestDirectory::create();
        wrong_directory.write(DISCOVERY_FILE_NAMES[0], b"wrong candidate");
        let policy = ArtifactPolicy {
            bytes: 30,
            sha256: Sha256::digest(b"synthetic exact Codex artifact").into(),
        };

        for file_name in DISCOVERY_FILE_NAMES {
            let exact_directory = TestDirectory::create();
            let exact_path = exact_directory.write(file_name, b"synthetic exact Codex artifact");
            let admitted = discover_with_policy(
                [
                    PathBuf::from("relative-entry-is-ignored"),
                    wrapper_directory.0.clone(),
                    wrong_directory.0.clone(),
                    exact_directory.0.clone(),
                ],
                policy,
            )
            .expect("each exact fixed-name candidate must be discoverable");
            assert_eq!(admitted.path(), exact_path.canonicalize().unwrap());
        }
    }

    #[test]
    fn enforces_the_exact_path_and_directory_budgets() {
        let policy = ArtifactPolicy {
            bytes: 30,
            sha256: Sha256::digest(b"synthetic exact Codex artifact").into(),
        };
        let oversized_path = std::ffi::OsString::from("x".repeat(MAX_DISCOVERY_PATH_BYTES + 1));
        assert_eq!(
            discover_from_path_value(&oversized_path, policy).err(),
            Some(AdmissionError::DiscoveryUnavailable)
        );
        assert!(encoded_value_fits(
            std::ffi::OsString::from("x".repeat(MAX_DISCOVERY_PATH_BYTES)).as_os_str(),
            MAX_DISCOVERY_PATH_BYTES
        ));
        assert!(candidate_path_fits(&PathBuf::from(
            "x".repeat(MAX_DISCOVERY_CANDIDATE_PATH_BYTES)
        )));
        assert!(!candidate_path_fits(&PathBuf::from(
            "x".repeat(MAX_DISCOVERY_CANDIDATE_PATH_BYTES + 1)
        )));

        let exact_directory = TestDirectory::create();
        exact_directory.write(DISCOVERY_FILE_NAMES[0], b"synthetic exact Codex artifact");
        let mut within_budget =
            vec![PathBuf::from("relative-entry"); MAX_DISCOVERY_DIRECTORIES - 1];
        within_budget.push(exact_directory.0.clone());
        discover_with_policy(within_budget, policy)
            .expect("the final in-budget directory must still be considered");

        let mut over_budget = vec![PathBuf::from("relative-entry"); MAX_DISCOVERY_DIRECTORIES];
        over_budget.push(exact_directory.0.clone());
        assert_eq!(
            discover_with_policy(over_budget, policy).err(),
            Some(AdmissionError::DiscoveryUnavailable)
        );
    }

    #[test]
    fn bounds_distinct_hashes_and_deduplicates_canonical_candidates() {
        let policy = ArtifactPolicy {
            bytes: 4,
            sha256: Sha256::digest(b"good").into(),
        };

        let within_budget = (0..MAX_DISCOVERY_HASH_CANDIDATES)
            .map(|index| {
                let directory = TestDirectory::create();
                let contents = if index + 1 == MAX_DISCOVERY_HASH_CANDIDATES {
                    *b"good"
                } else {
                    let suffix = u8::try_from(index).expect("the fixed test range must fit u8");
                    [b'b', b'a', b'd', b'0' + suffix]
                };
                directory.write(DISCOVERY_FILE_NAMES[0], &contents);
                directory
            })
            .collect::<Vec<_>>();
        discover_with_policy(
            within_budget
                .iter()
                .map(|directory| directory.0.clone())
                .collect::<Vec<_>>(),
            policy,
        )
        .expect("the final in-budget exact-size hash must still be admitted");

        let over_budget = (0..=MAX_DISCOVERY_HASH_CANDIDATES)
            .map(|index| {
                let directory = TestDirectory::create();
                let contents = if index == MAX_DISCOVERY_HASH_CANDIDATES {
                    *b"good"
                } else {
                    let suffix = u8::try_from(index).expect("the fixed test range must fit u8");
                    [b'b', b'a', b'd', b'0' + suffix]
                };
                directory.write(DISCOVERY_FILE_NAMES[0], &contents);
                directory
            })
            .collect::<Vec<_>>();
        assert_eq!(
            discover_with_policy(
                over_budget
                    .iter()
                    .map(|directory| directory.0.clone())
                    .collect::<Vec<_>>(),
                policy,
            )
            .err(),
            Some(AdmissionError::DiscoveryUnavailable)
        );

        let duplicate_directory = TestDirectory::create();
        duplicate_directory.write(DISCOVERY_FILE_NAMES[0], b"bad0");
        let exact_directory = TestDirectory::create();
        exact_directory.write(DISCOVERY_FILE_NAMES[0], b"good");
        let mut duplicate_paths =
            vec![duplicate_directory.0.clone(); MAX_DISCOVERY_HASH_CANDIDATES + 1];
        duplicate_paths.push(exact_directory.0.clone());
        discover_with_policy(duplicate_paths, policy)
            .expect("one canonical file reached repeatedly must consume one hash slot");
    }

    #[test]
    fn production_policy_matches_the_checked_in_candidate_manifest() {
        let manifest: serde_json::Value =
            serde_json::from_str(include_str!("../../../compat/codex/0.144.5/manifest.json"))
                .expect("candidate manifest must parse");
        let artifact = &manifest["release"]["artifact"];
        let mut policy_digest = String::with_capacity(64);
        for byte in ADMITTED_WINDOWS_X86_64_SHA256 {
            use std::fmt::Write as _;

            write!(policy_digest, "{byte:02x}").expect("writing to a String cannot fail");
        }
        assert_eq!(manifest["codexVersion"], ADMITTED_CODEX_VERSION);
        assert_eq!(
            manifest["release"]["artifact"]["name"],
            DISCOVERY_FILE_NAMES[1]
        );
        assert_eq!(artifact["bytes"], WINDOWS_X86_64_POLICY.bytes);
        assert_eq!(artifact["sha256"], policy_digest);
    }

    #[test]
    fn guarded_exact_artifact_remains_directly_launchable() {
        let executable = std::env::current_exe().expect("test executable must resolve");
        let bytes = std::fs::read(&executable).expect("test executable must be readable");
        let policy = ArtifactPolicy {
            bytes: u64::try_from(bytes.len()).expect("test executable length must fit u64"),
            sha256: Sha256::digest(&bytes).into(),
        };
        drop(bytes);
        let admitted = admit_with_policy(&executable, policy)
            .expect("the exact guarded test executable must be admitted");
        let status = Command::new(admitted.path())
            .arg("--list")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("the guarded executable must remain directly launchable");
        assert!(status.success());
    }
}
