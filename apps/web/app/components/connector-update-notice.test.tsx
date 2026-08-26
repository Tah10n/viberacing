import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectorUpdateNotice } from "./connector-update-notice";

describe("connector update notice", () => {
  const command = "npx --yes @viberacing/connector@latest doctor --repair";

  it("renders the configured compatibility floor and shared repair command", () => {
    const markup = renderToStaticMarkup(
      <ConnectorUpdateNotice command={command} minimumVersion="0.4.3" scope="computer" />,
    );

    expect(markup).toContain('aria-label="Connector update required"');
    expect(markup).toContain("Connector 0.4.3 or newer and the current Browser Sync handler");
    expect(markup).toContain(command);
    expect(markup).toContain("on this computer");
    expect(markup).not.toContain("connector-update-prominent");
  });

  it("makes the signed-in home notice prominent and covers every affected computer", () => {
    const markup = renderToStaticMarkup(
      <ConnectorUpdateNotice command={command} minimumVersion="0.4.3" scope="computers" />,
    );

    expect(markup).toContain("connector-update-prominent");
    expect(markup).toContain("on each affected computer");
    expect(markup).toContain("Copy update command");
  });
});
