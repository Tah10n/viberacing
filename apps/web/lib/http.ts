import { publicOrigin } from "./config";
import type { LogFields } from "./log";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
interface ResponseLogMetadata {
  outcome?: string;
  cause?: unknown;
  fields?: LogFields;
  level?: "debug" | "info" | "warn";
}

const responseMetadata = new WeakMap<Response, ResponseLogMetadata>();

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
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
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new RangeError("body_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
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
