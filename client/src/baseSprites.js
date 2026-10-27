// ============================================================
// 像素角色 · 底模（客户端渲染数据，星露谷风格 chibi）
// 服务端只存 skin_tone/body/face 三个档位码，底模像素在这里生成。
// 画布 16×32：大头（0-15 行）+ 躯干（16-24）+ 腿鞋（25-31）。
// 与装扮像素同格式：{ w, h, palette: { 字符: '#hex' }, rows: [...] }。
// ============================================================

const W = 16;
const H = 32;

const OUTLINE = '#2b2b33';
const HAIR = '#3a3a44';                                   // 默认发色（深灰）
const CLOTH = { base: '#6b7a99', shadow: '#4a5568' };     // 默认衣（灰蓝）
const PANTS = { base: '#3d4351', shadow: '#2a2f3a' };
const EYE = '#1c1d24';
const MOUTH = '#8a4a3a';
const BLUSH = '#e8917a';

const SKIN_TONES = {
  fair: { base: '#f2c9a4', shadow: '#d9a884' },
  warm: { base: '#e0aa7d', shadow: '#c48a5e' },
  tan: { base: '#c0865b', shadow: '#a06c44' },
  deep: { base: '#8f5f3d', shadow: '#6f4528' },
};

// 头部模板（16 行）：大头 chibi，头发 / 脸 / 眼 / 嘴 / 下巴 / 脖子
const HEAD_ROWS = [
  '................',
  '..OOOOOOOOOOOO..',
  '..OHHHHHHHHHHO..',
  '..OHHHHHHHHHHO..',
  '..OHHHHHHHHHHO..',
  '..OSSSSSSSSSSO..',
  '..OSSSSSSSSSSO..',
  '..OSSSSSSSSSSO..',
  '..OSSEESSEESSO..',
  '..OSSSSSSSSSSO..',
  '..OSSSSSSSSSSO..',
  '..OSSSSMMSSSSO..',
  '..OSSSSSSSSSSO..',
  '...OSSSSSSSSO...',
  '....OSSSSSSO....',
  '....OSSSSSSO....',
];

export function buildBaseSprite({ skinTone = 'fair', body = 'standard', face = 'neutral' } = {}) {
  const skin = SKIN_TONES[skinTone] || SKIN_TONES.fair;
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const set = (r, c, ch) => { if (r >= 0 && r < H && c >= 0 && c < W) g[r][c] = ch; };

  // 头部
  for (let r = 0; r < HEAD_ROWS.length; r++) {
    for (let c = 0; c < W; c++) g[r][c] = HEAD_ROWS[r][c];
  }

  // 表情
  if (face === 'cool') { set(8, 6, '.'); set(8, 10, '.'); }              // 半眯眼（单像素）
  if (face === 'happy') { set(11, 5, 'M'); set(11, 6, 'M'); set(11, 7, 'M'); set(11, 8, 'M'); set(11, 9, 'M'); set(11, 10, 'M'); } // 大笑
  if (face === 'happy' || face === 'shy') { set(9, 4, 'R'); set(9, 11, 'R'); } // 腮红

  // 身体（体型 → 躯干宽窄）
  const torsoL = body === 'sturdy' ? 3 : body === 'slim' ? 5 : 4;
  const torsoR = body === 'sturdy' ? 12 : body === 'slim' ? 10 : 11;

  // 躯干 rows 16-24
  for (let r = 16; r <= 24; r++) {
    set(r, torsoL, 'O');
    set(r, torsoR, 'O');
    for (let c = torsoL + 1; c <= torsoR - 1; c++) set(r, c, 'C');
    set(r, torsoR - 1, 'c'); // 右侧阴影
  }
  set(16, Math.round((torsoL + torsoR) / 2), 'S'); // 领口露肤

  // 手臂 rows 17-23（1px，皮肤）
  for (let r = 17; r <= 23; r++) {
    set(r, torsoL - 1, 'S');
    set(r, torsoR + 1, 'S');
  }

  // 腿 rows 25-29（两条）
  const legL0 = torsoL + 1, legL1 = torsoL + 2;
  const legR0 = torsoR - 2, legR1 = torsoR - 1;
  for (let r = 25; r <= 29; r++) {
    set(r, legL0, 'P'); set(r, legL1, 'P');
    set(r, legR0, 'P'); set(r, legR1, 'P');
    set(r, legL1, 'p'); set(r, legR1, 'p'); // 内侧阴影
  }

  // 鞋 rows 30-31
  for (let r = 30; r <= 31; r++) {
    set(r, legL0 - 1, 'O'); set(r, legL0, 'O'); set(r, legL1, 'O');
    set(r, legR0, 'O'); set(r, legR1, 'O'); set(r, legR1 + 1, 'O');
  }

  const palette = {
    O: OUTLINE, H: HAIR, S: skin.base, s: skin.shadow, E: EYE, M: MOUTH, R: BLUSH,
    C: CLOTH.base, c: CLOTH.shadow, P: PANTS.base, p: PANTS.shadow,
  };
  return { w: W, h: H, palette, rows: g.map((row) => row.join('')) };
}
