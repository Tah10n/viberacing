import { writeSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exitInvalidRuntimeConfiguration } from "./startup.node";

vi.mock("node:fs", () => ({ writeSync: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("invalid runtime configuration exit", () => {
  it("writes the required record synchronously before terminating", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process exited");
    });

    expect(() => exitInvalidRuntimeConfiguration('{"event":"configuration_invalid"}')).toThrow(
      "process exited",
    );
    expect(writeSync).toHaveBeenCalledWith(2, '{"event":"configuration_invalid"}\n');
    expect(vi.mocked(writeSync).mock.invocationCallOrder[0]).toBeLessThan(
      exit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});
