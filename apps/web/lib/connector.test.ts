import { afterEach, describe, expect, it } from "vitest";
import {
  bundledConnectorVersion,
  connectorConnectCommand,
  connectorNpmPackage,
  connectorRepairCommand,
  connectorUninstallCommand,
} from "./connector";

const originalDistribution = process.env.VIBERACING_CONNECTOR_DISTRIBUTION;

afterEach(() => {
  if (originalDistribution === undefined) {
    delete process.env.VIBERACING_CONNECTOR_DISTRIBUTION;
  } else {
    process.env.VIBERACING_CONNECTOR_DISTRIBUTION = originalDistribution;
  }
});

describe("connector commands", () => {
  const origin = "https://viberacing.example";

  it("uses the fixed latest npm package for connect, repair, and uninstall", () => {
    process.env.VIBERACING_CONNECTOR_DISTRIBUTION = "npm";

    expect(connectorNpmPackage).toBe("@viberacing/connector");
    expect(connectorConnectCommand(origin)).toBe(
      "npx --yes @viberacing/connector@latest connect --origin https://viberacing.example",
    );
    expect(connectorRepairCommand(origin)).toBe(
      "npx --yes @viberacing/connector@latest doctor --repair",
    );
    expect(connectorUninstallCommand(origin)).toBe(
      "npx --yes @viberacing/connector@latest uninstall",
    );
  });

  it("never advertises a concrete, next, or remote-package npm version", () => {
    process.env.VIBERACING_CONNECTOR_DISTRIBUTION = "npm";

    for (const command of [
      connectorConnectCommand(origin),
      connectorRepairCommand(origin),
      connectorUninstallCommand(origin),
    ]) {
      expect(command).toContain("@viberacing/connector@latest");
      expect(command).not.toContain(`@viberacing/connector@${bundledConnectorVersion}`);
      expect(command).not.toContain("@next");
      expect(command).not.toContain("--package");
      expect(command).not.toContain("--allow-remote");
      expect(command).not.toContain("downloads/");
      expect(command).not.toContain("-- viberacing");
    }
  });

  it("keeps the versioned same-origin archive fallback for connect and repair", () => {
    process.env.VIBERACING_CONNECTOR_DISTRIBUTION = "archive";
    const archive = `${origin}/downloads/viberacing-connector-${bundledConnectorVersion}.tgz`;

    expect(connectorConnectCommand(origin)).toBe(
      `npx --allow-remote=all --yes --prefer-online --package ${archive} -- viberacing connect --origin ${origin}`,
    );
    expect(connectorRepairCommand(origin)).toBe(
      `npx --allow-remote=all --yes --prefer-online --package ${archive} -- viberacing doctor --repair`,
    );
  });

  it("keeps the stable same-origin archive fallback for uninstall", () => {
    delete process.env.VIBERACING_CONNECTOR_DISTRIBUTION;
    expect(connectorUninstallCommand(origin)).toBe(
      `npx --allow-remote=all --yes --prefer-online --package ${origin}/downloads/viberacing-connector.tgz -- viberacing uninstall`,
    );
  });

  it("rejects non-canonical or injectable origins in every distribution", () => {
    for (const distribution of ["npm", "archive"] as const) {
      process.env.VIBERACING_CONNECTOR_DISTRIBUTION = distribution;
      for (const unsafeOrigin of [
        "https://viberacing.example/$(touch-pwned)",
        "https://viberacing.example;echo-pwned",
        "https://viberacing.example\n--flag",
        "http://public.example",
        "https://user:secret@viberacing.example",
      ]) {
        for (const command of [
          connectorConnectCommand,
          connectorRepairCommand,
          connectorUninstallCommand,
        ]) {
          expect(() => command(unsafeOrigin)).toThrow(
            expect.objectContaining({ code: "CONNECTOR_COMMAND_ORIGIN_INVALID" }),
          );
        }
      }
    }
  });

  it("rejects command fragments in the distribution setting", () => {
    process.env.VIBERACING_CONNECTOR_DISTRIBUTION = "npm; echo pwned";
    expect(() => connectorConnectCommand(origin)).toThrow(
      expect.objectContaining({ code: "CONFIG_CONNECTOR_DISTRIBUTION_INVALID" }),
    );
  });
});
