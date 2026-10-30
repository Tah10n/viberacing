import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRailwayContext, project } from "railway/iac";
import railway, { partial } from "../.railway/railway.ts";

const target = {
  command: "plan",
  projectId: "9c93a77d-9033-4045-b34c-f8755cf1d6b6",
  projectName: "robust-celebration",
  environmentId: "2edee876-7008-4fe5-922e-917085a6f21e",
  environment: "production",
};
const definition = await railway(createRailwayContext(target), project);
assert.equal(partial, "viberacing", "Keep service-only ownership to protect the database.");
assert.equal(definition.name, target.projectName);
assert.equal(definition.resources.length, 1);
const [web] = definition.resources;
assert.equal(web.address, "service.viberacing");
assert.deepEqual(web.source, {
  type: "github",
  repo: "Tah10n/viberacing",
  branch: "main",
  checkSuites: true,
});

// Compare the SDK's evaluated settings with the working deployment contract,
// rather than matching source text. A newly added legacy field must also migrate.
const legacy = JSON.parse(readFileSync(new URL("../railway.json", import.meta.url), "utf8"));
for (const section of ["build", "deploy"]) {
  for (const [key, value] of Object.entries(legacy[section])) {
    const expected = key === "preDeployCommand" && typeof value === "string" ? [value] : value;
    assert.deepEqual(web[section][key], expected, `Missing or changed ${section}.${key}`);
  }
}
assert.equal(Object.keys(web.variables).length, 11, "Review any change to the variable inventory.");
for (const [name, value] of Object.entries(web.variables)) {
  assert.deepEqual(
    value,
    { type: "preserve" },
    `Keep ${name} on Railway, including its references.`,
  );
}
for (const mismatch of [
  { projectId: "another-project" },
  { environmentId: "another-environment" },
]) {
  assert.throws(
    () => railway(createRailwayContext({ ...target, ...mismatch }), project),
    /existing production environment/,
  );
}

console.log(
  "Railway config: legacy settings, source, preserved variables and target guard passed.",
);
