import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
    Array.isArray(value.sources) &&
    value.sources.length === 1 &&
    value.sources.every((source) => isRecord(source) && typeof source.sourceId === "string")
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
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  const favicon = await request.get("/favicon.svg");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toContain("image/svg+xml");

  const installationId = randomUUID();
  const clientSourceId = randomUUID();
  const start = await request.post("/api/pairing/start", {
    data: {
      protocolVersion: 2,
      connectorVersion: "0.3.0",
      browserSyncCapable: true,
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
  const usage = await request.post("/api/usage", {
    headers: { authorization: `Bearer ${active.deviceToken}` },
    data: {
      protocolVersion: 2,
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
  const usageChart = page.getByRole("figure", { name: "Tokens by day" });
  await expect(usageChart.locator(".usage-chart-day")).toHaveCount(7);
  const todayBar = usageChart.locator(`.usage-chart-day:has(time[datetime="${today}"])`);
  await expect(todayBar).toContainText(/12[.,]3K/);
  await expect(todayBar.locator(".usage-chart-bar-level-20")).toHaveCount(1);
  const tokenBreakdown = page.locator('dl[aria-label="Weekly token breakdown"]');
  await expect(tokenBreakdown.locator("div")).toHaveText([
    "Input7K",
    "Output3K",
    "Cached2K",
    "Reasoning345",
  ]);
  await expect(
    page.getByRole("heading", { name: "Only exact aggregate token counters cross the boundary" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync" })).toBeVisible();
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByText("Self-reported", { exact: true }).first()).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(`@${handle}`) });
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Self-reported")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.goto("/dashboard");
  await expect(page.locator(".usage-chart-day")).toHaveCount(7);
  const [usagePlotBox, usageDayBox] = await Promise.all([
    page.locator(".usage-chart-plot").boundingBox(),
    page.locator(".usage-chart-day").first().boundingBox(),
  ]);
  expect(usagePlotBox).not.toBeNull();
  expect(usageDayBox).not.toBeNull();
  if (usagePlotBox !== null && usageDayBox !== null) {
    expect(usageDayBox.y + usageDayBox.height).toBeLessThanOrEqual(
      usagePlotBox.y + usagePlotBox.height,
    );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel("I understand this cannot be undone.").check();
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/?accountDeleted=1$/);
});
