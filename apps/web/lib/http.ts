import { publicOrigin } from "./config";
import type { LogFields } from "./log";
import { isResourceOverloaded } from "./overload";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasTerminalControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}
interface ResponseLogMetadata {
  outcome?: string;
  cause?: unknown;
  fields?: LogFields;
  level?: "debug" | "info" | "warn";
}

const responseMetadata = new WeakMap<Response, ResponseLogMetadata>();

class RequestBodyTimeout extends Error {}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function isSafeDisplayText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= maximum &&
    !hasTerminalControlCharacter(value)
  );
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === publicOrigin().origin;
}

export function markResponse(
  response: Response,
  outcome: string,
  cause?: unknown,
  level?: "debug" | "info" | "warn",
): Response {
  const current = responseMetadata.get(response);
  responseMetadata.set(response, {
    ...current,
    outcome,
    ...(cause === undefined ? {} : { cause }),
    ...(level === undefined ? {} : { level }),
  });
  return response;
}

export function responseLogMetadata(response: Response): ResponseLogMetadata | undefined {
  return responseMetadata.get(response);
}

export function annotateResponse(
  response: Response,
  fields: LogFields,
  level?: "debug" | "info" | "warn",
): Response {
  const current = responseMetadata.get(response);
  responseMetadata.set(response, {
    ...current,
    fields: { ...current?.fields, ...fields },
    ...(level === undefined ? {} : { level }),
  });
  return response;
}

export function problem(status: number, message: string, cause?: unknown): Response {
  if (cause instanceof RequestBodyTimeout) {
    return markResponse(
      Response.json(
        { error: "request_timeout" },
        {
          status: 408,
          headers: { "Cache-Control": "no-store" },
        },
      ),
      "request_timeout",
    );
  }
  if (isResourceOverloaded(cause)) {
    return markResponse(
      Response.json(
        { error: "temporarily_overloaded" },
        {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "1" },
        },
      ),
      "temporarily_overloaded",
    );
  }
  return markResponse(
    Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } }),
    message,
    cause,
  );
}

async function readBoundedText(request: Request, maximumBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RangeError("body_too_large");
  }

  const reader = request.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RequestBodyTimeout("request_timeout"));
      void reader.cancel().catch(() => {});
    }, 5000);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        void reader.cancel().catch(() => {});
        throw new RangeError("body_too_large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  } finally {
    clearTimeout(timer);
  }
}

export async function readBoundedJson(request: Request, maximumBytes = 16_384): Promise<unknown> {
  return JSON.parse(await readBoundedText(request, maximumBytes)) as unknown;
}

export async function readBoundedForm(
  request: Request,
  maximumBytes = 2_048,
): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/x-www-form-urlencoded") throw new SyntaxError("invalid_form");
  return new URLSearchParams(await readBoundedText(request, maximumBytes));
}
