import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createGithubOAuthMaterial,
  exchangeGithubUserId,
  githubAuthorizationUrl,
} from "./github-oauth";

const config = {
  githubCallbackUrl: "https://race.example.com/auth/github/callback",
  githubClientId: "Ov23abcdefghijklmno",
  githubClientSecret: "a".repeat(40),
};

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

describe("GitHub OAuth", () => {
  it("generates bounded state and PKCE authorization parameters", () => {
    let fill = 0;
    const material = createGithubOAuthMaterial((size) => Buffer.alloc(size, (fill += 1)));
    const url = new URL(githubAuthorizationUrl(config, material));

    expect(material.state).toHaveLength(43);
    expect(material.codeVerifier).toHaveLength(43);
    expect(material.state).not.toBe(material.codeVerifier);
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: config.githubClientId,
      code_challenge_method: "S256",
      redirect_uri: config.githubCallbackUrl,
      state: material.state,
    });
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(material.codeVerifier, "ascii").digest("base64url"),
    );
    expect(() => createGithubOAuthMaterial((size) => Buffer.alloc(size, 1))).toThrow(
      "GitHub enrollment is unavailable.",
    );
  });

  it("exchanges once, reads only the numeric ID, and sends no browser credentials", async () => {
    const fetchOAuth = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "g".repeat(40), scope: "", token_type: "bearer" }),
      )
      .mockResolvedValueOnce(jsonResponse({ email: "private@example.invalid", id: 123_456 }));
    const signal = new AbortController().signal;

    await expect(
      exchangeGithubUserId(
        config,
        "valid_code_123",
        Buffer.alloc(32, 1).toString("base64url"),
        signal,
        fetchOAuth,
      ),
    ).resolves.toBe(123_456);
    expect(fetchOAuth).toHaveBeenCalledTimes(2);
    expect(fetchOAuth.mock.calls[0]?.[0]).toBe("https://github.com/login/oauth/access_token");
    expect(fetchOAuth.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      method: "POST",
      redirect: "error",
      signal,
    });
    const tokenBody = fetchOAuth.mock.calls[0]?.[1].body;
    expect(tokenBody).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(tokenBody as URLSearchParams)).toEqual({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code: "valid_code_123",
      code_verifier: Buffer.alloc(32, 1).toString("base64url"),
      redirect_uri: config.githubCallbackUrl,
    });
    expect(fetchOAuth.mock.calls[1]?.[0]).toBe("https://api.github.com/user");
    expect(fetchOAuth.mock.calls[1]?.[1]).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      method: "GET",
      redirect: "error",
      signal,
    });
    expect(fetchOAuth.mock.calls[1]?.[1].headers).toMatchObject({
      accept: "application/vnd.github+json",
      authorization: `Bearer ${"g".repeat(40)}`,
      "x-github-api-version": "2022-11-28",
    });
  });

  it.each([
    [
      jsonResponse({ access_token: "g".repeat(40), scope: "repo", token_type: "bearer" }),
      undefined,
    ],
    [new Response("not json", { status: 200 }), undefined],
    [
      new Response("x".repeat(4097), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
      undefined,
    ],
    [jsonResponse({}, { status: 503 }), undefined],
  ])("rejects an unsafe token response", async (tokenResponse, expected) => {
    await expect(
      exchangeGithubUserId(
        config,
        "valid_code_123",
        Buffer.alloc(32, 1).toString("base64url"),
        new AbortController().signal,
        () => Promise.resolve(tokenResponse.clone()),
      ),
    ).resolves.toBe(expected);
  });

  it("rejects invalid user data and contained network failures", async () => {
    const token = jsonResponse({
      access_token: "g".repeat(40),
      scope: "",
      token_type: "bearer",
    });
    const invalidUser = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(token)
      .mockResolvedValueOnce(jsonResponse({ id: 0 }));
    await expect(
      exchangeGithubUserId(
        config,
        "valid_code_123",
        Buffer.alloc(32, 1).toString("base64url"),
        new AbortController().signal,
        invalidUser,
      ),
    ).resolves.toBeUndefined();
    await expect(
      exchangeGithubUserId(config, "bad code", "bad", new AbortController().signal, () =>
        Promise.reject(new Error("private")),
      ),
    ).resolves.toBeUndefined();
  });
});
