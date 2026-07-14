import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getSyntheticRacePayload } from "@/lib/race-data";

import { PixelRaceCanvas } from "./pixel-race-canvas";

interface CanvasContextStub {
  fillRect: ReturnType<typeof vi.fn>;
  fillStyle: string;
  imageSmoothingEnabled: boolean;
}

interface MountedCanvas {
  readonly container: HTMLDivElement;
  readonly root: Root;
}

function installCanvasContext(context: CanvasContextStub | null): void {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => context),
  });
}

function mountCanvas(animate: boolean): MountedCanvas {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(PixelRaceCanvas, {
        animate,
        description: "Five cars racing toward a checkered line",
        participants: getSyntheticRacePayload().participants,
        theme: "neon-night",
      }),
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("PixelRaceCanvas", () => {
  it("draws a deterministic frame and advances only while animation is enabled", () => {
    const context: CanvasContextStub = {
      fillRect: vi.fn(),
      fillStyle: "",
      imageSmoothingEnabled: true,
    };
    installCanvasContext(context);
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    const cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);

    const mounted = mountCanvas(false);
    expect(context.imageSmoothingEnabled).toBe(false);
    expect(context.fillRect).toHaveBeenCalled();
    expect(requestFrame).not.toHaveBeenCalled();
    expect(mounted.container.querySelector("canvas")?.getAttribute("width")).toBe("320");
    expect(mounted.container.textContent).toContain("Five cars racing");

    const callsAfterStaticFrame = context.fillRect.mock.calls.length;
    act(() => {
      mounted.root.render(
        createElement(PixelRaceCanvas, {
          animate: true,
          description: "Five cars racing toward a checkered line",
          participants: getSyntheticRacePayload().participants,
          theme: "cyber-rally",
        }),
      );
    });
    expect(requestFrame).toHaveBeenCalledTimes(1);

    const nextFrame = frameCallbacks.shift();
    expect(nextFrame).toBeDefined();
    act(() => {
      nextFrame?.(280);
    });
    expect(context.fillRect.mock.calls.length).toBeGreaterThan(callsAfterStaticFrame);
    expect(requestFrame).toHaveBeenCalledTimes(2);

    act(() => {
      mounted.root.unmount();
    });
    expect(cancelFrame).toHaveBeenCalled();
  });

  it("keeps the semantic fallback when a 2D context is unavailable", () => {
    installCanvasContext(null);
    const mounted = mountCanvas(false);
    const canvas = mounted.container.querySelector("canvas");
    expect(canvas?.getAttribute("role")).toBe("img");
    expect(canvas?.getAttribute("aria-describedby")).toBe("pixel-race-description");
    act(() => {
      mounted.root.unmount();
    });
  });
});
