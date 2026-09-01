import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";

const sourceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sequencePattern = /^(?:0|[1-9]\d*)$/;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const maximumConfigBytes = 1_000_000;
const maximumPendingBytes = 20 * 1_024 * 1_024;
const maximumSelectedAdapterBytes = 40 * 1_024 * 1_024;
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

async function openStableRegularFile(path, maximumBytes = Infinity) {
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
  const opened = await descriptor.stat();
  if (!opened.isFile() || opened.nlink !== 1 || !sameFile(before, opened)) {
    await descriptor.close();
    throw new Error("Connector preflight state changed before it could be read");
  }
  return { descriptor, opened };
}

async function readBoundedRegularJson(path, maximumBytes) {
  const stable = await openStableRegularFile(path, maximumBytes);
  if (stable === null) return null;
  const { descriptor, opened } = stable;
  try {
    const contents = await descriptor.readFile();
    const after = await descriptor.stat();
    if (contents.byteLength > maximumBytes || !sameFile(opened, after))
      throw new Error("Connector preflight state changed while it was read");
    return JSON.parse(contents.toString("utf8"));
  } finally {
    await descriptor.close();
  }
}

class StreamingJsonReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.chunk = "";
    this.offset = 0;
    this.done = false;
  }

  async fill() {
    while (this.offset >= this.chunk.length && !this.done) {
      const next = await this.iterator.next();
      this.done = next.done === true;
      this.chunk = this.done ? "" : next.value;
      this.offset = 0;
    }
  }

  async peek() {
    await this.fill();
    return this.done ? null : this.chunk[this.offset];
  }

  async take() {
    const value = await this.peek();
    if (value !== null) this.offset += 1;
    return value;
  }

  async whitespace() {
    while (/\s/.test((await this.peek()) ?? "")) await this.take();
  }

  async expect(expected) {
    await this.whitespace();
    if ((await this.take()) !== expected) throw new SyntaxError("Invalid connector runtime state");
  }

  async string(maximumCharacters = 1_000_000) {
    await this.whitespace();
    if ((await this.take()) !== '"') throw new SyntaxError("Invalid connector runtime state");
    let raw = '"';
    let escaped = false;
    for (;;) {
      const character = await this.take();
      if (character === null) throw new SyntaxError("Invalid connector runtime state");
      raw += character;
      if (raw.length > maximumCharacters)
        throw new Error("Connector runtime state key exceeds its bound");
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') return JSON.parse(raw);
      else if (character.charCodeAt(0) < 0x20)
        throw new SyntaxError("Invalid connector runtime state");
    }
  }

  async rawValue(maximumBytes = Infinity) {
    await this.whitespace();
    const first = await this.peek();
    if (first === null) throw new SyntaxError("Invalid connector runtime state");
    const captured = [];
    let capturedBytes = 0;
    const capture = (start, end) => {
      if (maximumBytes === Infinity || end <= start) return;
      const part = this.chunk.slice(start, end);
      capturedBytes += Buffer.byteLength(part);
      if (capturedBytes > maximumBytes)
        throw new Error("Selected OpenCode runtime state exceeds its per-ledger bound");
      captured.push(part);
    };
    const scan = async (visit, completeAtEnd = false) => {
      for (;;) {
        await this.fill();
        if (this.done) {
          if (completeAtEnd) return;
          throw new SyntaxError("Invalid connector runtime state");
        }
        const start = this.offset;
        let complete = false;
        while (this.offset < this.chunk.length) {
          const character = this.chunk[this.offset];
          if (visit(character) === "stop") {
            complete = true;
            break;
          }
          this.offset += 1;
        }
        capture(start, this.offset);
        if (complete) return;
      }
    };

    if (first === '"') {
      let started = false;
      let escaped = false;
      await scan((character) => {
        if (!started) {
          started = true;
          return;
        }
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') {
          this.offset += 1;
          return "stop";
        } else if (character.charCodeAt(0) < 0x20)
          throw new SyntaxError("Invalid connector runtime state");
      });
    } else if (first === "{" || first === "[") {
      const stack = [];
      let inString = false;
      let escaped = false;
      await scan((character) => {
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          return;
        }
        if (character === '"') inString = true;
        else if (character === "{") stack.push("}");
        else if (character === "[") stack.push("]");
        else if (character === "}" || character === "]") {
          if (stack.pop() !== character) throw new SyntaxError("Invalid connector runtime state");
          if (stack.length === 0) {
            this.offset += 1;
            return "stop";
          }
        }
      });
    } else {
      let consumed = false;
      await scan((character) => {
        if (/[\s,}\]]/.test(character)) return "stop";
        consumed = true;
      }, true);
      if (!consumed) throw new SyntaxError("Invalid connector runtime state");
    }
    return maximumBytes === Infinity ? undefined : captured.join("");
  }

  async selectedObject(selected, onSelected, maximumBytes = maximumSelectedAdapterBytes) {
    await this.expect("{");
    await this.whitespace();
    if ((await this.peek()) === "}") {
      await this.take();
      return;
    }
    for (;;) {
      const key = await this.string();
      await this.expect(":");
      if (selected.has(key)) {
        const raw = await this.rawValue(maximumBytes);
        if (Buffer.byteLength(raw) > maximumBytes)
          throw new Error("Selected OpenCode runtime state exceeds its per-ledger bound");
        onSelected(key, JSON.parse(raw));
      } else await this.rawValue();
      await this.whitespace();
      const separator = await this.take();
      if (separator === "}") return;
      if (separator !== ",") throw new SyntaxError("Invalid connector runtime state");
    }
  }
}

function validConfirmedCutover(value, requiredSequence) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(["aliases", "confirmedRangeEnd", "confirmedSequence", "version"]) ||
    value.version !== 1 ||
    !sequencePattern.test(value.confirmedSequence ?? "") ||
    value.confirmedSequence === "0" ||
    value.confirmedSequence !== requiredSequence ||
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

function adapterEvidence(value) {
  const hasPending = Object.hasOwn(value ?? {}, "cutoverPending");
  return {
    migrated: validMigratedState(value),
    cutover: value?.cutover,
    hasPending,
    pendingSequence:
      hasPending && sequencePattern.test(value?.cutoverPending?.pendingSequence ?? "")
        ? value.cutoverPending.pendingSequence
        : null,
  };
}

async function readSelectedRuntimeState(path, sourceIds) {
  const stable = await openStableRegularFile(path);
  if (stable === null) return { version: null, sequences: new Map(), adapters: new Map() };
  const { descriptor, opened } = stable;
  const chunks = async function* () {
    const decoder = new TextDecoder();
    const buffer = Buffer.allocUnsafe(64 * 1_024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await descriptor.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const decoded = decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      if (decoded.length > 0) yield decoded;
    }
    const trailing = decoder.decode();
    if (trailing.length > 0) yield trailing;
  };
  const reader = new StreamingJsonReader(chunks());
  const result = { version: null, sequences: new Map(), adapters: new Map() };
  try {
    await reader.expect("{");
    await reader.whitespace();
    if ((await reader.peek()) !== "}")
      for (;;) {
        const key = await reader.string();
        await reader.expect(":");
        if (key === "version") {
          const raw = await reader.rawValue(32);
          result.version = JSON.parse(raw);
        } else if (key === "sequences") {
          await reader.selectedObject(
            sourceIds,
            (sourceId, sequence) => {
              result.sequences.set(sourceId, sequence);
            },
            64,
          );
        } else if (key === "adapters") {
          await reader.selectedObject(sourceIds, (sourceId, value) => {
            result.adapters.set(sourceId, adapterEvidence(value));
          });
        } else await reader.rawValue();
        await reader.whitespace();
        const separator = await reader.take();
        if (separator === "}") break;
        if (separator !== ",") throw new SyntaxError("Invalid connector runtime state");
      }
    else await reader.take();
    await reader.whitespace();
    if ((await reader.peek()) !== null) throw new SyntaxError("Invalid connector runtime state");
    const after = await descriptor.stat();
    if (!sameFile(opened, after))
      throw new Error("Connector preflight state changed while it was read");
    return result;
  } finally {
    await descriptor.close();
  }
}

function maximumSequence(...values) {
  let maximum = 0n;
  for (const value of values)
    if (sequencePattern.test(value ?? "") && BigInt(value) > maximum) maximum = BigInt(value);
  return maximum.toString();
}

async function pendingSequence(stateDirectory, sourceId) {
  let pending;
  try {
    pending = await readBoundedRegularJson(
      join(stateDirectory, "pending", `${sourceId}.json`),
      maximumPendingBytes,
    );
  } catch (error) {
    if (error instanceof SyntaxError) throw cutoverRequired();
    throw error;
  }
  if (pending === null) return { present: false, sequence: "0" };
  const relevant = (pending.snapshots ?? []).filter((snapshot) => snapshot?.sourceId === sourceId);
  if (relevant.some((snapshot) => !sequencePattern.test(snapshot.syncSequence ?? "")))
    throw cutoverRequired();
  return {
    present: relevant.length > 0,
    sequence: maximumSequence(...relevant.map((snapshot) => snapshot.syncSequence)),
  };
}

export async function assertOpenCodeUpgradeReady(stateDirectory, options = {}) {
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
  const sources = config.sources.filter(
    (source) =>
      source?.agentId === "opencode" &&
      sourceIdPattern.test(source.sourceId ?? "") &&
      sequencePattern.test(source.lastAcceptedSyncSequence ?? ""),
  );
  if (sources.length === 0) return;

  let state;
  try {
    state = await readSelectedRuntimeState(
      join(stateDirectory, "state.json"),
      new Set(sources.map((source) => source.sourceId)),
    );
  } catch (error) {
    if (error instanceof SyntaxError) throw cutoverRequired();
    throw error;
  }
  if (state.version !== null && ![1, 2, 3].includes(state.version)) throw cutoverRequired();

  for (const source of sources) {
    const evidence = state.adapters.get(source.sourceId);
    if (evidence?.migrated) continue;
    const pending = await pendingSequence(stateDirectory, source.sourceId);
    if (pending.present || evidence?.hasPending) throw cutoverRequired();
    const localSequence = state.sequences.get(source.sourceId);
    const serverSequence = options.serverSequences?.[source.sourceId];
    if (
      (localSequence !== undefined && !sequencePattern.test(localSequence ?? "")) ||
      (serverSequence !== undefined && !sequencePattern.test(serverSequence ?? ""))
    )
      throw cutoverRequired();
    const requiredSequence = maximumSequence(
      source.lastAcceptedSyncSequence,
      localSequence,
      pending.sequence,
      evidence?.pendingSequence,
      serverSequence,
    );
    if (requiredSequence === "0") continue;
    if (!validConfirmedCutover(evidence?.cutover, requiredSequence)) throw cutoverRequired();
  }
}
