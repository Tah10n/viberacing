import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const { version } = JSON.parse(
  readFileSync(new URL("../../../packages/connector/package.json", import.meta.url), "utf8"),
) as { version: string };
const hash = (value: string) => createHash("sha256").update(value).digest();

for (const width of [390, 1440]) {
  for (const scenario of [
    { status: "partial", period: "custom", resultCode: "partial_accounts_inactive" },
    { status: "succeeded", period: "custom", resultCode: "complete" },
    { status: "succeeded", period: "month", resultCode: "complete" },
    { status: "succeeded", period: "year", resultCode: "complete" },
  ]) {
    test(`Browser Sync ${scenario.status} refreshes ${scenario.period} at ${String(width)}px`, async ({
      page,
      request,
    }) => {
      const database = new Client({ connectionString: process.env.DATABASE_URL });
      await database.connect();
      const session = randomUUID();
      const deviceToken = randomUUID();
      const installationId = randomUUID();
      const accountIds = [randomUUID(), randomUUID()];
      const sourceIds = [randomUUID(), randomUUID()];
      const today = new Date().toISOString().slice(0, 10);
      const oldSync = "2026-01-01T00:00:00.000Z";
      let userId: string | undefined;
      try {
        const user = await database.query<{ id: string }>(
          "INSERT INTO users (github_id, handle) VALUES ($1, $2) RETURNING id::text",
          [String(Date.now()), `sync-${session.slice(0, 8)}`],
        );
        userId = user.rows[0]?.id;
        if (!userId) throw new Error("Missing synthetic user");
        await database.query(
          "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
          [hash(session), userId],
        );
        await database.query(
          `INSERT INTO installations (id, user_id, name, status, installation_secret_hash,
             device_token_hash, connector_version, protocol_version, browser_sync_capable,
             browser_sync_protocol, installed_connector_version, last_sync_at)
           VALUES ($1, $2, 'Sync test computer', 'active', $3, $4, $5, 3, true, 2, $5, $6)`,
          [installationId, userId, hash(randomUUID()), hash(deviceToken), version, oldSync],
        );
        for (const [index, accountId] of accountIds.entries()) {
          await database.query(
            `INSERT INTO agent_accounts (id, user_id, agent_id, label, aggregation_mode)
             VALUES ($1, $2, 'codex', $3, 'account_max')`,
            [accountId, userId, index === 0 ? "Active account" : "Inactive account"],
          );
          await database.query(
            `INSERT INTO installation_sources (id, installation_id, user_id, agent_account_id,
               agent_id, client_source_id, collection_method, supported_surface, status,
               last_successful_sync_at, last_completeness)
             VALUES ($1, $2, $3, $4, 'codex', $1::uuid::text, 'codex_app_server', 'cli', 'active', $5, 'complete')`,
            [sourceIds[index], installationId, userId, accountId, oldSync],
          );
          await database.query(
            `INSERT INTO daily_usage (source_id, usage_date, total_tokens, completeness)
             VALUES ($1, $2, $3, 'complete')`,
            [sourceIds[index], today, index === 0 ? "100" : "200"],
          );
        }
        const exploreHistory =
          width === 1440 && scenario.period === "custom" && scenario.status === "succeeded";
        if (exploreHistory) {
          await database.query(
            `INSERT INTO daily_agent_usage (usage_date, user_id, agent_id, tokens)
             VALUES ($1::date - 1, $2, 'codex', 10), ($1::date, $2, 'codex', 300)`,
            [today, userId],
          );
        }
        await page.context().addCookies([
          { name: "vr_session", value: session, url: "http://127.0.0.1:3015" },
          { name: "vr_local_installation", value: installationId, url: "http://127.0.0.1:3015" },
        ]);
        await page.setViewportSize({ width, height: 1000 });
        const query = new URLSearchParams({ period: scenario.period });
        if (scenario.period === "custom") {
          query.set("from", today);
          query.set("to", today);
        }
        const dashboardUrl = `http://127.0.0.1:3015/dashboard?${query.toString()}`;
        await page.goto(dashboardUrl);
        const active = page.locator(".account-disclosure .device-card").filter({
          has: page.getByRole("heading", { name: "Codex · Active account", exact: true }),
        });
        const inactive = page.locator(".account-disclosure .device-card").filter({
          has: page.getByRole("heading", { name: "Codex · Inactive account", exact: true }),
        });
        await expect(active.locator(".agent-chip").first()).toHaveText("100 tokens");
        await expect(inactive.locator(".agent-chip").first()).toHaveText("200 tokens");
        await expect(active.locator(".device-meta time")).toHaveAttribute("datetime", oldSync);
        const sync = page.getByRole("button", { name: "Sync all agents" });
        await expect(sync).toBeEnabled();
        // Simulate the connector's completion; usage goes through the real HTTP/SQL path.
        await page.route(/\/api\/accounts\/sync\/[^/]+$/, async (route) => {
          if (route.request().method() !== "GET") return route.continue();
          const usage = await request.post("/api/usage", {
            headers: { authorization: `Bearer ${deviceToken}` },
            data: {
              protocolVersion: 3,
              snapshots: [
                {
                  sourceId: sourceIds[0],
                  syncSequence: "1",
                  rangeStart: today,
                  rangeEnd: today,
                  completeness: "complete",
                  entries: [{ date: today, totalTokens: "456" }],
                },
              ],
            },
          });
          expect(usage.status()).toBe(200);
          if (exploreHistory) {
            await database.query(
              `INSERT INTO daily_agent_usage (usage_date, user_id, agent_id, tokens)
               VALUES ($1::date - 100, $2, 'codex', 25)
               ON CONFLICT (usage_date, user_id, agent_id) DO NOTHING`,
              [today, userId],
            );
          }
          await route.fulfill({
            json: { status: scenario.status, resultCode: scenario.resultCode },
          });
        });
        const historyChart = page.getByRole("figure", { name: "Tokens over time" });
        if (exploreHistory) {
          await historyChart.locator(".usage-explorer-canvas").hover();
          await page.mouse.wheel(0, 240);
          await expect(historyChart.locator(".usage-series-bar")).toHaveCount(2);
          await expect(
            historyChart.locator(".usage-values tbody tr").last().locator("td").last(),
          ).toHaveText("300");
        }
        await sync.click();
        await expect(active.locator(".agent-chip").first()).toHaveText("456 tokens");
        await expect(active.locator(".device-meta time")).not.toHaveAttribute("datetime", oldSync);
        await expect(inactive.locator(".agent-chip").first()).toHaveText("200 tokens");
        await expect(inactive.locator(".device-meta time")).toHaveAttribute("datetime", oldSync);
        await expect(page).toHaveURL(dashboardUrl);
        await expect(
          page.getByText(
            scenario.status === "partial"
              ? "Active accounts were synced. Switch Codex accounts to refresh the inactive ones."
              : "Sync complete.",
            { exact: true },
          ),
        ).toBeVisible();
        if (exploreHistory) {
          await expect(historyChart.locator(".usage-series-bar")).toHaveCount(2);
          await expect(
            historyChart.locator(".usage-values tbody tr").last().locator("td").last(),
          ).toHaveText("656");
        }
        await expect(sync).toBeEnabled();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        await page.screenshot({ path: test.info().outputPath("sync-result.png"), fullPage: true });
      } finally {
        if (userId) await database.query("DELETE FROM users WHERE id = $1", [userId]);
        await database.end();
      }
    });
  }
}
