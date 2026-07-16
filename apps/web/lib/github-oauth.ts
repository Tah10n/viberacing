import "server-only";

import { Buffer } from "node:buffer";
import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";

import type { EnrollmentConfig } from "./enrollment-config";

const jsonContentTypePattern = /^application\/json(?:;\s*charset=utf-8)?$/i;
const maximumTokenBodyBytes = 4096;
const maximumUserBodyBytes = 65_536;

type OAuthConfig = Pick<
  EnrollmentConfig,
  "githubCallbackUrl" | "githubClientId" | "githubClientSecret"
>;
type OAuthFetch = (input: string, init: RequestInit) => Promise<Response>;
type RandomBytes = (size: number) => Uint8Array;

export interface GithubOAuthMaterial {
  readonly codeVerifier: string;
  readonly state: string;
}

function randomBase64Url32(randomBytes: RandomBytes): string {
  const bytes = Buffer.from(randomBytes(32));
  try {
    if (bytes.length !== 32) {
      throw new Error("GitHub enrollment is unavailable.");
    }
    return bytes.toString("base64url");
  } finally {
    bytes.fill(0);
  }
}

function isJson(response: Response): boolean {
  const contentType = response.headers.get("content-type");
  return contentType !== null && jsonContentTypePattern.test(contentType);
}

async function boundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    void response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (response.body === null) {
    return undefined;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let finished = false;
  let totalBytes = 0;
  try {
    while (!finished) {
      const chunk = await reader.read();
      if (chunk.done) {
        finished = true;
        continue;
      }
      if (totalBytes + chunk.value.byteLength > maximumBytes) {
        chunk.value.fill(0);
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      const copy = Buffer.from(chunk.value);
      chunk.value.fill(0);
      chunks.push(copy);
      totalBytes += copy.byteLength;
    }
    if (totalBytes === 0) {
      return undefined;
    }
    const bytes = Buffer.concat(chunks, totalBytes);
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch {
      return undefined;
    } finally {
      bytes.fill(0);
    }
  } catch {
    void reader.cancel().catch(() => undefined);
    return undefined;
  } finally {
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function createGithubOAuthMaterial(
  randomBytes: RandomBytes = nodeRandomBytes,
): GithubOAuthMaterial {
  const codeVerifier = randomBase64Url32(randomBytes);
  const state = randomBase64Url32(randomBytes);
  if (codeVerifier === state) {
    throw new Error("GitHub enrollment is unavailable.");
  }
  return Object.freeze({ codeVerifier, state });
}

export function githubAuthorizationUrl(config: OAuthConfig, material: GithubOAuthMaterial): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.githubClientId);
  url.searchParams.set("redirect_uri", config.githubCallbackUrl);
  url.searchParams.set("state", material.state);
  url.searchParams.set(
    "code_challenge",
    createHash("sha256").update(material.codeVerifier, "ascii").digest("base64url"),
  );
  url.searchParams.set("code_challenge_method", "S256");
  return url.href;
}

export async function exchangeGithubUserId(
  config: OAuthConfig,
  code: string,
  codeVerifier: string,
  signal: AbortSignal,
  fetchOAuth: OAuthFetch = fetch,
): Promise<number | undefined> {
  if (code.length < 8 || code.length > 256 || !/^[A-Za-z0-9_-]+$/.test(code)) {
    return undefined;
  }
  let accessToken = "";
  try {
    const tokenResponse = await fetchOAuth("https://github.com/login/oauth/access_token", {
      body: new URLSearchParams({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: config.githubCallbackUrl,
      }),
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
      redirect: "error",
      signal,
    });
    if (!tokenResponse.ok || !isJson(tokenResponse)) {
      return undefined;
    }
    const tokenBody = await boundedJson(tokenResponse, maximumTokenBodyBytes);
    if (!isRecord(tokenBody)) {
      return undefined;
    }
    const token = tokenBody.access_token;
    const tokenType = tokenBody.token_type;
    const scope = tokenBody.scope;
    if (
      typeof token !== "string" ||
      token.length < 20 ||
      token.length > 256 ||
      /[\s\p{Cc}\p{Cf}]/u.test(token) ||
      typeof tokenType !== "string" ||
      tokenType.toLowerCase() !== "bearer" ||
      scope !== ""
    ) {
      return undefined;
    }
    accessToken = token;

    const userResponse = await fetchOAuth("https://api.github.com/user", {
      cache: "no-store",
      credentials: "omit",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "Vibe-Racing",
        "x-github-api-version": "2022-11-28",
      },
      method: "GET",
      redirect: "error",
      signal,
    });
    if (!userResponse.ok || !isJson(userResponse)) {
      return undefined;
    }
    const userBody = await boundedJson(userResponse, maximumUserBodyBytes);
    if (!isRecord(userBody) || !Number.isSafeInteger(userBody.id) || Number(userBody.id) <= 0) {
      return undefined;
    }
    return Number(userBody.id);
  } catch {
    return undefined;
  } finally {
    accessToken = "";
  }
}
