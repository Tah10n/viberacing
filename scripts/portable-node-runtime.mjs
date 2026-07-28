import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

const packageNamePattern = /^(?:@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+)$/i;
const packageVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const runtimePrefixPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*-$/;

function readPackageManifest(packageDirectory, label) {
  const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  assert.equal(
    manifest !== null && typeof manifest === "object" && !Array.isArray(manifest),
    true,
    `${label} manifest must be one object`,
  );
  assert.match(manifest.name, packageNamePattern);
  assert.match(manifest.version, packageVersionPattern);
  return manifest;
}

function findInstalledPackageDirectory(resolver, packageName) {
  let packageEntry;
  try {
    packageEntry = resolver.resolve(`${packageName}/package.json`);
  } catch {
    packageEntry = resolver.resolve(packageName);
  }

  let candidate = dirname(packageEntry);
  while (true) {
    const manifestPath = join(candidate, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest?.name === packageName) {
        return realpathSync(candidate);
      }
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error(`Installed package ${packageName} has no bounded package root.`);
    }
    candidate = parent;
  }
}

function discoverInstalledPackageGraph(sourceDirectory, graphBySource, inventory) {
  const canonicalSource = realpathSync(sourceDirectory);
  const existing = graphBySource.get(canonicalSource);
  if (existing !== undefined) {
    return existing;
  }
  const manifest = readPackageManifest(canonicalSource, "portable runtime dependency");
  const packageKey = `${manifest.name}@${manifest.version}`;
  inventory.add(packageKey);
  const node = { dependencies: new Map(), manifest, packageKey, source: canonicalSource };
  graphBySource.set(canonicalSource, node);
  const resolver = createRequire(join(canonicalSource, "package.json"));
  const requiredDependencies = Object.keys(manifest.dependencies ?? {});
  const optionalDependencies = Object.keys(manifest.optionalDependencies ?? {});
  const dependencyNames = [...new Set([...requiredDependencies, ...optionalDependencies])].sort();

  for (const dependencyName of dependencyNames) {
    let dependencySource;
    try {
      dependencySource = findInstalledPackageDirectory(resolver, dependencyName);
    } catch (error) {
      if (optionalDependencies.includes(dependencyName)) {
        continue;
      }
      throw error;
    }
    const dependencyNode = discoverInstalledPackageGraph(
      dependencySource,
      graphBySource,
      inventory,
    );
    assert.equal(
      dependencyNode.manifest.name,
      dependencyName,
      "portable runtime does not admit aliased production dependencies",
    );
    node.dependencies.set(dependencyName, dependencyNode);
  }
  return node;
}

function packageDependencySignature(node) {
  return JSON.stringify(
    [...node.dependencies.entries()]
      .map(([name, dependency]) => [name, dependency.packageKey])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function copyExternalPackageContent(node, destinationDirectory) {
  mkdirSync(dirname(destinationDirectory), { recursive: true });
  cpSync(node.source, destinationDirectory, {
    dereference: true,
    filter: (source) => {
      const nestedPath = relative(node.source, source);
      return nestedPath !== "node_modules" && !nestedPath.startsWith(`node_modules${sep}`);
    },
    recursive: true,
  });
}

function materializeExternalPackage(
  node,
  destinationDirectory,
  versionsByName,
  materializedDestinations,
  ancestors,
) {
  const canonicalDestination = resolve(destinationDirectory);
  const existingKey = materializedDestinations.get(canonicalDestination);
  if (existingKey !== undefined) {
    assert.equal(
      existingKey,
      node.packageKey,
      "portable runtime package destinations must remain unambiguous",
    );
    return;
  }
  materializedDestinations.set(canonicalDestination, node.packageKey);
  copyExternalPackageContent(node, canonicalDestination);

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(node.packageKey);
  for (const [dependencyName, dependencyNode] of node.dependencies) {
    if (versionsByName.get(dependencyName)?.size === 1) {
      continue;
    }
    if (nextAncestors.has(dependencyNode.packageKey)) {
      continue;
    }
    materializeExternalPackage(
      dependencyNode,
      join(canonicalDestination, "node_modules", ...dependencyName.split("/")),
      versionsByName,
      materializedDestinations,
      nextAncestors,
    );
  }
}

function copyWorkspacePackage(sourceDirectory, destinationDirectory) {
  mkdirSync(destinationDirectory, { recursive: true });
  cpSync(join(sourceDirectory, "package.json"), join(destinationDirectory, "package.json"));
  cpSync(join(sourceDirectory, "dist"), join(destinationDirectory, "dist"), {
    dereference: true,
    recursive: true,
  });
}

function fingerprintPortableRuntime(runtimeDirectory, minimumFileCount, maximumFileCount) {
  const fingerprint = createHash("sha256");
  let fileCount = 0;

  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false, "portable runtime must contain no links");
      if (stat.isDirectory()) {
        visit(path);
        continue;
      }
      assert.equal(stat.isFile(), true, "portable runtime accepts only directories and files");
      const relativePath = relative(runtimeDirectory, path).split(sep).join("/");
      fingerprint.update(relativePath);
      fingerprint.update("\0");
      fingerprint.update(readFileSync(path));
      fingerprint.update("\0");
      fileCount += 1;
    }
  };

  visit(runtimeDirectory);
  assert.equal(
    fileCount >= minimumFileCount && fileCount <= maximumFileCount,
    true,
    `portable runtime file count ${fileCount} must stay between ${minimumFileCount} and ${maximumFileCount}`,
  );
  return Object.freeze({ digest: fingerprint.digest("hex"), fileCount });
}

function workspaceDestination(runtimeDirectory, manifest, entryWorkspaceName) {
  if (manifest.name === entryWorkspaceName) {
    return runtimeDirectory;
  }
  return join(runtimeDirectory, "node_modules", ...manifest.name.split("/"));
}

export function createPortableNodeRuntime(options) {
  const {
    entryWorkspaceDirectory,
    expectedExternalInventory,
    expectedWorkspaceInventory,
    maximumFileCount,
    minimumFileCount,
    root,
    runtimePrefix,
    workspaceDirectories,
  } = options;
  assert.match(runtimePrefix, runtimePrefixPattern);
  assert.equal(Number.isSafeInteger(minimumFileCount) && minimumFileCount > 0, true);
  assert.equal(
    Number.isSafeInteger(maximumFileCount) && maximumFileCount >= minimumFileCount,
    true,
  );
  assert.equal(Array.isArray(workspaceDirectories) && workspaceDirectories.length > 0, true);
  assert.equal(new Set(workspaceDirectories).size, workspaceDirectories.length);

  const canonicalRoot = realpathSync(root);
  const rootPrefix = `${canonicalRoot}${sep}`;
  const canonicalEntry = realpathSync(entryWorkspaceDirectory);
  assert.equal(canonicalEntry.startsWith(rootPrefix), true);

  const workspaces = workspaceDirectories.map((directory) => {
    const canonicalDirectory = realpathSync(directory);
    assert.equal(canonicalDirectory.startsWith(rootPrefix), true);
    return Object.freeze({
      directory: canonicalDirectory,
      manifest: readPackageManifest(canonicalDirectory, "portable workspace"),
    });
  });
  const entryWorkspace = workspaces.find(({ directory }) => directory === canonicalEntry);
  assert.notEqual(entryWorkspace, undefined, "portable runtime entry must be a reviewed workspace");
  const workspaceByName = new Map(
    workspaces.map((workspace) => [workspace.manifest.name, workspace]),
  );
  assert.equal(workspaceByName.size, workspaces.length, "portable workspace names must be unique");
  assert.deepEqual(
    workspaces.map(({ manifest }) => `${manifest.name}@${manifest.version}`).sort(),
    expectedWorkspaceInventory,
    "portable runtime must contain the exact reviewed workspace package graph",
  );

  const targetDirectory = resolve(canonicalRoot, "target");
  mkdirSync(targetDirectory, { recursive: true });
  const runtimeDirectory = mkdtempSync(join(targetDirectory, runtimePrefix));
  try {
    if (process.platform !== "win32") {
      // mkdtemp creates 0700 on POSIX, while the container intentionally runs under another UID.
      chmodSync(runtimeDirectory, 0o755);
      assert.equal(
        lstatSync(runtimeDirectory).mode & 0o777,
        0o755,
        "portable runtime root must be traversable by the distinct non-root container user",
      );
    }

    for (const workspace of workspaces) {
      copyWorkspacePackage(
        workspace.directory,
        workspaceDestination(runtimeDirectory, workspace.manifest, entryWorkspace.manifest.name),
      );
    }

    const directExternalDependencies = [];
    const externalGraphBySource = new Map();
    const externalInventory = new Set();
    for (const workspace of workspaces) {
      const destination = workspaceDestination(
        runtimeDirectory,
        workspace.manifest,
        entryWorkspace.manifest.name,
      );
      const dependencies = workspace.manifest.dependencies ?? {};
      const resolver = createRequire(join(workspace.directory, "package.json"));
      for (const dependencyName of Object.keys(dependencies).sort()) {
        const specification = dependencies[dependencyName];
        if (typeof specification === "string" && specification.startsWith("workspace:")) {
          assert.equal(
            workspaceByName.has(dependencyName),
            true,
            `portable workspace dependency ${dependencyName} must be reviewed`,
          );
          continue;
        }
        assert.equal(typeof specification, "string");
        const dependencySource = findInstalledPackageDirectory(resolver, dependencyName);
        const node = discoverInstalledPackageGraph(
          dependencySource,
          externalGraphBySource,
          externalInventory,
        );
        assert.equal(
          node.manifest.name,
          dependencyName,
          "portable runtime does not admit aliased workspace dependencies",
        );
        directExternalDependencies.push({ dependencyName, destination, node });
      }
    }
    assert.deepEqual(
      [...externalInventory].sort(),
      expectedExternalInventory,
      "portable runtime must contain the exact installed production package graph",
    );

    const externalNodesByKey = new Map();
    for (const node of externalGraphBySource.values()) {
      const existing = externalNodesByKey.get(node.packageKey);
      if (existing === undefined) {
        externalNodesByKey.set(node.packageKey, node);
      } else {
        assert.equal(
          packageDependencySignature(node),
          packageDependencySignature(existing),
          `portable runtime package graph for ${node.packageKey} must be deterministic`,
        );
      }
    }
    const versionsByName = new Map();
    for (const node of externalNodesByKey.values()) {
      const versions = versionsByName.get(node.manifest.name) ?? new Set();
      versions.add(node.manifest.version);
      versionsByName.set(node.manifest.name, versions);
    }
    const materializedDestinations = new Map();
    for (const node of externalNodesByKey.values()) {
      if (versionsByName.get(node.manifest.name)?.size !== 1) {
        continue;
      }
      assert.equal(
        workspaceByName.has(node.manifest.name),
        false,
        "portable external packages must not shadow reviewed workspaces",
      );
      materializeExternalPackage(
        node,
        join(runtimeDirectory, "node_modules", ...node.manifest.name.split("/")),
        versionsByName,
        materializedDestinations,
        new Set(),
      );
    }
    for (const { dependencyName, destination, node } of directExternalDependencies) {
      if (versionsByName.get(dependencyName)?.size === 1) {
        continue;
      }
      materializeExternalPackage(
        node,
        join(destination, "node_modules", ...dependencyName.split("/")),
        versionsByName,
        materializedDestinations,
        new Set(),
      );
    }

    return Object.freeze({
      fingerprint: fingerprintPortableRuntime(runtimeDirectory, minimumFileCount, maximumFileCount),
      maximumFileCount,
      minimumFileCount,
      root: canonicalRoot,
      runtimeDirectory,
      runtimePrefix,
    });
  } catch (error) {
    rmSync(runtimeDirectory, { force: true, recursive: true });
    throw error;
  }
}

export function removePortableNodeRuntime(runtime) {
  const targetDirectory = `${resolve(runtime.root, "target")}${sep}`;
  assert.equal(
    runtime.runtimeDirectory.startsWith(targetDirectory),
    true,
    "portable runtime cleanup must remain below the repository target directory",
  );
  assert.match(
    runtime.runtimeDirectory.slice(targetDirectory.length),
    new RegExp(`^${runtime.runtimePrefix.replaceAll("-", "\\-")}[^\\\\/]+$`),
  );
  assert.deepEqual(
    fingerprintPortableRuntime(
      runtime.runtimeDirectory,
      runtime.minimumFileCount,
      runtime.maximumFileCount,
    ),
    runtime.fingerprint,
    "the read-only container must not mutate its portable runtime",
  );
  rmSync(runtime.runtimeDirectory, { force: true, recursive: true });
}
