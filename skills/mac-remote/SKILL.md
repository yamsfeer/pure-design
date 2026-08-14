---
name: mac-remote
description: >-
  通过 Tailscale 组网从服务器远程操作本机桌面（macOS）：在浏览器打开网页看效果、
  双向传文件、远程执行命令。适用于"把生成的 HTML 展示到用户浏览器""传文件到本机"
  "在本机执行命令"等场景。需要服务器与本机已通过 Tailscale 组网，且服务器配置了
  到本机的 SSH 免密登录。
---

# mac-remote — 通过 Tailscale 从服务器操作本机桌面

## 前置条件（一次性配置）

1. **Tailscale 组网**：服务器与本机（macOS）都安装并登录 Tailscale，两台机器互相 ping 通。
   - 查看状态：`tailscale status`
   - 组网后两台机器有内网 IP（100.x.y.z 网段），互访无需公网、无需 SSH 隧道。
2. **SSH 免密**：服务器生成密钥（`ssh-keygen -t ed25519`），把公钥加入本机
   `~/.ssh/authorized_keys`，并确认本机开启了远程登录（系统设置 → 通用 → 共享 → 远程登录）。
3. **配置环境变量**（或用下方命令中的占位符替换）：

```bash
# 推荐写入 shell 配置（~/.bashrc 或 ~/.zshrc）
export MAC_HOST="user@100.x.y.z"      # 本机：用户名@Tailscale IP
export MAC_TAILSCALE_IP="100.x.y.z"   # 本机 Tailscale IP
export SERVER_TAILSCALE_IP="100.x.y.z" # 服务器 Tailscale IP（只监听该接口，不暴露公网）
```

## 安全准则（重要）

- **服务只监听服务器 Tailscale 接口**（`SERVER_TAILSCALE_IP`），绝不监听 `0.0.0.0` —— 否则暴露公网。
- 用完的服务要记录 PID，及时清理；临时文件放 `/tmp/`。
- 在本机执行命令前，想清楚权限与副作用（`open` 无害，`rm` 要谨慎）。

## 用法一：在本机浏览器打开网页看效果（最常用）

三步：起静态服务（绑定 Tailscale 接口）→ curl 自检 → 远程 `open`。

```bash
PORT=8890                                        # 自定义端口，避免冲突
HTML_DIR=/path/to/html/dir                       # 要展示的 HTML 所在目录
PAGE=index.html                                  # 入口页面
cat > /tmp/mac-remote-serve.mjs << EOF
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const PORT = ${PORT}, HOST = '${SERVER_TAILSCALE_IP}';
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = url.pathname === '/' ? '/${PAGE}' : url.pathname;
  try {
    const body = readFileSync(join('${HTML_DIR}', file));
    const ext = file.split('.').pop();
    const mime = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' };
    res.writeHead(200, { 'content-type': (mime[ext] || 'application/octet-stream') });
    res.end(body);
  } catch { res.writeHead(404); res.end('404'); }
}).listen(PORT, HOST, () => console.log('serving http://' + HOST + ':' + PORT + '/'));
EOF
node /tmp/mac-remote-serve.mjs > /tmp/mac-remote-serve.log 2>&1 &
SERVE_PID=$!
echo "serve PID: $SERVE_PID"
sleep 1

# 服务器端自检
curl -s -o /dev/null -w "%{http_code}" "http://${SERVER_TAILSCALE_IP}:${PORT}/${PAGE}"

# 本机浏览器打开
ssh -o BatchMode=yes "$MAC_HOST" "open 'http://${SERVER_TAILSCALE_IP}:${PORT}/${PAGE}'"
```

完成后服务留在后台（PID 在 `$SERVE_PID`），用户看完后可 `kill $SERVE_PID`。

**变体：直接打开本机上已有的本地文件**
```bash
ssh -o BatchMode=yes "$MAC_HOST" "open ~/Downloads/xxx.html"
```

## 用法二：双向传文件

```bash
# 服务器 → 本机（默认传到家目录）
scp -o BatchMode=yes /path/on/server/file.html "$MAC_HOST":~/Downloads/

# 本机 → 服务器
scp -o BatchMode=yes "$MAC_HOST":~/Downloads/xxx.png /tmp/

# 整目录（递归）
scp -r -o BatchMode=yes /path/on/server/dir "$MAC_HOST":~/Downloads/
```

## 用法三：远程执行本机命令

```bash
# 任意命令
ssh -o BatchMode=yes "$MAC_HOST" 'echo hi; uname -a'

# 看本机是否有文件
ssh -o BatchMode=yes "$MAC_HOST" 'ls ~/Downloads/ | head'

# 打开应用/访达
ssh -o BatchMode=yes "$MAC_HOST" 'open -a "Finder" ~/Downloads'
```

## 排障

| 症状 | 检查 |
|---|---|
| SSH 失败（Permission denied） | `tailscale status` 确认本机在线；确认公钥已加入本机 `~/.ssh/authorized_keys`；`ssh -o BatchMode=yes "$MAC_HOST" 'echo ok'` |
| 端口冲突 | `ss -tlnp \| grep :PORT` 找占用进程，换端口 |
| 浏览器没弹出 | 确认本机 `open` 命令可用（`which open`）；改用 `open -a Safari <url>` |
| 本机离线 | `tailscale status` 看本机状态；让用户在桌面端重连 Tailscale |
| Windows/Linux 桌面 | 本机不是 macOS 时，把 `open` 换成 `xdg-open`（Linux）或 `start`（Windows cmd） |
