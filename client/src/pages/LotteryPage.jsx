import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';

// 抽卡结果里的稀有度取颜色（供揭示动画着色）
const RARITY_COLOR = { common: '#9aa4b2', uncommon: '#5bc49a', rare: '#4a90d9', epic: '#9b8ad1', legendary: '#f5c84c' };

function prizeColor(v) {
  if (v >= 100) return '#f5c84c';
  if (v >= 50) return '#9b8ad1';
  if (v >= 20) return '#4a90d9';
  return '#5bc49a';
}

export default function LotteryPage() {
  const { user } = useUser();
  const isStudent = !!user && (user.role === 'student' || user.role === 'admin');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'story' ? 'story' : params.get('tab') === 'wardrobe' ? 'wardrobe' : 'coin';

  const [coinInfo, setCoinInfo] = useState(null);
  const [pools, setPools] = useState(null);
  const [wardrobePools, setWardrobePools] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const loadCoin = useCallback(() => api.lotteryInfo().then(setCoinInfo).catch((e) => setErr(e.message)), []);
  const loadPools = useCallback(() => api.storyPools().then(setPools).catch((e) => setErr(e.message)), []);
  const loadWardrobePools = useCallback(() => api.wardrobePools().then(setWardrobePools).catch((e) => setErr(e.message)), []);

  useEffect(() => {
    loadCoin();
    loadPools();
    loadWardrobePools();
  }, [loadCoin, loadPools, loadWardrobePools]);

  const switchTab = (t) => {
    setResult(null);
    setErr('');
    setParams(t === 'coin' ? {} : { tab: t }, { replace: true });
  };

  const drawCoin = async () => {
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const r = await api.lotteryDraw();
      setResult({ type: 'coin', ...r });
      loadCoin();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const drawStory = async (poolId) => {
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const r = await api.storyPoolDraw(poolId);
      setResult({ type: 'story', ...r });
      loadPools();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const drawWardrobe = async (poolId) => {
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const r = await api.wardrobePoolDraw(poolId);
      setResult({ type: 'wardrobe', ...r });
      loadWardrobePools();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gacha-page">
      <div className="gacha-head">
        <div className="gacha-title">[ GACHA ] 卡池</div>
        <div className="gacha-sub">// 抽金币 · 抽剧情 · 抽装扮 —— 什么都能抽</div>
      </div>

      <div className="gacha-tabs">
        <button className={'gacha-tab' + (tab === 'coin' ? ' active' : '')} onClick={() => switchTab('coin')}>
          <span className="gacha-tab-ico">🪙</span>金币祈愿
        </button>
        <button className={'gacha-tab' + (tab === 'story' ? ' active' : '')} onClick={() => switchTab('story')}>
          <span className="gacha-tab-ico">📖</span>剧情祈愿
        </button>
        <button className={'gacha-tab' + (tab === 'wardrobe' ? ' active' : '')} onClick={() => switchTab('wardrobe')}>
          <span className="gacha-tab-ico">🧥</span>装扮祈愿
        </button>
      </div>

      {err && <div className="form-error" style={{ marginBottom: 12 }}>{err}</div>}

      {tab === 'coin' ? (
        <CoinBanner info={coinInfo} busy={busy} isStudent={isStudent} onDraw={drawCoin} />
      ) : tab === 'story' ? (
        <StoryBanners pools={pools} busy={busy} isStudent={isStudent} onDraw={drawStory} />
      ) : (
        <WardrobeBanners pools={wardrobePools} busy={busy} isStudent={isStudent} onDraw={drawWardrobe} />
      )}

      {result && <ResultReveal result={result} onClose={() => setResult(null)} />}
    </div>
  );
}

function CoinBanner({ info, busy, isStudent, onDraw }) {
  if (!info) return <div className="gacha-loading">&gt; SYNC…</div>;
  return (
    <div className="gacha-banner">
      <div className="gacha-banner-hero" style={{ '--glow': '#f5c84c' }}>
        <div className="gacha-banner-rings" />
        <div className="gacha-banner-emblem">🪙</div>
        <div className="gacha-banner-name">常驻祈愿 · 金币</div>
        <div className="gacha-banner-desc">市场手续费流入奖池，祈愿奖金从奖池支出</div>
      </div>
      <div className="gacha-banner-body">
        <div className="gacha-info-row">
          <span className="gacha-info-chip">奖池余额 <b>{info.treasury}</b> 金币</span>
          <span className="gacha-info-chip">单抽消耗 <b>{info.cost}</b> 金币</span>
        </div>
        <div className="gacha-section-title">本次祈愿可获得</div>
        <div className="gacha-prize-list">
          {info.prizes.map((p) => (
            <div key={p} className="gacha-prize" style={{ '--c': prizeColor(p) }}>
              <div className="gacha-prize-ico">🪙</div>
              <div className="gacha-prize-val">{p}</div>
            </div>
          ))}
        </div>
        <div className="gacha-draw-row">
          {isStudent ? (
            <button className="gacha-draw-btn" disabled={busy || !info} onClick={onDraw}>
              {busy ? '祈愿中…' : `祈愿 ×1（${info.cost} 金币）`}
            </button>
          ) : (
            <span className="gacha-locked">🔒 需实名认证后才能祈愿</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StoryBanners({ pools, busy, isStudent, onDraw }) {
  if (!pools) return <div className="gacha-loading">&gt; SYNC…</div>;
  if (pools.length === 0) {
    return <div className="gacha-empty"><div className="gacha-empty-ico">🎁</div><div>暂无开放的剧情祈愿</div></div>;
  }
  return (
    <div className="gacha-story-list">
      {pools.map((p) => {
        const left = p.entryCount - p.ownedCount;
        return (
          <div key={p.id} className="gacha-banner">
            <div className="gacha-banner-hero" style={{ '--glow': '#8fd3ff' }}>
              <div className="gacha-banner-rings" />
              <div className="gacha-banner-emblem">{p.icon || '📖'}</div>
              <div className="gacha-banner-name">{p.name}</div>
              <div className="gacha-banner-desc">未拥有 {left} / {p.entryCount} · 单抽消耗 {p.drawCostCoin} 金币</div>
            </div>
            <div className="gacha-banner-body">
              <div className="gacha-section-title">祈愿可获得剧情</div>
              <div className="gacha-story-entries">
                {p.entries.map((e) => (
                  <div key={e.storyId} className={'gacha-story-entry' + (e.owned ? ' owned' : '')}>
                    <div className="gacha-story-entry-cover">{e.cover}</div>
                    <div className="gacha-story-entry-name">{e.title}</div>
                  </div>
                ))}
              </div>
              <div className="gacha-draw-row">
                {left === 0 ? (
                  <span className="gacha-locked">已集齐全部剧情</span>
                ) : isStudent ? (
                  <button className="gacha-draw-btn" disabled={busy} onClick={() => onDraw(p.id)}>
                    {busy ? '祈愿中…' : `祈愿 ×1（${p.drawCostCoin} 金币）`}
                  </button>
                ) : (
                  <span className="gacha-locked">🔒 需实名认证后才能祈愿</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WardrobeBanners({ pools, busy, isStudent, onDraw }) {
  if (!pools) return <div className="gacha-loading">&gt; SYNC…</div>;
  if (pools.length === 0) {
    return <div className="gacha-empty"><div className="gacha-empty-ico">🧥</div><div>暂无开放的装扮祈愿</div></div>;
  }
  return (
    <div className="gacha-story-list">
      {pools.map((p) => {
        const left = p.entryCount - p.ownedCount;
        return (
          <div key={p.id} className="gacha-banner">
            <div className="gacha-banner-hero" style={{ '--glow': '#9b8ad1' }}>
              <div className="gacha-banner-rings" />
              <div className="gacha-banner-emblem">{p.icon || '🧥'}</div>
              <div className="gacha-banner-name">{p.name}</div>
              <div className="gacha-banner-desc">未拥有 {left} / {p.entryCount} · 单抽消耗 {p.drawCostCoin} 金币</div>
            </div>
            <div className="gacha-banner-body">
              <div className="gacha-section-title">祈愿可获得装扮</div>
              <div className="gacha-story-entries">
                {p.entries.map((e) => (
                  <div key={e.wardrobeItemId} className={'gacha-story-entry' + (e.owned ? ' owned' : '')}>
                    <div className="gacha-story-entry-cover">{e.icon}</div>
                    <div className="gacha-story-entry-name">{e.name}</div>
                  </div>
                ))}
              </div>
              <div className="gacha-draw-row">
                {left === 0 ? (
                  <span className="gacha-locked">已集齐全部装扮</span>
                ) : isStudent ? (
                  <button className="gacha-draw-btn" disabled={busy} onClick={() => onDraw(p.id)}>
                    {busy ? '祈愿中…' : `祈愿 ×1（${p.drawCostCoin} 金币）`}
                  </button>
                ) : (
                  <span className="gacha-locked">🔒 需实名认证后才能祈愿</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResultReveal({ result, onClose }) {
  const isCoin = result.type === 'coin';
  const isWardrobe = result.type === 'wardrobe';
  let color;
  let emoji;
  let title;
  let sub;
  if (isCoin) {
    color = result.prize > 0 ? '#f5c84c' : '#9aa4b2';
    emoji = '🪙';
    title = result.prize > 0 ? `获得 ${result.prize} 金币！` : '谢谢参与';
    sub = `花费 ${result.cost}，净赚 ${result.net}`;
  } else if (isWardrobe) {
    color = RARITY_COLOR[result.item?.rarity] || '#9b8ad1';
    emoji = result.item?.icon || '🧥';
    title = `获得装扮「${result.item?.name}」`;
    sub = '已发放到你的背包';
  } else {
    const rewards = result.story?.rewards || {};
    const items = rewards.items || [];
    color = items.reduce((acc, it) => (RARITY_COLOR[it.rarity] && it.rarity !== 'common' ? RARITY_COLOR[it.rarity] : acc), '#8fd3ff');
    emoji = result.story?.cover || '📖';
    title = `获得剧情「${result.story?.title}」`;
    sub = '已发放到你的剧情库';
  }

  return (
    <div className="gacha-reveal-backdrop" onClick={onClose}>
      <div className="gacha-reveal" style={{ '--c': color }} onClick={(e) => e.stopPropagation()}>
        <div className="gacha-reveal-star">✦</div>
        <div className="gacha-reveal-emoji">{emoji}</div>
        <div className="gacha-reveal-title">{title}</div>
        <div className="gacha-reveal-sub">{sub}</div>
        <button className="gacha-reveal-btn" onClick={onClose}>确认</button>
      </div>
    </div>
  );
}
