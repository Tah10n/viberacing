import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const ingestIndexUrl = pathToFileURL(resolve(root, "apps", "ingest", "dist", "index.js"));
const ingestProtocolUrl = pathToFileURL(resolve(root, "apps", "ingest", "dist", "protocol.js"));
const edgeWorkerUrl = pathToFileURL(resolve(root, "apps", "edge", "src", "worker.mjs"));

const { createCommunitySyncVerifier } = await import(ingestIndexUrl.href);
const {
  communitySyncMediaType,
  communitySyncMethod,
  createDeviceSignatureMessage,
  digestBody,
  usageSyncRequestTarget,
} = await import(ingestProtocolUrl.href);
const { handleIngestEdgeRequest } = await import(edgeWorkerUrl.href);

const nowMilliseconds = Date.parse("2026-07-26T12:34:56.789Z");
const deviceTimestamp = "2026-07-26T12:34:56.000Z";
const deviceId = "dev_AAAAAAAAAAAAAAAAAAAAAA";
const agentAccountId = "acc_BBBBBBBBBBBBBBBBBBBBBB";
const syncId = "syn_CCCCCCCCCCCCCCCCCCCCCC";
const deviceKeyId = "key_DDDDDDDDDDDDDDDDDDDDDD";
const installationId = "ins_EEEEEEEEEEEEEEEEEEEEEE";
const readerVersion = "codex_app_server_0_144_5_v1";
const originKeyId = "edge_staging";
const originKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
const deviceNonce = Buffer.alloc(16, 0x11).toString("base64url");
const upstreamRequestId = `req_${Buffer.alloc(16, 1).toString("base64url")}`;
const rateBindingNames = Object.freeze([
  "VIBERACING_USAGE_BYTE_BUDGET",
  "VIBERACING_USAGE_DEVICE_BURST",
  "VIBERACING_USAGE_DEVICE_SUSTAINED",
  "VIBERACING_USAGE_GLOBAL_BURST",
  "VIBERACING_USAGE_GLOBAL_SUSTAINED",
  "VIBERACING_USAGE_IP_BURST",
  "VIBERACING_USAGE_IP_SUSTAINED",
]);
const rateCalls = [];
const rateEnvironment = Object.fromEntries(
  rateBindingNames.map((name) => [
    name,
    Object.freeze({
      async limit(input) {
        rateCalls.push(Object.freeze({ key: input.key, name }));
        return { success: true };
      },
    }),
  ]),
);

const keyPair = generateKeyPairSync("ed25519");
const exportedPublicKey = keyPair.publicKey.export({ format: "der", type: "spki" });
assert(Buffer.isBuffer(exportedPublicKey));
const devicePublicKey = Buffer.from(exportedPublicKey.subarray(-32));
const body = Buffer.from(
  JSON.stringify({
    schemaVersion: 1,
    agentAccountId,
    syncId,
    observedAt: deviceTimestamp,
    clientVersion: "0.0.0",
    readerVersion,
    dailyEntries: [{ usageDate: "2026-07-26", dailyTokenTotal: "123" }],
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

const verifier = createCommunitySyncVerifier({
  now: () => nowMilliseconds,
  originKeys: [{ keyId: originKeyId, secret: Buffer.from(originKey) }],
  readDeviceVerificationMaterial(observedDeviceId) {
    assert.equal(observedDeviceId, deviceId);
    return {
      accountingRevision: 1,
      agentAccountId,
      deviceKeyId,
      identityAssurance: "community_local",
      installationId,
      maximumBackfillDays: 35,
      provider: "codex",
      publicKey: Buffer.from(devicePublicKey),
      readerVersion,
      scopeKind: "agent_account",
    };
  },
});

let verified;
let entropyCall = 0;
const response = await handleIngestEdgeRequest(
  new Request(`https://sync.example.com${usageSyncRequestTarget}`, {
    body,
    headers: {
      "cf-connecting-ip": "203.0.113.42",
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
    ...rateEnvironment,
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
assert.equal(verified.accountingRevision, 1);
assert.equal(verified.agentAccountId, agentAccountId);
assert.equal(verified.deviceId, deviceId);
assert.equal(verified.deviceKeyId, deviceKeyId);
assert.equal(verified.idempotencyKey, syncId);
assert.equal(verified.originKeyId, originKeyId);
assert.equal(verified.originExpiresAtMilliseconds, nowMilliseconds + 60_000);
assert.match(verified.originNonceDigestHex, /^[a-f0-9]{64}$/);
assert.equal(verified.payload.agentAccountId, agentAccountId);
assert.equal(verified.payload.readerVersion, readerVersion);
assert.deepEqual(verified.payload.dailyEntries, [
  { usageDate: "2026-07-26", dailyTokenTotal: "123" },
]);
assert.equal(verified.provider, "codex");
assert.equal(verified.scopeKind, "agent_account");
assert.equal(rateCalls.length, rateBindingNames.length);
assert.deepEqual(
  [...new Set(rateCalls.map(({ name }) => name))].sort(),
  [...rateBindingNames].sort(),
);
assert.equal(
  rateCalls.some(({ key }) => key.includes(deviceId) || key.includes("203.0.113")),
  false,
);

console.log(
  "Cloudflare rate/origin proof and final AgentAccount usage body are accepted by the production Ingest verifier.",
);
