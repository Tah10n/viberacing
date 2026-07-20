import assert from "node:assert/strict";

import {
  assertPublicCommunityPlanEvidence,
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
    "Actual Rows": options.actualRows ?? 2,
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

function validPlans() {
  return [
    plan(
      "SELECT score.* FROM viberacing_api.list_public_community_scores($1::date, $2::integer) AS score",
      node("Sort", { plans: [node("Function Scan")] }),
    ),
    plan(
      "SELECT race.* FROM viberacing_api.list_public_community_race($1::date, $2::integer) AS race",
      node("Sort", { plans: [node("Function Scan")] }),
    ),
    plan(
      "SELECT status.* FROM viberacing_api.list_public_community_race_status($1::date, $2::integer) AS status",
      node("Sort", { plans: [node("Function Scan")] }),
    ),
    plan(
      "WITH visible_entries AS MATERIALIZED (SELECT * FROM viberacing_private.season_entries) SELECT * FROM visible_entries",
      node("Limit", {
        plans: [
          node("Index Scan", { index: "season_entries_profile_history_idx" }),
          node("Index Scan", { index: "seasons_pkey" }),
        ],
      }),
    ),
    plan(
      "SELECT score_record.* FROM viberacing_api.list_public_community_scores(p_season_start, p_limit) AS score_record LEFT JOIN viberacing_private.profile_car_recipes AS recipe_record ON true",
      node("Sort", {
        plans: [node("Function Scan"), node("Index Scan", { index: "profile_car_recipes_pkey" })],
      }),
    ),
    plan(
      "SELECT race_record.* FROM viberacing_api.list_public_community_race(p_season_start, p_limit) AS race_record LEFT JOIN viberacing_private.finalized_season_profile_freshness ON true JOIN viberacing_private.source_day_values ON true JOIN viberacing_private.season_daily_scores ON true",
      node("Sort", {
        plans: [
          node("Function Scan"),
          node("Index Scan", { index: "finalized_season_profile_freshness_primary_key" }),
          node("Index Scan", { index: "source_day_values_date_idx" }),
          node("Bitmap Index Scan", { index: "codex_sources_profile_state_idx" }),
          node("Index Only Scan", {
            index: "season_daily_scores_positive_profile_date_idx",
          }),
        ],
      }),
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
assert.deepEqual(assertPublicCommunityPlanEvidence(parsed), { evidencedPlanCount: 6 });
assert.equal(parse(renderLog(validPlans(), "\r\n")).length, 6);

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
  () =>
    parseAutoExplainPlans(validLog, {
      maximumBytes: 128 * 1024,
      privateMarkers: Array.from({ length: 65 }, (_, index) => `marker-${index}`),
    }),
  /marker count must be non-zero and bounded/,
);
expectFailure(
  () =>
    parseAutoExplainPlans(validLog, {
      maximumBytes: 128 * 1024,
      privateMarkers: [""],
    }),
  /non-empty and bounded/,
);
expectFailure(
  () => parse(renderLog(Array.from({ length: 129 }, () => validPlans()[0])), 2 * 1024 * 1024),
  /too many auto_explain plans/,
);

for (let index = 0; index < 6; index += 1) {
  const missing = validPlans();
  missing.splice(index, 1);
  expectFailure(() => assertPublicCommunityPlanEvidence(missing), /plan evidence was not emitted/);
}

const parameterLeak = validPlans();
parameterLeak[0]["Query Parameters"] = "$1 = 'private'";
expectFailure(
  () => assertPublicCommunityPlanEvidence(parameterLeak),
  /must omit every parameter payload/,
);

const tooManyRows = validPlans();
tooManyRows[0].Plan["Actual Rows"] = 33;
expectFailure(() => assertPublicCommunityPlanEvidence(tooManyRows), /row cap/);

const repeatedExecution = validPlans();
repeatedExecution[0].Plan["Actual Loops"] = 2;
expectFailure(() => assertPublicCommunityPlanEvidence(repeatedExecution), /must execute once/);

for (const key of ["Shared Written Blocks", "Temp Read Blocks"]) {
  const blockWrite = validPlans();
  blockWrite[0].Plan[key] = 1;
  expectFailure(() => assertPublicCommunityPlanEvidence(blockWrite), new RegExp(key));
}

const mutation = validPlans();
mutation[0].Plan.Plans.push(node("ModifyTable"));
expectFailure(() => assertPublicCommunityPlanEvidence(mutation), /mutating or locking plan node/);

const sequentialScan = validPlans();
sequentialScan[3].Plan.Plans.push(node("Seq Scan", { relation: "season_entries" }));
expectFailure(
  () => assertPublicCommunityPlanEvidence(sequentialScan),
  /sequentially scanned a bounded-index relation/,
);

for (const indexName of [
  "season_entries_profile_history_idx",
  "seasons_pkey",
  "profile_car_recipes_pkey",
  "finalized_season_profile_freshness_primary_key",
  "source_day_values_date_idx",
  "codex_sources_profile_state_idx",
  "season_daily_scores_positive_profile_date_idx",
]) {
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
    () => assertPublicCommunityPlanEvidence(missingIndex),
    /omitted an executed reviewed index/,
  );
}

const plannedOnlyIndex = validPlans();
plannedOnlyIndex[3].Plan.Plans[0]["Actual Loops"] = 0;
expectFailure(
  () => assertPublicCommunityPlanEvidence(plannedOnlyIndex),
  /omitted an executed reviewed index/,
);

const repeatedBadPlan = validPlans();
const repeatedScoreAdapter = structuredClone(repeatedBadPlan[0]);
repeatedScoreAdapter.Plan["Temp Read Blocks"] = 1;
repeatedBadPlan.push(repeatedScoreAdapter);
expectFailure(
  () => assertPublicCommunityPlanEvidence(repeatedBadPlan),
  /reported Temp Read Blocks/,
);

const missingBlockCounter = validPlans();
delete missingBlockCounter[0].Plan["Temp Written Blocks"];
expectFailure(
  () => assertPublicCommunityPlanEvidence(missingBlockCounter),
  /reported Temp Written Blocks/,
);

const invalidChildren = validPlans();
invalidChildren[0].Plan.Plans = {};
expectFailure(
  () => assertPublicCommunityPlanEvidence(invalidChildren),
  /child plans must be an array/,
);

const excessiveDepth = validPlans();
let deepPlan = node("Function Scan");
for (let depth = 0; depth < 33; depth += 1) {
  deepPlan = node("Result", { plans: [deepPlan] });
}
excessiveDepth[0].Plan = deepPlan;
expectFailure(() => assertPublicCommunityPlanEvidence(excessiveDepth), /plan depth budget/);

const excessiveNodes = validPlans();
excessiveNodes[0].Plan = node("Sort", {
  plans: Array.from({ length: 257 }, () => node("Function Scan")),
});
expectFailure(() => assertPublicCommunityPlanEvidence(excessiveNodes), /plan-node budget/);

const nonObjectEntry = validPlans();
nonObjectEntry[0] = null;
expectFailure(() => assertPublicCommunityPlanEvidence(nonObjectEntry), /entry must be an object/);

const braceInQuery = validPlans();
braceInQuery[0]["Query Text"] += ' /* { "escaped": "}\\\"" } */';
assert.equal(parse(renderLog(braceInQuery)).length, 6);

console.log(
  `Web query-plan evidence tests passed (${failClosedCaseCount} fail-closed cases plus the valid oracle).`,
);
