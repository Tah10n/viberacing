import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(root, "packages/connector");
const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
const notice = "Generated from packages/connector/package.json; do not edit by hand.";
const outputs = [
  {
    path: resolve(packageRoot, "lib/version.mjs"),
    contents: `// ${notice}\nexport const connectorVersion = ${JSON.stringify(packageJson.version)};\n`,
  },
  {
    path: resolve(root, "apps/web/lib/connector.ts"),
    contents: `// ${notice}\nexport const bundledConnectorVersion = ${JSON.stringify(packageJson.version)};\n\nexport function connectorArchiveName(): string {\n  return \`viberacing-connector-\${bundledConnectorVersion}.tgz\`;\n}\n`,
  },
];
for (const output of outputs) {
  if (process.argv.includes("--check")) {
    if ((await readFile(output.path, "utf8")) !== output.contents) {
      throw new Error("Generated connector version modules do not match package.json");
    }
  } else {
    await writeFile(output.path, output.contents);
  }
}
