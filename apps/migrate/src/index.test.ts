import { describe, expect, it } from "vitest";

import * as publicApi from "./index.js";

describe("migration workspace public API", () => {
  it("exports no reusable catalog, database, or command authority", () => {
    expect(Object.keys(publicApi)).toEqual([]);
  });
});
