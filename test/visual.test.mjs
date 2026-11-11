import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { visualCheck, findChromium } from '../src/visual-check.mjs';

const skip = !findChromium() ? '本机没有 Chromium，跳过' : false;

test('390px 下的横向溢出能被真浏览器抓到', { skip }, async () => {
  const url = new URL('./fixtures/overflow.html', import.meta.url);
  assert.ok(existsSync(url));
  const f = await visualCheck(url.pathname, { widths: [390] });
  assert.ok(f.some((x) => x.id === 'h-overflow' && x.severity === 'P0'), JSON.stringify(f));
});

test('干净页面不会误报 P0', { skip }, async () => {
  const url = new URL('./fixtures/clean.html', import.meta.url);
  const f = await visualCheck(url.pathname, { widths: [390, 1440] });
  assert.equal(f.filter((x) => x.severity === 'P0').length, 0, JSON.stringify(f));
});
