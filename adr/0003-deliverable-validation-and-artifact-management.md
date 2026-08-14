# 0003. 增加交付校验 + 工件管理

- **状态**:✅ Accepted(已实现)
- **日期**:2026-08-13

## Context

上游第 6、7 步:

- **交付校验**(`run-deliverable-validation.ts`):run 结束后验证产物真实有效 —— entry 文件存在、本次 run 确实改过它、类型匹配;另有 `run-retry-policy.ts` 对瞬时失败(如 429)自动重试一次。
- **工件管理**:每个产物有 manifest、语义文件名(`pricing-page.html`)、版本化(重大改动留 `landing-v2.html`)、以及 Inspect/Picker 依赖的 `data-od-id` 锚点。

我们目前:agent 跑完不校验文件是否完整/截断,永远覆盖写 `output/index.html`,历史被冲掉。

## Decision

这两步**都加**:

1. **交付校验**:`runAgent` 收尾时验证输出文件(存在 + `<!doctype html>` 开头 + `</html>` 结尾 + 体积合理),不合规标红;API 层对瞬时失败做一次重试。
2. **工件管理**:产物用语义文件名(从 brief 派生),保留历史版本,`data-od-id` 已在 OUTPUT_CONTRACT 里保留。

具体"检查了什么、怎么检查"的实现细节,先研读上游 567 三步的确切逻辑再定,但不影响"都要加"这个结论。

## Consequences

- 输出从"一次覆盖"变成"可追溯、可校验、可回看"。
- 校验是确定性程序,补上"agent 可能输出半截 HTML"的兜底。
- 工件管理保持最小化 —— **不做**上游完整的 project/SQLite/manifest 模型,只做语义命名 + 版本保留。
