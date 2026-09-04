// Cursor-only CAS journal extracted from the verified hook reconciliation mechanism.
// Runtime has no dependency on the evidence probe or any observation files.
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, open, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { acquireOwnedLock, releaseOwnedLock } from "./owned-lock.mjs";
import { quoteWindowsCommandArgument } from "./executables.mjs";
import {
  ensureOwnerOnlyWindowsFile,
  inspectOwnerOnlyWindowsDirectory,
  inspectOwnerOnlyWindowsFile,
} from "./windows-security.mjs";

const maximumInputBytes = 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventNames = ["stop", "sessionEnd"];
function safeFailure() {
  const error = new Error("Cursor hook settings are unavailable or changed concurrently");
  error.diagnosticCode = "cursor_hook_stale";
  return error;
}
async function assertRoot(root) {
  if (!isAbsolute(root)) throw safeFailure();
  const info = await lstat(root);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (typeof process.getuid === "function" &&
      (info.uid !== process.getuid() || (info.mode & 0o022) !== 0)) ||
    !(await inspectOwnerOnlyWindowsDirectory(root))
  )
    throw safeFailure();
  return info;
}
async function assertSafeRegularFile(
  path,
  { allowMissing = false, allowMultipleLinks = false, privateFile = true } = {},
) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return null;
    throw error;
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (!allowMultipleLinks && info.nlink !== 1) ||
    info.size > maximumInputBytes ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  )
    throw safeFailure();
  if (
    privateFile &&
    ((process.platform !== "win32" && (info.mode & 0o077) !== 0) ||
      !(await inspectOwnerOnlyWindowsFile(path)))
  )
    throw safeFailure();
  return info;
}
async function readBoundedFile(path, expected) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!sameFileStat(expected, info)) throw safeFailure();
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (
      offset !== info.size ||
      !sameFileStat(info, await handle.stat()) ||
      !sameFileStat(info, await lstat(path))
    )
      throw safeFailure();
    const contents = bytes.subarray(0, offset);
    new TextDecoder("utf-8", { fatal: true }).decode(contents);
    return contents;
  } finally {
    await handle.close();
  }
}
async function securePrivateFile(path) {
  if (process.platform === "win32") await ensureOwnerOnlyWindowsFile(path);
  else await chmod(path, 0o600);
}
async function syncDirectory(root) {
  if (process.platform === "win32") return;
  const handle = await open(root, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
function validatedHooksDocument(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Cursor hooks.json must contain an object");
  if (value.version !== undefined && value.version !== 1)
    throw new Error("Cursor hooks.json has an unsupported version");
  if (
    value.hooks !== undefined &&
    (value.hooks === null || typeof value.hooks !== "object" || Array.isArray(value.hooks))
  )
    throw new Error("Cursor hooks.json has an invalid hooks field");
  return value;
}

async function readHooksSnapshot(hooksFile) {
  const info = await assertSafeRegularFile(hooksFile, { allowMissing: true, privateFile: true });
  if (info === null)
    return {
      document: { version: 1, hooks: {} },
      fingerprint: { exists: false },
    };
  const contents = await readBoundedFile(hooksFile, info);
  const after = await lstat(hooksFile);
  if (info.dev !== after.dev || info.ino !== after.ino || info.size !== after.size)
    throw new Error("Cursor hooks.json changed while it was read");
  return {
    document: validatedHooksDocument(JSON.parse(contents.toString("utf8"))),
    fingerprint: {
      exists: true,
      dev: String(after.dev),
      ino: String(after.ino),
      size: after.size,
      mtimeMs: after.mtimeMs,
      sha256: createHash("sha256").update(contents).digest("hex"),
    },
  };
}

async function hooksFingerprint(hooksFile) {
  const info = await assertSafeRegularFile(hooksFile, { allowMissing: true, privateFile: true });
  if (info === null) return { exists: false };
  const contents = await readBoundedFile(hooksFile, info);
  const after = await lstat(hooksFile);
  if (info.dev !== after.dev || info.ino !== after.ino || info.size !== after.size)
    throw new Error("Cursor hooks.json changed while it was fingerprinted");
  return {
    exists: true,
    dev: String(after.dev),
    ino: String(after.ino),
    size: after.size,
    mtimeMs: after.mtimeMs,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

function sameFingerprint(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hooksMutationPath(path, kind) {
  return `${path}.viberacing-cursor-hooks.${kind}`;
}

function isOwnedHooksStageName(path, name) {
  const prefix = `${basename(path)}.viberacing-cursor-hooks.stage-`;
  if (!name.startsWith(prefix)) return false;
  const suffix = name.slice(prefix.length);
  const separator = suffix.indexOf("-");
  return (
    separator > 0 &&
    /^[1-9]\d*$/.test(suffix.slice(0, separator)) &&
    uuidPattern.test(suffix.slice(separator + 1))
  );
}

function sameFileStat(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.nlink === right.nlink
  );
}

async function recoverPublishedHooksStage(path) {
  const directory = dirname(path);
  const stagePaths = (await readdir(directory))
    .filter((name) => isOwnedHooksStageName(path, name))
    .map((name) => join(directory, name));
  if (stagePaths.length === 0) return;
  const unpublished = [];
  const published = [];
  for (const stagePath of stagePaths) {
    const info = await assertSafeRegularFile(stagePath, {
      allowMultipleLinks: true,
      privateFile: true,
    });
    if (info.nlink === 1) unpublished.push({ path: stagePath, info });
    else if (info.nlink === 2) published.push(stagePath);
    else
      throw new Error("Cursor hooks orphan stage recovery is ambiguous; all files were preserved");
  }
  for (const candidate of unpublished) {
    const current = await assertSafeRegularFile(candidate.path, {
      allowMultipleLinks: true,
      privateFile: true,
    });
    if (!sameFileStat(candidate.info, current) || current.nlink !== 1)
      throw new Error(
        "Cursor hooks orphan stage changed during recovery; all files were preserved",
      );
    await unlink(candidate.path);
  }
  if (published.length === 0) return;
  if (published.length !== 1)
    throw new Error("Cursor hooks orphan stage recovery is ambiguous; all files were preserved");
  const currentState = await readHooksJournalSnapshot(path);
  if (currentState === null)
    throw new Error("Cursor hooks orphan stage recovery is ambiguous; all files were preserved");
  const currentInfo = await lstat(path);
  const [stagePath] = published;
  const stageState = await readHooksJournalSnapshot(stagePath);
  const stageInfo = await lstat(stagePath);
  if (
    stageState === null ||
    !sameFingerprint(currentState.fingerprint, stageState.fingerprint) ||
    currentInfo.nlink !== 2 ||
    stageInfo.nlink !== 2
  )
    throw new Error("Cursor hooks orphan stage recovery is ambiguous; all files were preserved");
  await assertHooksJournalUnchanged(path, currentState, "orphan stage recovery");
  await assertHooksJournalUnchanged(stagePath, stageState, "orphan stage recovery");
  const [currentAfter, stageAfter] = await Promise.all([lstat(path), lstat(stagePath)]);
  if (
    currentAfter.dev !== stageAfter.dev ||
    currentAfter.ino !== stageAfter.ino ||
    currentAfter.nlink !== 2 ||
    stageAfter.nlink !== 2
  )
    throw new Error("Cursor hooks orphan stage changed during recovery; all files were preserved");
  await unlink(stagePath);
  await assertSafeRegularFile(path, { privateFile: true });
}

async function restoreDisplacedHooks(path, recovery) {
  try {
    await link(recovery, path);
    await unlink(recovery);
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new Error(
        `Cursor hooks changed twice during recovery; both foreign versions were preserved at ${path} and ${recovery}`,
      );
    throw error;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeHooksDocuments(original, concurrent) {
  const merged = Object.create(null);
  for (const key of new Set([...Object.keys(original), ...Object.keys(concurrent)])) {
    if (key === "hooks") continue;
    if (!Object.hasOwn(original, key)) merged[key] = cloneJson(concurrent[key]);
    else if (!Object.hasOwn(concurrent, key)) merged[key] = cloneJson(original[key]);
    else if (JSON.stringify(original[key]) === JSON.stringify(concurrent[key]))
      merged[key] = cloneJson(concurrent[key]);
    else
      throw new Error(
        `Cursor hooks concurrent top-level field ${key} conflicts; both versions were preserved`,
      );
  }
  const originalHooks = Object.hasOwn(original, "hooks") ? original.hooks : Object.create(null);
  const concurrentHooks = Object.hasOwn(concurrent, "hooks")
    ? concurrent.hooks
    : Object.create(null);
  const hooks = Object.create(null);
  for (const eventName of new Set([
    ...Object.keys(originalHooks),
    ...Object.keys(concurrentHooks),
  ])) {
    const left = Object.hasOwn(originalHooks, eventName) ? originalHooks[eventName] : [];
    const right = Object.hasOwn(concurrentHooks, eventName) ? concurrentHooks[eventName] : [];
    if (!Array.isArray(left) || !Array.isArray(right))
      throw new Error(
        `Cursor hooks concurrent ${eventName} field is not mergeable; both versions were preserved`,
      );
    const seen = new Set();
    hooks[eventName] = [...left, ...right]
      .filter((entry) => {
        const serialized = JSON.stringify(entry);
        if (seen.has(serialized)) return false;
        seen.add(serialized);
        return true;
      })
      .map(cloneJson);
  }
  if (
    Object.keys(hooks).length > 0 ||
    Object.hasOwn(original, "hooks") ||
    Object.hasOwn(concurrent, "hooks")
  )
    merged.hooks = hooks;
  return validatedHooksDocument(merged);
}

async function readHooksJournalSnapshot(path) {
  const info = await assertSafeRegularFile(path, {
    allowMissing: true,
    allowMultipleLinks: true,
    privateFile: true,
  });
  if (info === null) return null;
  const contents = await readBoundedFile(path, info);
  const after = await lstat(path);
  if (info.dev !== after.dev || info.ino !== after.ino || info.size !== after.size)
    throw new Error(`Cursor hooks journal changed while it was read: ${path}`);
  const sha256 = createHash("sha256").update(contents).digest("hex");
  return {
    document: validatedHooksDocument(JSON.parse(contents.toString("utf8"))),
    sha256,
    fingerprint: {
      exists: true,
      dev: String(after.dev),
      ino: String(after.ino),
      size: after.size,
      mtimeMs: after.mtimeMs,
      sha256,
    },
  };
}

async function assertHooksJournalUnchanged(path, expected, context) {
  const actual = await readHooksJournalSnapshot(path);
  const unchanged =
    expected === null
      ? actual === null
      : actual !== null && sameFingerprint(expected.fingerprint, actual.fingerprint);
  if (!unchanged)
    throw new Error(
      `Cursor hooks changed during ${context}; all recoverable versions were preserved`,
    );
  return actual;
}

async function unlinkHooksJournalConditionally(
  journalPath,
  expected,
  checks,
  { kind, recoveryFaults = {} } = {},
) {
  await recoveryFaults.beforeJournalCleanup?.({ kind, path: journalPath });
  for (const [path, state] of checks)
    await assertHooksJournalUnchanged(path, state, `${kind} journal cleanup`);
  await assertHooksJournalUnchanged(journalPath, expected, `${kind} journal cleanup`);
  await unlink(journalPath);
}

async function restoreSingleHooksJournal(
  path,
  journalPath,
  expected,
  { kind, recoveryFaults = {} } = {},
) {
  await assertHooksJournalUnchanged(path, null, `${kind} journal restoration`);
  await assertHooksJournalUnchanged(journalPath, expected, `${kind} journal restoration`);
  await recoveryFaults.beforeSingleRestore?.({ kind, path, journalPath });
  try {
    await link(journalPath, path);
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new Error(
        `Cursor hooks changed during ${kind} journal restoration; both versions were preserved at ${path} and ${journalPath}`,
        { cause: error },
      );
    throw error;
  }
  const published = await assertHooksJournalUnchanged(
    path,
    expected,
    `${kind} journal restoration`,
  );
  await unlinkHooksJournalConditionally(journalPath, expected, [[path, published]], {
    kind,
    recoveryFaults,
  });
}

function documentSubsumes(document, requiredDocuments) {
  try {
    let merged = requiredDocuments[0];
    for (const required of requiredDocuments.slice(1))
      merged = mergeHooksDocuments(merged, required);
    return JSON.stringify(mergeHooksDocuments(merged, document)) === JSON.stringify(document);
  } catch {
    return false;
  }
}

async function publishRecoveredHooks(
  path,
  recovery,
  reconcile,
  documents,
  {
    currentState = null,
    recoveryState = null,
    reconcileState = null,
    displaceCurrent = false,
    recoveryFaults = {},
  } = {},
) {
  let merged = documents[0];
  for (const document of documents.slice(1)) merged = mergeHooksDocuments(merged, document);
  const stage = await stageHooksDocument(path, merged);
  const stageState = await readHooksJournalSnapshot(stage);
  try {
    if (displaceCurrent) {
      for (const [candidatePath, state] of [
        [path, currentState],
        [recovery, recoveryState],
        [reconcile, null],
      ])
        await assertHooksJournalUnchanged(candidatePath, state, "recovery reconciliation");
      await recoveryFaults.beforeReconcileDisplace?.({ path, recovery, reconcile });
      await rename(path, reconcile);
      await recoveryFaults.afterReconcileRename?.();
      try {
        await assertHooksJournalUnchanged(
          reconcile,
          currentState,
          "recovery reconciliation displacement",
        );
      } catch (error) {
        await restoreDisplacedHooks(path, reconcile);
        throw error;
      }
      await assertHooksJournalUnchanged(path, null, "recovery reconciliation publication");
      await assertHooksJournalUnchanged(
        recovery,
        recoveryState,
        "recovery reconciliation publication",
      );
    } else {
      for (const [candidatePath, state] of [
        [path, null],
        [recovery, recoveryState],
        [reconcile, reconcileState],
      ])
        await assertHooksJournalUnchanged(candidatePath, state, "recovery publication");
    }
    try {
      await link(stage, path);
    } catch (error) {
      if (error?.code === "EEXIST")
        throw new Error(
          `Cursor hooks changed during recovery publication; all versions were preserved at ${path}, ${recovery}, and ${reconcile}`,
          { cause: error },
        );
      throw error;
    }
    const publishedState = await assertHooksJournalUnchanged(
      path,
      stageState,
      "recovery publication verification",
    );
    await recoveryFaults.afterMergedPublish?.();
    const expectedReconcile = displaceCurrent ? currentState : reconcileState;
    if (expectedReconcile !== null)
      await unlinkHooksJournalConditionally(
        reconcile,
        expectedReconcile,
        [
          [path, publishedState],
          [recovery, recoveryState],
        ],
        { kind: "reconcile", recoveryFaults },
      );
    await recoveryFaults.afterReconcileCleanup?.();
    if (recoveryState !== null)
      await unlinkHooksJournalConditionally(
        recovery,
        recoveryState,
        [
          [path, publishedState],
          [reconcile, null],
        ],
        { kind: "recovery", recoveryFaults },
      );
  } finally {
    await unlink(stage).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function recoverInterruptedHooksMutation(path, { recoveryFaults = {} } = {}) {
  await recoverPublishedHooksStage(path);
  const recovery = hooksMutationPath(path, "recovery");
  const reconcile = hooksMutationPath(path, "reconcile");
  const [currentState, recoveryState, reconcileState] = await Promise.all(
    [path, recovery, reconcile].map(readHooksJournalSnapshot),
  );
  const present = [currentState, recoveryState, reconcileState].map(Boolean);
  if (present.every((value) => !value) || (present[0] && !present[1] && !present[2])) return;
  if (!present[0] && present[1] && !present[2]) {
    await restoreSingleHooksJournal(path, recovery, recoveryState, {
      kind: "recovery",
      recoveryFaults,
    });
    return;
  }
  if (!present[0] && !present[1] && present[2]) {
    await restoreSingleHooksJournal(path, reconcile, reconcileState, {
      kind: "reconcile",
      recoveryFaults,
    });
    return;
  }
  if (present[0] && present[1] && !present[2]) {
    if (currentState.sha256 === recoveryState.sha256) {
      await unlinkHooksJournalConditionally(recovery, recoveryState, [[path, currentState]], {
        kind: "recovery",
        recoveryFaults,
      });
      return;
    }
    await publishRecoveredHooks(
      path,
      recovery,
      reconcile,
      [recoveryState.document, currentState.document],
      {
        currentState,
        recoveryState,
        displaceCurrent: true,
        recoveryFaults,
      },
    );
    return;
  }
  if (present[0] && !present[1] && present[2]) {
    if (
      currentState.sha256 === reconcileState.sha256 ||
      documentSubsumes(currentState.document, [reconcileState.document])
    ) {
      await unlinkHooksJournalConditionally(reconcile, reconcileState, [[path, currentState]], {
        kind: "reconcile",
        recoveryFaults,
      });
      return;
    }
    throw new Error(
      `Cursor hooks recovery is ambiguous; all versions were preserved at ${path} and ${reconcile}`,
    );
  }
  if (!present[0] && present[1] && present[2]) {
    await publishRecoveredHooks(
      path,
      recovery,
      reconcile,
      [recoveryState.document, reconcileState.document],
      { recoveryState, reconcileState, recoveryFaults },
    );
    return;
  }
  if (documentSubsumes(currentState.document, [recoveryState.document, reconcileState.document])) {
    await unlinkHooksJournalConditionally(
      reconcile,
      reconcileState,
      [
        [path, currentState],
        [recovery, recoveryState],
      ],
      { kind: "reconcile", recoveryFaults },
    );
    await recoveryFaults.afterReconcileCleanup?.();
    await unlinkHooksJournalConditionally(
      recovery,
      recoveryState,
      [
        [path, currentState],
        [reconcile, null],
      ],
      { kind: "recovery", recoveryFaults },
    );
    return;
  }
  throw new Error(
    `Cursor hooks recovery is ambiguous; all versions were preserved at ${path}, ${recovery}, and ${reconcile}`,
  );
}

async function stageHooksDocument(path, document) {
  const stage = hooksMutationPath(path, `stage-${process.pid}-${randomUUID()}`);
  const contents = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(contents) > maximumInputBytes) throw safeFailure();
  await writeFile(stage, contents, { flag: "wx", mode: 0o600 });
  await securePrivateFile(stage);
  // Windows FlushFileBuffers requires a writable handle.
  const handle = await open(stage, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  return stage;
}

async function publishHooksConditionally(
  path,
  document,
  expected,
  { beforeCompareAndSwap, afterDisplace } = {},
) {
  const stage = await stageHooksDocument(path, document);
  const recovery = hooksMutationPath(path, "recovery");
  try {
    await beforeCompareAndSwap?.();
    if (!sameFingerprint(expected, await hooksFingerprint(path))) return false;
    if (!expected.exists) {
      try {
        await link(stage, path);
      } catch (error) {
        if (error?.code === "EEXIST") return false;
        throw error;
      }
      return true;
    }
    const priorRecovery = await assertSafeRegularFile(recovery, {
      allowMissing: true,
      privateFile: true,
    });
    if (priorRecovery !== null)
      throw new Error("Cursor hooks recovery is already pending; no update was written");
    try {
      await rename(path, recovery);
      await syncDirectory(dirname(path));
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    if (!sameFingerprint(expected, await hooksFingerprint(recovery))) {
      await restoreDisplacedHooks(path, recovery);
      return false;
    }
    await afterDisplace?.();
    try {
      await link(stage, path);
    } catch (error) {
      if (error?.code !== "EEXIST") {
        await restoreDisplacedHooks(path, recovery);
        throw error;
      }
      return false;
    }
    await syncDirectory(dirname(path));
    if (!sameFingerprint(expected, await hooksFingerprint(recovery))) throw safeFailure();
    await unlink(recovery);
    return true;
  } finally {
    await unlink(stage).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function mutateHooksWithCas(
  path,
  mutate,
  { beforeCompareAndSwap, afterDisplace, recoveryFaults } = {},
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await recoverInterruptedHooksMutation(path, { recoveryFaults });
    const { document, fingerprint } = await readHooksSnapshot(path);
    const changed = await mutate(document);
    if (!changed) return false;
    const published = await publishHooksConditionally(path, document, fingerprint, {
      beforeCompareAndSwap: () => beforeCompareAndSwap?.({ attempt, path }),
      afterDisplace: () => afterDisplace?.({ attempt, path }),
    });
    if (published) return true;
    if (attempt === 0) continue;
    throw new Error("Cursor hooks.json changed concurrently; no hook update was written");
  }
  throw new Error("Cursor hooks.json compare-and-swap retry exhausted");
}

function ownership(options) {
  if (
    !uuidPattern.test(options?.installationId ?? "") ||
    !uuidPattern.test(options?.profileId ?? "")
  )
    throw safeFailure();
  return `${options.installationId.toLowerCase()}:${options.profileId.toLowerCase()}`;
}
export function cursorHookMarker(options) {
  return `--viberacing-cursor-hook-v1=${ownership(options)}`;
}
function quote(value, platform) {
  if (typeof value !== "string" || /[\0\r\n]/.test(value)) throw safeFailure();
  return platform === "win32"
    ? quoteWindowsCommandArgument(value)
    : `'${value.replaceAll("'", `'"'"'`)}'`;
}
export function cursorHookCommand(options, eventName, platform = process.platform) {
  if (!eventNames.includes(eventName)) throw safeFailure();
  const values = [
    options.nodePath ?? process.execPath,
    options.launcher,
    "cursor-hook",
    "--event",
    eventName,
    cursorHookMarker(options),
  ];
  if (typeof options.launcher !== "string" || !options.launcher) throw safeFailure();
  const command = values.map((value) => quote(value, platform)).join(" ");
  return platform === "win32" ? `"${command}"` : command;
}
function ownsEntry(entry, options) {
  if (typeof entry?.command !== "string") return false;
  const marker = cursorHookMarker(options);
  // The final, literal argument is the installation/profile ownership marker.
  return (
    entry.command.endsWith(` '${marker}'`) || entry.command.endsWith(` ${quote(marker, "win32")}"`)
  );
}
function desiredEntry(options, eventName) {
  return { command: cursorHookCommand(options, eventName), timeout: 10 };
}
function hookStatus(document, options) {
  const status = {};
  for (const eventName of eventNames) {
    const entries = document.hooks?.[eventName] ?? [];
    if (!Array.isArray(entries)) throw safeFailure();
    const own = entries.filter((entry) => ownsEntry(entry, options));
    status[eventName] =
      own.length === 0
        ? "missing"
        : own.length === 1 &&
            JSON.stringify(own[0]) === JSON.stringify(desiredEntry(options, eventName))
          ? "current"
          : "modified";
  }
  return status;
}
/** Read-only; crash journals make the hooks stale until a repair reconciles them. */
export async function inspectCursorHooks(root, options) {
  try {
    ownership(options);
    await assertRoot(root);
    const path = join(root, "hooks.json");
    const names = await readdir(root);
    if (
      names.some(
        (name) => name.startsWith("hooks.json.viberacing-cursor-hooks.") && !name.endsWith(".lock"),
      )
    )
      return { stop: "stale", sessionEnd: "stale" };
    const { document } = await readHooksSnapshot(path);
    return hookStatus(document, options);
  } catch {
    return { stop: "stale", sessionEnd: "stale" };
  }
}
/** Caller owns connection lifecycle. Only these installation/profile entries change. */
export async function reconcileCursorHooks(root, options, { remove = false, ...faults } = {}) {
  let lock;
  try {
    ownership(options);
    const initialRoot = await assertRoot(root);
    const path = join(root, "hooks.json");
    const lockPath = hooksMutationPath(path, "lock");
    // Lock contains only a PID and random token. The directory is current-user owned.
    await assertSafeRegularFile(lockPath, { allowMissing: true, privateFile: false });
    lock = await acquireOwnedLock(lockPath, {
      waitMs: process.platform === "win32" ? 60_000 : 5_000,
    });
    if (!lock) throw safeFailure();
    const afterRoot = await assertRoot(root);
    if (afterRoot.dev !== initialRoot.dev || afterRoot.ino !== initialRoot.ino) throw safeFailure();
    const changed = await mutateHooksWithCas(
      path,
      (document) => {
        const before = JSON.stringify(document);
        // Remove this installation's entries even if a prior version used another hook event.
        for (const name of Object.keys(document.hooks ?? {})) {
          const entries = document.hooks[name];
          if (!Array.isArray(entries)) {
            if (eventNames.includes(name)) throw safeFailure();
            continue;
          }
          const retained = entries.filter((entry) => !ownsEntry(entry, options));
          if (retained.length) document.hooks[name] = retained;
          else if (entries.length) delete document.hooks[name];
        }
        if (!remove) {
          document.version ??= 1;
          document.hooks ??= {};
          for (const name of eventNames) {
            document.hooks[name] ??= [];
            document.hooks[name].push(desiredEntry(options, name));
          }
        }
        return JSON.stringify(document) !== before;
      },
      faults,
    );
    await syncDirectory(root);
    return changed;
  } catch {
    // Foreign config can contain paths, commands and credentials. Never surface them.
    throw safeFailure();
  } finally {
    if (lock) await releaseOwnedLock(lock).catch(() => {});
  }
}
