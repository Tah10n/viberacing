import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: false });

for (const fallback of [false, true]) {
  for (const width of [320, 390]) {
    test(`Custom GET form without JavaScript at ${String(width)}px (${fallback ? "fallback" : "native support"})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      if (fallback) {
        // Simulate unsupported-selector parsing, including a false @supports query.
        // This exercises the actual shipped CSS, not a duplicate fixture stylesheet.
        // It is a mechanism regression test in Chromium, not an old-browser run.
        await page.route("**/*.css", async (route) => {
          const response = await route.fetch();
          const body = (await response.text()).replaceAll(
            "::details-content",
            "::viberacing-unsupported-details-content",
          );
          await route.fulfill({ response, body });
        });
      }

      await page.goto("/?period=week");
      const disclosure = page.locator(".custom-period");
      await disclosure.locator("summary").click();
      await expect(disclosure).toHaveAttribute("open", "");
      const form = disclosure.locator("form");
      for (const control of [
        form.getByLabel("From"),
        form.getByLabel("To"),
        form.getByRole("button", { name: "Apply range" }),
      ]) {
        await expect(control).toBeVisible();
        const bounds = await control.boundingBox();
        if (bounds === null) throw new Error("Missing date form control");
        expect(bounds.width).toBeGreaterThan(200);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.screenshot({ path: test.info().outputPath("custom-open.png"), fullPage: true });

      const today = new Date().toISOString().slice(0, 10);
      await form.getByLabel("From").fill(today);
      await form.getByLabel("To").fill(today);
      await form.getByRole("button", { name: "Apply range" }).click();
      await expect(page).toHaveURL(
        `http://127.0.0.1:3015/?period=custom&from=${today}&to=${today}`,
      );
      await expect(page.getByRole("heading", { name: "Selected range standings" })).toBeVisible();
      await expect(page.locator(".custom-period")).toHaveAttribute("open", "");
      await expect(page.getByLabel("From", { exact: true })).toHaveValue(today);
      await expect(page.getByLabel("To", { exact: true })).toHaveValue(today);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });
  }
}
