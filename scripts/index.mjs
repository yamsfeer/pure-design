#!/usr/bin/env node
/**
 * scripts/index.mjs — 生成 catalog.md（资产目录 / 索引）
 *
 * 扫描 assets/ → 提取每个资产的「名字 + 一句话描述」→ 写 catalog.md。
 * 只在资产变动时重跑一次；运行时 agent 只读 catalog.md，不跑本脚本。
 *
 * 用法: node scripts/index.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TASK_TYPES, checkTaskTypeAssets } from '../src/task-types.mjs';
import { ROOT, DEFAULT_CRAFT, CRAFT_BY_TEMPLATE, ON_DEMAND_CRAFT } from '../src/prompt.mjs';

if (process.argv.includes('--check')) {
  const problems = checkTaskTypeAssets();
  if (problems.length) { console.error('✗ 候选表引用了不存在的资产：\n' + problems.join('\n')); process.exit(1); }
  console.log('✓ 任务类型候选表全部指向真实资产');
  process.exit(0);
}
const SKILLS_DIR = join(ROOT, 'assets/skills');
const DS_DIR = join(ROOT, 'assets/design-systems');
const TEMPLATES_DIR = join(ROOT, 'assets/design-templates');
const CRAFT_DIR = join(ROOT, 'assets/craft');
const DIRECTIONS_DIR = join(ROOT, 'assets/directions');

function clip(s, n = 120) {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/* 从 SKILL.md frontmatter 提取 description（单行或 |/> 多行），取第一句 */
function oneLineDescription(text) {
  if (!text || !text.startsWith('---')) return '';
  const end = text.indexOf('\n---', 3);
  if (end === -1) return '';
  const fm = text.slice(4, end);
  const m = fm.match(/^description\s*:\s*(.*)$/m);
  if (!m) return '';
  let v = m[1].trim().replace(/^["']|["']$/g, '');
  if (/^[|>]/.test(v)) {
    const block = fm.match(/^description\s*:\s*[|>][+\-]?\s*\n((?:[ \t]+.*(?:\n|$))*)/m);
    if (block) {
      const first = block[1].split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
      return clip(first);
    }
    return '';
  }
  return clip(v);
}

function designSystemIndex() {
  const out = [];
  for (const d of readdirSync(DS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const md = join(DS_DIR, d.name, 'DESIGN.md');
    try {
      const txt = readFileSync(md, 'utf8');
      const quotes = [...txt.matchAll(/^>\s*(.+)$/gm)].map((m) => m[1]).filter(Boolean);
      const cat = quotes.find((l) => l.startsWith('Category:'))?.replace(/^Category:\s*/, '') || '';
      // 描述取最后一个非 Category 引用行（有的 DESIGN.md 在 Category 和描述之间还有 Surface 等元数据行）
      const desc = [...quotes].reverse().find((l) => !l.startsWith('Category:')) || '';
      if (cat || desc) out.push({ id: d.name, cat, desc: clip(desc, 100) });
    } catch { /* 无 DESIGN.md 跳过 */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function directionIndex() {
  const out = [];
  for (const f of readdirSync(DIRECTIONS_DIR).filter((x) => x.endsWith('.md')).sort()) {
    const id = f.replace(/\.md$/, '');
    const txt = readFileSync(join(DIRECTIONS_DIR, f), 'utf8');
    const title = (txt.match(/^#\s+(.+)$/m) || [])[1] || id;
    const mood = (txt.match(/^>\s*Mood:\s*(.+)$/m) || [])[1] || '';
    out.push({ id, title, mood: clip(mood, 160) });
  }
  return out;
}

function skillIndex() {
  const out = [];
  for (const d of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      const txt = readFileSync(join(SKILLS_DIR, d.name, 'SKILL.md'), 'utf8');
      out.push({ id: d.name, desc: oneLineDescription(txt) || '（无描述）' });
    } catch { /* 跳过 */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function templateIndex() {
  const out = [];
  for (const d of readdirSync(TEMPLATES_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      const txt = readFileSync(join(TEMPLATES_DIR, d.name, 'SKILL.md'), 'utf8');
      out.push({ id: d.name, desc: oneLineDescription(txt) || '（无描述）' });
    } catch { /* 跳过 */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function craftList() {
  return readdirSync(CRAFT_DIR)
    .filter((x) => x.endsWith('.md') && x !== 'README.md' && x !== 'FUTURE_SECTIONS.md')
    .map((x) => x.replace(/\.md$/, ''))
    .sort();
}

/* ─── 组装 catalog.md ──────────────────────────────────────────────────── */
function buildCatalog({ ds, dirs, skills, templates, crafts }) {
  const usedSkills = new Set(Object.values(TASK_TYPES).flatMap((t) => t.skills));
  const usedTemplates = new Set(Object.values(TASK_TYPES).flatMap((t) => t.templates));

  const L = [];
  L.push('# Pure Design 资产目录（catalog）');
  L.push('');
  L.push('> 由 `node scripts/index.mjs` 自动生成，勿手改。资产变动后重跑一次。');
  L.push('> 这是选型的唯一入口：先「查表收窄」，再 read 命中的资产全文，**不要直接翻 assets/ 目录**。');
  L.push('');

  L.push('## 一、任务类型 → 候选（收窄核心）');
  L.push('');
  L.push('| 类型 | 说明 | 模板候选 | skill 候选 |');
  L.push('|---|---|---|---|');
  for (const [k, t] of Object.entries(TASK_TYPES)) {
    L.push(`| \`${k}\` | ${t.label} | ${t.templates.join(' / ')} | ${t.skills.join(' / ')} |`);
  }
  L.push('');
  L.push('> 判断任务类型靠**语义理解**（别用关键词正则）：用户说「数据看板」就该归 dashboard。');
  L.push('> 拿不准 → `web`；拿不准 skill → `frontend-design`。');
  L.push('');

  L.push(`## 二、设计系统索引（${ds.length} 个）`);
  L.push('');
  L.push('> 默认用 `default`。只有用户**点名品牌**时才按名字在这里查，命中后 read `assets/design-systems/<id>/DESIGN.md`。');
  L.push('');
  for (const d of ds) {
    L.push(`- \`${d.id}\`${d.cat ? `（${d.cat}）` : ''} — ${d.desc}`);
  }
  L.push('');

  L.push(`## 三、视觉方向（${dirs.length} 个）`);
  L.push('');
  L.push('> 5 选 1，read `assets/directions/<id>.md`（`:root` 值照抄）。');
  L.push('');
  for (const d of dirs) {
    L.push(`- \`${d.id}\` — ${d.title} — ${d.mood}`);
  }
  L.push('');

  L.push(`## 四、craft 工艺参考（${crafts.length} 个）`);
  L.push('');
  L.push('> 按模板选 3–4 个，read `assets/craft/<id>.md`。');
  L.push('');
  L.push(`- 默认：${DEFAULT_CRAFT.join(' / ')}`);
  for (const [tpl, list] of Object.entries(CRAFT_BY_TEMPLATE)) {
    L.push(`- 模板 \`${tpl}\`：${list.join(' / ')}`);
  }
  L.push(`- 全部可用：${crafts.join(' / ')}`);
  L.push(`- 按需参考（不默认注入）：${ON_DEMAND_CRAFT.join(' / ')}`);
  L.push('');

  const tailSkills = skills.filter((s) => !usedSkills.has(s.id));
  L.push(`## 五、skill 长尾清单（${tailSkills.length} 个，按需）`);
  L.push('');
  L.push('> 上面任务类型表里没有的 skill。brief 明确需要时才 read `assets/skills/<id>/SKILL.md`。');
  L.push('');
  for (const s of tailSkills) {
    L.push(`- \`${s.id}\` — ${s.desc}`);
  }
  L.push('');

  const tailTemplates = templates.filter((t) => !usedTemplates.has(t.id));
  L.push(`## 六、模板长尾清单（${tailTemplates.length} 个，按需）`);
  L.push('');
  L.push('> 上面任务类型表里没有的模板。需要时 read `assets/design-templates/<id>/SKILL.md`。');
  L.push('');
  for (const t of tailTemplates) {
    L.push(`- \`${t.id}\` — ${t.desc}`);
  }
  L.push('');

  return L.join('\n');
}

const ds = designSystemIndex();
const dirs = directionIndex();
const skills = skillIndex();
const templates = templateIndex();
const crafts = craftList();

writeFileSync(join(ROOT, 'catalog.md'), buildCatalog({ ds, dirs, skills, templates, crafts }), 'utf8');
console.log(`✓ catalog.md 已生成：设计系统 ${ds.length} · 方向 ${dirs.length} · skill ${skills.length} · 模板 ${templates.length} · craft ${crafts.length}`);
