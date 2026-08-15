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
  if (configured in logLevelOrder) return configured as LogLevel;
  throw new Error("VIBERACING_LOG_LEVEL must be debug, info, warn, error, or silent");
}

export function safeErrorFields(error: unknown): LogFields {
  const fields: Record<string, LogScalar> = {
    errorType: error instanceof Error ? (safeToken(error.name) ?? "Error") : "UnknownError",
  };
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; digest?: unknown; severity?: unknown };
    const code = safeToken(candidate.code, 32);
    const digest = safeToken(candidate.digest, 128);
    const severity = safeToken(candidate.severity, 32);
    if (code !== undefined) fields.errorCode = code;
    if (digest !== undefined) fields.errorDigest = digest;
    if (severity !== undefined) fields.errorSeverity = severity;
  }
  return fields;
}

function shouldWrite(level: Exclude<LogLevel, "silent">): boolean {
  return logLevelOrder[level] >= logLevelOrder[configuredLogLevel()];
}

export function writeLog(
  level: Exclude<LogLevel, "silent">,
  event: string,
  fields: LogFields = {},
): void {
  if (!shouldWrite(level)) return;
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "viberacing-web",
    event,
    ...fields,
  });
  if (level === "error" || level === "warn") {
    // eslint-disable-next-line no-console -- this is the centralized structured stderr sink.
    console.error(record);
  } else {
    // eslint-disable-next-line no-console -- this is the centralized structured stdout sink.
    console.log(record);
  }
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
