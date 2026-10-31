import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { requireRole } from '../auth.js';
import { answer, rebuildIndex, getStatus } from '../kb.js';
import { touchAffinity, getAffinity } from '../affinity.js';
import { quizStatus, answerQuiz } from '../quiz.js';
import { PERSONAS, dailyMood } from '../persona.js';

const router = Router();

function safeParse(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// POST /api/bot/ask —— 任意登录角色提问（降级也返回 200，前端友好展示）
router.post('/ask', async (req, res) => {
  const q = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!q) return res.status(400).json({ error: '问题不能为空' });
  if (q.length > 500) return res.status(400).json({ error: '问题过长（最多 500 字）' });

  // 解析会话（多对话框）：拿到该会话的人设规格
  const convId = Number(req.body?.conversationId);
  const conv = Number.isInteger(convId) && convId > 0
    ? db.prepare('SELECT * FROM bot_conversations WHERE id = ? AND user_id = ?').get(convId, req.user.id)
    : null;
  const personaSpec = conv
    ? conv.persona_type === 'custom'
      ? { type: 'custom', text: conv.persona_text }
      : conv.persona_type === 'preset'
        ? { type: 'preset', key: conv.persona_key || 'ruanmeng' }
        : { type: 'default' }
    : { type: 'default' };

  // 带上本会话最近 6 轮对话作为上下文
  const history = conv
    ? db.prepare('SELECT question, answer FROM bot_messages WHERE user_id = ? AND conversation_id = ? ORDER BY id DESC LIMIT 6').all(req.user.id, conv.id).reverse()
    : [];

  // 用户自带模型（BYOK）：有 key + model 才启用，否则本地 Ollama
  const aiRow = db.prepare('SELECT base_url, api_key, model, mode FROM user_ai_configs WHERE user_id = ?').get(req.user.id);
  const ai = aiRow && aiRow.mode === 'cloud' && aiRow.api_key && aiRow.model ? { baseUrl: aiRow.base_url, apiKey: aiRow.api_key, model: aiRow.model } : null;
  const aff = getAffinity(req.user.id);
  const result = await answer(q, history, { web: !!req.body?.web, ai, personaSpec, affinityLabel: aff.label });

  if (result.answer) {
    db.prepare('INSERT INTO bot_messages (user_id, conversation_id, question, answer, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      req.user.id,
      conv ? conv.id : null,
      q,
      result.answer,
      JSON.stringify(result.sources || []),
      nowIso()
    );
  }
  // 真实问答（非降级）累积亲密度
  const affinity = result.degraded ? null : touchAffinity(req.user.id);
  res.json({ ...result, affinity });
});

// GET /api/bot/history —— 最近 50 条（全部会话）
router.get('/history', (req, res) => {
  const rows = db
    .prepare('SELECT id, question, answer, sources, created_at AS createdAt FROM bot_messages WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id);
  res.json(rows.map((r) => ({ ...r, sources: safeParse(r.sources) })));
});

// GET /api/bot/conversations —— 会话列表（无则自动建一个默认「百科助手」）
router.get('/conversations', (req, res) => {
  let list = db
    .prepare('SELECT id, title, persona_type AS personaType, persona_key AS personaKey, created_at AS createdAt FROM bot_conversations WHERE user_id = ? ORDER BY id ASC')
    .all(req.user.id);
  if (list.length === 0) {
    db.prepare("INSERT INTO bot_conversations (user_id, title, persona_type, created_at, updated_at) VALUES (?, '百科助手', 'default', ?, ?)").run(req.user.id, nowIso(), nowIso());
    list = db
      .prepare('SELECT id, title, persona_type AS personaType, persona_key AS personaKey, created_at AS createdAt FROM bot_conversations WHERE user_id = ? ORDER BY id ASC')
      .all(req.user.id);
  }
  res.json(list);
});

// POST /api/bot/conversations —— 新建会话（personaType: default | preset | custom）
router.post('/conversations', (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 40) : '';
  const personaType = req.body?.personaType === 'preset' || req.body?.personaType === 'custom' ? req.body.personaType : 'default';
  let personaKey = null;
  let personaText = null;
  if (personaType === 'preset') {
    personaKey = PERSONAS[req.body?.personaKey] ? req.body.personaKey : 'ruanmeng';
  } else if (personaType === 'custom') {
    personaText = typeof req.body?.personaText === 'string' ? req.body.personaText.trim().slice(0, 500) : '';
    if (!personaText) return res.status(400).json({ error: '自定义人设不能为空' });
  }
  const finalTitle = title || (personaType === 'custom' ? '自定义角色' : personaType === 'preset' ? PERSONAS[personaKey].name : '百科助手');
  const info = db
    .prepare('INSERT INTO bot_conversations (user_id, title, persona_type, persona_key, persona_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, finalTitle, personaType, personaKey, personaText, nowIso(), nowIso());
  res.status(201).json({ id: Number(info.lastInsertRowid), title: finalTitle, personaType, personaKey });
});

// DELETE /api/bot/conversations/:id —— 删除会话（至少保留一个）
router.delete('/conversations/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '无效的会话 ID' });
  const conv = db.prepare('SELECT id FROM bot_conversations WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!conv) return res.status(404).json({ error: '会话不存在' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM bot_conversations WHERE user_id = ?').get(req.user.id).c;
  if (count <= 1) return res.status(400).json({ error: '至少保留一个会话' });
  db.prepare('DELETE FROM bot_messages WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM bot_conversations WHERE id = ?').run(id);
  res.json({ ok: true });
});

// GET /api/bot/conversations/:id/messages —— 会话历史
router.get('/conversations/:id/messages', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '无效的会话 ID' });
  const conv = db.prepare('SELECT id FROM bot_conversations WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!conv) return res.status(404).json({ error: '会话不存在' });
  const rows = db
    .prepare('SELECT id, question, answer, sources, created_at AS createdAt FROM bot_messages WHERE user_id = ? AND conversation_id = ? ORDER BY id DESC LIMIT 100')
    .all(req.user.id, id);
  res.json(rows.map((r) => ({ ...r, sources: safeParse(r.sources) })));
});

// POST /api/bot/rebuild —— 仅 admin 重建索引
router.post('/rebuild', requireRole('admin'), async (req, res) => {
  const r = await rebuildIndex();
  if (r.error) return res.status(503).json({ error: r.error });
  res.json(r);
});

// GET /api/bot/status —— 任意登录角色
router.get('/status', async (req, res) => {
  res.json(await getStatus());
});

// GET /api/bot/ai-config —— 返回当前用户已保存的模型配置（key 打码）
router.get('/ai-config', (req, res) => {
  const row = db.prepare('SELECT base_url, api_key, model, mode FROM user_ai_configs WHERE user_id = ?').get(req.user.id);
  if (!row) return res.json({ mode: 'local', baseUrl: '', model: '', hasKey: false, apiKeyMasked: '' });
  res.json({
    mode: row.mode || 'local',
    baseUrl: row.base_url,
    model: row.model,
    hasKey: !!row.api_key,
    apiKeyMasked: row.api_key ? '****' + row.api_key.slice(-4) : '',
  });
});

// PUT /api/bot/ai-config —— 保存模型配置（apiKey 留空则保留旧值）
router.put('/ai-config', (req, res) => {
  const mode = req.body?.mode === 'cloud' ? 'cloud' : 'local';
  const baseUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : '';
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  const key = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';

  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return res.status(400).json({ error: '接口地址需以 http(s):// 开头' });
  }

  // key 留空则保留旧值
  const existing = db.prepare('SELECT api_key FROM user_ai_configs WHERE user_id = ?').get(req.user.id);
  const finalKey = key || (existing ? existing.api_key : '');

  db.prepare(
    `INSERT INTO user_ai_configs (user_id, base_url, api_key, model, mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET base_url = excluded.base_url, api_key = excluded.api_key, model = excluded.model, mode = excluded.mode, updated_at = excluded.updated_at`
  ).run(req.user.id, baseUrl, finalKey, model, mode, nowIso(), nowIso());

  res.json({ ok: true, mode, hasKey: !!finalKey, apiKeyMasked: finalKey ? '****' + finalKey.slice(-4) : '' });
});

// DELETE /api/bot/ai-config —— 清除模型配置（回退到本地 Ollama）
router.delete('/ai-config', (req, res) => {
  db.prepare('DELETE FROM user_ai_configs WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

// GET /api/bot/affinity —— 当前亲密度
router.get('/affinity', (req, res) => {
  res.json(getAffinity(req.user.id));
});

// GET /api/bot/persona —— 可选预设人设列表 + 今日心情（供新建会话用）
router.get('/persona', (req, res) => {
  res.json({
    mood: dailyMood(),
    personas: Object.entries(PERSONAS).map(([key, p]) => ({ key, name: p.name })),
  });
});

// GET /api/bot/quiz —— 今日校园问答
router.get('/quiz', (req, res) => {
  res.json(quizStatus(req.user.id));
});

// POST /api/bot/quiz/answer —— 作答今日校园问答
router.post('/quiz/answer', (req, res) => {
  try {
    const r = answerQuiz(req.user.id, req.body?.answer);
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    res.json(r);
  } catch (e) {
    if (e && Number.isInteger(e.status) && e.status >= 400 && e.status < 500) {
      return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    }
    throw e;
  }
});

export default router;
