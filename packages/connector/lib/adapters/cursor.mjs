import { collectJsonl, diagnosePath } from "./shared.mjs";

export function parseCursorLines(_lines) {
  return [];
}

export const cursorAdapter = Object.freeze({
  id: "cursor",
  displayName: "Cursor CLI",
  supportedSurfaces: ["cli"],
  collectionMethods: ["cursor_cli_capture"],
  aggregationMode: "source_sum",
  exactAccounting: false,
  trigger: "viberacing run cursor",
  defaultPaths: [],
  detect: async () => [],
  collect: (source, range, state) =>
    collectJsonl(source, parseCursorLines, () => true, state, range),
  parseCapture: parseCursorLines,
  diagnose: (source) => diagnosePath(source, ["Cursor Desktop usage"]),
});
