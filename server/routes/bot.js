import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { requireRole } from '../auth.js';
import { answer, rebuildIndex, getStatus } from '../kb.js';

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

  // 带上最近 6 轮对话作为上下文，让 Ala 能「记住」聊天
  const history = db
    .prepare('SELECT question, answer FROM bot_messages WHERE user_id = ? ORDER BY id DESC LIMIT 6')
    .all(req.user.id)
    .reverse();
  // 用户自带模型（BYOK）：有 key + model 才启用，否则本地 Ollama
  const aiRow = db.prepare('SELECT base_url, api_key, model, mode FROM user_ai_configs WHERE user_id = ?').get(req.user.id);
  const ai = aiRow && aiRow.mode === 'cloud' && aiRow.api_key && aiRow.model ? { baseUrl: aiRow.base_url, apiKey: aiRow.api_key, model: aiRow.model } : null;
  const result = await answer(q, history, { web: !!req.body?.web, ai });
  if (result.answer) {
    db.prepare('INSERT INTO bot_messages (user_id, question, answer, sources, created_at) VALUES (?, ?, ?, ?, ?)').run(
      req.user.id,
      q,
      result.answer,
      JSON.stringify(result.sources || []),
      nowIso()
    );
  }
  res.json(result);
});

// GET /api/bot/history —— 最近 50 条
router.get('/history', (req, res) => {
  const rows = db
    .prepare('SELECT id, question, answer, sources, created_at AS createdAt FROM bot_messages WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id);
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

export default router;
