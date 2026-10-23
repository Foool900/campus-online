// 固定全屏星尘层：融入网站底层，不随地图平移/缩放而移动（地点星点在其上层浮动）
const W = 1600;
const H = 900;

function hash2(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  let y = Math.sin(n * 269.5 + 183.3) * 28001.8384;
  x -= Math.floor(x);
  y -= Math.floor(y);
  return [x, y];
}

// 星色：黑白灰（配合行星测绘仪灰度主题）
const COOL = ['#ffffff', '#e8e8e8', '#d4d4d4', '#c9c9c9'];
function starColor(r) {
  if (r < 0.7) return COOL[Math.floor((r / 0.7) * COOL.length)];
  if (r < 0.85) return '#bfbfbf';
  return '#f5f5f5';
}

const STARS = [];
for (let i = 0; i < 280; i++) {
  const [rx, ry] = hash2(i + 1);
  const [r1, r2] = hash2(i + 9001);
  STARS.push({
    x: rx * W,
    y: ry * H,
    r: 0.8 + r1 * 2.0,
    o: (0.15 + r2 * 0.5).toFixed(2),
    delay: (r1 * 6).toFixed(2) + 's',
    color: starColor(r2),
  });
}

export default function Starfield() {
  return (
    <svg
      className="starfield"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {STARS.map((s, i) => (
        <circle
          key={i}
          className="bg-star"
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill={s.color}
          style={{ '--o': s.o, '--delay': s.delay }}
        />
      ))}
    </svg>
  );
}
