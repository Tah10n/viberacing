import "server-only";

import { isIP } from "node:net";

const developmentFallback = "http://localhost:3000";
const productionFallback = "https://viberacing.example";
const maximumOriginLength = 256;
const domainPattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function invalidOrigin(reason: string): never {
  throw new Error(`VIBERACING_PUBLIC_ORIGIN ${reason}.`);
}

export function parsePublicOrigin(value: string): URL {
  if (value.length === 0 || value.length > maximumOriginLength || value !== value.trim()) {
    invalidOrigin("must be a non-empty, trimmed origin no longer than 256 characters");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalidOrigin("must be an absolute URL");
  }

  if (url.username || url.password) {
    invalidOrigin("must not contain credentials");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    invalidOrigin("must not contain a path, query, or fragment");
  }

  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol === "http:") {
    if (!loopback) {
      invalidOrigin("may use HTTP only for loopback development");
    }
  } else if (url.protocol === "https:") {
    if (url.port) {
      invalidOrigin("must not use a non-default HTTPS port");
    }
    if (isIP(url.hostname) !== 0 || !domainPattern.test(url.hostname)) {
      invalidOrigin("must use a DNS hostname for HTTPS");
    }
  } else {
    invalidOrigin("must use HTTPS, or HTTP on loopback during development");
  }

  return new URL(url.origin);
}

export function resolvePublicOrigin(
  configuredValue = process.env.VIBERACING_PUBLIC_ORIGIN,
  nodeEnvironment = process.env.NODE_ENV,
): URL {
  return parsePublicOrigin(
    configuredValue ??
      (nodeEnvironment === "production" ? productionFallback : developmentFallback),
  );
}
