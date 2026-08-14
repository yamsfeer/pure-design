# 0007. 增加决策阶段（router）：任务类型 / 设计系统 / 方向 / skill 选型

- **状态**: ✅ Accepted(已实现)
- **日期**: 2026-08-14

## Context

此前 `pure-design "需求"` 直接进入设计：系统提示词固定拼装 `frontend-design` skill + `default` 设计系统 + `web-prototype` 模板 + 固定 craft。用户需求（prompt）不参与资产选择——151 个设计系统、162 个 skill 中只有 1 个 skill + 1 个 DS 被选中，其余全部闲置。用户若不懂 `-s/-t/-d` 参数，只能拿到固定搭配，不符合"资产驱动的设计 agent"定位。

上游 open-design 的分层选择机制（见 docs/upstream-information-flow.md）：
- **配置层**：用户 UI 绑定设计系统 / skill（对话之前）
- **路由层**：`od-default` skill 让 AI 从 brief 推断任务类型，模糊才问（带推荐值）
- **澄清层**：`<question-form>` 表单（≤5 问，带默认值）
- **自选层**：无品牌时 AI 从方向库（5 schools）自选，不询问

## Decision

给 CLI 主路径增加一个**决策阶段**（`src/router.mjs`），在设计与澄清之前运行：

1. **任务类型**（od-default 思想）：AI 从 brief 推断 6 类（web / dashboard / mobile / deck / editorial / brand），每类预置模板与 skill 候选；模糊且选错会改变交付格式 → 问用户（一次一问，带推荐值）。
2. **设计系统**（品牌由人定）：默认 `default`，除非需求明确提到品牌（如 stripe）→ 从 151 个 DS 索引（name + Category + 一句话描述）匹配；DS 索引运行时从 DESIGN.md 提取，不写死。
3. **视觉方向**（AI 自选）：从 `assets/directions/` 5 个 school（Mood 一句话 + 参考品牌）自选，不询问（对齐上游 Branch B "pick without asking"）。
4. **skill 两级选择**：第一级程序按 taskType 预筛候选（3-6 个），第二级 AI 从候选里选一个（对齐"用户不需要管 skill"的理念）。skill 索引用 name + description + triggers。
5. **grilling 澄清**：①②③ 后仍缺会实质改变结果的信息（受众/规模/硬约束）时逐条追问，一次一问带推荐答案。

决策输出 `<decision>JSON</decision>` 块（taskType / designSystem / direction / skill / template / reason）。

**装配确认**：决策后展示装配清单（引擎/模型/skills/DS/模板/方向/craft/附加），用户按 Enter 确认、输入修改项（重新决策）、或 `--yes` 跳过；非 TTY 自动跳过。

**fast 路径与 server 路径不受影响**：fast 保持显式参数单次生成；server 走 `runAgent` 简单路径（不触发 router）。

## Consequences

- CLI 主路径从"固定搭配"变为"AI 决策 + 用户确认"，资产真正被使用。
- 多一次轻量 API 调用（决策阶段，通常 1 轮）。
- skill 注入从固定 frontend-design 变为决策结果（`buildSystemPrompt({ skill })`）。
- 品牌误判风险通过"默认 default + 仅需求明确提品牌才匹配"控制。
- `-s/-t/-d` 参数仍是硬覆盖：用户显式指定时决策阶段尊重（designSystem 传参默认值）。

## 待办（后续）

- skill 候选表（TASK_TYPES.skills）目前为手写精选，可考虑从 SKILL.md frontmatter 的 triggers/category 自动生成。
- 决策阶段暂用 DeepSeek 直连（OpenAI 兼容），后续可切换到 Pi SDK 统一。
- 装配确认的"修改项"目前是拼进 prompt 重新决策，后续可做结构化覆盖（如 `方向 editorial` 直接改字段）。
