import { useRef, useState } from 'react';

// 星空坐标系：横向宽幅 1800 x 1000。SVG 本身完全透明，不画任何底图——
// 只承载「地点星点」，背景星尘已移到独立的固定层（Starfield）。
const LOGICAL_W = 2400;
const LOGICAL_H = 1400;
const MARGIN = 100;

// 确定性伪随机（同一 id 永远得到同一位置，刷新/重渲染不跳动）
function hash2(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  let y = Math.sin(n * 269.5 + 183.3) * 28001.8384;
  x -= Math.floor(x);
  y -= Math.floor(y);
  return [x, y];
}

// 每个地点散落在坐标系上的稳定位置 + 各自的闪烁相位
function scatterPos(area) {
  const [rx, ry] = hash2(area.id);
  return {
    x: MARGIN + rx * (LOGICAL_W - MARGIN * 2),
    y: MARGIN + ry * (LOGICAL_H - MARGIN * 2),
    delay: (hash2(area.id * 7 + 3)[0] * 4).toFixed(2) + 's',
  };
}

export default function HeDaMap({ campus, areas, onSelectArea, selectedAreaId, editable = false, onMove }) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [drag, setDrag] = useState(null);

  // 把屏幕坐标换算成 SVG viewBox 坐标（getScreenCTM 会自动带上外层 translate/scale）
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
    const base = scatterPos(area);
    dragRef.current = { areaId: area.id, offsetX: p.x - base.x, offsetY: p.y - base.y, x: base.x, y: base.y };
    setDrag({ areaId: area.id, x: base.x, y: base.y });
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
    onMove?.(areaId, Math.round(x), Math.round(y));
    dragRef.current = null;
    setDrag(null);
  }

  return (
    <svg
      className={'campus-map' + (editable ? ' editing' : '')}
      viewBox={`0 0 ${LOGICAL_W} ${LOGICAL_H}`}
      ref={svgRef}
      role="img"
      aria-label={`${campus?.name || ''}校园地图`}
    >
      {/* 地点标记：发光星点 + emoji + 标签（闪烁；编辑模式下可拖拽） */}
      {areas.map((area) => {
        const base = scatterPos(area);
        const d = drag && drag.areaId === area.id ? drag : base;
        const labelY = d.y > LOGICAL_H - 110 ? d.y - 42 : d.y + 40;
        return (
          <g
            key={area.id}
            className={'area-marker' + (selectedAreaId === area.id ? ' selected' : '')}
            style={{ '--c': area.color }}
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
            <g className="star-body" style={{ '--delay': base.delay }}>
              <circle className="marker-halo" cx={d.x} cy={d.y} r={34} fill={area.color} />
              <circle className="marker-dot" cx={d.x} cy={d.y} r={18} fill={area.color} />
              <text className="marker-emoji" x={d.x} y={d.y} textAnchor="middle" dominantBaseline="central" fontSize={22}>
                {area.emoji}
              </text>
            </g>
            <text className="area-label" x={d.x} y={labelY} textAnchor="middle" fontSize={23}>
              {area.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
