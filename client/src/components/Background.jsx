// 全屏毛玻璃背景：参考星空图 + 模糊 + 暗化 + 卫星扫描噪点，融入站点底层
export default function Background() {
  return (
    <div className="site-background" aria-hidden="true">
      <div className="site-background-img" />
      <div className="site-background-overlay" />
      <svg className="site-background-noise">
        <filter id="scan-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#scan-noise)" />
      </svg>
    </div>
  );
}
