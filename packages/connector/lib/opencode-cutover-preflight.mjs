import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";

const sourceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sequencePattern = /^(?:0|[1-9]\d*)$/;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const maximumConfigBytes = 1_000_000;
const maximumStateBytes = 20 * 1_024 * 1_024;
const maximumCutoverAliases = 65_536;
const maximumCutoverAliasBytes = 16 * 1_024 * 1_024;

export const openCodeCutoverCommand = "npx --yes @viberacing/connector@0.4.4 sync";

function cutoverRequired() {
  const error = new Error(
    `opencode_cutover_required: OpenCode accepted history requires a confirmed connector 0.4.4 cutover. Run exactly: ${openCodeCutoverCommand}`,
  );
  error.diagnosticCode = "opencode_cutover_required";
  return error;
}

function sameFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

async function readBoundedRegularJson(path, maximumBytes) {
  let before;
  try {
    before = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size < 1 ||
    before.size > maximumBytes
  )
    throw new Error("Connector preflight state is not a bounded regular file");

  const descriptor = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await descriptor.stat();
    if (!opened.isFile() || opened.nlink !== 1 || !sameFile(before, opened))
      throw new Error("Connector preflight state changed before it could be read");
    const contents = await descriptor.readFile();
    const after = await descriptor.stat();
    if (contents.byteLength > maximumBytes || !sameFile(opened, after))
      throw new Error("Connector preflight state changed while it was read");
    return JSON.parse(contents.toString("utf8"));
  } finally {
    await descriptor.close();
  }
}

function validConfirmedCutover(value, acceptedSequence) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(["aliases", "confirmedRangeEnd", "confirmedSequence", "version"]) ||
    value.version !== 1 ||
    !sequencePattern.test(value.confirmedSequence ?? "") ||
    value.confirmedSequence === "0" ||
    BigInt(value.confirmedSequence) > BigInt(acceptedSequence) ||
    !dayPattern.test(value.confirmedRangeEnd ?? "") ||
    !value.aliases ||
    typeof value.aliases !== "object" ||
    Array.isArray(value.aliases)
  )
    return false;
  const aliases = Object.entries(value.aliases);
  return (
    aliases.length <= maximumCutoverAliases &&
    aliases.every(([key, date]) => /^[0-9a-f]{64}$/.test(key) && dayPattern.test(date ?? "")) &&
    Buffer.byteLength(JSON.stringify(value.aliases)) <= maximumCutoverAliasBytes
  );
}

function validMigratedState(value) {
  const aliases = Object.entries(value?.legacyAliases ?? {});
  return (
    value?.bootstrapComplete === true &&
    value.parserVersion === 2 &&
    Array.isArray(value.legacyBaseline) &&
    value.legacyBaseline.length <= 31 &&
    value.legacyBaseline.every(
      (entry) =>
        dayPattern.test(entry?.date ?? "") && sequencePattern.test(entry?.totalTokens ?? ""),
    ) &&
    value.legacyAliases &&
    typeof value.legacyAliases === "object" &&
    !Array.isArray(value.legacyAliases) &&
    aliases.length <= maximumCutoverAliases &&
    aliases.every(([key, date]) => /^[0-9a-f]{64}$/.test(key) && dayPattern.test(date ?? "")) &&
    Buffer.byteLength(JSON.stringify(value.legacyAliases)) <= maximumCutoverAliasBytes
  );
}

export async function assertOpenCodeUpgradeReady(stateDirectory) {
  let config;
  try {
    config = await readBoundedRegularJson(join(stateDirectory, "config.json"), maximumConfigBytes);
  } catch (error) {
    // An unreadable configuration cannot prove accepted OpenCode history. Leave the existing
    // command-specific diagnostics and repair behavior responsible for that state.
    if (error instanceof SyntaxError) return;
    throw error;
  }
  if (config === null) return;
  if (config?.version !== 2 || !Array.isArray(config.sources))
    throw new Error("Connector configuration is unsupported; run `viberacing connect` again");
  const accepted = config.sources.filter(
    (source) =>
      source?.agentId === "opencode" &&
      sourceIdPattern.test(source.sourceId ?? "") &&
      sequencePattern.test(source.lastAcceptedSyncSequence ?? "") &&
      source.lastAcceptedSyncSequence !== "0",
  );
  if (accepted.length === 0) return;

  let state;
  try {
    state = await readBoundedRegularJson(join(stateDirectory, "state.json"), maximumStateBytes);
  } catch (error) {
    if (error instanceof SyntaxError) throw cutoverRequired();
    throw error;
  }
  if (
    state === null ||
    ![1, 2].includes(state?.version) ||
    !state.adapters ||
    typeof state.adapters !== "object" ||
    Array.isArray(state.adapters) ||
    accepted.some(
      (source) =>
        !validMigratedState(state.adapters[source.sourceId]) &&
        !validConfirmedCutover(
          state.adapters[source.sourceId]?.cutover,
          source.lastAcceptedSyncSequence,
        ),
    )
  )
    throw cutoverRequired();
}
