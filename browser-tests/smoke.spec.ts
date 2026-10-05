import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = path.join(process.cwd(), "docs/evidence/smoke");
const VIEWPORTS = [
  { id: "phone-portrait-393x648", width: 393, height: 648, isMobile: true, hasTouch: true },
  { id: "phone-landscape-568x320", width: 568, height: 320, isMobile: true, hasTouch: true },
  { id: "pc-1280x720", width: 1280, height: 720, isMobile: false, hasTouch: false },
] as const;

async function ready(page: Page) {
  await page.waitForFunction(() => Boolean((window as any).__senryou?.snapshot?.().ready)
    || Boolean(document.querySelector<HTMLElement>("#startup-error")?.textContent?.trim()), null, { timeout: 30_000 });
  await healthy(page, "initialization");
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const api = (window as any).__senryou;
    const full = api?.snapshot?.();
    if (!full) return null;
    const { mission, ...rest } = full;
    return { ...rest, mission: mission ? { phase: mission.phase, tick: mission.tick, result: mission.result?.outcome ?? null } : null };
  });
}

async function healthy(page: Page, stage: string) {
  const state = await snapshot(page);
  const reason = await page.locator("#startup-error").textContent().catch(() => "");
  const startEnabled = await page.locator("#start").isEnabled().catch(() => false);
  if (!state?.ready || !startEnabled || reason?.trim()) {
    throw new Error(`renderer not ready at ${stage}: ${JSON.stringify({ ready: state?.ready, startEnabled, reason: reason?.trim(), diagnostics: state?.diagnostics })}`);
  }
}

async function screenshot(page: Page, id: string, state: string) {
  await page.screenshot({ path: path.join(OUT, `${id}-${state}.png`), animations: "disabled" });
}

for (const vp of VIEWPORTS) {
  test(`smoke ${vp.id}: play, pause/resume, settings, rules and result`, async ({ browser }) => {
    test.setTimeout(120_000);
    await mkdir(OUT, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    const blockedExternal: string[] = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost") await route.continue();
      else { blockedExternal.push(url.host); await route.abort(); }
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    const evidence: Record<string, unknown> = {
      viewport: vp,
      browser: "Playwright 1.61.1 / Chromium 149.0.7827.55 / SwiftShader",
      operatingSystem: "Linux container",
      externalNetwork: "non-loopback requests blocked before transmission",
      actions: [],
      pageErrors,
      consoleErrors,
      blockedExternal,
    };
    try {
      await page.goto("http://127.0.0.1:4178/", { waitUntil: "domcontentloaded" });
      await ready(page);
      await expect(page.locator("#start")).toBeEnabled();
      await screenshot(page, vp.id, "home");

      await page.locator("#home-controls").click();
      await expect(page.locator("#control-settings")).toBeVisible();
      await page.locator("#control-editor-touch").click();
      await expect(page.locator("#control-editor-touch")).toHaveAttribute("aria-pressed", "true");
      await page.locator("#control-editor-keyboard").click();
      await expect(page.locator("#control-keyboard-editor")).toBeVisible();
      await expect(page.locator(".keyboard-settings-list")).toBeVisible();
      await page.locator("#control-cancel").click();
      await expect(page.locator("#control-settings")).toBeHidden();
      await healthy(page, "after settings flow");
      (evidence.actions as unknown[]).push("home → touch settings → keyboard settings → cancel");

      await page.locator("#home-rules").click();
      await expect(page.locator("#rules-guide")).toBeVisible();
      await expect(page.locator("#rules-content")).toBeVisible();
      const rulesScroll = await page.locator("#rules-content").evaluate((el) => {
        const box = el as HTMLElement;
        const initial = box.scrollTop;
        box.scrollTop = box.scrollHeight;
        const result = { scrollHeight: box.scrollHeight, clientHeight: box.clientHeight, reachedBottom: box.scrollTop + box.clientHeight >= box.scrollHeight - 2 };
        box.scrollTop = initial;
        return result;
      });
      await page.locator("#rules-back").click();
      await expect(page.locator("#rules-guide")).toBeHidden();
      await healthy(page, "after rules flow");
      (evidence.actions as unknown[]).push({ action: "home → rules → back", rulesScroll });

      await healthy(page, "before easy start");
      await page.locator("#start").click({ timeout: 2_000 });
      await page.waitForFunction(() => {
        const screen = (window as any).__senryou?.snapshot?.().screen;
        return screen === "playing" || screen === "paused" || screen === "result";
      }, null, { timeout: 5_000 });
      const immediatelyAfterStart = await snapshot(page);
      if (immediatelyAfterStart?.screen !== "playing") {
        const pauseReason = await page.locator("#pause-reason").textContent().catch(() => "");
        throw new Error(`easy start did not reach playing: ${JSON.stringify({ state: immediatelyAfterStart, pauseReason: pauseReason?.trim() })}`);
      }
      await expect(page.locator("#timer")).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as any).__senryou.snapshot().screen), { timeout: 5_000 }).toBe("playing");
      await screenshot(page, vp.id, "hud-easy");
      await page.waitForTimeout(1200);
      const running = await snapshot(page);
      const reloadVisible = await page.locator("#pause-reload").isVisible().catch(() => false);
      Object.assign(running ?? {}, { reloadVisible });
      evidence.easyRun = running;
      expect(running.screen, `easy mission stopped unexpectedly: ${JSON.stringify(running)}`).toBe("playing");
      expect(running.mission.phase).toBe("running");
      expect(reloadVisible, `renderer requested reload during easy mission: ${JSON.stringify(running)}`).toBe(false);

      await page.locator("#pause").click();
      await expect(page.locator("#pause-screen")).toBeVisible();
      await screenshot(page, vp.id, "pause");
      await page.locator("#resume").click();
      await expect.poll(() => page.evaluate(() => (window as any).__senryou.snapshot().screen)).toBe("playing");
      await page.waitForTimeout(350);
      expect(await page.evaluate(() => (window as any).__senryou.snapshot().mission.phase)).toBe("running");
      (evidence.actions as unknown[]).push("easy: start → pause → resume");

      await page.locator("#pause").click();
      await page.locator("#pause-end").click();
      await expect(page.locator("#result")).toBeVisible();
      await expect(page.locator("#result-title")).toHaveText("作戦中断");
      await screenshot(page, vp.id, "result");
      (evidence.actions as unknown[]).push("pause → end mission → result");

      await page.locator("#result-home").click();
      await page.locator('input[name="game-mode"][value="normal"]').check();
      await page.locator("#start").click();
      await expect(page.locator("#fire")).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as any).__senryou.snapshot().mode)).toBe("normal");
      const normalStart = await snapshot(page);
      evidence.normalRun = normalStart;
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => (window as any).__senryou.snapshot().screen)).toBe("playing");
      (evidence.actions as unknown[]).push("result → home → select normal → start");
      expect(pageErrors).toEqual([]);
      await writeFile(path.join(OUT, `${vp.id}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
    } catch (error) {
      evidence.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      evidence.finalState = await snapshot(page).catch(() => null);
      evidence.finalUi = await page.evaluate(() => ({
        pauseReason: document.querySelector("#pause-reason")?.textContent?.trim() ?? null,
        startupError: document.querySelector("#startup-error")?.textContent?.trim() ?? null,
        pauseReloadVisible: !document.querySelector<HTMLElement>("#pause-reload")?.hidden,
      })).catch(() => null);
      await writeFile(path.join(OUT, `${vp.id}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
      throw error;
    } finally {
      await context.close();
    }
  });
}
