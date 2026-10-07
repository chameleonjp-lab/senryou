import test from 'node:test';
import assert from 'node:assert/strict';
import { installControlledFrameClock } from '../browser-tests/controlled-frame-clock';

test('controlled frame clock aligns timestamps, defers new callbacks and honors cancellation', () => {
  const timer = () => 42;
  const host: any = { performance: { now: () => 99 }, setTimeout: timer };
  installControlledFrameClock(host);
  const seen: number[] = [];
  const cancelled = host.requestAnimationFrame(() => assert.fail('cancelled callback'));
  host.cancelAnimationFrame(cancelled);
  host.requestAnimationFrame((time: number) => {
    assert.equal(time, host.performance.now()); seen.push(time);
    host.requestAnimationFrame((next: number) => seen.push(next));
  });
  host.__acceptanceClock.advance(0);
  assert.deepEqual(seen, [1000]);
  host.__acceptanceClock.advance(17);
  assert.deepEqual(seen, [1000, 1017]);
  assert.equal(host.__acceptanceClock.pending(), 0);
  assert.equal(host.setTimeout, timer);
  for (const invalid of [-1, NaN, Infinity]) assert.throws(() => host.__acceptanceClock.advance(invalid));
});

test('cancellation inside a frame suppresses a later callback from its snapshot', () => {
  const host: any = { performance: {} }; installControlledFrameClock(host);
  let later: number;
  host.requestAnimationFrame(() => host.cancelAnimationFrame(later));
  later = host.requestAnimationFrame(() => assert.fail('cancelled during frame'));
  host.__acceptanceClock.advance(1);
});


test('serialized init script has no unavailable transpiler helpers', async () => {
  const { installFrameDriver } = await import('../browser-tests/native-frame-driver');
  const { runInNewContext } = await import('node:vm');
  let source = '';
  await installFrameDriver({ addInitScript: async (script: string) => { source = script; } } as any);
  const host: any = { performance: {} };
  runInNewContext(source, { window: host });
  assert.equal(host.performance.now(), 1000);
  host.__acceptanceClock.advance(17);
  assert.equal(host.performance.now(), 1017);
});
