#!/usr/bin/env node
/**
 * src/server.mjs — 极简 Web 操作界面 + 预览（零额外依赖）
 *
 * 路由:
 *   GET  /               设计操作页
 *   GET  /gallery        历史画廊
 *   GET  /api/systems    设计系统列表(JSON)
 *   GET  /api/templates  模板列表(JSON)
 *   POST /api/design     SSE：运行内置 Pi 设计 agent，实时推送进度
 *   GET  /o/<file>       预览 output/ 下的文件
 *
 * 环境变量: PURE_DESIGN_PORT(默认 8745) / PURE_DESIGN_HOST(默认 127.0.0.1)
 */
import http from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { ROOT, listSystems, listTemplates, listDirections } from './prompt.mjs';
import { runAgent } from './agent.mjs';

const OUT = join(ROOT, 'output');
const PORT = Number(process.env.PURE_DESIGN_PORT || 8745);
const HOST = process.env.PURE_DESIGN_HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ─── 页面样式（参考 open-design 的简洁风格：暖底、衬线标题、单一强调色） ── */
const STYLE = `
  :root { --bg:#fafaf7; --fg:#1a1916; --muted:#6b6964; --border:#e8e5df; --accent:#c96442;
          --surface:#fff; --font-display:'Iowan Old Style','Charter',Georgia,serif;
          --font-body:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family:var(--font-body); line-height:1.55; }
  header { padding:36px 40px 20px; border-bottom:1px solid var(--border); }
  header h1 { margin:0 0 4px; font-family:var(--font-display); font-size:26px; letter-spacing:-0.01em; }
  header .sub { color:var(--muted); font-size:14px; }
  main { max-width:760px; margin:0 auto; padding:28px 24px 80px; }
  label { display:block; font-size:13px; color:var(--muted); margin:18px 0 6px; font-weight:600; }
  textarea, input, select { width:100%; font:inherit; padding:11px 12px; border:1px solid var(--border);
          border-radius:10px; background:var(--surface); color:var(--fg); }
  textarea { min-height:110px; resize:vertical; }
  textarea:focus, input:focus, select:focus { outline:none; border-color:var(--accent); }
  .row { display:flex; gap:14px; }
  .row > div { flex:1; }
  .btn { display:inline-flex; align-items:center; gap:8px; margin-top:24px; padding:12px 22px;
         background:var(--accent); color:#fff; border:none; border-radius:10px; font-size:15px;
         font-weight:600; cursor:pointer; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-secondary { background:transparent; color:var(--fg); border:1px solid var(--border); }
  #progress { margin-top:20px; padding:14px; background:var(--surface); border:1px solid var(--border);
         border-radius:10px; font-family:ui-monospace,'JetBrains Mono',monospace; font-size:13px;
         white-space:pre-wrap; max-height:260px; overflow:auto; display:none; color:var(--muted); }
  #result { margin-top:16px; padding:16px; background:var(--surface); border:1px solid var(--border);
         border-radius:10px; display:none; }
  #result a { color:var(--accent); font-weight:600; }
  #summary { margin-top:8px; font-size:14px; color:var(--muted); }
  nav.top { padding:0 40px 14px; display:flex; gap:18px; }
  nav.top a { color:var(--muted); text-decoration:none; font-size:14px; }
  nav.top a:hover { color:var(--fg); }
`;

function page(inner, title) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Pure Design</title>
<style>${STYLE}</style></head>
<body><header>
  <h1>Pure Design</h1>
  <div class="sub">内置 Pi 基座的 UI 设计 agent · 提示词 → 自包含 HTML</div>
</header>
<nav class="top"><a href="/">设计</a><a href="/gallery">画廊</a></nav>
<main>${inner}</main></body></html>`;
}

const INDEX_PAGE = page(`
<form id="form">
  <label for="brief">设计需求</label>
  <textarea id="brief" placeholder="例如：给独立开发者的极简记账 App 首页，主打本月支出与预算进度。用中文描述，越具体越好。"></textarea>

  <div class="row">
    <div><label for="system">设计系统</label>
      <input id="system" list="systems" value="default" />
      <datalist id="systems"></datalist>
    </div>
    <div><label for="template">模板</label>
      <select id="template">
        <option value="web">web · 落地页/营销页</option>
        <option value="dashboard">dashboard · 管理后台</option>
        <option value="mobile">mobile · 移动端界面</option>
      </select>
    </div>
    <div><label for="direction">视觉方向（可选）</label>
      <input id="direction" list="directions" placeholder="默认（由设计系统决定）" />
      <datalist id="directions"></datalist>
    </div>
  </div>

  <label style="margin-top:14px"><input type="checkbox" id="taste" style="width:auto;margin-right:6px" />
  追加反 AI 味审美技能（营销页推荐，较费 token）</label>

  <button type="submit" class="btn" id="run">开始设计</button>
</form>

<div id="progress"></div>
<div id="result">
  <div>✓ 设计完成 — <a id="res-link" target="_blank">打开预览</a>
      <a href="/gallery" class="btn-secondary" style="padding:6px 12px;margin-left:10px;font-size:13px">历史画廊</a></div>
  <div id="summary"></div>
</div>

<script>
  // 填充设计系统候选
  fetch('/api/systems').then(r => r.json()).then(list => {
    const dl = document.getElementById('systems');
    list.forEach(s => { const o = document.createElement('option'); o.value = s; dl.appendChild(o); });
  });
  fetch('/api/directions').then(r => r.json()).then(list => {
    const dl = document.getElementById('directions');
    list.forEach(s => { const o = document.createElement('option'); o.value = s; dl.appendChild(o); });
  });

  // SSE 解析
  async function sse(fetchRes, onEvent) {
    const reader = fetchRes.body.getReader();
    const dec = new TextDecoder(); let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\\n\\n')) !== -1) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        const lines = raw.split('\\n');
        const ev = (lines.find(l => l.startsWith('event:')) || '').slice(6).trim();
        const dt = (lines.find(l => l.startsWith('data:')) || '').slice(5).trim();
        if (dt) { try { onEvent(ev, JSON.parse(dt)); } catch {} }
      }
    }
  }

  const progress = document.getElementById('progress');
  const addLine = (t) => { progress.textContent += t + '\\n'; progress.scrollTop = progress.scrollHeight; };

  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const brief = document.getElementById('brief').value.trim();
    if (!brief) return alert('请填写设计需求');
    const run = document.getElementById('run');
    run.disabled = true; run.textContent = '设计中…（agent 迭代，约 1–5 分钟）';
    progress.style.display = 'block'; progress.textContent = '';
    document.getElementById('result').style.display = 'none';

    const params = {
      prompt: brief,
      system: document.getElementById('system').value.trim() || 'default',
      template: document.getElementById('template').value,
      direction: document.getElementById('direction').value.trim() || undefined,
      taste: document.getElementById('taste').checked,
    };

    try {
      const res = await fetch('/api/design', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
      await sse(res, (ev, d) => {
        if (ev === 'status') addLine(d.message);
        else if (ev === 'write') addLine('⟳ 第 ' + d.round + ' 版写入…');
        else if (ev === 'done') {
          document.getElementById('res-link').href = d.url;
          document.getElementById('summary').textContent = d.summary || '';
          document.getElementById('result').style.display = 'block';
          addLine('✓ 完成：' + d.url);
        } else if (ev === 'error') { addLine('✗ ' + d.message); }
      });
    } catch (err) { addLine('✗ 请求失败: ' + err.message); }
    finally { run.disabled = false; run.textContent = '开始设计'; }
  });
</script>
`, '设计');

/* ─── 画廊 ──────────────────────────────────────────────────────────────── */
function galleryPage() {
  let items = [];
  if (existsSync(OUT)) {
    items = readdirSync(OUT).filter((f) => f.endsWith('.html')).map((f) => {
      const st = statSync(join(OUT, f));
      const head = readFileSync(join(OUT, f), 'utf8').slice(0, 4000);
      const t = (head.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
      return { f, title: t.trim(), time: st.mtimeMs };
    }).sort((a, b) => b.time - a.time);
  }
  const rows = items.length ? items.map((it) => `
    <a class="card" href="/o/${encodeURIComponent(it.f)}">
      <div class="title">${esc(it.title || it.f)}</div>
      <div class="meta">${esc(it.f)} · ${new Date(it.time).toLocaleString()}</div>
    </a>`).join('\n') : '<p class="empty">output/ 还没有内容，先在「设计」页生成一版。</p>';
  return page(`<style>
    .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px; }
    .card { display:block; padding:18px; background:var(--surface); border:1px solid var(--border);
            border-radius:12px; text-decoration:none; color:inherit; }
    .card:hover { border-color:var(--accent); }
    .card .title { font-weight:600; margin-bottom:6px; }
    .card .meta { color:var(--muted); font-size:12px; font-family:ui-monospace,monospace; }
    .empty { color:var(--muted); }
  </style>
  <h2 style="font-family:var(--font-display);font-weight:600">历史设计</h2>
  <div class="cards">${rows}</div>`, '画廊');
}

/* ─── HTTP 服务 ────────────────────────────────────────────────────────── */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = decodeURIComponent(url.pathname);

  if (path === '/') return res.end(INDEX_PAGE);
  if (path === '/gallery') return res.end(galleryPage());
  if (path === '/api/systems') {
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(listSystems()));
  }
  if (path === '/api/templates') {
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(listTemplates()));
  }
  if (path === '/api/directions') {
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(listDirections()));
  }

  if (path === '/api/design' && req.method === 'POST') {
    // SSE
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };
    try {
      const body = await readBody(req);
      send('status', { message: '· 内置 Pi agent 启动…' });
      await runAgent({
        prompt: body.prompt, system: body.system || 'default', template: body.template || 'web',
        direction: body.direction || undefined, taste: !!body.taste, maxRounds: Number(body.maxRounds) || 6,
        onEvent: (type, data) => {
          if (type === 'write') send('write', { round: data.round });
          else if (type === 'done') {
            const rel = '/' + data.file.split(/[\\/]/).pop();
            send('done', { url: '/o/' + rel.replace(/^\//, ''), summary: data.summary, rounds: data.rounds });
          }
        },
      });
    } catch (e) {
      send('error', { message: e.message });
    }
    res.end();
    return;
  }

  // 静态文件：/o/<file>
  if (path.startsWith('/o/')) {
    const rel = path.slice(3);
    const fp = join(OUT, rel);
    if (!fp.startsWith(OUT) || !existsSync(fp) || statSync(fp).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404');
    }
    const data = readFileSync(fp);
    res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' });
    return res.end(data);
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}).listen(PORT, HOST, () => {
  console.log(`✓ Pure Design 已启动: http://${HOST}:${PORT}/`);
  console.log(`  本地访问（SSH 转发后）: ssh -N -L ${PORT}:127.0.0.1:${PORT} <你的服务器>  →  http://127.0.0.1:${PORT}/`);
});
