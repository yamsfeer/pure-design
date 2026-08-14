# 0001. 澄清需求改用 `grilling` skill,不用 discovery.ts

- **状态**:✅ Accepted(已实现)
- **日期**:2026-08-13

## Context

上游第 1 步"澄清需求"由 `apps/daemon/src/prompts/discovery.ts` 实现:它把一段指令拼进系统提示词,让 agent 在信息不足时输出 `<question-form>` 块(问目标平台 / 受众 / 调性 / 品牌 / 规模 / 约束),由宿主 UI 解析成表单。规则是"**只在信息不足会影响结果时才问,否则直接干**"。

我们目前 `pure-design "prompt"` 直接开跑,没有澄清这一步。

## Decision

**加上澄清步骤,目的与上游一致**(让使用者想清楚要设计什么:平台、受众、调性、品牌等),但**实现不用 `discovery.ts` 的表单机制**,改用 AI 提问,复用已安装的 **`grilling` skill**(`~/.agents/skills/grilling/`)。

`grilling` 的机制:逐条追问、每条给出推荐答案、一次只问一个、走完决策树、事实自己查(不烦用户)、决定交给用户、直到达成共识才动手。

## Consequences

- **无需实现表单解析基础设施** —— 澄清变成对话式,天然适配 CLI 和 Web 界面(SSE 逐条显示问题)。
- **交互节奏由 skill 控制**:一次一问,避免一次抛一堆问题把人问懵。
- 需要把 `grilling` 的追问逻辑接进 agent 循环前的"澄清判定"环节(信息够就跳过,直接进入设计)。
- 与上游 `<question-form>` 的结构化表单不同,我们的澄清是自由对话,产物(平台/受众/调性/品牌)需要额外收敛成结构化字段喂给后面的系统提示词装配。

## 实现(2026-08-13)

`src/agent.mjs` 的 `createSession({ clarify: true })`:grilling 指令注入系统提示词最前(澄清优先),**单一 agent 从澄清问到设计贯穿到底**。`send(msg)` 每轮一问一答,用"是否 write 了文件"区分澄清(`awaiting-input`)与设计(`done`)。CLI 交互壳用 readline;一次性路径 `runAgent`(server.mjs 用)默认 `clarify:false` 保持直接设计。多轮澄清已端到端验证。
