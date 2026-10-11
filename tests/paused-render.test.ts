import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import { BattleView } from '../src/battle-view';
import { createBattle } from '../src/battle/simulation';
import { RenderQueue, type RenderQueueContext } from '../src/render-queue';

// The actual render orchestrator runs with a CPU-only renderer/GL protocol mock.
// This is not a GPU performance measurement or real-browser acceptance.
function fixture() {
  let draws = 0, wait = 0x911a, lost = false;
  const gl: RenderQueueContext = {
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117, ALREADY_SIGNALED: 0x911a,
    TIMEOUT_EXPIRED: 0x911b, CONDITION_SATISFIED: 0x911c, WAIT_FAILED: 0x911d,
    fenceSync: () => ({} as WebGLSync), clientWaitSync: () => wait,
    deleteSync: () => {}, flush: () => {}, isContextLost: () => lost,
  };
  const mission = createBattle(1).mission; mission.phase = 'paused';
  const view = Object.create(BattleView.prototype) as any;
  const queue = new RenderQueue(gl);
  Object.assign(view, {
    disposed: false, prepared: true, queue, currentMissionId: mission.missionId,
    currentPlayerId: null, flightPlayer: null, camera: new PerspectiveCamera(64, 1, .5, 22000),
    sky: { position: new Vector3() }, lastTick: 0, visualTime: 0,
    viewRevision: 0, staticFrame: null, cameraOverride: null, lod: 'normal',
    canvas: { getBoundingClientRect: () => ({ width: 393, height: 852 }) },
    aircraftTracers: { coreMaterial: { resolution: new Vector2() }, outlineMaterial: { resolution: new Vector2() } },
    renderer: { render: () => { draws++; }, setSize: () => {} },
    resetMission: function (next: typeof mission) { this.currentMissionId = next.missionId; this.staticFrame = null; },
    consumeEvents: () => {}, updateUnits: () => {}, updatePoints: () => {},
    updateProjectiles: () => {}, updateParticles: () => {}, drawOverlay: () => {},
  });
  return { view: view as BattleView, raw: view, mission, queue, gl,
    draws: () => draws, wait: (value: number) => { wait = value; }, lose: () => { lost = true; } };
}

test('a completed paused frame is retained instead of repeatedly submitting identical geometry', () => {
  const f = fixture();
  assert.equal(f.view.render(f.mission, 'easy'), true);
  for (let frame = 0; frame < 20; frame++) assert.equal(f.view.render(f.mission, 'easy'), false);
  assert.equal(f.draws(), 1);
  assert.equal(f.queue.diagnostics(performance.now()).submittedCount, 1);
});

test('the final paused tick, HUD/mode changes, resize and view options invalidate only a completed static frame', () => {
  const f = fixture();
  assert.equal(f.view.render(f.mission, 'easy'), true);
  f.mission.tick++;
  assert.equal(f.view.render(f.mission, 'easy'), true);
  assert.equal(f.view.render(f.mission, 'normal'), true);
  assert.equal(f.view.render(f.mission, 'normal', undefined, false), true);
  assert.equal(f.view.render(f.mission, 'normal', undefined, false), false);
  f.view.resize();
  assert.equal(f.view.render(f.mission, 'normal', undefined, false), true);
  f.view.setLOD('low');
  assert.equal(f.view.render(f.mission, 'normal', undefined, false), true);
  f.view.setBombGuide({ position: { x: 1, y: 2, z: 3 }, time: 1 });
  assert.equal(f.view.render(f.mission, 'normal', undefined, false), true);
  f.view.setCameraOverride({ position: { x: 0, y: 1000, z: 1000 }, quaternion: f.raw.camera.quaternion.clone() });
  assert.equal(f.view.render(f.mission, 'normal', undefined, false), true);
  f.view.setCameraOverride(null);
  assert.equal(f.view.render(f.mission, 'normal', undefined, false), true);
  const nextMission = { ...f.mission, missionId: 'new-mission' };
  assert.equal(f.view.render(nextMission, 'normal', undefined, false), true);
  assert.equal(f.view.render(nextMission, 'normal', undefined, false), false);
});

test('pending work does not consume a changed paused tick; running and result presentation keep rendering', () => {
  const f = fixture();
  assert.equal(f.view.render(f.mission, 'easy'), true);
  f.wait(f.gl.TIMEOUT_EXPIRED); f.mission.tick++;
  assert.equal(f.view.render(f.mission, 'easy'), false);
  f.wait(f.gl.ALREADY_SIGNALED);
  assert.equal(f.view.render(f.mission, 'easy'), true);
  f.mission.phase = 'running';
  assert.equal(f.view.render(f.mission, 'easy'), true);
  assert.equal(f.view.render(f.mission, 'easy'), true);
  f.mission.phase = 'result';
  const time = f.raw.visualTime;
  assert.equal(f.view.render(f.mission, 'easy', undefined, true, .05), true);
  assert.equal(f.view.render(f.mission, 'easy', undefined, true, .05), true);
  assert.ok(f.raw.visualTime >= time + .1 - 1e-12);
});

test('cached paused presentation still polls GL and exposes context loss', () => {
  const f = fixture(); f.view.render(f.mission, 'easy');
  f.lose();
  assert.equal(f.view.render(f.mission, 'easy'), false);
  assert.equal(f.queue.diagnostics(performance.now()).failure, 'context-lost');
  assert.equal(f.draws(), 1);
});

test('the retained pending fence still stalls immediately beyond the unchanged 1000ms watchdog', () => {
  const f = fixture(); f.wait(f.gl.TIMEOUT_EXPIRED); f.queue.submit(25);
  assert.equal(f.view.pollRender(1025), 'pending');
  assert.equal(f.view.pollRender(1025.01), 'stalled');
  assert.equal(f.queue.diagnostics(1025.01).submittedCount, 1);
});

test('actual main frame stops scheduling or drawing after graphics failure, even if the old fence later completes', () => {
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function frame(_timestamp:number):void{');
  const end = source.indexOf('\nasync function prepare()', start);
  assert.ok(start >= 0 && end > start);
  const runtime = source.slice(start, end).replace('function frame(_timestamp:number):void{', 'function frame(_timestamp){');
  let scheduled = 0;
  const compile = (body: string) => new Function('disposed', 'ready', 'lost', 'requestAnimationFrame', 'view', `let frameId=0,lastFrame=0; ${body}; frame(0);`);
  const run = compile(runtime);
  const view = { pollRender: () => { throw new Error('failed lifecycle must not poll/submit another frame'); } };
  for (const [ready, lost] of [[false, false], [true, true]]) run(false, ready, lost, () => { scheduled++; return 1; }, view);
  assert.equal(scheduled, 0);
  // This isolated mutation restores only the old frame guard. It must execute
  // the forbidden poll, not fail because the fixture omitted a frame variable.
  const legacy = compile(runtime.replace('if(disposed||!ready||lost)return;', 'if(disposed)return;'));
  assert.throws(() => legacy(false, false, false, () => { scheduled++; return 1; }, view), /failed lifecycle must not poll/);
  assert.equal(scheduled, 1);
});
