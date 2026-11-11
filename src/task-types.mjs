/**
 * src/task-types.mjs — 任务类型 → 候选模板 / skill 的**唯一事实源**
 *
 * 之前 router.mjs 与 scripts/index.mjs 各写一份 TASK_TYPES，两边已经漂移
 * （router 里模板写成 `portoflio`，index 里写成 `image-poster`）。本模块是
 * 唯一来源，两边都从这里读，`node scripts/index.mjs --check` 会校验资产是否真的存在。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './prompt.mjs';

export const TASK_TYPES = {
  web: {
    label: 'Web 落地页/营销页',
    templates: ['web-prototype', 'saas-landing', 'waitlist-page', 'pricing-page'],
    skills: ['frontend-design', 'taste-skill', 'copywriting', 'marketing-psychology'],
  },
  dashboard: {
    label: 'Dashboard / 数据工具',
    templates: ['dashboard', 'live-dashboard', 'github-dashboard', 'kanban-board'],
    skills: ['frontend-design', 'd3-visualization', 'data-report'],
  },
  mobile: {
    label: '移动端界面',
    templates: ['mobile-app', 'mobile-onboarding'],
    skills: ['frontend-design', 'swiftui-design', 'imagegen-frontend-mobile'],
  },
  deck: {
    label: '演示文稿 / Deck',
    templates: ['simple-deck', 'replit-deck', 'kami-deck'],
    skills: ['deck-open-slide-canvas', 'frontend-slides'],
  },
  editorial: {
    label: '编辑/杂志风页面',
    templates: ['web-prototype', 'magazine-poster', 'blog-post'],
    skills: ['frontend-design', 'taste-skill', 'copywriting'],
  },
  brand: {
    label: '品牌页 / 作品集',
    templates: ['web-prototype', 'open-design-landing', 'image-poster'],
    skills: ['brand-extract', 'brand-guidelines', 'design-md', 'frontend-design'],
  },
};

export const TASK_KEYS = Object.keys(TASK_TYPES);

/* ─── 资产探测：模板是否存在、有没有种子骨架 / 参考成品 ────────────────── */
export function templateAssets(id) {
  const dir = join(ROOT, 'assets/design-templates', id);
  if (!existsSync(dir)) return { exists: false, seed: false, example: false };
  return {
    exists: existsSync(join(dir, 'SKILL.md')),
    seed: existsSync(join(dir, 'assets/template.html')),
    example: existsSync(join(dir, 'example.html')),
  };
}

export function skillExists(id) {
  return existsSync(join(ROOT, 'assets/skills', id, 'SKILL.md'));
}

export function systemExists(id) {
  return existsSync(join(ROOT, 'assets/design-systems', id, 'DESIGN.md'));
}

/* ─── 校验：候选表里有没有指向不存在的资产（--check / 测试用）────────────── */
export function checkTaskTypeAssets() {
  const problems = [];
  for (const [key, t] of Object.entries(TASK_TYPES)) {
    for (const tpl of t.templates) {
      const a = templateAssets(tpl);
      if (!a.exists) problems.push(`[${key}] 模板不存在: ${tpl}`);
      else if (!a.seed && !a.example) problems.push(`[${key}] 模板既无种子也无参考成品: ${tpl}`);
    }
    for (const s of t.skills) {
      if (!skillExists(s)) problems.push(`[${key}] skill 不存在: ${s}`);
    }
  }
  return problems;
}

/* ─── skill 两级选择的第一级：程序按 taskType 预筛（含通用兜底）────────────── */
export function skillCandidatesFor(taskType) {
  const t = TASK_TYPES[taskType] || TASK_TYPES.web;
  return [...new Set(['frontend-design', ...t.skills])].filter(skillExists);
}

/* ─── 模板两级选择的第一级：优先有种子骨架的候选 ──────────────────────────── */
export function templateCandidatesFor(taskType) {
  const t = TASK_TYPES[taskType] || TASK_TYPES.web;
  return t.templates.filter((id) => templateAssets(id).exists);
}

/* ─── 运行时兜底：模型可能给出不存在的 id，逐级回退而不是抛错 ──────────────── */
export function normalizeDecision(decision, { system = 'default' } = {}) {
  const taskType = TASK_KEYS.includes(decision.taskType) ? decision.taskType : 'web';
  const templates = templateCandidatesFor(taskType);
  const template = templates.includes(decision.template) ? decision.template : templates[0];
  const skill = skillExists(decision.skill) ? decision.skill : 'frontend-design';
  const designSystem = systemExists(decision.designSystem) ? decision.designSystem : system;
  const direction = existsSync(join(ROOT, 'assets/directions', `${decision.direction}.md`))
    ? decision.direction : null;
  return { ...decision, taskType, template, skill, designSystem, direction };
}
