import { resolve } from "node:path";

import { writeGeneratedArtifacts } from "./lib/contract-generation.mjs";

const root = resolve(import.meta.dirname, "..");
const artifacts = await writeGeneratedArtifacts(root);

console.log(`Generated ${String(artifacts.size)} contract artifact(s).`);
