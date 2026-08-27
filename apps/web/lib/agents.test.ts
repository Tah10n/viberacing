import { describe, expect, it } from "vitest";
import { agentRegistry, countedAgentCount, supportedAgents } from "./agents";

describe("counted agent capabilities", () => {
  it("counts exactly the seven agents with authoritative token totals", () => {
    expect(countedAgentCount).toBe(7);
    expect(supportedAgents.filter((agentId) => agentRegistry[agentId].countsExactTokens)).toEqual([
      "codex",
      "claude_code",
      "opencode",
      "kimi_code",
      "qwen_code",
      "antigravity",
      "gemini_cli",
    ]);
    expect(supportedAgents).toHaveLength(7);
  });

  it("declares the account-switch contract for every supported agent", () => {
    expect(
      Object.fromEntries(
        supportedAgents.map((agentId) => [agentId, agentRegistry[agentId].accountSwitchMode]),
      ),
    ).toEqual({
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
