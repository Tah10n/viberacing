import { describe, expect, it } from "vitest";
import { exceedsPairingLimits } from "./route";

describe("pairing resource limits", () => {
  it("allows the final slot for every per-user resource", () => {
    expect(
      exceedsPairingLimits(
        { installations: 19, sources: 99, installationSources: 31, accounts: 99 },
        1,
        1,
      ),
    ).toBe(false);
  });

  it.each([
    [{ installations: 20, sources: 0, installationSources: 0, accounts: 0 }, 1, 1, "installations"],
    [{ installations: 0, sources: 100, installationSources: 0, accounts: 0 }, 1, 0, "sources"],
    [
      { installations: 0, sources: 0, installationSources: 32, accounts: 0 },
      1,
      0,
      "installation sources",
    ],
    [{ installations: 0, sources: 0, installationSources: 0, accounts: 100 }, 1, 1, "accounts"],
  ])("rejects a pairing beyond the per-user %s cap", (counts, sources, accounts) => {
    expect(exceedsPairingLimits(counts, sources, accounts)).toBe(true);
  });
});
