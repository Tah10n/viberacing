//! Exact candidate Codex artifact admission for the one-shot sync command.

use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub(crate) const ADMITTED_CODEX_VERSION: &str = "0.144.5";
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
