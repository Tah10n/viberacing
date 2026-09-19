import { URL } from "node:url";
import { readdir } from "node:fs/promises";

// Snapshot actual regular public files at startup. Prefixes and unknown names
// cannot exempt arbitrary dynamic routes; symlinks are deliberately excluded.
export async function publicAssetPaths(directory, prefix = "") {
  const paths = new Set();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isFile()) paths.add(path);
    else if (entry.isDirectory()) {
      for (const child of await publicAssetPaths(
        new URL(`${encodeURIComponent(entry.name)}/`, directory),
        path,
      ))
        paths.add(child);
    }
  }
  return paths;
}
