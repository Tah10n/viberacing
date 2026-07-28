const syncMethod = "POST";
const usageSyncRequestTarget = "/v1/usage";
const syncMediaType = "application/json";
const maximumBodyBytes = 8_192;
const maximumUpstreamBodyBytes = 8_192;
const maximumHeaderValueCharacters = 256;
const upstreamTimeoutMilliseconds = 35_000;
const originMessagePrefix = "viberacing-origin-proof-v1";
const originKeyIdPattern = /^edge_[A-Za-z0-9_-]{1,22}$/;
const canonicalKeyPattern = /^[A-Za-z0-9_-]{43}$/;
const dnsNamePattern =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ipv4Pattern = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
const requestIdPattern = /^req_[A-Za-z0-9_-]{22}$/;
const syncIdPattern = /^syn_[A-Za-z0-9_-]{22}$/;
const canonicalMinuteTimestampPattern =
  /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:00\.000Z$/u;
const successUpstreamContentTypePattern = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const problemUpstreamContentTypePattern = /^application\/problem\+json(?:\s*;\s*charset=utf-8)?$/i;
const textEncoder = new TextEncoder();
const rateLimitBindingNames = Object.freeze({
  byteBudget: "VIBERACING_USAGE_BYTE_BUDGET",
  deviceBurst: "VIBERACING_USAGE_DEVICE_BURST",
  deviceSustained: "VIBERACING_USAGE_DEVICE_SUSTAINED",
  globalBurst: "VIBERACING_USAGE_GLOBAL_BURST",
  globalSustained: "VIBERACING_USAGE_GLOBAL_SUSTAINED",
  ipBurst: "VIBERACING_USAGE_IP_BURST",
  ipSustained: "VIBERACING_USAGE_IP_SUSTAINED",
});
const rateLimitBindingNameSet = new Set(Object.values(rateLimitBindingNames));
const byteBudgetUnitBytes = 1_024;

const deviceHeaderNames = Object.freeze([
  "idempotency-key",
  "x-viberacing-device-id",
  "x-viberacing-device-nonce",
  "x-viberacing-device-signature",
  "x-viberacing-device-timestamp",
]);
const forbiddenInboundHeaderNames = Object.freeze([
  "x-request-id",
  "x-viberacing-origin-key-id",
  "x-viberacing-origin-nonce",
  "x-viberacing-origin-proof",
  "x-viberacing-origin-timestamp",
]);
const requiredSyncResultKeys = Object.freeze(
  new Set(["schemaVersion", "requestId", "syncId", "outcome", "acceptedEntries"]),
);
const optionalSyncResultKeys = Object.freeze(new Set(["nextAllowedSyncAt", "recoveryAction"]));
const problemKeys = Object.freeze(
  new Set(["schemaVersion", "requestId", "status", "errorCode", "title", "retryable"]),
);
const syncOutcomes = Object.freeze(new Set(["accepted", "duplicate", "quarantined"]));

const problemDefinitions = Object.freeze({
  internal_error: Object.freeze({
    retryable: false,
    title: "Internal server error",
  }),
  invalid_request: Object.freeze({
    retryable: false,
    title: "Invalid request",
  }),
  rate_limited: Object.freeze({
    retryable: true,
    title: "Rate limited",
  }),
  method_not_allowed: Object.freeze({
    retryable: false,
    title: "Method not allowed",
  }),
  not_found: Object.freeze({
    retryable: false,
    title: "Not found",
  }),
  temporarily_unavailable: Object.freeze({
    retryable: true,
    title: "Temporarily unavailable",
  }),
});
const upstreamProblemDefinitions = Object.freeze({
  internal_error: Object.freeze({
    retryable: false,
    status: 500,
    title: "Internal server error",
  }),
  invalid_request: Object.freeze({
    retryable: false,
    status: 400,
    title: "Invalid request",
  }),
  method_not_allowed: Object.freeze({
    retryable: false,
    status: 405,
    title: "Method not allowed",
  }),
  not_acceptable: Object.freeze({
    retryable: false,
    status: 406,
    title: "Not acceptable",
  }),
  temporarily_unavailable: Object.freeze({
    retryable: true,
    status: 503,
    title: "Temporarily unavailable",
  }),
  unauthorized: Object.freeze({
    retryable: false,
    status: 401,
    title: "Unauthorized",
  }),
  validation_failed: Object.freeze({
    retryable: false,
    status: 422,
    title: "Validation failed",
  }),
});

class EdgeRequestError extends Error {
  constructor(status, errorCode, allow = undefined) {
    super("The edge request was rejected.");
    this.name = "EdgeRequestError";
    this.status = status;
    this.errorCode = errorCode;
    this.allow = allow;
  }
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeKey(value) {
  if (typeof value !== "string" || !canonicalKeyPattern.test(value)) {
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }
  const decoded = Uint8Array.from(
    atob(`${value.replaceAll("-", "+").replaceAll("_", "/")}=`),
    (character) => character.charCodeAt(0),
  );
  if (decoded.byteLength !== 32 || encodeBase64Url(decoded) !== value) {
    decoded.fill(0);
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }
  return decoded;
}

function usageSyncIsEnabled(environment) {
  try {
    if (environment === null || typeof environment !== "object" || Array.isArray(environment)) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      environment,
      "VIBERACING_USAGE_SYNC_ENABLED",
    );
    return (
      descriptor !== undefined &&
      "value" in descriptor &&
      descriptor.enumerable &&
      descriptor.value === "true"
    );
  } catch {
    return false;
  }
}

function readConfiguration(environment, requestTarget) {
  try {
    if (environment === null || typeof environment !== "object" || Array.isArray(environment)) {
      throw new EdgeRequestError(503, "temporarily_unavailable");
    }
    const keyId = environment.VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID;
    const originValue = environment.VIBERACING_INGEST_ORIGIN_URL;
    if (
      typeof keyId !== "string" ||
      !originKeyIdPattern.test(keyId) ||
      typeof originValue !== "string"
    ) {
      throw new EdgeRequestError(503, "temporarily_unavailable");
    }
    const origin = new URL(originValue);
    if (
      origin.protocol !== "https:" ||
      originValue !== origin.origin ||
      origin.username !== "" ||
      origin.password !== "" ||
      origin.port !== "" ||
      origin.pathname !== "/" ||
      origin.search !== "" ||
      origin.hash !== "" ||
      ipv4Pattern.test(origin.hostname) ||
      !dnsNamePattern.test(origin.hostname)
    ) {
      throw new EdgeRequestError(503, "temporarily_unavailable");
    }
    const key = decodeKey(environment.VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL);
    return Object.freeze({
      key,
      keyId,
      upstreamUrl: `${origin.origin}${requestTarget}`,
    });
  } catch (error) {
    if (error instanceof EdgeRequestError) {
      throw error;
    }
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }
}

function readRateLimitBindings(environment) {
  try {
    if (environment === null || typeof environment !== "object" || Array.isArray(environment)) {
      throw new EdgeRequestError(503, "temporarily_unavailable");
    }
    const bindings = Object.create(null);
    for (const name of rateLimitBindingNameSet) {
      const binding = environment[name];
      if (
        binding === null ||
        typeof binding !== "object" ||
        Array.isArray(binding) ||
        typeof binding.limit !== "function"
      ) {
        throw new EdgeRequestError(503, "temporarily_unavailable");
      }
      bindings[name] = binding;
    }
    return Object.freeze(bindings);
  } catch (error) {
    if (error instanceof EdgeRequestError) {
      throw error;
    }
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }
}

function createDefaultDependencies() {
  return Object.freeze({
    fetch: globalThis.fetch.bind(globalThis),
    now: () => Date.now(),
    randomBytes(length) {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      return bytes;
    },
  });
}

function createRequestId(dependencies) {
  const bytes = dependencies.randomBytes(16);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 16) {
    throw new Error("Entropy is unavailable.");
  }
  return `req_${encodeBase64Url(bytes)}`;
}

function createProblem(requestId, status, errorCode, allow = undefined) {
  const definition = problemDefinitions[errorCode];
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/problem+json; charset=utf-8",
    vary: "Accept",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
  });
  if (allow !== undefined) {
    headers.set("allow", allow);
  }
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      requestId,
      status,
      errorCode,
      title: definition.title,
      retryable: definition.retryable,
    }),
    { headers, status },
  );
}

function hasExactKeys(value, expectedKeys) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expectedKeys.size &&
    keys.every((key) => typeof key === "string" && expectedKeys.has(key))
  );
}

function readIpv4Prefix(value) {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return undefined;
  }
  const octets = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(part)) {
      return undefined;
    }
    const octet = Number(part);
    if (octet > 255) {
      return undefined;
    }
    octets.push(octet);
  }
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

function readIpv6Prefix(value) {
  if (
    value.length < 2 ||
    value.length > 45 ||
    !/^[0-9A-Fa-f:]+$/u.test(value) ||
    value.includes(":::")
  ) {
    return undefined;
  }
  const halves = value.split("::");
  if (halves.length > 2) {
    return undefined;
  }
  const left = halves[0] === "" ? [] : halves[0].split(":");
  const right = halves.length === 1 || halves[1] === "" ? [] : halves[1].split(":");
  if (
    [...left, ...right].some((part) => !/^[0-9A-Fa-f]{1,4}$/u.test(part)) ||
    (halves.length === 1 && left.length !== 8) ||
    (halves.length === 2 && left.length + right.length >= 8)
  ) {
    return undefined;
  }
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) {
    return undefined;
  }
  return `${groups
    .slice(0, 4)
    .map((part) => Number.parseInt(part, 16).toString(16))
    .join(":")}::/64`;
}

function readClientPrefix(request) {
  const value = request.headers.get("cf-connecting-ip");
  if (value === null || value.length > 45 || value.includes(",")) {
    throw new EdgeRequestError(400, "invalid_request");
  }
  const prefix = value.includes(":") ? readIpv6Prefix(value) : readIpv4Prefix(value);
  if (prefix === undefined) {
    throw new EdgeRequestError(400, "invalid_request");
  }
  return prefix;
}

async function hashRateKey(domain, value) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(`${domain}\0${value}`));
  return encodeBase64Url(new Uint8Array(digest));
}

async function consumeRateToken(binding, key) {
  let result;
  try {
    result = await binding.limit({ key });
  } catch {
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }
  if (!hasExactKeys(result, new Set(["success"])) || typeof result.success !== "boolean") {
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }
  if (!result.success) {
    throw new EdgeRequestError(429, "rate_limited");
  }
}

async function enforceRateLimits(request, environment, bodyBytes) {
  const bindings = readRateLimitBindings(environment);
  const routeKey = `route:${usageSyncRequestTarget}`;
  const clientPrefix = readClientPrefix(request);
  const deviceId = request.headers.get("x-viberacing-device-id");
  if (deviceId === null) {
    throw new EdgeRequestError(400, "invalid_request");
  }
  const deviceKey = await hashRateKey("viberacing-rate-device-v1", deviceId);
  const prefixKey = await hashRateKey("viberacing-rate-prefix-v1", clientPrefix);

  await consumeRateToken(bindings[rateLimitBindingNames.globalBurst], routeKey);
  await consumeRateToken(bindings[rateLimitBindingNames.globalSustained], routeKey);
  await consumeRateToken(bindings[rateLimitBindingNames.ipBurst], prefixKey);
  await consumeRateToken(bindings[rateLimitBindingNames.ipSustained], prefixKey);
  await consumeRateToken(bindings[rateLimitBindingNames.deviceBurst], deviceKey);
  await consumeRateToken(bindings[rateLimitBindingNames.deviceSustained], deviceKey);
  const byteTokens = Math.max(1, Math.ceil(bodyBytes / byteBudgetUnitBytes));
  for (let index = 0; index < byteTokens; index += 1) {
    await consumeRateToken(bindings[rateLimitBindingNames.byteBudget], routeKey);
  }
}

function isCanonicalMinuteTimestamp(value) {
  if (typeof value !== "string" || !canonicalMinuteTimestampPattern.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isValidSyncResult(value, upstreamRequestId) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  return (
    keys.every(
      (key) =>
        typeof key === "string" &&
        (requiredSyncResultKeys.has(key) || optionalSyncResultKeys.has(key)),
    ) &&
    [...requiredSyncResultKeys].every((key) => keys.includes(key)) &&
    value.schemaVersion === 1 &&
    value.requestId === upstreamRequestId &&
    requestIdPattern.test(value.requestId) &&
    typeof value.syncId === "string" &&
    syncIdPattern.test(value.syncId) &&
    typeof value.outcome === "string" &&
    syncOutcomes.has(value.outcome) &&
    Number.isInteger(value.acceptedEntries) &&
    value.acceptedEntries >= 0 &&
    value.acceptedEntries <= 31 &&
    (value.nextAllowedSyncAt === undefined ||
      isCanonicalMinuteTimestamp(value.nextAllowedSyncAt)) &&
    (value.recoveryAction === undefined ||
      value.recoveryAction === "update_connector" ||
      value.recoveryAction === "reconnect_account" ||
      value.recoveryAction === "contact_support" ||
      value.recoveryAction === "retry_later")
  );
}

function isValidProblem(value, status, upstreamRequestId) {
  if (
    !hasExactKeys(value, problemKeys) ||
    value.schemaVersion !== 1 ||
    value.requestId !== upstreamRequestId ||
    !requestIdPattern.test(value.requestId) ||
    typeof value.errorCode !== "string" ||
    !Object.hasOwn(upstreamProblemDefinitions, value.errorCode)
  ) {
    return false;
  }
  const definition = upstreamProblemDefinitions[value.errorCode];
  return (
    status === definition.status &&
    value.status === definition.status &&
    value.title === definition.title &&
    value.retryable === definition.retryable
  );
}

function validateRequest(request, environment) {
  const url = new URL(request.url);
  if (url.search !== "") {
    throw new EdgeRequestError(404, "not_found");
  }
  const requestTarget = url.pathname;
  if (requestTarget !== usageSyncRequestTarget || !usageSyncIsEnabled(environment)) {
    throw new EdgeRequestError(404, "not_found");
  }
  if (request.method !== syncMethod) {
    throw new EdgeRequestError(405, "method_not_allowed", syncMethod);
  }
  if (request.headers.get("content-type") !== syncMediaType) {
    throw new EdgeRequestError(400, "invalid_request");
  }
  if (request.headers.has("content-encoding")) {
    throw new EdgeRequestError(400, "invalid_request");
  }
  for (const headerName of forbiddenInboundHeaderNames) {
    if (request.headers.has(headerName)) {
      throw new EdgeRequestError(400, "invalid_request");
    }
  }
  for (const headerName of deviceHeaderNames) {
    const value = request.headers.get(headerName);
    if (
      value === null ||
      value.length < 1 ||
      value.length > maximumHeaderValueCharacters ||
      value.includes(",")
    ) {
      throw new EdgeRequestError(400, "invalid_request");
    }
  }
  const accept = request.headers.get("accept");
  if (accept !== null && accept.length > maximumHeaderValueCharacters) {
    throw new EdgeRequestError(400, "invalid_request");
  }
  return requestTarget;
}

async function readBoundedBody(request) {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]{0,4})$/u.test(declaredLength) || Number(declaredLength) > maximumBodyBytes)
  ) {
    throw new EdgeRequestError(400, "invalid_request");
  }
  if (request.body === null) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    if (!(result.value instanceof Uint8Array)) {
      await reader.cancel();
      throw new EdgeRequestError(400, "invalid_request");
    }
    totalBytes += result.value.byteLength;
    if (totalBytes > maximumBodyBytes) {
      await reader.cancel();
      throw new EdgeRequestError(400, "invalid_request");
    }
    chunks.push(result.value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function createOriginHeaders(configuration, body, dependencies, requestTarget) {
  const timestampMilliseconds = dependencies.now();
  if (!Number.isSafeInteger(timestampMilliseconds) || timestampMilliseconds < 0) {
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }
  const nonceBytes = dependencies.randomBytes(16);
  if (!(nonceBytes instanceof Uint8Array) || nonceBytes.byteLength !== 16) {
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }
  const timestamp = new Date(timestampMilliseconds).toISOString();
  const nonce = encodeBase64Url(nonceBytes);
  const bodyDigest = encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
  const message = textEncoder.encode(
    [
      originMessagePrefix,
      configuration.keyId,
      syncMethod,
      requestTarget,
      bodyDigest,
      timestamp,
      nonce,
    ].join("\n"),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    configuration.key,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const proof = encodeBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, message)));
  return Object.freeze({
    keyId: configuration.keyId,
    nonce,
    proof,
    timestamp,
  });
}

function createUpstreamHeaders(request, originHeaders) {
  const headers = new Headers({ "content-type": syncMediaType });
  for (const headerName of deviceHeaderNames) {
    headers.set(headerName, request.headers.get(headerName));
  }
  const accept = request.headers.get("accept");
  if (accept !== null) {
    headers.set("accept", accept);
  }
  headers.set("x-viberacing-origin-key-id", originHeaders.keyId);
  headers.set("x-viberacing-origin-nonce", originHeaders.nonce);
  headers.set("x-viberacing-origin-proof", originHeaders.proof);
  headers.set("x-viberacing-origin-timestamp", originHeaders.timestamp);
  return headers;
}

async function readBoundedUpstreamBody(response) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]{0,4})$/u.test(declaredLength) ||
      Number(declaredLength) > maximumUpstreamBodyBytes)
  ) {
    await response.body?.cancel();
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }
  if (response.body === null) {
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    if (!(result.value instanceof Uint8Array)) {
      await reader.cancel();
      throw new EdgeRequestError(503, "temporarily_unavailable");
    }
    totalBytes += result.value.byteLength;
    if (totalBytes > maximumUpstreamBodyBytes) {
      await reader.cancel();
      throw new EdgeRequestError(503, "temporarily_unavailable");
    }
    chunks.push(result.value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseUpstreamJson(body) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }
}

async function relayUpstreamResponse(response) {
  const contentType = response.headers.get("content-type");
  const success = response.status === 200;
  if (
    contentType === null ||
    (success
      ? !successUpstreamContentTypePattern.test(contentType)
      : response.status < 400 ||
        response.status > 599 ||
        !problemUpstreamContentTypePattern.test(contentType))
  ) {
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }
  const upstreamRequestId = response.headers.get("x-request-id");
  if (upstreamRequestId === null || !requestIdPattern.test(upstreamRequestId)) {
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }

  const body = await readBoundedUpstreamBody(response);
  const parsedBody = parseUpstreamJson(body);
  if (
    (success && !isValidSyncResult(parsedBody, upstreamRequestId)) ||
    (!success && !isValidProblem(parsedBody, response.status, upstreamRequestId))
  ) {
    throw new EdgeRequestError(503, "temporarily_unavailable");
  }

  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": success
      ? "application/json; charset=utf-8"
      : "application/problem+json; charset=utf-8",
    vary: "Accept",
    "x-content-type-options": "nosniff",
    "x-request-id": upstreamRequestId,
  });
  if (response.status === 405) {
    if (response.headers.get("allow") !== syncMethod) {
      throw new EdgeRequestError(503, "temporarily_unavailable");
    }
    headers.set("allow", syncMethod);
  }
  return new Response(body, { headers, status: response.status });
}

export async function handleIngestEdgeRequest(
  request,
  environment,
  dependencies = createDefaultDependencies(),
) {
  let requestId;
  try {
    requestId = createRequestId(dependencies);
  } catch {
    return new Response(null, {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
      status: 500,
    });
  }

  try {
    if (!(request instanceof Request)) {
      throw new EdgeRequestError(400, "invalid_request");
    }
    const requestTarget = validateRequest(request, environment);
    const body = await readBoundedBody(request);
    await enforceRateLimits(request, environment, body.byteLength);
    const configuration = readConfiguration(environment, requestTarget);
    try {
      const originHeaders = await createOriginHeaders(
        configuration,
        body,
        dependencies,
        requestTarget,
      );
      const upstreamResponse = await dependencies.fetch(configuration.upstreamUrl, {
        body,
        headers: createUpstreamHeaders(request, originHeaders),
        method: syncMethod,
        redirect: "manual",
        signal: AbortSignal.timeout(upstreamTimeoutMilliseconds),
      });
      if (!(upstreamResponse instanceof Response)) {
        throw new EdgeRequestError(503, "temporarily_unavailable");
      }
      return await relayUpstreamResponse(upstreamResponse);
    } finally {
      configuration.key.fill(0);
    }
  } catch (error) {
    const failure =
      error instanceof EdgeRequestError
        ? error
        : new EdgeRequestError(503, "temporarily_unavailable");
    return createProblem(requestId, failure.status, failure.errorCode, failure.allow);
  }
}

export default {
  fetch(request, environment) {
    return handleIngestEdgeRequest(request, environment);
  },
};
