import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleSections } from '../src/rules-guide';

for (const mode of ['normal', 'easy'] as const) {
  for (const input of ['touch', 'keyboard'] as const) {
    test(`${mode}/${input}: rules explain infantry capture, finite forces, survival and score`, () => {
      const sections = ruleSections({ mode, input, keyboardDescription: 'CUSTOM KEYS' });
      const text = sections.flatMap(section => section.paragraphs).join('\n');
      for (const required of ['歩兵で敵本拠地', '両軍の歩兵が1人以上', '中立化してから占領', '飛び越し占領', '20作戦秒', '予備から', '5作戦秒', '地上戦を観戦', '20分', '同じ瞬間', 'Time −', '最初の接触', '20秒で再装填', '最後に一度だけ', '自動で再開しません']) {
        assert.ok(text.includes(required), `Missing rule: ${required}`);
      }
      assert.doesNotMatch(text, /魚雷|艦隊|HPが15回復|40秒ごと|順位送信/);
      assert.equal(text.includes('CUSTOM KEYS'), input === 'keyboard');
      assert.equal(text.includes('別の指'), input === 'touch');
      const controls = sections.find(section => section.heading === (input === 'touch' ? 'スマートフォンの操作' : 'PCの操作'))!.paragraphs.join('\n');
      assert.ok(controls.includes(mode === 'easy' ? '自動射撃' : '長押し'));
      if (mode === 'easy' && input === 'keyboard') assert.ok(controls.includes('射撃・加速・減速キーは無効'));
    });
  }
}
