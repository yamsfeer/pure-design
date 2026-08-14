# 0006. CLI TUI 渲染:轻量 Markdown 渲染,不引入 Ink

- **状态**:✅ Accepted(已实现)
- **日期**:2026-08-13

## Context

CLI 交互式澄清上线后,反馈了两个 TUI 问题:

1. **回车后干等**:agent 的"思考(推理)"阶段没有输出,用户不知道是否收到输入、agent 在做什么,长时间焦虑后一次性吐出内容。
2. **输出难看**:agent 的输出是 Markdown(`**加粗**`、`# 标题`、`` `代码` ``、列表),之前是裸打印,标记符直接可见。

第一个问题已经用"流式事件 + spinner + 工具动作日志"解决(见 `src/agent.mjs` 的 `createSession` 发事件、`cliRenderer` 渲染)。第二个问题需要决定:Markdown 怎么在终端里渲染。

## 候选方案(调研结果)

### 1. Ink —— Node 终端 UI 的事实标准框架

**Ink 是什么**:一个把 **React** 的组件模型(JSX、hooks、context、虚拟 DOM)搬到终端的渲染器。它用 Facebook 的 **Yoga** 引擎做 Flexbox 布局,`<Text>`/`<Box>`/`<Spacer>`/`<Static>`/`<Transform>` 等组件声明式搭界面。被 **Claude Code、Gemini CLI、Cloudflare Wrangler、Gatsby、Prisma、Linear** 等大量工具使用,是当今 Node 终端 UI 的主流框架。

配套生态:
- 图片:`ink-picture`(Sixel/Kitty/iTerm2 协议,200 万+ 下载)
- 组件:`@inkjs/ui`(输入框、select、spinner、progress bar 等)

### 2. 建在 Ink 之上的"AI 聊天"组件库

| 库 | 特点 | 成熟度 |
|---|---|---|
| [@x-otto/tui](https://www.npmjs.com/package/@x-otto/tui) | `StreamingMarkdown` 组件(无闪烁流式渲染)+ 消息流 + 工具动画 | v0.0.1-alpha |
| [@chat-tools/tui](https://www.npmjs.com/package/@chat-tools/tui) | `ChatView`/`MessageInput`/`ToolMessage` 现成组件 | 年轻 |
| [shadcn-labs/termcn](https://github.com/shadcn-labs/termcn) | Ink 组件库,含聊天消息、流式文本、thinking 块 | 年轻 |
| [@beyondbday/vibe-terminal](https://socket.dev/npm/package/@beyondbday/vibe-terminal) | 完整 AI 聊天客户端(流式 + thinking 开关),但**是应用不是库** | 参考用 |

### 3. 非 React 终端框架

- **blessed** —— 命令式 widget 库,已**停止维护**;fork `neo-blessed` 仍在修。
- **terminal-kit** —— 命令式"全功能工具箱"(无组件模型),功能全但不如 Ink 声明式好用。

### 4. 浏览器侧(不是终端,直接排除)

- [sideshow](https://socket.dev/npm/package/sideshow) —— 给 coding agent 用的"实时可视表面",但渲染在**浏览器**里,不是终端 TUI。
- `lychee-chat`、`@draht/web-ui` 等 —— 网页聊天组件,是给 Web UI 用的(我们未来 Web 界面可能用,但与本 CLI TUI 无关)。

## Decision

**不引入 Ink,保留手写的流式循环 + 只用 `marked` + `marked-terminal` 两个小依赖渲染 Markdown。**

- `marked` + `marked-terminal` 把 agent 的 Markdown 输出渲染成 ANSI(标题加色下划线、加粗、代码黄色、列表圆点、代码块语法高亮);非 TTY 时 chalk 自动去色。
- `createSession` 保持 UI 无关(只发 `thinking`/`text`/`tool`/`write`/`done` 事件),CLI 的 `cliRenderer` 负责缓冲正文、在工具调用/回合结束时 flush 成渲染好的 Markdown。

## 为什么(不选其他方案)

1. **依赖重量 vs 项目定位**:Ink = React(完整 UI 框架)+ Yoga(flexbox 引擎)+ 几十个传递依赖。而本项目的核心卖点就是"极简/轻量"(依赖只有 `pi-agent-core`、`pi-ai`)。为一个线性的一问一答 CLI 扛起整个 React,违背定位。

2. **需求不匹配**:我们的 CLI 是"一问一答 + 流式 + 工具日志"的线性流程,没有多面板、实时表格、复杂重渲染。Ink 的组件模型 + 虚拟 DOM + Flexbox 是杀鸡用牛刀。

3. **AI 聊天组件库都不成熟,且仍要扛 Ink**:`@x-otto/tui` 是 v0.0.1-alpha,其余多是单维护者;而且它们都建立在 Ink 上,选它们**绕不开 React 的重量**。

4. **UI 无关的架构要求**:`createSession` 故意保持 UI 无关(发事件),这样未来的 Web UI 能复用。Ink 渲染器是 CLI 专属的 React 树,Web(browser)那侧根本复用不了——Ink 的"组件复用"优势在我们的 CLI↔Web 分叉里用不上。

5. **真正的缺口只有一个**:Markdown 渲染。`marked-terminal` 一个依赖就解决 90% 的视觉问题;流式反馈已手写(~60 行,且 UI 无关)。

**什么时候会回头用 Ink**:如果以后要做富交互终端 UI(分屏面板、实时状态看板、带自动补全的复杂输入、图片渲染成为核心功能),届时 Ink + `ink-picture` + `@inkjs/ui` 的重量才值得。

## Consequences

- 依赖保持轻量:4 个(`pi-agent-core`、`pi-ai`、`marked`、`marked-terminal`)。
- Markdown 输出渲染干净(颜色/加粗/列表/代码块高亮),非 TTY 自动去色。
- 后续若需终端图片(read 工具读到参考图时),加 `terminal-image`(iTerm2/Kitty/Sixel 协议)即可,仍不需 Ink。
- 若未来 CLI 复杂度显著上升(多面板/富交互),需重新评估 Ink(此 ADR 届时可能被取代)。

## 参考

- Ink: https://github.com/vadimdemedes/ink
- @inkjs/ui: https://github.com/vadimdemedes/ink-ui
- marked-terminal: https://github.com/mikaelbr/marked-terminal
- @x-otto/tui: https://www.npmjs.com/package/@x-otto/tui
- @chat-tools/tui: https://www.npmjs.com/package/@chat-tools/tui
- shadcn-labs/termcn: https://github.com/shadcn-labs/termcn
- @beyondbday/vibe-terminal: https://socket.dev/npm/package/@beyondbday/vibe-terminal
- sideshow: https://socket.dev/npm/package/sideshow
