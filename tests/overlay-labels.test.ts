import test from 'node:test';
import assert from 'node:assert/strict';
import { OverlayLabels, type LabelBox } from '../src/overlay-labels';

const intersects = (a: LabelBox, b: LabelBox) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('compact-world labels remain inside the screen and avoid HUD, sight, radar and earlier labels', () => {
  const obstacles = [
    { x: 0, y: 0, width: 225, height: 85 },
    { x: 0, y: 112, width: 165, height: 115 },
    { x: 0, y: 240, width: 234, height: 80 },
    { x: 450, y: 55, width: 104, height: 115 },
    { x: 250, y: 76, width: 70, height: 70 },
    { x: 320, y: 120, width: 110, height: 28 },
    { x: 310, y: 160, width: 220, height: 35 },
    { x: 250, y: 220, width: 65, height: 100 },
  ];
  const before = structuredClone(obstacles), labels = new OverlayLabels(568, 320, obstacles), placed: LabelBox[] = [];
  for (const width of [90, 225, 175, 60, 45, 30, 25, 25, 25]) {
    const original = { x: 280 - width / 2, y: 108, width, height: 17 }, snapshot = { ...original };
    const result = labels.place(original);
    assert.deepEqual(original, snapshot);
    assert.ok(result.x >= 6 && result.y >= 6 && result.x + result.width <= 562 && result.y + result.height <= 314);
    assert.ok(![...obstacles, ...placed].some(box => intersects(result, box)), JSON.stringify(result));
    placed.push(result);
  }
  assert.deepEqual(obstacles, before);
});

test('a free original label stays anchored and cannot mutate reservation inputs', () => {
  const source = [{ x: 10, y: 10, width: 40, height: 30 }], labels = new OverlayLabels(568, 320, source);
  source[0].x = 100;
  const anchor = { x: 100, y: 100, width: 50, height: 18 };
  assert.deepEqual(labels.place(anchor), anchor);
  const crowded = labels.place(anchor);
  assert.ok(!intersects(crowded, anchor));
});

test('when a view has no free area, retain the original label instead of dropping information', () => {
  const labels = new OverlayLabels(320, 180, [{ x: 0, y: 0, width: 320, height: 180 }]);
  const original = { x: 145, y: 90, width: 40, height: 17 };
  assert.deepEqual(labels.place(original), original);
});
