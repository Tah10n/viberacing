import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const ingestIndexUrl = pathToFileURL(resolve(root, "apps", "ingest", "dist", "index.js"));
const ingestProtocolUrl = pathToFileURL(resolve(root, "apps", "ingest", "dist", "protocol.js"));
const ingestVerifierUrl = pathToFileURL(
  resolve(root, "apps", "ingest", "dist", "community-sync-verifier.js"),
);
const edgeWorkerUrl = pathToFileURL(resolve(root, "apps", "edge", "src", "worker.mjs"));

const { createCommunitySyncVerifier } = await import(ingestIndexUrl.href);
const { codexAccountingRevision, codexProvider } = await import(ingestVerifierUrl.href);
const {
  communitySyncMediaType,
  communitySyncMethod,
  createDeviceSignatureMessage,
  digestBody,
  headerNames,
  usageSyncRequestTarget,
} = await import(ingestProtocolUrl.href);
const { handleIngestEdgeRequest } = await import(edgeWorkerUrl.href);

const nowMilliseconds = Date.parse("2026-07-26T12:34:56.789Z");
const deviceTimestamp = "2026-07-26T12:34:56.000Z";
const deviceId = "dev_AAAAAAAAAAAAAAAAAAAAAA";
const sourceId = "src_BBBBBBBBBBBBBBBBBBBBBB";
const syncId = "syn_CCCCCCCCCCCCCCCCCCCCCC";
const deviceKeyId = "11111111-2222-4333-8444-555555555555";
const originKeyId = "edge_staging";
const originKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
const deviceNonce = Buffer.alloc(16, 0x11).toString("base64url");
const upstreamRequestId = `req_${Buffer.alloc(16, 1).toString("base64url")}`;
const keyPair = generateKeyPairSync("ed25519");
const exportedPublicKey = keyPair.publicKey.export({ format: "der", type: "spki" });
assert(Buffer.isBuffer(exportedPublicKey));
const devicePublicKey = Buffer.from(exportedPublicKey.subarray(-32));
const body = Buffer.from(
  JSON.stringify({
    schemaVersion: 1,
    sourceId,
    syncId,
    observedAt: deviceTimestamp,
    clientVersion: "0.0.0",
    agentVersion: "0.144.5",
    dailyEntries: [{ reportedDate: "2026-07-26", dailyTokenTotal: 123 }],
  }),
  "utf8",
);
const signature = sign(
  null,
  createDeviceSignatureMessage({
    bodyDigestBase64Url: digestBody(body).base64Url,
    deviceId,
    idempotencyKey: syncId,
    nonce: deviceNonce,
    requestTarget: usageSyncRequestTarget,
    timestamp: deviceTimestamp,
  }),
  keyPair.privateKey,
).toString("base64url");

const consumedOriginNonces = [];
const verifier = createCommunitySyncVerifier({
  consumeOriginNonce(input) {
    consumedOriginNonces.push(input);
    return true;
  },
  now: () => nowMilliseconds,
  originKeys: [{ keyId: originKeyId, secret: Buffer.from(originKey) }],
  readDeviceVerificationMaterial(observedDeviceId) {
    assert.equal(observedDeviceId, deviceId);
    return {
      accountingRevision: codexAccountingRevision,
      deviceKeyId,
      provider: codexProvider,
      publicKey: Buffer.from(devicePublicKey),
      sourceId,
    };
  },
});

let verified;
let entropyCall = 0;
const response = await handleIngestEdgeRequest(
  new Request(`https://sync.example.com${usageSyncRequestTarget}`, {
    body,
    headers: {
      "content-type": communitySyncMediaType,
      "idempotency-key": syncId,
      "x-viberacing-device-id": deviceId,
      "x-viberacing-device-nonce": deviceNonce,
      "x-viberacing-device-signature": signature,
      "x-viberacing-device-timestamp": deviceTimestamp,
    },
    method: communitySyncMethod,
  }),
  {
    VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL: originKey.toString("base64url"),
    VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID: originKeyId,
    VIBERACING_INGEST_ORIGIN_URL: "https://ingest.example.com",
    VIBERACING_USAGE_SYNC_ENABLED: "true",
  },
  {
    async fetch(url, options) {
      assert.equal(url, `https://ingest.example.com${usageSyncRequestTarget}`);
      assert.equal(options.method, communitySyncMethod);
      assert.deepEqual(Buffer.from(options.body), body);
      const rawHeaders = [];
      for (const [name, value] of options.headers.entries()) {
        rawHeaders.push(name, value);
      }
      verified = await verifier.verify({
        method: options.method,
        rawBody: Buffer.from(options.body),
        rawHeaders,
        requestTarget: usageSyncRequestTarget,
      });
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          requestId: upstreamRequestId,
          syncId,
          outcome: "accepted",
          acceptedEntries: 1,
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-request-id": upstreamRequestId,
          },
          status: 200,
        },
      );
    },
    now: () => nowMilliseconds,
    randomBytes(length) {
      entropyCall += 1;
      return new Uint8Array(length).fill(entropyCall);
    },
  },
);

assert.equal(response.status, 200);
assert.equal(response.headers.get("x-request-id"), upstreamRequestId);
assert.deepEqual(await response.json(), {
  schemaVersion: 1,
  requestId: upstreamRequestId,
  syncId,
  outcome: "accepted",
  acceptedEntries: 1,
});
assert.equal(verified.deviceId, deviceId);
assert.equal(verified.deviceKeyId, deviceKeyId);
assert.equal(verified.idempotencyKey, syncId);
assert.equal(verified.payload.sourceId, sourceId);
assert.equal(verified.payload.dailyEntries.length, 1);
assert.equal(consumedOriginNonces.length, 1);
assert.equal(consumedOriginNonces[0].keyId, originKeyId);
assert.equal(consumedOriginNonces[0].expiresAtMilliseconds, nowMilliseconds + 60_000);

console.log("Cloudflare edge proof is accepted by the production Ingest verifier.");
