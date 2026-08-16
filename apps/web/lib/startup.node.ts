import { writeSync } from "node:fs";

export function exitInvalidRuntimeConfiguration(record: string): never {
  try {
    writeSync(2, `${record}\n`);
  } finally {
    process.exit(1);
  }
}
