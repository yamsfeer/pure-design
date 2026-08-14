# 0002. 增加确定性反 AI 味 lint(程序检测,非 LLM)

- **状态**:✅ Accepted(已实现)
- **日期**:2026-08-13

## Context

上游第 5 步"确定性自检"由 `apps/daemon/src/lint-artifact.ts` 实现:一个 **grep 式、确定性** 的检查器(不解析 HTML,容忍误报),对生成的 HTML 跑 P0/P1/P2 三级规则,命中 P0 就带 snippet **回喂给 agent 让它自纠**。

关键点:**由程序检测,而不是由 LLM 检测**。P0 规则是硬闸门:紫色/靛蓝 hex(Tailwind 默认)、蓝→青"trust gradient"、emoji 当图标、无衬线当标题、编造指标、lorem 填充。

我们目前只有 `agent.mjs` 里"模型对着 checklist.md 自审",是 LLM 判断,模型经常自认通过、不可靠。

## Decision

**照搬上游 `lint-artifact.ts` 的设计**,做一个确定性的 lint 模块(如 `src/lint.mjs`):

- 纯字符串/grep 匹配,P0/P1/P2 三级。
- 作为**独立的写后校验步骤**:agent 每次写/改文件后(官方 `write`/`edit` 工具落盘),跑 lint → 把命中的 P0(带 snippet)喂回模型,逼它重写。与上游一致,在 save 时跑,而非塞进写工具。
- 规则先照搬,有需要以后改。

## Consequences

- **反 AI 味从"靠自觉"变成"靠闸门"**,零模型成本(纯字符串)。
- lint 独立于写工具:第 4 步"执行"用官方工具(见 [0004](0004-use-pi-official-tools.md)),lint 是第 5 步"自检"的写后校验,二者解耦。
- 需要权衡误报:lint 是 greppy 的、不解析 HTML,false positive 可容忍,每条带 snippet 供 agent 自行核对(与上游一致)。
- 新增一个纯函数模块,易测试。
