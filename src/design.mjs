/**
 * src/design.mjs — 单次快速生成业务层（CLI 入口在 bin/pure-design.mjs）
 * 一次 API 调用 → 一个 HTML，不做 agent 迭代。
 * 更推荐的 agent 版见 src/agent.mjs。
 *
 * 导出: ask / extractHtml / looksLikeHtml / defaultModel（供 bin/ 调用）
 */
/* ─── HTML 提取（健壮版：容忍缺闭合围栏、散文前缀、多围栏） ─────────────── */
export function extractHtml(text) {
  let block = text;
  const fence = text.match(/```(?:html)?\s*\n([\s\S]*?)(?:```|$)/i);
  if (fence) block = fence[1];

  const start = block.search(/<!doctype\s+html|<html[\s>]/i);
  const end = block.lastIndexOf('</html>');
  if (start !== -1 && end !== -1) return block.slice(start, end + 7).trim();
  if (start !== -1) return block.slice(start).trim();

  const artifact = block.match(/<artifact[\s\S]*?>([\s\S]*?)<\/artifact>/i);
  if (artifact) return artifact[1].trim();

  return block.trim();
}

export function looksLikeHtml(s) {
  return /<!doctype html|<html|<\/html>|<style/i.test(s);
}

export function defaultModel(base) {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
  return base.includes('deepseek') ? 'deepseek-chat' : 'claude-sonnet-5';
}

export async function ask({ base, apiKey, authToken, model, maxTokens, system, prompt }) {
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`请求失败 (${res.status}):\n${body.slice(0, 2000)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
