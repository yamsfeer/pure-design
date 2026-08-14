/**
 * src/lint.mjs — 确定性反 AI 味 linter(程序检测,非 LLM 自评)
 *
 * 从上游 apps/daemon/src/lint-artifact.ts 精简而来(见 adr/0002)。
 * grep 式、确定性、容忍误报:每条 finding 带 snippet 供 agent 自行核对。
 * P0 = 必须修,P1 = 应该修,P2 = 建议。
 *
 * 导出:
 *   lintHtml(html) → [{ severity, id, message, fix, snippet }]
 *   renderFindingsForAgent(findings) → 回喂给 agent 的文本(无 finding 时返回 '')
 */

/* ─── 常量:AI 味特征库 ──────────────────────────────────────────────────── */
const PURPLE_HEXES = [
  // Tailwind violet / purple
  '#a855f7', '#9333ea', '#7c3aed', '#6d28d9', '#581c87',
  '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe',
  // Tailwind indigo
  '#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#312e81',
  '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff', '#eef2ff',
];

const TRUST_GRADIENT_BLUE_HEXES = [
  '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a',
  '#60a5fa', '#93c5fd', '#bfdbfe',
  '#0ea5e9', '#0284c7', '#0369a1', '#38bdf8', '#7dd3fc',
];

const TRUST_GRADIENT_CYAN_HEXES = [
  '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63',
  '#22d3ee', '#67e8f9', '#a5f3fc',
];

// 典型的"默认 LLM 强调色"——哪怕单次实心使用也是 AI 味。
const AI_DEFAULT_INDIGO = [
  '#6366f1', '#4f46e5', '#4338ca', '#3730a3',
  '#8b5cf6', '#7c3aed', '#a855f7',
];

const SLOP_EMOJI = [
  '✨', '🚀', '🎯', '⚡', '🔥', '💡', '📈', '🎨', '🛡️', '🌟',
  '💪', '🎉', '👋', '🙌', '✅', '⭐', '🏆',
];

const INVENTED_METRIC_PATTERNS = [
  /\b10×\s+(faster|better|easier)\b/i,
  /\b100×\s+(faster|better)\b/i,
  /\b99\.\d+%\s+uptime\b/i,
  /\bzero[- ]downtime\b/i,
  /\b3×\s+more\s+(productive|efficient)\b/i,
];

const FILLER_PATTERNS = [
  /\bfeature\s+(one|two|three|1|2|3)\b/i,
  /\blorem\s+ipsum\b/i,
  /\bdolor\s+sit\s+amet\b/i,
  /\bplaceholder\s+text\b/i,
  /\bsample\s+content\b/i,
];

// 标题(h1/h2/h3 或 .h-hero/.h-xl/.h-lg/.h-md)用了无衬线字体,而不是种子绑定的衬线。
const DISPLAY_SANS_RE =
  /(?:h1|h2|h3|\.h-?(?:hero|xl|lg|md))[^{}]*\{[^}]*font-family\s*:\s*["']?(?:Inter|Roboto|Arial|-apple-system|system-ui|SF\s+Pro)/i;

const ROOT_FONT_PX = 16;

/* ─── 工具函数 ──────────────────────────────────────────────────────────── */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clip(s) {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 200 ? t.slice(0, 197) + '…' : t;
}

// 匹配完整的 linear-gradient(...),容忍 var()/rgba()/calc() 等一层嵌套括号。
const GRADIENT_RE = /linear-gradient\([^()]*(?:\([^()]*\)[^()]*)*\)/gi;

// 返回第一个满足 predicate 的完整渐变文本,否则 null。
function findGradient(html, predicate) {
  for (const grad of html.match(GRADIENT_RE) ?? []) {
    if (predicate(grad)) return grad;
  }
  return null;
}

// 简化版:把 `--accent: <hex>` 声明替换掉,再扫 indigo。
// 上游的完整逻辑是"只放行 token-shaped 且非洗白的全局主题块";这里只实现它的核心意图:
// 设计系统若真用 indigo,会声明为 --accent(合法逃逸口);除此之外的任何 indigo(含 --primary 等洗白名)仍被抓。
function stripAccentDeclarations(html) {
  return html.replace(/--accent\s*:\s*#[0-9a-fA-F]{3,8}\b/gi, '--accent: #000000');
}

// 解析 linear-gradient(...) 里的 var(--x) 到其字面量,防止把黑名单色藏进 CSS 变量绕过渐变检测。
function resolveVarsInGradients(html) {
  const vars = new Map();
  for (const m of html.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
    vars.set(m[1], m[2].trim());
  }
  if (vars.size === 0) return html;
  return html.replace(GRADIENT_RE, (grad) =>
    grad.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_f, name) => vars.get(name) ?? _f));
}

// 简化版:判断一个声明体里 letter-spacing 是否达标(≥0.06em,或绝对 ≥1px)。
// 上游还会解析 var() 与主题作用域,这里省略,只做粗判。
function hasAdequateTracking(body) {
  const m = /letter-spacing\s*:\s*(-?\d*\.?\d+)\s*(em|px|rem)\b/i.exec(body);
  if (!m) return false;
  const v = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'em') return v >= 0.06;
  if (unit === 'px') return v >= 1;
  if (unit === 'rem') return v * ROOT_FONT_PX >= 1;
  return false;
}

/* ─── 主检查 ────────────────────────────────────────────────────────────── */
export function lintHtml(rawHtml) {
  const out = [];
  if (typeof rawHtml !== 'string' || rawHtml.length === 0) return out;

  // 剥掉 HTML 注释再匹配(注释常含示例代码,避免误报)。
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
  // 渐变检查用 var 解析版,防止黑名单色藏进 CSS 变量绕过。
  const gradHtml = resolveVarsInGradients(html);

  const push = (severity, id, message, fix, snippet) =>
    out.push({ severity, id, message, fix, snippet });

  // P0-1 紫/靛蓝渐变背景(在 var 解析后的 gradHtml 上匹配完整渐变)
  const purpleGrad = findGradient(gradHtml, (grad) => {
    const s = grad.toLowerCase();
    return PURPLE_HEXES.some((h) => s.includes(h)) || /\b(purple|violet)\b/.test(s);
  });
  if (purpleGrad) {
    push('P0', 'purple-gradient',
      '发现紫色/靛蓝渐变——反 AI 味清单禁止。',
      '换成纯色面(var(--bg) 或 var(--surface)),或单一强度地使用当前 accent,不要用渐变。',
      clip(purpleGrad));
  }

  // P0-1c 蓝→青两段"trust"渐变
  if (!out.find((f) => f.id === 'purple-gradient')) {
    const tg = findGradient(gradHtml, (grad) => {
      const s = grad.toLowerCase();
      const hasBlue = TRUST_GRADIENT_BLUE_HEXES.some((h) => s.includes(h)) || /\bblue\b/.test(s);
      const hasCyan = TRUST_GRADIENT_CYAN_HEXES.some((h) => s.includes(h)) || /\bcyan\b/.test(s);
      return hasBlue && hasCyan;
    });
    if (tg) push('P0', 'trust-gradient',
      '发现蓝→青两段"trust"渐变——SaaS hero 的典型 AI 味。',
      '换成纯色面(var(--bg)/var(--surface))或单一设计 token 色。', clip(tg));
  }

  // P0-1b 实心 AI 默认 indigo
  if (!out.find((f) => f.id === 'purple-gradient')) {
    const htmlForIndigo = stripAccentDeclarations(html);
    for (const hex of AI_DEFAULT_INDIGO) {
      const m = new RegExp(escapeRe(hex), 'i').exec(htmlForIndigo);
      if (m) {
        push('P0', 'ai-default-indigo',
          `发现默认 LLM 强调色(${hex})——被报告最多的 AI 味。`,
          '换成 var(--accent) 引用当前 DESIGN.md 的强调色;若 brief 确实要 indigo,把它声明为设计系统的 --accent。',
          clip(m[0]));
        break;
      }
    }
  }

  // P0-2 emoji 当图标
  for (const e of SLOP_EMOJI) {
    if (!html.includes(e)) continue;
    const re = new RegExp(`<(?:h[1-6]|button|li|span class="[^"]*icon[^"]*")[^>]*>[^<]*${escapeRe(e)}`, 'i');
    const m = re.exec(html);
    if (m) {
      push('P0', 'emoji-icon',
        `emoji "${e}" 被当成 UI 图标——只能用单线 SVG。`,
        '换成内联 SVG 图标(1.6–1.8px stroke、currentColor),或直接去掉图标。', clip(m[0]));
      break;
    }
  }

  // P0-3 圆角卡片 + 左边框强调色
  const lam = /\.[a-z-]+\s*\{[^}]*border-left\s*:\s*\d+px\s+solid\s+[^;]+;[^}]*border-radius\s*:\s*[1-9]/i.exec(html);
  if (lam) push('P0', 'left-accent-card',
    '圆角卡片带彩色左边框——典型 AI 卡片样式。',
    '去掉 border-radius(设 0)或去掉 border-left;种子模板的卡片是四周细边框、无左强调。', clip(lam[0]));

  // P0-4 无衬线标题
  const dm = DISPLAY_SANS_RE.exec(html);
  if (dm) push('P0', 'sans-display',
    '标题规则用了 Inter/Roboto/系统无衬线,而不是种子绑定的衬线。',
    'h1/h2/h3 用 font-family: var(--font-display),让设计系统选衬线。', clip(dm[0]));

  // P0-5 编造指标
  for (const re of INVENTED_METRIC_PATTERNS) {
    const m = re.exec(html);
    if (m) {
      push('P0', 'invented-metric',
        `疑似编造指标:"${m[0]}"。反 AI 味清单:没有真实来源的数字一律不要。`,
        '删掉该说法,或用占位符(— / 标注的占位)直到用户给出真实数字。', clip(m[0]));
      break;
    }
  }

  // P0-6 填充文案
  for (const re of FILLER_PATTERNS) {
    const m = re.exec(html);
    if (m) {
      push('P0', 'filler-copy',
        `检测到填充文案:"${m[0]}"。页面应使用真实、贴合 brief 的文案。`,
        '换成贴合 brief 的文案,或干脆删掉该区块。空区块是构图问题,不是靠造词解决。', clip(m[0]));
      break;
    }
  }

  // P0-7 scrollIntoView(会扯动 iframe 宿主页)
  if (/\.scrollIntoView\s*\(/.test(html)) {
    push('P0', 'scroll-into-view',
      '检测到 scrollIntoView()——会跨越 iframe 边界扯动宿主页。',
      '改用 scrollTo({ left, top, behavior: "smooth" }) 作用于真正的滚动容器。');
  }

  // P1-0 ALL-CAPS 无字距
  for (const styleBlock of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = (styleBlock[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const upperRe = /([^{}]*)\{([^{}]*text-transform\s*:\s*uppercase[^{}]*)\}/gi;
    let m;
    let fired = false;
    while ((m = upperRe.exec(css)) !== null) {
      const selector = (m[1] ?? '').trim();
      const body = m[2] ?? '';
      if (!hasAdequateTracking(body)) {
        push('P1', 'all-caps-no-tracking',
          `选择器 \`${selector.slice(0, 60)}\` 用了 text-transform: uppercase 但 letter-spacing 不足(≥0.06em)。`,
          '在同一条规则里加 letter-spacing: 0.08em(典型值)。全大写无字距显得局促。',
          clip(`${selector} { ${body.trim()} }`));
        fired = true;
        break;
      }
    }
    if (fired) break;
  }

  // P1-1 外部占位图 CDN
  const extImg = /<img[^>]+src=["']https?:\/\/(?:images\.unsplash\.com|placehold\.co|placekitten\.com|via\.placeholder\.com|picsum\.photos|loremflickr\.com)/i.exec(html);
  if (extImg) push('P1', 'external-image',
    '检测到外部占位图 CDN——脆弱,404 时显得很假。',
    '改用种子模板里的 .ph-img 占位类。', clip(extImg[0]));

  // P1-2 :root 外裸 hex 过多
  const styleMatch = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html);
  if (styleMatch) {
    const css = styleMatch[1] ?? '';
    const rootRe = /:root\s*\{[^}]*\}/g;
    const cssWithoutRoot = css.replace(rootRe, '');
    const hexes = cssWithoutRoot.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    if (hexes.length > 12) {
      push('P1', 'raw-hex',
        `:root 外有 ${hexes.length} 处裸 hex——设计 token 大概率没被遵守。`,
        '把所有颜色移进 :root token 块(--bg/--surface/--fg/--muted/--border/--accent)并用 var() 引用;派生色用 color-mix()。',
        hexes.slice(0, 6).join(' '));
    }
  }

  // P1-3 强调色用太多
  const styleStripped = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  const accentUses = (styleStripped.match(/var\(--accent\)/g) ?? []).length;
  if (accentUses > 6) {
    push('P1', 'accent-overuse',
      `正文里 var(--accent) 用了 ${accentUses} 次——每屏可能过度使用。`,
      '每屏强调色控制在 2 处以内(一个 eyebrow + 一个 CTA)。其余降级为 var(--fg) 或 var(--muted)。');
  }

  // P2-1 <section> 缺 data-od-id 锚点
  const sections = html.match(/<section\b[^>]*>/gi) ?? [];
  const tagged = sections.filter((s) => /data-od-id\s*=/.test(s)).length;
  if (sections.length > 0 && tagged < sections.length) {
    push('P2', 'missing-section-anchor',
      `${sections.length - tagged}/${sections.length} 个 <section> 缺 data-od-id。`,
      '给每个顶层 <section> 加 data-od-id="kebab-slug",便于定位。');
  }

  return out;
}

/* ─── 回喂 agent 的文本 ──────────────────────────────────────────────────── */
function severityRank(f) {
  return f.severity === 'P0' ? 0 : f.severity === 'P1' ? 1 : 2;
}

export function renderFindingsForAgent(findings) {
  if (!findings || findings.length === 0) return '';
  const sorted = [...findings].sort((a, b) => severityRank(a) - severityRank(b));
  const p0 = findings.filter((f) => f.severity === 'P0').length;
  const p1 = findings.filter((f) => f.severity === 'P1').length;
  const p2 = findings.filter((f) => f.severity === 'P2').length;
  const lines = [
    '<artifact-lint>',
    `你刚产出的 HTML 有反 AI 味 / 设计 token 问题:${p0} 个 P0(必须修)、${p1} 个 P1(应该修)、${p2} 个 P2(建议)。`,
    '请在下一次写文件时一并修复,不要单独输出解释——用户已有上一版。',
    '',
  ];
  for (const f of sorted) {
    lines.push(`**[${f.severity}] ${f.id}** — ${f.message}`);
    lines.push(`  修复: ${f.fix}`);
    if (f.snippet) lines.push(`  片段: \`${f.snippet}\``);
    lines.push('');
  }
  lines.push('</artifact-lint>');
  return lines.join('\n');
}
