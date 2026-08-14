# 上游 open-design 的信息收集流程（完整梳理）

> 用途：pure-design 在重新设计交互方式之前，先精确记录上游 open-design 在「开始设计之前」收集了哪些信息、按什么顺序、由谁决定（用户 / AI / 路由）。基于 `upstream/` 源码分析，非猜测。
>
> 分析对象：`apps/daemon/src/prompts/system.ts`（提示词拼装器）、`discovery.ts`（澄清与分支规则）、`directions.ts`（方向库）、`plugins/_official/scenarios/od-default/SKILL.md`（默认路由）、`apps/daemon/src/server.ts`（designSystemId 解析）。

---

## 一句话概括

**上游把「选择」分成三层，由不同角色决定：**

| 层 | 谁决定 | 收集什么 | 时机 |
|---|---|---|---|
| 配置层 | **用户**（UI 操作） | 设计系统（品牌）、skill、起点模板 | 对话之前，项目创建时 |
| 路由层 | **AI 推断**（od-default skill），模糊时才问用户 | 任务类型（prototype / deck / image / …） | 用户发出 brief 后、澄清前 |
| 澄清层 | **AI 提问**（question-form，带推荐默认值） | 产出形态 / 受众 / 视觉调性 / 品牌上下文 / 规模 | 信息不足且影响结果时 |
| 自选层 | **AI 自主**（不询问） | 视觉方向（从方向库选）| 用户没绑品牌、没给方向时兜底 |

---

## 完整流程（按顺序）

```
┌─ 阶段 0：配置层（UI，对话之前）──────────────────────────────┐
│  用户新建项目：                                              │
│    · 选起点模板（rails：从 design-templates 目录挑）           │
│    · 绑定设计系统（composer 品牌选择器）                       │
│      → 写入项目元数据 designSystemId                          │
│    · 绑定 skill（Integrations → Skills 界面）                 │
│      → 成为 "Active skill"，SKILL.md 注入系统提示词            │
│    · 未绑定 skill → 自动挂默认路由 od-default（隐藏 scenario） │
└──────────────────────────────────────────────────────────────┘
              │
              ▼
┌─ 阶段 1：用户发 brief（自由文本 Home prompt）────────────────┐
└──────────────────────────────────────────────────────────────┘
              │
              ▼
┌─ 阶段 2：路由层（od-default，RULE 0）────────────────────────┐
│  AI 从 brief 推断任务类型（8 类）：                           │
│    prototype / live_artifact / slide_deck / image / video    │
│    / hyperframes / audio / other                             │
│  推断清晰 → 直接绑定该路由，进入对应工作流，不发表单           │
│  两条以上路由都说得通且选错会改变交付格式 →                   │
│    发 <question-form id="task-type">（单选，带推荐默认值）     │
│    用户提交 [form answers — task-type] → 绑定路由             │
│  选定路由后 → 不再自动追加 discovery 表单                      │
└──────────────────────────────────────────────────────────────┘
              │
              ▼
┌─ 阶段 3：澄清层（RULE 1）────────────────────────────────────┐
│  只有当「未解决的信息会实质改变设计方向/内容结构/交付格式」时： │
│  发 <question-form id="discovery">（上限 5 问）：             │
│    · output    做什么？（deck / web prototype / app /        │
│                 dashboard / editorial）                      │
│    · audience  给谁？（受众）                                 │
│    · tone      视觉调性（7 选 2）：Editorial / Modern minimal │
│                / Playful / Tech utility / Luxury / Brutalist │
│                / Human approachable                          │
│    · brand     品牌上下文（3 选 1，默认 pick_direction）：    │
│                ① Pick a direction for me（AI 代选）           │
│                ② I have a brand spec（用户给品牌规范）        │
│                ③ Match a reference site（用户给参考站点/截图）│
│    · scale     规模（如：8 页 deck / 1 落地页 + 3 子页 /      │
│                 4 个移动端屏幕）                              │
│  每个问题必须带推荐 default（用户可直接一键提交）              │
│  信息足够 → 跳过表单直接进入分支层                             │
└──────────────────────────────────────────────────────────────┘
              │
              ▼
┌─ 阶段 4：分支层（RULE 2）────────────────────────────────────┐
│  Branch A — 用户给了品牌源（brand_spec / reference_match /   │
│              brief 里自带品牌规范/URL/截图）：                 │
│    1. Locate    定位源（附件列表 / WebFetch 品牌站            │
│                  /brand /press /about）                      │
│    2. Download  抓取 CSS、品牌指南 PDF、截图                  │
│    3. Extract   从 CSS grep hex 色值、看截图判断字体          │
│                 禁止凭记忆编造颜色                            │
│    4. Codify    写 brand-spec.md：六色 OKLch 令牌             │
│                 + 字体栈 + 3~5 条布局姿态规则                 │
│    5. Vocalise  一句话复述所选系统，让用户可低成本纠正         │
│  Branch B — 无品牌源：                                       │
│    已绑设计系统 → 以 DESIGN.md 为视觉方向，绑定令牌           │
│    未绑设计系统 → AI 从方向库（5 schools）自行选择最匹配的，    │
│                  不询问用户（"pick without asking"）          │
└──────────────────────────────────────────────────────────────┘
              │
              ▼
┌─ 阶段 5：执行层（RULE 3）────────────────────────────────────┐
│  TodoWrite 计划（首工具调用）→ 读 DESIGN.md/skill 资产        │
│  → 绑定 :root 令牌 → 布局 → 填内容 → 自检 checklist           │
│  → 5 维批判 → 总结                                          │
└──────────────────────────────────────────────────────────────┘
```

---

## 信息清单（纯表格）

| # | 信息 | 谁决定 | 何时收集 | 取值/格式 | 缺失时的兜底 |
|---|---|---|---|---|---|
| 1 | 起点模板（rails） | 用户 | 阶段 0（UI） | design-templates 目录任一项 | — |
| 2 | 设计系统（品牌） | 用户 | 阶段 0（UI） | 151 个之一，存 designSystemId | 无（Branch B 走方向库） |
| 3 | skill（工作流） | 用户 | 阶段 0（UI） | Integrations 安装项 | od-default 默认路由 |
| 4 | 任务类型 | AI 推断（模糊时问） | 阶段 2 | prototype / live_artifact / slide_deck / image / video / hyperframes / audio / other | 路由模糊才发表单，否则直接绑定 |
| 5 | 产出形态（output） | 用户（表单） | 阶段 3 | deck / web prototype / app prototype / dashboard / editorial | 有推荐默认值，可一键确认 |
| 6 | 受众（audience） | 用户（表单） | 阶段 3 | 自由文本 | 同上 |
| 7 | 视觉调性（tone） | 用户（表单） | 阶段 3 | 7 调性，最多选 2 | 同上 |
| 8 | 品牌上下文（brand） | 用户（表单） | 阶段 3 | pick_direction / brand_spec / reference_match | 默认 pick_direction |
| 9 | 规模（scale） | 用户（表单） | 阶段 3 | 自由文本 | 同上 |
| 10 | 品牌资产（spec/参考） | 用户提供 → AI 提取 | 阶段 4 Branch A | CSS hex / 截图 / 指南 PDF → brand-spec.md | 无则 Branch B |
| 11 | 视觉方向 | AI 自主 | 阶段 4 Branch B | 方向库 5 schools（editorial / modern minimal / playful / tech utility / brutalist / human…） | — |

---

## 关键机制细节

### od-default：默认路由是一个 skill，不是程序

- 位置：`plugins/_official/scenarios/od-default/SKILL.md`
- frontmatter：`od: { scenario: default-router, mode: scenario }`，**隐藏项**（不进目录）
- 触发条件：用户从 Home 输入自由文本 brief，且**没有**选任何可见 category chip
- 行为：AI 推断任务类型；**只**在两条以上路由都成立且选错会改变交付格式时，发 task-type 表单（8 选 1，带推荐默认值 `defaultValue` 为 AI 推断的路由）
- 路由确定后：**禁止**紧接着再发 discovery 表单（"Do not automatically emit a second question-form after the route answer"）——路由答案本身带着全部上下文继续

### question-form：上游的澄清载体

- 是 **assistant 文本**（宿主解析渲染成 UI 表单），**不是工具调用**
- 硬性规则：
  - 表单前只允许一句短 prose（"Got it — pitch deck for a SaaS product…"），然后直接发表单
  - 每个问题必须带推荐 `default`（预填，用户可原样提交）
  - 上限 5 问；所有用户可见文案本地化，但 `id`/`value` 保持英文稳定
  - `brand` 问题的三个分支值必须恒定：`pick_direction` / `brand_spec` / `reference_match`
  - 发出后**停止本轮**，不写代码、不调工具
- 用户回复格式：`[form answers — discovery]` 或 `[form answers — task-type]`，分支规则匹配稳定 `[value: ...]` 而非本地化 label

### 方向库（directions.ts）

- 来源：蒸馏自 huashu-design 的 "5 schools × 20 philosophies"
- 双重用途：
  1. **render-time**：作为 `<question-form type="direction-cards">` 的选项，用户点选
  2. **build-time**：选中后把完整 spec（OKLch 调色 / 字体栈 / 布局姿态 / mood / 真实参考）内联进系统提示词，agent 绑定到 `:root`，**无模型即兴发挥**
- 加新方向：往 `DESIGN_DIRECTIONS` 数组追加即自动出现在选择器

### 设计系统的结构化形态（default / kami 特有）

- 部分设计系统（目前 `default`、`kami`）除 DESIGN.md 外还带 `tokens.css` + `components.manifest.json` + `USAGE.md`——daemon 把结构化 token 契约**自动追加**到系统提示词（`OD_DESIGN_TOKEN_CHANNEL=0` 可关）
- 其余品牌仍是纯 DESIGN.md 路径

### 防止过度收集

- "A missing field is an unresolved fact, **not** an instruction to ask"——字段缺失≠必须提问
- 只问「回答会实质改变你构建内容的问题」，硬上限 5 问
- 局部微调、显式 "just build"、`[form answers]` 消息一律跳过表单

---

## 对 pure-design 的启示（待讨论）

1. **上游收集的信息总量不大**（11 项），且多数有默认值——本质是「一次表单 + 一个路由判断」，不是冗长问卷
2. **三层决定权分工清晰**：品牌/模板用户定（UI 配置）、任务类型 AI 推断、方向 AI 兜底自选
3. **我们当前的差距**：配置层（-s/-t 参数替代 UI）、路由层（完全没有，固定 web-prototype）、方向自选（assets/directions 5 个文件存在但从不主动用）、澄清层（grilling 纯文本问答，无推荐默认值）
4. **交互方式选型**（终端问答 vs 未来 Web UI）另文讨论
