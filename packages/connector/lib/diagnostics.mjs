const sourceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const diagnosticCodesByPhase = Object.freeze({
  collect: Object.freeze([
    "collector_failed",
    "agent_executable_missing",
    "agent_api_timeout",
    "agent_api_invalid_response",
    "local_store_unreadable",
    "local_store_scan_limit",
    "local_store_schema_unsupported",
    "codex_rollout_read_failed",
    "codex_rollout_metadata_invalid",
    "codex_lineage_ambiguous",
    "codex_lineage_parent_missing",
    "codex_components_incomplete",
    "provider_account_identity_unavailable",
    "provider_account_changed_during_collection",
    "provider_account_registration_pending",
    "provider_account_limit_reached",
    "opencode_cutover_required",
    "local_event_identity_conflict",
  ]),
  sync: Object.freeze(["automatic_sync_failed"]),
  deliver: Object.freeze(["pending_payload_rejected"]),
});

const phases = Object.keys(diagnosticCodesByPhase);
const phaseCodes = Object.fromEntries(
  Object.entries(diagnosticCodesByPhase).map(([phase, codes]) => [phase, new Set(codes)]),
);
const states = new Set(["opened", "resolved"]);
const maximumSources = 32;
const maximumTransitionsPerKey = 2;

function diagnosticKey(phase, code) {
  return `${phase}:${code}`;
}

function splitDiagnosticKey(key) {
  if (typeof key !== "string") return null;
  const separator = key.indexOf(":");
  if (separator < 1) return null;
  const phase = key.slice(0, separator);
  const code = key.slice(separator + 1);
  return validDiagnostic(code, phase) ? { phase, code } : null;
}

export function validDiagnostic(code, phase) {
  return typeof code === "string" && typeof phase === "string" && phaseCodes[phase]?.has(code);
}

export function diagnosticError(message, code, options) {
  if (!phaseCodes.collect.has(code)) throw new Error("Invalid collector diagnostic code");
  const error = new Error(message, options);
  error.diagnosticCode = code;
  return error;
}

export function collectorDiagnostic(error) {
  let code;
  try {
    code = error?.diagnosticCode;
  } catch {}
  return {
    code: phaseCodes.collect.has(code) ? code : "collector_failed",
    phase: "collect",
  };
}

export function normalizeAdapterDiagnostics(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Map();
  for (const item of value) {
    if (
      item === null ||
      typeof item !== "object" ||
      item.phase !== "collect" ||
      !phaseCodes.collect.has(item.code)
    )
      continue;
    unique.set(diagnosticKey(item.phase, item.code), { code: item.code, phase: item.phase });
  }
  return [...unique.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function enqueueTransition(transitions, state) {
  if (!states.has(state)) return transitions;
  const normalized = [];
  for (const candidate of Array.isArray(transitions) ? transitions : []) {
    if (!states.has(candidate) || normalized.at(-1) === candidate) continue;
    if (normalized.length < maximumTransitionsPerKey) normalized.push(candidate);
    else normalized.splice(0, normalized.length, candidate);
  }
  if (normalized.at(-1) === state) return normalized;
  if (normalized.length < maximumTransitionsPerKey) normalized.push(state);
  else normalized.splice(0, normalized.length, state);
  return normalized;
}

function normalizedDiagnosticState(value) {
  const normalized = { version: 1, activeBySource: {}, outboxBySource: {} };
  if (value?.version !== 1) return normalized;
  const sourceIds = new Set([
    ...Object.keys(value.activeBySource ?? {}),
    ...Object.keys(value.outboxBySource ?? {}),
  ]);
  for (const sourceId of [...sourceIds]
    .filter((id) => sourceIdPattern.test(id))
    .sort()
    .slice(0, maximumSources)) {
    const active = [
      ...new Set(
        Array.isArray(value.activeBySource?.[sourceId]) ? value.activeBySource[sourceId] : [],
      ),
    ]
      .filter((key) => splitDiagnosticKey(key) !== null)
      .sort();
    if (active.length > 0) normalized.activeBySource[sourceId] = active;
    const outbox = {};
    const rawOutbox = value.outboxBySource?.[sourceId];
    if (rawOutbox !== null && typeof rawOutbox === "object" && !Array.isArray(rawOutbox)) {
      for (const key of Object.keys(rawOutbox).sort()) {
        if (splitDiagnosticKey(key) === null) continue;
        const transitions = [];
        for (const state of Array.isArray(rawOutbox[key]) ? rawOutbox[key] : []) {
          const compacted = enqueueTransition(transitions, state);
          transitions.splice(0, transitions.length, ...compacted);
        }
        if (transitions.length > 0) outbox[key] = transitions;
      }
    }
    if (Object.keys(outbox).length > 0) normalized.outboxBySource[sourceId] = outbox;
  }
  return normalized;
}

export function ensureDiagnosticState(state) {
  const normalized = normalizedDiagnosticState(state?.diagnostics);
  state.diagnostics = normalized;
  return normalized;
}

function queueTransition(diagnostics, sourceId, key, state) {
  diagnostics.outboxBySource[sourceId] ??= {};
  diagnostics.outboxBySource[sourceId][key] = enqueueTransition(
    diagnostics.outboxBySource[sourceId][key],
    state,
  );
}

export function reconcileDiagnosticPhase(state, sourceId, phase, observed = []) {
  if (!sourceIdPattern.test(sourceId) || !phases.includes(phase)) {
    throw new Error("Invalid diagnostic transition target");
  }
  const diagnostics = ensureDiagnosticState(state);
  const previous = new Set(diagnostics.activeBySource[sourceId] ?? []);
  const retained = [...previous].filter((key) => splitDiagnosticKey(key)?.phase !== phase);
  const nextPhase = new Set(
    normalizeAdapterDiagnostics(observed)
      .filter((item) => item.phase === phase)
      .map((item) => diagnosticKey(item.phase, item.code)),
  );
  if (phase !== "collect") {
    nextPhase.clear();
    for (const item of Array.isArray(observed) ? observed : []) {
      if (validDiagnostic(item?.code, item?.phase) && item.phase === phase) {
        nextPhase.add(diagnosticKey(item.phase, item.code));
      }
    }
  }
  const previousPhase = [...previous].filter((key) => splitDiagnosticKey(key)?.phase === phase);
  for (const key of [...nextPhase].filter((key) => !previous.has(key)).sort()) {
    queueTransition(diagnostics, sourceId, key, "opened");
  }
  for (const key of previousPhase.filter((key) => !nextPhase.has(key)).sort()) {
    queueTransition(diagnostics, sourceId, key, "resolved");
  }
  const active = [...retained, ...nextPhase].sort();
  if (active.length > 0) diagnostics.activeBySource[sourceId] = active;
  else delete diagnostics.activeBySource[sourceId];
  return diagnostics;
}

export function forgetSourceDiagnostics(state, sourceId) {
  const diagnostics = ensureDiagnosticState(state);
  delete diagnostics.activeBySource[sourceId];
  delete diagnostics.outboxBySource[sourceId];
  return diagnostics;
}

export function pendingDiagnosticEvents(
  state,
  configuredSourceIds,
  limit = 32,
  eligibleSourceIds = configuredSourceIds,
) {
  const diagnostics = ensureDiagnosticState(state);
  const configured = new Set(configuredSourceIds);
  const eligible = new Set(eligibleSourceIds);
  for (const sourceId of Object.keys(diagnostics.activeBySource)) {
    if (!configured.has(sourceId)) delete diagnostics.activeBySource[sourceId];
  }
  for (const sourceId of Object.keys(diagnostics.outboxBySource)) {
    if (!configured.has(sourceId)) delete diagnostics.outboxBySource[sourceId];
  }
  const events = [];
  for (const sourceId of Object.keys(diagnostics.outboxBySource).sort()) {
    if (!eligible.has(sourceId)) continue;
    for (const key of Object.keys(diagnostics.outboxBySource[sourceId]).sort()) {
      const parsed = splitDiagnosticKey(key);
      if (parsed === null) continue;
      for (const stateValue of diagnostics.outboxBySource[sourceId][key]) {
        events.push({ sourceId, code: parsed.code, state: stateValue, phase: parsed.phase });
        if (events.length >= limit) return events;
      }
    }
  }
  return events;
}

export function acknowledgeDiagnosticEvents(state, events) {
  const diagnostics = ensureDiagnosticState(state);
  for (const event of events) {
    if (!sourceIdPattern.test(event?.sourceId) || !validDiagnostic(event?.code, event?.phase)) {
      throw new Error("Invalid acknowledged diagnostic event");
    }
    const key = diagnosticKey(event.phase, event.code);
    const transitions = diagnostics.outboxBySource[event.sourceId]?.[key];
    if (!Array.isArray(transitions) || transitions[0] !== event.state) {
      throw new Error("Diagnostic outbox changed before acknowledgement");
    }
    transitions.shift();
    if (transitions.length === 0) delete diagnostics.outboxBySource[event.sourceId][key];
    if (Object.keys(diagnostics.outboxBySource[event.sourceId]).length === 0) {
      delete diagnostics.outboxBySource[event.sourceId];
    }
  }
  return diagnostics;
}
