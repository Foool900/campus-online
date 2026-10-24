// 市场板块共享线性 SVG 图标（零 Emoji）。图标默认继承 currentColor，由外层 className 控制颜色。
function Icon({ size = 16, className = '', strokeWidth = 1.7, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export const CoinIcon = ({ size = 16, className = '' }) => (
  <Icon size={size} className={className} strokeWidth={1.5}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" opacity="0.5" />
  </Icon>
);
export const StoreIcon = (p) => <Icon {...p}><path d="M4 9l1.5-4h13L20 9M5 9v10h14V9M9 19v-5h6v5" /></Icon>;
export const BoxIcon = (p) => <Icon {...p}><path d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" /></Icon>;
export const ShieldIcon = (p) => <Icon {...p}><path d="M12 3l8 3v6c0 4.2-3.3 7-8 9-4.7-2-8-4.8-8-9V6l8-3z" /></Icon>;
export const MegaphoneIcon = (p) => <Icon {...p}><path d="M3 10v4l3 3 6 2V5L6 7l-3 3zM18 8a4 4 0 010 8" /></Icon>;
export const FlagIcon = (p) => <Icon {...p}><path d="M5 21V4M5 5l14 6-14 6" /></Icon>;
export const SendIcon = (p) => <Icon {...p}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></Icon>;
export const BellIcon = (p) => <Icon {...p}><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></Icon>;
export const ListIcon = (p) => <Icon {...p}><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></Icon>;
export const GearIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
  </Icon>
);
export const CrownIcon = (p) => <Icon {...p}><path d="M3 18l2-11 5 4 2-7 2 7 5-4 2 11H3z" /></Icon>;
export const CheckIcon = (p) => <Icon {...p}><path d="M20 6L9 17l-5-5" /></Icon>;
export const MusicIcon = (p) => <Icon {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></Icon>;
export const IdCardIcon = (p) => <Icon {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><path d="M6 16c0-1.1.9-2 2-2s2 .9 2 2M14 9h4M14 13h4" /></Icon>;
export const InboxIcon = (p) => <Icon {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /></Icon>;
