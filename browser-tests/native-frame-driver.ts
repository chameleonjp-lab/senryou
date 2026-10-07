import { performance as realClock } from 'node:perf_hooks';
import type { Page } from '@playwright/test';
import { installControlledFrameClock } from './controlled-frame-clock';

export async function installFrameDriver(page: Page) {
  await page.addInitScript(`{ const __name = fn => fn; (${installControlledFrameClock.toString()})(window); }`);
}

/** Queue a NEW fence behind actual draws; never touch the application's fence. */
export async function drainNativeGpu(page: Page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#flight');
    const gl = canvas?.getContext('webgl2');
    if (!gl || gl.isContextLost()) throw new Error('Real WebGL2 context unavailable');
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) throw new Error('Test-owned native fence unavailable');
    gl.flush();
    let polls = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        // setTimeout is native: watchdog cannot be frozen by the controlled clock.
        const watchdog = setTimeout(() => { stopped = true; reject(new Error('Native GPU fence watchdog (15s)')); }, 15_000);
        let stopped = false;
        const poll = () => {
          if (stopped) return;
          try {
            if (gl.isContextLost()) throw new Error('Native GPU context lost');
            const status = gl.clientWaitSync(fence, 0, 0); polls++;
            if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
              stopped = true; clearTimeout(watchdog); resolve();
            } else if (status === gl.TIMEOUT_EXPIRED) setTimeout(poll, 4);
            else throw new Error(`Native GPU wait failed: ${status}`);
          } catch (error) { stopped = true; clearTimeout(watchdog); reject(error); }
        };
        // WebGL requires a browser event-loop opportunity after issuing a fence.
        setTimeout(poll, 0);
      });
    } finally { gl.deleteSync(fence); }
    return { polls, nativeFenceCompleted: true };
  });
}

export async function advanceFrame(page: Page, milliseconds: number) {
  const fence = await drainNativeGpu(page);
  const now = await page.evaluate(ms => (window as any).__acceptanceClock.advance(ms), milliseconds);
  return { ...fence, now };
}

export async function prepareApp(page: Page) {
  const deadline = realClock.now() + 35_000;
  while (realClock.now() < deadline) {
    const status = await page.evaluate(() => ({
      ready: !!(window as any).__senryou?.snapshot().ready,
      error: document.querySelector('#startup-error')?.textContent?.trim(),
    }));
    if (status.error) throw new Error(`Native startup failed: ${status.error}`);
    if (status.ready) { await advanceFrame(page, 0); return; }
    // Pump preparation's real callbacks without advancing gameplay time.
    await page.evaluate(() => (window as any).__acceptanceClock.advance(0));
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Native preparation watchdog (35s)');
}

/** Native mouse input: no DOM dispatchEvent, fixture, or app API invocation. */
export async function clickDom(page: Page, selector: string) {
  const target = page.locator(selector);
  // Locator actionability waits for rAF stability; the driver owns that clock.
  await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  const box = await target.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) throw new Error(`Unreachable control: ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

export async function readState(page: Page) {
  return page.evaluate(() => {
    const api = (window as any).__senryou, state = api.snapshot(), game = api.game;
    const player = state.mission.units.find((u: any) => u.id === state.mission.controlledAircraftId);
    return { screen: state.screen, mode: state.mode, ready: state.ready, hash: state.hash,
      tick: state.mission.tick, phase: state.mission.phase, bombs: player?.bombs,
      queue: state.diagnostics.queue, calls: state.diagnostics.calls,
      targetSpeed: game.controller?.playerTargetSpeed, inputs: game.inputs.map((i: any) => ({ tick: i.tick, input: { ...i.input } })) };
  });
}
