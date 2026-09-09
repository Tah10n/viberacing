import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const directory = process.env.VIBERACING_CI_PROCESS_PROFILE;
if (!directory) {
  console.log("Windows subprocess timing was not enabled.");
} else {
  const totals = {
    powershell: { calls: 0, completed: 0, elapsedMs: 0 },
    other: { calls: 0, completed: 0, elapsedMs: 0 },
  };
  for (const file of readdirSync(directory).filter((file) => file.endsWith(".json"))) {
    const metrics = JSON.parse(readFileSync(join(directory, file), "utf8"));
    for (const category of Object.keys(totals)) {
      for (const field of Object.keys(totals[category])) {
        const value = metrics[category]?.[field];
        if (!Number.isFinite(value) || value < 0) throw new Error("Invalid process timing metric");
        totals[category][field] += value;
      }
    }
  }
  const lines = [
    "### Windows asynchronous subprocess timing",
    "",
    "| Process | Calls | Completed | Summed elapsed seconds |",
    "| --- | ---: | ---: | ---: |",
    ...Object.entries(totals).map(
      ([category, metric]) =>
        `| ${category} | ${metric.calls} | ${metric.completed} | ${(metric.elapsedMs / 1000).toFixed(1)} |`,
    ),
    "",
    "Elapsed durations can overlap and are not CPU time. Counts cover asynchronous child processes " +
      "inheriting the test preload, including execFile; synchronous subprocesses are excluded. " +
      "Unfinished calls can include intentional termination tests.",
  ];
  const summary = `${lines.join("\n")}\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
