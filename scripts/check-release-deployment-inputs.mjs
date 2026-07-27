import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";

const exactBoolean = new Set(["false", "true"]);
const cloudflareAccountId = /^[a-f0-9]{32}$/;
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function isCanonicalPublicHttpsOrigin(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    return false;
  }
  if (value.trim() !== value) {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  const labels = parsed.hostname.split(".");
  return (
    parsed.protocol === "https:" &&
    parsed.origin === value &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.port === "" &&
    parsed.pathname === "/" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.hostname.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => dnsLabel.test(label)) &&
    isIP(parsed.hostname) === 0
  );
}

export function validateReleaseDeploymentInputs(environment) {
  const findings = [];
  if (!cloudflareAccountId.test(environment.CLOUDFLARE_ACCOUNT_ID ?? "")) {
    findings.push("CLOUDFLARE_ACCOUNT_ID must be one lowercase 32-character hexadecimal ID");
  }
  if (!isCanonicalPublicHttpsOrigin(environment.VIBERACING_PUBLIC_ORIGIN)) {
    findings.push("VIBERACING_PUBLIC_ORIGIN must be one canonical public HTTPS DNS origin");
  }
  if (!exactBoolean.has(environment.VIBERACING_USAGE_SYNC_ENABLED ?? "")) {
    findings.push("VIBERACING_USAGE_SYNC_ENABLED must be exact true or false");
  }
  return findings;
}

function main() {
  const findings = validateReleaseDeploymentInputs(process.env);
  if (findings.length > 0) {
    console.error("Release deployment inputs are invalid.");
    process.exit(1);
  }
  console.log("Release deployment inputs accepted.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
