import assert from "node:assert/strict";

import {
  assertPublicSnapshotPlanEvidence,
  parseAutoExplainPlans,
} from "./web-query-plan-evidence.mjs";

// cspell:ignore pkey

const zeroBlockEvidence = Object.freeze({
  "Shared Dirtied Blocks": 0,
  "Shared Written Blocks": 0,
  "Local Dirtied Blocks": 0,
  "Local Written Blocks": 0,
  "Temp Read Blocks": 0,
  "Temp Written Blocks": 0,
});

function node(type, options = {}) {
  return {
    "Node Type": type,
    "Actual Rows": options.actualRows ?? 1,
    "Actual Loops": options.actualLoops ?? 1,
    ...zeroBlockEvidence,
    ...(options.relation === undefined ? {} : { "Relation Name": options.relation }),
    ...(options.index === undefined ? {} : { "Index Name": options.index }),
    ...(options.plans === undefined ? {} : { Plans: options.plans }),
  };
}

function plan(queryText, root) {
  return { "Query Text": queryText, Plan: root };
}

function lookupPlan(payloadIndex) {
  return node("Limit", {
    plans: [
      node("Index Scan", { index: "leaderboard_published_snapshots_pkey" }),
      node("Index Scan", { index: "leaderboard_snapshots_pkey" }),
      node("Index Scan", { index: payloadIndex }),
    ],
  });
}

function validPlans() {
  return [
    plan(
      "SELECT snapshot.* FROM viberacing_api.read_current_leaderboard_page($1::integer) AS snapshot",
      node("Function Scan"),
    ),
    plan(
      "SELECT snapshot.* FROM viberacing_api.read_season_leaderboard_page($1::date, $2::integer) AS snapshot",
      node("Function Scan"),
    ),
    plan(
      "SELECT snapshot.* FROM viberacing_api.read_current_public_profile($1::text) AS snapshot",
      node("Function Scan"),
    ),
    plan(
      "SELECT page.* FROM viberacing_private.leaderboard_published_snapshots AS published JOIN viberacing_private.leaderboard_snapshots AS snapshot ON true JOIN viberacing_private.leaderboard_snapshot_pages AS page ON true WHERE page.page_kind = 'leaderboard_page' AND pg_catalog.transaction_timestamp() IS NOT NULL LIMIT 1",
      lookupPlan("leaderboard_snapshot_pages_pkey"),
    ),
    plan(
      "SELECT page.* FROM viberacing_private.leaderboard_published_snapshots AS published JOIN viberacing_private.leaderboard_snapshots AS snapshot ON true JOIN viberacing_private.leaderboard_snapshot_pages AS page ON true WHERE published.season_start = p_season_start AND page.page_kind = 'leaderboard_page' LIMIT 1",
      lookupPlan("leaderboard_snapshot_pages_pkey"),
    ),
    plan(
      "SELECT profile.* FROM viberacing_private.leaderboard_published_snapshots AS published JOIN viberacing_private.leaderboard_snapshots AS snapshot ON true JOIN viberacing_private.leaderboard_snapshot_profiles AS profile ON true WHERE profile.handle = p_handle LIMIT 1",
      lookupPlan("leaderboard_snapshot_profiles_pkey"),
    ),
  ];
}

function renderLog(plans, newline = "\n") {
  return plans
    .map(
      (entry, index) =>
        `2026-07-20 LOG:  duration: 0.${index} ms  plan:${newline}${JSON.stringify(entry, null, 2).replaceAll("\n", newline)}${newline}`,
    )
    .join("");
}

function parse(log, maximumBytes = 128 * 1024) {
  return parseAutoExplainPlans(log, {
    maximumBytes,
    privateMarkers: ["private-marker"],
  });
}

let failClosedCaseCount = 0;
function expectFailure(callback, expected) {
  assert.throws(callback, expected);
  failClosedCaseCount += 1;
}

const validLog = renderLog(validPlans());
const parsed = parse(validLog);
assert.equal(parsed.length, 6);
assert.deepEqual(assertPublicSnapshotPlanEvidence(parsed), { evidencedPlanCount: 6 });
assert.equal(parse(renderLog(validPlans(), "\r\n")).length, 6);

const boundedPayloadSequentialAccess = validPlans();
boundedPayloadSequentialAccess[4].Plan.Plans[2] = node("Seq Scan", {
  actualRows: 1,
  relation: "leaderboard_snapshot_pages",
});
boundedPayloadSequentialAccess[4].Plan.Plans[2]["Rows Removed by Filter"] = 200;
assert.deepEqual(assertPublicSnapshotPlanEvidence(boundedPayloadSequentialAccess), {
  evidencedPlanCount: 6,
});

expectFailure(() => parse(`${validLog}private-marker`), /exposed a private integration value/);
expectFailure(() => parse(validLog, 10), /exceeded their fixed byte budget/);
expectFailure(() => parse("no plans here"), /emitted no auto_explain plans/);
expectFailure(() => parse("LOG: plan:"), /had no JSON line/);
expectFailure(() => parse("LOG: plan:\nnot-json"), /had no JSON object/);
expectFailure(() => parse('LOG: plan:\n{"Query Text":"unterminated"'), /incomplete JSON object/);
expectFailure(
  () =>
    parseAutoExplainPlans(validLog, {
      extra: true,
      maximumBytes: 128 * 1024,
      privateMarkers: ["private-marker"],
    }),
  /only the reviewed fields/,
);
expectFailure(
  () =>
    parseAutoExplainPlans(validLog, {
      maximumBytes: 128 * 1024,
      privateMarkers: [],
    }),
  /marker count must be non-zero and bounded/,
);
expectFailure(
  () => parse(renderLog(Array.from({ length: 129 }, () => validPlans()[0])), 2 * 1024 * 1024),
  /too many auto_explain plans/,
);

for (let index = 0; index < 6; index += 1) {
  const missing = validPlans();
  missing.splice(index, 1);
  expectFailure(() => assertPublicSnapshotPlanEvidence(missing), /plan evidence was not emitted/);
}

const parameterLeak = validPlans();
parameterLeak[0]["Query Parameters"] = "$1 = 'private'";
expectFailure(
  () => assertPublicSnapshotPlanEvidence(parameterLeak),
  /must omit every parameter payload/,
);

const tooManyRows = validPlans();
tooManyRows[0].Plan["Actual Rows"] = 2;
expectFailure(() => assertPublicSnapshotPlanEvidence(tooManyRows), /row cap/);

const repeatedExecution = validPlans();
repeatedExecution[0].Plan["Actual Loops"] = 2;
expectFailure(() => assertPublicSnapshotPlanEvidence(repeatedExecution), /must execute once/);

for (const key of ["Shared Written Blocks", "Temp Read Blocks"]) {
  const blockWrite = validPlans();
  blockWrite[0].Plan[key] = 1;
  expectFailure(() => assertPublicSnapshotPlanEvidence(blockWrite), new RegExp(key));
}

const mutation = validPlans();
mutation[0].Plan.Plans = [node("ModifyTable")];
expectFailure(() => assertPublicSnapshotPlanEvidence(mutation), /mutating or locking plan node/);

const sequentialScan = validPlans();
sequentialScan[3].Plan.Plans.push(node("Seq Scan", { relation: "leaderboard_snapshot_profiles" }));
expectFailure(
  () => assertPublicSnapshotPlanEvidence(sequentialScan),
  /sequentially scanned a bounded-index relation/,
);

const largePayloadScan = validPlans();
largePayloadScan[3].Plan.Plans.push(
  node("Seq Scan", {
    actualRows: 513,
    relation: "leaderboard_snapshot_pages",
  }),
);
expectFailure(
  () => assertPublicSnapshotPlanEvidence(largePayloadScan),
  /small-payload sequential row cap/,
);

const largeDimensionScan = validPlans();
largeDimensionScan[3].Plan.Plans.push(
  node("Seq Scan", {
    actualRows: 9,
    relation: "leaderboard_published_snapshots",
  }),
);
expectFailure(
  () => assertPublicSnapshotPlanEvidence(largeDimensionScan),
  /small-dimension sequential row cap/,
);

for (const indexName of ["leaderboard_snapshot_pages_pkey", "leaderboard_snapshot_profiles_pkey"]) {
  const missingIndex = validPlans();
  for (const entry of missingIndex) {
    const pending = [entry.Plan];
    while (pending.length > 0) {
      const candidate = pending.pop();
      if (candidate["Index Name"] === indexName) {
        candidate["Index Name"] = "unreviewed_index";
      }
      pending.push(...(candidate.Plans ?? []));
    }
  }
  expectFailure(
    () => assertPublicSnapshotPlanEvidence(missingIndex),
    /omitted an executed reviewed index or bounded scan/,
  );
}

const plannedOnlyIndex = validPlans();
plannedOnlyIndex[3].Plan.Plans[2]["Actual Loops"] = 0;
expectFailure(
  () => assertPublicSnapshotPlanEvidence(plannedOnlyIndex),
  /omitted an executed reviewed index or bounded scan/,
);

const missingBlockCounter = validPlans();
delete missingBlockCounter[0].Plan["Temp Written Blocks"];
expectFailure(
  () => assertPublicSnapshotPlanEvidence(missingBlockCounter),
  /reported Temp Written Blocks/,
);

const invalidChildren = validPlans();
invalidChildren[3].Plan.Plans = {};
expectFailure(
  () => assertPublicSnapshotPlanEvidence(invalidChildren),
  /child plans must be an array/,
);

const excessiveDepth = validPlans();
let deepPlan = node("Function Scan");
for (let depth = 0; depth < 33; depth += 1) {
  deepPlan = node("Result", { plans: [deepPlan] });
}
excessiveDepth[0].Plan = deepPlan;
expectFailure(() => assertPublicSnapshotPlanEvidence(excessiveDepth), /plan depth budget/);

const excessiveNodes = validPlans();
excessiveNodes[0].Plan = node("Result", {
  plans: Array.from({ length: 257 }, () => node("Function Scan")),
});
expectFailure(() => assertPublicSnapshotPlanEvidence(excessiveNodes), /plan-node budget/);

const nonObjectEntry = validPlans();
nonObjectEntry[0] = null;
expectFailure(() => assertPublicSnapshotPlanEvidence(nonObjectEntry), /entry must be an object/);

const braceInQuery = validPlans();
braceInQuery[0]["Query Text"] += ' /* { "escaped": "}\\\"" } */';
assert.equal(parse(renderLog(braceInQuery)).length, 6);

console.log(
  `Web snapshot query-plan evidence tests passed (${failClosedCaseCount} fail-closed cases plus the valid six-oracle catalog).`,
);
