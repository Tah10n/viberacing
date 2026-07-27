import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { describe, it } from "node:test";

import worker, { handleIngestEdgeRequest } from "../src/worker.mjs";

const requestTarget = "/v1/community/usage";
const originKeyId = "edge_staging";
const originKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
const originKeyBase64Url = originKey.toString("base64url");
const upstreamRequestId = "req_AQEBAQEBAQEBAQEBAQEBAQ";
const fixedNow = Date.parse("2026-07-26T12:34:56.789Z");

const configuredEnvironment = Object.freeze({
  VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL: originKeyBase64Url,
  VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID: originKeyId,
  VIBERACING_INGEST_ORIGIN_URL: "https://ingest.example.com",
});
const validEnvironment = Object.freeze({
  ...configuredEnvironment,
  VIBERACING_USAGE_SYNC_ENABLED: "true",
});

const validHeaders = Object.freeze({
  accept: "application/json",
  "content-type": "application/json",
  "idempotency-key": "syn_AAAAAAAAAAAAAAAAAAAAAA",
  "x-viberacing-device-id": "dev_AAAAAAAAAAAAAAAAAAAAAA",
  "x-viberacing-device-nonce": "AAAAAAAAAAAAAAAAAAAAAA",
  "x-viberacing-device-signature": "A".repeat(86),
  "x-viberacing-device-timestamp": "2026-07-26T12:34:56.000Z",
});

function createRequest(overrides = {}) {
  return new Request(overrides.url ?? `https://sync.example.com${requestTarget}`, {
    body: overrides.body ?? '{"schemaVersion":1}',
    headers: { ...validHeaders, ...overrides.headers },
    method: overrides.method ?? "POST",
  });
}

function createDependencies(fetchImplementation, seed = 1) {
  let call = 0;
  return Object.freeze({
    fetch: fetchImplementation,
    now: () => fixedNow,
    randomBytes(length) {
      call += 1;
      return new Uint8Array(length).fill(seed + call);
    },
  });
}

function customUpstreamResponse(
  body,
  {
    contentType = "application/json; charset=utf-8",
    headers: additionalHeaders = {},
    requestId = upstreamRequestId,
    status = 200,
  } = {},
) {
  return new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": contentType,
      "x-request-id": requestId,
      ...additionalHeaders,
    },
    status,
  });
}

function upstreamResponse(status = 200, contentType = "application/json; charset=utf-8") {
  return customUpstreamResponse(
    JSON.stringify({
      schemaVersion: 1,
      requestId: upstreamRequestId,
      syncId: "syn_AAAAAAAAAAAAAAAAAAAAAA",
      outcome: "accepted",
      acceptedEntries: 1,
    }),
    { contentType, status },
  );
}

async function readProblem(response) {
  const body = await response.json();
  assert.deepEqual(Object.keys(body), [
    "schemaVersion",
    "requestId",
    "status",
    "errorCode",
    "title",
    "retryable",
  ]);
  assert.match(body.requestId, /^req_[A-Za-z0-9_-]{22}$/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), body.requestId);
  return body;
}

describe("Cloudflare Community sync edge", () => {
  it("forwards the exact body with a valid fresh origin proof", async () => {
    const rawBody = '{"schemaVersion":1,"syncId":"syn_AAAAAAAAAAAAAAAAAAAAAA"}';
    let observedUrl;
    let observedOptions;
    const dependencies = createDependencies(async (url, options) => {
      observedUrl = url;
      observedOptions = options;
      return upstreamResponse();
    });

    const response = await handleIngestEdgeRequest(
      createRequest({ body: rawBody }),
      validEnvironment,
      dependencies,
    );

    assert.equal(response.status, 200);
    assert.equal(observedUrl, `https://ingest.example.com${requestTarget}`);
    assert.equal(observedOptions.method, "POST");
    assert.deepEqual(Buffer.from(observedOptions.body), Buffer.from(rawBody));
    assert.equal(observedOptions.headers.get("x-viberacing-origin-key-id"), originKeyId);
    assert.equal(
      observedOptions.headers.get("x-viberacing-origin-timestamp"),
      "2026-07-26T12:34:56.789Z",
    );
    assert.equal(
      observedOptions.headers.get("x-viberacing-origin-nonce"),
      Buffer.alloc(16, 3).toString("base64url"),
    );

    const bodyDigest = createHash("sha256").update(rawBody).digest("base64url");
    const message = [
      "viberacing-origin-proof-v1",
      originKeyId,
      "POST",
      requestTarget,
      bodyDigest,
      "2026-07-26T12:34:56.789Z",
      Buffer.alloc(16, 3).toString("base64url"),
    ].join("\n");
    assert.equal(
      observedOptions.headers.get("x-viberacing-origin-proof"),
      createHmac("sha256", originKey).update(message).digest("base64url"),
    );
    assert.equal(response.headers.get("x-request-id"), upstreamRequestId);
    assert.deepEqual(await response.json(), {
      schemaVersion: 1,
      requestId: upstreamRequestId,
      syncId: "syn_AAAAAAAAAAAAAAAAAAAAAA",
      outcome: "accepted",
      acceptedEntries: 1,
    });
  });

  it("keeps the sole Usage Sync route absent for every non-exact enablement shape", async () => {
    const inherited = Object.assign(
      Object.create({ VIBERACING_USAGE_SYNC_ENABLED: "true" }),
      configuredEnvironment,
    );
    const accessor = Object.defineProperty(
      { ...configuredEnvironment },
      "VIBERACING_USAGE_SYNC_ENABLED",
      {
        enumerable: true,
        get: () => "true",
      },
    );
    const nonEnumerable = Object.defineProperty(
      { ...configuredEnvironment },
      "VIBERACING_USAGE_SYNC_ENABLED",
      { enumerable: false, value: "true" },
    );
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("private environment value");
        },
        getOwnPropertyDescriptor() {
          throw new Error("private environment value");
        },
      },
    );

    for (const environment of [
      configuredEnvironment,
      { ...configuredEnvironment, VIBERACING_USAGE_SYNC_ENABLED: "false" },
      { ...configuredEnvironment, VIBERACING_USAGE_SYNC_ENABLED: "TRUE" },
      inherited,
      accessor,
      nonEnumerable,
      hostile,
    ]) {
      let fetchCalls = 0;
      const response = await handleIngestEdgeRequest(
        createRequest(),
        environment,
        createDependencies(async () => {
          fetchCalls += 1;
          return upstreamResponse();
        }),
      );
      assert.equal(response.status, 404);
      assert.equal((await readProblem(response)).errorCode, "not_found");
      assert.equal(fetchCalls, 0);
    }
  });

  it("does not reuse a decoded key after a binding rotation", async () => {
    const observedProofs = [];
    const fetchImplementation = async (_url, options) => {
      observedProofs.push(options.headers.get("x-viberacing-origin-proof"));
      return upstreamResponse();
    };
    await handleIngestEdgeRequest(
      createRequest(),
      validEnvironment,
      createDependencies(fetchImplementation, 4),
    );
    const rotatedKey = Buffer.alloc(32, 0x7f);
    await handleIngestEdgeRequest(
      createRequest(),
      {
        ...validEnvironment,
        VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL: rotatedKey.toString("base64url"),
      },
      createDependencies(fetchImplementation, 4),
    );
    assert.equal(observedProofs.length, 2);
    assert.notEqual(observedProofs[0], observedProofs[1]);
  });

  for (const [label, request, status, errorCode] of [
    ["unknown route", createRequest({ url: "https://sync.example.com/nope" }), 404, "not_found"],
    [
      "unreleased legacy route",
      createRequest({ url: "https://sync.example.com/v1/community/sync" }),
      404,
      "not_found",
    ],
    [
      "query string",
      createRequest({ url: "https://sync.example.com/v1/community/usage?x=1" }),
      404,
      "not_found",
    ],
    ["wrong method", createRequest({ body: undefined, method: "PUT" }), 405, "method_not_allowed"],
    [
      "wrong media type",
      createRequest({ headers: { "content-type": "text/plain" } }),
      400,
      "invalid_request",
    ],
    [
      "missing device header",
      createRequest({ headers: { "x-viberacing-device-id": "" } }),
      400,
      "invalid_request",
    ],
    [
      "inbound request ID",
      createRequest({ headers: { "x-request-id": upstreamRequestId } }),
      400,
      "invalid_request",
    ],
    [
      "inbound origin proof",
      createRequest({ headers: { "x-viberacing-origin-proof": "attacker" } }),
      400,
      "invalid_request",
    ],
  ]) {
    it(`rejects ${label} before upstream work`, async () => {
      let fetchCalls = 0;
      const response = await handleIngestEdgeRequest(
        request,
        validEnvironment,
        createDependencies(async () => {
          fetchCalls += 1;
          return upstreamResponse();
        }),
      );
      assert.equal(response.status, status);
      assert.equal((await readProblem(response)).errorCode, errorCode);
      assert.equal(fetchCalls, 0);
      if (status === 405) {
        assert.equal(response.headers.get("allow"), "POST");
      }
    });
  }

  it("rejects a body over the canonical transport limit", async () => {
    let fetchCalls = 0;
    const response = await handleIngestEdgeRequest(
      createRequest({ body: "x".repeat(8_193) }),
      validEnvironment,
      createDependencies(async () => {
        fetchCalls += 1;
        return upstreamResponse();
      }),
    );
    assert.equal(response.status, 400);
    assert.equal((await readProblem(response)).errorCode, "invalid_request");
    assert.equal(fetchCalls, 0);
  });

  for (const [label, environment] of [
    ["invalid key ID", { ...validEnvironment, VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID: "wrong" }],
    [
      "short key",
      {
        ...validEnvironment,
        VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL: Buffer.alloc(31).toString("base64url"),
      },
    ],
    [
      "cleartext origin",
      { ...validEnvironment, VIBERACING_INGEST_ORIGIN_URL: "http://ingest.example.com" },
    ],
    [
      "origin path",
      {
        ...validEnvironment,
        VIBERACING_INGEST_ORIGIN_URL: "https://ingest.example.com/private",
      },
    ],
    ["IP origin", { ...validEnvironment, VIBERACING_INGEST_ORIGIN_URL: "https://192.0.2.1" }],
  ]) {
    it(`fails closed for ${label}`, async () => {
      let fetchCalls = 0;
      const response = await handleIngestEdgeRequest(
        createRequest(),
        environment,
        createDependencies(async () => {
          fetchCalls += 1;
          return upstreamResponse();
        }),
      );
      assert.equal(response.status, 503);
      assert.equal((await readProblem(response)).errorCode, "temporarily_unavailable");
      assert.equal(fetchCalls, 0);
    });
  }

  it("relays only bounded exact upstream response contracts", async () => {
    const relayedProblem = await handleIngestEdgeRequest(
      createRequest(),
      validEnvironment,
      createDependencies(async () =>
        customUpstreamResponse(
          JSON.stringify({
            schemaVersion: 1,
            requestId: upstreamRequestId,
            status: 503,
            errorCode: "temporarily_unavailable",
            title: "Temporarily unavailable",
            retryable: true,
          }),
          {
            contentType: "application/problem+json; charset=utf-8",
            status: 503,
          },
        ),
      ),
    );
    assert.equal(relayedProblem.status, 503);
    const relayedProblemBody = await readProblem(relayedProblem);
    assert.equal(relayedProblemBody.requestId, upstreamRequestId);
    assert.equal(relayedProblemBody.errorCode, "temporarily_unavailable");

    const thrown = await handleIngestEdgeRequest(
      createRequest(),
      validEnvironment,
      createDependencies(async () => {
        throw new Error("private origin failure");
      }),
    );
    assert.equal(thrown.status, 503);
    assert.doesNotMatch(JSON.stringify(await readProblem(thrown)), /private origin failure/u);

    const invalidResponses = [
      () => upstreamResponse(200, "text/plain"),
      () => customUpstreamResponse("not-json"),
      () => customUpstreamResponse(new Uint8Array([0xc3, 0x28])),
      () =>
        customUpstreamResponse(
          JSON.stringify({
            schemaVersion: 1,
            requestId: upstreamRequestId,
            syncId: "syn_AAAAAAAAAAAAAAAAAAAAAA",
            outcome: "accepted",
            acceptedEntries: 1,
            internalDetail: "must not cross the edge",
          }),
        ),
      () =>
        customUpstreamResponse(
          JSON.stringify({
            schemaVersion: 1,
            requestId: "req_BBBBBBBBBBBBBBBBBBBBBB",
            syncId: "syn_AAAAAAAAAAAAAAAAAAAAAA",
            outcome: "accepted",
            acceptedEntries: 1,
          }),
        ),
      () => upstreamResponse(200, "application/problem+json; charset=utf-8"),
      () => upstreamResponse(201),
      () =>
        customUpstreamResponse(
          JSON.stringify({
            schemaVersion: 1,
            requestId: upstreamRequestId,
            status: 500,
            errorCode: "temporarily_unavailable",
            title: "Temporarily unavailable",
            retryable: true,
          }),
          {
            contentType: "application/problem+json; charset=utf-8",
            status: 500,
          },
        ),
      () =>
        customUpstreamResponse(
          JSON.stringify({
            schemaVersion: 1,
            requestId: upstreamRequestId,
            status: 405,
            errorCode: "method_not_allowed",
            title: "Method not allowed",
            retryable: false,
          }),
          {
            contentType: "application/problem+json; charset=utf-8",
            status: 405,
          },
        ),
      () => customUpstreamResponse(new Uint8Array(8_193).fill(0x20)),
      () =>
        customUpstreamResponse("{}", {
          headers: { "content-length": "8193" },
        }),
    ];

    for (const createInvalidResponse of invalidResponses) {
      const malformed = await handleIngestEdgeRequest(
        createRequest(),
        validEnvironment,
        createDependencies(async () => createInvalidResponse()),
      );
      assert.equal(malformed.status, 503);
      const body = await readProblem(malformed);
      assert.equal(body.errorCode, "temporarily_unavailable");
      assert.notEqual(body.requestId, upstreamRequestId);
    }
  });

  it("fails without inventing an identifier when entropy is unavailable", async () => {
    const response = await handleIngestEdgeRequest(createRequest(), validEnvironment, {
      fetch: async () => upstreamResponse(),
      now: () => fixedNow,
      randomBytes() {
        throw new Error("entropy failed");
      },
    });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("x-request-id"), null);
    assert.equal(await response.text(), "");
  });

  it("exposes only the module fetch handler", async () => {
    assert.deepEqual(Object.keys(worker), ["fetch"]);
    const response = await worker.fetch(createRequest(), {});
    assert.equal(response.status, 404);
  });
});
