import { CRUISE_SPEED } from '../src/flight';
import { expect, test } from '@playwright/test';
import { assertNoForbiddenTraffic, installNetworkGuard, SMOKE_ORIGIN } from './network-guard';
import { createAssetManifest } from './asset-manifest.mjs';
import { advanceFrame, clickDom, installFrameDriver, prepareApp, readState } from './native-frame-driver';

test('minimal native driver: both modes, consumed input, one bomb, pause and resume', async ({ browser }, testInfo) => {
  const evidence: any = { kind: 'functional-controlled-clock/native-WebGL', modes: [],
    limitations: ['Not a normal-clock performance result', 'Not full acceptance', 'Only one PC viewport'] };
  try {
    for (const mode of ['easy', 'normal']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
      const blocked = await installNetworkGuard(context, createAssetManifest());
      const errors: string[] = [];
      const record: any = { mode, blocked, errors, frames: [] }; evidence.modes.push(record);
      try {
        const page = await context.newPage();
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
        await installFrameDriver(page);
        await page.goto(SMOKE_ORIGIN + '/', { waitUntil: 'domcontentloaded' });
        await prepareApp(page);
        await clickDom(page, `input[name="game-mode"][value="${mode}"]`);
        await clickDom(page, '#start');
        record.frames.push(await advanceFrame(page, 0)); // initialize lastFrame, no tick
        expect((await readState(page)).tick).toBe(0);
        expect((await readState(page)).mode).toBe(mode);
        expect((await readState(page)).screen).toBe('playing');
        await expect(page.locator('#throttle')).toHaveAttribute('role', 'slider');
        record.beforeInput = await readState(page);
        // A native short pointer tap arrives before a simulation tick.
        await clickDom(page, '#bomb');
        record.before = await readState(page);
        record.frames.push(await advanceFrame(page, 0));
        expect((await readState(page)).tick).toBe(0);
        record.beforeConsumed = await readState(page);
        if (mode === 'normal') {
          await page.locator('#throttle').focus();
          await page.keyboard.press('ArrowUp'); // native short slider pulse
        } else {
          await page.keyboard.down('ArrowRight');
        }
        record.frames.push(await advanceFrame(page, 17));
        record.consumed = await readState(page);
        expect(record.consumed.tick).toBe(1);
        expect(record.consumed.inputs).toHaveLength(1);
        expect(record.consumed.inputs[0].tick).toBe(1);
        expect(record.consumed.inputs[0].input.bomb).toBe(true);
        expect(record.consumed.bombs).toBe(record.before.bombs - 1);
        if (mode === 'normal') {
          expect(record.consumed.inputs[0].input.throttle).toBe(1);
          expect(record.consumed.targetSpeed).toBeGreaterThan(CRUISE_SPEED);
        }
        else { expect(record.consumed.inputs[0].input.turn).toBe(1); await page.keyboard.up('ArrowRight'); }
        // A fresh submission must follow consumed input, rather than merely Home's draw.
        expect(record.consumed.queue.submittedCount).toBeGreaterThan(record.beforeConsumed.queue.submittedCount);
        expect(record.consumed.queue.submittedCount).toBeGreaterThan(record.beforeInput.queue.submittedCount);
        expect(record.consumed.queue.submittedCount - record.consumed.queue.completedCount).toBe(1);
        expect(record.consumed.queue.failure).toBeNull();
        // Three's calls is per-frame, not cumulative; submission delta establishes freshness.
        expect(record.consumed.calls).toBeGreaterThan(0);
        record.frames.push(await advanceFrame(page, 0)); // native drain, then app-owned completion poll
        record.drained = await readState(page);
        expect(record.drained.tick).toBe(record.consumed.tick);
        expect(record.drained.hash).toBe(record.consumed.hash);
        expect(record.drained.queue.completedCount).toBeGreaterThan(record.consumed.queue.completedCount);
        expect(record.drained.queue.completedCount).toBeGreaterThanOrEqual(record.consumed.queue.submittedCount);
        expect(record.drained.queue.failure).toBeNull();
        record.frames.push(await advanceFrame(page, 34));
        record.after = await readState(page);
        expect(record.after.tick).toBe(3);
        expect(record.after.inputs).toHaveLength(3);
        expect(record.after.inputs.map((i: any) => i.tick)).toEqual([1, 2, 3]);
        if (mode === 'normal') expect(record.after.targetSpeed).toBe(record.consumed.targetSpeed);
        expect(record.after.inputs.slice(1).every((i: any) => !i.input.bomb && i.input.throttle === 0 && i.input.turn === 0)).toBe(true);
        expect(record.after.bombs).toBe(record.consumed.bombs);
        expect(record.after.queue.completedCount).toBeGreaterThan(record.drained.queue.completedCount);
        expect(record.after.queue.submittedCount).toBeGreaterThan(record.drained.queue.submittedCount);
        expect(record.after.calls).toBeGreaterThan(0);
        await clickDom(page, '#pause');
        record.paused = await readState(page);
        expect(record.paused.screen).toBe('paused');
        for (let i = 0; i < 3; i++) record.frames.push(await advanceFrame(page, 100));
        record.frozen = await readState(page);
        expect(record.frozen.hash).toBe(record.paused.hash);
        expect(record.frozen.tick).toBe(record.paused.tick);
        await clickDom(page, '#resume');
        record.frames.push(await advanceFrame(page, 0));
        record.frames.push(await advanceFrame(page, 17));
        record.resumed = await readState(page);
        expect(record.resumed.screen).toBe('playing');
        expect(record.resumed.tick).toBe(record.paused.tick + 1);
        expect(record.resumed.ready).toBe(true);
        expect(record.resumed.queue.failure).toBeNull();
        // Explicit accumulation fault, distinct from the native GPU drain above.
        record.frames.push(await advanceFrame(page, 501));
        record.overload = await readState(page);
        expect(record.overload.screen).toBe('paused');
        expect(record.overload.tick).toBe(record.resumed.tick);
        await expect(page.locator('#pause-reason')).toContainText('処理が遅れたため停止');
        record.frames.push(await advanceFrame(page, 17));
        expect((await readState(page)).screen).toBe('paused');
        expect(errors).toEqual([]);
      } finally {
        await context.close();
        assertNoForbiddenTraffic(blocked); // Includes teardown attempts.
      }
    }
  } finally {
    await testInfo.attach('native-driver-proof.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  }
});
