import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SyncRecovery } from "./sync-recovery";

describe("Sync recovery guidance", () => {
  it("explains custom-state limits before offering commands for the selected installation", () => {
    const markup = renderToStaticMarkup(
      <SyncRecovery
        computer="Computer 1"
        connectCommand="connector connect"
        repairCommand="connector doctor --repair"
        syncCommand="connector sync"
      />,
    );
    const text = markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

    expect(text).toContain("VIBERACING_STATE_DIR , keep it set to that same value");
    expect(text).toContain("Omitting it selects the default installation");
    expect(text).toContain("Browser Sync is unavailable for custom state directories.");
    expect(text).toContain("Repairing or reconnecting cannot enable it there.");
    expect(text.indexOf("VIBERACING_STATE_DIR")).toBeLessThan(text.indexOf("connector sync"));
    expect(text.indexOf("Restore Browser Sync for the default installation")).toBeLessThan(
      text.indexOf("connector doctor --repair"),
    );
    expect(text).toContain("Copy sync command");
    expect(text).toContain("Copy repair command");
    expect(text).toContain("Copy reconnect command");
  });
});
