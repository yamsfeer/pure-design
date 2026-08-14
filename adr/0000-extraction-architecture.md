# 0000. 提取式架构:资产 + 内置 Pi agent 基座

- **状态**:✅ Accepted(已实现)
- **日期**:2026-08-13

## Context

上游 open-design 是一个 local-first 设计工作台,价值集中在"设计资产库"(skills / design-systems / design-templates / craft / prompt-templates),但被大量产品外壳包裹:Electron 桌面端、网页应用、守护进程、登录/鉴权、AMR 云付费路由、MCP、插件市场,以及 `packages/*` 一堆基础设施。

我们只想要"最纯粹的设计能力":**提示词 → 一个自包含 HTML**。

## Decision

**提取而非重构**:

1. 完整复制设计资产到 `assets/`(164 技能 / 153 设计系统 / 115 模板 / 13 工艺参考)。
2. 保留"资产 → 系统提示词"的装配逻辑(`src/prompt.mjs` 的 `buildSystemPrompt`)。
3. 用 **Pi 的 SDK**(`@earendil-works/pi-agent-core`)作为内置 agent 基座,替代上游"检测/启动外部 coding agent(Claude Code / Codex / …)"的编排层。Pi 只负责"循环直到满意",不依赖本机安装任何 coding agent。
4. 舍弃 Electron、web 应用、守护进程、鉴权、MCP、插件市场等外围设施。

## Consequences

- **依赖最小**:`pnpm install` 只拉 Pi SDK,clone 即可跑。
- **无外部 agent 依赖**:不用装 Claude Code/Codex。
- **牺牲了上游的编排能力**:没有多 agent 运行时检测、会话续跑、live artifact 等(按需后续补)。
- 上游 27 个运行时里也有 `pi.ts`,说明"用 Pi 当发动机"思路上游本就支持,我们是把它从"外部 CLI"改为"内嵌依赖"。
