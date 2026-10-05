import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { BattleView } from '../../src/battle-view.ts';

async function scenario(statuses: number[], interruption?: 'lost' | 'disposed') {
  const callbacks: (() => void)[] = [];
  (globalThis as any).requestAnimationFrame = (callback: () => void) => { callbacks.push(callback); return callbacks.length; };
  const calls: any[] = [];
  let lost = false;
  const gl = { SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, WAIT_FAILED: 4,
    fenceSync: () => { calls.push('fence'); return {}; }, flush: () => calls.push('flush'),
    isContextLost: () => lost,
    clientWaitSync: (_sync: any, flags: number, timeout: number) => { calls.push(['wait', flags, timeout]); return statuses.shift() ?? 2; },
    deleteSync: () => calls.push('delete') };
  const geometry = () => ({ attributes: { position: {}, color: {} }, setDrawRange: () => {} });
  const fake: any = { disposed: false, prepared: false, scene: {}, camera: { quaternion: new Quaternion(), position: new Vector3() },
    acquireSlot: () => ({ root: { visible: false, position: { set: () => {} } } }),
    renderer: { compileAsync: async () => {}, render: () => calls.push('render'), getContext: () => gl },
    aircraftTracers: { prime: () => {}, update: () => {} }, tracerPositions: new Float32Array(6), tracerColors: new Float32Array(6),
    tracerGeometry: geometry(), particlePositions: new Float32Array(3), particleColors: new Float32Array(3),
    particleSizes: new Float32Array(1), particleOpacity: new Float32Array(1), particleGeometry: geometry(),
    bombs: { count: 0, instanceMatrix: {}, setMatrixAt: () => {} }, matrix: new Matrix4() };
  const pending = BattleView.prototype.prepare.call(fake).then(() => ({ success: true }), error => ({ success: false, message: String(error) }));
  await Promise.resolve();
  if (interruption === 'lost') lost = true;
  if (interruption === 'disposed') fake.disposed = true;
  for (let i = 0; i < 10 && callbacks.length; i++) callbacks.shift()!();
  const result = await pending;
  assert.equal(calls.filter(x => x === 'render').length, 2);
  assert.equal(calls.filter(x => x === 'delete').length, 1);
  for (const wait of calls.filter(Array.isArray)) assert.deepEqual(wait, ['wait', 0, 0]);
  assert.equal(fake.prepared, !interruption && statuses[0] !== 4 && result.success);
  return { result, prepared: fake.prepared, calls };
}
const ready = await scenario([5, 2]); assert.equal(ready.result.success, true); assert.equal(ready.prepared, true);
const failed = await scenario([4]); assert.equal(failed.result.success, false); assert.equal(failed.prepared, false);
const lost = await scenario([5, 2], 'lost'); assert.equal(lost.result.success, false); assert.equal(lost.prepared, false);
const disposed = await scenario([5, 2], 'disposed'); assert.equal(disposed.result.success, false); assert.equal(disposed.prepared, false);
console.log('PASS: warmup GPU fence success, WAIT_FAILED, context loss, disposal; two priming renders, nonblocking waits, exactly one fence deletion.');
