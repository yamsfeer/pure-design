# pure-open-design

极简的 **UI 设计 agent**：提示词 → 一个自包含 HTML。核心是把开源项目 [open-design](https://github.com/nexu-io/open-design) 的设计资产（**162 个技能、151 个设计系统、114 个模板、13 个工艺参考、106 个提示词模板**）完整提取出来，再用 **Pi 的 SDK 作为内置 agent 基座**去驱动它们——没有登录、没有云服务、没有桌面端。

> 为什么内置 Pi？Pi 只是一个 agent 引擎（`@earendil-works/pi-agent-core`）。把它作为依赖装进项目，别人 clone 后 `pnpm install` 就能跑，**不需要在本机安装 Pi**。系统提示词是我们从资产库拼的，技能是资产库里的，Pi 只负责"循环直到满意"。

## 它是怎么工作的

```
你的提示词
    │
    ▼
┌─ 内置 Pi agent（src/agent.mjs）──────────────────────┐
│  系统提示词 = frontend-design 技能 + 选定的设计系统    │
│             + 工艺参考 + 渲染模板契约 + 输出契约       │
│  agent 原生循环：                                    │
│    设计 → write_file → 按自检清单自审                │
│    → 不满足就重写 → 直到满意 → 输出总结               │
└─────────────────────────────────────────────────────┘
    │ write_file
    ▼
output/xxx.html（自包含，零外部资源）
    │
    ▼
Web 界面（src/server.mjs，8745 端口）+ SSH 端口转发 → 本地浏览器
```

agent 不是"一次生成"，而是**迭代直到合格**：写一版 → 对照自检清单逐条审查 → 有问题就重写 → 满意才停。默认最多 6 轮。

## 快速开始

```bash
pnpm install        # 拉取内置 Pi SDK（仅此一步依赖）

# 方式一：Web 界面（推荐）
pnpm pure-design preview   # 浏览器 http://127.0.0.1:8745/ 输入需求 → 实时看 agent 迭代 → 预览

# 方式二：命令行（服务器上直接跑）
pnpm pure-design "给独立开发者的极简记账 App 首页，主打本月支出与预算进度"
# 内部流程：AI 决策（任务类型/设计系统/方向/skill，模糊才问）→ 装配确认（Enter 或改）
#           → agent 迭代设计（grilling 澄清）
pnpm pure-design --yes "…"               # 跳过装配确认，脚本/批量场景
pnpm pure-design "…" --system stripe     # 指定设计系统（其余 AI 决策）
pnpm pure-design "…" --max-rounds 4      # 控制迭代上限
pnpm pure-design "…" -o out/landing.html # 指定输出位置

# 方式三：单次快速生成（不做 agent 循环）
pnpm pure-design fast "…" [-s 系统] [-t 模板]
```

> 命令名是 `pure-design`（CLI 入口 `bin/pure-design.mjs`，基于 commander）。项目内用 `pnpm pure-design`；想全局用，在项目目录执行 `pnpm link --global` 后任意位置直接敲 `pure-design`。

> **输出位置**：默认写到**执行命令的当前目录**，文件名从需求自动派生语义名（中英文混排，如 `极简记账-app-首页.html`），已存在自动 `+v2`/`+v3`。`-o, --out` 可指定路径（相对当前目录或绝对路径）。

## 命令参考

```
pure-design "设计需求" [选项]    内置 Pi agent 迭代设计（默认，推荐）
pure-design fast "设计需求" [选项] 单次快速生成
pure-design preview [端口]      启动 Web 界面 + 预览（默认 8745）
pure-design tunnel              打印 SSH 端口转发命令
pure-design --list              列出全部设计系统（151 个）
pure-design --list-templates    列出全部模板（114 个）
pure-design --list-directions   列出全部视觉方向（5 个）

选项（默认路径 = AI 自主决策）:
  -s, --system <name>    指定设计系统（默认 AI 决策，default 兜底）
  -t, --template <name>  指定模板（默认 AI 按任务类型选）
  -d, --direction <name> 指定视觉方向（默认 AI 从 5 个 school 自选）
  -o, --out <path>       输出路径（默认当前目录的语义文件名，已存在自动 +v2）
  -f, --file <path>      从文件读取提示词
      --yes              跳过装配确认，直接开始设计
      --max-rounds <N>   agent 迭代轮数上限（默认 6）
      --taste            追加反 AI 味审美技能
  -m, --model <id>       模型（agent 默认 deepseek-v4-flash；fast 默认 claude-sonnet-5）
      --max-tokens <n>   最大输出 token（仅 fast，默认 16000）
      --refine           自审 + 精修循环（仅 fast）
```

> **决策阶段**（纯 `pure-design "需求"` 时）：AI 先推断任务类型（web/dashboard/mobile/deck/editorial/brand），
> 选择视觉方向（5 个 school 自选）与 skill（按任务类型预筛后 AI 选），设计系统默认 default
> （需求提到品牌时 AI 识别匹配）。信息不足时 AI 逐条追问（带推荐答案）。决策后展示装配清单，
> 按 Enter 确认或输入修改项（如 `方向 editorial`）；`--yes` 跳过。

## 环境变量

| 变量 | 作用 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek key（缺省时自动读 `~/.pi/agent/auth.json` 的 `deepseek.key`） |
| `PURE_DESIGN_PORT` | Web/预览端口（默认 8745） |
| `PURE_DESIGN_HOST` | 监听地址（默认 127.0.0.1，SSH 转发访问，勿开 0.0.0.0） |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | 仅单次路径 `fast` 需要 |

## 目录结构

```
pure-open-design/
├── bin/
│   └── pure-design.mjs  唯一 CLI 入口（agent / fast / preview / tunnel / --list…）
├── src/                 业务层（CLI 由 bin/ 调用）
│   ├── agent.mjs        内置 Pi 设计 agent（SDK 基座 + agent 循环 + write_file 工具）
│   ├── router.mjs       决策阶段（任务类型/方向/skill 选型 + 澄清，见 docs/upstream-information-flow.md）
│   ├── design.mjs       单次快速生成（fast 路径业务函数）
│   ├── lint.mjs         反 AI 味 lint（写后校验，见 adr/0002）
│   ├── prompt.mjs       从 assets/ 拼装系统提示词（共享）
│   └── server.mjs       极简 Web 界面 + 画廊 + SSE 进度 + 预览
├── assets/              完整提取的资产库（82M，独立资产，与项目命名无关）
│   ├── skills/          162 个技能（frontend-design、taste-skill、gsap-* …）
│   ├── design-systems/  151 个设计系统（DESIGN.md 品牌契约 + tokens）
│   ├── design-templates/ 114 个渲染模板
│   ├── craft/           13 个工艺参考
│   └── prompt-templates/ 106 个提示词模板
├── output/              Web 界面画廊 + 预览的默认目录（CLI 默认输出到当前目录）
├── scripts/pure-design-remote  本地一键脚本（转发 + 远端生成 + 开浏览器）
└── package.json         依赖仅 pi-agent-core + pi-ai + commander + marked
```

## Web 界面

`pnpm pure-design preview` 起一个页面（风格参考 open-design，暖底衬线、单一强调色、极简）：
- 一个输入框写需求，选设计系统/模板，点「开始设计」
- **实时 SSE 进度**：看到 agent 每一轮的写入
- 完成后给预览链接 + agent 的设计总结
- 另有 `/gallery` 历史画廊，列出所有生成过的页面

## 加自己的设计系统

建 `assets/design-systems/你的品牌/DESIGN.md`，按现有格式写配色/字体/间距/组件，然后 `--system 你的品牌`。

## 与上游的关系

- **不是重构，是提取**：设计资产完整拷到 `assets/`（82M）；工具是覆盖其上的薄层。
- 舍弃的是外围设施：登录/鉴权、网页应用（上游那个大的）、桌面端、守护进程、MCP、插件市场。
- 多了一个内置 agent 基座（Pi SDK，~几十 MB node_modules），换来"迭代直到满意"而不引入外部依赖。
- `upstream/` 是下载的原仓库，只读参考，保留供对照上游实现。

## 备注

- agent 的迭代靠 DeepSeek 推理 + 自检清单驱动，慢但质优（单轮约 30s~2min，完整一轮 1~5min）。
- 换更强的模型：`--model deepseek-v4-pro`；本地想更省：`--model deepseek-v4-flash`。
- 输出默认在**执行目录**，语义命名自动 +v2/+v3；`-o` 指定任意位置。
