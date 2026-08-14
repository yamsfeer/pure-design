# 管线对照:上游 OpenDesign vs 我们的 Pure Design

本文档对照两条"从提示词到 HTML"的管线,记录每一步的**决策**与**差异**。决策的正式记录见 `adr/`,共同语言见 `adr/glossary.md`。

## 七步管线总览

| 步骤 | 术语 | 上游 OpenDesign | 我们的项目 | 状态 |
|---|---|---|---|---|
| 1 | 澄清 | `discovery.ts` 输出 `<question-form>` | 改用 `grilling` skill(单一 agent 会话) | 🟢 已实现(CLI) |
| 2 | 装配 | `system.ts` composer | `buildSystemPrompt` + 方向库 | 🟢 已实现 |
| 3 | 基座 | 检测/启动 27 种外部 CLI | 内置 Pi SDK | 🟢 有 |
| 4 | 执行 | 外部 CLI 原生工具 + MCP | Pi 官方 read/write/edit/bash | 🟢 已实现 |
| 5 | 自检 | `lint-artifact.ts`(grep,程序检测) | `src/lint.mjs` 确定性 lint(写后校验) | 🟢 已实现 |
| 6 | 校验 | `run-deliverable-validation` + 重试 | 交付校验 + 瞬时重试 | 🟢 已实现 |
| 7 | 归档 | manifest + 版本化 + Inspect | 语义命名 + 版本保留 | 🟢 已实现 |

## 逐步说明

### 1. 澄清 —— 我们与上游最大的差异

- **上游**:`discovery.ts` 注入系统提示词,让 agent 输出结构化 `<question-form>`(平台/受众/调性/品牌/规模/约束),宿主 UI 解析成表单。规则是"信息不足会影响结果才问,否则直接干"。
- **我们**:目的相同,但**不用表单机制**,改用 AI 提问 —— 复用已安装的 **`grilling` skill**(逐条追问、每条给推荐答案、一次一问、事实自己查、决定交给用户、达成共识才动手)。
- **决策**:`adr/0001`。
- **已实现**:`createSession({ clarify: true })` 把 grilling 指令注入系统提示词最前,单一 agent 从澄清问到设计贯穿到底;`send(msg)` 每轮一问一答,用"是否 write 文件"区分澄清/设计。CLI 交互壳(readline)已上线;Web 版对话式澄清 UI 作为后续。

### 2. 装配 —— 关于"Discovery 层"的澄清

> `discovery.ts` 既是"第 1 步澄清"的机制,也是"第 2 步 composer 的一层"——它们是同一个东西。所以"不用 discovery.ts、改用 grilling"一个决定同时覆盖第 1、2 步。

本步已覆盖:设计系统 DESIGN.md、技能 SKILL.md + 种子 template.html + layouts.md + checklist.md、工艺 craft、输出契约。

本步新增决策:

| 项 | 决策 | 说明 |
|---|---|---|
| 方向库(directions) | ✅ 要 | `adr/0005`:美学方向菜单,澄清时可选、装配时注入 |
| 语义文件名 | ✅ 要 | 归入第 7 步归档(见 `adr/0003`) |
| 设计师宪章(official-system.ts) | 暂不改 | 用 frontend-design 技能替代 |

- **已实现**:`assets/directions/`(5 个方向,OKLch 调色板 + 字体栈 + posture);`buildSystemPrompt` 接受 `direction` 参数注入;CLI `--direction`/`--list-directions` + Web 界面方向选择。

### 3. 基座

- **上游**:`runtimes/` 检测并 headless 启动本机 coding agent(27 种)。
- **我们**:内置 Pi SDK(`@earendil-works/pi-agent-core`),`pnpm install` 即可,不依赖外部 agent。
- **决策**:`adr/0000`。无变更。

### 4. 执行 —— 用 Pi 官方工具

- **上游**:外部 CLI 用原生 Read/Write/Edit/Bash + 注入 MCP 工具。
- **我们(更正后)**:Pi SDK **内置** 4 个官方工具(`harness/tools`,顶层已导出):`read` / `write` / `edit` / `bash`。
- **决策**:弃用自定义 `write_file`,改用官方四工具(`adr/0004`)。
  - 轮数硬闸门上移到循环层;lint 独立成第 5 步写后校验。
- **已实现**:`src/agent.mjs` 用 `NodeExecutionEnv` 提供文件系统/shell,把官方四工具的 `{ env }` 第 5 参注入进去,write/edit 上叠轮数闸门。端到端已验证(agent 循环真实走 write)。

> 早期误判说明:我曾以为 Pi SDK 无内置工具(只看了裸 `Agent` 类 `agent.js:27`),漏看了 `harness/tools`。已更正。

### 5. 自检 —— 程序检测,不是 LLM

- **上游**:`lint-artifact.ts`,grep 式、确定性,P0/P1/P2 三级,命中 P0 带 snippet 回喂 agent。P0 硬规则:紫/靛蓝 hex、蓝→青 trust gradient、emoji 图标、无衬线标题、编造指标、lorem 填充。
- **我们**:目前只有 LLM 对着 checklist 自审,不可靠。
- **决策**:照搬上游(`adr/0002`),做成独立的写后校验步骤。
- **已实现**:`src/lint.mjs` 精简移植上游规则(P0 硬闸门 + 常用 P1/P2),接进 write/edit 工具——写盘后跑 lint,命中的 P0/P1 作为工具返回回喂模型逼其自纠。额外加了 `var()` 解析,防止把黑名单色藏进 CSS 变量绕过渐变检测。单元测试 + 端到端均已验证(第 1 版被 lint 拦下、第 2 版修正后通过)。

### 6. 校验

- **上游**:`run-deliverable-validation.ts` 验证 entry 文件存在/被改/类型匹配;`run-retry-policy.ts` 对瞬时失败重试。
- **决策**:补上(`adr/0003`)。收尾验证文件完整 + 瞬时失败重试一次。
- **已实现**:`runAgent` 收尾 `validateOutput`(存在 + `<!doctype html>` + `</html>` + 最小长度);瞬时失败(429/5xx/超时)自动重试一次。

### 7. 归档

- **上游**:manifest + 语义文件名 + 版本化 + Inspect/Picker(`data-od-id`)。
- **我们**:死写 `output/index.html`,历史被冲掉。
- **决策**:补上(`adr/0003`)。语义命名 + 版本保留,但**不做**完整 project/SQLite 模型。
- **已实现**:未显式 `-o` 时从 brief 派生语义名(`slugify`),已存在自动 +v2/+v3(`versionedPath`);纯中文 brief 回退 `index`,靠版本保留防覆盖。

## 明确不做(生态,已正确摒弃)

Electron 桌面端、网页应用、守护进程(HTTP/Express + SQLite)、MCP server、live artifacts、插件市场、登录/AMR 付费路由、analytics/observability、browser harness、worktree。

## 状态

七步均已实现。CLI 交互澄清已上线;Web 版的对话式澄清 UI(前后端分离 + SSE 会话)作为后续——按"先 CLI 再 Web"的决策顺序。
