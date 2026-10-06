import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const MAIN = '593cddeca36cbda3fec62eacea462667bf1faeab';
export const GUARD = '4dd59b2ee493baace036d2a36490d3597872fd5f';
export const MARKER = 'diagnostic: senryou paired harness 20261006-0905 once';
export const BLOBS = { control: 'fdbe04fb5f825b2629026fa4150f5df53666ec8e', guard: '823181876a78d2ddf3106e9801d30b19d3b74181' };
export const gitBlob = source => createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex');
export const sha256 = source => createHash('sha256').update(source).digest('hex');
function once(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, `Expected one exact replacement: ${before.slice(0, 70)}`);
  return source.replace(before, after);
}
export function gameplayBody(source) {
  return source.slice(source.indexOf('      await ready(page);'), source.indexOf('      expect(pageErrors).toEqual([]);') + '      expect(pageErrors).toEqual([]);'.length);
}
export function instrument(source, arm) {
  assert.ok(arm === 'control' || arm === 'guard');
  assert.equal(gitBlob(source), BLOBS[arm], 'Pinned smoke source drifted');
  let result = 'import { PairedObserver, observeCapture, flushObservers } from "./paired-diagnostic-observer";\n' + source;
  result = once(result, 'const OUT =', 'test.afterEach(async () => { await flushObservers(); });\n\nconst OUT =');
  const screenshot = '  await page.screenshot({ path: path.join(OUT, `${id}-${state}.png`), animations: "disabled" });';
  result = once(result, screenshot,
    '  await observeCapture(page, id, state, "before");\n  try {\n' + screenshot + '\n  } finally {\n    await observeCapture(page, id, state, "after");\n  }');
  result = once(result, '    const page = await context.newPage();',
    `    const diagnostic = new PairedObserver(context, "${arm}", vp.id);\n` +
    (arm === 'control' ? '    await diagnostic.installControlSockets();\n' : '') +
    '    await diagnostic.installOuterHttpFence();\n    const page = await context.newPage();\n    await diagnostic.preparePage(page);');
  result = once(result, '      viewport: vp,', '      pairedDiagnostic: diagnostic.evidence,\n      viewport: vp,');
  if (arm === 'control') result = once(result, 'browser: "Playwright 1.61.1 / Chromium 149.0.7827.55 / SwiftShader",',
    'browser: `Playwright 1.61.1 / Chromium ${browser.version()} / SwiftShader`,');
  assert.equal(gameplayBody(result), gameplayBody(source));
  for (const literal of ['serviceWorkers: "block"', 'deviceScaleFactor: 1', 'test.setTimeout(120_000)', screenshot.trim()]) assert.ok(result.includes(literal));
  assert.equal((result.match(/await screenshot\(page, vp.id,/g) ?? []).length, 4);
  return result;
}
