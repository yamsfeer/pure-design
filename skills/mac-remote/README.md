# mac-remote — Tailscale 远程操作本机桌面的 Agent Skill

一个通用的 Agent Skill：通过 Tailscale 组网，从服务器远程操作本机桌面（macOS）——
**在浏览器打开网页看效果、双向传文件、远程执行命令**。

## 适合谁

- 你在服务器上跑 Coding Agent（Claude Code / Pi / 其他），本机是 macOS
- 希望 agent 生成 HTML 后直接在你的浏览器里展示，或互相传文件

## 安装

```bash
# 1. 复制到你的 agent skills 目录（按你的 agent 选择）
mkdir -p ~/.agents/skills ~/.claude/skills
cp -r skills/mac-remote ~/.agents/skills/
# 软链给其他 agent：
ln -s ~/.agents/skills/mac-remote ~/.claude/skills/mac-remote
```

## 前置条件

1. 服务器与本机安装并登录 **Tailscale**，两台机器互相 ping 通
2. 服务器生成 SSH 密钥，公钥加入本机 `~/.ssh/authorized_keys`，本机开启远程登录
3. 配置两个环境变量（或按 SKILL.md 中的占位符替换）：

```bash
export MAC_HOST="user@100.x.y.z"        # 本机：用户名@Tailscale IP
export SERVER_TAILSCALE_IP="100.x.y.z"  # 服务器 Tailscale IP
```

## 三种用法

| 用法 | 一句话 |
|---|---|
| 浏览器看效果 | 服务器起静态服务（只监听 Tailscale 接口）→ `ssh "$MAC_HOST" "open 'http://…'"` |
| 双向传文件 | `scp` 服务器 ↔ 本机 `~/Downloads/`（`-r` 递归） |
| 远程执行命令 | `ssh -o BatchMode=yes "$MAC_HOST" '命令'` |

详见 `SKILL.md`（含安全准则与排障）。
