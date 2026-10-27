import { db, nowIso } from './db.js';
import { config } from './config.js';

// ============================================================
// 装扮图鉴（wardrobe）：模板 + 配色(colorway) → 像素网格。
//
// 模板 pixel_json 的 rows 用「命名槽位字符」（P 主色 / S 次色 / A 点缀 /
// O 描边 / H 高光），default_colorway 把这些字符映射到具体色值；resolve 产出
// 实例可直接渲染的最终网格 { w, h, palette, rows }（palette 为 char → #hex，
// '.' 恒透明）。
//
// 依赖：只 import db/config，不 import inventory.js —— inventory.js 反向 import
// 本文件的 resolveWardrobeItem，避免循环依赖。
// ============================================================

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

function parseJson(s, fallback = null) {
  if (s == null || s === '') return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function templateById(id) {
  return db.prepare('SELECT * FROM wardrobe_items WHERE id = ?').get(Number(id));
}
function templateByCode(code) {
  return db.prepare('SELECT * FROM wardrobe_items WHERE code = ?').get(String(code));
}

// 把模板 + 配色解析成实例像素网格。ref：{ wardrobeItemId } 或 { wardrobeCode }；
// colorway 为可选的部分配色覆盖（换色变体）。
export function resolveWardrobeItem(ref = {}, colorway = null) {
  const tpl = ref.wardrobeItemId != null
    ? templateById(ref.wardrobeItemId)
    : ref.wardrobeCode != null
      ? templateByCode(ref.wardrobeCode)
      : null;
  if (!tpl) return { error: '装扮模板不存在', code: 'WARDROBE_NOT_FOUND', status: 404 };

  const grid = parseJson(tpl.pixel_json, null);
  if (!grid || !Array.isArray(grid.rows) || grid.rows.length === 0) {
    return { error: `装扮模板「${tpl.code}」像素数据无效`, code: 'WARDROBE_BAD_PIXEL', status: 500 };
  }

  const base = parseJson(tpl.default_colorway, {});
  const override = colorway && typeof colorway === 'object' ? colorway : {};
  const palette = { ...base, ...override };

  for (const row of grid.rows) {
    for (const ch of String(row)) {
      if (ch !== '.' && !(ch in palette)) {
        return { error: `装扮模板「${tpl.code}」缺少配色 ${ch}`, code: 'WARDROBE_BAD_COLORWAY', status: 500 };
      }
    }
  }

  const w = Number(grid.w) || (grid.rows[0] || '').length;
  const h = Number(grid.h) || grid.rows.length;

  return {
    id: tpl.id,
    code: tpl.code,
    name: tpl.name,
    icon: tpl.icon,
    rarity: RARITIES.includes(tpl.rarity) ? tpl.rarity : 'common',
    slot: tpl.slot,
    description: tpl.description,
    pixelJson: { w, h, palette, rows: grid.rows },
  };
}

// 图鉴目录（只读）
export function listWardrobe() {
  return db.prepare('SELECT * FROM wardrobe_items ORDER BY id ASC').all().map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    slot: t.slot,
    rarity: t.rarity,
    icon: t.icon,
    description: t.description,
    defaultColorway: parseJson(t.default_colorway, {}),
    pixelJson: parseJson(t.pixel_json, null),
  }));
}

// ============================================================
// 演示装扮模板（确保存在；正式内容后续走策划导入 / 管理后台）
// ============================================================
const WARDROBE_TEMPLATES = [
  {
    code: 'hair_short', name: '清爽短发', slot: 'hair', rarity: 'common', icon: '💇', description: '清爽利落的短发。',
    pixelJson: { w: 16, h: 32, rows: [
      '................',
      '..OOOOOOOOOOOO..',
      '..OPPPPPPPPPPO..',
      '..OPPPP..PPPPO..',
      '..OPPPPPPPPPPO..',
      '..OPPPPPPPPPPO..',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ] },
    defaultColorway: { O: '#2b2b33', P: '#4a3628' },
  },
  {
    code: 'hat_beanie', name: '针织帽', slot: 'hat', rarity: 'common', icon: '🧢', description: '保暖的针织帽。',
    pixelJson: { w: 16, h: 32, rows: [
      '..OOOOOOOOOOOO..',
      '..OPPPPPPPPPPO..',
      '..OPPPPPPPPPPO..',
      '..OOOOOOOOOOOO..',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ] },
    defaultColorway: { O: '#2b2b33', P: '#e74c3c' },
  },
  {
    code: 'outfit_school', name: '校园制服', slot: 'outfit', rarity: 'uncommon', icon: '🎽', description: '一件素净的校服外套。',
    pixelJson: { w: 16, h: 32, rows: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '....OOOOOOOO....',
      '....OPPPPPPO....',
      '....OPSSSSPO....',
      '....OPPPPPPO....',
      '....OPPPPPPO....',
      '....OPPPPPPO....',
      '....OPPPPPPO....',
      '....OPPPPPPO....',
      '....OOOOOOOO....',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ] },
    defaultColorway: { O: '#2b2b33', P: '#5b8dd9', S: '#ffffff' },
  },
  {
    code: 'shoes_sneakers', name: '运动鞋', slot: 'shoes', rarity: 'common', icon: '👟', description: '轻便的白底运动鞋。',
    pixelJson: { w: 16, h: 32, rows: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '....OPP..PPO....',
      '....OPP..PPO....',
    ] },
    defaultColorway: { O: '#2b2b33', P: '#ffffff' },
  },
  {
    code: 'accessory_glasses', name: '圆框眼镜', slot: 'accessory', rarity: 'uncommon', icon: '👓', description: '文艺范的圆框眼镜。',
    pixelJson: { w: 16, h: 32, rows: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '.....OO..OO.....',
      '.....OO..OO.....',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ] },
    defaultColorway: { O: '#2b2b33' },
  },
];

// 幂等：确保演示装扮模板存在（按 code 判重，绝不覆盖）
export function ensureWardrobe() {
  const now = nowIso();
  const ins = db.prepare(
    'INSERT INTO wardrobe_items (code, name, slot, rarity, icon, pixel_json, default_colorway, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const t of WARDROBE_TEMPLATES) {
    if (db.prepare('SELECT id FROM wardrobe_items WHERE code = ?').get(t.code)) continue;
    ins.run(t.code, t.name, t.slot, t.rarity, t.icon, JSON.stringify(t.pixelJson), JSON.stringify(t.defaultColorway), t.description, now);
  }
}
