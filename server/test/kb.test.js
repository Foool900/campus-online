import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// 必须在 import ollama.js 之前设置 env（模块加载时读取）
process.env.DB_PATH = ':memory:';
process.env.OLLAMA_URL = 'http://ollama.test';

const { db, initDb, nowIso } = await import('../db.js');
const {
  splitText,
  cosineSimilarity,
  buildPrompt,
  buildWebPrompt,
  rebuildIndex,
  search,
  answer,
  upsertPostChunks,
  deletePostChunks,
  invalidateChunkCache,
  getStatus,
} = await import('../kb.js');
const { setPostFeatured } = await import('../routes/posts.js');

initDb();

// ---------------------------------------------------------------------------
// fake Ollama（确定性，无真实网络）
// ---------------------------------------------------------------------------

function fakeVec(text, dim = 8) {
  const v = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) v[i % dim] += text.charCodeAt(i);
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function defaultFetch(url, options = {}) {
  const path = new URL(url).pathname;
  if (path === '/api/tags') return jsonResponse({ models: [] });
  if (path === '/api/embed') {
    const body = JSON.parse(options.body || '{}');
    return jsonResponse({ embeddings: (body.input || []).map((t) => fakeVec(t)) });
  }
  if (path === '/api/generate') return jsonResponse({ response: '测试回答（来源1）' });
  throw new Error('unexpected path ' + path);
}

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = defaultFetch;
  resetDb();
  setupBase();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let seq = 0;
let campusId;
let areaId;
let channelId;

function resetDb() {
  db.prepare('DELETE FROM bot_messages').run();
  db.prepare('DELETE FROM knowledge_chunks').run();
  db.prepare('DELETE FROM knowledge_docs').run();
  db.prepare('DELETE FROM posts').run();
  db.prepare('DELETE FROM messages').run();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM channels').run();
  db.prepare('DELETE FROM areas').run();
  db.prepare('DELETE FROM campuses').run();
  invalidateChunkCache();
  seq = 0;
}

function setupBase() {
  campusId = Number(db.prepare("INSERT INTO campuses (name, slug) VALUES ('测试校区', 'test-campus')").run().lastInsertRowid);
  areaId = Number(db.prepare("INSERT INTO areas (campus_id, name, slug, hidden) VALUES (?, '世界广场', 'world', 1)").run(campusId).lastInsertRowid);
  channelId = Number(db.prepare("INSERT INTO channels (area_id, name) VALUES (?, '世界频道')").run(areaId).lastInsertRowid);
}

function makeUser(nickname) {
  seq += 1;
  return Number(
    db
      .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '', '🎓', 0, 0, 0, 'admin', ?)")
      .run(nickname || `测试用户${seq}`, nowIso()).lastInsertRowid
  );
}

function makePost(title, content, featured = 0, status = 'open') {
  const uid = makeUser();
  return Number(
    db
      .prepare("INSERT INTO posts (channel_id, user_id, title, content, category, status, featured, created_at) VALUES (?, ?, ?, ?, '综合', ?, ?, ?)")
      .run(channelId, uid, title, content, status, featured, nowIso()).lastInsertRowid
  );
}

function insertDoc(code, title, content) {
  return Number(
    db
      .prepare("INSERT INTO knowledge_docs (code, title, content, category, source_ref, created_at) VALUES (?, ?, ?, 'FAQ', '', ?)")
      .run(code, title, content, nowIso()).lastInsertRowid
  );
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

test('splitText 分块 ≤ maxLen 且带 overlap', () => {
  const chunks = splitText('一二三四五六七八九十', { maxLen: 4, overlap: 1 });
  assert.deepEqual(chunks, ['一二三四', '四五六七', '七八九十']);
  for (const c of chunks) assert.ok(c.length <= 4);
});

test('splitText 尽量在句读处断开', () => {
  const chunks = splitText('一二三。四五六。七八九。', { maxLen: 8, overlap: 0 });
  assert.deepEqual(chunks, ['一二三。四五六。', '七八九。']);
});

test('cosineSimilarity 基础正确性', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1], [1, 0]), 0);
  assert.equal(cosineSimilarity(null, [1, 0]), 0);
});

test('buildPrompt 含防幻觉指令与来源标题', () => {
  const hits = [{ title: '如何重置数据库', text: '删除数据库文件即可' }];
  const { system, prompt } = buildPrompt('怎么重置？', hits);
  assert.match(system, /不要编造/);
  assert.match(prompt, /如何重置数据库/);
  assert.match(prompt, /怎么重置？/);
});

test('rebuildIndex 文档 + 全部公开帖子都产生 chunk，二次运行无重复', async () => {
  insertDoc('faq-x', '文档A', '这是文档A的内容，足够长。'.repeat(5));
  const pidA = makePost('帖子A', '这是帖子A的内容，足够长。'.repeat(5), 1);   // 精华帖
  const pidB = makePost('帖子B', '普通帖也会进知识库。'.repeat(3), 0);         // 普通公开帖
  makePost('草稿帖', '草稿不进知识库。'.repeat(3), 0, 'draft');                 // 草稿被排除

  const r1 = await rebuildIndex();
  assert.equal(r1.error, undefined);
  assert.equal(r1.docs, 1);
  assert.equal(r1.posts, 2);
  assert.ok(r1.chunks > 0);

  // 精华帖 chunk 带 boost=1，普通帖 boost=0
  const featuredBoost = db.prepare("SELECT boost FROM knowledge_chunks WHERE source_type='post' AND source_ref=? LIMIT 1").get(pidA).boost;
  const normalBoost = db.prepare("SELECT boost FROM knowledge_chunks WHERE source_type='post' AND source_ref=? LIMIT 1").get(pidB).boost;
  assert.equal(featuredBoost, 1);
  assert.equal(normalBoost, 0);

  const r2 = await rebuildIndex();
  assert.equal(r2.chunks, r1.chunks);

  const count = db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks').get().c;
  assert.equal(count, r1.chunks);
});

test('search 返回 topK 且按相似度降序', async () => {
  const now = nowIso();
  db.prepare("INSERT INTO knowledge_chunks (source_type, source_ref, title, chunk_index, text, embedding, created_at) VALUES ('doc', 1, 'A', 0, 'aaa', ?, ?)").run(JSON.stringify([1, 0]), now);
  db.prepare("INSERT INTO knowledge_chunks (source_type, source_ref, title, chunk_index, text, embedding, created_at) VALUES ('doc', 1, 'B', 1, 'bbb', ?, ?)").run(JSON.stringify([0, 1]), now);
  db.prepare("INSERT INTO knowledge_chunks (source_type, source_ref, title, chunk_index, text, embedding, created_at) VALUES ('doc', 1, 'C', 2, 'ccc', ?, ?)").run(JSON.stringify([0.9, 0.1]), now);
  invalidateChunkCache();

  globalThis.fetch = (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/embed') return jsonResponse({ embeddings: [[1, 0]] });
    return jsonResponse({ models: [] });
  };

  const results = await search('x', 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'A');
  assert.equal(results[1].title, 'C');
  assert.ok(results[0].score >= results[1].score);
});

test('answer 正常返回 grounded 回答与来源', async () => {
  insertDoc('faq-reset', '如何重置数据库', '删除数据库文件即可，下次启动自动重建。'.repeat(5));
  await rebuildIndex();

  const r = await answer('如何重置数据库？');
  assert.equal(r.degraded, false);
  assert.equal(r.ollamaUp, true);
  assert.equal(r.answer, '测试回答（来源1）');
  assert.ok(r.sources.length > 0);
  assert.equal(r.sources[0].title, '如何重置数据库');
});

test('answer 生成失败时优雅降级（不抛错）', async () => {
  insertDoc('faq-x', '文档A', '内容。'.repeat(20));
  await rebuildIndex();

  globalThis.fetch = (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === '/api/generate') throw new Error('boom');
    if (path === '/api/embed') {
      const body = JSON.parse(options.body || '{}');
      return jsonResponse({ embeddings: (body.input || []).map((t) => fakeVec(t)) });
    }
    return jsonResponse({ models: [] });
  };

  const r = await answer('问题');
  assert.equal(r.degraded, true);
  assert.equal(r.ollamaUp, false);
  assert.match(r.answer, /未启动/);
});

test('buildWebPrompt 含网页资料与来源', () => {
  const { system, prompt } = buildWebPrompt('今天天气', [{ title: '天气网', url: 'https://a.com', text: '今天晴' }]);
  assert.match(system, /不要编造/);
  assert.match(prompt, /天气网/);
  assert.match(prompt, /https:\/\/a\.com/);
  assert.match(prompt, /今天天气/);
});

test('answer 联网搜索：搜 Bing + 抓正文 + 生成', async () => {
  const originalFetch = globalThis.fetch;
  const bingHtml = `<html><head><script>x</script></head><body><h2><a href="https://a.com/1">天气网站</a></h2><p>今天天气晴朗</p></body></html>`;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/tags')) return jsonResponse({ models: [] });
    if (u.includes('/api/generate')) return jsonResponse({ response: '联网回答（来源1）' });
    if (u.includes('cn.bing.com')) return new Response(bingHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
    if (u.includes('a.com')) return new Response('<html><body>今天天气晴朗，气温 25 度。</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    throw new Error('unexpected ' + u);
  };
  try {
    const r = await answer('今天天气怎么样？', [], { web: true });
    assert.equal(r.degraded, false);
    assert.equal(r.ollamaUp, true);
    assert.equal(r.answer, '联网回答（来源1）');
    assert.equal(r.sources.length, 1);
    assert.equal(r.sources[0].sourceType, 'web');
    assert.equal(r.sources[0].url, 'https://a.com/1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('answer 联网搜索失败时优雅降级', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/tags')) return jsonResponse({ models: [] });
    return new Response('err', { status: 500 });
  };
  try {
    const r = await answer('问题', [], { web: true });
    assert.equal(r.degraded, true);
    assert.equal(r.reason, 'web_failed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('setPostFeatured 切换精华并更新检索加权', async () => {
  const pid = makePost('精华候选', '这是帖子正文，包含多个句子。'.repeat(5), 0);

  const f1 = setPostFeatured(pid, true);
  assert.equal(f1.featured, true);
  assert.equal(db.prepare('SELECT featured FROM posts WHERE id = ?').get(pid).featured, 1);

  let u = await upsertPostChunks(pid);
  assert.equal(u.error, undefined);
  assert.ok(u.chunks > 0);
  let boost = db.prepare("SELECT boost FROM knowledge_chunks WHERE source_type='post' AND source_ref=? LIMIT 1").get(pid).boost;
  assert.equal(boost, 1);

  const f2 = setPostFeatured(pid, false);
  assert.equal(f2.featured, false);
  assert.equal(db.prepare('SELECT featured FROM posts WHERE id = ?').get(pid).featured, 0);

  u = await upsertPostChunks(pid);
  assert.equal(u.error, undefined);
  boost = db.prepare("SELECT boost FROM knowledge_chunks WHERE source_type='post' AND source_ref=? LIMIT 1").get(pid).boost;
  assert.equal(boost, 0);

  // 取消精华 ≠ 移除：帖子仍在知识库
  const count = db.prepare("SELECT COUNT(*) AS c FROM knowledge_chunks WHERE source_type='post' AND source_ref=?").get(pid).c;
  assert.equal(count, u.chunks);
});

test('deletePostChunks 移除该帖全部 chunk', async () => {
  const pid = makePost('待删除', '这是帖子正文，包含多个句子。'.repeat(5), 0);
  const u = await upsertPostChunks(pid);
  assert.ok(u.chunks > 0);
  deletePostChunks(pid);
  const count = db.prepare("SELECT COUNT(*) AS c FROM knowledge_chunks WHERE source_type='post' AND source_ref=?").get(pid).c;
  assert.equal(count, 0);
});

test('setPostFeatured 不存在的帖子返回 404', () => {
  const r = setPostFeatured(99999, true);
  assert.equal(r.status, 404);
});

test('getStatus 返回索引计数', async () => {
  insertDoc('faq-x', '文档A', '内容。'.repeat(20));
  await rebuildIndex();
  const s = await getStatus();
  assert.equal(s.ollamaUp, true);
  assert.equal(s.docs, 1);
  assert.ok(s.chunks > 0);
});
