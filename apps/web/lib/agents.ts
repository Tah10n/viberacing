export const supportedAgents = [
  "codex",
  "claude_code",
  "opencode",
  "kimi_code",
  "qwen_code",
  "antigravity",
  "gemini_cli",
] as const;

export type SupportedAgent = (typeof supportedAgents)[number];
export type AggregationMode = "account_max" | "source_sum";
export type AccountSwitchMode =
  "provider_account_snapshot" | "combined_local_history" | "explicit_capture";
export type SupportedSurface = "cli" | "desktop";

interface AgentDefinition {
  readonly displayName: string;
  readonly aggregationMode: AggregationMode;
  readonly accountSwitchMode: AccountSwitchMode;
  readonly countsExactTokens: boolean;
  readonly methods: Readonly<Record<string, readonly SupportedSurface[]>>;
}

export const agentRegistry: Readonly<Record<SupportedAgent, AgentDefinition>> = {
  codex: {
    displayName: "Codex",
    aggregationMode: "account_max",
    accountSwitchMode: "provider_account_snapshot",
    countsExactTokens: true,
    methods: { codex_app_server: ["cli", "desktop"] },
  },
  claude_code: {
    displayName: "Claude Code",
    aggregationMode: "source_sum",
    accountSwitchMode: "combined_local_history",
    countsExactTokens: true,
    methods: { claude_jsonl: ["cli"] },
  },
  opencode: {
    displayName: "OpenCode",
    aggregationMode: "source_sum",
    accountSwitchMode: "combined_local_history",
    countsExactTokens: true,
    methods: { opencode_sqlite: ["cli"] },
  },
  kimi_code: {
    displayName: "Kimi Code",
    aggregationMode: "source_sum",
    accountSwitchMode: "combined_local_history",
    countsExactTokens: true,
    methods: { kimi_wire_jsonl: ["cli"], kimi_legacy_wire_jsonl: ["cli"] },
  },
  qwen_code: {
    displayName: "Qwen Code",
    aggregationMode: "source_sum",
    accountSwitchMode: "combined_local_history",
    countsExactTokens: true,
    methods: { qwen_stats_jsonl: ["cli"] },
  },
  antigravity: {
    displayName: "Antigravity",
    aggregationMode: "source_sum",
    accountSwitchMode: "explicit_capture",
    countsExactTokens: true,
    methods: { antigravity_cli_capture: ["cli"] },
  },
  gemini_cli: {
    displayName: "Gemini CLI",
    aggregationMode: "source_sum",
    accountSwitchMode: "combined_local_history",
    countsExactTokens: true,
    methods: { gemini_session_json: ["cli"] },
  },
};

export const countedAgentCount = supportedAgents.filter(
  (id) => agentRegistry[id].countsExactTokens,
).length;

export const agentNames = Object.fromEntries(
  supportedAgents.map((id) => [id, agentRegistry[id].displayName]),
) as Readonly<Record<SupportedAgent, string>>;

export function isSupportedAgent(value: unknown): value is SupportedAgent {
  return typeof value === "string" && supportedAgents.includes(value as SupportedAgent);
}

export function isSupportedSource(
  agentId: SupportedAgent,
  collectionMethod: string,
  surface: SupportedSurface,
): boolean {
  return agentRegistry[agentId].methods[collectionMethod]?.includes(surface) === true;
}
