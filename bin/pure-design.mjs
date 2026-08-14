#!/usr/bin/env node
/**
 * bin/pure-design.mjs — pure-design 唯一 CLI 入口（commander）
 *
 *   pure-design "设计需求" [选项]      内置 Pi agent 迭代设计（默认，推荐）
 *   pure-design fast "设计需求" [选项] 单次快速生成（一次 API 调用）
 *   pure-design preview [端口]         启动 Web 界面 + 预览（默认 8745）
 *   pure-design tunnel                 打印 SSH 端口转发命令
 *   pure-design --list / --list-templates / --list-directions
 *
 * 业务层: src/agent.mjs（迭代）、src/design.mjs（单次）、src/server.mjs（Web）。
 * 输出: 默认当前目录，语义文件名（从 brief 派生，中文/英文），已存在自动 +v2/+v3；
 *       -o 指定路径（相对当前目录或绝对路径）。
 * 环境变量: PURE_DESIGN_PORT（默认 8745）/ PURE_DESIGN_HOST（默认 127.0.0.1）。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, isAbsolute, relative } from 'node:path';
import readline from 'node:readline';
import { Command } from 'commander';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { createSession, resolveOutputPath } from '../src/agent.mjs';
import { ask, extractHtml, looksLikeHtml, defaultModel } from '../src/design.mjs';
import {
  ROOT, readRel, buildSystemPrompt, resolveTemplate, listSystems, listTemplates, listDirections, promptRecipe,
} from '../src/prompt.mjs';

marked.use(markedTerminal());

/* ─── TUI 渲染器：spinner + 逐字流式 + 工具动作 ──────────────────────────── */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function toolLabel(name) {
  return { write: '写文件', edit: '改文件', read: '读文件', bash: '执行命令' }[name] || name;
}

function renderMarkdown(text) {
  try {
    return marked.parse(text).trim();
  } catch {
    return text;
  }
}

function cliRenderer() {
  let frame = 0;
  let buf = '';        // 正文累积（用于 markdown 渲染）
  let thinkChars = 0;  // 思考字数（只显示进度，不窥视内容碎片）
  let onSpin = false;
  let lastTick = 0;

  const clearSpin = () => {
    if (onSpin) { process.stdout.write('\r' + ' '.repeat(90) + '\r'); onSpin = false; }
  };

  const tick = (label, suffix) => {
    const now = Date.now();
    if (now - lastTick > 40) {
      lastTick = now;
      onSpin = true;
      process.stdout.write(`\r  ${SPINNER[frame++ % SPINNER.length]} ${label}… ${suffix}`);
    }
  };

  const flush = () => {
    clearSpin();
    if (buf.trim()) {
      process.stdout.write(renderMarkdown(buf.trim()) + '\n');
      buf = '';
    }
  };

  const handle = (type, data) => {
    switch (type) {
      case 'thinking':
        thinkChars += (data.delta || '').length;
        tick('思考中', `(${thinkChars} 字)`);
        break;
      case 'text':
        buf += data.delta;
        tick('输出中', `(${buf.length} 字)`);
        break;
      case 'tool':
        flush();
        process.stdout.write(`  · ${toolLabel(data.name)}…\n`);
        break;
      case 'write':
        flush();
        process.stdout.write(`  ⟳ 第 ${data.round} 版写入…\n`);
        break;
      case 'status':
        flush();
        process.stdout.write(`  · ${data.message}\n`);
        break;
    }
  };

  return { handle, flush };
}

/* ─── 会话信息展示：引擎 / 模型 / 提示词装配清单 ──────────────────────────── */
function printRecipe({ system, template, direction, taste, model, skill }) {
  const r = promptRecipe({ system, template, taste, direction, skill });
  const lines = [
    `· 引擎: Pi agent（@earendil-works/pi-agent-core，迭代循环）`,
    `· 模型: ${model}`,
    `· 提示词装配（assets/ 资源）:`,
    `    skills   → ${r.skills.join(', ')}`,
    `    设计系统  → ${r.designSystem}`,
    `    模板      → ${r.template}`,
  ];
  if (direction) lines.push(`    视觉方向  → ${direction}`);
  lines.push(`    craft    → ${r.craft.join(', ')}`);
  lines.push(`    附加      → ${r.extras.join(' · ') || '（无）'}`);
  console.log(lines.join('\n') + '\n');
}

/* ─── 装配确认：展示 AI 决策，用户确认 / 修改 / --yes 跳过 ────────────────── */
async function confirmAssembly(decision, ask, yes) {
  if (yes) return true;
  console.log(`\n· AI 决策（按 Enter 确认，或输入修改项，如 "方向 editorial"）:`);
  console.log(`    · 任务类型 → ${decision.taskType}`);
  console.log(`    · 模板     → ${decision.template}`);
  console.log(`    · 设计系统 → ${decision.designSystem}`);
  console.log(`    · 视觉方向 → ${decision.direction}`);
  console.log(`    · skill    → ${decision.skill}`);
  if (decision.reason) console.log(`    · 理由     → ${decision.reason}`);
  const ans = (await ask('确认 (Enter) / 修改 > ')).trim();
  if (!ans) return true;
  return ans; // 返回修改指令字符串，CLI 重新决策
}

/* ─── agent 路径（决策阶段 → 装配确认 → 迭代设计 + 交互式澄清）────────────── */
async function runAgentCmd(promptArgs, opts) {
  if (opts.list) { console.log(`可用设计系统（${listSystems().length} 个）:\n${listSystems().join(' ')}`); return; }
  if (opts.listTemplates) { console.log(`可用模板（${listTemplates().length} 个）:\n${listTemplates().join(' ')}`); return; }
  if (opts.listDirections) { console.log(`可用方向（${listDirections().length} 个）:\n${listDirections().join(' ')}`); return; }

  let prompt = promptArgs.join(' ').trim();
  if (opts.file) prompt = readRel(opts.file).trim();
  if (!prompt) { console.error('缺少提示词。用法见 --help。'); process.exit(1); }

  const outDir = process.cwd(); // 默认输出到执行工具的当前路径
  const model = opts.model || 'deepseek-v4-flash';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  /* 决策阶段：任务类型 → 设计系统/方向 → skill（两级）→ 澄清 */
  const { runRouter, setAskUser } = await import('../src/router.mjs');
  setAskUser(async (text) => {
    // 展示 AI 的问题，让用户回答
    process.stdout.write('\n' + text.trim() + '\n');
    return (await ask('你 > ')).trim();
  });

  let decision = null;
  try {
    decision = await runRouter({ prompt, system: opts.system || 'default' });
  } catch (e) {
    console.error(`决策失败: ${e.message}`);
    process.exit(1);
  }
  if (!decision) { console.log('· 已取消。'); process.exit(0); }

  /* 装配确认：Enter 确认 / 修改重决策 / --yes 跳过 / 非 TTY 自动跳过 */
  const isTTY = process.stdin.isTTY === true;
  if (opts.yes || !isTTY) {
    printRecipe({ ...opts, model, skill: decision.skill });
  } else {
    const confirm = await confirmAssembly(decision, ask, opts.yes);
    if (confirm !== true) {
      // 用户给了修改指令 → 附加到 prompt 重新决策
      prompt = `${prompt}\n\n（用户修正：${confirm}，请按此修正重新决策）`;
      decision = await runRouter({ prompt, system: opts.system || 'default' });
    }
    printRecipe({ ...opts, model, skill: decision.skill });
  }

  /* 设计阶段：按决策结果创建会话 */
  const render = cliRenderer();
  const session = createSession({
    prompt, system: decision.designSystem, template: decision.template,
    direction: decision.direction, skill: decision.skill,
    out: opts.out, maxRounds: Number(opts.maxRounds) || 6, taste: opts.taste, modelId: model,
    clarify: true, onEvent: render.handle, outDir,
  });
  console.log(`· 输出文件: ${session.file}\n`);

  const onSigint = () => { console.log('\n· 已退出'); try { session.dispose(); } catch {} process.exit(130); };
  rl.on('SIGINT', onSigint);
  process.on('SIGINT', onSigint);

  try {
    const firstMsg = prompt;
    process.stdout.write('· 已发送，agent 思考中…\n');
    let r = await session.send(firstMsg);
    render.flush();
    while (r.phase === 'awaiting-input') {
      const answer = (await ask('你 > ')).trim();
      if (!answer) continue;
      process.stdout.write('· 已收到，agent 思考中…\n');
      r = await session.send(answer);
      render.flush();
    }
    if (r.valid === false && r.validReason) console.log(`⚠ 交付校验未通过：${r.validReason}`);
    console.log(`\n✓ 已生成: ${session.file}`);
  } finally {
    rl.close();
  }

  const port = process.env.PURE_DESIGN_PORT || 8745;
  console.log(`· 预览: http://127.0.0.1:${port}/o/${basename(session.file)}`);
}

/* ─── fast 路径（单次快速生成，一次 API 调用）────────────────────────────── */
async function runFastCmd(promptArgs, opts) {
  let prompt = promptArgs.join(' ').trim();
  if (opts.file) prompt = readRel(opts.file).trim();
  if (!prompt) { console.error('缺少提示词。用法见 --help。'); process.exit(1); }

  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const model = opts.model || defaultModel(base);
  const { path: out, name: outname } = resolveOutputPath(opts.out, prompt, process.cwd());

  printRecipe({ ...opts, model });
  if (opts.refine) console.log('· 精修循环: 开');
  console.log('· 正在生成…（可能需 30–120 秒）');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey && !authToken) { console.error('未找到凭据：请设置 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN。'); process.exit(1); }

  const system = buildSystemPrompt({ system: opts.system, template: opts.template, taste: opts.taste, direction: opts.direction });
  let text = await ask({ base, apiKey, authToken, model, maxTokens: Number(opts.maxTokens) || 16000, system, prompt });

  if (opts.refine) {
    console.log('· 第 1 遍完成，开始自审与精修…');
    const critiquePrompt = `下面是刚才生成的一版 HTML。请作为严格的设计评审，对照自检清单逐条指出问题
（只列具体可修的问题，按严重度排序，每条不超过一句），然后直接重写整页为改进后的完整 HTML，
同样用 \`\`\`html 围栏包裹，只输出一版，不要解释。\n\n当前 HTML:\n${extractHtml(text)}`;
    text = await ask({ base, apiKey, authToken, model, maxTokens: Number(opts.maxTokens) || 16000, system, prompt: critiquePrompt });
    console.log('· 精修完成');
  }

  const html = extractHtml(text);
  if (!looksLikeHtml(html)) {
    console.warn('⚠ 返回内容看起来不是完整 HTML，已原样写入文件。');
  } else if (!html.includes('</html>')) {
    console.warn('⚠ 输出可能被截断（缺 </html>）。请增大 --max-tokens 或换更强的模型。');
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, 'utf8');
  console.log(`✓ 已写入 ${out} (${html.length} 字节)`);
  console.log(`· 预览: http://127.0.0.1:${process.env.PURE_DESIGN_PORT || 8745}/o/${outname}`);
}

/* ─── preview / tunnel ──────────────────────────────────────────────────── */
function runPreviewCmd(port) {
  const p = port || process.env.PURE_DESIGN_PORT || 8745;
  const serverFile = join(ROOT, 'src', 'server.mjs');
  console.log(`· 启动 Web 界面 + 预览服务 (端口 ${p})…`);
  const child = spawn(process.execPath, [serverFile], {
    stdio: 'inherit',
    env: { ...process.env, PURE_DESIGN_PORT: String(p) },
  });
  child.on('error', (e) => { console.error('启动失败:', e.message); process.exit(1); });
}

function runTunnelCmd() {
  const port = process.env.PURE_DESIGN_PORT || 8745;
  console.log(`在本地机器终端执行（一次性，保持终端开着或后台运行）：

  ssh -N -L ${port}:127.0.0.1:${port} <你的服务器>

然后浏览器打开:

  http://127.0.0.1:${port}/      （设计操作页）
  http://127.0.0.1:${port}/gallery （历史画廊）`);
}

/* ─── commander 装配 ───────────────────────────────────────────────────── */
const program = new Command();

program
  .name('pure-design')
  // 位置参数后的选项归子命令解析（否则父命令同名短选项会吞掉 fast 子命令的 -s/-t/-d）
  .enablePositionalOptions()
  .description('极简 UI 设计 agent：提示词 → 自包含 HTML')
  .version(JSON.parse(readRel('package.json')).version, '-v, --version', '输出版本号')
  .argument('[prompt...]', '设计需求（不带则进入交互式澄清）')
  .option('-s, --system <name>', '设计系统（默认 default）', 'default')
  .option('-t, --template <name>', '模板（默认 web；web→web-prototype, mobile→mobile-app）', 'web')
  .option('-d, --direction <name>', '视觉方向（editorial / modern-minimal / …）')
  .option('-o, --out <path>', '输出路径（默认当前目录，从 brief 派生语义名）')
  .option('-f, --file <path>', '从文件读取提示词')
  .option('-m, --model <id>', '模型（默认 deepseek-v4-flash）')
  .option('--max-rounds <n>', 'agent 迭代轮数上限（默认 6）')
  .option('--taste', '追加反 AI 味审美技能')
  .option('--yes', '跳过装配确认，直接开始设计')
  .option('--list', '列出全部设计系统')
  .option('--list-templates', '列出全部模板')
  .option('--list-directions', '列出全部视觉方向')
  .action(runAgentCmd);

program
  .command('fast <prompt...>')
  .description('单次快速生成（一次 API 调用 → 一个 HTML）')
  .option('-s, --system <name>', '设计系统（默认 default）', 'default')
  .option('-t, --template <name>', '模板（默认 web）', 'web')
  .option('-d, --direction <name>', '视觉方向')
  .option('-o, --out <path>', '输出路径（默认当前目录，从 brief 派生语义名）')
  .option('-m, --model <id>', '模型（默认 claude-sonnet-5）')
  .option('-f, --file <path>', '从文件读取提示词')
  .option('--max-tokens <n>', '最大输出 token（默认 16000）')
  .option('--taste', '追加反 AI 味审美技能')
  .option('--refine', '自审 + 精修循环')
  .action(runFastCmd);

program
  .command('preview [port]')
  .description('启动 Web 界面 + 预览（默认 8745）')
  .action(runPreviewCmd);

program
  .command('tunnel')
  .description('打印 SSH 端口转发命令')
  .action(runTunnelCmd);

program.parseAsync().catch((e) => { console.error('错误:', e.message); process.exit(1); });
