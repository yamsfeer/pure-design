/**
 * src/agent.mjs — 内置设计 agent 业务层（CLI 入口在 bin/pure-design.mjs）
 *
 * 系统提示词 = grilling 澄清指令 + assets 拼装（同 design.mjs）+「agent 循环」工作协议。
 * 工具 = Pi 官方内置的 read / write / edit / bash 四工具（见 adr/0004）。
 * 写后校验 = 确定性反 AI 味 lint（src/lint.mjs，见 adr/0002）。
 * 交付校验 = 产物完整性检查 + 瞬时失败重试（见 adr/0003）。
 * 归档 = 语义文件名 + 版本保留（见 adr/0003）。
 *
 * 澄清 = 单一 agent 会话：grilling 指令让 agent 先逐条追问（一问一答），信息够了就转入设计（见 adr/0001）。
 *
 * 导出: createSession / runAgent / ensureKey（供 bin/ 与 src/server.mjs 调用）
 */
import { Agent, createReadTool, createWriteTool, createEditTool, createBashTool } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { createModels } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename, extname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { buildSystemPrompt, ROOT } from './prompt.mjs';
import { lintHtml, renderFindingsForAgent } from './lint.mjs';

/* ─── 密钥：DEEPSEEK_API_KEY 或从 ~/.pi/agent/auth.json 兜底 ─────────────── */
export function ensureKey() {
  if (process.env.DEEPSEEK_API_KEY) return;
  try {
    const auth = JSON.parse(readFileSync(join(homedir(), '.pi', 'agent', 'auth.json'), 'utf8'));
    const cred = auth.deepseek;
    if (cred) process.env.DEEPSEEK_API_KEY = typeof cred === 'string' ? cred : cred.key;
  } catch { /* 无 ~/.pi 时由调用方提供 key */ }
}

/* ─── 澄清优先指令（grilling 式追问，见 adr/0001）────────────────────────── */
const GRILLING_PREAMBLE = `
# 澄清优先（grilling 式追问）

动手设计之前，先判断 brief 是否足够明确。如果不够，向用户逐条追问，直到达成共识：

- 一次只问一个问题，等用户回答再继续；不要一次抛多个问题。
- 每条问题给出你的推荐答案，用户可以直接确认或修改。
- 围绕设计关键决策追问：目标平台、目标用户、视觉调性、品牌背景、内容规模、硬性约束。
- 能自己查的事实（已注入的设计系统 / 种子 / 清单）不要问，直接查；只有「决定」才交给用户。
- 信息足够后立刻停止追问，进入下面的设计流程（用 write 写文件）。
- 如果 brief 已经足够清晰，跳过澄清，直接设计。
`;

/* ─── agent 循环协议（追加到系统提示词末尾） ─────────────────────────────── */
function loopInstructions(outPath) {
  return `
# 工作方式（agent 循环 — 必须迭代到满意才停，禁止一次交付）

你可用的工具：read（读文件）、write（写文件）、edit（精确改文件）、bash（执行命令）。
注意：种子模板、区块库、自检清单、DESIGN.md 已经完整注入到本系统提示词里，无需再 read。

1. 理解 brief，确定单一视觉方向。
2. 用 write 工具把**完整的自包含 HTML** 写入 ${outPath}（每次都写整页，覆盖写）。
3. 写完后，用上面「自检清单」逐条审查这一版；任何 P0 未通过 → 用 write 或 edit 修改。
4. 反复「审查 → 重写」，直到所有 P0 通过、P1 尽量通过，且连续两版之间没有实质改进。
5. 满意后，用文字输出一段简短总结（文件路径、视觉方向、做了几轮精修）。**不要输出 HTML 源码。**

约束：
- 每次 write 都写完整页面，禁止写片段或 "同上"。
- 若某轮重写反而更差，回退到之前更好的一版（重新写回它）。
- 通常 2–4 轮即可；达到满意即可，不必硬凑轮数。
`;
}

/* ─── 工具装配 ────────────────────────────────────────────────────────────
 * 官方工具（read/write/edit/bash）的 execute 是 5 参：(id, params, signal, onUpdate, { env })。
 * 而裸 Agent 循环只传 4 参（没有 env）。这里用 NodeExecutionEnv 提供文件系统 + shell + cwd，
 * 并在 write/edit 上叠一层「轮数硬闸门」：超过 maxRounds 就拒绝写入，逼模型收尾。
 * ─────────────────────────────────────────────────────────────────────────── */
function assembleTools({ maxRounds, state }) {
  const env = new NodeExecutionEnv({ cwd: ROOT });

  // 写后取回本次写入/改动的 HTML 内容（用于确定性 lint）。
  const readWrittenHtml = async (toolName, params) => {
    if (toolName === 'write' && typeof params?.content === 'string') return params.content;
    if (toolName === 'edit' && typeof params?.path === 'string') {
      const r = await env.readTextFile(params.path);
      return r.ok ? r.value : null;
    }
    return null;
  };

  const bind = (tool, { gate = false } = {}) => ({
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (gate) {
        state.writes += 1;
        if (state.writes > maxRounds) {
          return { content: [{ type: 'text', text: `已达最大迭代轮数（${maxRounds}）。请不要再改稿，直接输出最终总结。` }], details: {} };
        }
      }
      const result = await tool.execute(toolCallId, params, signal, onUpdate, { env });
      // 写后校验：对落盘内容跑确定性反 AI 味 lint，P0/P1 命中回喂模型（见 adr/0002）
      if (gate && result && Array.isArray(result.content)) {
        const html = await readWrittenHtml(tool.name, params);
        if (html) {
          const findings = lintHtml(html);
          if (findings.length) result.content.push({ type: 'text', text: renderFindingsForAgent(findings) });
        }
      }
      return result;
    },
  });

  return [
    bind(createReadTool()),
    bind(createWriteTool(), { gate: true }),
    bind(createEditTool(), { gate: true }),
    bind(createBashTool()),
  ];
}

/* ─── 语义文件名 + 版本保留（第 7 步归档，adr/0003）────────────────────────── */
export function slugify(text) {
  const tokens = (text || '').toLowerCase().match(/[一-龥a-z0-9]+/g) ?? [];
  return tokens.join('-').slice(0, 50).replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function versionedPath(file) {
  if (!existsSync(file)) return file;
  const dir = dirname(file);
  const ext = extname(file);
  const stem = basename(file, ext);
  for (let i = 2; ; i++) {
    const candidate = join(dir, `${stem}-v${i}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
}

// 解析输出路径：未显式指定时从 brief 派生语义名（中文/英文混合），已存在自动 +v2/+v3。
// outDir 默认 output/（server 画廊用）；CLI 传执行目录（默认输出到当前路径）。
// out 可以是绝对路径（原样）、相对 outDir 的路径、或纯文件名。
export function resolveOutputPath(out, prompt, outDir = join(ROOT, 'output')) {
  let base = out;
  if (!base) base = (slugify(prompt) || 'design') + '.html';
  if (!/\.html?$/i.test(base)) base += '.html';
  const target = isAbsolute(base) ? base : join(outDir, base);
  const path = versionedPath(target);
  return { path, name: basename(path) };
}

/* ─── 交付校验（第 6 步，adr/0003）────────────────────────────────────────── */
function validateOutput(file) {
  if (!existsSync(file)) return { ok: false, reason: '产物不存在' };
  const html = readFileSync(file, 'utf8');
  if (!/<!doctype html/i.test(html.slice(0, 200))) return { ok: false, reason: '缺少 <!doctype html>' };
  if (!/<\/html>\s*$/i.test(html.trimEnd())) return { ok: false, reason: '缺 </html>（可能被截断）' };
  if (html.length < 100) return { ok: false, reason: '内容过短' };
  return { ok: true, size: html.length };
}

function isTransientError(e) {
  const s = String(e?.message || e).toLowerCase();
  return /429|50[0234]|timeout|timed out|etimedout|econnreset|fetch failed|network|overloaded|rate ?limit/i.test(s);
}

/* ─── 会话核心（单一 agent 贯穿澄清 → 设计，见 adr/0001）────────────────────── */
export function createSession({ system = 'default', template = 'web', direction, out = null, skill,
                                prompt = null, maxRounds = 6, taste = false, modelId = 'deepseek-v4-flash',
                                thinkingLevel = 'high', clarify = false, onEvent, outDir } = {}) {
  ensureKey();
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('未找到 DeepSeek 凭据（设置 DEEPSEEK_API_KEY）');

  const emit = (type, data) => onEvent && onEvent(type, data);

  const { path: file, name: outname } = resolveOutputPath(out, prompt, outDir);
  const models = createModels();
  models.setProvider(deepseekProvider());
  const model = models.getModel('deepseek', modelId);

  // write 工具的工作目录是 ROOT，提示词里写相对 ROOT 的路径。
  const outPath = file.startsWith(ROOT + '/') ? file.slice(ROOT.length + 1) : file;
  const systemPrompt = (clarify ? GRILLING_PREAMBLE : '') + buildSystemPrompt({ system, template, taste, direction, skill }) + loopInstructions(outPath);

  const state = { writes: 0 };
  const tools = assembleTools({ maxRounds, state });
  const agent = new Agent({
    initialState: { systemPrompt, model, tools, thinkingLevel },
    streamFn: models.streamSimple.bind(models),
  });

  let turnText = '';
  agent.subscribe((ev) => {
    if (ev.type === 'tool_execution_start') {
      if (ev.toolName === 'write' || ev.toolName === 'edit') {
        // 事件在工具执行前触发，state.writes 是即将执行的版本号的前一数
        if (state.writes < maxRounds) emit('write', { round: state.writes + 1 });
      } else {
        emit('tool', { name: ev.toolName });
      }
    }
    if (ev.type === 'message_update') {
      const t = ev.assistantMessageEvent.type;
      if (t === 'thinking_delta') {
        emit('thinking', { delta: ev.assistantMessageEvent.delta });
      } else if (t === 'text_delta') {
        turnText += ev.assistantMessageEvent.delta;
        emit('text', { delta: ev.assistantMessageEvent.delta });
      }
    }
  });

  async function send(msg) {
    state.writes = 0;
    turnText = '';
    try {
      await agent.prompt(msg);
    } catch (e) {
      if (isTransientError(e)) {
        emit('status', { message: `瞬时失败（${String(e?.message || e).slice(0, 80)}），重试一次…` });
        await agent.prompt(msg);
      } else {
        throw e;
      }
    }

    const phase = state.writes > 0 ? 'done' : 'awaiting-input';
    const v = phase === 'done' ? validateOutput(file) : null;
    if (phase === 'done') {
      emit('done', { file, summary: turnText.trim(), rounds: state.writes, valid: v ? v.ok : undefined, validReason: v && !v.ok ? v.reason : null });
    }
    return { phase, text: turnText.trim(), rounds: Math.min(state.writes, maxRounds), valid: v ? v.ok : undefined, validReason: v && !v.ok ? v.reason : null };
  }

  return { send, file, outname, dispose: () => { try { agent.abort(); } catch {} } };
}

/* ─── 一次性入口（向后兼容 server.mjs 的旧调用）───────────────────────────── */
export async function runAgent(config = {}) {
  const session = createSession(config);
  const r = await session.send(config.prompt);
  return { file: session.file, summary: r.text, rounds: r.rounds, valid: r.valid };
}

