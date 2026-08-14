import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptDirectory, "..", "..", "..");
const connectorDirectory = join(repositoryRoot, "packages", "connector");
const downloadsDirectory = join(repositoryRoot, "apps", "web", "public", "downloads");
const connectorPackage = JSON.parse(
  await readFile(join(connectorDirectory, "package.json"), "utf8"),
);
if (!/^\d+\.\d+\.\d+$/.test(connectorPackage.version ?? ""))
  throw new Error("Connector package requires a stable semantic version");
const outputPaths = [
  join(downloadsDirectory, "viberacing-connector.tgz"),
  join(downloadsDirectory, `viberacing-connector-${connectorPackage.version}.tgz`),
];
const temporaryDirectory = await mkdtemp(join(tmpdir(), "viberacing-connector-package-"));

function run(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

try {
  await run("corepack", [
    "pnpm",
    "--dir",
    connectorDirectory,
    "pack",
    "--pack-destination",
    temporaryDirectory,
  ]);
  const archives = (await readdir(temporaryDirectory)).filter((name) => name.endsWith(".tgz"));
  if (archives.length !== 1) {
    throw new Error(`Expected one connector archive, found ${archives.length}`);
  }
  await mkdir(downloadsDirectory, { recursive: true });
  for (const outputPath of outputPaths) {
    const pendingPath = `${outputPath}.tmp`;
    await copyFile(join(temporaryDirectory, archives[0]), pendingPath);
    await rename(pendingPath, outputPath);
  }
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
