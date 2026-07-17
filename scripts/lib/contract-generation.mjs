import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { format } from "prettier";

const manifestRelativePath = "contracts/v1/manifest.json";
const schemaFilePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\.schema\.json$/;
const policyFilePattern = /^connector-[a-z0-9]+(?:-[a-z0-9]+)*\.json$/;
const operationKeys =
  "admissionPolicy,authenticationContract,cacheControl,corsPolicy,implementationStatus,method,operationId,path,problemSchema,problemStatuses,queryPolicy,querySchema,requestBodyPolicy,requestSchema,responseSchema,summary";
const problemResponseDescriptions = new Map([
  [400, "Invalid request."],
  [401, "Unauthorized."],
  [403, "Forbidden."],
  [404, "Not found."],
  [405, "Method not allowed."],
  [406, "Not acceptable."],
  [409, "Conflict."],
  [422, "Validation failed."],
  [429, "Rate limited."],
  [500, "Internal server error."],
  [503, "Temporarily unavailable."],
]);

function normalizedText(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function assertRegularSource(path, label) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular non-symbolic-link file`);
  }
}

function parseJson(path, label) {
  try {
    return JSON.parse(normalizedText(path));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

export function readContractSources(root) {
  const manifestPath = resolve(root, manifestRelativePath);
  assertRegularSource(manifestPath, manifestRelativePath);
  const manifestText = normalizedText(manifestPath);
  const manifest = parseJson(manifestPath, manifestRelativePath);
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    Object.keys(manifest).sort().join(",") !==
      "contractVersion,operations,policies,schemaVersion,schemas" ||
    manifest.schemaVersion !== 1 ||
    manifest.contractVersion !== "v1" ||
    !Array.isArray(manifest.schemas) ||
    manifest.schemas.length === 0 ||
    manifest.schemas.length > 32 ||
    !Array.isArray(manifest.policies) ||
    manifest.policies.length === 0 ||
    manifest.policies.length > 32 ||
    !Array.isArray(manifest.operations) ||
    manifest.operations.length === 0 ||
    manifest.operations.length > 32
  ) {
    throw new Error(`${manifestRelativePath} has an invalid shape or version`);
  }

  const records = manifest.schemas.map((entry, index) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(",") !== "exportName,file,typeName" ||
      !schemaFilePattern.test(entry.file ?? "") ||
      !/^[a-z][A-Za-z0-9]*$/.test(entry.exportName ?? "") ||
      !/^[A-Z][A-Za-z0-9]*V1$/.test(entry.typeName ?? "")
    ) {
      throw new Error(`contract manifest entry ${String(index + 1)} has unsafe names or shape`);
    }
    const relativePath = `contracts/v1/${entry.file}`;
    const absolutePath = resolve(root, relativePath);
    assertRegularSource(absolutePath, relativePath);
    const text = normalizedText(absolutePath);
    return { entry, relativePath, schema: parseJson(absolutePath, relativePath), text };
  });

  const schemaByTypeName = new Map();
  const exportNames = new Set();
  for (const record of records) {
    if (schemaByTypeName.has(record.entry.typeName) || exportNames.has(record.entry.exportName)) {
      throw new Error(`${manifestRelativePath} contains duplicate public schema names`);
    }
    schemaByTypeName.set(record.entry.typeName, record);
    exportNames.add(record.entry.exportName);
  }

  let previousPolicyFile = "";
  const policyIds = new Set();
  const policyByFile = new Map();
  const policies = manifest.policies.map((entry, index) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(",") !== "file,policyId" ||
      !policyFilePattern.test(entry.file ?? "") ||
      !/^viberacing-[a-z0-9]+(?:-[a-z0-9]+)*-v1$/.test(entry.policyId ?? "")
    ) {
      throw new Error(`contract policy ${String(index + 1)} has unsafe names or shape`);
    }
    if (previousPolicyFile !== "" && previousPolicyFile.localeCompare(entry.file) >= 0) {
      throw new Error(`${manifestRelativePath} policies must be uniquely sorted by file`);
    }
    if (policyIds.has(entry.policyId)) {
      throw new Error(`${manifestRelativePath} contains a duplicate policy ID`);
    }
    const relativePath = `contracts/v1/${entry.file}`;
    const absolutePath = resolve(root, relativePath);
    assertRegularSource(absolutePath, relativePath);
    const text = normalizedText(absolutePath);
    const policy = parseJson(absolutePath, relativePath);
    if (
      policy === null ||
      typeof policy !== "object" ||
      Array.isArray(policy) ||
      policy.protocolId !== entry.policyId
    ) {
      throw new Error(`${relativePath} has an invalid identity or shape`);
    }
    const record = { entry, policy, relativePath, text };
    previousPolicyFile = entry.file;
    policyIds.add(entry.policyId);
    policyByFile.set(entry.file, record);
    return record;
  });

  let previousOperationKey = "";
  const operationIds = new Set();
  const operations = manifest.operations.map((entry, index) => {
    const schemaReferencePattern = /^[A-Z][A-Za-z0-9]*V1$/;
    const isGet = entry?.method === "get";
    const isPost = entry?.method === "post";
    const hasGetQueryContract =
      isGet &&
      schemaReferencePattern.test(entry?.querySchema ?? "") &&
      entry?.queryPolicy === "closed-single-value";
    const hasNoQueryContract =
      isPost && entry?.querySchema === "none" && entry?.queryPolicy === "none";
    const hasPostRequestContract =
      isPost &&
      schemaReferencePattern.test(entry?.requestSchema ?? "") &&
      /^exact-raw-json-[1-9][0-9]{0,5}$/.test(entry?.requestBodyPolicy ?? "");
    const hasNoRequestContract =
      isGet && entry?.requestSchema === "none" && entry?.requestBodyPolicy === "none";
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(",") !== operationKeys ||
      (!isGet && !isPost) ||
      typeof entry.path !== "string" ||
      entry.path.length > 128 ||
      !/^\/v1\/[a-z0-9]+(?:\/[a-z0-9]+)*$/.test(entry.path) ||
      typeof entry.operationId !== "string" ||
      entry.operationId.length > 64 ||
      !/^[a-z][A-Za-z0-9]*V1$/.test(entry.operationId) ||
      typeof entry.summary !== "string" ||
      entry.summary.length === 0 ||
      entry.summary.length > 120 ||
      /[\u0000-\u001f]/.test(entry.summary) ||
      !["contract-only", "implemented-local"].includes(entry.implementationStatus) ||
      !/^no-queue-(?:[1-9]|[12][0-9]|3[0-2])$/.test(entry.admissionPolicy ?? "") ||
      !(
        entry.authenticationContract === "none" ||
        policyFilePattern.test(entry.authenticationContract ?? "")
      ) ||
      (!hasGetQueryContract && !hasNoQueryContract) ||
      (!hasPostRequestContract && !hasNoRequestContract) ||
      !schemaReferencePattern.test(entry.responseSchema ?? "") ||
      !schemaReferencePattern.test(entry.problemSchema ?? "") ||
      !Array.isArray(entry.problemStatuses) ||
      entry.problemStatuses.length === 0 ||
      entry.problemStatuses.length > 16 ||
      entry.cacheControl !== "no-store" ||
      entry.corsPolicy !== "same-origin"
    ) {
      throw new Error(`contract operation ${String(index + 1)} has unsafe names or shape`);
    }

    let previousStatus = 0;
    for (const status of entry.problemStatuses) {
      if (
        !Number.isSafeInteger(status) ||
        status <= previousStatus ||
        !problemResponseDescriptions.has(status)
      ) {
        throw new Error(`contract operation ${String(index + 1)} has invalid problem statuses`);
      }
      previousStatus = status;
    }

    const operationKey = `${entry.path}\0${entry.method}`;
    if (previousOperationKey !== "" && previousOperationKey.localeCompare(operationKey) >= 0) {
      throw new Error(
        `${manifestRelativePath} operations must be uniquely sorted by path and method`,
      );
    }
    if (operationIds.has(entry.operationId)) {
      throw new Error(`${manifestRelativePath} contains a duplicate operation ID`);
    }
    previousOperationKey = operationKey;
    operationIds.add(entry.operationId);

    const queryRecord =
      entry.querySchema === "none" ? undefined : schemaByTypeName.get(entry.querySchema);
    const requestRecord =
      entry.requestSchema === "none" ? undefined : schemaByTypeName.get(entry.requestSchema);
    const responseRecord = schemaByTypeName.get(entry.responseSchema);
    const problemRecord = schemaByTypeName.get(entry.problemSchema);
    if (
      (isGet &&
        (queryRecord?.schema?.type !== "object" ||
          queryRecord.schema.properties === null ||
          typeof queryRecord.schema.properties !== "object" ||
          Array.isArray(queryRecord.schema.properties))) ||
      (isPost && requestRecord?.schema?.type !== "object") ||
      responseRecord?.schema?.type !== "object" ||
      problemRecord?.schema?.type !== "object" ||
      problemRecord.schema.properties?.requestId?.type !== "string"
    ) {
      throw new Error(`contract operation ${String(index + 1)} references invalid schemas`);
    }

    if (
      entry.authenticationContract !== "none" &&
      !policyByFile.has(entry.authenticationContract)
    ) {
      throw new Error(`contract operation ${String(index + 1)} references an unknown policy`);
    }
    return { entry, problemRecord, queryRecord, requestRecord };
  });

  const digest = createHash("sha256");
  digest.update(`${manifestRelativePath}\0${manifestText}\0`, "utf8");
  for (const record of records) {
    digest.update(`${record.relativePath}\0${record.text}\0`, "utf8");
  }
  for (const policy of policies) {
    digest.update(`${policy.relativePath}\0${policy.text}\0`, "utf8");
  }

  return {
    digest: `sha256:${digest.digest("hex")}`,
    manifest,
    operations,
    policies,
    records,
  };
}

function literalType(value) {
  return JSON.stringify(value);
}

function schemaType(schema) {
  if (Object.hasOwn(schema, "const")) {
    return literalType(schema.const);
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((entry) => literalType(entry)).join(" | ");
  }
  switch (schema.type) {
    case "array":
      return `readonly (${schemaType(schema.items)})[]`;
    case "boolean":
      return "boolean";
    case "integer":
      return "number";
    case "object": {
      const required = new Set(schema.required ?? []);
      const properties = Object.entries(schema.properties ?? {}).map(
        ([name, propertySchema]) =>
          `readonly ${JSON.stringify(name)}${required.has(name) ? "" : "?"}: ${schemaType(propertySchema)};`,
      );
      return `{ ${properties.join(" ")} }`;
    }
    case "string":
      return "string";
    default:
      throw new Error(`unsupported schema type ${JSON.stringify(schema.type)}`);
  }
}

function topLevelType(typeName, schema) {
  if (schema.type !== "object") {
    return `export type ${typeName} = ${schemaType(schema)};`;
  }
  const required = new Set(schema.required ?? []);
  const properties = Object.entries(schema.properties ?? {})
    .map(
      ([name, propertySchema]) =>
        `  readonly ${JSON.stringify(name)}${required.has(name) ? "" : "?"}: ${schemaType(propertySchema)};`,
    )
    .join("\n");
  return `export interface ${typeName} {\n${properties}\n}`;
}

function schemaConstantName(exportName) {
  return `${exportName}Schema`;
}

function validatorName(typeName) {
  return `validate${typeName}`;
}

async function generateTypescript(sources) {
  const blocks = [
    "// Generated by `node scripts/generate-contracts.mjs`. Do not edit by hand.",
    `// Canonical source digest: ${sources.digest}`,
    "",
    'import { defineContractSchema, validateContract, type ContractSchema, type ValidationResult } from "./runtime.js";',
    "",
    `export const contractVersion = ${JSON.stringify(sources.manifest.contractVersion)} as const;`,
    `export const contractSourceDigest = ${JSON.stringify(sources.digest)} as const;`,
  ];

  for (const { entry, schema } of sources.records) {
    blocks.push(
      "",
      topLevelType(entry.typeName, schema),
      "",
      `export const ${schemaConstantName(entry.exportName)} = defineContractSchema(${JSON.stringify(schema, null, 2)} as const satisfies ContractSchema);`,
      "",
      `export function ${validatorName(entry.typeName)}(value: unknown): ValidationResult<${entry.typeName}> {`,
      `  return validateContract<${entry.typeName}>(${schemaConstantName(entry.exportName)}, value);`,
      "}",
    );
  }

  return format(`${blocks.join("\n")}\n`, {
    endOfLine: "lf",
    parser: "typescript",
    printWidth: 100,
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    trailingComma: "all",
  });
}

function openApiSchema(schema) {
  const { $id, $schema, ...rest } = schema;
  void $id;
  void $schema;
  return rest;
}

function schemaReference(typeName) {
  return { $ref: `#/components/schemas/${typeName}` };
}

function responseHeaders(cacheControl, requestIdSchema) {
  return {
    "Cache-Control": {
      description: "The response is not stored by browsers or shared caches.",
      schema: { type: "string", const: cacheControl },
    },
    Vary: {
      description: "Representation negotiation varies on the Accept request header.",
      schema: { type: "string", const: "Accept" },
    },
    "x-request-id": {
      description: "Server-generated opaque request correlation identifier.",
      schema: openApiSchema(requestIdSchema),
    },
  };
}

function openApiOperation(operation) {
  const { entry, problemRecord, queryRecord, requestRecord } = operation;
  const requestIdSchema = problemRecord.schema.properties.requestId;
  const parameters =
    queryRecord === undefined
      ? undefined
      : Object.entries(queryRecord.schema.properties).map(([name, schema]) => ({
          name,
          in: "query",
          required: true,
          description: schema.description,
          schema: openApiSchema(schema),
        }));
  const problemResponses = Object.fromEntries(
    entry.problemStatuses.map((status) => [
      String(status),
      {
        description: problemResponseDescriptions.get(status),
        headers: {
          ...responseHeaders(entry.cacheControl, requestIdSchema),
          ...(status === 405
            ? {
                Allow: {
                  description: "The only method accepted by this operation path.",
                  schema: { type: "string", const: entry.method.toUpperCase() },
                },
              }
            : {}),
        },
        content: {
          "application/problem+json": { schema: schemaReference(entry.problemSchema) },
        },
      },
    ]),
  );
  return {
    operationId: entry.operationId,
    summary: entry.summary,
    description:
      entry.implementationStatus === "implemented-local"
        ? "Implemented and verified in this repository. Its presence here does not prove deployment."
        : "Contract-only operation. Its presence here does not prove that a route is implemented or deployed.",
    ...(parameters === undefined ? {} : { parameters }),
    ...(requestRecord === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: schemaReference(entry.requestSchema) },
            },
          },
        }),
    responses: {
      200: {
        description: "Successful bounded response.",
        headers: responseHeaders(entry.cacheControl, requestIdSchema),
        content: { "application/json": { schema: schemaReference(entry.responseSchema) } },
      },
      ...problemResponses,
    },
    "x-viberacing-admission-policy": entry.admissionPolicy,
    "x-viberacing-authentication-contract":
      entry.authenticationContract === "none"
        ? "none"
        : `contracts/v1/${entry.authenticationContract}`,
    "x-viberacing-cache-policy": entry.cacheControl,
    "x-viberacing-cors-policy": entry.corsPolicy,
    "x-viberacing-query-contract":
      entry.querySchema === "none" ? "none" : schemaReference(entry.querySchema),
    "x-viberacing-query-policy": entry.queryPolicy,
    "x-viberacing-request-body-policy": entry.requestBodyPolicy,
    "x-viberacing-request-contract":
      entry.requestSchema === "none" ? "none" : schemaReference(entry.requestSchema),
    "x-viberacing-status": entry.implementationStatus,
  };
}

async function generateOpenApi(sources) {
  const components = Object.fromEntries(
    sources.records.map(({ entry, schema }) => [entry.typeName, openApiSchema(schema)]),
  );
  const paths = {};
  for (const operation of sources.operations) {
    paths[operation.entry.path] ??= {};
    paths[operation.entry.path][operation.entry.method] = openApiOperation(operation);
  }
  const implementationStatuses = new Set(
    sources.operations.map(({ entry }) => entry.implementationStatus),
  );
  const documentStatus =
    implementationStatuses.size === 1 ? [...implementationStatuses][0] : "mixed-local";
  const document = {
    openapi: "3.1.1",
    info: {
      title: "Vibe Racing public API contract",
      version: "1.0.0",
      description:
        "Generated schemas and repository implementation status. A documented path does not prove deployment.",
    },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    paths,
    components: { schemas: components },
    "x-viberacing-contract-source": sources.digest,
    "x-viberacing-status": documentStatus,
  };
  return format(`${JSON.stringify(document)}\n`, {
    endOfLine: "lf",
    parser: "json",
    printWidth: 100,
    tabWidth: 2,
  });
}

export async function buildGeneratedArtifacts(root) {
  const sources = readContractSources(root);
  return new Map([
    ["contracts/generated/openapi.v1.json", await generateOpenApi(sources)],
    ["packages/contracts/src/generated.ts", await generateTypescript(sources)],
  ]);
}

export async function writeGeneratedArtifacts(root) {
  const artifacts = await buildGeneratedArtifacts(root);
  for (const [relativePath, content] of artifacts) {
    const absolutePath = resolve(root, relativePath);
    const pathFromRoot = relative(root, absolutePath);
    if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) {
      throw new Error(`generated output escapes the repository: ${relativePath}`);
    }
    const parents = relative(root, dirname(absolutePath)).split(sep).filter(Boolean);
    let current = root;
    for (const parent of parents) {
      current = resolve(current, parent);
      const stats = lstatSync(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`generated output parent is not a regular directory: ${relativePath}`);
      }
    }
    if (existsSync(absolutePath)) {
      const stats = lstatSync(absolutePath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(`generated output is not a regular file: ${relativePath}`);
      }
    }
    writeFileSync(absolutePath, content, "utf8");
  }
  return artifacts;
}
