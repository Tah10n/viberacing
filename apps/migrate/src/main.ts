import { runMigrationCommand } from "./command.js";

function failClosed(): void {
  try {
    process.stderr.write("Vibe Racing migrations failed.\n");
  } catch {
    // The nonzero process result remains authoritative if the output stream is unavailable.
  }
  process.exitCode = 1;
}

void runMigrationCommand(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
}, failClosed);
