export function connectorCommandShell(
  platformHint: string | null,
  userAgent: string | null,
): string {
  const platform = platformHint?.replaceAll('"', "").trim().toLowerCase() ?? "";
  const agent = userAgent?.toLowerCase() ?? "";
  const fallback = "Terminal or Windows PowerShell on the computer running the connector";

  if (
    platform === "android" ||
    platform === "ios" ||
    agent.includes("android") ||
    agent.includes("iphone") ||
    agent.includes("ipad") ||
    agent.includes("mobile/")
  ) {
    return fallback;
  }

  if (platform === "windows" || agent.includes("windows")) return "Windows PowerShell";
  if (platform === "macos" || agent.includes("macintosh") || agent.includes("mac os x")) {
    return "macOS Terminal";
  }
  if (platform === "linux" || agent.includes("linux")) return "Linux terminal";

  return fallback;
}
