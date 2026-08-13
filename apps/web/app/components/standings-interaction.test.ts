import { describe, expect, it, vi } from "vitest";
import {
  isProfileShortcut,
  shouldOpenProfile,
  syncProfileDialog,
  type DialogControl,
} from "./standings-interaction";

function dialog(open: boolean): DialogControl {
  return { open, close: vi.fn(), showModal: vi.fn() };
}

describe("standings profile interaction", () => {
  it("opens and closes the native dialog with profile selection", () => {
    const closed = dialog(false);
    syncProfileDialog(closed, true);
    expect(closed.showModal).toHaveBeenCalledOnce();

    const open = dialog(true);
    syncProfileDialog(open, false);
    expect(open.close).toHaveBeenCalledOnce();
  });

  it("supports row keyboard shortcuts", () => {
    expect(isProfileShortcut("Enter")).toBe(true);
    expect(isProfileShortcut(" ")).toBe(true);
    expect(isProfileShortcut("Escape")).toBe(false);
  });

  it("leaves links and buttons to their own actions", () => {
    expect(shouldOpenProfile(false)).toBe(true);
    expect(shouldOpenProfile(true)).toBe(false);
  });
});
