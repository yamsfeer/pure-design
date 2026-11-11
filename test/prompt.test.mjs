import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, promptRecipe } from '../src/prompt.mjs';

test('装配包含设计系统与输出契约', () => {
  const p = buildSystemPrompt({ system: 'default', template: 'web' });
  assert.match(p, /输出契约/);
  assert.match(p, /data-od-id/);
});

test('带方向时给出明确的优先级阶梯', () => {
  const p = buildSystemPrompt({ system: 'stripe', template: 'web', direction: 'editorial-monocle' });
  assert.match(p, /指令优先级/);
  assert.match(p, /配色让位给设计系统/);
});

test('未知设计系统明确报错', () => {
  assert.throws(() => buildSystemPrompt({ system: 'no-such-brand', template: 'web' }), /未知设计系统/);
});

test('没有种子的模板用参考成品兜底（dashboard）', () => {
  const p = buildSystemPrompt({ system: 'linear-app', template: 'dashboard' });
  assert.match(p, /参考成品（example\.html）/);
});

test('提示词体积有上限，防止资产膨胀悄悄拖慢每一轮', () => {
  const p = buildSystemPrompt({ system: 'default', template: 'web', direction: 'modern-minimal' });
  assert.ok(p.length < 90_000, `prompt too large: ${p.length}`);
});

test('recipe 与实际装配一致', () => {
  const r = promptRecipe({ system: 'default', template: 'web', direction: 'modern-minimal' });
  assert.equal(r.template, 'web-prototype');
  assert.ok(r.craft.includes('anti-ai-slop'));
});
