import { Router } from 'express';
import { getCharacter, setCharacterBase, setEquip, getPublicCharacter } from '../character.js';

const router = Router();

// GET /api/character —— 我的角色（底模 + 已穿戴 + 可穿戴装扮）
router.get('/character', (req, res) => {
  res.json(getCharacter(req.user.id));
});

// PUT /api/character/base —— 设置底模（肤色/体型/表情，可部分更新）
router.put('/character/base', (req, res) => {
  const result = setCharacterBase(req.user.id, req.body || {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// PUT /api/character/equip —— 穿戴/卸下（body: { slot, inventoryItemId }；inventoryItemId=null 卸下）
router.put('/character/equip', (req, res) => {
  const result = setEquip(req.user.id, req.body?.slot, req.body?.inventoryItemId ?? null);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// GET /api/character/:userId —— 公开角色（个人主页 / 看别人）
router.get('/character/:userId', (req, res) => {
  const result = getPublicCharacter(req.params.userId);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

export default router;
