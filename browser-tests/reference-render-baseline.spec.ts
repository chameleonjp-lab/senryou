import { test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

test("fixed Kaisen render baseline at phone portrait viewport", async ({ page }) => {
  test.setTimeout(30_000);
  const output = path.join(process.cwd(), "docs/evidence/smoke");
  await mkdir(output, { recursive: true });
  const blockedExternal: string[] = [];
  await page.context().route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") await route.continue();
    else { blockedExternal.push(url.host); await route.abort(); }
  });
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:4176/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as any).__kaisenReadState?.(false)?.graphicsReady)
    || Boolean(document.querySelector<HTMLElement>("#startup-error")?.textContent?.trim()), null, { timeout: 20_000 });
  const initialized = await page.evaluate(() => (window as any).__kaisenReadState?.(false) ?? null);
  const record: Record<string, unknown> = {
    source: "Kaisen 3d751051dc6212482a129e8da596ddd349b2f9f5",
    viewport: { width: 393, height: 648, dpr: 1 },
    browser: "Playwright 1.61.1 / Chromium 149.0.7827.55 / SwiftShader",
    operatingSystem: "Linux container",
    initialized,
    blockedExternal,
    pageErrors,
  };
  if (initialized?.graphicsReady && await page.locator("#start").isEnabled()) {
    await page.locator("#start").click();
    await page.waitForFunction(() => {
      const phase = (window as any).__kaisenReadState?.(false)?.phase;
      return phase === "playing" || phase === "paused" || phase === "result";
    }, null, { timeout: 5_000 });
    record.immediatelyAfterStart = await page.evaluate(() => (window as any).__kaisenReadState?.(false) ?? null);
    await page.waitForTimeout(1_200);
    record.after1200ms = await page.evaluate(() => (window as any).__kaisenReadState?.(false) ?? null);
    record.pauseReason = await page.locator("#pause-reason").textContent().catch(() => null);
    record.pauseReloadVisible = await page.locator("#pause-reload").isVisible().catch(() => false);
    await page.screenshot({ path: path.join(output, "kaisen-render-baseline-393x648.png"), animations: "disabled" });
  } else {
    record.startBlocked = await page.locator("#start").isDisabled().catch(() => true);
    record.startupError = await page.locator("#startup-error").textContent().catch(() => null);
  }
  await writeFile(path.join(output, "kaisen-render-baseline-393x648.json"), `${JSON.stringify(record, null, 2)}\n`);
});
