import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("design system contracts", () => {
  const tokens = source("../styles/tokens.css");
  const components = source("../styles/components.css");
  const home = source("../styles/home.css");
  const responsive = source("../styles/responsive.css");
  const ui = source("./ui.tsx");

  it("defines semantic shell, layout, surface, and metadata tokens", () => {
    for (const token of [
      "--shell-header-height",
      "--shell-row-height",
      "--shell-inline-padding",
      "--page-gutter-wide",
      "--page-block-start",
      "--surface-padding",
      "--meta-font-size",
      "--meta-line-height",
      "--meta-label-weight",
      "--meta-value-weight",
    ]) {
      expect(tokens).toContain(`${token}:`);
    }
  });

  it("routes shared screens and the leaderboard through system primitives", () => {
    expect(ui).toContain('"page-shell"');
    expect(ui).toContain("meta-label");
    expect(components).toContain("var(--shell-header-height)");
    expect(components).toContain("var(--page-gutter-wide)");
    expect(components).toContain("var(--surface-padding)");
    expect(home).toContain("var(--shell-row-height)");
    expect(home).toContain("var(--shell-inline-padding)");
    expect(responsive).toContain("var(--shell-mobile-nav-height)");

    for (const page of [
      source("../dashboard/page.tsx"),
      source("../connect/page.tsx"),
      source("../u/[handle]/page.tsx"),
      source("../not-found.tsx"),
      source("../error.tsx"),
    ]) {
      expect(page).toContain("<PageShell");
    }
  });

  it("does not restore the retired one-off shell variables", () => {
    const systemStyles = `${components}\n${home}\n${responsive}`;
    expect(systemStyles).not.toContain("--header-height");
    expect(systemStyles).not.toContain("--hero-row-height");
  });
});
