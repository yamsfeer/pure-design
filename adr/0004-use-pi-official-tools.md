# 0004. 使用 Pi 官方内置工具(read/write/edit/bash),弃用自定义 write_file

- **状态**:✅ Accepted(已实现)
- **日期**:2026-08-13

## Context

之前 `src/agent.mjs` 自定义了一个 `write_file` 工具,理由是误以为 Pi SDK 是"裸循环引擎、无内置工具"——当时只看了裸 `Agent` 类的 `agent.js:27`(`tools = initialState?.tools?.slice() ?? []`),漏看了 SDK 的 `harness/tools` 模块。

复查确认:**Pi SDK 内置了 4 个官方工具**,位于 `@earendil-works/pi-agent-core` 的 `harness/tools/`,顶层已导出(`export * from "./harness/tools/index.ts"`):

| 工厂函数 | 工具名 | 作用 |
|---|---|---|
| `createReadTool()` | `read` | 读文件 |
| `createWriteTool()` | `write` | 写文件(自动建父目录) |
| `createEditTool()` | `edit` | 精确文本替换改文件 |
| `createBashTool()` | `bash` | 执行 shell 命令 |

## Decision

**弃用自定义 `write_file`,改用 Pi 官方的 `read` / `write` / `edit` / `bash` 四个工具。**

## Consequences

- agent 从"只能写"升级为"读 / 写 / 改 / 执行命令"的完整编码能力,与上游给 Claude Code 的 Read/Write/Edit/Bash 对齐。
- 原 `write_file` 的两个附带职责迁移,不绑在写工具里:
  - **轮数硬闸门** → 上移到循环层(统计 write/edit 次数,超限即拒绝),见 `agent.mjs`。
  - **反 AI 味 lint** → 独立成"写后校验"步骤(见 [0002](0002-deterministic-anti-slop-lint.md)),在 save 时跑,而非塞进写工具。
- 官方工具依赖 `ExecutionEnv`(提供 `writeFile` / `readFile` / `shell` / `cwd`),需正确装配;cwd 设为项目根(`output/` 可写)。
