// 知识库 RAG 核心：静态文档 + 精华帖 → 分块 → 向量化 → 内存余弦检索 → grounded 回答。
// 纯函数（splitText / cosineSimilarity / buildPrompt）与带 IO 的函数分离，便于测试。

import { db, nowIso } from './db.js';
import { checkOllama, embedTexts, generate } from './ollama.js';
import { searchWeb } from './web.js';

// 精华帖在检索时的加权（叠加到余弦相似度上，让精华帖更靠前）
const FEATURED_BOOST = 0.1;

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

function normalize(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 文本分块：滑动窗口切出 ≤ maxLen 的块，块间带 overlap 重叠；优先在句读处断开避免切碎句子。
export function splitText(text, { maxLen = 400, overlap = 60 } = {}) {
  const src = normalize(text);
  if (!src) return [];
  if (src.length <= maxLen) return [src];

  const terminators = ['。', '！', '？', '；', '!', '?', ';'];
  const chunks = [];
  let start = 0;
  while (start < src.length) {
    let end = Math.min(start + maxLen, src.length);
    if (end < src.length) {
      // 在当前窗口内找最后一个句读，若足够靠后则在此断开（保留句读符）
      const window = src.slice(start, end);
      let cut = -1;
      for (const ch of terminators) cut = Math.max(cut, window.lastIndexOf(ch));
      if (cut >= Math.floor(maxLen * 0.6)) end = start + cut + 1;
    }
    const chunk = src.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= src.length) break;
    const nextStart = end - overlap;
    start = nextStart > start ? nextStart : end;
  }
  return chunks;
}

// 余弦相似度；维度不一致或空向量返回 0。
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Ala 人设 + 混合回答：社区问题只依据【社区资料】，闲聊则自然回应。
export function buildPrompt(question, hits, history = []) {
  const system = [
    '你是 Ala，校园在线里的一只可爱小助手（软萌女生，语气轻快友好，偶尔用 emoji 或颜文字，但别堆砌）。',
    '回答规则：',
    '1. 用户问社区/平台相关的问题（注册登录、任务规则、夜市玩法、重置数据库、经验金币等）时，只依据下面的【社区资料】回答，不要编造；资料里有答案就在末尾标注（来源N），资料里没有就说「这个 Ala 还不太清楚，可以问问管理员哦」。',
    '2. 用户只是打招呼或闲聊，就可爱自然地回应。',
    '3. 回答尽量简短，用中文。',
  ].join('\n');

  const parts = hits.map((h, i) => `[来源${i + 1}]《${h.title}》\n${h.text}`).join('\n\n');
  const ctx = parts ? `【社区资料】\n${parts}` : '【社区资料】\n（当前知识库暂时是空的）';
  const conv = history.length
    ? `【最近对话】\n${history.map((h) => `用户：${h.question}\nAla：${h.answer}`).join('\n')}\n\n`
    : '';

  const prompt = `${conv}${ctx}\n\n【用户消息】\n${question}`;
  return { system, prompt };
}

// 联网搜索模式的 prompt：依据网页资料回答
export function buildWebPrompt(question, webResults, history = []) {
  const system = [
    '你是 Ala，校园在线里的一只可爱小助手。用户开启了联网搜索，你可以依据下面【网页资料】回答。',
    '规则：',
    '1. 根据【网页资料】用中文简明回答，并在末尾标注引用编号（来源N）。',
    '2. 资料不足时如实说明「这部分网上资料里没找到」，不要编造。',
    '3. 回答尽量简短。',
  ].join('\n');

  const parts = webResults.map((r, i) => `[来源${i + 1}]《${r.title}》\n${r.url}\n${r.text || r.snippet}`).join('\n\n');
  const conv = history.length
    ? `【最近对话】\n${history.map((h) => `用户：${h.question}\nAla：${h.answer}`).join('\n')}\n\n`
    : '';

  const prompt = `${conv}【网页资料】\n${parts}\n\n【用户消息】\n${question}`;
  return { system, prompt };
}

// ---------------------------------------------------------------------------
// chunk 缓存
// ---------------------------------------------------------------------------

let chunkCache = null;

function safeParseVec(s) {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function invalidateChunkCache() {
  chunkCache = null;
}

export function getChunks() {
  if (chunkCache) return chunkCache;
  const rows = db
    .prepare(
      'SELECT id, source_type AS sourceType, source_ref AS sourceRef, title, chunk_index AS chunkIndex, text, boost, embedding FROM knowledge_chunks ORDER BY id ASC'
    )
    .all();
  chunkCache = rows.map((r) => ({ ...r, embedding: safeParseVec(r.embedding) }));
  return chunkCache;
}

// ---------------------------------------------------------------------------
// 索引
// ---------------------------------------------------------------------------

export async function rebuildIndex() {
  const docs = db.prepare('SELECT id, title, content FROM knowledge_docs ORDER BY id ASC').all();
  const posts = db.prepare("SELECT id, title, content, featured FROM posts WHERE status NOT IN ('draft', 'cancelled') ORDER BY id ASC").all();

  const units = [];
  for (const d of docs) {
    splitText(d.content).forEach((text, i) => units.push({ sourceType: 'doc', sourceRef: d.id, title: d.title, chunkIndex: i, text }));
  }
  for (const p of posts) {
    splitText(p.content).forEach((text, i) => units.push({ sourceType: 'post', sourceRef: p.id, title: p.title, chunkIndex: i, text, boost: p.featured ? 1 : 0 }));
  }

  if (units.length === 0) {
    db.transaction(() => db.prepare('DELETE FROM knowledge_chunks').run())();
    invalidateChunkCache();
    return { docs: docs.length, posts: posts.length, chunks: 0, embedded: 0 };
  }

  // 关键：向量化在事务之外 await（better-sqlite3 事务是同步的，不能跨 await）
  const vectors = await embedTexts(units.map((u) => u.text));
  if (!vectors) {
    invalidateChunkCache();
    return { docs: docs.length, posts: posts.length, chunks: 0, embedded: 0, error: 'Ollama 服务未启动，无法重建索引' };
  }

  const now = nowIso();
  db.transaction(() => {
    db.prepare('DELETE FROM knowledge_chunks').run();
    const ins = db.prepare(
      'INSERT INTO knowledge_chunks (source_type, source_ref, title, chunk_index, text, boost, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    units.forEach((u, i) => ins.run(u.sourceType, u.sourceRef, u.title, u.chunkIndex, u.text, u.boost || 0, JSON.stringify(vectors[i]), now));
  })();
  invalidateChunkCache();
  return { docs: docs.length, posts: posts.length, chunks: units.length, embedded: units.length };
}

export async function upsertPostChunks(postId) {
  const post = db.prepare('SELECT id, title, content, featured FROM posts WHERE id = ?').get(postId);
  if (!post) return { chunks: 0, error: '活动不存在' };
  const texts = splitText(post.content);
  if (texts.length === 0) {
    deletePostChunks(postId);
    return { chunks: 0 };
  }
  const vectors = await embedTexts(texts);
  if (!vectors) return { chunks: 0, error: 'Ollama 服务未启动，索引未更新' };
  const now = nowIso();
  db.transaction(() => {
    db.prepare("DELETE FROM knowledge_chunks WHERE source_type = 'post' AND source_ref = ?").run(postId);
    const ins = db.prepare(
      'INSERT INTO knowledge_chunks (source_type, source_ref, title, chunk_index, text, boost, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    texts.forEach((t, i) => ins.run('post', postId, post.title, i, t, post.featured ? 1 : 0, JSON.stringify(vectors[i]), now));
  })();
  invalidateChunkCache();
  return { chunks: texts.length };
}

export function deletePostChunks(postId) {
  db.prepare("DELETE FROM knowledge_chunks WHERE source_type = 'post' AND source_ref = ?").run(postId);
  invalidateChunkCache();
}

// ---------------------------------------------------------------------------
// 检索 + 回答
// ---------------------------------------------------------------------------

export async function search(query, topK = 5) {
  const vecs = await embedTexts([query]);
  if (!vecs || !vecs[0]) return [];
  const qv = vecs[0];
  const scored = getChunks()
    .filter((c) => c.embedding)
    .map((c) => ({ ...c, score: cosineSimilarity(qv, c.embedding) + (c.boost ? FEATURED_BOOST : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored;
}

function dedupeSources(hits) {
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const key = `${h.sourceType}:${h.sourceRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: h.title,
      snippet: (h.text || '').slice(0, 120),
      sourceType: h.sourceType,
      sourceRef: h.sourceRef,
    });
  }
  return out;
}

export async function answer(question, history = [], options = {}) {
  if (!(await checkOllama(1500))) {
    return {
      answer: 'Ala 暂时连不上本地模型（Ollama 未启动）。请确认 Ollama 服务已运行，稍后再试。',
      sources: [],
      ollamaUp: false,
      degraded: true,
      reason: 'ollama_down',
    };
  }

  // 联网搜索模式：搜 Bing + 抓正文，依据网页资料回答
  if (options.web) {
    const webResults = await searchWeb(question, { topN: 3 });
    if (webResults.length === 0) {
      return {
        answer: '我试着联网搜索了，但没搜到结果（可能网络或搜索引擎临时不可用）。换个问法试试，或关闭「联网搜索」用本地知识库。',
        sources: [],
        ollamaUp: true,
        degraded: true,
        reason: 'web_failed',
      };
    }
    const { system, prompt } = buildWebPrompt(question, webResults, history);
    const text = await generate(prompt, system);
    if (text === null) {
      return { answer: 'Ala 服务未启动。请稍后再试。', sources: [], ollamaUp: false, degraded: true, reason: 'generate_failed' };
    }
    return {
      answer: text.trim(),
      sources: webResults.map((r) => ({ title: r.title, snippet: r.snippet || (r.text || '').slice(0, 120), sourceType: 'web', url: r.url })),
      ollamaUp: true,
      degraded: false,
    };
  }

  // 本地知识库模式
  const hits = await search(question, 5);
  const { system, prompt } = buildPrompt(question, hits, history);
  const text = await generate(prompt, system);
  if (text === null) {
    return { answer: 'Ala 服务未启动。请稍后再试。', sources: [], ollamaUp: false, degraded: true, reason: 'generate_failed' };
  }
  return { answer: text.trim(), sources: dedupeSources(hits), ollamaUp: true, degraded: false };
}

export async function getStatus() {
  return {
    ollamaUp: await checkOllama(1500),
    chunks: db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks').get().c,
    docs: db.prepare('SELECT COUNT(*) AS c FROM knowledge_docs').get().c,
    posts: db.prepare("SELECT COUNT(*) AS c FROM posts WHERE status NOT IN ('draft', 'cancelled')").get().c,
  };
}
