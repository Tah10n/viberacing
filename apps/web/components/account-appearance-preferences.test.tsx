import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { AccountAppearancePreferences } from "./account-appearance-preferences";

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("AccountAppearancePreferences", () => {
  it("reads and writes only the existing device-local theme and motion keys", async () => {
    localStorage.setItem("viberacing.theme", "classic-grand-prix");
    localStorage.setItem("viberacing.motion", "off");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AccountAppearancePreferences locale="en" />);
      await Promise.resolve();
    });
    const selects = container.querySelectorAll("select");
    expect(selects).toHaveLength(2);
    expect(selects[0]?.value).toBe("classic-grand-prix");
    expect(selects[1]?.value).toBe("off");

    await act(async () => {
      const theme = selects[0];
      const motion = selects[1];
      if (theme === undefined || motion === undefined) {
        throw new Error("expected preference controls");
      }
      theme.value = "cyber-rally";
      theme.dispatchEvent(new Event("change", { bubbles: true }));
      motion.value = "on";
      motion.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(localStorage.getItem("viberacing.theme")).toBe("cyber-rally");
    expect(localStorage.getItem("viberacing.motion")).toBe("on");
    expect(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)),
    ).toEqual(["viberacing.theme", "viberacing.motion"]);
    act(() => {
      root.unmount();
    });
  });

  it("falls back to privacy-safe defaults when stored values are outside the closed sets", async () => {
    localStorage.setItem("viberacing.theme", "remote-theme");
    localStorage.setItem("viberacing.motion", "always");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AccountAppearancePreferences locale="ru" />);
      await Promise.resolve();
    });
    const selects = container.querySelectorAll("select");
    expect(selects[0]?.value).toBe("neon-night");
    expect(selects[1]?.value).toBe("system");
    expect(container.textContent).toContain("Тема гаража");
    act(() => {
      root.unmount();
    });
  });
});
