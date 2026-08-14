# Architecture Decision Records (ADR)

本目录记录 `pure-design` 的架构决策。核心背景:从上游 [open-design](https://github.com/nexu-io/open-design) 提取"纯粹设计"能力,砍掉 Electron/鉴权/云服务等外围设施。

另见 [glossary.md](glossary.md) —— 我们约定的共同语言(专有名词表)。

## 决策索引

| 编号 | 标题 | 状态 |
|---|---|---|
| [0000](0000-extraction-architecture.md) | 提取式架构:资产 + 内置 Pi agent 基座 | ✅ 已实现 |
| [0001](0001-clarification-via-grilling-skill.md) | 澄清需求改用 `grilling` skill,不用 discovery.ts | ✅ 已实现(CLI) |
| [0002](0002-deterministic-anti-slop-lint.md) | 增加确定性反 AI 味 lint(程序检测,非 LLM) | ✅ 已实现 |
| [0003](0003-deliverable-validation-and-artifact-management.md) | 增加交付校验 + 工件管理(含语义文件名) | ✅ 已实现 |
| [0004](0004-use-pi-official-tools.md) | 用 Pi 官方 read/write/edit/bash 工具,弃用自定义 write_file | ✅ 已实现 |
| [0005](0005-directions-library.md) | 增加方向库(directions library) | ✅ 已实现 |
| [0006](0006-cli-tui-markdown-rendering.md) | CLI TUI 渲染:轻量 Markdown 渲染,不引入 Ink | ✅ 已实现 |

## 讨论已收敛

此前列为"待讨论"的三项均已定案:

- **方向库** → 要([0005](0005-directions-library.md))
- **语义文件名** → 要([0003](0003-deliverable-validation-and-artifact-management.md))
- **`write_file` 范围** → 弃用自定义工具,改用官方工具([0004](0004-use-pi-official-tools.md))

详细对照见 `docs/pipeline-comparison.md`。
