import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import PixelAvatar from '../components/PixelAvatar.jsx';

const SLOT_LABELS = { hair: '发型', hat: '头饰', outfit: '服装', shoes: '鞋子', accessory: '配饰' };
const SKIN_LABELS = { fair: '白皙', warm: '暖黄', tan: '小麦', deep: '深色' };
const BODY_LABELS = { slim: '纤细', standard: '标准', sturdy: '壮实' };
const FACE_LABELS = { neutral: '平静', happy: '开心', cool: '高冷', shy: '害羞' };

export default function CharacterPage() {
  const [data, setData] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const say = (text, kind = 'ok') => setToast({ text, kind });
  const refresh = useCallback(
    () => api.character().then(setData).catch((e) => say(e.message || '加载失败', 'err')),
    []
  );

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!data) {
    return <div className="page char-page"><div className="char-loading">&gt; SYNC…</div></div>;
  }

  const { base, slots, baseOptions, equipped, apparel } = data;

  const setBase = async (patch) => {
    setBusy(true);
    try {
      await api.characterBase(patch);
      await refresh();
      say('已更新形象');
    } catch (e) {
      say(e.message || '更新失败', 'err');
    } finally {
      setBusy(false);
    }
  };

  const equip = async (slot, inventoryItemId) => {
    setBusy(true);
    try {
      await api.characterEquip({ slot, inventoryItemId });
      await refresh();
      say(inventoryItemId ? '已穿戴' : '已卸下');
    } catch (e) {
      say(e.message || '操作失败', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page char-page">
      <div className="char-layout">
        <aside className="char-preview">
          <PixelAvatar base={base} equipped={equipped} size={160} />
          <div className="char-preview-meta">[ YOUR_AVATAR ]</div>
        </aside>

        <div className="char-panel">
          <section className="char-section">
            <h2 className="char-section-title">[ 底模 ]</h2>
            <div className="char-row">
              <span className="char-row-label">肤色</span>
              {baseOptions.skinTones.map((s) => (
                <button
                  key={s}
                  className={'char-chip' + (base.skinTone === s ? ' active' : '')}
                  onClick={() => setBase({ skinTone: s })}
                >
                  {SKIN_LABELS[s] || s}
                </button>
              ))}
            </div>
            <div className="char-row">
              <span className="char-row-label">体型</span>
              {baseOptions.bodies.map((b) => (
                <button
                  key={b}
                  className={'char-chip' + (base.body === b ? ' active' : '')}
                  onClick={() => setBase({ body: b })}
                >
                  {BODY_LABELS[b] || b}
                </button>
              ))}
            </div>
            <div className="char-row">
              <span className="char-row-label">表情</span>
              {baseOptions.faces.map((f) => (
                <button
                  key={f}
                  className={'char-chip' + (base.face === f ? ' active' : '')}
                  onClick={() => setBase({ face: f })}
                >
                  {FACE_LABELS[f] || f}
                </button>
              ))}
            </div>
          </section>

          <section className="char-section">
            <h2 className="char-section-title">[ 装扮 ]</h2>
            {slots.map((slot) => {
              const items = apparel.filter((a) => a.slot === slot);
              const current = equipped[slot];
              return (
                <div key={slot} className="char-slot">
                  <div className="char-slot-head">
                    <span className="char-slot-name">{SLOT_LABELS[slot] || slot}</span>
                    {current
                      ? <span className="char-slot-current">穿戴中：{current.name}</span>
                      : <span className="char-slot-empty">未穿戴</span>}
                  </div>
                  <div className="char-slot-items">
                    {items.length === 0 && <div className="char-slot-none">该部位暂无可用装扮</div>}
                    {items.map((it) => (
                      <button
                        key={it.id}
                        className={'char-item' + (current?.id === it.id ? ' equipped' : '')}
                        onClick={() => equip(slot, current?.id === it.id ? null : it.id)}
                        title={it.description || ''}
                        disabled={busy}
                      >
                        <span className="char-item-icon">{it.icon || '📦'}</span>
                        <span className="char-item-name">{it.name}</span>
                      </button>
                    ))}
                    {current && (
                      <button className="hud-btn char-unequip" onClick={() => equip(slot, null)} disabled={busy}>
                        卸下
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      </div>

      {toast && (
        <div className={toast.kind === 'ok' ? 'form-success' : 'form-error'} style={{ position: 'absolute', left: 36, bottom: 28 }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
