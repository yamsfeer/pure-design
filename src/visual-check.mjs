/**
 * src/visual-check.mjs — 确定性视觉自检（真浏览器，非 LLM 自评）
 *
 * lint.mjs 只能做字符串匹配；它看不到「390px 下横向溢出」「正文对比度 3.2:1」
 * 「按钮只有 28px 高」这类只有在浏览器里才成立的问题。这里用本机 Chromium
 * 打开产物，在 390 / 1440 两个宽度下量真实布局，产出与 lint 同构的 findings。
 *
 * 设计取舍：
 * - 用 playwright-core + 本机已有 Chromium（不下载浏览器、不引入 Electron）。
 * - 缺依赖 / 缺浏览器时**降级为跳过**并只警告一次，绝不阻断生成。
 * - 输出形状与 lintHtml 一致（{ severity, id, message, fix, snippet }），
 *   这样 agent.mjs 可以复用同一个 renderFindingsForAgent 回喂模型。
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let warned = false;
const warnOnce = (msg) => { if (!warned) { warned = true; process.stderr.write(`[visual-check] ${msg}\n`); } };

/* ─── 找 playwright-core（项目内 → 全局 npm → 直接给 chromium 路径）──────── */
function loadPlaywright() {
  try { return require('playwright-core'); } catch { /* 继续找 */ }
  try { return require('playwright'); } catch { /* 继续找 */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return require(join(root, 'playwright-core'));
  } catch { /* 继续找 */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return require(join(root, 'playwright/node_modules/playwright-core'));
  } catch { /* 继续找 */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return require(join(root, 'playwright'));
  } catch { return null; }
}

/* ─── 找本机 Chromium（不下载；按 AGENTS 约定优先 playwright-browsers）────── */
export function findChromium() {
  if (process.env.PURE_DESIGN_CHROME && existsSync(process.env.PURE_DESIGN_CHROME)) return process.env.PURE_DESIGN_CHROME;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), '.local/share/playwright-browsers'),
    join(homedir(), '.cache/ms-playwright'),
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const p = join(root, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) {
    if (existsSync(p)) return p;
  }
  return null;
}

/* ─── 页面内测量（在浏览器上下文执行，必须自包含）──────────────────────── */
function measureInPage() {
  const parseColor = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) {
      const hex = s.trim().replace('#', '');
      if (/^[0-9a-f]{6}$/i.test(hex)) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1);
      if (/^[0-9a-f]{3}$/i.test(hex)) return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16)).concat(1);
      return null;
    }
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const blend = (fg, bg) => {
    const a = fg[3];
    return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))).concat(1);
  };
  const bgOf = (el) => {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      const c = parseColor(cs.backgroundColor);
      if (c && c[3] > 0.95) return c;
      if (c && c[3] > 0) return blend(c, [255, 255, 255, 1]);
      cur = cur.parentElement;
    }
    const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
    return bodyBg && bodyBg[3] > 0.9 ? bodyBg : [255, 255, 255, 1];
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const vw = document.documentElement.clientWidth;

  const out = { vw, scrollWidth: document.documentElement.scrollWidth, overflow: [], contrast: [], targets: [], imgs: [], headings: [], emptySections: [], consoleErrors: [] };

  // 横向溢出：找出右边界超出视口的元素（排除 fixed 装饰）
  const all = Array.from(document.querySelectorAll('body *')).filter(visible);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') {
      out.overflow.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60), right: Math.round(r.right), w: Math.round(r.width) });
    }
  }

  // 对比度：只量有直接文本的元素，字号 < 24px（或 <18.66px bold）按 4.5，否则 3
  for (const el of all) {
    const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (!text) continue;
    const cs = getComputedStyle(el);
    const fg = parseColor(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    const got = ratio(fg[3] > 0.95 ? fg : blend(fg, bg), bg);
    if (got < need) out.contrast.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60), text: text.slice(0, 40), ratio: Math.round(got * 100) / 100, need, size });
  }

  // 触控目标：交互元素短边 < 44px
  for (const el of document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) out.targets.push({ tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
  }

  // 图片 alt
  for (const img of document.querySelectorAll('img')) {
    if (!img.hasAttribute('alt')) out.imgs.push({ src: (img.getAttribute('src') || '').slice(0, 60) });
  }

  // 标题层级
  const hs = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(visible).map((h) => +h.tagName[1]);
  const h1 = hs.filter((n) => n === 1).length;
  if (h1 === 0) out.headings.push('缺少 h1');
  if (h1 > 1) out.headings.push(`h1 出现 ${h1} 次`);
  for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) out.headings.push(`标题从 h${hs[i - 1]} 跳到 h${hs[i]}`);

  // 空 section（有高度但没文字/图片）
  for (const s of document.querySelectorAll('section')) {
    if (!visible(s)) continue;
    const r = s.getBoundingClientRect();
    const hasContent = s.querySelector('img,svg,canvas,video') || (s.textContent || '').trim().length > 12;
    if (r.height > 40 && !hasContent) out.emptySections.push({ id: s.getAttribute('data-od-id') || s.id || '(no id)', h: Math.round(r.height) });
  }
  return out;
}

const WIDTHS = [390, 1440];

/* ─── 主入口：返回 findings（与 lint 同构）───────────────────────────────── */
export async function visualCheck(file, { widths = WIDTHS } = {}) {
  const pw = loadPlaywright();
  if (!pw) { warnOnce('未找到 playwright-core，跳过视觉自检（npm i -D playwright-core 可启用）'); return []; }
  const executablePath = findChromium();
  if (!executablePath) { warnOnce('未找到本机 Chromium，跳过视觉自检（设 PURE_DESIGN_CHROME 指向 chrome 可启用）'); return []; }

  let browser;
  const findings = [];
  const push = (severity, id, message, fix, snippet) => findings.push({ severity, id, message, fix, snippet });
  const consoleErrors = [];
  try {
    browser = await pw.chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120)); });
      page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 120)));
      await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts?.ready);
      const m = await page.evaluate(measureInPage);
      const tag = `${width}px`;

      if (m.scrollWidth > m.vw + 1) {
        push('P0', 'h-overflow', `${tag} 下页面横向溢出（内容宽 ${m.scrollWidth}px > 视口 ${m.vw}px）`,
          '给溢出容器加 max-width:100%/min-width:0，或改用 grid/flex-wrap；不要用 overflow-x:hidden 掩盖',
          m.overflow.slice(0, 4).map((o) => `<${o.tag} class="${o.cls}"> right=${o.right}`).join(' | '));
      }
      const badContrast = m.contrast.slice(0, 6);
      if (badContrast.length) {
        push('P1', 'contrast', `${tag} 下有 ${m.contrast.length} 处文本对比度不足`,
          '把文字色相对背景压到 ≥4.5:1（大字 ≥3:1），优先调 --muted / --fg',
          badContrast.map((c) => `"${c.text}" ${c.ratio}:1 < ${c.need} <${c.tag}>`).join(' | '));
      }
      if (width <= 390 && m.targets.length) {
        push('P2', 'tap-target', `移动端 ${m.targets.length} 个可点元素短边 < 44px`,
          '给按钮/链接加 padding 或 min-height:44px（图标按钮用 min-width+min-height）',
          m.targets.slice(0, 5).map((t) => `${t.text || t.tag} ${t.w}×${t.h}`).join(' | '));
      }
      if (m.imgs.length) {
        push('P2', 'img-alt', `${m.imgs.length} 个 <img> 缺 alt`, '补 alt；纯装饰图写 alt=""', m.imgs.map((i) => i.src).join(' | '));
      }
      if (m.headings.length) {
        push('P2', 'heading-order', `标题层级问题：${m.headings.join('；')}`, '每页一个 h1，层级不跳级', '');
      }
      if (m.emptySections.length) {
        push('P2', 'empty-section', `${m.emptySections.length} 个 section 有高度但没内容`, '删掉或补真实内容（空 section 通常是模板残留）',
          m.emptySections.map((s) => `${s.id} h=${s.h}`).join(' | '));
      }
      await page.close();
    }
    if (consoleErrors.length) {
      push('P1', 'console-error', `页面运行时报了 ${consoleErrors.length} 个错误`, '修掉 JS/资源错误（自包含页面不应有运行时错误）', [...new Set(consoleErrors)].slice(0, 3).join(' | '));
    }
  } catch (e) {
    warnOnce(`视觉自检失败（已跳过）：${String(e?.message || e).slice(0, 160)}`);
    return [];
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }

  // 去重：同一 id+message 只留一条
  const seen = new Set();
  return findings.filter((f) => {
    const k = `${f.id}|${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export default visualCheck;
