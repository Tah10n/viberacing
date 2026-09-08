import { describe, expect, it } from "vitest";
import { issueUsageObservation, readUsageObservation } from "./usage-observation";

describe("server-issued usage observations", () => {
  const key = Buffer.alloc(32, 1);
  const collected = new Date("2026-09-08T10:00:00.000Z");
  const received = new Date("2026-09-08T12:00:00.000Z");
  it("retains collection order across delayed delivery and repeated delivery", () => {
    const old = issueUsageObservation(key, collected);
    const newer = issueUsageObservation(key, new Date("2026-09-08T11:00:00.000Z"));
    expect(readUsageObservation(key, old, received)).toEqual(collected);
    expect(readUsageObservation(key, old, received)).toEqual(collected);
    expect(readUsageObservation(key, newer, received)?.getTime()).toBeGreaterThan(
      collected.getTime(),
    );
  });
  it("rejects another installation, forged dates, malformed tickets, and future observations", () => {
    const ticket = issueUsageObservation(key, collected);
    expect(readUsageObservation(Buffer.alloc(32, 2), ticket, received)).toBeNull();
    expect(readUsageObservation(key, ticket.replace("10:00", "11:00"), received)).toBeNull();
    expect(readUsageObservation(key, "bad", received)).toBeNull();
    expect(readUsageObservation(key, ticket, new Date(collected.getTime() - 1))).toBeNull();
  });
});
