import connectorPackage from "../../../packages/connector/package.json";

export const bundledConnectorVersion = connectorPackage.version;

export function connectorArchiveName(): string {
  return `viberacing-connector-${bundledConnectorVersion}.tgz`;
}

export function connectorUninstallCommand(origin: string): string {
  return `npx --yes --prefer-online --package ${origin}/downloads/${connectorArchiveName()} -- viberacing uninstall`;
}
