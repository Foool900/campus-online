// 通用 OpenAI 兼容聊天客户端（/chat/completions），供「用户自带模型」使用。
// 兼容 DeepSeek / 通义千问（百炼）/ Kimi / 智谱 / OpenAI 等几乎所有 OpenAI 格式云模型。
// 调用期使用 globalThis.fetch，便于测试 stub。

async function fetchWithTimeout(url, options = {}, ms = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await globalThis.fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// messages: [{ role: 'system' | 'user', content }]
export async function chatCompletion({ baseUrl, apiKey, model, messages }, timeoutMs = 60000) {
  if (!baseUrl || !apiKey || !model) return null;
  try {
    const url = String(baseUrl).replace(/\/+$/, '') + '/chat/completions';
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, stream: false }),
      },
      timeoutMs
    );
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  }
}
