import { useRef, useState } from 'react';

// 各校区真实底图信息（宽高与 public/maps 下的图片一致）
const MAP = {
  minglun: { src: '/maps/minglun.jpg', w: 1600, h: 2749 },
  jinming: { src: '/maps/jinming.jpg', w: 920, h: 1596 },
};

// 种子数据里的坐标统一使用 1000x1900 逻辑空间，渲染时缩放到底图实际尺寸
const LOGICAL_W = 1000;
const LOGICAL_H = 1900;

export default function HeDaMap({ campus, areas, onSelectArea, selectedAreaId, editable = false, onMove }) {
  const slug = campus?.slug || 'minglun';
  const cfg = MAP[slug] || MAP.minglun;
  const sx = cfg.w / LOGICAL_W;
  const sy = cfg.h / LOGICAL_H;

  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [drag, setDrag] = useState(null);

  // 把屏幕坐标换算成 SVG viewBox 坐标
  function clientToSvg(clientX, clientY) {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }

  function onPointerDown(e, area) {
    if (!editable) return;
    e.preventDefault();
    const p = clientToSvg(e.clientX, e.clientY);
    const imgX = area.x * sx;
    const imgY = area.y * sy;
    dragRef.current = { areaId: area.id, offsetX: p.x - imgX, offsetY: p.y - imgY, x: imgX, y: imgY };
    setDrag({ areaId: area.id, x: imgX, y: imgY });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragRef.current) return;
    const p = clientToSvg(e.clientX, e.clientY);
    const nx = p.x - dragRef.current.offsetX;
    const ny = p.y - dragRef.current.offsetY;
    dragRef.current.x = nx;
    dragRef.current.y = ny;
    setDrag({ areaId: dragRef.current.areaId, x: nx, y: ny });
  }

  function onPointerUp() {
    if (!dragRef.current) return;
    const { areaId, x, y } = dragRef.current;
    onMove?.(areaId, Math.round(x / sx), Math.round(y / sy));
    dragRef.current = null;
    setDrag(null);
  }

  const pinR = 17 * sx;
  const emojiSize = 16 * sx;
  const labelSize = 12.5 * sx;
  const labelDy = 30 * sx;
  const strokeW = 3.5 * sx;

  return (
    <svg className={'campus-map' + (editable ? ' editing' : '')} viewBox={`0 0 ${cfg.w} ${cfg.h}`} ref={svgRef} role="img" aria-label={`${campus?.name || ''}校园地图`}>
      {/* 真实地图作为底图 */}
      <image href={cfg.src} x="0" y="0" width={cfg.w} height={cfg.h} preserveAspectRatio="xMidYMid meet" />

      {/* 地点标记（emoji 符号 + 标签，编辑模式下可拖拽） */}
      {areas.map((area) => {
        const d = drag && drag.areaId === area.id ? drag : { x: area.x * sx, y: area.y * sy };
        const labelY = d.y > cfg.h - 100 ? d.y - labelDy * 0.7 : d.y + labelDy;
        return (
          <g
            key={area.id}
            className={'area-marker' + (selectedAreaId === area.id ? ' selected' : '')}
            onClick={() => {
              if (!editable) onSelectArea(area);
            }}
            onPointerDown={(e) => onPointerDown(e, area)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (!editable && (e.key === 'Enter' || e.key === ' ')) onSelectArea(area);
            }}
          >
            <circle className="pin" cx={d.x} cy={d.y} r={pinR} fill="#ffffff" stroke={area.color} strokeWidth={strokeW} />
            <text x={d.x} y={d.y + emojiSize * 0.35} textAnchor="middle" fontSize={emojiSize}>
              {area.emoji}
            </text>
            <text className="area-label" x={d.x} y={labelY} textAnchor="middle" fontSize={labelSize}>
              {area.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
