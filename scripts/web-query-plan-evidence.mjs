import assert from "node:assert/strict";

// cspell:ignore pkey

const maximumPlanCount = 128;
const maximumNodesPerPlan = 256;
const maximumPlanDepth = 32;
const writeOrTemporaryBlockKeys = Object.freeze([
  "Shared Dirtied Blocks",
  "Shared Written Blocks",
  "Local Dirtied Blocks",
  "Local Written Blocks",
  "Temp Read Blocks",
  "Temp Written Blocks",
]);
const forbiddenMutationNodes = new Set([
  "Delete",
  "Insert",
  "LockRows",
  "Merge",
  "ModifyTable",
  "Update",
]);
const forbiddenSequentialRelations = new Set([
  "codex_sources",
  "finalized_season_profile_freshness",
  "profile_car_recipes",
  "season_daily_scores",
  "season_entries",
  "seasons",
  "source_day_values",
]);

const evidenceDefinitions = Object.freeze([
  Object.freeze({
    label: "score adapter",
    matches: (queryText) =>
      queryText.includes(
        "FROM viberacing_api.list_public_community_scores($1::date, $2::integer) AS score",
      ),
    requiredIndexGroups: Object.freeze([]),
    requiredNodeTypes: Object.freeze(["Function Scan"]),
  }),
  Object.freeze({
    label: "race adapter",
    matches: (queryText) =>
      queryText.includes(
        "FROM viberacing_api.list_public_community_race($1::date, $2::integer) AS race",
      ),
    requiredIndexGroups: Object.freeze([]),
    requiredNodeTypes: Object.freeze(["Function Scan"]),
  }),
  Object.freeze({
    label: "status adapter",
    matches: (queryText) =>
      queryText.includes(
        "FROM viberacing_api.list_public_community_race_status($1::date, $2::integer) AS status",
      ),
    requiredIndexGroups: Object.freeze([]),
    requiredNodeTypes: Object.freeze(["Function Scan"]),
  }),
  Object.freeze({
    label: "score projection",
    matches: (queryText) =>
      queryText.includes("WITH visible_entries AS MATERIALIZED") &&
      queryText.includes("viberacing_private.season_entries"),
    requiredIndexGroups: Object.freeze([
      Object.freeze(["season_entries_profile_history_idx", "season_entries_pkey"]),
      Object.freeze(["seasons_pkey"]),
    ]),
    requiredNodeTypes: Object.freeze(["Limit"]),
  }),
  Object.freeze({
    label: "race projection",
    matches: (queryText) =>
      queryText.includes(
        "FROM viberacing_api.list_public_community_scores(p_season_start, p_limit) AS score_record",
      ) && queryText.includes("viberacing_private.profile_car_recipes"),
    requiredIndexGroups: Object.freeze([Object.freeze(["profile_car_recipes_pkey"])]),
    requiredNodeTypes: Object.freeze(["Function Scan"]),
  }),
  Object.freeze({
    label: "status projection",
    matches: (queryText) =>
      queryText.includes(
        "FROM viberacing_api.list_public_community_race(p_season_start, p_limit) AS race_record",
      ) &&
      queryText.includes("viberacing_private.finalized_season_profile_freshness") &&
      queryText.includes("viberacing_private.source_day_values") &&
      queryText.includes("viberacing_private.season_daily_scores"),
    requiredIndexGroups: Object.freeze([
      Object.freeze(["finalized_season_profile_freshness_primary_key"]),
      Object.freeze(["source_day_values_date_idx"]),
      Object.freeze(["codex_sources_profile_state_idx"]),
      Object.freeze(["season_daily_scores_positive_profile_date_idx"]),
    ]),
    requiredNodeTypes: Object.freeze(["Function Scan"]),
  }),
]);

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function parseJsonObjectAt(input, start) {
  assert.equal(input[start], "{");
  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let index = start; index < input.length; index += 1) {
    const character = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return Object.freeze({ end: index + 1, value: JSON.parse(input.slice(start, index + 1)) });
      }
    }
  }
  throw new Error("PostgreSQL auto_explain emitted an incomplete JSON object.");
}

export function parseAutoExplainPlans(input, options) {
  assert.equal(typeof input, "string", "PostgreSQL plan logs must be text");
  assert.equal(isRecord(options), true, "PostgreSQL plan-log options must be an exact object");
  const optionKeys = Reflect.ownKeys(options);
  assert.equal(
    optionKeys.length === 2 &&
      optionKeys.every((key) => key === "maximumBytes" || key === "privateMarkers"),
    true,
    "PostgreSQL plan-log options must contain only the reviewed fields",
  );
  const { maximumBytes, privateMarkers } = options;
  assert.equal(Number.isSafeInteger(maximumBytes), true, "plan-log byte budget must be integral");
  assert.ok(maximumBytes > 0, "plan-log byte budget must be positive");
  assert.equal(Array.isArray(privateMarkers), true, "private plan-log markers must be an array");
  assert.equal(
    Object.getPrototypeOf(privateMarkers),
    Array.prototype,
    "private plan-log markers must be a plain array",
  );
  assert.ok(
    privateMarkers.length > 0 && privateMarkers.length <= 64,
    "private plan-log marker count must be non-zero and bounded",
  );
  assert.ok(
    Buffer.byteLength(input, "utf8") <= maximumBytes,
    "synthetic PostgreSQL plan logs exceeded their fixed byte budget",
  );
  for (const marker of privateMarkers) {
    assert.equal(typeof marker, "string", "private plan-log markers must be text");
    assert.ok(
      marker.length > 0 && marker.length <= 512,
      "private plan-log markers must be non-empty and bounded",
    );
    assert.equal(
      input.includes(marker),
      false,
      "synthetic PostgreSQL plan logs exposed a private integration value",
    );
  }

  const plans = [];
  const planMarker = " plan:";
  let offset = 0;
  while (offset < input.length) {
    const markerIndex = input.indexOf(planMarker, offset);
    if (markerIndex === -1) {
      break;
    }
    const lineEnd = input.indexOf("\n", markerIndex + planMarker.length);
    if (lineEnd === -1) {
      throw new Error("PostgreSQL auto_explain plan marker had no JSON line.");
    }
    let jsonStart = lineEnd + 1;
    while (jsonStart < input.length && /[\r\t ]/.test(input[jsonStart])) {
      jsonStart += 1;
    }
    if (input[jsonStart] !== "{") {
      throw new Error("PostgreSQL auto_explain plan marker had no JSON object.");
    }
    const parsed = parseJsonObjectAt(input, jsonStart);
    assert.equal(isRecord(parsed.value), true, "PostgreSQL auto_explain plan must be an object");
    plans.push(parsed.value);
    assert.ok(plans.length <= maximumPlanCount, "PostgreSQL emitted too many auto_explain plans");
    offset = parsed.end;
  }
  assert.ok(plans.length > 0, "synthetic PostgreSQL emitted no auto_explain plans");
  return Object.freeze(plans);
}

function collectPlanNodes(plan, label) {
  assert.equal(isRecord(plan), true, `${label} must contain one plan object`);
  const nodes = [];
  const pending = [{ depth: 0, node: plan }];
  while (pending.length > 0) {
    const { depth, node } = pending.pop();
    assert.ok(depth <= maximumPlanDepth, `${label} exceeded the plan depth budget`);
    assert.equal(isRecord(node), true, `${label} contained a non-object plan node`);
    assert.equal(typeof node["Node Type"], "string", `${label} plan node omitted its type`);
    nodes.push(node);
    assert.ok(nodes.length <= maximumNodesPerPlan, `${label} exceeded the plan-node budget`);
    if (Object.hasOwn(node, "Plans")) {
      assert.equal(Array.isArray(node.Plans), true, `${label} child plans must be an array`);
      for (let index = node.Plans.length - 1; index >= 0; index -= 1) {
        pending.push({ depth: depth + 1, node: node.Plans[index] });
      }
    }
  }
  return nodes;
}

function assertBoundedReadPlan(entry, definition) {
  assert.equal(
    Object.hasOwn(entry, "Query Parameters"),
    false,
    `${definition.label} must not log query parameters`,
  );
  const nodes = collectPlanNodes(entry.Plan, definition.label);
  const root = nodes[0];
  assert.equal(Number.isSafeInteger(root["Actual Rows"]), true, `${definition.label} row count`);
  assert.ok(root["Actual Rows"] >= 0 && root["Actual Rows"] <= 32, `${definition.label} row cap`);
  assert.equal(root["Actual Loops"], 1, `${definition.label} must execute once`);

  const executedNodeTypes = new Set();
  const executedIndexNames = new Set();
  for (const node of nodes) {
    const nodeType = node["Node Type"];
    if (typeof node["Actual Loops"] === "number" && node["Actual Loops"] > 0) {
      executedNodeTypes.add(nodeType);
      if (typeof node["Index Name"] === "string") {
        executedIndexNames.add(node["Index Name"]);
      }
    }
    assert.equal(
      forbiddenMutationNodes.has(nodeType),
      false,
      `${definition.label} used a mutating or locking plan node`,
    );
    if (nodeType === "Seq Scan" && typeof node["Relation Name"] === "string") {
      assert.equal(
        forbiddenSequentialRelations.has(node["Relation Name"]),
        false,
        `${definition.label} sequentially scanned a bounded-index relation`,
      );
    }
    for (const key of writeOrTemporaryBlockKeys) {
      assert.equal(node[key], 0, `${definition.label} reported ${key}`);
    }
  }

  for (const requiredNodeType of definition.requiredNodeTypes) {
    assert.equal(
      executedNodeTypes.has(requiredNodeType),
      true,
      `${definition.label} omitted executed ${requiredNodeType} evidence`,
    );
  }
  for (const alternatives of definition.requiredIndexGroups) {
    assert.equal(
      alternatives.some((indexName) => executedIndexNames.has(indexName)),
      true,
      `${definition.label} omitted an executed reviewed index`,
    );
  }
}

export function assertPublicCommunityPlanEvidence(plans) {
  assert.equal(Array.isArray(plans), true, "public query-plan evidence must be an array");
  assert.equal(
    Object.getPrototypeOf(plans),
    Array.prototype,
    "public query-plan evidence must be a plain array",
  );
  assert.ok(plans.length > 0 && plans.length <= maximumPlanCount, "public query-plan count");

  for (const entry of plans) {
    assert.equal(isRecord(entry), true, "public query-plan entry must be an object");
    assert.equal(
      Object.hasOwn(entry, "Query Parameters"),
      false,
      "public query-plan logs must omit every parameter payload",
    );
  }

  for (const definition of evidenceDefinitions) {
    const matchingEntries = plans.filter(
      (candidate) =>
        typeof candidate["Query Text"] === "string" && definition.matches(candidate["Query Text"]),
    );
    assert.ok(matchingEntries.length > 0, `${definition.label} plan evidence was not emitted`);
    for (const entry of matchingEntries) {
      assertBoundedReadPlan(entry, definition);
    }
  }

  return Object.freeze({ evidencedPlanCount: evidenceDefinitions.length });
}
