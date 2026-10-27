import { useEffect, useMemo, useRef } from 'react';
import { buildBaseSprite } from '../baseSprites.js';

// 装扮合成顺序（从底到顶，与 config.character.slots 对齐）
const LAYER_ORDER = ['shoes', 'outfit', 'hair', 'hat', 'accessory'];

function drawGrid(ctx, grid) {
  if (!grid || !Array.isArray(grid.rows)) return;
  for (let y = 0; y < grid.rows.length; y++) {
    const row = grid.rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const color = grid.palette?.[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

// 像素角色渲染：底模 + 已穿戴装扮分层叠加，按底模宽高比等比缩放。
// base = { skinTone, body, face }；equipped = { slot: item }（item 含 pixelJson）。
// size = 渲染高度（像素），宽度按宽高比自动换算。
export default function PixelAvatar({ base = {}, equipped = {}, size = 96, className }) {
  const ref = useRef(null);
  const sprite = useMemo(() => buildBaseSprite(base), [base]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = sprite.w;
    canvas.height = sprite.h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, sprite.w, sprite.h);
    drawGrid(ctx, sprite);
    for (const slot of LAYER_ORDER) {
      const item = equipped[slot];
      if (item && item.pixelJson) drawGrid(ctx, item.pixelJson);
    }
  }, [sprite, equipped]);

  const width = Math.max(1, Math.round((size * sprite.w) / sprite.h));
  return (
    <canvas
      ref={ref}
      className={className}
      style={{ height: size, width, imageRendering: 'pixelated', display: 'block' }}
    />
  );
}
