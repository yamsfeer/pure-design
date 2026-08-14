# 术语表(共同语言)

本文件记录我们讨论中约定下来的专有名词。以后沟通用这些词,不再每次临时定义。

> 依 `grill-with-docs` skill 的精神:讨论收敛后,把关键术语沉淀成共同语言。

## 七步管线(核心流程的共同语言)

把"从提示词到 HTML"的整条流程定成七个步骤,每个步骤一个固定称呼:

| 序号 | 术语 | 英文 | 一句话定义 |
|---|---|---|---|
| 1 | **澄清** | Clarify | 生成前追问需求(平台/受众/调性/品牌),用 grilling skill |
| 2 | **装配** | Assemble | 把资产拼成系统提示词(buildSystemPrompt) |
| 3 | **基座** | Runtime | 内置 Pi agent 引擎 |
| 4 | **执行** | Execute | agent 用 read/write/edit/bash 干活 |
| 5 | **自检** | Lint | 确定性反 AI 味检查(程序检测,非 LLM) |
| 6 | **校验** | Validate | 交付校验(文件完整 + 瞬时失败重试) |
| 7 | **归档** | Archive | 工件管理(语义命名 + 版本保留) |

顺口溜:**澄清 → 装配 → 基座 → 执行 → 自检 → 校验 → 归档**。

## 资产五类(assets)

| 术语 | 目录 | 是什么 |
|---|---|---|
| **技能** | `assets/skills/` | "怎么做"的方法论,一个 SKILL.md(如 frontend-design) |
| **设计系统** | `assets/design-systems/` | "用什么品牌语言",DESIGN.md + tokens |
| **模板** | `assets/design-templates/` | "页面怎么拼",SKILL.md + 种子 + 区块库 + 自检清单 |
| **工艺** | `assets/craft/` | 质量底线规则(如 anti-ai-slop) |
| **提示词模板** | `assets/prompt-templates/` | image/video 场景的 JSON |

## 关键术语

- **种子模板(seed)**:模板里的 `template.html`,页面骨架 + `:root` CSS 变量体系 + class 系统。
- **区块库(layouts)**:`layouts.md`,现成的区块骨架,agent 从中选、不凭空造。
- **自检清单(checklist)**:`checklist.md`,P0/P1/P2 三级交付前自检。
- **输出契约(output contract)**:OUTPUT_CONTRACT,单文件 / 内联 CSS / `:root` 映射 / `data-od-id` / 不编造数据。
- **反 AI 味(anti-AI-slop)**:拒绝 AI 味设计(紫蓝渐变、emoji 图标、编造指标、lorem)。
- **确定性自检(deterministic lint)**:程序(grep)检测,而非 LLM 自评 —— 第 5 步"自检"的本质。
- **方向库(directions library)**:美学方向菜单,第 2 步"装配"的可选输入。
- **上游(upstream)**:原始 open-design 仓库,只读参考。
- **提取(extraction)**:我们的总原则 —— "提取而非重构",资产完整拷贝、工具是薄层。
- **内置基座(embedded runtime)**:把 Pi 作为 npm 依赖内嵌,而非外部 CLI。
- **官方工具(official tools)**:Pi SDK 内置的 read/write/edit/bash 四工具(见 ADR-0004)。
