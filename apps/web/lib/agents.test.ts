import { describe, expect, it } from "vitest";
import { agentRegistry, countedAgentCount, supportedAgents } from "./agents";

describe("counted agent capabilities", () => {
  it("counts exactly the eight agents with authoritative token totals", () => {
    expect(countedAgentCount).toBe(8);
    expect(supportedAgents.filter((agentId) => agentRegistry[agentId].countsExactTokens)).toEqual([
      "codex",
      "claude_code",
      "opencode",
      "kimi_code",
      "qwen_code",
      "antigravity",
      "gemini_cli",
      "cursor",
    ]);
    expect(supportedAgents).toHaveLength(8);
  });

  it("declares the account-switch contract for every supported agent", () => {
    expect(
      Object.fromEntries(
        supportedAgents.map((agentId) => [agentId, agentRegistry[agentId].accountSwitchMode]),
      ),
    ).toEqual({
      cursor: "provider_account_events",
      codex: "provider_account_snapshot",
      claude_code: "combined_local_history",
      opencode: "combined_local_history",
      kimi_code: "combined_local_history",
      qwen_code: "combined_local_history",
      antigravity: "explicit_capture",
      gemini_cli: "combined_local_history",
    });
  });
});
