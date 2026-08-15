import { randomUUID } from "node:crypto";
import { responseLogMetadata } from "./http";
import { logDebug, logError, logInfo, logWarn, safeErrorFields, type LogFields } from "./log";

interface RequestLoggingOptions {
  successLevel?: "debug" | "info";
}

function requestBytes(request: Request): number | undefined {
  const header = request.headers.get("content-length");
  if (header === null || !/^\d{1,9}$/.test(header)) return undefined;
  const value = Number(header);
  return Number.isSafeInteger(value) ? value : undefined;
}

function durationMilliseconds(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

export function withRequestLogging<Arguments extends readonly unknown[]>(
  route: string,
  handler: (...arguments_: Arguments) => Promise<Response> | Response,
  options: RequestLoggingOptions = {},
): (...arguments_: Arguments) => Promise<Response> {
  return async (...arguments_) => {
    const request =
      arguments_[0] instanceof Request
        ? arguments_[0]
        : new Request(`http://viberacing.internal${route}`);
    const startedAt = performance.now();
    const requestId = randomUUID();
    const bytes = requestBytes(request);
    const base: LogFields = {
      requestId,
      method: request.method,
      route,
      ...(bytes === undefined ? {} : { requestBytes: bytes }),
    };
    logDebug("http_request_started", base);
    try {
      const response = await handler(...arguments_);
      const metadata = responseLogMetadata(response);
      const defaultOutcome =
        response.status === 401
          ? "unauthorized"
          : response.status === 403
            ? "forbidden"
            : response.status === 404
              ? "not_found"
              : response.status === 429
                ? "rate_limited"
                : undefined;
      const fields: LogFields = {
        ...(metadata?.fields ?? {}),
        ...base,
        status: response.status,
        durationMs: durationMilliseconds(startedAt),
        ...((metadata?.outcome ?? defaultOutcome) === undefined
          ? {}
          : { outcome: metadata?.outcome ?? defaultOutcome ?? "unknown" }),
        ...(metadata?.cause === undefined ? {} : safeErrorFields(metadata.cause)),
      };
      try {
        response.headers.set("X-Request-Id", requestId);
      } catch {
        // Some framework-owned responses use immutable headers; logging must never change behavior.
      }
      if (response.status >= 500) logError("http_request_completed", fields);
      else if (response.status >= 400) logWarn("http_request_completed", fields);
      else if (metadata?.cause !== undefined || metadata?.outcome !== undefined) {
        logWarn("http_request_completed", fields);
      } else if (options.successLevel === "debug") logDebug("http_request_completed", fields);
      else logInfo("http_request_completed", fields);
      return response;
    } catch (error) {
      const fields: LogFields = {
        ...base,
        status: 500,
        outcome: "server_error",
        durationMs: durationMilliseconds(startedAt),
        ...safeErrorFields(error),
      };
      logError("http_request_failed", fields);
      return Response.json(
        { error: "server_error" },
        {
          status: 500,
          headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
        },
      );
    }
  };
}
