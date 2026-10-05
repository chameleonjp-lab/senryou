import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const EVIDENCE = path.join(ROOT, "docs/evidence/visual-comparison");
const MATRIX_PATH = path.join(EVIDENCE, "ui-matrix.json");
const REFERENCES = [
  { id: "kaisen", url: "http://127.0.0.1:4176", ref: "3d751051dc6212482a129e8da596ddd349b2f9f5" },
  { id: "fightflight", url: "http://127.0.0.1:4177", ref: "c2b313d37875b93458032d98636fcf5b5d30a138" },
  { id: "senryou", url: "http://127.0.0.1:4178", ref: null },
] as const;
const VIEWPORTS = [
  { id: "phone-portrait-393x648", width: 393, height: 648, mobile: true },
  { id: "phone-landscape-568x320", width: 568, height: 320, mobile: true },
  { id: "pc-1280x720", width: 1280, height: 720, mobile: false },
] as const;
const PRESENTATIONS = [
  { id: "regular", textScale: 1, zoomEquivalent: false },
  { id: "text-200", textScale: 2, zoomEquivalent: false },
  { id: "browser-zoom-200-equivalent", textScale: 1, zoomEquivalent: true },
] as const;
const SCREENS = [
  "home",
  "normal-hud",
  "easy-hud",
  "pause",
  "touch-settings",
  "pc-key-settings",
  "rules",
  "result",
] as const;

type AppId = (typeof REFERENCES)[number]["id"];
type ScreenId = (typeof SCREENS)[number];
type PresentationId = (typeof PRESENTATIONS)[number]["id"];
type ViewportId = (typeof VIEWPORTS)[number]["id"];
type AppRecord = {
  id: AppId;
  sourceHead: string | null;
  screenshots: Record<string, string>;
  captures: Record<string, unknown>;
  interaction: Record<string, unknown>;
  blockedExternalRequests: string[];
  pageErrors: string[];
  consoleErrors: string[];
  error?: string;
};

const appHead = (app: (typeof REFERENCES)[number]) => app.ref
  ? execFileSync("git", ["-C", app.id === "kaisen" ? "/workspace/kaisen" : "/workspace/faitofuraito", "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  : execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

function keyFor(screen: ScreenId, app: AppId, viewport: ViewportId, presentation: PresentationId) {
  return `${screen}/${app}/${viewport}/${presentation}`;
}

function imagePath(app: AppId, screen: ScreenId, viewport: ViewportId, presentation: PresentationId) {
  return path.join(EVIDENCE, `ui-${app}-${screen}-${viewport}-${presentation}.png`);
}

async function writeMatrix(rows: unknown[], comparisons: unknown[]) {
  await mkdir(EVIDENCE, { recursive: true });
  const partial = {
    generatedAt: new Date().toISOString(),
    targetHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    references: REFERENCES.map((item) => ({ id: item.id, fixedHead: item.ref, observedHead: appHead(item) })),
    browser: "Playwright 1.61.1 / Chromium 149.0.7827.55 / SwiftShader",
    operatingSystem: "Linux container",
    rules: {
      requiredScreens: SCREENS,
      viewportCssPixels: VIEWPORTS.map(({ id, width, height }) => ({ id, width, height })),
      presentations: [
        "regular CSS viewport and 100% text",
        "all DOM text-bearing elements forced to twice their baseline computed font size",
        "200% zoom equivalent: half CSS viewport and DPR 2; this is not browser chrome zoom",
      ],
      input: "touch enabled for the two phone viewports; mouse/keyboard for PC",
      sound: "muted before capture where the UI exposes a toggle",
      externalNetwork: "all non-loopback requests aborted before transmission",
      hudCapture: "paused at a fixed simulation state with only the pause panel hidden for the HUD screenshot; pause screenshot is captured separately",
      pixels: "pairwise pixel deltas are descriptive only; worlds and game copy intentionally differ",
    },
    rows,
    pixelComparisons: comparisons,
  };
  await writeFile(MATRIX_PATH, `${JSON.stringify(partial, null, 2)}\n`);
}

function textScaleScript() {
  return `(() => {
    const style = document.createElement('style');
    style.dataset.comparison = 'text-scale';
    style.textContent = 'html { text-size-adjust: none !important; -webkit-text-size-adjust: none !important; }';
    if (!style.isConnected) document.head.append(style);
    const elements = Array.from(document.querySelectorAll('*'));
    const entries = elements.filter(el => Array.from(el.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()));
    const measurements = entries.map(el => {
      let base = Number(el.getAttribute('data-comparison-font-base'));
      if (!Number.isFinite(base) || base <= 0) {
        base = Number.parseFloat(getComputedStyle(el).fontSize) || 16;
        el.setAttribute('data-comparison-font-base', String(base));
      }
      return [el, base];
    });
    for (const [el, base] of measurements) el.style.setProperty('font-size', (base * 2) + 'px', 'important');
  })()`;
}

async function installStaticCaptureStyles(page: Page, presentation: PresentationId) {
  await page.addStyleTag({ content: "*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; scroll-behavior: auto !important; caret-color: transparent !important; }" });
  if (presentation === "text-200") await page.evaluate(textScaleScript());
}

async function applyTextScaleToDynamicUi(page: Page, presentation: PresentationId) {
  if (presentation === "text-200") await page.evaluate(textScaleScript());
}

async function waitForReady(page: Page, app: AppId): Promise<boolean> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate((id) => {
      const start = document.querySelector<HTMLButtonElement>("#start");
      if (!start || start.disabled) return false;
      if (id === "senryou") return Boolean((window as any).__senryou?.snapshot?.().ready);
      if (id === "kaisen") return Boolean((window as any).__kaisenReadState?.().graphicsReady);
      return typeof (window as any).flightSnapshot === "function";
    }, app).catch(() => false);
    if (ready) return true;
    await page.waitForTimeout(125);
  }
  return false;
}

async function normalizeSound(page: Page) {
  const button = page.locator("#home-sound, #sound").first();
  if (!(await button.count())) return { found: false, muted: null };
  const pressed = await button.getAttribute("aria-pressed");
  if (pressed === "true") await button.click().catch(() => undefined);
  return { found: true, muted: (await button.getAttribute("aria-pressed")) !== "true" };
}

async function openHome(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  const sound = await normalizeSound(page);
  await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement instanceof HTMLElement && document.activeElement.blur(); });
  return sound;
}

async function selectMode(page: Page, mode: "normal" | "easy") {
  const radio = page.locator(`input[name="game-mode"][value="${mode}"]`);
  if (await radio.count()) await radio.check();
}

async function clickIfVisible(page: Page, selector: string) {
  const button = page.locator(selector).first();
  if (await button.count() && await button.isVisible().catch(() => false)) {
    await button.click({ timeout: 5_000 }).catch(() => undefined);
    return true;
  }
  return false;
}

async function observeScrollReachability(page: Page, selector: string) {
  return page.evaluate((query) => {
    const element = document.querySelector<HTMLElement>(query);
    if (!element) return { found: false, hasOverflow: false, reachedBottom: false, clientHeight: 0, scrollHeight: 0 };
    const overflow = element.scrollHeight > element.clientHeight + 2;
    const initial = element.scrollTop;
    element.scrollTop = element.scrollHeight;
    const reachedBottom = !overflow || element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
    element.scrollTop = initial;
    return { found: true, hasOverflow: overflow, reachedBottom, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight };
  }, selector);
}

async function capture(page: Page, app: AppId, screen: ScreenId, viewport: ViewportId, presentation: PresentationId,
  captures: AppRecord["captures"], screenshotPaths: AppRecord["screenshots"], overlayHidden = false) {
  await applyTextScaleToDynamicUi(page, presentation);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
  });
  await page.waitForTimeout(80);
  const facts = await page.evaluate(({ appId, screenId, overlay }) => {
    const selectors: Record<string, string[]> = {
      home: ["#home", "#title", "#game-title", "#start", ".mode-picker", ".mission-data", ".home-actions", ".home-footer"],
      "normal-hud": ["#hud", "#timer", ".targets", ".flight-data", ".capture-info", "#fire", "#bomb", "#loop", "#pause"],
      "easy-hud": ["#hud", "#timer", ".targets", ".flight-data", ".capture-info", "#bomb", "#loop", "#pause"],
      pause: ["#pause-screen", "#pause-title", "#resume", "#pause-home", "#pause-controls", "#pause-rules", "#quit"],
      "touch-settings": ["#control-settings", "#control-settings-title", "#control-editor-touch", "#control-mode", "#control-target", "#control-x", "#control-size", "#control-preview", "#control-cancel", "#control-save"],
      "pc-key-settings": ["#control-settings", "#control-settings-title", "#control-editor-keyboard", "#keyboard-settings-list", "#keyboard-reset", "#control-cancel", "#control-save"],
      rules: ["#rules-guide", "#rules-title", "#rules-content", "#rules-back", "#rules-close"],
      result: ["#result", "#result-title", "#result-reason", "#result-time", "#result-score", "#score-breakdown", "#retry", "#result-home", "#result-return-home"],
    };
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10,
        width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10,
        visible: !((el as HTMLElement).hidden) && s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0,
        fontFamily: s.fontFamily, fontSize: s.fontSize, lineHeight: s.lineHeight,
        color: s.color, backgroundColor: s.backgroundColor, borderRadius: s.borderRadius,
      };
    };
    const landmarks: Record<string, unknown> = {};
    for (const selector of selectors[screenId] ?? []) {
      const el = document.querySelector(selector);
      if (el) landmarks[selector] = rect(el);
    }
    const visible = (el: Element) => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return !(el as HTMLElement).hidden && s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const textNodes = Array.from(document.querySelectorAll("body *")).filter(el => visible(el)
      && Array.from(el.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()));
    const clippedText = textNodes.filter(el => {
      const s = getComputedStyle(el), h = el as HTMLElement;
      return ((s.overflowX === "hidden" || s.textOverflow === "ellipsis") && h.scrollWidth > h.clientWidth + 3)
        || (s.overflowY === "hidden" && h.scrollHeight > h.clientHeight + 3);
    }).slice(0, 24).map(el => ({
      tag: el.tagName.toLowerCase(), id: (el as HTMLElement).id || null,
      text: (el.textContent ?? "").trim().slice(0, 48), ...rect(el),
      scrollWidth: (el as HTMLElement).scrollWidth, clientWidth: (el as HTMLElement).clientWidth,
      scrollHeight: (el as HTMLElement).scrollHeight, clientHeight: (el as HTMLElement).clientHeight,
    }));
    const primarySelectors: Record<string, string[]> = {
      home: ["#start"], "normal-hud": ["#pause", "#fire"], "easy-hud": ["#pause", "#loop"],
      pause: ["#resume", "#pause-home", "#quit"], "touch-settings": ["#control-cancel", "#control-save"],
      "pc-key-settings": ["#control-cancel", "#control-save"], rules: ["#rules-back", "#rules-close"],
      result: ["#retry", "#result-home", "#result-return-home"],
    };
    const critical = (primarySelectors[screenId] ?? []).map(selector => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return { selector, exists: false, visible: false, inViewport: false, width: 0, height: 0 };
      const r = el.getBoundingClientRect();
      const v = visible(el);
      return { selector, exists: true, visible: v,
        inViewport: v && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight,
        width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
    });
    const active = document.activeElement as HTMLElement | null;
    const api = (window as any).__senryou;
    const sourceState = appId === "kaisen" ? (window as any).__kaisenReadState?.()
      : appId === "fightflight" ? (window as any).flightSnapshot?.() : null;
    const targetState = api?.snapshot?.();
    const pauseReason = document.querySelector("#pause-reason")?.textContent?.trim() ?? "";
    const reloadVisible = (() => { const e = document.querySelector<HTMLElement>("#pause-reload"); return !!e && visible(e); })();
    const appScreen = targetState?.screen ?? sourceState?.screen ?? sourceState?.phase ?? null;
    const vw = visualViewport;
    return {
      screenId, appScreen, phase: targetState?.mission?.phase ?? sourceState?.phase ?? null,
      mode: targetState?.mode ?? sourceState?.mode ?? sourceState?.selectedMode ?? null,
      landmarks, critical, clippedText,
      viewport: { innerWidth, innerHeight, dpr: devicePixelRatio, visualWidth: vw?.width ?? null, visualHeight: vw?.height ?? null,
        documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
        bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight },
      focus: active ? { tag: active.tagName.toLowerCase(), id: active.id || null, role: active.getAttribute("role") } : null,
      pauseReason, reloadVisible, screenshotOverlayHidden: overlay,
      renderer: targetState?.diagnostics ?? sourceState?.render ?? null,
      graphicsReady: targetState?.ready ?? sourceState?.graphicsReady ?? true,
    };
  }, { appId: app, screenId: screen, overlay: overlayHidden });

  const file = imagePath(app, screen, viewport, presentation);
  const buffer = await page.screenshot({ path: file, fullPage: false, animations: "disabled", caret: "hide", scale: "device" });
  const key = keyFor(screen, app, viewport, presentation);
  captures[key] = facts;
  screenshotPaths[key] = path.relative(ROOT, file);
  return { buffer, facts };
}

async function setModeAndStart(page: Page, mode: "normal" | "easy") {
  await selectMode(page, mode);
  await page.locator("#start").click({ timeout: 10_000 });
  await page.locator("#timer").waitFor({ state: "visible", timeout: 25_000 });
  await page.waitForTimeout(160);
}

async function pauseHomeSelector(app: AppId) {
  return app === "fightflight" ? "#quit" : "#pause-home";
}

async function closeNaturalResult(page: Page, app: AppId) {
  await setModeAndStart(page, "easy");
  await page.keyboard.down("ArrowDown");
  const deadline = Date.now() + 28_000;
  let ended = false;
  while (Date.now() < deadline) {
    ended = await page.evaluate((id) => {
      if (id === "kaisen") return (window as any).__kaisenReadState?.().phase === "ended";
      if (id === "fightflight") return (window as any).flightSnapshot?.().phase === "ended";
      return false;
    }, app).catch(() => false);
    if (ended) break;
    await page.waitForTimeout(100);
  }
  await page.keyboard.up("ArrowDown").catch(() => undefined);
  await page.locator("#result").waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  return { ended, resultVisible: await page.locator("#result").isVisible().catch(() => false) };
}

async function captureApp(browser: Browser, app: (typeof REFERENCES)[number], viewport: (typeof VIEWPORTS)[number],
  presentation: (typeof PRESENTATIONS)[number]): Promise<{ row: AppRecord; images: Record<ScreenId, Buffer> }> {
  const cssWidth = presentation.zoomEquivalent ? Math.ceil(viewport.width / 2) : viewport.width;
  const cssHeight = presentation.zoomEquivalent ? Math.ceil(viewport.height / 2) : viewport.height;
  const context = await browser.newContext({
    viewport: { width: cssWidth, height: cssHeight },
    deviceScaleFactor: presentation.zoomEquivalent ? 2 : 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    locale: "ja-JP",
    timezoneId: "UTC",
    colorScheme: "dark",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const blockedExternalRequests: string[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:4176/") || url.startsWith("http://127.0.0.1:4177/") || url.startsWith("http://127.0.0.1:4178/")) {
      await route.continue();
      return;
    }
    if (!url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("about:")) {
      try { blockedExternalRequests.push(new URL(url).host); } catch { blockedExternalRequests.push("non-http"); }
    }
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const record: AppRecord = {
    id: app.id,
    sourceHead: app.ref ? appHead(app) : null,
    screenshots: {}, captures: {}, interaction: {},
    blockedExternalRequests, pageErrors, consoleErrors,
  };
  const images = {} as Record<ScreenId, Buffer>;
  try {
    await openHome(page);
    const isReady = await waitForReady(page, app.id);
    record.interaction.ready = isReady;
    if (!isReady) throw new Error(`startup or first visible render did not become ready (${app.id})`);
    await installStaticCaptureStyles(page, presentation.id);

    let item = await capture(page, app.id, "home", viewport.id, presentation.id, record.captures, record.screenshots);
    images.home = item.buffer;

    // The screen help is opened from the same Home button on all three builds.
    const homeRules = page.locator("#home-rules");
    await homeRules.click({ timeout: 8_000 });
    await page.locator("#rules-guide").waitFor({ state: "visible", timeout: 8_000 });
    await applyTextScaleToDynamicUi(page, presentation.id);
    const ruleScroll = await observeScrollReachability(page, "#rules-content");
    record.interaction.rulesContentReachable = ruleScroll.reachedBottom;
    item = await capture(page, app.id, "rules", viewport.id, presentation.id, record.captures, record.screenshots);
    images.rules = item.buffer;
    await clickIfVisible(page, "#rules-back");
    record.interaction.rulesFocusRestored = await page.evaluate(() => document.activeElement?.id === "home-rules");

    const settingsOpener = page.locator("#home-controls");
    await settingsOpener.click({ timeout: 8_000 });
    await page.locator("#control-settings[open]").waitFor({ state: "attached", timeout: 8_000 });
    await page.locator("#control-editor-touch").click();
    await applyTextScaleToDynamicUi(page, presentation.id);
    const settingsScroll = await observeScrollReachability(page, ".settings-main");
    record.interaction.settingsContentReachable = settingsScroll.reachedBottom;
    await page.locator(".settings-main").evaluate((el: HTMLElement) => { el.scrollTop = 0; });
    item = await capture(page, app.id, "touch-settings", viewport.id, presentation.id, record.captures, record.screenshots);
    images["touch-settings"] = item.buffer;

    await page.locator("#control-editor-keyboard").click();
    await applyTextScaleToDynamicUi(page, presentation.id);
    item = await capture(page, app.id, "pc-key-settings", viewport.id, presentation.id, record.captures, record.screenshots);
    images["pc-key-settings"] = item.buffer;
    record.interaction.keyboardTabWrap = await testKeyboardDialogWrap(page);
    await clickIfVisible(page, "#control-cancel");
    record.interaction.settingsFocusRestored = await page.evaluate(() => document.activeElement?.id === "home-controls");

    await setModeAndStart(page, "normal");
    const manualPause = await clickIfVisible(page, "#pause");
    record.interaction.normalPauseAction = manualPause;
    await page.locator("#pause-screen").waitFor({ state: "visible", timeout: 8_000 });
    const pauseReason = await page.locator("#pause-reason").textContent().catch(() => "");
    const pauseReload = await page.locator("#pause-reload").isVisible().catch(() => false);
    record.interaction.rendererStableAfterStart = !pauseReload && !/描画|render|GPU/i.test(pauseReason ?? "");
    item = await capture(page, app.id, "pause", viewport.id, presentation.id, record.captures, record.screenshots);
    images.pause = item.buffer;
    const hudHideStyle = await page.addStyleTag({ content: "#pause-screen { display: none !important; visibility: hidden !important; }" });
    item = await capture(page, app.id, "normal-hud", viewport.id, presentation.id, record.captures, record.screenshots, true);
    images["normal-hud"] = item.buffer;
    await hudHideStyle.evaluate((style) => style.remove());
    if (!record.interaction.rendererStableAfterStart) throw new Error(`renderer auto-paused after Normal start: ${pauseReason ?? "unknown reason"}`);

    await page.locator(await pauseHomeSelector(app.id)).click({ timeout: 8_000 });
    await page.locator("#home").waitFor({ state: "visible", timeout: 8_000 });
    await setModeAndStart(page, "easy");
    await clickIfVisible(page, "#pause");
    await page.locator("#pause-screen").waitFor({ state: "visible", timeout: 8_000 });
    const easyPauseReason = await page.locator("#pause-reason").textContent().catch(() => "");
    const easyPauseReload = await page.locator("#pause-reload").isVisible().catch(() => false);
    record.interaction.easyRendererStableAfterStart = !easyPauseReload && !/描画|render|GPU/i.test(easyPauseReason ?? "");
    const easyHudHideStyle = await page.addStyleTag({ content: "#pause-screen { display: none !important; visibility: hidden !important; }" });
    item = await capture(page, app.id, "easy-hud", viewport.id, presentation.id, record.captures, record.screenshots, true);
    images["easy-hud"] = item.buffer;
    await easyHudHideStyle.evaluate((style) => style.remove());
    if (!record.interaction.easyRendererStableAfterStart) throw new Error(`renderer auto-paused after Easy start: ${easyPauseReason ?? "unknown reason"}`);

    if (app.id === "senryou") {
      await page.evaluate(() => (window as any).__senryou.fixture("result"));
      record.interaction.resultFixture = "dev-only abort result fixture";
    } else {
      await page.locator(await pauseHomeSelector(app.id)).click({ timeout: 8_000 });
      await page.locator("#home").waitFor({ state: "visible", timeout: 8_000 });
      const natural = await closeNaturalResult(page, app.id);
      record.interaction.naturalResult = natural;
    }
    const resultVisible = await page.locator("#result").isVisible().catch(() => false);
    record.interaction.resultVisible = resultVisible;
    if (!resultVisible) throw new Error(`Result screen was not reached through the recorded path (${app.id})`);
    const resultScroll = await observeScrollReachability(page, "#result");
    record.interaction.resultContentReachable = resultScroll.reachedBottom;
    item = await capture(page, app.id, "result", viewport.id, presentation.id, record.captures, record.screenshots);
    images.result = item.buffer;
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  } finally {
    await context.close().catch(() => undefined);
  }
  return { row: record, images };
}

async function testKeyboardDialogWrap(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>("#control-settings");
    const last = document.querySelector<HTMLElement>("#control-save");
    const first = document.querySelector<HTMLElement>("#control-close");
    if (!dialog || !last || !first) return { found: false, forward: false, backward: false };
    last.focus();
    return new Promise<{ found: boolean; forward: boolean; backward: boolean }>((resolve) => {
      const forward = (event: KeyboardEvent) => {
        if (event.key !== "Tab" || event.shiftKey) return;
        const forwardTarget = event.target as HTMLElement;
        requestAnimationFrame(() => {
          const wraps = forwardTarget === last && document.activeElement === first;
          const backwardListener = (backEvent: KeyboardEvent) => {
            if (backEvent.key !== "Tab" || !backEvent.shiftKey) return;
            const backTarget = backEvent.target as HTMLElement;
            requestAnimationFrame(() => {
              const wrapsBack = backTarget === first && document.activeElement === last;
              dialog.removeEventListener("keydown", forward, true);
              dialog.removeEventListener("keydown", backwardListener, true);
              resolve({ found: true, forward: wraps, backward: wrapsBack });
            });
          };
          dialog.addEventListener("keydown", backwardListener, true);
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
        });
      };
      dialog.addEventListener("keydown", forward, true);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      setTimeout(() => resolve({ found: true, forward: false, backward: false }), 750);
    });
  });
}

async function comparePngs(page: Page, images: Record<AppId, Record<ScreenId, Buffer>>) {
  const pairs: Array<{ screen: ScreenId; reference: "kaisen" | "fightflight"; compared: "senryou"; diff: unknown }> = [];
  for (const screen of SCREENS) {
    const target = images.senryou[screen].toString("base64");
    for (const reference of ["kaisen", "fightflight"] as const) {
      const baseline = images[reference][screen].toString("base64");
      const diff = await page.evaluate(async ({ a, b }) => {
        const load = (base64: string) => new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("screenshot PNG could not be decoded"));
          img.src = `data:image/png;base64,${base64}`;
        });
        const [left, right] = await Promise.all([load(a), load(b)]);
        const width = Math.min(left.naturalWidth, right.naturalWidth), height = Math.min(left.naturalHeight, right.naturalHeight);
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(left, 0, 0); const p = ctx.getImageData(0, 0, width, height).data;
        ctx.clearRect(0, 0, width, height); ctx.drawImage(right, 0, 0); const q = ctx.getImageData(0, 0, width, height).data;
        let absolute = 0, pixelsOver18 = 0, max = 0;
        for (let i = 0; i < p.length; i += 4) {
          let pixelMax = 0;
          for (let c = 0; c < 3; c++) { const d = Math.abs(p[i + c] - q[i + c]); absolute += d; pixelMax = Math.max(pixelMax, d); }
          max = Math.max(max, pixelMax); if (pixelMax >= 18) pixelsOver18++;
        }
        return { width, height, meanAbsoluteRgbDifference: Number((absolute / (width * height * 3)).toFixed(3)), pixelsOver18: pixelsOver18, changedPixelPercent: Number((100 * pixelsOver18 / (width * height)).toFixed(2)), maximumChannelDifference: max };
      }, { a: baseline, b: target });
      pairs.push({ screen, reference, compared: "senryou", diff });
    }
  }
  return pairs;
}

const conditions = VIEWPORTS.flatMap((viewport) => PRESENTATIONS.map((presentation) => ({ viewport, presentation })));

test.describe("fixed-reference UI comparison matrix", () => {
  test.describe.configure({ mode: "serial" });

  for (const { viewport, presentation } of conditions) {
    test(`${viewport.id} / ${presentation.id}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const rows: AppRecord[] = [];
      const images: Record<AppId, Record<ScreenId, Buffer>> = {} as any;
      const issues: string[] = [];
      let pixelComparisons: unknown[] = [];
      for (const app of REFERENCES) {
        const result = await captureApp(browser, app, viewport, presentation);
        rows.push(result.row);
        images[app.id] = result.images;
        if (result.row.error) issues.push(`${app.id}: ${result.row.error}`);
        if (result.row.pageErrors.length) issues.push(`${app.id}: ${result.row.pageErrors.length} pageerror(s)`);
        if (Object.keys(result.row.screenshots).length !== SCREENS.length) issues.push(`${app.id}: captured ${Object.keys(result.row.screenshots).length}/${SCREENS.length} states`);
        if (app.id === "senryou" && (result.row.interaction.rendererStableAfterStart !== true || result.row.interaction.easyRendererStableAfterStart !== true)) {
          issues.push("senryou: renderer auto-paused or reported a draw fault after mission start");
        }
        if (app.id !== "senryou" && result.row.sourceHead !== app.ref) issues.push(`${app.id}: fixed source HEAD mismatch`);
      }
      const lastPageContext = await browser.newContext({ viewport: { width: 16, height: 16 }, serviceWorkers: "block" });
      const comparePage = await lastPageContext.newPage();
      await comparePage.goto("http://127.0.0.1:4178", { waitUntil: "domcontentloaded" });
      pixelComparisons = await comparePngs(comparePage, images);
      await lastPageContext.close();

      const current = await readFile(MATRIX_PATH, "utf8").then((raw) => JSON.parse(raw)).catch(() => ({ rows: [], pixelComparisons: [] }));
      const allRows = [...(current.rows ?? []), ...rows.map((row) => ({
        ...row,
        viewport: { id: viewport.id, width: viewport.width, height: viewport.height, mobile: viewport.mobile,
          actualCssWidth: presentation.zoomEquivalent ? Math.ceil(viewport.width / 2) : viewport.width,
          actualCssHeight: presentation.zoomEquivalent ? Math.ceil(viewport.height / 2) : viewport.height,
          effectiveDpr: presentation.zoomEquivalent ? 2 : 1 },
        presentation: presentation.id,
      }))];
      const allComparisons = [...(current.pixelComparisons ?? []), ...pixelComparisons.map((item) => ({ ...item as object, viewport: viewport.id, presentation: presentation.id }))];
      await writeMatrix(allRows, allComparisons);
      expect(issues, issues.join("\n")).toEqual([]);
    });
  }
});
