import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_TYPES, checkTaskTypeAssets, normalizeDecision, skillCandidatesFor, templateCandidatesFor,
} from '../src/task-types.mjs';
import { inferTaskType, parseDecision } from '../src/router.mjs';

test('任务类型候选表全部指向真实资产', () => {
  assert.deepEqual(checkTaskTypeAssets(), []);
});

test('inferTaskType 不再把 apple 判成 mobile', () => {
  assert.equal(inferTaskType('做一个 apple 官网风格的品牌页'), 'brand');
  assert.equal(inferTaskType('极简记账 App 首页'), 'mobile');
  assert.equal(inferTaskType('数据看板'), 'dashboard');
  assert.equal(inferTaskType('季度汇报 deck'), 'deck');
});

test('skill 候选里一定有 frontend-design 且都真实存在', () => {
  for (const k of Object.keys(TASK_TYPES)) {
    const c = skillCandidatesFor(k);
    assert.ok(c.includes('frontend-design'), k);
  }
});

test('模板候选只返回存在的模板', () => {
  for (const k of Object.keys(TASK_TYPES)) {
    assert.ok(templateCandidatesFor(k).length > 0, k);
  }
});

test('模型给出不存在的资产 id 时逐级回退，而不是抛错', () => {
  const d = normalizeDecision({ taskType: 'brand', template: 'portoflio', skill: 'nope', designSystem: 'nope', direction: 'nope' }, { system: 'default' });
  assert.ok(templateCandidatesFor('brand').includes(d.template));
  assert.equal(d.skill, 'frontend-design');
  assert.equal(d.designSystem, 'default');
  assert.equal(d.direction, null);
});

test('parseDecision 容忍尾随逗号', () => {
  const d = parseDecision('<decision>{"taskType":"web","skill":"frontend-design",}</decision>');
  assert.equal(d.taskType, 'web');
});
