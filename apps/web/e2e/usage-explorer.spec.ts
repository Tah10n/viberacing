import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const hash = (value: string) => createHash("sha256").update(value).digest();
const { version } = JSON.parse(
  readFileSync(new URL("../../../packages/connector/package.json", import.meta.url), "utf8"),
) as { version: string };
test.use({ hasTouch: true });

for (const width of [1440, 390, 320]) {
  test(`daily bars support mouse, keyboard and touch at ${String(width)}px`, async ({ page }) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const date = (index: number) =>
      new Date(today.getTime() - (30 - index) * 86_400_000).toISOString().slice(0, 10);
    const database = new Client({ connectionString: process.env.DATABASE_URL });
    await database.connect();
    const session = randomUUID();
    const installationId = randomUUID();
    const accountId = randomUUID();
    const sourceId = randomUUID();
    let userId: string | undefined;
    try {
      const user = await database.query<{ id: string }>(
        "INSERT INTO users (github_id, handle) VALUES ($1, $2) RETURNING id::text",
        [
          BigInt(`0x${session.replaceAll("-", "").slice(0, 15)}`).toString(),
          `chart-${session.slice(0, 8)}`,
        ],
      );
      userId = user.rows[0]?.id;
      if (!userId) throw new Error("Missing chart test user");
      await database.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [hash(session), userId],
      );
      await database.query(
        `INSERT INTO installations (id, user_id, name, status, installation_secret_hash, device_token_hash,
           connector_version, protocol_version)
         VALUES ($1, $2, 'Chart test computer', 'active', $3, $4, $5, 3)`,
        [installationId, userId, hash(randomUUID()), hash(randomUUID()), version],
      );
      await database.query(
        `INSERT INTO agent_accounts (id, user_id, agent_id, label, aggregation_mode)
         VALUES ($1, $2, 'codex', 'Chart test account', 'account_max')`,
        [accountId, userId],
      );
      await database.query(
        `INSERT INTO installation_sources (id, installation_id, user_id, agent_account_id,
           agent_id, client_source_id, collection_method, supported_surface, status,
           last_successful_sync_at, last_completeness)
         VALUES ($1, $2, $3, $4, 'codex', $1::uuid::text, 'codex_app_server', 'cli', 'active', now(), 'complete')`,
        [sourceId, installationId, userId, accountId],
      );
      await database.query(
        `INSERT INTO daily_usage (source_id, usage_date, total_tokens, completeness)
         SELECT $1, $2::date + day, CASE WHEN day = 0 THEN 0 ELSE 15000 + (day * 7919) % 90000 END, 'complete'
         FROM generate_series(0, 30) AS day`,
        [sourceId, date(0)],
      );
      await database.query(
        `INSERT INTO daily_agent_usage (usage_date, user_id, agent_id, tokens)
         SELECT usage_date, $1, 'codex', total_tokens FROM daily_usage WHERE source_id = $2`,
        [userId, sourceId],
      );
      await page
        .context()
        .addCookies([{ name: "vr_session", value: session, url: "http://127.0.0.1:3015" }]);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/dashboard?period=custom&from=${date(0)}&to=${date(30)}`);
      const chart = page.getByRole("figure", { name: "Tokens over time" });
      const canvas = chart.locator(".usage-explorer-canvas");
      const range = chart.locator(".usage-explorer-controls output");
      const bars = chart.locator(".usage-series-bar");
      const fullRange = `${date(0)}–${date(30)}`;
      const summary = await page.locator(".summary-grid").textContent();
      await expect(bars).toHaveCount(31);
      await expect(bars.first()).toHaveAttribute("height", "0");
      expect(Number(await bars.nth(1).getAttribute("height"))).toBeGreaterThan(0);
      await expect(chart.locator("polyline")).toHaveCount(0);
      await expect(chart.getByRole("button", { name: /Zoom|Pan/ })).toHaveCount(0);
      await canvas.scrollIntoViewIfNeeded();
      await chart.screenshot({ path: test.info().outputPath(`bars-${String(width)}.png`) });
      const bounds = await canvas.boundingBox();
      if (!bounds) throw new Error("Missing chart bounds");
      const plotWidth = bounds.width - 90;
      const center = bounds.x + 72 + plotWidth / 2;
      const y = bounds.y + bounds.height / 2;
      await page.mouse.move(bounds.x + 72 + plotWidth / 62, y);
      await expect(chart.locator(".usage-tooltip")).toContainText(`${date(0)} UTC`);
      await expect(chart.locator(".usage-tooltip strong")).toHaveText("0 tokens");
      // Small trackpad events must accumulate even at the closest scale.
      await canvas.focus();
      for (let step = 0; step < 10; step++) await page.keyboard.press("+");
      await expect(bars).toHaveCount(1);
      const closeRange = await range.textContent();
      await page.mouse.move(center, y);
      await page.keyboard.down("Control");
      for (let step = 0; step < 30; step++) await page.mouse.wheel(0, 4);
      await page.keyboard.up("Control");
      await expect(range).not.toHaveText(closeRange ?? "");
      await canvas.press("Home");
      // Zoom near the right edge keeps the last day in view.
      await page.mouse.move(bounds.x + bounds.width - 19, y);
      await page.mouse.wheel(0, -240);
      await expect(bars).toHaveCount(12);
      await expect(range).toHaveText(`${date(19)}–${date(30)}`);
      // A dated bar must follow sub-day movement pixel for pixel, including
      // crossing a date boundary and releasing the pointer without snapping.
      const movingBar = bars.nth(5);
      const movingDate = await movingBar.getAttribute("data-date");
      const trackedBar = chart.locator(`.usage-series-bar[data-date="${movingDate ?? ""}"]`);
      const startX = Number(await movingBar.getAttribute("x"));
      const touch = width === 390 ? await page.context().newCDPSession(page) : null;
      if (touch) {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: center, y, id: 1 }],
        });
      } else {
        await page.mouse.move(center, y);
        await page.mouse.down();
      }
      for (const offset of [8, 16, 24, 12]) {
        if (touch) {
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: center + offset, y, id: 1 }],
          });
        } else await page.mouse.move(center + offset, y);
        await expect
          .poll(async () => Math.abs(Number(await trackedBar.getAttribute("x")) - startX - offset))
          .toBeLessThan(1);
      }
      if (touch) {
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await touch.detach();
      } else await page.mouse.up();
      await expect
        .poll(async () => Math.abs(Number(await trackedBar.getAttribute("x")) - startX - 12))
        .toBeLessThan(1);
      await page.mouse.move(center, y);
      await page.mouse.wheel(-5, 0);
      await expect
        .poll(async () => Math.abs(Number(await trackedBar.getAttribute("x")) - startX - 17))
        .toBeLessThan(1);
      await canvas.press("Home");
      await page.mouse.move(bounds.x + bounds.width - 19, y);
      await page.mouse.wheel(0, -240);
      await expect(bars).toHaveCount(12);
      await page.mouse.move(center, y);
      await page.mouse.down();
      await page.mouse.move(center + plotWidth / 3, y, { steps: 8 });
      await page.mouse.up();
      await expect(range).not.toHaveText(`${date(19)}–${date(30)}`);
      const draggedRange = await range.textContent();
      await page.mouse.wheel(-72, 0);
      await expect(range).not.toHaveText(draggedRange ?? "");
      await chart.getByRole("button", { name: "Reset usage chart view" }).click();
      await expect(range).toHaveText(fullRange);
      await canvas.focus();
      await page.keyboard.press("+");
      await expect(bars).toHaveCount(20);
      const zoomedRange = await range.textContent();
      await page.keyboard.press("ArrowLeft");
      await expect(range).not.toHaveText(zoomedRange ?? "");
      await page.keyboard.press("-");
      await expect(bars).toHaveCount(30);
      await page.keyboard.press("Home");
      await expect(range).toHaveText(fullRange);
      // Trackpad pinch emits a wheel event with Ctrl held.
      await page.mouse.move(center, y);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -240);
      await page.keyboard.up("Control");
      // A fractional centered viewport includes partially visible days at both edges.
      await expect(bars).toHaveCount(13);
      await expect(range).toHaveText(`${date(9)}–${date(21)}`);
      await page.mouse.wheel(0, 240);
      await expect(bars).toHaveCount(31);
      await canvas.dblclick();
      await expect(range).toHaveText(fullRange);

      if (width === 390) {
        const cdp = await page.context().newCDPSession(page);
        const points = (spread: number) => [
          { x: center - spread, y, id: 1 },
          { x: center + spread, y, id: 2 },
        ];
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(20) });
        for (const spread of [30, 40, 50, 60]) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: points(spread),
          });
        }
        await expect.poll(() => bars.count()).toBeLessThan(31);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        const pinchRange = await range.textContent();
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: center, y, id: 1 }],
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: center + 60, y, id: 1 }],
        });
        await expect(range).not.toHaveText(pinchRange ?? "");
        await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        await chart.getByRole("button", { name: "Reset usage chart view" }).click();
        await expect(range).toHaveText(fullRange);
        // A vertical swipe starting over the graph still scrolls the page.
        const scrollBefore = await page.evaluate(() => window.scrollY);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: center, y, id: 1 }],
        });
        for (const offset of [20, 40, 60, 80]) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: center, y: y - offset, id: 1 }],
          });
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);
        await cdp.detach();
      }
      await expect(page.locator(".summary-grid")).toHaveText(summary ?? "");
      await expect(chart.locator(".usage-values tbody tr")).toHaveCount(31);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    } finally {
      if (userId) await database.query("DELETE FROM users WHERE id = $1", [userId]);
      await database.end();
    }
  });
}

for (const width of [1440, 390]) {
  test(`history stays responsive offline through years at ${String(width)}px`, async ({
    page,
    request,
  }) => {
    const database = new Client({ connectionString: process.env.DATABASE_URL });
    await database.connect();
    const session = randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const users: string[] = [];
    try {
      for (const suffix of ["owner", "other"]) {
        const id = BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 15)}`).toString();
        const result = await database.query<{ id: string }>(
          "INSERT INTO users (github_id, handle) VALUES ($1, $2) RETURNING id::text",
          [id, `${suffix}-${session.slice(0, 8)}`],
        );
        const user = result.rows[0]?.id;
        if (!user) throw new Error("Missing history user");
        users.push(user);
      }
      await database.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [hash(session), users[0]],
      );
      await database.query(
        `INSERT INTO daily_agent_usage (usage_date, user_id, agent_id, tokens)
         SELECT $2::date - day, $1, 'codex', 1100 + (day % 17) * 777 FROM generate_series(0, 1100) day`,
        [users[0], today],
      );
      await database.query(
        "INSERT INTO daily_agent_usage (usage_date, user_id, agent_id, tokens) VALUES ($1, $2, 'codex', 9007199254740993)",
        [today, users[1]],
      );
      const unauthenticated = await request.get("/dashboard", { maxRedirects: 0 });
      expect(unauthenticated.status()).toBe(307);
      expect(unauthenticated.headers().location).toContain("/api/auth/github/start");
      await page
        .context()
        .addCookies([{ name: "vr_session", value: session, url: "http://127.0.0.1:3015" }]);
      await page.setViewportSize({ width, height: 1000 });
      const requests: string[] = [];
      page.on("request", (item) => {
        if (item.url().includes("/api/usage/chart?")) requests.push(item.url());
      });
      await page.goto("/dashboard");
      const chart = page.getByRole("figure", { name: "Tokens over time" });
      const canvas = chart.locator(".usage-explorer-canvas");
      const range = chart.locator(".usage-explorer-controls output");
      const scale = chart.locator(".usage-explorer-context strong");
      const initialRange = await range.textContent();
      const summary = await page.locator(".summary-grid").textContent();
      expect(requests).toHaveLength(0);
      await canvas.scrollIntoViewIfNeeded();
      await page.context().setOffline(true);
      const bounds = await canvas.boundingBox();
      if (!bounds) throw new Error("Missing history chart");
      const x = bounds.x + 72 + (bounds.width - 90) * 0.35;
      const y = bounds.y + bounds.height / 2;
      if (width === 390) {
        const touch = await page.context().newCDPSession(page);
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y, id: 1 }],
        });
        for (const step of [0.2, 0.4, 0.6]) {
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: x + (bounds.width - 90) * step, y, id: 1 }],
          });
        }
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await touch.detach();
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + (bounds.width - 90) * 0.6, y, { steps: 10 });
        await page.mouse.up();
      }
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
      await expect(range).not.toHaveText(initialRange ?? "");
      await expect(chart.locator(".usage-series-bar")).not.toHaveCount(0);
      await expect(canvas).not.toHaveAttribute("aria-busy", "true");
      expect(await chart.locator(".usage-series-bar").count()).toBeGreaterThan(0);
      await expect(chart).toContainText("Exploring history");
      await expect(page.locator(".summary-grid")).toHaveText(summary ?? "");
      await expect(page).toHaveURL(/\/dashboard$/);

      const navigationTimings: number[] = [];
      for (const unit of ["Weekly", "Monthly", "Yearly"]) {
        for (
          let attempt = 0;
          attempt < 8 && !(await scale.textContent())?.startsWith(unit);
          attempt++
        ) {
          const before = await range.textContent();
          const started = performance.now();
          await canvas.hover();
          await page.mouse.wheel(0, 240);
          await expect(range).not.toHaveText(before ?? "");
          await expect(canvas).not.toHaveAttribute("aria-busy", "true");
          navigationTimings.push(performance.now() - started);
        }
        await expect(scale).toHaveText(`${unit} totals · UTC`);
        if (unit !== "Yearly") {
          // Calendar bars keep their anchors as the viewport crosses UTC days.
          const calendarBars = chart.locator(".usage-series-bar");
          const middle = calendarBars.nth(Math.floor((await calendarBars.count()) / 2));
          const key = await middle.getAttribute("data-date");
          const tracked = chart.locator(`.usage-series-bar[data-date="${key ?? ""}"]`);
          const start = Number(await middle.getAttribute("x"));
          await page.mouse.move(x, y);
          await page.mouse.down();
          for (const offset of [8, 16]) {
            await page.mouse.move(x + offset, y);
            await expect
              .poll(async () => Math.abs(Number(await tracked.getAttribute("x")) - start - offset))
              .toBeLessThan(1);
          }
          await page.mouse.up();
        }
        const visibleRange = (await range.textContent())?.split("–");
        const expected = await database.query<{ tokens: string }>(
          "SELECT sum(tokens)::text AS tokens FROM daily_agent_usage WHERE user_id = $1 AND usage_date >= $2 AND usage_date <= $3",
          [users[0], visibleRange?.[0], visibleRange?.[1]],
        );
        const rows = await chart.locator(".usage-values tbody tr td:last-child").allTextContents();
        const actual = rows.reduce((sum, value) => sum + BigInt(value.replace(/\D/g, "")), 0n);
        expect(actual.toString()).toBe(expected.rows[0]?.tokens);
        const geometry = await chart.locator(".usage-series-bar").evaluateAll((bars) =>
          bars.map((bar) => ({
            x: Number(bar.getAttribute("x")),
            width: Number(bar.getAttribute("width")),
            height: Number(bar.getAttribute("height")),
          })),
        );
        for (const bar of geometry.filter((bar) => bar.height > 0)) {
          expect(bar.width).toBeGreaterThan(0);
          expect(bar.x).toBeLessThan(bounds.width - 18);
          expect(bar.x + bar.width).toBeGreaterThan(72);
        }
        await chart.screenshot({
          path: test.info().outputPath(`${unit.toLowerCase()}-${String(width)}.png`),
        });
      }
      await test.info().attach("navigation-timing", {
        body: JSON.stringify({
          width,
          requests: requests.length,
          timingsMs: navigationTimings.map((value) => Math.round(value)),
        }),
        contentType: "application/json",
      });
      await canvas.focus();
      await page.keyboard.press("+");
      await expect(scale).toHaveText("Monthly totals · UTC");
      if (width === 390) {
        await canvas.scrollIntoViewIfNeeded();
        const plot = await canvas.boundingBox();
        if (!plot) throw new Error("Missing pinch target");
        const touch = await page.context().newCDPSession(page);
        const center = plot.x + 72 + (plot.width - 90) / 2;
        const points = (spread: number) => [
          { x: center - spread, y: plot.y + 90, id: 1 },
          { x: center + spread, y: plot.y + 90, id: 2 },
        ];
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: points(15),
        });
        for (const spread of [30, 45, 60])
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: points(spread),
          });
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect(scale).toHaveText("Weekly totals · UTC");
        await expect(canvas).not.toHaveAttribute("aria-busy", "true");
        await touch.detach();
      }
      await canvas.focus();
      await page.keyboard.press("Home");
      await expect(range).toHaveText(initialRange ?? "");
      await expect(scale).toHaveText("Daily totals · UTC");

      // Revisit both older and newer dates while all network access is disabled.
      for (const key of ["ArrowLeft", "ArrowLeft", "ArrowRight", "-", "+", "Home"]) {
        await page.keyboard.press(key);
        await expect(chart.locator(".usage-series-bar")).not.toHaveCount(0);
        await expect(chart.getByText("Loading history…", { exact: true })).toHaveCount(0);
      }
      await expect(range).toHaveText(initialRange ?? "");
      expect(requests).toHaveLength(0);
      await expect(page.locator(".summary-grid")).toHaveText(summary ?? "");
    } finally {
      await page.context().setOffline(false);
      await database.query("DELETE FROM users WHERE id = ANY($1::bigint[])", [users]);
      await database.end();
    }
  });
}
