import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const output = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"],
  { cwd: root, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 },
);
const markdownPaths = output
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .sort((left, right) => left.localeCompare(right));
const failures = [];

function isInsideRoot(path) {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot === "" ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`))
  );
}

function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function headingsFor(text) {
  const headings = new Set();
  for (const line of text.split("\n")) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      headings.add(githubSlug(match[2]));
    }
  }
  return headings;
}

const documentCache = new Map();
function document(path) {
  if (!documentCache.has(path)) {
    documentCache.set(path, readFileSync(path, "utf8"));
  }
  return documentCache.get(path);
}

for (const relativePath of markdownPaths) {
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath)) {
    continue;
  }
  if (lstatSync(absolutePath).isSymbolicLink()) {
    failures.push(`${relativePath} — Markdown symlinks are not allowed`);
    continue;
  }
  const text = document(absolutePath);
  const lines = text.split("\n");
  const seenHeadings = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index]);
    if (!heading) {
      continue;
    }
    const slug = githubSlug(heading[2]);
    if (seenHeadings.has(slug)) {
      failures.push(`${relativePath}:${index + 1} — duplicate heading anchor #${slug}`);
    }
    seenHeadings.add(slug);
  }

  const withoutFencedCode = text.replace(/```[\s\S]*?```/g, "");
  const inlineLinkPattern = /\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*["'])?\)/g;
  for (const match of withoutFencedCode.matchAll(inlineLinkPattern)) {
    const rawTarget = (match[1] ?? match[2]).trim();
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(rawTarget)) {
      continue;
    }

    const [rawPath, rawAnchor] = rawTarget.split("#", 2);
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch {
      failures.push(`${relativePath} — malformed percent-encoding in link ${rawTarget}`);
      continue;
    }

    const linkedPath = resolve(dirname(absolutePath), decodedPath || ".");
    if (!isInsideRoot(linkedPath)) {
      failures.push(`${relativePath} — relative link escapes repository root: ${rawTarget}`);
      continue;
    }
    if (!existsSync(linkedPath)) {
      failures.push(`${relativePath} — missing relative link target ${rawTarget}`);
      continue;
    }
    if (!isInsideRoot(realpathSync(linkedPath))) {
      failures.push(`${relativePath} — relative link resolves outside repository: ${rawTarget}`);
      continue;
    }

    if (rawAnchor && extname(linkedPath).toLowerCase() === ".md") {
      const anchors = headingsFor(document(linkedPath));
      if (!anchors.has(rawAnchor.toLowerCase())) {
        failures.push(`${relativePath} — missing Markdown anchor ${rawTarget}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Documentation check failed with ${failures.length} finding(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Documentation check passed (${markdownPaths.length} Markdown file(s)).`);
