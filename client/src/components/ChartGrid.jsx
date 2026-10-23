// 固定全屏「行星测绘」网格层：极细网格 + 边缘刻度 + 经纬度式标签（不随地图平移缩放）
const W = 1600;
const H = 900;

const minorV = [];
for (let x = 0; x <= W; x += 100) minorV.push(x);
const minorH = [];
for (let y = 0; y <= H; y += 100) minorH.push(y);

const majorV = [0, 400, 800, 1200, 1600];
const majorH = [0, 300, 600, 900];

function lonLabel(x) {
  const deg = Math.round((x / W) * 360 - 180);
  const v = Math.abs(deg);
  return v === 0 ? '0' : `${v} ${deg < 0 ? 'W' : 'E'}`;
}
function latLabel(y) {
  const deg = Math.round(90 - (y / H) * 180);
  const v = Math.abs(deg);
  return v === 0 ? '0' : `${v} ${deg > 0 ? 'N' : 'S'}`;
}

export default function ChartGrid() {
  return (
    <svg className="chart-grid" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {minorV.map((x) => (
        <line key={`v${x}`} className="grid-minor" x1={x} y1={0} x2={x} y2={H} />
      ))}
      {minorH.map((y) => (
        <line key={`h${y}`} className="grid-minor" x1={0} y1={y} x2={W} y2={y} />
      ))}
      {majorV.map((x) => (
        <line key={`mv${x}`} className="grid-major" x1={x} y1={0} x2={x} y2={H} />
      ))}
      {majorH.map((y) => (
        <line key={`mh${y}`} className="grid-major" x1={0} y1={y} x2={W} y2={y} />
      ))}

      {/* 顶部刻度 + 经度标签 */}
      {majorV.map((x) => {
        const anchor = x === 0 ? 'start' : x === W ? 'end' : 'middle';
        const tx = x === 0 ? 8 : x === W ? W - 8 : x;
        return (
          <g key={`tv${x}`}>
            <line className="tick" x1={x} y1={0} x2={x} y2={7} />
            <text className="coord-label" x={tx} y={22} textAnchor={anchor}>
              {lonLabel(x)}
            </text>
          </g>
        );
      })}

      {/* 左侧刻度 + 纬度标签 */}
      {majorH.map((y) => (
        <g key={`lh${y}`}>
          <line className="tick" x1={0} y1={y} x2={7} y2={y} />
          <text className="coord-label" x={12} y={y + 3} textAnchor="start">
            {latLabel(y)}
          </text>
        </g>
      ))}
    </svg>
  );
}
