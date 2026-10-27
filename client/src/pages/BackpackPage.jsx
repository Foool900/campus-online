import { useCallback, useEffect, useState } from 'react';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';
import PixelAvatar from '../components/PixelAvatar.jsx';

// 稀有度（五档）：颜色 / 中文名，与 server 的 rarity 枚举对应
const RARITY = {
  common: { label: '普通', color: '#9aa4b2' },
  uncommon: { label: '优秀', color: '#5bc49a' },
  rare: { label: '稀有', color: '#4a90d9' },
  epic: { label: '史诗', color: '#9b8ad1' },
  legendary: { label: '传说', color: '#f5c84c' },
};
const SOURCE = { market: '市场', gacha: '卡池', story: '剧情', task: '任务', seed: '新手' };
const SLOT_LABELS = { hair: '发型', hat: '头饰', outfit: '服装', shoes: '鞋子', accessory: '配饰' };

function RarityBadge({ rarity }) {
  const r = RARITY[rarity] || RARITY.common;
  return (
    <span className="bag-rarity" style={{ color: r.color, borderColor: r.color }}>
      {r.label}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export default function BackpackPage() {
  const { user } = useUser();
  const isStudent = !!user && (user.role === 'student' || user.role === 'admin');

  const [tab, setTab] = useState('items');
  const [data, setData] = useState(null);
  const [plaza, setPlaza] = useState([]);
  const [marketOpen, setMarketOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // 交互态：出售中物品 / 选中的橱窗位 / 查看中的用户
  const [sellItem, setSellItem] = useState(null);
  const [sellPrice, setSellPrice] = useState('');
  const [pickSlot, setPickSlot] = useState(null);
  const [viewUser, setViewUser] = useState(null);
  const [viewChar, setViewChar] = useState(null);

  const say = (text, kind = 'ok') => setToast({ text, kind });

  const refresh = useCallback(async () => {
    try {
      const [inv, pub, mkt] = await Promise.all([
        api.inventory(),
        api.inventoryShowcase(),
        api.marketSession().catch(() => null),
      ]);
      setData(inv);
      setPlaza(Array.isArray(pub) ? pub : []);
      setMarketOpen(!!mkt?.session && mkt.session.status === 'open');
    } catch (e) {
      say(e.message || '加载失败', 'err');
    }
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 30000);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const doShowcase = async (itemId, slot) => {
    try {
      await api.inventorySetShowcase(itemId, slot);
      say('已放入橱窗');
      setPickSlot(null);
      refresh();
    } catch (e) {
      say(e.message || '展示失败', 'err');
    }
  };
  const doRemoveShowcase = async (itemId) => {
    try {
      await api.inventoryRemoveShowcase(itemId);
      say('已移出橱窗');
      refresh();
    } catch (e) {
      say(e.message || '移除失败', 'err');
    }
  };
  const doSell = async () => {
    if (!sellItem) return;
    try {
      await api.inventorySell(sellItem.id, Number(sellPrice));
      say('已寄售到市场');
      setSellItem(null);
      setSellPrice('');
      refresh();
    } catch (e) {
      say(e.message || '出售失败', 'err');
    }
  };
  const doUnlist = async (itemId) => {
    try {
      await api.inventoryUnlist(itemId);
      say('已下架');
      refresh();
    } catch (e) {
      say(e.message || '下架失败', 'err');
    }
  };
  const openUserShowcase = async (userId) => {
    try {
      const r = await api.inventoryShowcaseUser(userId);
      setViewUser(r);
      api.characterUser(userId).then(setViewChar).catch(() => setViewChar(null));
    } catch (e) {
      say(e.message || '加载失败', 'err');
    }
  };

  if (!data) {
    return (
      <div className="page bag-page">
        <div className="bag-loading">&gt; SYNC…</div>
      </div>
    );
  }

  const { level, maxShowcaseSlots, showcaseConfig, items, showcase, soldCount } = data;
  const sc = showcaseConfig || { baseSlots: 3, levelStep: 5, maxSlots: 10 };
  const showcaseBySlot = new Map(showcase.map((it) => [it.showcaseSlot, it]));
  const heldNotInShowcase = items.filter((it) => it.status === 'held' && it.showcaseSlot == null);
  const unlockLevelFor = (slot) => (slot < sc.baseSlots ? 1 : (slot - sc.baseSlots + 1) * sc.levelStep);

  return (
    <div className="page bag-page">
      <aside className="bag-sidebar">
        <button className={'bag-nav' + (tab === 'items' ? ' active' : '')} onClick={() => setTab('items')}>
          <span className="bag-nav-ico">🎒</span>背包
        </button>
        <button className={'bag-nav' + (tab === 'showcase' ? ' active' : '')} onClick={() => setTab('showcase')}>
          <span className="bag-nav-ico">🖼️</span>我的橱窗
        </button>
        <button className={'bag-nav' + (tab === 'plaza' ? ' active' : '')} onClick={() => setTab('plaza')}>
          <span className="bag-nav-ico">🏛️</span>橱窗广场
        </button>
      </aside>

      <div className="bag-main">
        <header className="bag-hero">
          <div className="bag-hero-title">[ BACKPACK ]</div>
          <div className="bag-hero-meta">
            LV {level} · 🖼️ {showcase.length}/{maxShowcaseSlots} 位 · 持有 {items.length} 件 · 已售 {soldCount}
            {marketOpen ? <span className="bag-open"> 市场开市中</span> : <span className="bag-closed"> 市场未开市</span>}
          </div>
        </header>

        {toast && <div className={toast.kind === 'ok' ? 'form-success' : 'form-error'} style={{ marginBottom: 10 }}>{toast.text}</div>}

        <div className="bag-content">
          {tab === 'items' && (
            <ItemsTab
              items={items}
              showcaseBySlot={showcaseBySlot}
              marketOpen={marketOpen}
              isStudent={isStudent}
              onShowcaseQuick={(itemId) => {
                const free = heldNotInShowcase.find((it) => it.id === itemId);
                if (free == null) return;
                const slot = [...Array(maxShowcaseSlots).keys()].find((s) => !showcaseBySlot.has(s));
                if (slot == null) { say('橱窗已满', 'err'); return; }
                doShowcase(itemId, slot);
              }}
              onSell={(item) => { setSellItem(item); setSellPrice(''); }}
              onUnlist={doUnlist}
            />
          )}

          {tab === 'showcase' && (
            <ShowcaseTab
              maxSlots={maxShowcaseSlots}
              showcaseBySlot={showcaseBySlot}
              level={level}
              sc={sc}
              unlockLevelFor={unlockLevelFor}
              heldNotInShowcase={heldNotInShowcase}
              pickSlot={pickSlot}
              onPickSlot={setPickSlot}
              onPlace={doShowcase}
              onRemove={doRemoveShowcase}
            />
          )}

          {tab === 'plaza' && (
            <PlazaTab
              plaza={plaza}
              viewUser={viewUser}
              viewChar={viewChar}
              onOpenUser={openUserShowcase}
              onCloseUser={() => { setViewUser(null); setViewChar(null); }}
            />
          )}
        </div>
      </div>

      {/* 出售弹层 */}
      {sellItem && (
        <div className="bag-modal-backdrop" onClick={() => setSellItem(null)}>
          <div className="bag-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bag-modal-title">寄售「{sellItem.name}」</div>
            <div className="bag-modal-hint">开市期间挂到市场，买家购买确认后金币入账、物品转给买家。</div>
            <input
              className="bag-input"
              type="number"
              min="1"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              placeholder="挂牌价（金币）"
            />
            <div className="bag-modal-actions">
              <button className="hud-btn" onClick={() => setSellItem(null)}>取消</button>
              <button className="hud-btn" onClick={doSell}>确认寄售</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 背包 =====
function ItemsTab({ items, showcaseBySlot, marketOpen, isStudent, onShowcaseQuick, onSell, onUnlist }) {
  if (items.length === 0) {
    return <div className="bag-empty"><div className="bag-empty-ico">🎒</div><div>背包空空如也</div><div className="bag-empty-sub">去市场逛逛，或等待剧情 / 卡池掉落</div></div>;
  }
  return (
    <div className="bag-grid">
      {items.map((it) => {
        const inShowcase = it.showcaseSlot != null;
        return (
          <div key={it.id} className={'bag-card' + (it.status === 'listed' ? ' listed' : '')}>
            <div className="bag-card-icon">{it.icon || '📦'}</div>
            <div className="bag-card-body">
              <div className="bag-card-name">{it.name}</div>
              <RarityBadge rarity={it.rarity} />
              <div className="bag-card-desc">{it.description || '—'}</div>
              <div className="bag-card-tags">
                <span className="bag-tag">{SOURCE[it.source] || it.source}</span>
                {it.kind === 'apparel' && <span className="bag-tag showcase">{SLOT_LABELS[it.slot] || it.slot}</span>}
                {inShowcase && <span className="bag-tag showcase">橱窗 #{it.showcaseSlot + 1}</span>}
                {it.status === 'listed' && <span className="bag-tag listed">寄售中 ¥{it.listPriceCoin}</span>}
              </div>
            </div>
            <div className="bag-card-actions">
              {it.status === 'listed' ? (
                <button className="hud-btn" onClick={() => onUnlist(it.id)}>下架</button>
              ) : (
                <>
                  {!inShowcase && (
                    <button className="hud-btn" onClick={() => onShowcaseQuick(it.id)}>放入橱窗</button>
                  )}
                  {isStudent && (
                    <button
                      className="hud-btn"
                      disabled={!marketOpen}
                      title={marketOpen ? '' : '市场未开市'}
                      onClick={() => onSell(it)}
                    >
                      出售
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== 我的橱窗 =====
function ShowcaseTab({ maxSlots, showcaseBySlot, level, sc, unlockLevelFor, heldNotInShowcase, pickSlot, onPickSlot, onPlace, onRemove }) {
  const slots = Array.from({ length: maxSlots }, (_, i) => i);
  return (
    <div className="bag-showcase">
      <div className="bag-showcase-head">
        展览位 {showcaseBySlot.size}/{maxSlots} —— 每升 {sc.levelStep} 级解锁 1 位（当前 LV {level}）
      </div>
      <div className="bag-slots">
        {slots.map((slot) => {
          const it = showcaseBySlot.get(slot);
          const locked = level < unlockLevelFor(slot);
          return (
            <div key={slot} className={'bag-slot' + (locked ? ' locked' : '') + (pickSlot === slot ? ' picking' : '')}>
              {it ? (
                <>
                  <div className="bag-slot-icon">{it.icon}</div>
                  <div className="bag-slot-name">{it.name}</div>
                  <RarityBadge rarity={it.rarity} />
                  <button className="hud-btn bag-slot-btn" onClick={() => onRemove(it.id)}>移出</button>
                </>
              ) : locked ? (
                <div className="bag-slot-lock">🔒<br />LV {unlockLevelFor(slot)} 解锁</div>
              ) : (
                <button className="bag-slot-empty" onClick={() => onPickSlot(slot)}>+ 空位</button>
              )}
            </div>
          );
        })}
      </div>

      {pickSlot != null && (
        <div className="bag-picker">
          <div className="bag-picker-title">选择要放入第 {pickSlot + 1} 位的物品</div>
          {heldNotInShowcase.length === 0 ? (
            <div className="bag-empty-sub">没有可展示的物品（先去背包持有物品）</div>
          ) : (
            heldNotInShowcase.map((it) => (
              <button key={it.id} className="bag-picker-item" onClick={() => onPlace(it.id, pickSlot)}>
                <span>{it.icon}</span> {it.name} <RarityBadge rarity={it.rarity} />
              </button>
            ))
          )}
          <button className="hud-btn" onClick={() => onPickSlot(null)}>取消</button>
        </div>
      )}
    </div>
  );
}

// ===== 橱窗广场 =====
function PlazaTab({ plaza, viewUser, viewChar, onOpenUser, onCloseUser }) {
  if (viewUser) {
    return (
      <div className="bag-plaza">
        <button className="hud-btn" onClick={onCloseUser}>← 返回广场</button>
        <div className="bag-user-head">
          {viewChar
            ? <PixelAvatar base={viewChar.base} equipped={viewChar.equipped} size={56} />
            : <span className="bag-user-avatar">{viewUser.user?.avatar || '🎓'}</span>}
          <span className="bag-user-name">{viewUser.user?.nickname}</span>
          <span className="bag-user-level">LV {viewUser.user?.level ?? 1}</span>
        </div>
        {viewUser.items?.length === 0 ? (
          <div className="bag-empty-sub">TA 还没有展览任何物品</div>
        ) : (
          <div className="bag-grid">
            {viewUser.items.map((it) => (
              <div key={it.id} className="bag-card">
                <div className="bag-card-icon">{it.icon}</div>
                <div className="bag-card-body">
                  <div className="bag-card-name">{it.name}</div>
                  <RarityBadge rarity={it.rarity} />
                  <div className="bag-card-desc">{it.description || '—'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 按用户分组
  const groups = [];
  for (const it of plaza) {
    const last = groups[groups.length - 1];
    if (last && last.ownerId === it.ownerId) last.items.push(it);
    else groups.push({ ownerId: it.ownerId, ownerName: it.ownerName, ownerAvatar: it.ownerAvatar, ownerLevel: it.ownerLevel, items: [it] });
  }

  if (groups.length === 0) {
    return <div className="bag-empty"><div className="bag-empty-ico">🏛️</div><div>橱窗广场还没有展品</div><div className="bag-empty-sub">去「我的橱窗」摆出你的收藏吧</div></div>;
  }

  return (
    <div className="bag-plaza">
      {groups.map((g) => (
        <div key={g.ownerId} className="bag-plaza-group" onClick={() => onOpenUser(g.ownerId)}>
          <div className="bag-user-head">
            <span className="bag-user-avatar">{g.ownerAvatar || '🎓'}</span>
            <span className="bag-user-name">{g.ownerName}</span>
            <span className="bag-user-level">LV {g.ownerLevel ?? 1}</span>
          </div>
          <div className="bag-plaza-items">
            {g.items.map((it) => (
              <div key={it.id} className="bag-plaza-item" title={it.description || ''}>
                <span className="bag-plaza-item-icon">{it.icon}</span>
                <span className="bag-plaza-item-name">{it.name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
