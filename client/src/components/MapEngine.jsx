import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';

// ===== 世界与视差参数 =====
const W = 2400;
const H = 1400;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const PARALLAX = [0.2, 0.55, 1.0];
const FRICTION = 0.9;
const EASE = 0.16;
const MARGIN = 100;
const NEIGHBOR_COUNT = 3;

const CLUSTER_THRESHOLD = 40;   // 屏幕距离（px）< 此值则聚合
const CLUSTER_MAX_ZOOM = 0.75;  // 超过此缩放不再聚合（默认 zoom=1 时不聚合，保留几何形状）
const CLUSTER_POOL = 40;        // 聚合标记池大小

const X0 = -W;
const X1 = 2 * W;
const Y0 = -H;
const Y1 = 2 * H;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

function hash2(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  let y = Math.sin(n * 269.5 + 183.3) * 28001.8384;
  x -= Math.floor(x);
  y -= Math.floor(y);
  return [x, y];
}

function categoryOf(area) {
  const s = area.description || '';
  const i = s.indexOf('·');
  return i >= 0 ? s.slice(i + 1).trim() : '';
}
function shapeOf(area) {
  const cat = categoryOf(area);
  if (cat === '院系') return 'cross';
  if (cat === '地标' || cat === '礼堂') return 'tri';
  if (cat === '学生公寓') return 'diamond';
  return 'hex';
}
function priorityOf(area) {
  const cat = categoryOf(area);
  if (cat === '地标' || cat === '礼堂') return 1;
  if (cat === '院系') return 2;
  return 3;
}
function polyPoints(cx, cy, r, n, rotDeg = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = ((rotDeg + (i * 360) / n) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

// 世界坐标 -> 屏幕坐标
function screenPosOf(wx, wy, c, S, vw, vh) {
  return {
    sx: (c.zoom * wx + c.x - W / 2) * S + vw / 2,
    sy: (c.zoom * wy + c.y - H / 2) * S + vh / 2,
  };
}
// 屏幕坐标 -> 内容坐标（供聚合标记写回 SVG）
function screenToContent(sx, sy, c, S, vw, vh) {
  return {
    x: ((sx - vw / 2) / S + W / 2 - c.x) / c.zoom,
    y: ((sy - vh / 2) / S + H / 2 - c.y) / c.zoom,
  };
}

// 网格加速的贪心聚合
function buildClusters(nodes, threshold) {
  const cell = threshold;
  const grid = new Map();
  const clusters = [];
  const sorted = [...nodes].sort((a, b) => a.priority - b.priority);
  for (const n of sorted) {
    const gx = Math.round(n.sx / cell);
    const gy = Math.round(n.sy / cell);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) {
      for (let dy = -1; dy <= 1 && found < 0; dy++) {
        const idx = grid.get(`${gx + dx}_${gy + dy}`);
        if (idx !== undefined && Math.hypot(n.sx - clusters[idx].cx, n.sy - clusters[idx].cy) < threshold) {
          found = idx;
        }
      }
    }
    if (found >= 0) {
      const c = clusters[found];
      c.count += 1;
      c.cx += (n.sx - c.cx) / c.count;
      c.cy += (n.sy - c.cy) / c.count;
      c.ids.push(n.id);
    } else {
      clusters.push({ cx: n.sx, cy: n.sy, count: 1, ids: [n.id] });
      grid.set(`${gx}_${gy}`, clusters.length - 1);
    }
  }
  return clusters;
}

// L0 星尘
const STARS = [];
for (let i = 0; i < 1000; i++) {
  const [rx, ry] = hash2(i + 1);
  const [r1, r2] = hash2(i + 9001);
  STARS.push({
    x: X0 + rx * (X1 - X0),
    y: Y0 + ry * (Y1 - Y0),
    r: 0.5 + r1 * 1.6,
    o: (0.06 + r2 * 0.4).toFixed(2),
    c: r2 < 0.45 ? '#ffffff' : r2 < 0.8 ? '#c9c9c9' : '#8f8f8f',
  });
}

const GRID_COARSE = [];
for (let x = X0; x <= X1; x += 150) GRID_COARSE.push({ type: 'v', x });
for (let y = Y0; y <= Y1; y += 150) GRID_COARSE.push({ type: 'h', y });

const GRID_FINE = [];
for (let x = X0; x <= X1; x += 50) GRID_FINE.push({ type: 'v', x });
for (let y = Y0; y <= Y1; y += 50) GRID_FINE.push({ type: 'h', y });

const CONTOURS = [220, 440, 660, 880, 1100, 1320];

function scatterPos(area) {
  const [rx, ry] = hash2(area.id);
  return { x: MARGIN + rx * (W - MARGIN * 2), y: MARGIN + ry * (H - MARGIN * 2) };
}

export default function MapEngine({ areas, selectedAreaId, onSelectArea }) {
  const viewportRef = useRef(null);
  const gRefs = [useRef(null), useRef(null), useRef(null)];
  const gridCoarseRef = useRef(null);
  const gridFineRef = useRef(null);
  const crosshairRef = useRef(null);
  const readoutRef = useRef(null);

  const nodeRefs = useRef(new Map());          // area.id -> node <g>
  const labelRefs = useRef(new Map());         // area.id -> label <text>
  const clusterGroupRefs = useRef([]);         // 聚合 <g> 池
  const clusterTextRefs = useRef([]);          // 聚合计数 <text> 池

  const areasRef = useRef(areas);
  const hoveredIdRef = useRef(null);

  const [hoveredId, setHoveredId] = useState(null);

  const target = useRef({ x: 0, y: 0, zoom: 1 });
  const current = useRef({ x: 0, y: 0, zoom: 1 });
  const vel = useRef({ x: 0, y: 0 });
  const drag = useRef(null);
  const pinch = useRef(null);
  const size = useRef({ w: 1, h: 1 });
  const frame = useRef(0);
  const achRef = useRef({ zoom: false, drag: false, lastNode: null, nodeCount: 0, distance: 0 });
  const fireAch = (code) => {
    api.triggerAchievement(code).catch(() => {});
  };

  const baseScale = () => Math.max(size.current.w / W, size.current.h / H);

  const neighbors = useMemo(() => {
    const pos = new Map(areas.map((a) => [a.id, scatterPos(a)]));
    const map = new Map();
    for (const a of areas) {
      const p = pos.get(a.id);
      const near = areas
        .filter((b) => b.id !== a.id)
        .map((b) => {
          const q = pos.get(b.id);
          return { id: b.id, x: q.x, y: q.y, d: (q.x - p.x) ** 2 + (q.y - p.y) ** 2 };
        })
        .sort((m, n) => m.d - n.d)
        .slice(0, NEIGHBOR_COUNT)
        .map(({ id, x, y }) => ({ id, x, y }));
      map.set(a.id, { p, near });
    }
    return map;
  }, [areas]);

  const constellation = useMemo(() => {
    const edges = new Set();
    for (const [id, entry] of neighbors) {
      for (const n of entry.near.slice(0, 2)) {
        edges.add(id < n.id ? `${id}-${n.id}` : `${n.id}-${id}`);
      }
    }
    return [...edges].map((key) => {
      const [a, b] = key.split('-').map(Number);
      const pa = neighbors.get(a).p;
      const pb = neighbors.get(b).p;
      return { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y };
    });
  }, [neighbors]);

  useEffect(() => {
    areasRef.current = areas;
  }, [areas]);
  useEffect(() => {
    hoveredIdRef.current = hoveredId;
  }, [hoveredId]);

  useEffect(() => {
    const el = viewportRef.current;
    const update = () => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // 防重叠布局刷新：标签碰撞 + 聚类 + 逐节点/标签透明度（节流到每 3 帧，全程 ref）
  const refreshLayout = (c) => {
    const S = baseScale();
    const vw = size.current.w;
    const vh = size.current.h;
    const list = areasRef.current;
    if (!list.length) return;
    const fs = 15 * c.zoom * S; // 屏幕字号

    // 1) 节点屏幕坐标
    const nodeItems = list.map((area) => {
      const p = scatterPos(area);
      const { sx, sy } = screenPosOf(p.x, p.y, c, S, vw, vh);
      return { id: area.id, sx, sy, priority: priorityOf(area) };
    });

    // 2) 聚类
    const clustering = c.zoom < CLUSTER_MAX_ZOOM;
    let clusteredIds = new Set();
    let multiClusters = [];
    if (clustering) {
      multiClusters = buildClusters(nodeItems, CLUSTER_THRESHOLD).filter((cl) => cl.count > 1);
      for (const cl of multiClusters) for (const id of cl.ids) clusteredIds.add(id);
    }

    // 3) 标签碰撞（按优先级贪心保留）
    const labelItems = list.map((area) => {
      const p = scatterPos(area);
      const labelY = p.y > H - 120 ? p.y - 34 : p.y + 32;
      const { sx, sy } = screenPosOf(p.x, labelY, c, S, vw, vh);
      return {
        id: area.id,
        sx,
        sy,
        hw: (area.name.length + 4) * fs * 0.5,
        hh: fs * 0.6,
        priority: priorityOf(area),
      };
    });
    labelItems.sort((a, b) => a.priority - b.priority);
    const hiddenLabels = new Set();
    const kept = [];
    for (const it of labelItems) {
      let overlap = false;
      for (const k of kept) {
        if (Math.abs(it.sx - k.sx) < it.hw + k.hw && Math.abs(it.sy - k.sy) < it.hh + k.hh) {
          overlap = true;
          break;
        }
      }
      if (overlap) hiddenLabels.add(it.id);
      else kept.push(it);
    }

    // 4) 逐节点透明度（priority LOD × 聚类隐藏）
    const p2Op = clamp01((c.zoom - 0.5) / 0.3);
    const p3Op = clamp01((c.zoom - 0.8) / 0.3);
    for (const n of nodeItems) {
      const ref = nodeRefs.current.get(n.id);
      if (!ref) continue;
      let op = 1;
      if (n.priority === 2) op = p2Op;
      else if (n.priority === 3) op = p3Op;
      if (clusteredIds.has(n.id)) op = 0;
      ref.setAttribute('opacity', op.toFixed(3));
    }

    // 5) 逐标签透明度（LOD × 碰撞隐藏 × hover 强制显示）
    const labelOp = clamp01((c.zoom - 0.6) / 0.4);
    for (const it of labelItems) {
      const ref = labelRefs.current.get(it.id);
      if (!ref) continue;
      let op = labelOp;
      if (hiddenLabels.has(it.id)) op = 0;
      if (hoveredIdRef.current === it.id) op = 1;
      ref.setAttribute('opacity', op.toFixed(3));
    }

    // 6) 聚合标记（大圆 + 数字）
    for (let i = 0; i < CLUSTER_POOL; i++) {
      const g = clusterGroupRefs.current[i];
      if (!g) continue;
      if (i < multiClusters.length) {
        const cl = multiClusters[i];
        const w = screenToContent(cl.cx, cl.cy, c, S, vw, vh);
        g.setAttribute('transform', `translate(${w.x} ${w.y})`);
        g.setAttribute('visibility', 'visible');
        if (clusterTextRefs.current[i]) clusterTextRefs.current[i].textContent = String(cl.count);
      } else {
        g.setAttribute('visibility', 'hidden');
      }
    }
  };

  // rAF 主循环
  useEffect(() => {
    let raf;
    const clampTarget = () => {
      const t = target.current;
      const s = t.zoom;
      t.x = Math.min(W * s, Math.max(W * (1 - 2 * s), t.x));
      t.y = Math.min(H * s, Math.max(H * (1 - 2 * s), t.y));
    };
    const tick = () => {
      const t = target.current;
      const c = current.current;
      const v = vel.current;
      if (!drag.current && !pinch.current) {
        t.x += v.x;
        t.y += v.y;
        v.x *= FRICTION;
        v.y *= FRICTION;
        if (Math.abs(v.x) < 0.05) v.x = 0;
        if (Math.abs(v.y) < 0.05) v.y = 0;
      }
      clampTarget();
      c.x += (t.x - c.x) * EASE;
      c.y += (t.y - c.y) * EASE;
      c.zoom += (t.zoom - c.zoom) * EASE;

      // 三层视差 transform + 网格 LOD
      for (let i = 0; i < 3; i++) {
        const f = PARALLAX[i];
        const s = 1 + (c.zoom - 1) * f;
        const g = gRefs[i].current;
        if (g) g.setAttribute('transform', `translate(${c.x * f} ${c.y * f}) scale(${s})`);
      }
      const z = c.zoom;
      const fineOp = clamp01((z - 1.2) * 0.5) * 0.32;
      const coarseOp = Math.max(0.08, 0.32 - (z - 0.8) * 0.18);
      if (gridFineRef.current) gridFineRef.current.setAttribute('opacity', fineOp.toFixed(3));
      if (gridCoarseRef.current) gridCoarseRef.current.setAttribute('opacity', coarseOp.toFixed(3));

      // 防重叠布局（节流）
      frame.current += 1;
      if (frame.current % 3 === 0) refreshLayout(c);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const S = baseScale();
      const Ax = (mx - size.current.w / 2) / S + W / 2;
      const Ay = (my - size.current.h / 2) / S + H / 2;
      const t = target.current;
      const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.zoom * Math.exp(-e.deltaY * 0.0015)));
      const applied = ns / t.zoom;
      t.x = Ax - applied * (Ax - t.x);
      t.y = Ay - applied * (Ay - t.y);
      t.zoom = ns;
      if (ns >= MAX_ZOOM - 0.01 && !achRef.current.zoom) {
        achRef.current.zoom = true;
        fireAch('EXP_002');
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e) => {
    if (e.pointerType === 'touch') return;
    if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
    drag.current = {
      sx: e.clientX, sy: e.clientY,
      ox: target.current.x, oy: target.current.y,
      lastX: e.clientX, lastY: e.clientY, lastT: performance.now(),
    };
    viewportRef.current.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const S = baseScale();
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    achRef.current.distance += Math.abs(dx) + Math.abs(dy);
    if (achRef.current.distance > 50000 && !achRef.current.drag) {
      achRef.current.drag = true;
      fireAch('EXP_004');
    }
    target.current.x = d.ox + (e.clientX - d.sx) / S;
    target.current.y = d.oy + (e.clientY - d.sy) / S;
    vel.current.x = ((dx / S) / dt) * 16;
    vel.current.y = ((dy / S) / dt) * 16;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = now;
  };
  const onPointerUp = () => {
    drag.current = null;
    if (viewportRef.current) viewportRef.current.style.cursor = 'grab';
  };

  const onMouseMove = (e) => {
    const el = viewportRef.current;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const S = baseScale();
    const Ax = (mx - size.current.w / 2) / S + W / 2;
    const Ay = (my - size.current.h / 2) / S + H / 2;
    if (crosshairRef.current) {
      crosshairRef.current.style.transform = `translate(${mx}px, ${my}px)`;
      crosshairRef.current.style.opacity = '1';
    }
    if (readoutRef.current) {
      readoutRef.current.style.transform = `translate(${mx + 16}px, ${my + 12}px)`;
      readoutRef.current.style.opacity = '1';
      readoutRef.current.textContent = `X ${Math.round(Ax)} · Y ${Math.round(Ay)}`;
    }
  };
  const onMouseLeave = () => {
    if (crosshairRef.current) crosshairRef.current.style.opacity = '0';
    if (readoutRef.current) readoutRef.current.style.opacity = '0';
    setHoveredId(null);
  };

  const onTouchStart = (e) => {
    const t = e.touches;
    if (t.length === 1) {
      drag.current = {
        sx: t[0].clientX, sy: t[0].clientY,
        ox: target.current.x, oy: target.current.y,
        lastX: t[0].clientX, lastY: t[0].clientY, lastT: performance.now(),
      };
    } else if (t.length === 2) {
      drag.current = null;
      pinch.current = {
        d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY),
        zoom: target.current.zoom,
        cx: (t[0].clientX + t[1].clientX) / 2,
        cy: (t[0].clientY + t[1].clientY) / 2,
      };
    }
  };
  const onTouchMove = (e) => {
    const t = e.touches;
    if (t.length === 1 && drag.current) {
      const d = drag.current;
      const S = baseScale();
      const now = performance.now();
      const dt = Math.max(1, now - d.lastT);
      const dx = t[0].clientX - d.lastX;
      const dy = t[0].clientY - d.lastY;
      achRef.current.distance += Math.abs(dx) + Math.abs(dy);
      if (achRef.current.distance > 50000 && !achRef.current.drag) {
        achRef.current.drag = true;
        fireAch('EXP_004');
      }
      target.current.x = d.ox + (t[0].clientX - d.sx) / S;
      target.current.y = d.oy + (t[0].clientY - d.sy) / S;
      vel.current.x = ((dx / S) / dt) * 16;
      vel.current.y = ((dy / S) / dt) * 16;
      d.lastX = t[0].clientX;
      d.lastY = t[0].clientY;
      d.lastT = now;
    } else if (t.length === 2 && pinch.current) {
      const p = pinch.current;
      const d = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p.zoom * (d / p.d)));
      const rect = viewportRef.current.getBoundingClientRect();
      const mx = p.cx - rect.left;
      const my = p.cy - rect.top;
      const S = baseScale();
      const Ax = (mx - size.current.w / 2) / S + W / 2;
      const Ay = (my - size.current.h / 2) / S + H / 2;
      const applied = ns / target.current.zoom;
      target.current.x = Ax - applied * (Ax - target.current.x);
      target.current.y = Ay - applied * (Ay - target.current.y);
      target.current.zoom = ns;
    }
  };
  const onTouchEnd = (e) => {
    if (e.touches.length === 0) {
      drag.current = null;
      pinch.current = null;
    } else if (e.touches.length === 1) {
      pinch.current = null;
      const t = e.touches[0];
      drag.current = {
        sx: t.clientX, sy: t.clientY,
        ox: target.current.x, oy: target.current.y,
        lastX: t.clientX, lastY: t.clientY, lastT: performance.now(),
      };
    }
  };

  const renderNode = (area) => {
    const p = scatterPos(area);
    const shape = shapeOf(area);
    return (
      <g
        key={area.id}
        ref={(el) => {
          if (el) nodeRefs.current.set(area.id, el);
          else nodeRefs.current.delete(area.id);
        }}
        className={'node' + (selectedAreaId === area.id ? ' selected' : '')}
        onClick={() => {
          onSelectArea(area);
          if (achRef.current.lastNode === area.id) achRef.current.nodeCount++;
          else {
            achRef.current.lastNode = area.id;
            achRef.current.nodeCount = 1;
          }
          if (achRef.current.nodeCount >= 5) fireAch('EXP_003');
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onMouseEnter={() => setHoveredId(area.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        <circle className="marker-halo" cx={p.x} cy={p.y} r={26} />
        {shape === 'hex' && <polygon className="node-shape" points={polyPoints(p.x, p.y, 15, 6, 0)} />}
        {shape === 'tri' && <polygon className="node-shape" points={polyPoints(p.x, p.y, 17, 3, -90)} />}
        {shape === 'diamond' && <polygon className="node-shape" points={polyPoints(p.x, p.y, 15, 4, 45)} />}
        {shape === 'cross' && (
          <g className="node-shape-cross">
            <circle className="cross-ring" cx={p.x} cy={p.y} r={14} />
            <line className="cross-tick" x1={p.x - 22} y1={p.y} x2={p.x - 14} y2={p.y} />
            <line className="cross-tick" x1={p.x + 14} y1={p.y} x2={p.x + 22} y2={p.y} />
            <line className="cross-tick" x1={p.x} y1={p.y - 22} x2={p.x} y2={p.y - 14} />
            <line className="cross-tick" x1={p.x} y1={p.y + 14} x2={p.x} y2={p.y + 22} />
          </g>
        )}
        <g className="node-ring">
          <circle className="ring-circle" cx={p.x} cy={p.y} r={24} />
          <line className="ring-tick" x1={p.x - 34} y1={p.y} x2={p.x - 25} y2={p.y} />
          <line className="ring-tick" x1={p.x + 25} y1={p.y} x2={p.x + 34} y2={p.y} />
          <line className="ring-tick" x1={p.x} y1={p.y - 34} x2={p.x} y2={p.y - 25} />
          <line className="ring-tick" x1={p.x} y1={p.y + 25} x2={p.x} y2={p.y + 34} />
        </g>
      </g>
    );
  };

  return (
    <div
      ref={viewportRef}
      className="map-viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* L0 星尘 + 星云噪点 */}
      <svg className="map-layer" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="nebula">
            <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="4" seed="7" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
        <g ref={gRefs[0]}>
          <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} filter="url(#nebula)" opacity="0.05" />
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={s.c} opacity={s.o} />
          ))}
        </g>
      </svg>

      {/* L1 网格 + 雷达等高线 */}
      <svg className="map-layer" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <g ref={gRefs[1]}>
          <g ref={gridCoarseRef} opacity="0.32">
            {GRID_COARSE.map((l, i) =>
              l.type === 'v' ? (
                <line key={`c${i}`} className="grid-coarse" x1={l.x} y1={Y0} x2={l.x} y2={Y1} />
              ) : (
                <line key={`c${i}`} className="grid-coarse" x1={X0} y1={l.y} x2={X1} y2={l.y} />
              )
            )}
          </g>
          <g ref={gridFineRef} opacity="0">
            {GRID_FINE.map((l, i) =>
              l.type === 'v' ? (
                <line key={`f${i}`} className="grid-fine" x1={l.x} y1={Y0} x2={l.x} y2={Y1} />
              ) : (
                <line key={`f${i}`} className="grid-fine" x1={X0} y1={l.y} x2={X1} y2={l.y} />
              )
            )}
          </g>
          <g className="contour-group">
            {CONTOURS.map((r) => (
              <circle key={r} className="contour" cx={W / 2} cy={H / 2} r={r} />
            ))}
          </g>
        </g>
      </svg>

      {/* L2 星座网 + 聚合标记 + 节点 + 标签 */}
      <svg className="map-layer" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <g ref={gRefs[2]}>
          <g className="constellation">
            {constellation.map((e, i) => (
              <line key={i} className="constellation-line" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
            ))}
          </g>

          {/* 聚合标记池 */}
          {Array.from({ length: CLUSTER_POOL }).map((_, i) => (
            <g
              key={`cl${i}`}
              className="cluster"
              visibility="hidden"
              ref={(el) => (clusterGroupRefs.current[i] = el)}
            >
              <circle className="cluster-ring" r={20} />
              <text
                className="cluster-count"
                y={0.5}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={16}
                ref={(el) => (clusterTextRefs.current[i] = el)}
              >
                1
              </text>
            </g>
          ))}

          <g className="node-links">
            {hoveredId &&
              (() => {
                const entry = neighbors.get(hoveredId);
                if (!entry) return null;
                return entry.near.map((n) => (
                  <line key={n.id} className="node-link" x1={entry.p.x} y1={entry.p.y} x2={n.x} y2={n.y} />
                ));
              })()}
          </g>

          {areas.map((area) => {
            const p = scatterPos(area);
            const labelY = p.y > H - 120 ? p.y - 34 : p.y + 32;
            return (
              <text
                key={area.id}
                ref={(el) => {
                  if (el) labelRefs.current.set(area.id, el);
                  else labelRefs.current.delete(area.id);
                }}
                className="area-label"
                x={p.x}
                y={labelY}
                textAnchor="middle"
                fontSize={15}
              >
                {'[ ' + area.name + ' ]'}
              </text>
            );
          })}

          {areas.map(renderNode)}
        </g>
      </svg>

      {/* 屏幕空间特效 */}
      <div className="scanline" />
      <div className="breath-glow" />

      {/* 坐标追踪 */}
      <div ref={crosshairRef} className="crosshair" />
      <div ref={readoutRef} className="coord-readout">X 0 · Y 0</div>

      {/* HUD 边角框 */}
      <div className="hud-frame" aria-hidden="true">
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
      </div>
    </div>
  );
}
