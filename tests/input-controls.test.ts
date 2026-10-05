import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightControls } from '../src/input';

// Handler-level coverage adapted from the fixed Kaisen ownership/recovery tests.
// Native browser gestures and focus paths are verified separately.
class ElementStub extends EventTarget {
  style = { left: '', top: '', setProperty() {}, removeProperty() {} };
  classList = { add() {}, remove() {} };
  attributes = new Map<string, string>();
  isContentEditable = false;
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
  closest(selector: string) { return selector === '#app' ? this : null; }
  querySelector() { return this; }
  setPointerCapture() { throw new Error('capture unavailable'); }
  hasPointerCapture() { return false; }
}

function pointer(type: string, id: number, x = 100, y = 200, primary = false) {
  return Object.assign(new Event(type, { cancelable: true }), {
    pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0, buttons: 1, isPrimary: primary,
  });
}

function key(type: string, code: string, extras = {}) {
  return Object.assign(new Event(type, { cancelable: true }), {
    code, repeat: false, isComposing: false, ctrlKey: false, altKey: false, metaKey: false, ...extras,
  });
}

function fixture() {
  const originals = ['window', 'document', 'HTMLElement', 'localStorage'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const win = Object.assign(new EventTarget(), { visualViewport: new EventTarget() });
  const doc = Object.assign(new EventTarget(), { hidden: false, getElementById: () => new ElementStub() });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: ElementStub });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  const surface = new ElementStub();
  const buttons = { fire: new ElementStub(), loop: new ElementStub(), accelerate: new ElementStub(), brake: new ElementStub(), bomb: new ElementStub() };
  let active = true;
  const controls = new FlightControls(surface as any, buttons as any, () => active);
  return {
    win, doc, surface, buttons, controls, setActive(value: boolean) { active = value; },
    dispose() {
      controls.dispose();
      for (const [name, original] of originals) if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name);
    },
  };
}

test('relative steering and separate fire fingers survive unrelated cancellation and capture failure', () => {
  const f = fixture();
  try {
    f.surface.dispatchEvent(pointer('pointerdown', 1));
    f.win.dispatchEvent(pointer('pointermove', 1, 130));
    f.buttons.fire.dispatchEvent(pointer('pointerdown', 2));
    f.buttons.accelerate.dispatchEvent(pointer('pointerdown', 3));
    assert.ok(f.controls.sample().turn > .7);
    f.win.dispatchEvent(pointer('pointercancel', 2));
    const sample = f.controls.sample();
    assert.equal(sample.fire, false); assert.equal(sample.accelerate, true);
    assert.equal(f.controls.peek().steerPointer, 1);
    f.win.dispatchEvent(pointer('pointerup', 1));
    assert.equal(f.controls.sample().turn, 0);
    f.surface.dispatchEvent(pointer('pointerdown', 4));
    f.win.dispatchEvent(pointer('pointermove', 4, 70));
    assert.ok(f.controls.sample().turn < -.7);
  } finally { f.dispose(); }
});

test('bomb and loop require a completed release; cancellation and compatibility clicks cannot double-fire', () => {
  const f = fixture();
  try {
    f.controls.setMode('easy');
    for (const name of ['bomb', 'loop'] as const) {
      f.buttons[name].dispatchEvent(pointer('pointerdown', 1));
      assert.equal(f.controls.sample()[name], false);
      f.buttons[name].dispatchEvent(pointer('lostpointercapture', 1));
      f.win.dispatchEvent(pointer('pointerup', 1));
      assert.equal(f.controls.sample()[name], false);
      f.buttons[name].dispatchEvent(pointer('pointerdown', 2));
      f.win.dispatchEvent(pointer('pointercancel', 2));
      assert.equal(f.controls.sample()[name], false);
      f.buttons[name].dispatchEvent(pointer('pointerdown', 3));
      f.win.dispatchEvent(pointer('pointerup', 3));
      assert.equal(f.controls.sample()[name], true);
      f.buttons[name].dispatchEvent(Object.assign(new Event('click'), { detail: 1 }));
      assert.equal(f.controls.sample()[name], false);
      f.buttons[name].dispatchEvent(Object.assign(new Event('click'), { detail: 0 }));
      assert.equal(f.controls.sample()[name], true);
      assert.equal(f.controls.sample()[name], false);
    }
    f.win.dispatchEvent(key('keydown', 'KeyX'));
    assert.equal(f.controls.sample().bomb, false);
    assert.equal('torpedo' in f.controls.sample(), false);
  } finally { f.dispose(); }
});

test('paused and handed-over aircraft require old held keys and pointers to be released', () => {
  const f = fixture();
  try {
    f.win.dispatchEvent(key('keydown', 'Space'));
    f.win.dispatchEvent(key('keydown', 'ArrowRight'));
    f.buttons.bomb.dispatchEvent(pointer('pointerdown', 9));
    assert.equal(f.controls.sample().fire, true);
    f.controls.clear();
    f.win.dispatchEvent(key('keydown', 'Space'));
    f.win.dispatchEvent(key('keydown', 'ArrowRight', { repeat: true }));
    f.buttons.bomb.dispatchEvent(pointer('pointerdown', 9));
    let sample = f.controls.sample();
    assert.equal(sample.fire, false); assert.equal(sample.turn, 0); assert.equal(sample.bomb, false);
    f.win.dispatchEvent(pointer('pointerup', 9));
    assert.equal(f.controls.sample().bomb, false);
    f.win.dispatchEvent(key('keyup', 'Space'));
    f.win.dispatchEvent(key('keyup', 'ArrowRight'));
    f.win.dispatchEvent(key('keydown', 'Space'));
    f.win.dispatchEvent(key('keydown', 'ArrowRight'));
    f.buttons.bomb.dispatchEvent(pointer('pointerdown', 9));
    f.win.dispatchEvent(pointer('pointerup', 9));
    sample = f.controls.sample();
    assert.equal(sample.fire, true); assert.equal(sample.turn, 1); assert.equal(sample.bomb, true);
    f.setActive(false); f.controls.sample();
    f.win.dispatchEvent(key('keydown', 'KeyZ'));
    f.buttons.loop.dispatchEvent(pointer('pointerdown', 10));
    f.setActive(true);
    f.win.dispatchEvent(key('keydown', 'KeyZ'));
    f.buttons.loop.dispatchEvent(pointer('pointerdown', 10));
    f.win.dispatchEvent(pointer('pointerup', 10));
    assert.equal(f.controls.sample().bomb, false); assert.equal(f.controls.sample().loop, false);
    f.win.dispatchEvent(key('keyup', 'KeyZ'));
    f.win.dispatchEvent(key('keydown', 'KeyZ'));
    assert.equal(f.controls.sample().bomb, true);
  } finally { f.dispose(); }
});

test('resize, rotation, blur, pagehide and visibility loss release every owned control', () => {
  const f = fixture();
  try {
    const transitions = [
      () => f.win.dispatchEvent(new Event('resize')),
      () => f.win.visualViewport.dispatchEvent(new Event('resize')),
      () => f.win.dispatchEvent(new Event('blur')),
      () => f.win.dispatchEvent(new Event('pagehide')),
      () => { f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange')); },
    ];
    for (let i = 0; i < transitions.length; i++) {
      const id = i * 2 + 1;
      f.surface.dispatchEvent(pointer('pointerdown', id));
      f.win.dispatchEvent(pointer('pointermove', id, 130));
      f.buttons.accelerate.dispatchEvent(pointer('pointerdown', id + 1));
      f.win.dispatchEvent(key('keydown', 'KeyZ'));
      transitions[i]();
      const sample = f.controls.sample();
      assert.equal(sample.turn, 0); assert.equal(sample.accelerate, false); assert.equal(sample.bomb, false);
      assert.equal(f.controls.peek().steerPointer, null);
      assert.deepEqual(f.controls.peek().keys, []);
      f.win.dispatchEvent(pointer('pointercancel', id));
      f.win.dispatchEvent(pointer('pointercancel', id + 1));
      f.win.dispatchEvent(key('keyup', 'KeyZ'));
    }
  } finally { f.dispose(); }
});
