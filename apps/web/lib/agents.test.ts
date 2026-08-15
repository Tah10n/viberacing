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
});
