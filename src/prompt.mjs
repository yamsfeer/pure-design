// src/prompt.mjs — 从 assets/ 拼装系统提示词（design.mjs 与 agent.mjs 共用）
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
export const readRel = (p) => readFileSync(join(ROOT, p), 'utf8');

export const SKILLS_DIR = 'assets/skills';
export const DS_DIR = 'assets/design-systems';
export const TEMPLATES_DIR = 'assets/design-templates';
export const CRAFT_DIR = 'assets/craft';
export const DIRECTIONS_DIR = 'assets/directions';

/* ─── 模板解析：别名 + 任意 design-templates 目录 ─────────────────────────── */
export const TEMPLATE_ALIASES = { web: 'web-prototype', mobile: 'mobile-app' };
export const resolveTemplate = (name) => TEMPLATE_ALIASES[name] || name;

const DEFAULT_CRAFT = ['typography', 'color', 'anti-ai-slop', 'accessibility-baseline'];
const CRAFT_BY_TEMPLATE = {
  dashboard: ['state-coverage', 'accessibility-baseline', 'laws-of-ux'],
  'mobile-app': ['typography', 'color', 'anti-ai-slop', 'state-coverage', 'accessibility-baseline'],
};
export const craftFor = (tpl) => CRAFT_BY_TEMPLATE[tpl] || DEFAULT_CRAFT;

export function stripFrontmatter(s) {
  if (s.startsWith('---')) {
    const end = s.indexOf('\n---', 3);
    if (end !== -1) s = s.slice(end + 4).replace(/^\n+/, '');
  }
  return s;
}

/* ─── 输出契约（追加在系统提示词末尾） ────────────────────────────────────── */
export const OUTPUT_CONTRACT = `
# 输出契约（HARD REQUIREMENTS — 优先级最高，覆盖上面任何关于 <artifact> 的说明）

- 只输出一个完整的、自包含的 HTML 文档（<!doctype html> 到 </html>）。
- 所有 CSS 必须内联在 <style> 里；禁止引用任何外部资源（外部字体、图片、CDN、外部 JS、外链 URL）。
- 使用种子模板的 :root 变量体系，把当前 DESIGN.md 的配色精确映射到 --bg/--surface/--fg/--muted/--border/--accent，不要另造 hex。
- 每个顶层 <section> 都要有 data-od-id 属性。
- 如果用户提示词是中文，界面文案必须用中文。
- 不得编造虚构数据/指标；示例数据要明确标注为示例或占位。
- 界面必须有真实可用的状态：悬停、聚焦、按钮点击反馈；移动端宽度下不横向溢出。
`;

export function buildSystemPrompt({ system, template, taste, direction, skill = 'frontend-design' }) {
  const tpl = resolveTemplate(template);
  const sys = [];

  // 主技能：默认 frontend-design；路由决策后可注入其他 skill（见 src/router.mjs）
  const mainSkill = skill || 'frontend-design';
  const skillPath = `${SKILLS_DIR}/${mainSkill}/SKILL.md`;
  if (!existsSync(join(ROOT, skillPath))) {
    throw new Error(`未知 skill: ${mainSkill}`);
  }
  sys.push(stripFrontmatter(readRel(skillPath)));

  if (taste && mainSkill !== 'taste-skill') {
    sys.push('\n---\n# 反 AI 味审美技能（taste-skill）\n' + stripFrontmatter(readRel(`${SKILLS_DIR}/taste-skill/SKILL.md`)));
  }

  const dsMd = join(ROOT, DS_DIR, system, 'DESIGN.md');
  if (!existsSync(dsMd)) throw new Error(`未知设计系统: ${system}（--list 查看）`);
  sys.push(`\n---\n# 当前设计系统：${system}（品牌契约，颜色/字体/间距/组件都以此为准）\n\n${readFileSync(dsMd, 'utf8')}`);

  if (direction) {
    const dMd = join(ROOT, DIRECTIONS_DIR, `${direction}.md`);
    if (!existsSync(dMd)) throw new Error(`未知方向: ${direction}（--list-directions 查看）`);
    sys.push(`\n---\n# 当前视觉方向：${direction}（覆盖设计系统的配色/字体，:root 值照抄，不要即兴发挥）\n\n${readFileSync(dMd, 'utf8')}`);
  }

  sys.push('\n---\n# 工艺参考（craft）\n');
  for (const c of craftFor(tpl)) {
    sys.push(`\n### ${c}\n${readRel(`${CRAFT_DIR}/${c}.md`)}`);
  }

  const tdir = join(ROOT, TEMPLATES_DIR, tpl);
  if (!existsSync(join(tdir, 'SKILL.md'))) {
    throw new Error(`未知模板: ${template}（--list-templates 查看；别名 web→web-prototype, mobile→mobile-app）`);
  }
  sys.push('\n---\n# 渲染模板契约\n\n' + stripFrontmatter(readRel(`${TEMPLATES_DIR}/${tpl}/SKILL.md`)));

  for (const [label, rel] of [
    ['种子模板（template.html）—— 以此为页面骨架，保留它的 class 系统与 CSS 变量', 'assets/template.html'],
    ['布局库（layouts.md）—— 从这里面选区块骨架，不要凭空造', 'references/layouts.md'],
    ['自检清单（checklist.md）—— 交付前逐条自检', 'references/checklist.md'],
  ]) {
    const p = join(tdir, rel);
    if (existsSync(p)) sys.push(`\n---\n# ${label}\n\n${readFileSync(p, 'utf8')}`);
  }

  sys.push(OUTPUT_CONTRACT);
  return sys.join('\n');
}

/* ─── 本次会话的提示词装配清单（供 CLI 展示「用了什么」）────────────────────── */
export function promptRecipe({ system = 'default', template = 'web', taste = false, direction = null, skill = 'frontend-design' } = {}) {
  const tpl = resolveTemplate(template);
  const tdir = join(ROOT, TEMPLATES_DIR, tpl);
  const extras = [];
  if (existsSync(join(tdir, 'assets/template.html'))) extras.push('种子模板 template.html');
  if (existsSync(join(tdir, 'references/layouts.md'))) extras.push('布局库 layouts.md');
  if (existsSync(join(tdir, 'references/checklist.md'))) extras.push('自检清单 checklist.md');
  return {
    mainSkill: skill,
    skills: [skill, ...(taste ? ['taste-skill'] : [])],
    designSystem: system,
    direction: direction || null,
    template: tpl,
    craft: craftFor(tpl),
    extras,
  };
}

export function listSystems() {
  const dir = join(ROOT, DS_DIR);
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'DESIGN.md')))
    .map((d) => d.name).sort();
}

export function listTemplates() {
  const dir = join(ROOT, TEMPLATES_DIR);
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'SKILL.md')))
    .map((d) => d.name).sort();
}

export function listDirections() {
  const dir = join(ROOT, DIRECTIONS_DIR);
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.md'))
    .map((d) => d.name.replace(/\.md$/, '')).sort();
}

export function directionSpec(id) {
  const p = join(ROOT, DIRECTIONS_DIR, `${id}.md`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}
