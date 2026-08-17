import { readConfig } from "../lib/config.mjs";
import { disableLocalConnection } from "../lib/connection-lifecycle.mjs";
import { withLifecycleMutation } from "../lib/runtime.mjs";

const action = process.argv[2];

if (action === "recover") {
  await readConfig();
} else if (action === "recover-optional") {
  await readConfig().catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
} else if (action === "disconnect-local") {
  await withLifecycleMutation(() => disableLocalConnection(true));
} else {
  throw new Error("Unsupported connection-state child action");
}
