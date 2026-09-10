import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

test.use({ javaScriptEnabled: false });

test("public HTML, discovery and private-route indexing policy", async ({ page, request }) => {
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  const suffix = randomUUID().slice(0, 8);
  const handles = [`SeoUsage-${suffix}`, `SeoActive-${suffix}`, `SeoHidden-${suffix}`] as const;
  const ids: string[] = [];
  const origin = "http://127.0.0.1:3015";
  try {
    for (const [index, handle] of handles.entries()) {
      const result = await database.query<{ id: string }>(
        "INSERT INTO users (github_id, handle) VALUES ($1, $2) RETURNING id::text",
        [(BigInt(Date.now()) * 1000n + BigInt(index)).toString(), handle],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error("Missing synthetic SEO user");
      ids.push(row.id);
    }
    await database.query(
      "INSERT INTO daily_agent_usage (usage_date, user_id, agent_id, tokens) VALUES (CURRENT_DATE, $1, 'codex', 123456)",
      [ids[0]],
    );
    const hash = () => createHash("sha256").update(randomUUID()).digest();
    await database.query(
      `INSERT INTO installations (id, user_id, name, status, installation_secret_hash,
        device_token_hash, connector_version, protocol_version)
        VALUES ($1, $2, 'SEO test', 'active', $3, $4, '0.7.3', 5)`,
      [randomUUID(), ids[1], hash(), hash()],
    );

    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain(`Sitemap: ${origin}/sitemap.xml`);
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()["content-type"]).toContain("xml");
    const xml = await sitemap.text();
    expect(xml).toContain(`<loc>${origin}/</loc>`);
    expect(xml).toContain(`/u/${handles[0]}`);
    expect(xml).toContain(`/u/${handles[1]}`);
    expect(xml).not.toContain(handles[2]);
    expect(xml).not.toMatch(/dashboard|connect|<lastmod>/);

    const home = await page.goto("/?period=week&page=01&utm_source=test");
    expect(home?.status()).toBe(200);
    // Next normalizes a canonical root URL by removing its trailing slash.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", origin);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      `${origin}/og`,
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    await expect(page.getByRole("heading", { level: 1 })).toContainText("token race");
    const homeTitle = await page.title();
    await page.goto("/?period=month&page=2&utm_source=test");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${origin}/?period=month&page=2`,
    );

    await page.goto(`/u/${handles[0].toLowerCase()}?period=year&utm_source=test`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${origin}/u/${handles[0]}?period=year`,
    );
    expect(await page.title()).toContain(`@${handles[0]}`);
    expect(await page.title()).not.toBe(homeTitle);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      new RegExp(handles[0]),
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`@${handles[0]}`);

    const today = new Date().toISOString().slice(0, 10);
    await page.goto(`/?period=custom&from=${today}&to=${today}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    const hidden = await page.goto(`/u/${handles[2]}`);
    expect(hidden?.status()).toBe(404);
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    // Revoking the only active installation removes a profile from discovery immediately.
    await database.query("UPDATE installations SET status = 'revoked' WHERE user_id = $1", [
      ids[1],
    ]);
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain(handles[1]);

    for (const path of ["/dashboard", "/connect", "/api/auth/github/start", "/health", "/ready"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
    }
    const image = await request.get("/og");
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
    const png = await image.body();
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    await writeFile(test.info().outputPath("social-preview.png"), png);
  } finally {
    await database.query("DELETE FROM users WHERE id = ANY($1::bigint[])", [ids]);
    await database.end();
  }
});
