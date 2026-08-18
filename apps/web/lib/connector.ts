import connectorPackage from "../../../packages/connector/package.json";

export const bundledConnectorVersion = connectorPackage.version;

export function connectorArchiveName(): string {
  return `viberacing-connector-${bundledConnectorVersion}.tgz`;
}
