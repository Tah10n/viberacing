export const supportedAgents = ["codex", "claude_code"] as const;
export type SupportedAgent = (typeof supportedAgents)[number];

export const agentNames: Readonly<Record<SupportedAgent, string>> = {
  codex: "Codex",
  claude_code: "Claude Code",
};

export function isSupportedAgent(value: unknown): value is SupportedAgent {
  return typeof value === "string" && supportedAgents.includes(value as SupportedAgent);
}
