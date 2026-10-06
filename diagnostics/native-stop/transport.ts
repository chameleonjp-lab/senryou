import type { JSHandle, Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'native-stop-evidence');
export const RECORD_BYTE_CAP = 1424;
export interface NativeCapture {
  handle: JSHandle | null;
  armAttempted: boolean;
  armed: boolean;
  observerCleanup: boolean;
  handleDisposed: boolean;
  contextClosed: boolean;
  networkChecked: boolean;
  contextCloseFailure: string | null;
  problems: string[];
  record: unknown;
  recordBytes: number | null;
}
export function createNativeCapture(): NativeCapture {
  return { handle: null, armAttempted: false, armed: false, observerCleanup: false, handleDisposed: false,
    contextClosed: false, networkChecked: false, contextCloseFailure: null, problems: [], record: null, recordBytes: null };
}
export async function armNativeCapture(page: Page, state: NativeCapture): Promise<void> {
  state.armAttempted = true;
  try {
    // Exclusive claim survives worker replacement. A failed arm also consumes it.
    writeFileSync(path.join(OUT, 'arm-claim.json'), JSON.stringify({ target: 'pc-1280x720', attempts: 1 }), { flag: 'wx' });
    const injection = readFileSync(path.join(OUT, 'injection.js.txt'), 'utf8');
    state.handle = await page.evaluateHandle(injection);
    state.armed = true;
  } catch {
    state.problems.push('arm-or-claim-failed');
  }
}
export async function finishNativeCapture(state: NativeCapture): Promise<void> {
  if (!state.handle) { state.problems.push('missing-handle'); return; }
  try {
    const result = await state.handle.evaluate((handle: any) => {
      let cleaned = false, cleanupThrew = false, readThrew = false, payloadBoundFailed = false, payload: string | null = null;
      // Extraction follows the teardown attempt, so read observes its invalidation.
      try { cleaned = handle.uninstall() === true; } catch { cleanupThrew = true; }
      try {
        const candidate = JSON.stringify(handle.read());
        // Fixed ASCII means code-unit count is exactly UTF-8 byte count.
        if (candidate.length <= 1424 && /^[\x00-\x7f]*$/.test(candidate)) payload = candidate;
        else payloadBoundFailed = true;
      } catch { readThrew = true; }
      return { cleaned, cleanupThrew, readThrew, payloadBoundFailed, payload };
    });
    state.observerCleanup = result.cleaned && !result.cleanupThrew;
    if (!state.observerCleanup) state.problems.push('observer-cleanup-failed');
    if (result.payloadBoundFailed) state.problems.push('browser-record-bound-failed');
    if (result.readThrew || result.payload === null) state.problems.push('record-read-failed');
    else {
      const bytes = Buffer.byteLength(result.payload, 'utf8');
      state.recordBytes = bytes;
      if (bytes > RECORD_BYTE_CAP || !/^[\x00-\x7f]*$/.test(result.payload)) state.problems.push('record-bound-or-ascii-failed');
      else state.record = JSON.parse(result.payload);
    }
  } catch {
    state.problems.push('record-transport-failed');
  } finally {
    try { await state.handle.dispose(); state.handleDisposed = true; }
    catch { state.problems.push('handle-dispose-failed'); }
    state.handle = null;
  }
}
export function saveNativeCapture(state: NativeCapture, originalEvidence: Record<string, unknown>): void {
  try {
  if (!state.contextClosed) state.problems.push('context-close-failed');
  if (!state.networkChecked) state.problems.push('network-final-check-failed');
  const { handle: _handle, record, ...metadata } = state;
  // Metadata and original errors never enter the fixed native record.
  writeFileSync(path.join(OUT, 'capture-metadata.json'), JSON.stringify({
    schema: 1, target: 'pc-1280x720', diagnosticOnly: true, ...metadata,
    fixtureFailure: originalEvidence.failure ?? null,
    fixtureNetworkFailure: originalEvidence.networkFailure ?? null,
  }, null, 2) + '\n', { flag: 'wx' });
  if (record !== null) {
    const payload = JSON.stringify(record);
    if (Buffer.byteLength(payload, 'utf8') > RECORD_BYTE_CAP) throw new Error('Native record exceeded fixed cap');
    writeFileSync(path.join(OUT, 'first-native-stop.json'), payload, { flag: 'wx' });
  }
  } catch {
    // Preserve any original fixture error. The runner rejects absent/partial output.
    try { writeFileSync(path.join(OUT, 'capture-write-failed.txt'), 'capture-write-failed\n', { flag: 'wx' }); } catch { /* still rejected as missing evidence */ }
  }
}
