import connectorPackage from "../../../packages/connector/package.json";

export const bundledConnectorVersion = connectorPackage.version;

export function connectorArchiveName(): string {
  return `viberacing-connector-${bundledConnectorVersion}.tgz`;
}

export function connectorUninstallCommand(origin: string): string {
  return `npx --allow-remote=all --yes --prefer-online --package ${origin}/downloads/viberacing-connector.tgz -- viberacing uninstall`;
}
