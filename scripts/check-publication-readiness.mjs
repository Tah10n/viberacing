import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === "--root" && args[1]))) {
  console.error("Usage: node scripts/check-publication-readiness.mjs [--root <directory>]");
  process.exit(2);
}

const root = args.length === 0 ? resolve(import.meta.dirname, "..") : resolve(args[1]);
const blockers = [];

function read(path) {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) {
    blockers.push(`${path} is missing`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function originUrl() {
  try {
    return execFileSync("git", ["-C", root, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const origin = originUrl();
const githubSshPrefix = `git${String.fromCharCode(64)}github.com:`;
if (!origin) {
  blockers.push("a GitHub origin remote is not configured");
} else if (
  !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/i.test(origin) &&
  !new RegExp(`^${githubSshPrefix}[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\\.git)?$`, "i").test(origin)
) {
  blockers.push("origin is not a canonical GitHub repository URL");
}

const maintainers = read("MAINTAINERS.md");
if (!maintainers.includes("Public maintainer registry: configured.")) {
  blockers.push("the public maintainer registry is not marked configured");
}
const maintainerHandles = new Set(
  [
    ...maintainers.matchAll(
      /https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?=[\s)/?#]|$)/g,
    ),
  ].map((match) => match[1].toLowerCase()),
);
if (maintainerHandles.size === 0) {
  blockers.push("MAINTAINERS.md has no public GitHub maintainer profile");
}

const codeowners = read(".github/CODEOWNERS");
if (codeowners) {
  const entries = [];
  for (const rawLine of codeowners.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const [pattern, ...owners] = line.split(/\s+/);
    if (owners.length === 0) {
      blockers.push(`CODEOWNERS pattern ${JSON.stringify(pattern)} has no owner`);
      continue;
    }
    if (
      pattern !== "*" &&
      (!/^\/[A-Za-z0-9._/-]+$/.test(pattern) ||
        pattern.includes("//") ||
        pattern.split("/").includes(".."))
    ) {
      blockers.push(
        `CODEOWNERS pattern ${JSON.stringify(pattern)} is outside the reviewed literal-path subset`,
      );
    }
    const userOwners = new Set();
    for (const owner of owners) {
      const user = owner.match(/^@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)$/);
      const team = owner.match(
        /^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/,
      );
      if (!user && !team) {
        blockers.push(
          "CODEOWNERS must use valid public GitHub user or organization-team handles, not emails",
        );
        continue;
      }
      if (user) {
        userOwners.add(user[1].toLowerCase());
      }
    }
    entries.push({ pattern, userOwners });
  }

  const globalRules = entries.filter((entry) => entry.pattern === "*");
  if (globalRules.length !== 1 || entries[0]?.pattern !== "*") {
    blockers.push("CODEOWNERS must contain exactly one global * rule and it must be first");
  }
  for (const pattern of ["*", "/.github/", "/CODE_OF_CONDUCT.md", "/SECURITY.md"]) {
    const matchingEntries = entries.filter((entry) => entry.pattern === pattern);
    if (matchingEntries.length !== 1) {
      blockers.push(`CODEOWNERS must contain exactly one rule for ${pattern}`);
      continue;
    }
    if (![...matchingEntries[0].userOwners].some((handle) => maintainerHandles.has(handle))) {
      blockers.push(
        `required CODEOWNERS pattern ${pattern} must include a listed public maintainer directly`,
      );
    }
  }
}

const conduct = read("CODE_OF_CONDUCT.md");
const participationStatus =
  conduct.match(/^External participation status:\s*(.+?)\s*$/m)?.[1] ?? "";
const interactionStatus =
  conduct.match(/^GitHub public interaction status:\s*(.+?)\s*$/m)?.[1] ?? "";
const conductChannel = conduct.match(/^Conduct reporting channel:\s*(.+?)\s*$/m)?.[1] ?? "";
let conductChannelReady = false;
if (!conductChannel) {
  blockers.push("the conduct-reporting channel status is missing");
} else if (conductChannel !== "not configured.") {
  try {
    const url = new URL(conductChannel);
    conductChannelReady =
      url.protocol === "https:" &&
      url.hostname !== "localhost" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/\/issues(?:\/|$)/.test(url.pathname);
    if (!conductChannelReady) {
      blockers.push(
        "the conduct-reporting channel must be a private credential-free HTTPS endpoint without query data, not a public issue page",
      );
    }
  } catch {
    blockers.push("the conduct-reporting channel is not a valid HTTPS URL");
  }
}

let publicationMode = "";
if (participationStatus === "closed.") {
  publicationMode = "source-only";
  if (interactionStatus !== "restricted and verified.") {
    blockers.push(
      "source-only publication requires GitHub Issues and Discussions to be disabled, Pull Requests to be collaborators-only, and all three settings to be recorded as verified",
    );
  }
} else if (participationStatus === "open.") {
  publicationMode = "open-participation";
  if (interactionStatus !== "enabled for open participation.") {
    blockers.push("open participation requires GitHub public interactions to be marked enabled");
  }
  if (!conductChannelReady) {
    blockers.push("open participation requires a private conduct-reporting HTTPS channel");
  }
} else {
  blockers.push("external participation must be exactly closed or open");
}

const security = read("SECURITY.md");
if (!security.includes("Private vulnerability reporting status: enabled and verified.")) {
  blockers.push("GitHub private vulnerability reporting is not recorded as enabled and verified");
}

if (blockers.length > 0) {
  console.error(`Publication readiness blocked by ${blockers.length} item(s):`);
  for (const blocker of blockers) {
    console.error(`- ${blocker}`);
  }
  console.error(
    "Do not publish source yet. Configure real public project identities and hosted controls, then rerun this gate.",
  );
  process.exit(1);
}

console.log(
  `Static publication-readiness checks passed (${publicationMode}). Verify hosted permissions and security settings before announcing the repository.`,
);
