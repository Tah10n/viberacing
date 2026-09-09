// Test-only preload, inherited by Node children. No command arguments or paths are recorded.
const { ChildProcess } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { performance } = require("node:perf_hooks");
const { randomUUID } = require("node:crypto");

const directory = process.env.VIBERACING_CI_PROCESS_PROFILE;
if (directory) {
  const metrics = {
    powershell: { calls: 0, completed: 0, elapsedMs: 0 },
    other: { calls: 0, completed: 0, elapsedMs: 0 },
  };
  const originalSpawn = ChildProcess.prototype.spawn;
  ChildProcess.prototype.spawn = function (options) {
    const executable = String(options.file).split(/[\\/]/).at(-1);
    const category = /^(powershell|pwsh)(\.exe)?$/i.test(executable) ? "powershell" : "other";
    const metric = metrics[category];
    const started = performance.now();
    const result = originalSpawn.apply(this, arguments);
    metric.calls++;
    this.once("close", () => {
      metric.completed++;
      metric.elapsedMs += performance.now() - started;
    });
    return result;
  };
  process.once("exit", () => {
    if (metrics.powershell.calls + metrics.other.calls === 0) return;
    try {
      writeFileSync(join(directory, `${randomUUID()}.json`), JSON.stringify(metrics));
    } catch {
      // Optional diagnostics must not replace the test process's exit status.
      process.stderr.write("Windows CI subprocess timing could not be written.\n");
    }
  });
}
