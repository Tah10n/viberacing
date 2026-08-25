import connectorPackage from "../../../packages/connector/package.json";
import { connectorDistribution } from "./config";

export const bundledConnectorVersion = connectorPackage.version;
export const connectorNpmPackage = "@viberacing/connector";

const archiveNpxPrefix = "npx --allow-remote=all --yes --prefer-online --package";
const npmNpxPrefix = `npx --yes ${connectorNpmPackage}@latest`;

export function connectorArchiveName(): string {
  return `viberacing-connector-${bundledConnectorVersion}.tgz`;
}

function commandOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw Object.assign(new Error("Connector command requires a canonical public origin"), {
      code: "CONNECTOR_COMMAND_ORIGIN_INVALID",
    });
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  const shellSafeOrigin = /^https?:\/\/(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::\d+)?$/.test(
    parsed.origin,
  );
  if (
    parsed.origin !== origin ||
    !shellSafeOrigin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (parsed.protocol !== "https:" && (parsed.protocol !== "http:" || !loopback))
  ) {
    throw Object.assign(new Error("Connector command requires a canonical public origin"), {
      code: "CONNECTOR_COMMAND_ORIGIN_INVALID",
    });
  }
  return parsed.origin;
}

function archiveCommand(origin: string, archive: string, command: string): string {
  return `${archiveNpxPrefix} ${origin}/downloads/${archive} -- viberacing ${command}`;
}

export function connectorConnectCommand(origin: string): string {
  const safeOrigin = commandOrigin(origin);
  return connectorDistribution() === "npm"
    ? `${npmNpxPrefix} connect --origin ${safeOrigin}`
    : archiveCommand(safeOrigin, connectorArchiveName(), `connect --origin ${safeOrigin}`);
}

export function connectorRepairCommand(origin: string): string {
  const safeOrigin = commandOrigin(origin);
  return connectorDistribution() === "npm"
    ? `${npmNpxPrefix} doctor --repair`
    : archiveCommand(safeOrigin, connectorArchiveName(), "doctor --repair");
}

export function connectorUninstallCommand(origin: string): string {
  const safeOrigin = commandOrigin(origin);
  return connectorDistribution() === "npm"
    ? `${npmNpxPrefix} uninstall`
    : archiveCommand(safeOrigin, "viberacing-connector.tgz", "uninstall");
}
