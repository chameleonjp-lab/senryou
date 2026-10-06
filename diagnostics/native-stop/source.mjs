import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ts from 'typescript';

export const PARENT = 'bca509526930bd9dd06b43ccd1f02bc48e8a2cca';
export const MAIN = '593cddeca36cbda3fec62eacea462667bf1faeab';
export const BASELINE = '71b0e5bc9ffbe2cbd1f295160b9e8e3c40ad6650';
export const MARKER = 'diagnostic: senryou first native stop 20261006-1115 once';
export const HELPER_SHA = '9c10249e6314ae49cdebc07d9e2b0cdf7b5b187c6f4ad921e20661bad55973fa';
export const SMOKE_SHA = 'f6914e4af00d44c9b452ff5b1612147f865dc298fbca3d3e7874ba0994cbf3d5';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const EDITS = [
  ['import { expect, test, type Page } from "@playwright/test";',
    'import { createNativeCapture, armNativeCapture, finishNativeCapture, saveNativeCapture } from "../diagnostics/native-stop/transport";\nimport { expect, test, type Page } from "@playwright/test";'],
  ['    try {\n      await page.goto(',
    '    const nativeCapture = vp.id === "pc-1280x720" ? createNativeCapture() : null;\n    try {\n      await page.goto('],
  ['      await expect(page.locator("#start")).toBeEnabled();\n      await screenshot(page, vp.id, "home");',
    '      await expect(page.locator("#start")).toBeEnabled();\n      if (nativeCapture) await armNativeCapture(page, nativeCapture);\n      await screenshot(page, vp.id, "home");'],
  ['    } finally {\n      try {\n        await context.close();',
    '    } finally {\n      if (nativeCapture) await finishNativeCapture(nativeCapture);\n      try {\n        await context.close();\n        if (nativeCapture) nativeCapture.contextClosed = true;'],
  ['          assertNoForbiddenTraffic(blockedExternal);',
    '          assertNoForbiddenTraffic(blockedExternal);\n          if (nativeCapture) nativeCapture.networkChecked = true;'],
  ['        evidence.failure ??= error instanceof Error ? `${error.name}: ${error.message}` : String(error);',
    '        if (nativeCapture) nativeCapture.contextCloseFailure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);\n        evidence.failure ??= error instanceof Error ? `${error.name}: ${error.message}` : String(error);'],
  ['          await writeFile(path.join(OUT, `${vp.id}.json`), `${JSON.stringify(evidence, null, 2)}\\n`);',
    '          await writeFile(path.join(OUT, `${vp.id}.json`), `${JSON.stringify(evidence, null, 2)}\\n`);\n          if (nativeCapture) saveNativeCapture(nativeCapture, evidence);'],
];
function once(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, 'Exactly one pinned instrumentation anchor required');
  return source.replace(before, after);
}
export function instrument(source) {
  assert.equal(sha256(source), SMOKE_SHA, 'Smoke source drift');
  let result = source;
  for (const [before, after] of EDITS) result = once(result, before, after);
  let reconstructed = result;
  for (const [before, after] of [...EDITS].reverse()) reconstructed = once(reconstructed, after, before);
  assert.equal(reconstructed, source, 'Instrumentation must reverse to byte-identical original');
  return result;
}
export function injectionSource(helper) {
  assert.equal(sha256(helper), HELPER_SHA, 'Frozen helper drift');
  const result = ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  assert.equal(result.diagnostics?.length ?? 0, 0);
  const compiled = result.outputText.replace('export const MAX_RECORD_JSON_BYTES', 'const MAX_RECORD_JSON_BYTES')
    .replace('export function installFirstNativeStop', 'function installFirstNativeStop');
  assert.ok(!/\b(import|export)\b/.test(compiled), 'Injection must be a private import-free closure');
  return '(() => {\n"use strict";\n' + compiled + '\nreturn installFirstNativeStop({ api: window.__senryou, start: document.querySelector("#start"), startupError: document.querySelector("#startup-error"), reload: document.querySelector("#reload") });\n})()';
}
