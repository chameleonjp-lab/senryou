import test from 'node:test';
import assert from 'node:assert/strict';
import { appliedControlOpacity } from '../browser-tests/acceptance/control-opacity-observation';

test('control opacity observes the applied CSS variable and computed value', () => {
  assert.equal(appliedControlOpacity({ customProperty: '0.9', computedOpacity: '0.9' }), .9);
  assert.equal(appliedControlOpacity({ customProperty: ' .21 ', computedOpacity: '0.21' }), .21);
  assert.equal(appliedControlOpacity({ customProperty: '0', computedOpacity: '0' }), 0);
});

for (const raw of ['', ' ', '\t\n', 'NaN', 'Infinity', '-0.01', '1.01', '0x1', '21%', '0.21garbage']) {
  test(`control opacity rejects invalid or absent observations: ${JSON.stringify(raw)}`, () => {
    assert.throws(() => appliedControlOpacity({ customProperty: raw, computedOpacity: '0' }), /Invalid/);
    assert.throws(() => appliedControlOpacity({ customProperty: '0', computedOpacity: raw }), /Invalid/);
    assert.throws(() => appliedControlOpacity({ customProperty: raw, computedOpacity: raw }), /Invalid/);
  });
}

test('control opacity rejects a new variable before CSS has applied it', () => {
  assert.throws(() => appliedControlOpacity({ customProperty: '0.21', computedOpacity: '0.9' }), /not applied/);
});

test('control opacity rejects a matching inline opacity with a missing or stale variable', () => {
  assert.throws(() => appliedControlOpacity({ customProperty: '', computedOpacity: '0.21' }), /Invalid/);
  assert.throws(() => appliedControlOpacity({ customProperty: '0.9', computedOpacity: '0.21' }), /not applied/);
});
