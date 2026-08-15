import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

const definitions = Object.freeze({
  codex: {
    command: "codex",
    override: "VIBERACING_CODEX_BIN",
    darwinApps: ["ChatGPT.app", "Codex.app"],
    windowsApps: ["ChatGPT", "Codex"],
  },
  cursor: {
    command: "cursor-agent",
    override: "VIBERACING_CURSOR_AGENT_BIN",
    darwinApps: ["Cursor.app"],
    windowsApps: ["Cursor"],
  },
  antigravity: {
    command: "agy",
    override: "VIBERACING_ANTIGRAVITY_BIN",
    darwinApps: ["Antigravity.app"],
    windowsApps: ["Antigravity"],
  },
});

function pathApi(platform) {
  return platform === "win32" ? win32 : posix;
}

function unique(values, platform) {
  const paths = pathApi(platform);
  return [...new Set(values.filter(Boolean).map((value) => paths.resolve(value)))];
}

function pathNames(command, platform, environment) {
  if (platform !== "win32") return [command];
  const extensions = (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`)];
}

function managerDirectories(home, platform, environment) {
  const { join } = pathApi(platform);
  const common = [
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".pnpm"),
  ];
  if (platform === "win32")
    return [
      ...common,
      environment.APPDATA && join(environment.APPDATA, "npm"),
      environment.LOCALAPPDATA && join(environment.LOCALAPPDATA, "Microsoft", "WindowsApps"),
      join(home, "scoop", "shims"),
      environment.ProgramData && join(environment.ProgramData, "chocolatey", "bin"),
    ];
  return [
    ...common,
    "/usr/local/bin",
    "/usr/bin",
    ...(platform === "darwin" ? ["/opt/homebrew/bin", "/opt/local/bin"] : ["/snap/bin"]),
  ];
}

function appCandidates(definition, home, platform, environment) {
  const { join } = pathApi(platform);
  if (platform === "darwin")
    return (definition.darwinApps ?? []).flatMap((application) => [
      join("/Applications", application, "Contents", "Resources", definition.command),
      join(home, "Applications", application, "Contents", "Resources", definition.command),
    ]);
  if (platform !== "win32") return [];
  const roots = [
    environment.LOCALAPPDATA,
    environment.ProgramFiles,
    environment["ProgramFiles(x86)"],
  ];
  return roots.flatMap((root) =>
    root
      ? (definition.windowsApps ?? []).flatMap((name) => [
          join(root, "Programs", name, "resources", `${definition.command}.exe`),
          join(root, name, "resources", `${definition.command}.exe`),
        ])
      : [],
  );
}

export function executableCandidates(
  agentId,
  { platform = process.platform, environment = process.env, home = homedir() } = {},
) {
  const definition = definitions[agentId];
  if (!definition) return [];
  const paths = pathApi(platform);
  const override = environment[definition.override];
  const names = pathNames(definition.command, platform, environment);
  const pathDirectories = (environment.PATH ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean);
  const candidates = [
    override && (paths.isAbsolute(override) ? override : paths.resolve(override)),
    ...pathDirectories.flatMap((directory) => names.map((name) => paths.join(directory, name))),
    ...appCandidates(definition, home, platform, environment),
    ...managerDirectories(home, platform, environment).flatMap((directory) =>
      names.map((name) => paths.join(directory, name)),
    ),
  ];
  return unique(candidates, platform);
}

async function executable(path, platform) {
  try {
    await access(path, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveAgentExecutable(agentId, options = {}) {
  const platform = options.platform ?? process.platform;
  const accessible = options.accessible ?? ((path) => executable(path, platform));
  for (const candidate of executableCandidates(agentId, options))
    if (await accessible(candidate)) return candidate;
  return null;
}

export function executableOverride(agentId) {
  return definitions[agentId]?.override ?? null;
}

const commandMetaCharacters = /([()\][%!^"`<>&|;, *?])/g;

function escapeCommand(value) {
  return String(value).replace(commandMetaCharacters, "^$1");
}

function escapeCommandArgument(value, doubleEscape = false) {
  let escaped = String(value);
  escaped = escaped.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  escaped = escaped.replace(/(?=(\\+?)?)\1$/g, "$1$1");
  escaped = `"${escaped}"`;
  escaped = escaped.replace(commandMetaCharacters, "^$1");
  return doubleEscape ? escaped.replace(commandMetaCharacters, "^$1") : escaped;
}

export function resolvedExecutableInvocation(
  executablePath,
  args,
  { platform = process.platform, environment = process.env } = {},
) {
  if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(executablePath)) {
    return { command: executablePath, args: [...args], windowsVerbatimArguments: false };
  }
  const commandShell =
    environment.ComSpec ??
    environment.COMSPEC ??
    (environment.SystemRoot
      ? win32.join(environment.SystemRoot, "System32", "cmd.exe")
      : "cmd.exe");
  const commandLine = [
    escapeCommand(executablePath),
    ...args.map((argument) => escapeCommandArgument(argument, /\.cmd$/i.test(executablePath))),
  ].join(" ");
  return {
    command: commandShell,
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

export function spawnResolvedExecutable(executablePath, args, options = {}, runtime = {}) {
  const invocation = resolvedExecutableInvocation(executablePath, args, runtime);
  return spawn(invocation.command, invocation.args, {
    ...options,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
}
