import { runJobsCli } from "./command.js";

function failClosed(): void {
  try {
    process.stderr.write("Vibe Racing Jobs command failed.\n");
  } catch {
    // The nonzero process result remains authoritative if the output stream is unavailable.
  }
  process.exitCode = 1;
}

void runJobsCli(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
}, failClosed);
