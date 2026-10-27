import { useEffect, useState } from 'react';
import { api } from '../api.js';

// 盲盒保证金/保底：与后端 listItem 同一公式、同一 ratio（缺省 0.8 / 0.1）
function blindboxAmounts(priceNum, cfg) {
  const deposit = Math.max(1, Math.floor(priceNum * (cfg?.blindboxDepositRatio ?? 0.8)));
  const minValue = Math.max(1, Math.floor(priceNum * (cfg?.blindboxMinValueRatio ?? 0.1)));
  return { deposit, minValue };
}

// 上架表单：普通 / 盲盒（盲盒强制单件，上架冻结保证金）。
// 受控组件：mktConfig/sessionId/myStall/open 由 MarketPage 传入，成功/失败通过回调上报。
export default function MarketListItemForm({ myStall, open, mktConfig, sessionId, onChanged, onError, onSuccess }) {
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [type, setType] = useState('normal');
  const [description, setDescription] = useState('');
  const [boxContent, setBoxContent] = useState('');
  const [wardrobeCode, setWardrobeCode] = useState('');
  const [wardrobeItems, setWardrobeItems] = useState([]);

  useEffect(() => { api.wardrobe().then(setWardrobeItems).catch(() => {}); }, []);

  const priceNum = Number(price);
  const blindboxPreview = type === 'blindbox' && mktConfig && Number.isInteger(priceNum) && priceNum > 0
    ? blindboxAmounts(priceNum, mktConfig)
    : null;

  const createItem = async (e) => {
    e.preventDefault();
    const p = Number(price);
    if (!title.trim() || !Number.isInteger(p) || p <= 0) return onError && onError('请填写标题和正整数价格');

    const body = { sessionId, title: title.trim(), priceCoin: p, type };
    if (description.trim()) body.description = description.trim();
    if (wardrobeCode) body.wardrobeCode = wardrobeCode;
    if (type === 'blindbox') {
      body.stock = 1; // 盲盒强制单件
      if (boxContent.trim()) body.contentJson = { text: boxContent.trim() }; // 留空不传
    }
    const amounts = type === 'blindbox' ? blindboxAmounts(p, mktConfig) : null;

    let itemId = null;
    try {
      const r = await api.marketCreateItem(body);
      itemId = r.itemId;
      await api.marketListItem(itemId, { stallId: myStall.id });
      setTitle(''); setPrice(''); setDescription(''); setBoxContent(''); setType('normal'); setWardrobeCode('');
      onChanged && onChanged();
      onSuccess && onSuccess(type === 'blindbox' ? `盲盒已上架（已冻结保证金 ${amounts.deposit} 金币）` : '已上架');
    } catch (e2) {
      // listItem 失败（如保证金不足）：best-effort 清掉刚建的 draft，一次尝试、静默失败
      if (itemId) { try { await api.marketRemoveItem(itemId); } catch { /* 忽略 */ } }
      if (e2.code === 'COIN_INSUFFICIENT') onError && onError(`金币不足：上架盲盒需冻结保证金 ${amounts.deposit} 金币，当前余额不够`);
      else if (e2.code === 'SENSITIVE_CONTENT') onError && onError('内容包含违规词，请修改');
      else onError && onError(e2.message);
    }
  };

  // 仅「营业中且开市」才显示上架表单
  if (myStall?.status !== 'occupied' || !open) return null;

  return (
    <form className="card" onSubmit={createItem} style={{ marginBottom: 12 }}>
      <div className="row">
        <div className="field" style={{ flex: 2 }}>
          <label>商品标题 *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="卖什么？" />
        </div>
        <div className="field">
          <label>价格（金币）*</label>
          <input type="number" min="1" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="field">
          <label>类型</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="normal">普通</option>
            <option value="blindbox">盲盒</option>
          </select>
        </div>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>商品描述</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="补充描述（可选）" style={{ width: '100%', boxSizing: 'border-box' }} />
      </div>
      {type === 'normal' && (
        <div className="field" style={{ marginTop: 8 }}>
          <label>装扮模板（可选，成交后买家获得该装扮）</label>
          <select value={wardrobeCode} onChange={(e) => setWardrobeCode(e.target.value)}>
            <option value="">普通商品（不关联装扮）</option>
            {wardrobeItems.map((w) => (
              <option key={w.code} value={w.code}>{w.icon} {w.name}</option>
            ))}
          </select>
        </div>
      )}
      {type === 'blindbox' && (
        <div className="field" style={{ marginTop: 8 }}>
          <label>盲盒内容</label>
          <textarea value={boxContent} onChange={(e) => setBoxContent(e.target.value)} rows={2} placeholder="盒子里装什么？（留空则默认惊喜）" style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
        </div>
      )}
      {type === 'blindbox' && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          {blindboxPreview
            ? `上架将冻结 ${blindboxPreview.deposit} 金币保证金，保底价值 ${blindboxPreview.minValue} 金币`
            : mktConfig ? '请输入正整数价格查看保证金预览' : '上架将按标价比例计算保证金与保底价值'}
        </div>
      )}
      <button type="submit" className="btn primary">＋ 上架</button>
    </form>
  );
}
