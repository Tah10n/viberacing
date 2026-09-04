import { decodeCursorInput, maximumCursorInputBytes } from "./cursor-events.mjs";
import { readCursorLedger, recordCursorCapture } from "./cursor-ledger.mjs";
import { withCursorCaptureContext } from "./config.mjs";
import { lifecycleMutationActive, markDirtyIfConnected } from "./runtime.mjs";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const marker = new RegExp(`^--viberacing-cursor-hook-v1=(${uuid}):(${uuid})$`, "i");
const captureIdPattern = new RegExp(`^${uuid}$`, "i");
export function parseCursorHookRequest(values) {
  if (values.length !== 3 || values[0] !== "--event" || !["stop", "sessionEnd"].includes(values[1]))
    return null;
  const match = marker.exec(values[2]);
  return match
    ? {
        eventName: values[1],
        installationId: match[1].toLowerCase(),
        profileId: match[2].toLowerCase(),
      }
    : null;
}

/** Bounded memory and time; raw input only lives in this invocation's memory. */
export function readCursorHookInput(stream, { timeoutMs = 2_000 } = {}) {
  return new Promise((resolve) => {
    let size = 0;
    let overflow = false;
    let finished = false;
    const chunks = [];
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("end", finish);
      stream.off("error", finish);
      stream.on("error", () => {});
      stream.pause();
      let value = {};
      if (!overflow && stream.readableEnded) {
        try {
          value = decodeCursorInput(Buffer.concat(chunks, size));
        } catch {}
      }
      resolve(value);
    };
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maximumCursorInputBytes) {
        overflow = true;
        chunks.length = 0;
      }
      if (!overflow) chunks.push(bytes);
    };
    const timer = setTimeout(finish, timeoutMs);
    stream.on("data", onData);
    stream.once("end", finish);
    stream.once("error", finish);
    stream.resume();
  });
}

/** Called by the CLI hook dispatcher; it does no networking and creates no connection state. */
export async function captureCursorHook(
  request,
  payload,
  capturedAt,
  { environment = process.env } = {},
) {
  if (!request || (await lifecycleMutationActive())) return false;
  return withCursorCaptureContext(request, async ({ source, salt, stateRoot }) => {
    if (await lifecycleMutationActive()) return false;
    const captureId = environment.VIBERACING_CURSOR_HEADLESS_CAPTURE_ID;
    let owned = false;
    if (captureIdPattern.test(captureId ?? "")) {
      const ledger = await readCursorLedger(stateRoot, source.clientSourceId, capturedAt);
      owned = ledger.headlessCaptureIds.includes(captureId);
    }
    if (request.eventName === "sessionEnd" && !owned) return false;
    // A foreign or stale headless marker must never suppress an ordinary captured event.
    const result = await recordCursorCapture(stateRoot, source.clientSourceId, {
      kind: request.eventName === "stop" ? "stop" : "binding",
      payload,
      salt,
      capturedAt,
      captureId,
      headlessOwned: owned,
    });
    if (result.status === "suppressed") return false;
    return markDirtyIfConnected(source.clientSourceId, "cursor", new Date(capturedAt));
  });
}
