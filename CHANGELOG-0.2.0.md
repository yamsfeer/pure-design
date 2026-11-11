# 0.2.0 — 修好选型链路，加上真浏览器自检

这一版没有换架构，只修「明明有资产却用不上」和「模型看不到自己写出来的版面」两类问题。

## 修掉的硬伤

| 问题 | 之前 | 现在 |
|---|---|---|
| 选型入口 | CLI 仓库没有 `catalog.md`；skill 仓库有，但已过期（deck 候选里的 `html-ppt` 没有种子/参考成品） | CLI 仓库补上生成脚本与 `catalog.md`（151 设计系统 / 162 skill / 114 模板 / 5 方向 / 11 craft）；skill 仓库的 catalog 同步重新生成 |
| 候选表漂移 | `router.mjs` 与 `scripts/index.mjs` 各写一份 TASK_TYPES，模板名已经不一致（`router` 里写成 `portoflio`，生成器里是 `image-poster`） | 唯一事实源 `src/task-types.mjs`，两边都从它读；`--check` 校验每个候选都真实存在 |
| 选到不存在的模板 | 模型给出 `portoflio` 直接抛「未知模板」 | `normalizeDecision()` 逐级回退到同类型的真实模板 |
| 任务类型误判 | `/app/` 命中 `apple`，「apple 品牌页」被判成 mobile | 词边界 + 品牌判断前置（附单测） |
| 没有种子的模板 | 11 个候选模板没有 `template.html`，被静默跳过，模型只能凭空造 | 没有种子时注入 `example.html` 作参考成品 |
| 提示词自相矛盾 | DESIGN.md「以此为准」、方向「覆盖配色」、输出契约「映射 DESIGN.md 配色」三处打架 | 显式「指令优先级」段：契约 > 设计系统 > 方向 > skill/craft |
| 只看字符串 | 纯正则 lint，看不到 390px 横向溢出 / 对比度 / 触控目标 | 新增 `src/visual-check.mjs`：本机 Chromium 实测 390+1440，P0/P1 回喂 agent |
| 每轮固定开销 | 64.8K 字符（≈20k token），a11y 12.9K 全量塞入 | 56.9K 起（-12%），craft 只留 3 个短规则，长参考改成按需 read |
| fast 路径只能 Anthropic | 只有 DeepSeek key 时 `fast` 直接报错 | 自动走 DeepSeek 的 Anthropic 兼容端点 |
| 推理档位写死 high | 一轮思考 3 万字、单次生成 12 分钟还没收敛 | `--thinking low/medium/high`，默认 medium |
| 安装噪音 | `"pure-open-design": "link:"` 自引用 + workspace override | 删除；`optionalDependencies: playwright-core` |
| 合规 | 无 LICENSE / NOTICE（资产来自 Apache-2.0 的上游） | 补 `LICENSE` + `NOTICE` |
| 回归保障 | 无测试 | `node --test test/`，20 个用例（lint / 路由回退 / 装配 / 视觉自检） |

## 实测（同一 brief，deepseek-v4-flash）

| | 旧版 | 新版 |
|---|---|---|
| 墙钟 | 被杀时已 12 分钟仍未收敛 | **1 分 54 秒**，3 轮 |
| lint | 0 | 0 |
| 视觉自检 | **P0** 390px 横向溢出 + 2 处对比度 | **0** |

新版 agent 的收尾原话：「P0 横向溢出从 425px 修到 393px，再到清零——根因是页边距加上机身宽度」，
说明视觉自检的反馈确实进了循环。

## 升级后要做的两件事

```bash
pnpm install          # 拉可选依赖 playwright-core
node scripts/index.mjs   # 资产变动后重跑；改了任务类型表也要重跑
node --test test/     # 20 个用例
```

## 已知未做

- HTML → PDF/PNG/PPTX 导出（OD 有，这里还没有）
- 真实图片（当前契约仍是「单文件、零外部资源」，所以图片只能占位或内联）
- 与上游资产的自动同步脚本（目前靠手动比对 tree）
