import { describe, expect, it } from "vitest";
import { connectorUninstallCommand } from "./connector";

describe("connector commands", () => {
  it("uses the stable connector archive for a command that may run after a later release", () => {
    expect(connectorUninstallCommand("https://viberacing.example")).toBe(
      "npx --yes --prefer-online --package https://viberacing.example/downloads/viberacing-connector.tgz -- viberacing uninstall",
    );
  });
});
