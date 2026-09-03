import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

const connectorPackage = JSON.parse(
  readFileSync(new URL("../../../packages/connector/package.json", import.meta.url), "utf8"),
) as { version: string };
const bundledConnectorVersion = connectorPackage.version;

let oauthServer: Server;
const handle = `e2e-racer-${String(Date.now()).slice(-8)}`;

interface PairingStartResponse {
  verificationUrl: string;
  pollToken: string;
}

interface ActivePairingResponse {
  status: "active";
  deviceToken: string;
  sources: Array<{ sourceId: string }>;
  protocol: { version: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPairingStartResponse(value: unknown): value is PairingStartResponse {
  return (
    isRecord(value) &&
    typeof value.verificationUrl === "string" &&
    typeof value.pollToken === "string"
  );
}

function isActivePairingResponse(value: unknown): value is ActivePairingResponse {
  return (
    isRecord(value) &&
    value.status === "active" &&
    typeof value.deviceToken === "string" &&
    isRecord(value.protocol) &&
    value.protocol.version === 3 &&
    Array.isArray(value.sources) &&
    value.sources.length === 1 &&
    value.sources.every((source) => isRecord(source) && typeof source.sourceId === "string")
  );
}

async function expectLeftAlignedHero(page: Page): Promise<void> {
  const alignment = await page.locator(".hero-primary").evaluate((hero) => {
    const style = (selector: string): CSSStyleDeclaration => {
      const element = hero.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
      return getComputedStyle(element);
    };

    return {
      copyJustification: style(".hero-copy").justifyContent,
      copyText: style(".hero-copy").textAlign,
      positionText: style(".user-callout").textAlign,
      tokenMargin: style(".user-score-line strong").marginLeft,
      raceText: style(".hero-race").textAlign,
    };
  });

  expect(alignment).toEqual({
    copyJustification: "flex-start",
    copyText: "left",
    positionText: "left",
    tokenMargin: "0px",
    raceText: "left",
  });
}

async function expectConsistentMobileHeroBlocks(page: Page): Promise<void> {
  const blocks = await page.locator(".hero").evaluate((hero) =>
    [".user-callout", ".hero-race", ".hero-agents", ".hero-privacy"].map((selector) => {
      const element = hero.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
      const style = getComputedStyle(element);
      return {
        alignItems: style.alignItems,
        flexDirection: style.flexDirection,
        gap: style.gap,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    }),
  );

  expect(blocks).toEqual(
    Array.from({ length: 4 }, () => ({
      alignItems: "start",
      flexDirection: "column",
      gap: "4px",
      paddingLeft: "16px",
      paddingRight: "16px",
    })),
  );
}

test.beforeAll(async () => {
  oauthServer = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:3016");
    if (url.pathname === "/login/oauth/authorize") {
      const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
      callback.searchParams.set("code", "synthetic-e2e-code");
      callback.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.writeHead(302, { location: callback.href });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    if (url.pathname === "/login/oauth/access_token") {
      response.end(JSON.stringify({ access_token: "synthetic-e2e-access-token" }));
      return;
    }
    if (url.pathname === "/user") {
      response.end(
        JSON.stringify({ id: 8_000_000_000 + Number(String(Date.now()).slice(-7)), login: handle }),
      );
      return;
    }
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve, reject) => {
    oauthServer.once("error", reject);
    oauthServer.listen(3016, "127.0.0.1", resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    oauthServer.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
});

test("OAuth, pairing, dashboard mutations, mobile keyboard flow, and accessibility", async ({
  page,
  request,
}) => {
  await page.goto("/api/auth/github/start?next=/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(`Signed in as @${handle}`)).toBeVisible();
  await page.goto("/?accountDeleted=1");
  await expect(
    page.getByRole("heading", { name: "Remove the connector from your computers" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".app-nav").getByRole("link", { name: `@${handle}`, exact: true }),
  ).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  const favicon = await request.get("/favicon.svg");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toContain("image/svg+xml");
  const expectedConnectCommand =
    "npx --yes @viberacing/connector@latest connect --origin http://127.0.0.1:3015";
  const connectCommand = page.locator(".connect-command pre code");
  await expect(connectCommand).toHaveText(expectedConnectCommand);
  await expect(connectCommand).not.toContainText("downloads/");
  await expect(connectCommand).not.toContainText("--package");
  await expect(connectCommand).not.toContainText("--allow-remote");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy connect command" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(expectedConnectCommand);

  const installationId = randomUUID();
  const clientSourceId = randomUUID();
  const start = await request.post("/api/pairing/start", {
    data: {
      protocolVersion: 3,
      connectorVersion: "0.4.3",
      browserSyncCapable: true,
      browserSyncProtocol: 1,
      installedRuntimeVersion: "0.4.3",
      installationId,
      installationSecret: "synthetic_e2e_installation_secret_123456",
      sources: [
        {
          clientSourceId,
          agentId: "antigravity",
          collectionMethod: "antigravity_cli_capture",
          supportedSurface: "cli",
          suggestedLabel: "E2E",
        },
      ],
      supersededClientSourceIds: [],
    },
  });
  expect(start.status()).toBe(201);
  const pairing: unknown = await start.json();
  expect(isPairingStartResponse(pairing)).toBe(true);
  if (!isPairingStartResponse(pairing)) throw new Error("invalid pairing start response");

  await page.goto(pairing.verificationUrl);
  await expect(page.getByRole("heading", { name: "Approve this computer" })).toBeVisible();
  await page.getByLabel("Label for a new account").fill("Browser E2E");
  await page.getByRole("button", { name: `Approve for @${handle}` }).click();
  await expect(page).toHaveURL(/\/dashboard\?connected=1$/);

  const poll = await request.post("/api/pairing/poll", {
    data: { installationId, pollToken: pairing.pollToken },
  });
  expect(poll.status()).toBe(200);
  const active: unknown = await poll.json();
  expect(isActivePairingResponse(active)).toBe(true);
  if (!isActivePairingResponse(active)) throw new Error("invalid active pairing response");
  const mapped = active.sources[0];
  if (mapped === undefined) throw new Error("active pairing omitted its source mapping");
  const today = new Date().toISOString().slice(0, 10);
  const todayLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${today}T00:00:00.000Z`));
  const usage = await request.post("/api/usage", {
    headers: { authorization: `Bearer ${active.deviceToken}` },
    data: {
      protocolVersion: 3,
      snapshots: [
        {
          sourceId: mapped.sourceId,
          syncSequence: "1",
          rangeStart: today,
          rangeEnd: today,
          completeness: "complete",
          entries: [
            {
              date: today,
              totalTokens: "12345",
              inputTokens: "7000",
              outputTokens: "3000",
              cacheReadTokens: "1500",
              cacheWriteTokens: "500",
              reasoningTokens: "345",
            },
          ],
        },
      ],
      sourceErrors: [],
    },
  });
  expect(usage.status()).toBe(200);

  await page.reload();
  await expect(page.getByText(/12[.,]3K tokens/)).toBeVisible();
  await expect(page.locator(".connector-update")).toBeVisible();
  const localSyncTimes = page.locator(".device-meta time");
  await expect(localSyncTimes).toHaveCount(2);
  await expect(localSyncTimes.first()).toHaveAttribute("title", "America/New_York");

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error("DATABASE_URL is required for browser E2E");
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    await database.query(
      "UPDATE installations SET installed_connector_version = $1 WHERE id = $2",
      ["0.1.9", installationId],
    );
  } finally {
    await database.end();
  }
  await page.reload();
  const connectorUpdate = page.locator(".connector-update");
  await expect(
    connectorUpdate.getByText("Connector update required", { exact: true }),
  ).toBeVisible();
  await expect(connectorUpdate.locator("code")).toHaveText(
    "npx --yes @viberacing/connector@latest doctor --repair",
  );
  await expect(connectorUpdate.locator("code")).not.toContainText(bundledConnectorVersion);
  await expect(connectorUpdate.locator("code")).not.toContainText("--package");
  await expect(connectorUpdate.locator("code")).not.toContainText("--allow-remote");
  await expect(connectorUpdate.getByRole("button", { name: "Copy update command" })).toBeVisible();
  await page.goto("/");
  const homeConnectorUpdate = page.locator(".connector-update-prominent");
  await expect(
    homeConnectorUpdate.getByText("Connector update required", { exact: true }),
  ).toBeVisible();
  await expect(homeConnectorUpdate.locator("code")).toHaveText(
    "npx --yes @viberacing/connector@latest doctor --repair",
  );
  await expect(
    homeConnectorUpdate.getByRole("button", { name: "Copy update command" }),
  ).toBeVisible();
  await page.goto("/dashboard");
  const usageChart = page.getByRole("figure", { name: "Tokens by day" });
  await expect(usageChart.locator(".usage-values tbody tr")).toHaveCount(7);
  await expect(page.locator(".summary-grid > div")).toHaveCount(4);
  const desktopSummaryColumns = await page
    .locator(".summary-grid")
    .evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean),
    );
  expect(desktopSummaryColumns).toHaveLength(4);
  await expect(usageChart.locator(".usage-grid-line")).toHaveCount(3);
  await usageChart.getByText("Daily UTC values", { exact: true }).click();
  const todayRow = usageChart.getByRole("row", { name: new RegExp(todayLabel) });
  await expect(todayRow).toContainText(/12\s345/);
  await expect(page.locator(".summary-grid").getByText(/12[.,]3K/, { exact: true })).toBeVisible();
  await expect(page.locator(".connector-history-notice")).toContainText(
    "Update the connector to import current-year history",
  );

  await page.getByRole("link", { name: "Month", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\?period=month$/);
  await expect(page.getByRole("link", { name: "Month", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const monthChart = page.getByRole("figure", { name: "Tokens by day" });
  const [year, month] = today.split("-").map(Number);
  const daysInCurrentMonth = new Date(Date.UTC(year ?? 0, month ?? 0, 0)).getUTCDate();
  await expect(monthChart.locator(".usage-values tbody tr")).toHaveCount(daysInCurrentMonth);
  const viewport = monthChart.locator(".usage-explorer-controls output");
  const fullMonthViewport = await viewport.textContent();
  await monthChart.getByRole("button", { name: "Zoom in on usage chart" }).click();
  await expect(viewport).not.toHaveText(fullMonthViewport ?? "");
  const chartCanvas = monthChart.locator(".usage-explorer-canvas");
  await chartCanvas.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Home");
  await expect(viewport).toHaveText(fullMonthViewport ?? "");
  await page.getByRole("link", { name: "Week", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\?period=week$/);

  const dedupDatabase = new Client({ connectionString: databaseUrl });
  await dedupDatabase.connect();
  try {
    const target = await dedupDatabase.query<{
      agent_id: string;
      aggregation_mode: string;
      target_account_id: string;
      user_id: string;
    }>(
      `SELECT account.agent_id,
              account.aggregation_mode,
              account.id::text AS target_account_id,
              source.user_id::text
         FROM installation_sources source
         JOIN agent_accounts account ON account.id = source.agent_account_id
        WHERE source.id = $1`,
      [mapped.sourceId],
    );
    const targetAccount = target.rows[0];
    expect(targetAccount).toBeDefined();
    if (targetAccount === undefined) throw new Error("missing E2E target account");

    const codexAccountId = randomUUID();
    const codexSourceId = randomUUID();
    await dedupDatabase.query(
      `INSERT INTO agent_accounts
         (id, user_id, agent_id, label, aggregation_mode)
       VALUES ($1, $2, 'codex', 'Codex E2E', 'account_max')`,
      [codexAccountId, targetAccount.user_id],
    );
    await dedupDatabase.query(
      `INSERT INTO installation_sources
         (id, installation_id, user_id, agent_account_id, agent_id, client_source_id,
          collection_method, supported_surface, suggested_label, status)
       VALUES ($1, $2, $3, $4, 'codex', $5, 'codex_app_server', 'desktop', 'Codex', 'active')`,
      [codexSourceId, installationId, targetAccount.user_id, codexAccountId, randomUUID()],
    );

    await page.reload();
    const codexHookNotice = page.locator(".codex-hook-notice");
    await expect(codexHookNotice).toHaveCount(0);

    await dedupDatabase.query(
      "UPDATE installation_sources SET last_successful_sync_at = now() WHERE id = $1",
      [codexSourceId],
    );
    await page.reload();
    await expect(codexHookNotice).toContainText("CODEX AUTOMATIC SYNC");
    await expect(codexHookNotice).toContainText("Manual Codex sync is working.");
    await expect(codexHookNotice).toContainText("Settings → Hooks");
    await expect(codexHookNotice).toContainText("Alternatively, run /hooks.");
    await expect(codexHookNotice.locator("code")).toHaveText("/hooks");
    await expect(codexHookNotice.getByRole("button", { name: /copy/i })).toHaveCount(0);
    const hookDismissButton = codexHookNotice.getByRole("button", { name: "Dismiss" });
    await expect(hookDismissButton).toBeVisible();
    const hookDismissBox = await hookDismissButton.boundingBox();
    expect(hookDismissBox).not.toBeNull();
    if (hookDismissBox !== null) {
      expect(hookDismissBox.width).toBeGreaterThanOrEqual(44);
      expect(hookDismissBox.height).toBeGreaterThanOrEqual(44);
    }
    await hookDismissButton.click();
    await expect(codexHookNotice).toHaveCount(0);
    await page.reload();
    await expect(codexHookNotice).toHaveCount(0);

    const hookNoticeState = await dedupDatabase.query<{ dismissed: boolean }>(
      `SELECT codex_hook_notice_dismissed_at IS NOT NULL AS dismissed
         FROM installation_sources
        WHERE id = $1`,
      [codexSourceId],
    );
    expect(hookNoticeState.rows[0]).toEqual({ dismissed: true });

    await dedupDatabase.query("DELETE FROM installation_sources WHERE id = $1", [codexSourceId]);
    await dedupDatabase.query("DELETE FROM agent_accounts WHERE id = $1", [codexAccountId]);
    await page.reload();

    const previousAccountId = randomUUID();
    const dedupEventId = randomUUID();
    await dedupDatabase.query(
      `INSERT INTO agent_accounts
         (id, user_id, agent_id, label, aggregation_mode, merged_into_account_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        previousAccountId,
        targetAccount.user_id,
        targetAccount.agent_id,
        "Matched E2E account",
        targetAccount.aggregation_mode,
        targetAccount.target_account_id,
      ],
    );
    await dedupDatabase.query(
      `INSERT INTO account_dedup_events
         (id, user_id, agent_id, source_id, previous_account_id, target_account_id,
          matched_days, status)
       VALUES ($1, $2, $3, $4, $5, $6, 3, 'active')`,
      [
        dedupEventId,
        targetAccount.user_id,
        targetAccount.agent_id,
        mapped.sourceId,
        previousAccountId,
        targetAccount.target_account_id,
      ],
    );

    await page.reload();
    const dedupNotice = page.locator(".dedup-notice");
    await expect(dedupNotice).toContainText("AUTOMATIC ACCOUNT MATCH");
    await expect(dedupNotice.getByRole("button", { name: "Undo automatic match" })).toBeVisible();
    const dismissButton = dedupNotice.getByRole("button", { name: "Dismiss" });
    await expect(dismissButton).toBeVisible();
    const dismissBox = await dismissButton.boundingBox();
    expect(dismissBox).not.toBeNull();
    if (dismissBox !== null) {
      expect(dismissBox.width).toBeGreaterThanOrEqual(44);
      expect(dismissBox.height).toBeGreaterThanOrEqual(44);
    }
    await dismissButton.click();
    await expect(dedupNotice).toHaveCount(0);
    await page.reload();
    await expect(dedupNotice).toHaveCount(0);

    const dismissed = await dedupDatabase.query<{
      current_account_id: string;
      dismissed: boolean;
      merged_into_account_id: string;
      status: string;
    }>(
      `SELECT event.status,
              event.dismissed_at IS NOT NULL AS dismissed,
              source.agent_account_id::text AS current_account_id,
              previous.merged_into_account_id::text
         FROM account_dedup_events event
         JOIN installation_sources source ON source.id = event.source_id
         JOIN agent_accounts previous ON previous.id = event.previous_account_id
        WHERE event.id = $1`,
      [dedupEventId],
    );
    expect(dismissed.rows[0]).toEqual({
      current_account_id: targetAccount.target_account_id,
      dismissed: true,
      merged_into_account_id: targetAccount.target_account_id,
      status: "active",
    });

    const matchHistory = page.locator(".account-match-history");
    await expect(matchHistory.locator("summary")).toContainText("Automatic matches · 1 match");
    await matchHistory.locator("summary").click();
    const durableUndo = matchHistory.getByRole("button", { name: "Undo automatic match" });
    await expect(durableUndo).toBeVisible();
    await durableUndo.click();
    await expect(
      page.getByText("Automatic account match undone. These totals are separate again."),
    ).toBeVisible();

    const undone = await dedupDatabase.query<{
      current_account_id: string;
      merged_into_account_id: string | null;
      status: string;
    }>(
      `SELECT event.status,
              source.agent_account_id::text AS current_account_id,
              previous.merged_into_account_id::text
         FROM account_dedup_events event
         JOIN installation_sources source ON source.id = event.source_id
         JOIN agent_accounts previous ON previous.id = event.previous_account_id
        WHERE event.id = $1`,
      [dedupEventId],
    );
    expect(undone.rows[0]).toEqual({
      current_account_id: previousAccountId,
      merged_into_account_id: null,
      status: "undone",
    });

    await dedupDatabase.query(
      "UPDATE installation_sources SET agent_account_id = $1 WHERE id = $2",
      [targetAccount.target_account_id, mapped.sourceId],
    );
    await dedupDatabase.query("DELETE FROM account_dedup_events WHERE id = $1", [dedupEventId]);
    await dedupDatabase.query("DELETE FROM agent_accounts WHERE id = $1", [previousAccountId]);
    await page.goto("/dashboard");
  } finally {
    await dedupDatabase.end();
  }

  const tokenBreakdown = page.locator('dl[aria-label="Token breakdown for selected period"]');
  await expect(tokenBreakdown.locator("div")).toHaveText([
    "Input7K",
    "Output3K",
    "Cached2K",
    "Reasoning345",
  ]);
  await expect(
    page.getByRole("heading", { name: "Only exact aggregate token counters cross the boundary" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync all agents" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync all agents" })).toBeDisabled();
  const accountDisclosure = page.locator(".account-disclosure");
  await expect(accountDisclosure).toHaveAttribute("open", "");
  await accountDisclosure.locator("summary").click();
  await expect(accountDisclosure).not.toHaveAttribute("open", "");
  await expect(accountDisclosure.locator(".device-list")).not.toBeVisible();
  await accountDisclosure.locator("summary").click();
  await expect(accountDisclosure.locator(".device-list")).toBeVisible();
  const featureDatabase = new Client({ connectionString: databaseUrl });
  await featureDatabase.connect();
  try {
    await featureDatabase.query(
      `UPDATE installations
          SET installed_connector_version = $1,
              browser_sync_protocol = $2
        WHERE id = $3`,
      ["0.4.3", 1, installationId],
    );
    await page.reload();
    await expect(page.getByRole("button", { name: "Sync all agents" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync all agents" })).toBeDisabled();
    await expect(page.locator(".connector-update")).toBeVisible();
    await featureDatabase.query(
      "UPDATE installations SET browser_sync_protocol = $1 WHERE id = $2",
      [2, installationId],
    );
    await page.reload();
    await expect(page.getByRole("button", { name: "Sync all agents" })).toBeVisible();
    await expect(page.locator(".connector-update")).toHaveCount(0);
    await featureDatabase.query(
      "UPDATE installations SET installed_connector_version = $1 WHERE id = $2",
      ["0.1.9", installationId],
    );
  } finally {
    await featureDatabase.end();
  }
  await page.getByText("Manage account").click();
  const accountDeleteForm = page.locator(".account-delete-form");
  const [confirmationBox, deleteButtonBox] = await Promise.all([
    accountDeleteForm.getByText("Delete linked sources and usage").boundingBox(),
    accountDeleteForm.getByRole("button", { name: "Delete account" }).boundingBox(),
  ]);
  expect(confirmationBox).not.toBeNull();
  expect(deleteButtonBox).not.toBeNull();
  if (confirmationBox !== null && deleteButtonBox !== null) {
    const confirmationCenter = confirmationBox.y + confirmationBox.height / 2;
    const buttonCenter = deleteButtonBox.y + deleteButtonBox.height / 2;
    expect(Math.abs(confirmationCenter - buttonCenter)).toBeLessThanOrEqual(1);
  }
  await page.getByLabel("Account label").fill("Renamed E2E");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText(/Renamed E2E/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.goto("/");
  await expectLeftAlignedHero(page);
  await expect(page.locator(".hero-race")).toContainText("This week");
  await expect(page.locator(".hero-race")).toContainText("UTC");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expectLeftAlignedHero(page);
  await expectConsistentMobileHeroBlocks(page);
  await expect(page.getByText("Self-reported", { exact: true }).first()).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(`@${handle}`) });
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Self-reported")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.goto("/dashboard");
  await expect(page.locator(".connector-update")).toBeVisible();
  await expect(page.locator(".usage-values tbody tr")).toHaveCount(7);
  const mobileSummaryBoxes = await page.locator(".summary-grid > div").evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: Math.round(box.left), top: Math.round(box.top) };
    }),
  );
  expect(mobileSummaryBoxes).toHaveLength(4);
  expect(new Set(mobileSummaryBoxes.map((box) => box.left)).size).toBe(2);
  expect(new Set(mobileSummaryBoxes.map((box) => box.top)).size).toBe(2);
  const [usagePlotBox, usageSvgBox] = await Promise.all([
    page.locator(".usage-explorer-canvas").boundingBox(),
    page.locator(".usage-explorer-canvas svg").boundingBox(),
  ]);
  expect(usagePlotBox).not.toBeNull();
  expect(usageSvgBox).not.toBeNull();
  if (usagePlotBox !== null && usageSvgBox !== null) {
    expect(usageSvgBox.x).toBeGreaterThanOrEqual(usagePlotBox.x);
    expect(usageSvgBox.x + usageSvgBox.width).toBeLessThanOrEqual(
      usagePlotBox.x + usagePlotBox.width,
    );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const oneOffReconciliation = await request.post("/api/installations/current", {
    headers: { authorization: `Bearer ${active.deviceToken}` },
    data: {
      sourceIds: [mapped.sourceId],
      cliVersion: bundledConnectorVersion,
    },
  });
  expect(oneOffReconciliation.status()).toBe(200);
  await page.reload();
  await expect(page.locator(".connector-update")).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".connector-update-prominent")).toBeVisible();

  const handlerAttestationId = randomUUID();
  const attestedReconciliation = await request.post("/api/installations/current", {
    headers: { authorization: `Bearer ${active.deviceToken}` },
    data: {
      sourceIds: [mapped.sourceId],
      cliVersion: bundledConnectorVersion,
      protocolVersion: 5,
      handlerAttestation: {
        attestationId: handlerAttestationId,
        installedRuntimeVersion: bundledConnectorVersion,
        browserSyncProtocol: 2,
      },
    },
  });
  expect(attestedReconciliation.status()).toBe(200);
  expect(await attestedReconciliation.json()).toMatchObject({
    acceptedHandlerAttestationId: handlerAttestationId,
  });
  await page.goto("/dashboard");
  await expect(page.locator(".connector-update")).toHaveCount(0);
  await expect(page.locator(".connector-history-notice")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sync all agents" })).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".connector-update-prominent")).toHaveCount(0);
  const missingHandlerAttestationId = randomUUID();
  const missingHandlerReconciliation = await request.post("/api/installations/current", {
    headers: { authorization: `Bearer ${active.deviceToken}` },
    data: {
      sourceIds: [mapped.sourceId],
      cliVersion: bundledConnectorVersion,
      handlerAttestation: {
        attestationId: missingHandlerAttestationId,
        installedRuntimeVersion: null,
        browserSyncProtocol: 0,
      },
    },
  });
  expect(missingHandlerReconciliation.status()).toBe(200);
  expect(await missingHandlerReconciliation.json()).toMatchObject({
    acceptedHandlerAttestationId: missingHandlerAttestationId,
  });
  const missingHandlerDatabase = new Client({ connectionString: databaseUrl });
  await missingHandlerDatabase.connect();
  try {
    const missingHandlerState = await missingHandlerDatabase.query<{
      browser_sync_protocol: number;
      installed_connector_version: string | null;
    }>(
      `SELECT installed_connector_version, browser_sync_protocol
         FROM installations
        WHERE id = $1`,
      [installationId],
    );
    expect(missingHandlerState.rows[0]).toEqual({
      installed_connector_version: null,
      browser_sync_protocol: 0,
    });
  } finally {
    await missingHandlerDatabase.end();
  }
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Sync all agents" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync all agents" })).toBeDisabled();
  await expect(page.locator(".connector-update")).toBeVisible();
  await expect(page.locator(".connector-update code")).toHaveText(
    "npx --yes @viberacing/connector@latest doctor --repair",
  );
  await page.goto("/");
  await expect(page.locator(".connector-update-prominent")).toBeVisible();
  await expect(page.locator(".connector-update-prominent code")).toHaveText(
    "npx --yes @viberacing/connector@latest doctor --repair",
  );
  await page.goto("/dashboard");
  const uninstallCommand = "npx --yes @viberacing/connector@latest uninstall";
  const cleanupDisclosure = page.locator(".account-deletion-cleanup");
  await expect(cleanupDisclosure.getByText("Local cleanup required")).toBeVisible();
  await expect(cleanupDisclosure).not.toHaveAttribute("open", "");
  await expect(cleanupDisclosure.locator("pre code")).not.toBeVisible();
  await cleanupDisclosure.locator("summary").click();
  await expect(cleanupDisclosure).toHaveAttribute("open", "");
  await expect(page.locator(".account-deletion-cleanup pre code")).toHaveText(uninstallCommand);
  await expect(page.locator(".account-deletion-cleanup")).toContainText("VIBERACING_STATE_DIR");
  await expect(page.getByRole("button", { name: "Copy uninstall command" })).toBeVisible();
  const leaveConfirmation = page.getByLabel("I understand that my ranking data will be deleted.");
  const accountDeletionConfirmation = page.getByLabel(
    "I understand that server data will be permanently deleted and every local connector installation must be uninstalled separately.",
  );
  const [leaveConfirmationBox, accountDeletionConfirmationBox] = await Promise.all([
    leaveConfirmation.boundingBox(),
    accountDeletionConfirmation.boundingBox(),
  ]);
  expect(leaveConfirmationBox).not.toBeNull();
  expect(accountDeletionConfirmationBox).not.toBeNull();
  if (leaveConfirmationBox !== null && accountDeletionConfirmationBox !== null) {
    expect(leaveConfirmationBox.width).toBe(accountDeletionConfirmationBox.width);
    expect(leaveConfirmationBox.height).toBe(accountDeletionConfirmationBox.height);
  }
  await page
    .getByLabel(
      "I understand that server data will be permanently deleted and every local connector installation must be uninstalled separately.",
    )
    .check();
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(new URL(page.url()).search).toBe("");
  const accountDeletionReceipt = (await page.context().cookies()).find(
    (cookie) => cookie.name === "vr_account_deleted",
  );
  expect(accountDeletionReceipt).toMatchObject({ httpOnly: true, sameSite: "Lax", value: "1" });
  await expect(
    page.getByRole("heading", { name: "Remove the connector from your computers" }),
  ).toBeVisible();
  await expect(page.locator(".account-deleted-cleanup pre code")).toHaveText(uninstallCommand);
  await expect(page.locator(".account-deleted-cleanup")).toContainText("VIBERACING_STATE_DIR");
  await expect(page.getByRole("button", { name: "Copy uninstall command" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
