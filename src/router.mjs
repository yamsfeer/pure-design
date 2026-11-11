/**
 * src/router.mjs — 决策阶段（路由 + 选型 + 澄清）
 *
 * 设计原则（对齐上游 open-design，见 docs/upstream-information-flow.md）：
 *   - 能自主的不问：任务类型、方向、skill 默认 AI 推断
 *   - 影响结果才问：每步最多一问（grilling 式，带推荐答案）
 *   - 品牌由人定：设计系统默认 default，用户可 -s 指定或对话中指定
 *
 * 流程：
 *   ① 任务类型（od-default 思想）：AI 从 brief 推断 taskType + 模板
 *   ② 设计系统 + 方向：DS 默认 default（用户可指定）；方向 AI 从 5 个 school 自选
 *   ③ skill 两级选择：按 taskType 预筛候选（程序）→ AI 从候选里选（模型）
 *   ④ grilling 澄清：①②③ 之后仍缺关键信息（受众/规模/硬约束）时逐条追问
 *
 * 输出：<decision>JSON</decision>（解析见 parseDecision）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readRel } from './prompt.mjs';

/* ─── 候选表：唯一事实源在 src/task-types.mjs ─────────────────────────── */
import {
  TASK_TYPES, TASK_KEYS, skillCandidatesFor, templateCandidatesFor, normalizeDecision,
} from './task-types.mjs';

/* ─── 方向索引：从 assets/directions/*.md 提取一句话描述 ─────────────────── */
export function directionIndex() {
  const dir = join(ROOT, 'assets/directions');
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    const id = f.replace(/\.md$/, '');
    const txt = readFileSync(join(dir, f), 'utf8');
    const title = (txt.match(/^#\s+(.+)$/m) || [])[1] || id;
    const mood = (txt.match(/^>\s*Mood:\s*(.+)$/m) || [])[1] || '';
    const refs = (txt.match(/^## References\s*\n(.+)$/m) || [])[1] || '';
    out.push({ id, title, mood, refs: refs.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4) });
  }
  return out;
}

/* ─── 设计系统索引：151 个的名称 + Category + 一句话 ─────────────────────── */
export function designSystemIndex() {
  const dir = join(ROOT, 'assets/design-systems');
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const md = join(dir, d.name, 'DESIGN.md');
    let cat = '', desc = '';
    try {
      const full = readFileSync(md, 'utf8');
      const txt = full.slice(0, 600);
      // 提取所有引用行（> xxx），Category 单独分流，其余取第一行作描述
      const quoteLines = [...txt.matchAll(/^>\s*(.+)$/gm)].map((m) => m[1]).filter(Boolean);
      cat = quoteLines.find((l) => l.startsWith('Category:'))?.replace(/^Category:\s*/, '') || '';
      desc = quoteLines.find((l) => !l.startsWith('Category:')) || '';
      // 少数系统没有 '>' 元数据（如 totality-festival），退化为标题 + 首段正文，
      // 否则它会从索引里消失，品牌匹配永远命中不到。
      if (!cat && !desc) {
        const title = (txt.match(/^#\s+(.+)$/m) || [])[1] || '';
        const para = txt.split('\n').map((l) => l.trim())
          .find((l) => l && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('|') && !l.startsWith('```')) || '';
        desc = (title ? title + ' — ' : '') + para;
        cat = cat || 'uncategorized';
      }
    } catch { /* 无 DESIGN.md 跳过 */ }
    if (cat || desc) out.push({ id: d.name, cat, desc });
  }
  return out;
}


/* ─── 决策系统提示词（注入路由规则 + 方向索引 + skill 候选 + 提问规则） ────── */
export function buildRoutePrompt({ prompt, system = 'default', taskType, dsIndex, dirIndex, skillCands }) {
  const taskLines = TASK_KEYS
    .map((k) => `- ${k}（${TASK_TYPES[k].label}）：模板 ${templateCandidatesFor(k).join(' / ')}；skill 候选 ${skillCandidatesFor(k).join(', ')}`)
    .join('\n');
  const dirLines = dirIndex.map((d) => `- ${d.id}（${d.title}）：${d.mood}`).join('\n');
  const dsLines = dsIndex.map((d) => `- ${d.id}${d.cat ? `（${d.cat}）` : ''}: ${d.desc}`).join('\n');

  return `# pure-design 决策阶段（路由 + 选型）

你是 pure-design 的设计决策器。用户给了下面的设计需求，你需要在动手设计之前做四个决策。
**能自主的不问，影响结果才问。** 决策完成后输出 <decision> JSON（见末尾格式），停止。

用户需求：
"""${prompt}"""

## ① 任务类型（先定这个）

从以下类型中选一个最匹配的（含模板与 skill 候选）：
${taskLines}

- 推断清晰 → 直接选，不问。
- 模糊且选错会改变交付格式 → 问用户（一次一问，给出推荐项）。

## ② 设计系统与视觉方向

设计系统（品牌）默认 **${system}**。除非用户需求里明确提到某个品牌（如 stripe、notion），
否则**不要自行换设计系统**。若用户提到了品牌，从下面索引里找最接近的：
${dsLines}

视觉方向（风格）由你从 5 个 school 自选，不用问用户：
${dirLines}

## ③ skill（两级选择，AI 自主）

基于任务类型从候选里选**一个**最合适的 skill（它们已按任务类型预筛过）：
- ${skillCands.join('\n- ')}

若候选都不合适，选 frontend-design 兜底。不要解释太多，一句理由即可。

## ④ 澄清（grilling，只在需要时）

①②③ 之后，若仍缺**会实质改变设计结果**的信息（如目标受众、内容规模、硬性约束），
一次只问一个问题，给推荐答案，等用户回答后再继续。能推断就推断，不要为问而问。
用户回答后你继续决策，直到决策完成再输出 <decision>。

## 输出格式（决策完成时）

最后只输出一个 JSON 块（用 <decision> 包裹），不要输出其他内容：

<decision>
{
  "taskType": "web",
  "designSystem": "default",
  "direction": "modern-minimal",
  "skill": "frontend-design",
  "template": "web-prototype",
  "reason": "一句话：为什么这样选（含用户需求中的关键依据）"
}
</decision>

JSON 键值说明：
- taskType: ①中类型之一
- designSystem: ②中设计系统 id（默认 ${system}）
- direction: ②中方向 id 之一
- skill: ③中选的 skill
- template: ①中该类型模板列表里的一个
- reason: 简短理由，展示给用户看`;
}


/* ─── 解析 <decision> 块 ─────────────────────────────────────────────────── */
export function parseDecision(text) {
  const m = text.match(/<decision>\s*([\s\S]*?)<\/decision>/i);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1].trim());
    return obj;
  } catch {
    // 容忍 JSON 后多逗号/注释的常见情况
    try {
      return JSON.parse(m[1].trim().replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

/* ─── 决策会话：直连 DeepSeek（OpenAI 兼容），单 agent 会话贯穿澄清 → 决策 ── */
export async function runRouter({ prompt, system = 'default', model, onEvent } = {}) {
  // 复用 agent.mjs 的凭据兜底（环境变量 → ~/.pi/agent/auth.json）
  const { ensureKey } = await import('./agent.mjs');
  ensureKey();
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('未找到 DeepSeek 凭据（设置 DEEPSEEK_API_KEY）');

  const dsIndex = designSystemIndex();
  const dirIndex = directionIndex();

  // 第一级预筛：先让模型粗判 taskType 可能（用于预筛候选）
  // 简化：从 prompt 关键词粗判，保证 skill 候选总含 frontend-design（已内置）
  let taskType = inferTaskType(prompt);
  const skillCands = skillCandidatesFor(taskType);

  const systemPrompt = buildRoutePrompt({ prompt, system, dsIndex, dirIndex, skillCands, taskType });

  let conversation = [{ role: 'user', content: prompt }];
  let rounds = 0;

  const emit = (type, data) => onEvent && onEvent(type, data);

  while (rounds < 5) {
    rounds++;
    emit('status', { message: `决策第 ${rounds} 轮…` });
    const res = await callDeepSeek({ apiKey, systemPrompt, conversation, model });
    const text = res;
    emit('text', { delta: text });

    const decision = parseDecision(text);
    if (decision) {
      // 模型可能给出不存在的资产 id：逐级回退，而不是让 buildSystemPrompt 抛错（ADR 修订）
      const norm = normalizeDecision(
        { direction: 'modern-minimal', ...decision, taskType: decision.taskType || taskType },
        { system },
      );
      if (norm.direction !== decision.direction) norm.reason = `${norm.reason || ''}（方向 ${decision.direction} 不可用，已回退）`.trim();
      return norm;
    }

    // 没输出 decision → 是提问/追问，交给用户回答
    const answer = await askUser(text);
    if (answer === null) return null; // 用户中断
    conversation.push({ role: 'assistant', content: text });
    conversation.push({ role: 'user', content: answer });
  }
  throw new Error('决策超时（5 轮）');
}

/* 关键词粗判 taskType（仅用于第一级候选预筛，精确判断交给模型）
 *
 * 注意词边界：旧版 /app/ 会把 "apple 官网" 判成 mobile（app 是 apple 的前缀）。
 * 这里给英文词加 \b，且把品牌/作品集放在 mobile 之前判断。
 */
export function inferTaskType(prompt) {
  const p = (prompt || '').toLowerCase();
  if (/(演示|幻灯片|deck|pitch|slide|\bppt\b)/.test(p)) return 'deck';
  if (/(品牌|作品集|\bportfolio\b|品牌页|brand)/.test(p)) return 'brand';
  if (/(后台|看板|dashboard|数据|统计|报表|监控)/.test(p)) return 'dashboard';
  if (/(移动|手机|\bapp\b|\bios\b|android|小程序)/.test(p)) return 'mobile';
  if (/(杂志|editorial|文章|博客|\bblog\b)/.test(p)) return 'editorial';
  return 'web';
}

/* 直连 DeepSeek（OpenAI 兼容 API） */
async function callDeepSeek({ apiKey, systemPrompt, conversation, model }) {
  const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  model = model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...conversation], temperature: 0.3 }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek 请求失败 (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/* 用户交互：由 CLI 提供 askUser（bin 里 readline），router 只管协议 */
let askUserImpl = async () => null;
export function setAskUser(fn) { askUserImpl = fn; }
async function askUser(text) { return askUserImpl(text); }

/* 便捷导出 */
export { ROOT };
