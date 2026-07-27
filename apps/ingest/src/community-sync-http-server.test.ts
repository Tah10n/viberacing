import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { createConnection } from "node:net";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptsCommunitySyncJson,
  communitySyncHttpPolicy,
  CommunitySyncHttpServerError,
  createCommunitySyncHttpServer,
  writeCommunitySyncClientError,
} from "./community-sync-http-server.js";
import { usageSyncRequestTarget } from "./protocol.js";

const requestId = "req_AAAAAAAAAAAAAAAAAAAAAA";
const problemRequestId = "req_BBBBBBBBBBBBBBBBBBBBBB";
const syncId = "syn_CCCCCCCCCCCCCCCCCCCCCC";
const requestPayload = Buffer.from('{"schemaVersion":1}\n', "utf8");

const openServers = new Set<FastifyInstance>();

function frozenRecord<T extends object>(values: T): T {
  return Object.freeze(Object.assign(Object.create(null) as object, values));
}

type EntropySource = (size: number) => Uint8Array;

interface RandomBytesSpy {
  mockImplementation(implementation: EntropySource): void;
  mockImplementationOnce(implementation: EntropySource): void;
}

function mockRandomBytesOnce(source: EntropySource): void {
  const spy = vi.spyOn(crypto, "randomBytes") as unknown as RandomBytesSpy;
  spy.mockImplementationOnce(source);
}

function successDecision(): unknown {
  return Object.freeze({
    body: frozenRecord({
      schemaVersion: 1,
      requestId,
      syncId,
      outcome: "accepted",
      acceptedEntries: 1,
    }),
    ok: true,
    status: 200,
  });
}

function problemDecision(
  status: 400 | 401 | 422 | 500 | 503,
  errorCode:
    | "internal_error"
    | "invalid_request"
    | "temporarily_unavailable"
    | "unauthorized"
    | "validation_failed",
  title:
    | "Internal server error"
    | "Invalid request"
    | "Temporarily unavailable"
    | "Unauthorized"
    | "Validation failed",
  retryable: boolean,
): unknown {
  return Object.freeze({
    body: frozenRecord({
      schemaVersion: 1,
      requestId: problemRequestId,
      status,
      errorCode,
      title,
      retryable,
    }),
    ok: false,
    status,
  });
}

function application(
  execute: (request: unknown) => Promise<unknown>,
  close?: () => Promise<void>,
): unknown {
  return close === undefined ? Object.freeze({ execute }) : Object.freeze({ close, execute });
}

function buildServer(app: unknown, usageSyncEnabled = true): FastifyInstance {
  const server = createCommunitySyncHttpServer(app, usageSyncEnabled);
  openServers.add(server);
  return server;
}

function postOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
    payload: requestPayload,
    url: usageSyncRequestTarget,
    ...overrides,
  };
}

function rawHeaderValues(envelope: unknown, expectedName: string): string[] {
  const rawHeaders = (envelope as { readonly rawHeaders: readonly string[] }).rawHeaders;
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === expectedName) {
      values.push(rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

async function listenOnLoopback(server: FastifyInstance): Promise<number> {
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP listener.");
  }
  return address.port;
}

function exchangeRaw(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let response = "";
    let settled = false;
    const finish = (): void => {
      if (!settled) {
        settled = true;
        resolve(response);
      }
    };
    socket.setEncoding("utf8");
    socket.setTimeout(2_000, () => {
      socket.destroy();
      reject(new Error("Raw HTTP exchange timed out."));
    });
    socket.on("connect", () => {
      socket.write(request);
    });
    socket.on("data", (chunk: string) => {
      response += chunk;
    });
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("error", reject);
  });
}

afterEach(async () => {
  vi.useRealTimers();
  const closing = [...openServers].map(async (server) => {
    await server.close();
  });
  openServers.clear();
  await Promise.allSettled(closing);
});

describe("Community sync Accept policy", () => {
  it.each([
    undefined,
    "application/json",
    "APPLICATION/JSON",
    "application/*",
    "*/*",
    "\tapplication/json\t",
    "text/plain;q=0, application/json; charset=utf-8; q=0.500",
    "application/json;q=1.000",
    "application/json;q=0.5, application/*;q=0",
    "application/json;q=0, application/json;q=0.5",
  ])("accepts a bounded JSON-compatible value: %o", (value) => {
    expect(acceptsCommunitySyncJson(value)).toBe(true);
  });

  it.each([
    null,
    [],
    "",
    "a".repeat(1_025),
    "application/json\n",
    "application/jsoñ",
    "*/json",
    "application",
    "application/json/extra",
    "application json",
    "application/json;q=0",
    "application/json;q=0, */*;q=1",
    "application/*;q=0, */*;q=1",
    "application/json;charset=utf-8;q=0, application/json;q=1",
    "application/json;q=1.1",
    "application/json;q=0.5;q=0.4",
    "application/json;q=.5",
    "application/json; charset=latin1",
    "application/json; charset=utf-8; charset=utf-8",
    "application/json;q=0.5;charset=utf-8",
    "application/*;charset=utf-8",
    'application/json;charset="utf-8"',
    "application/json;profile=v1",
    "application/json;=utf-8",
    "application/json;charset=",
    "application/json;charset=utf-8=extra",
    ",application/json",
    "application/json,",
    "malformed,application/json",
    "application/json,text/plain;q=private",
    `application/json;${Array.from({ length: 16 }, (_, index) => `p${String(index)}=v`).join(";")}`,
    `${Array.from({ length: 33 }, () => "text/plain").join(",")},application/json`,
  ])("rejects a malformed, non-JSON, or over-budget value: %o", (value) => {
    expect(acceptsCommunitySyncJson(value)).toBe(false);
  });
});

describe("Community sync Fastify construction", () => {
  it.each([
    null,
    {},
    { execute: () => Promise.resolve(successDecision()) },
    Object.freeze({ execute: () => Promise.resolve(successDecision()), extra: true }),
    Object.freeze({ execute: 1 }),
    Object.freeze({ close: 1, execute: () => Promise.resolve(successDecision()) }),
    Object.freeze(
      Object.defineProperty({}, "execute", {
        enumerable: true,
        get: () => () => Promise.resolve(successDecision()),
      }),
    ),
  ])("rejects an open or hostile application boundary: %o", (candidate) => {
    expect(() => createCommunitySyncHttpServer(candidate)).toThrow(
      expect.objectContaining<Partial<CommunitySyncHttpServerError>>({
        code: "application_invalid",
        message: "Community sync HTTP boundary failed closed.",
      }),
    );
  });

  it("contains an application proxy that throws during inspection", () => {
    const candidate = new Proxy(
      Object.freeze({ execute: () => Promise.resolve(successDecision()) }),
      {
        getPrototypeOf: () => {
          throw new Error("hostile prototype");
        },
      },
    );
    expect(() => createCommunitySyncHttpServer(candidate)).toThrow(CommunitySyncHttpServerError);
  });

  it.each([null, 0, "true", {}])(
    "rejects a non-boolean Usage Sync enablement value: %o",
    (candidate) => {
      const createWithUnknownEnablement = createCommunitySyncHttpServer as (
        app: unknown,
        enabled: unknown,
      ) => FastifyInstance;
      expect(() =>
        createWithUnknownEnablement(
          application(() => Promise.resolve(successDecision())),
          candidate,
        ),
      ).toThrow(CommunitySyncHttpServerError);
    },
  );

  it("pins the reviewed HTTP, socket, parser, proxy, and admission policy", async () => {
    const server = buildServer(application(() => Promise.resolve(successDecision())));

    expect(server.initialConfig).toMatchObject({
      bodyLimit: communitySyncHttpPolicy.maximumBodyBytes,
      connectionTimeout: communitySyncHttpPolicy.connectionTimeoutMs,
      handlerTimeout: communitySyncHttpPolicy.handlerTimeoutMs,
      keepAliveTimeout: communitySyncHttpPolicy.keepAliveTimeoutMs,
      maxRequestsPerSocket: communitySyncHttpPolicy.maximumRequestsPerSocket,
      requestTimeout: communitySyncHttpPolicy.requestTimeoutMs,
    });
    expect(server.server.maxConnections).toBe(communitySyncHttpPolicy.maximumConnections);
    expect(server.server.maxHeadersCount).toBe(communitySyncHttpPolicy.maximumRawHeaderPairs + 1);
    expect(server.server.headersTimeout).toBe(communitySyncHttpPolicy.requestTimeoutMs);
    expect(server.hasContentTypeParser("application/json")).toBe(true);
    await server.ready();
  });

  it("closes a configured application through the listener lifecycle", async () => {
    const close = vi.fn(() => Promise.resolve());
    const server = buildServer(application(() => Promise.resolve(successDecision()), close));

    await server.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("drains an active listener response before closing the application", async () => {
    let resolveExecution!: (decision: unknown) => void;
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const close = vi.fn(() => Promise.resolve());
    const server = buildServer(
      application(
        () =>
          new Promise<unknown>((resolve) => {
            resolveExecution = resolve;
            resolveStarted();
          }),
        close,
      ),
    );
    const port = await listenOnLoopback(server);
    const responsePromise = fetch(`http://127.0.0.1:${String(port)}${usageSyncRequestTarget}`, {
      body: requestPayload,
      headers: {
        accept: "application/json",
        connection: "close",
        "content-type": "application/json",
      },
      method: "POST",
      redirect: "error",
    });

    await started;
    const closing = server.close();
    expect(close).not.toHaveBeenCalled();
    resolveExecution(successDecision());

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      acceptedEntries: 1,
      outcome: "accepted",
      requestId,
      schemaVersion: 1,
      syncId,
    });
    await closing;
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("propagates a configured application close failure", async () => {
    const closeError = new Error("synthetic close failure");
    const server = buildServer(
      application(
        () => Promise.resolve(successDecision()),
        () => Promise.reject(closeError),
      ),
    );

    await expect(server.close()).rejects.toBe(closeError);
  });
});

describe("Community sync HTTP decisions", () => {
  it("keeps Usage Sync absent by default and exposes it only after exact host enablement", async () => {
    const execute = vi.fn(() => Promise.resolve(successDecision()));
    const disabledServer = buildServer(application(execute), false);
    const disabled = await disabledServer.inject(postOptions({ url: usageSyncRequestTarget }));

    expect(disabled.statusCode).toBe(404);
    expect(disabled.json()).toMatchObject({ errorCode: "not_found", status: 404 });
    expect(execute).not.toHaveBeenCalled();

    let captured: unknown;
    const enabledServer = buildServer(
      application((request) => {
        captured = request;
        return Promise.resolve(successDecision());
      }),
      true,
    );
    const enabled = await enabledServer.inject(postOptions({ url: usageSyncRequestTarget }));

    expect(enabled.statusCode).toBe(200);
    expect((captured as { readonly requestTarget: string }).requestTarget).toBe(
      usageSyncRequestTarget,
    );
  });

  it("preserves exact body bytes and raw headers while ignoring proxy and inbound request IDs", async () => {
    let captured: unknown;
    const execute = vi.fn((request: unknown) => {
      captured = request;
      return Promise.resolve(successDecision());
    });
    const server = buildServer(application(execute));
    const inboundRequestId = "req_ZZZZZZZZZZZZZZZZZZZZZZ";
    const response = await server.inject(
      postOptions({
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.9",
          "x-request-id": inboundRequestId,
        },
      }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(Object.getPrototypeOf(captured)).toBeNull();
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Reflect.ownKeys(captured as object).sort()).toEqual([
      "method",
      "rawBody",
      "rawHeaders",
      "requestTarget",
    ]);
    expect((captured as { readonly method: string }).method).toBe("POST");
    expect((captured as { readonly requestTarget: string }).requestTarget).toBe(
      usageSyncRequestTarget,
    );
    expect((captured as { readonly rawBody: Buffer }).rawBody.equals(requestPayload)).toBe(true);
    expect(
      Object.isFrozen((captured as { readonly rawHeaders: readonly string[] }).rawHeaders),
    ).toBe(true);
    expect(rawHeaderValues(captured, "x-forwarded-for")).toEqual(["203.0.113.9"]);
    expect(rawHeaderValues(captured, "x-request-id")).toEqual([inboundRequestId]);

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(response.headers.vary).toBe("Accept");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-request-id"]).toBe(requestId);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.body).not.toContain(inboundRequestId);
    expect(response.json()).toEqual({
      acceptedEntries: 1,
      outcome: "accepted",
      requestId,
      schemaVersion: 1,
      syncId,
    });
  });

  it("passes the exact query-bearing target to the verifier boundary", async () => {
    let captured: unknown;
    const server = buildServer(
      application((request) => {
        captured = request;
        return Promise.resolve(problemDecision(400, "invalid_request", "Invalid request", false));
      }),
    );
    const response = await server.inject(
      postOptions({ url: `${usageSyncRequestTarget}?unexpected=1` }),
    );

    expect((captured as { readonly requestTarget: string }).requestTarget).toBe(
      `${usageSyncRequestTarget}?unexpected=1`,
    );
    expect(response.statusCode).toBe(400);
  });

  it.each([
    [400, "invalid_request", "Invalid request", false],
    [401, "unauthorized", "Unauthorized", false],
    [422, "validation_failed", "Validation failed", false],
    [500, "internal_error", "Internal server error", false],
    [503, "temporarily_unavailable", "Temporarily unavailable", true],
  ] as const)(
    "serializes the closed application problem %i/%s",
    async (status, errorCode, title, retryable) => {
      const server = buildServer(
        application(() => Promise.resolve(problemDecision(status, errorCode, title, retryable))),
      );
      const response = await server.inject(postOptions());

      expect(response.statusCode).toBe(status);
      expect(response.headers["content-type"]).toBe("application/problem+json; charset=utf-8");
      expect(response.headers["x-request-id"]).toBe(problemRequestId);
      expect(response.json()).toEqual({
        errorCode,
        requestId: problemRequestId,
        retryable,
        schemaVersion: 1,
        status,
        title,
      });
    },
  );

  it.each([
    null,
    { body: frozenRecord({}), ok: true, status: 200 },
    Object.freeze({ body: frozenRecord({}), extra: true, ok: true, status: 200 }),
    Object.freeze({ body: frozenRecord({}), ok: true, status: 201 }),
    Object.freeze({ body: frozenRecord({}), ok: false, status: 418 }),
    Object.freeze({
      body: {
        schemaVersion: 1,
        requestId,
        syncId,
        outcome: "accepted",
        acceptedEntries: 1,
      },
      ok: true,
      status: 200,
    }),
    Object.freeze({
      body: frozenRecord({
        schemaVersion: 1,
        requestId,
        syncId,
        outcome: "accepted",
        acceptedEntries: 1,
        extra: true,
      }),
      ok: true,
      status: 200,
    }),
    Object.freeze({
      body: frozenRecord({
        schemaVersion: 1,
        requestId: "invalid",
        syncId,
        outcome: "accepted",
        acceptedEntries: 1,
      }),
      ok: true,
      status: 200,
    }),
    Object.freeze({
      body: frozenRecord({
        schemaVersion: 1,
        requestId: problemRequestId,
        status: 401,
        errorCode: "unauthorized",
        title: "Unauthorized",
        retryable: false,
      }),
      ok: false,
      status: 400,
    }),
    Object.freeze({
      body: frozenRecord({
        schemaVersion: 1,
        requestId: problemRequestId,
        status: 400,
        errorCode: "unauthorized",
        title: "Unauthorized",
        retryable: false,
      }),
      ok: false,
      status: 400,
    }),
    Object.freeze({ body: frozenRecord({}), ok: false, status: 400 }),
    Object.freeze({
      body: Object.freeze(
        Object.defineProperty(
          {
            schemaVersion: 1,
            requestId,
            syncId,
            outcome: "accepted",
            acceptedEntries: 1,
          },
          "syncId",
          { enumerable: true, get: () => syncId },
        ),
      ),
      ok: true,
      status: 200,
    }),
  ])("replaces an invalid application decision with one generic 500: %#", async (decision) => {
    const server = buildServer(application(() => Promise.resolve(decision)));
    const response = await server.inject(postOptions());

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      errorCode: "internal_error",
      retryable: false,
      status: 500,
      title: "Internal server error",
    });
  });

  it("contains a decision proxy that throws during inspection", async () => {
    const decision = new Proxy(Object.freeze({ body: frozenRecord({}), ok: true, status: 200 }), {
      ownKeys: () => {
        throw new Error("hostile decision");
      },
    });
    const server = buildServer(application(() => Promise.resolve(decision)));
    const response = await server.inject(postOptions());

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ errorCode: "internal_error", status: 500 });
  });
});

describe("Community sync HTTP rejection and resource policy", () => {
  it.each(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "PUT"] as const)(
    "rejects %s before media parsing with a closed 405",
    async (method) => {
      const execute = vi.fn(() => Promise.resolve(successDecision()));
      const server = buildServer(application(execute));
      const response =
        method === "HEAD" || method === "GET"
          ? await server.inject({
              headers: { "content-type": "text/plain" },
              method,
              url: usageSyncRequestTarget,
            })
          : await server.inject({
              headers: { "content-type": "text/plain" },
              method,
              payload: "not-json",
              url: usageSyncRequestTarget,
            });

      expect(response.statusCode).toBe(405);
      expect(response.headers.allow).toBe("POST");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(execute).not.toHaveBeenCalled();
      if (method !== "HEAD") {
        expect(response.json()).toMatchObject({ errorCode: "method_not_allowed", status: 405 });
      }
    },
  );

  it.each(["/v1/community/unknown", "/v1/community/sync"])(
    "returns a generic 404 for unregistered path %s",
    async (url) => {
      const execute = vi.fn(() => Promise.resolve(successDecision()));
      const server = buildServer(application(execute));
      const response = await server.inject({
        headers: { "content-type": "application/json" },
        method: "POST",
        payload: "{}",
        url,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ errorCode: "not_found", status: 404 });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("rejects an unacceptable response media range before application work", async () => {
    const execute = vi.fn(() => Promise.resolve(successDecision()));
    const server = buildServer(application(execute));
    const response = await server.inject(
      postOptions({
        headers: { accept: "text/html", "content-type": "application/json" },
      }),
    );

    expect(response.statusCode).toBe(406);
    expect(response.json()).toMatchObject({ errorCode: "not_acceptable", status: 406 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps unsupported media and oversized input to generic invalid requests", async () => {
    const execute = vi.fn(() => Promise.resolve(successDecision()));
    const server = buildServer(application(execute));
    const unsupported = await server.inject(
      postOptions({
        headers: { accept: "application/json", "content-type": "text/plain" },
        payload: "{}",
      }),
    );
    const oversized = await server.inject(
      postOptions({ payload: Buffer.alloc(communitySyncHttpPolicy.maximumBodyBytes + 1, 0x61) }),
    );

    for (const response of [unsupported, oversized]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ errorCode: "invalid_request", status: 400 });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes an empty body as exact zero bytes for verifier rejection", async () => {
    let captured: unknown;
    const server = buildServer(
      application((request) => {
        captured = request;
        return Promise.resolve(problemDecision(400, "invalid_request", "Invalid request", false));
      }),
    );
    const response = await server.inject({
      headers: { accept: "application/json" },
      method: "POST",
      url: usageSyncRequestTarget,
    });

    expect((captured as { readonly rawBody: Buffer }).rawBody).toEqual(Buffer.alloc(0));
    expect(response.statusCode).toBe(400);
  });

  it("contains thrown application values and releases admission", async () => {
    const execute = vi
      .fn<(request: unknown) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("private synthetic detail"))
      .mockResolvedValue(successDecision());
    const server = buildServer(application(execute));

    const failed = await server.inject(postOptions());
    const recovered = await server.inject(postOptions());
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain("private synthetic detail");
    expect(recovered.statusCode).toBe(200);
  });

  it("contains a thrown error whose status accessor is hostile", async () => {
    const hostileError = new Proxy(new Error("private synthetic detail"), {
      get: (target, property) => {
        if (property === "statusCode") {
          throw new Error("private hostile accessor detail");
        }
        return Reflect.get(target, property, target) as unknown;
      },
    });
    const server = buildServer(application(() => Promise.reject(hostileError)));

    const response = await server.inject(postOptions());

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ errorCode: "internal_error", status: 500 });
    expect(response.body).not.toContain("private synthetic detail");
    expect(response.body).not.toContain("private hostile accessor detail");
  });

  it("admits four active application calls with no queue and recovers after settlement", async () => {
    const resolvers: ((decision: unknown) => void)[] = [];
    const execute = vi.fn(() => {
      if (resolvers.length >= communitySyncHttpPolicy.admissionLimit) {
        return Promise.resolve(successDecision());
      }
      return new Promise<unknown>((resolve) => {
        resolvers.push(resolve);
      });
    });
    const server = buildServer(application(execute));
    const active = Array.from({ length: communitySyncHttpPolicy.admissionLimit }, () =>
      server.inject(postOptions()),
    );
    await vi.waitFor(() => {
      expect(resolvers).toHaveLength(communitySyncHttpPolicy.admissionLimit);
    });

    const rejected = await server.inject(postOptions());
    expect(rejected.statusCode).toBe(503);
    expect(rejected.json()).toMatchObject({
      errorCode: "temporarily_unavailable",
      retryable: true,
    });
    expect(execute).toHaveBeenCalledTimes(communitySyncHttpPolicy.admissionLimit);

    for (const resolve of resolvers) {
      resolve(successDecision());
    }
    await expect(Promise.all(active)).resolves.toSatisfy((responses: unknown[]) =>
      responses.every(
        (response) => (response as { readonly statusCode: number }).statusCode === 200,
      ),
    );
    await expect(server.inject(postOptions())).resolves.toMatchObject({ statusCode: 200 });
  });

  it("maps a handler-style deadline failure to a generic retryable 503", async () => {
    const timeout = Object.assign(new Error("private timeout detail"), { statusCode: 503 });
    const execute = vi
      .fn<(request: unknown) => Promise<unknown>>()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValue(successDecision());
    const server = buildServer(application(execute));

    const timedOut = await server.inject(postOptions());
    expect(timedOut.statusCode).toBe(503);
    expect(timedOut.body).not.toContain("private timeout detail");
    expect(timedOut.json()).toMatchObject({
      errorCode: "temporarily_unavailable",
      retryable: true,
      status: 503,
    });
    await expect(server.inject(postOptions())).resolves.toMatchObject({ statusCode: 200 });
  });
});

describe("Community sync raw listener behavior", () => {
  it("returns the same closed 405 for extended methods on the exact route", async () => {
    const execute = vi.fn(() => Promise.resolve(successDecision()));
    const server = buildServer(application(execute));
    const port = await listenOnLoopback(server);

    for (const method of ["COPY", "PROPFIND", "REPORT", "SEARCH", "TRACE"]) {
      const response = await exchangeRaw(
        port,
        `${method} ${usageSyncRequestTarget} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
      );

      expect(response).toContain("HTTP/1.1 405 Method Not Allowed");
      expect(response).toContain("allow: POST");
      expect(response).toContain('"errorCode":"method_not_allowed"');
    }

    expect(execute).not.toHaveBeenCalled();
  });

  it("replies after a normal stream close and contains a later client disconnect", async () => {
    let captured: unknown;
    let deferResponse = false;
    let resolveDeferred: ((decision: unknown) => void) | undefined;
    const execute = vi.fn((request: unknown) => {
      captured = request;
      if (deferResponse) {
        return new Promise<unknown>((resolve) => {
          resolveDeferred = resolve;
        });
      }
      return Promise.resolve(successDecision());
    });
    const server = buildServer(application(execute));
    const port = await listenOnLoopback(server);
    const body = "{}";
    const response = await exchangeRaw(
      port,
      [
        `POST ${usageSyncRequestTarget} HTTP/1.1`,
        "Host: viberacing.invalid",
        "Connection: close",
        "Accept: application/json",
        "Content-Type: application/json",
        `Content-Length: ${String(Buffer.byteLength(body))}`,
        "X-Viberacing-Origin-Proof: first-proof",
        "X-Viberacing-Origin-Proof: second-proof",
        "X-Forwarded-For: 198.51.100.7",
        "X-Request-Id: req_ZZZZZZZZZZZZZZZZZZZZZZ",
        "",
        body,
      ].join("\r\n"),
    );

    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain("content-type: application/json; charset=utf-8");
    expect(response).toContain('"outcome":"accepted"');
    expect(response).toContain("x-request-id: req_AAAAAAAAAAAAAAAAAAAAAA");
    expect(rawHeaderValues(captured, "x-viberacing-origin-proof")).toEqual([
      "first-proof",
      "second-proof",
    ]);
    expect(rawHeaderValues(captured, "x-forwarded-for")).toEqual(["198.51.100.7"]);
    expect(response).not.toContain("req_ZZZZZZZZZZZZZZZZZZZZZZ");

    deferResponse = true;
    const disconnectedSocket = createConnection({ host: "127.0.0.1", port });
    const disconnected = new Promise<void>((resolve) => {
      disconnectedSocket.once("close", () => {
        resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      disconnectedSocket.once("error", reject);
      disconnectedSocket.once("connect", () => {
        disconnectedSocket.write(
          [
            `POST ${usageSyncRequestTarget} HTTP/1.1`,
            "Host: viberacing.invalid",
            "Accept: application/json",
            "Content-Type: application/json",
            `Content-Length: ${String(Buffer.byteLength(body))}`,
            "",
            body,
          ].join("\r\n"),
          (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          },
        );
      });
    });
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
      expect(resolveDeferred).toBeTypeOf("function");
    });
    disconnectedSocket.destroy();
    await disconnected;
    resolveDeferred?.(successDecision());
    deferResponse = false;
    await new Promise<void>((resolve) => setImmediate(resolve));

    await expect(server.inject(postOptions())).resolves.toMatchObject({ statusCode: 200 });
  });

  it("replaces malformed HTTP framing with a generic client error", async () => {
    const execute = vi.fn(() => Promise.resolve(successDecision()));
    const server = buildServer(application(execute));
    const port = await listenOnLoopback(server);
    const response = await exchangeRaw(
      port,
      [
        `POST ${usageSyncRequestTarget} HTTP/1.1`,
        "Host: viberacing.invalid",
        "Connection: close",
        "Content-Type: application/json",
        "Content-Length: 2",
        "Content-Length: 3",
        "X-Attack: private-synthetic-detail",
        "",
        "{}",
      ].join("\r\n"),
    );

    expect(response).toContain("HTTP/1.1 400 Bad Request");
    expect(response).toContain("Content-Type: application/problem+json; charset=utf-8");
    expect(response).toContain('"errorCode":"invalid_request"');
    expect(response).not.toContain("private-synthetic-detail");
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts exactly 64 raw header pairs and rejects the 65th without truncation", async () => {
    const execute = vi.fn(() => Promise.resolve(successDecision()));
    const server = buildServer(application(execute));
    const port = await listenOnLoopback(server);
    const requestWithExtraHeaders = (extraHeaderCount: number): string => {
      const body = "{}";
      return [
        `POST ${usageSyncRequestTarget} HTTP/1.1`,
        "Host: viberacing.invalid",
        "Connection: close",
        "Accept: application/json",
        "Content-Type: application/json",
        `Content-Length: ${String(Buffer.byteLength(body))}`,
        ...Array.from(
          { length: extraHeaderCount },
          (_, index) => `X-Synthetic-${String(index).padStart(2, "0")}: value`,
        ),
        "",
        body,
      ].join("\r\n");
    };

    const boundary = await exchangeRaw(port, requestWithExtraHeaders(59));
    const exceeded = await exchangeRaw(port, requestWithExtraHeaders(60));

    expect(boundary).toContain("HTTP/1.1 200 OK");
    expect(exceeded).toContain("HTTP/1.1 400 Bad Request");
    expect(exceeded).toContain('"errorCode":"invalid_request"');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized raw header block through the generic client-error boundary", async () => {
    const execute = vi.fn(() => Promise.resolve(successDecision()));
    const server = buildServer(application(execute));
    const port = await listenOnLoopback(server);
    const response = await exchangeRaw(
      port,
      [
        `POST ${usageSyncRequestTarget} HTTP/1.1`,
        "Host: viberacing.invalid",
        "Connection: close",
        `X-Oversized: ${"a".repeat(communitySyncHttpPolicy.maximumHeaderBytes)}`,
        "",
        "",
      ].join("\r\n"),
    );

    expect(response).toContain("HTTP/1.1 400 Bad Request");
    expect(response).toContain('"errorCode":"invalid_request"');
    expect(execute).not.toHaveBeenCalled();
  });

  it("closes the socket when a transport problem cannot obtain a request ID", async () => {
    const entropy = vi.spyOn(crypto, "randomBytes") as unknown as RandomBytesSpy;
    entropy.mockImplementation(() => {
      throw new Error("synthetic entropy outage");
    });
    const server = buildServer(application(() => Promise.resolve(successDecision())));
    const port = await listenOnLoopback(server);

    const response = await exchangeRaw(
      port,
      [
        "GET /v1/community/unknown HTTP/1.1",
        "Host: viberacing.invalid",
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );

    expect(response).toBe("");
  });

  it("terminates a partial request through the socket receive deadline", async () => {
    const execute = vi.fn(() => Promise.resolve(successDecision()));
    const server = buildServer(application(execute));
    const port = await listenOnLoopback(server);
    server.server.requestTimeout = 50;
    server.server.headersTimeout = 50;
    server.server.setTimeout(100);

    const response = await exchangeRaw(
      port,
      [
        `POST ${usageSyncRequestTarget} HTTP/1.1`,
        "Host: viberacing.invalid",
        "Connection: close",
        "Accept: application/json",
        "Content-Type: application/json",
        "Content-Length: 100",
        "",
        "{",
      ].join("\r\n"),
    );

    expect(response).toBe("");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("Community sync client-error fallback", () => {
  it("writes one bounded no-store problem response", () => {
    const end = vi.fn();
    const destroy = vi.fn();
    writeCommunitySyncClientError({ destroy, end });

    expect(destroy).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
    const response = String(end.mock.calls[0]?.[0]);
    expect(response).toContain("HTTP/1.1 400 Bad Request");
    expect(response).toContain("Cache-Control: no-store");
    expect(response).toContain('"errorCode":"invalid_request"');
  });

  it("destroys the socket when serialization or writing cannot complete safely", () => {
    const destroyAfterWrite = vi.fn();
    writeCommunitySyncClientError({
      destroy: destroyAfterWrite,
      end: () => {
        throw new Error("synthetic write failure");
      },
    });
    expect(destroyAfterWrite).toHaveBeenCalledTimes(1);

    const destroyAfterEntropy = vi.fn();
    mockRandomBytesOnce(() => {
      throw new Error("synthetic entropy failure");
    });
    writeCommunitySyncClientError({ destroy: destroyAfterEntropy, end: vi.fn() });
    expect(destroyAfterEntropy).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong-sized, alternate, and hostile entropy values", () => {
    const firstEnd = vi.fn();
    mockRandomBytesOnce(() => new Uint8Array(16));
    writeCommunitySyncClientError({ destroy: vi.fn(), end: firstEnd });
    expect(firstEnd).toHaveBeenCalledTimes(1);

    const wrongSizeDestroy = vi.fn();
    mockRandomBytesOnce(() => Buffer.alloc(15));
    writeCommunitySyncClientError({ destroy: wrongSizeDestroy, end: vi.fn() });
    expect(wrongSizeDestroy).toHaveBeenCalledTimes(1);

    const hostileDestroy = vi.fn();
    mockRandomBytesOnce(() => new Proxy(new Uint8Array(16), {}));
    writeCommunitySyncClientError({ destroy: hostileDestroy, end: vi.fn() });
    expect(hostileDestroy).toHaveBeenCalledTimes(1);
  });
});
