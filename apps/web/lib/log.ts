export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

type LogScalar = boolean | number | string | null;
export type LogFields = Readonly<Record<string, LogScalar | readonly string[]>>;

const logLevelOrder: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

const diagnosticPatterns: readonly Readonly<{
  code: string;
  pattern: RegExp;
}>[] = [
  { code: "DNS_LOOKUP_TEMPORARY_FAILURE", pattern: /\bEAI_AGAIN\b/i },
  { code: "DNS_LOOKUP_FAILED", pattern: /\bENOTFOUND\b/i },
  { code: "CONNECTION_REFUSED", pattern: /\bECONNREFUSED\b/i },
  { code: "CONNECTION_TIMED_OUT", pattern: /\bETIMEDOUT\b/i },
  { code: "CONNECTION_RESET", pattern: /\bECONNRESET\b|socket hang up/i },
  { code: "BROKEN_PIPE", pattern: /\bEPIPE\b/i },
  { code: "PERMISSION_DENIED", pattern: /\bEACCES\b|\bEPERM\b/i },
  { code: "STORAGE_FULL", pattern: /\bENOSPC\b/i },
  { code: "FILE_DESCRIPTOR_LIMIT", pattern: /\bEMFILE\b/i },
  { code: "OUT_OF_MEMORY", pattern: /heap out of memory|allocation failed.*heap/i },
  { code: "NEXT_REDIRECT", pattern: /\bNEXT_REDIRECT\b/ },
  { code: "NEXT_NOT_FOUND", pattern: /\bNEXT_NOT_FOUND\b/ },
  { code: "NEXT_DYNAMIC_SERVER_USAGE", pattern: /dynamic server usage/i },
  {
    code: "NEXT_SERVER_ACTION_INVALID",
    pattern: /failed to find server action|invalid server actions? request/i,
  },
  { code: "MODULE_NOT_FOUND", pattern: /\bMODULE_NOT_FOUND\b|cannot find module/i },
  { code: "FETCH_FAILED", pattern: /\bfetch failed\b/i },
  { code: "HEADERS_ALREADY_SENT", pattern: /headers already sent/i },
];

function recognizedDiagnosticCode(values: readonly unknown[]): string | undefined {
  for (const value of values) {
    const text =
      typeof value === "string" ? value : value instanceof Error ? value.message : undefined;
    if (text === undefined) continue;
    const boundedText = text.slice(0, 4096);
    const match = diagnosticPatterns.find(({ pattern }) => pattern.test(boundedText));
    if (match !== undefined) return match.code;
  }
  return undefined;
}

const consoleGuardStateKey = Symbol.for("viberacing.productionConsoleGuard");

interface ConsoleGuardState {
  readonly debug: typeof console.debug;
  readonly error: typeof console.error;
  readonly info: typeof console.info;
  readonly log: typeof console.log;
  readonly trace: typeof console.trace;
  readonly warn: typeof console.warn;
}

type ConsoleGuardGlobal = typeof globalThis & {
  [consoleGuardStateKey]?: ConsoleGuardState;
};

function safeToken(value: unknown, maximumLength = 96): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    return undefined;
  }
  return /^[A-Za-z0-9_.:-]+$/.test(value) ? value : undefined;
}

export function configuredLogLevel(): LogLevel {
  const configured = process.env.VIBERACING_LOG_LEVEL?.trim().toLowerCase();
  if (configured === undefined || configured === "") {
    return process.env.NODE_ENV === "test" ? "silent" : "info";
  }
  if (Object.hasOwn(logLevelOrder, configured)) return configured as LogLevel;
  throw Object.assign(
    new Error("VIBERACING_LOG_LEVEL must be debug, info, warn, error, or silent"),
    { code: "CONFIG_LOG_LEVEL_INVALID" },
  );
}

export function safeErrorFields(error: unknown): LogFields {
  const fields: Record<string, LogScalar> = {
    errorType: error instanceof Error ? (safeToken(error.name) ?? "Error") : "UnknownError",
    ...safeDiagnosticFields(error),
  };
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; digest?: unknown; severity?: unknown };
    const code = safeToken(candidate.code, 96);
    const digest = safeToken(candidate.digest, 128);
    const severity = safeToken(candidate.severity, 32);
    if (code !== undefined) fields.errorCode = code;
    if (digest !== undefined) fields.errorDigest = digest;
    if (severity !== undefined) fields.errorSeverity = severity;
  }
  return fields;
}

export function safeDiagnosticFields(...values: readonly unknown[]): LogFields {
  const diagnosticCode = recognizedDiagnosticCode(values);
  return diagnosticCode === undefined ? {} : { diagnosticCode };
}

function shouldWrite(level: Exclude<LogLevel, "silent">): boolean {
  return logLevelOrder[level] >= logLevelOrder[configuredLogLevel()];
}

function consoleGuardState(): ConsoleGuardState | undefined {
  return (globalThis as ConsoleGuardGlobal)[consoleGuardStateKey];
}

function serializedLogRecord(
  level: Exclude<LogLevel, "silent">,
  event: string,
  fields: LogFields,
): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "viberacing-web",
    event,
    ...fields,
  });
}

export function serializeRequiredError(event: string, fields: LogFields = {}): string {
  return serializedLogRecord("error", event, fields);
}

function writeSerializedRecord(level: Exclude<LogLevel, "silent">, record: string): void {
  const state = consoleGuardState();
  if (level === "error" || level === "warn") {
    if (state !== undefined) state.error(record);
    else {
      // eslint-disable-next-line no-console -- this is the centralized structured stderr sink.
      console.error(record);
    }
  } else if (state !== undefined) state.log(record);
  else {
    // eslint-disable-next-line no-console -- this is the centralized structured stdout sink.
    console.log(record);
  }
}

export function writeLog(
  level: Exclude<LogLevel, "silent">,
  event: string,
  fields: LogFields = {},
): void {
  if (!shouldWrite(level)) return;
  writeSerializedRecord(level, serializedLogRecord(level, event, fields));
}

export function writeRequiredError(event: string, fields: LogFields = {}): void {
  writeSerializedRecord("error", serializeRequiredError(event, fields));
}

function consoleErrorCandidate(arguments_: readonly unknown[]): unknown {
  return arguments_.find(
    (argument) => argument instanceof Error || (typeof argument === "object" && argument !== null),
  );
}

function writeGuardedConsoleEvent(
  level: Exclude<LogLevel, "silent">,
  event: string,
  arguments_: readonly unknown[],
): void {
  const candidate = consoleErrorCandidate(arguments_);
  const fields: LogFields = {
    consoleArguments: arguments_.length,
    ...(candidate === undefined ? {} : safeErrorFields(candidate)),
    ...safeDiagnosticFields(...arguments_),
  };
  try {
    writeLog(level, event, fields);
  } catch (error) {
    const fallback = serializedLogRecord("error", "logging_configuration_invalid", {
      ...safeErrorFields(error),
    });
    const state = consoleGuardState();
    if (state !== undefined) state.error(fallback);
  }
}

/**
 * Next.js logs an unhandled render error before invoking instrumentation.onRequestError.
 * Replace production console sinks early so framework/library messages and stacks cannot bypass
 * the structured privacy boundary. Application records continue through the preserved raw sinks.
 */
export function installProductionConsoleGuard(): () => void {
  if (process.env.NODE_ENV !== "production") return () => {};
  const guardGlobal = globalThis as ConsoleGuardGlobal;
  if (guardGlobal[consoleGuardStateKey] !== undefined) return () => {};
  const runtimeConsole = globalThis.console;
  const state: ConsoleGuardState = {
    debug: runtimeConsole.debug.bind(runtimeConsole),
    error: runtimeConsole.error.bind(runtimeConsole),
    info: runtimeConsole.info.bind(runtimeConsole),
    log: runtimeConsole.log.bind(runtimeConsole),
    trace: runtimeConsole.trace.bind(runtimeConsole),
    warn: runtimeConsole.warn.bind(runtimeConsole),
  };
  guardGlobal[consoleGuardStateKey] = state;
  runtimeConsole.error = (...arguments_: unknown[]) => {
    writeGuardedConsoleEvent("error", "framework_console_error", arguments_);
  };
  runtimeConsole.warn = (...arguments_: unknown[]) => {
    writeGuardedConsoleEvent("warn", "framework_console_warning", arguments_);
  };
  runtimeConsole.log = (...arguments_: unknown[]) => {
    writeGuardedConsoleEvent("info", "framework_console_log", arguments_);
  };
  runtimeConsole.info = (...arguments_: unknown[]) => {
    writeGuardedConsoleEvent("info", "framework_console_info", arguments_);
  };
  runtimeConsole.debug = (...arguments_: unknown[]) => {
    writeGuardedConsoleEvent("debug", "framework_console_debug", arguments_);
  };
  runtimeConsole.trace = (...arguments_: unknown[]) => {
    writeGuardedConsoleEvent("error", "framework_console_trace", arguments_);
  };

  return () => {
    if (guardGlobal[consoleGuardStateKey] !== state) return;
    runtimeConsole.debug = state.debug;
    runtimeConsole.error = state.error;
    runtimeConsole.info = state.info;
    runtimeConsole.log = state.log;
    runtimeConsole.trace = state.trace;
    runtimeConsole.warn = state.warn;
    Reflect.deleteProperty(guardGlobal, consoleGuardStateKey);
  };
}

export const logDebug = (event: string, fields?: LogFields): void => {
  writeLog("debug", event, fields);
};
export const logInfo = (event: string, fields?: LogFields): void => {
  writeLog("info", event, fields);
};
export const logWarn = (event: string, fields?: LogFields): void => {
  writeLog("warn", event, fields);
};
export const logError = (event: string, fields?: LogFields): void => {
  writeLog("error", event, fields);
};
