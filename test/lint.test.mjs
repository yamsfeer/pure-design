import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lintHtml } from '../src/lint.mjs';

const fixture = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('干净页面没有 P0', () => {
  const f = lintHtml(fixture('clean.html'));
  assert.equal(f.filter((x) => x.severity === 'P0').length, 0, JSON.stringify(f));
});

test('紫→靛蓝渐变被 P0 拦下', () => {
  const html = fixture('clean.html').replace('background:var(--bg)', 'background:linear-gradient(135deg,#8b5cf6,#6366f1)');
  const f = lintHtml(html);
  assert.ok(f.some((x) => x.severity === 'P0' && x.id === 'purple-gradient'), JSON.stringify(f));
});

test('单色 --accent 是合法的品牌逃逸口，不算 AI 味', () => {
  const html = fixture('clean.html').replace('--accent:#8a3324', '--accent:#8b5cf6');
  assert.equal(lintHtml(html).filter((x) => x.severity === 'P0').length, 0);
});

test('把紫色藏进 CSS 变量也会被查出来', () => {
  const html = fixture('clean.html').replace(':root{', ':root{--sneaky:#6366f1;');
  const f = lintHtml(html);
  assert.ok(f.some((x) => x.id === 'ai-default-indigo' || x.id === 'purple-gradient'), JSON.stringify(f));
});

test('emoji 当图标被拦下', () => {
  const html = fixture('clean.html').replace('记一笔', '🚀 记一笔');
  assert.ok(lintHtml(html).some((x) => x.id === 'emoji-icon'));
});

test('finding 形状稳定（severity/id/message/fix/snippet）', () => {
  const f = lintHtml(fixture('clean.html').replace('记一笔', '🚀 记一笔'))[0];
  for (const k of ['severity', 'id', 'message', 'fix']) assert.ok(k in f, k);
});
