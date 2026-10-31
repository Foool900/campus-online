// 本地 Ollama 客户端：Node 22 内置 fetch 直调 HTTP API，零第三方依赖。
// 调用期使用 globalThis.fetch（而非 import 时绑定），便于测试里 stub。
// env 在模块加载时读取（项目无 dotenv，沿用 process.env.X || default 惯例）。

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
export const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:1.5b';
export const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

async function fetchJson(path, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await globalThis.fetch(`${OLLAMA_URL}${path}`, {
      ...options,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ollama ${res.status} ${path}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 探测 Ollama 是否在线（异常一律 false）
export async function checkOllama(timeoutMs = 1500) {
  try {
    await fetchJson('/api/tags', { method: 'GET' }, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

// 批量向量化；失败返回 null。优先新接口 /api/embed，404/400 回退旧接口 /api/embeddings（逐条）。
export async function embedTexts(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  try {
    const data = await fetchJson(
      '/api/embed',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: texts }),
      },
      30000
    );
    if (Array.isArray(data?.embeddings) && data.embeddings.length === texts.length) {
      return data.embeddings;
    }
    throw new Error('embed 响应格式异常');
  } catch (e) {
    // 旧接口回退
    try {
      const out = [];
      for (const t of texts) {
        const one = await fetchJson(
          '/api/embeddings',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: t }),
          },
          30000
        );
        if (!Array.isArray(one?.embedding)) throw new Error('embeddings 响应格式异常');
        out.push(one.embedding);
      }
      return out;
    } catch {
      return null;
    }
  }
}

// 单次生成（内部实现，不直接导出）
async function generateOnce(prompt, system) {
  try {
    const data = await fetchJson(
      '/api/generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_CHAT_MODEL, prompt, system, stream: false }),
      },
      60000
    );
    if (typeof data?.response !== 'string') return null;
    return data.response;
  } catch {
    return null;
  }
}

// 生成串行化：1 核 / 2G 下并发两个 1.5B 生成可能 OOM，强制排队。
let genQueue = Promise.resolve();
export function generate(prompt, system) {
  const next = genQueue.then(() => generateOnce(prompt, system), () => generateOnce(prompt, system));
  genQueue = next.then(
    () => {},
    () => {}
  );
  return next;
}
