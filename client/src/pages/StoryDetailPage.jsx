import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';

const CHECKIN_LABEL = { none: '纯打卡', text: '写文字', photo: '传图片', link: '附链接' };
const RARITY_COLOR = { common: '#9aa4b2', uncommon: '#5bc49a', rare: '#4a90d9', epic: '#9b8ad1', legendary: '#f5c84c' };
const MOOD_ICON = { 宁静: '📖', 热闹: '🎆', 自在: '🌿' };

// 选项统一取 label：兼容对象数组（分支互动）与字符串数组（旧）
function choiceLabelOf(node) {
  if (!node || !node.choice) return '';
  if (!Array.isArray(node.choices)) return node.choice;
  const hit = node.choices.find((c) => (typeof c === 'object' ? c.value : c) === node.choice);
  if (!hit) return node.choice;
  return typeof hit === 'object' ? (hit.label || hit.value) : hit;
}

export default function StoryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const isStudent = !!user && (user.role === 'student' || user.role === 'admin');

  const [data, setData] = useState(null);
  const [toast, setToast] = useState(null);
  const [activeNode, setActiveNode] = useState(null);
  const [proof, setProof] = useState({ text: '', imageUrl: '', link: '' });
  const [choice, setChoice] = useState('');
  const [readPopups, setReadPopups] = useState(() => new Set());
  const [popupNode, setPopupNode] = useState(null);

  const say = (text, kind = 'ok') => setToast({ text, kind });

  const refresh = useCallback(async () => {
    try {
      setData(await api.story(id));
    } catch (e) {
      say(e.message || '加载失败', 'err');
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const doClaim = async () => {
    try {
      await api.storyClaim(id);
      say('已领取剧情');
      refresh();
    } catch (e) {
      say(e.message || '领取失败', 'err');
    }
  };

  const openCheckin = (node) => {
    setActiveNode(node);
    setProof({ text: '', imageUrl: '', link: '' });
    setChoice('');
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const r = await api.storyUpload(file);
      setProof((p) => ({ ...p, imageUrl: r.url }));
      say('图片已上传');
    } catch (err) {
      say(err.message || '上传失败', 'err');
    }
  };

  const doCheckin = async (skipProof = false) => {
    if (!activeNode) return;
    const body = {
      nodeId: activeNode.id,
      proof: skipProof ? {} : { text: proof.text, imageUrl: proof.imageUrl, link: proof.link },
      flags: { readPopup: readPopups.has(activeNode.id) },
    };
    if (choice) body.choice = choice;
    try {
      const r = await api.storyCheckin(id, body);
      if (r.completed) {
        say(r.ending ? `🎉 达成结局：${r.ending.title}` : '🎉 剧情完成，奖励已发放');
      } else if (r.dropped && r.dropped.length) {
        say(`🎒 获得：${r.dropped.join('、')}`);
      } else {
        say('已打卡');
      }
      setActiveNode(null);
      refresh();
    } catch (e) {
      say(e.message || '打卡失败', 'err');
    }
  };

  const openPopup = (node) => {
    setPopupNode(node);
    setReadPopups((prev) => new Set(prev).add(node.id));
  };

  const copyMemorial = async () => {
    if (!data) return;
    const { nodes, myRun, ending, backpack } = data;
    const campus = myRun?.state?.campus || '—';
    const prologue = nodes.find((n) => n.seq === 1);
    const intro = prologue?.proof?.text || '';
    const lines = [
      `《${data.story.title}》我的纪念页`,
      `校区：${campus}`,
      intro ? `我的自我介绍：${intro}` : '',
    ];
    nodes.forEach((n) => {
      if (!n.checked) return;
      const lbl = choiceLabelOf(n);
      if (n.proof?.text) lines.push(`· ${n.title}：${n.proof.text}`);
      if (lbl) lines.push(`· ${n.title} 选择：${lbl}`);
    });
    if (ending) lines.push(`结局：${ending.title} —— ${ending.text}`);
    if (backpack?.length) lines.push(`背包：${backpack.map((b) => b.icon + b.name).join('、')}`);
    try {
      await navigator.clipboard.writeText(lines.filter(Boolean).join('\n'));
      say('纪念文案已复制到剪贴板');
    } catch {
      say('复制失败，请手动选择文字', 'err');
    }
  };

  if (!data) {
    return <div className="page story-page"><div className="story-loading">&gt; SYNC…</div></div>;
  }

  const { story, nodes, myRun, ending, backpack, obtainable } = data;
  const rewards = story.rewards || {};
  const rewardItems = rewards.items || [];
  const campus = myRun?.state?.campus || null;
  const mood = myRun?.state?.mood || { 宁静: 0, 热闹: 0, 自在: 0 };
  const energy = myRun?.state?.energy || 0;
  const completed = myRun?.status === 'completed';
  const checkedCount = nodes.filter((n) => n.checked).length;

  // 节点正文：优先取当前校区文案，回退通用描述
  const bodyText = (n) => {
    if (n.campusVariants && campus && n.campusVariants[campus]) return n.campusVariants[campus];
    return n.description;
  };

  return (
    <div className="page story-detail">
      <div className="story-detail-head">
        <button className="hud-btn" onClick={() => navigate('/story')}>← 剧情大厅</button>
        <div className="story-detail-title">
          <span className="story-detail-cover">{story.cover || '📖'}</span>
          <div>
            <div className="story-detail-name">{story.title}</div>
            <div className="story-detail-sub">{story.subtitle || ''}</div>
          </div>
        </div>
        <div className="story-detail-meta">
          {story.availability === 'festival' && <span className="story-tag">节日限定</span>}
          <span className="story-tag">{story.category}</span>
          {campus && <span className="story-tag">📍 {campus}</span>}
        </div>
      </div>

      {toast && <div className={toast.kind === 'ok' ? 'form-success' : 'form-error'} style={{ marginBottom: 12 }}>{toast.text}</div>}

      {/* 奖励预览 */}
      <div className="story-rewards">
        <span className="story-rewards-label">完成奖励</span>
        {Number(rewards.exp) > 0 && <span className="story-reward">⭐ +{rewards.exp} 经验</span>}
        {Number(rewards.coin) > 0 && <span className="story-reward">🪙 +{rewards.coin} 金币</span>}
        {rewardItems.map((it, i) => (
          <span key={i} className="story-reward" style={{ color: RARITY_COLOR[it.rarity] || 'var(--text)' }}>
            {it.icon || '🎁'} {it.name}
          </span>
        ))}
        {!rewards.exp && !rewards.coin && rewardItems.length === 0 && <span className="story-reward">无</span>}
      </div>

      {/* 未获得：领取入口 */}
      {!myRun && (
        <div className="story-gate">
          {obtainable ? (
            isStudent ? (
              <button className="hud-btn story-gate-btn" onClick={doClaim}>领取并开始</button>
            ) : (
              <div className="story-gate-hint">🔒 需实名认证（student）后才能领取剧情</div>
            )
          ) : (
            <div className="story-gate-hint">🔒 该剧情需通过任务解锁或奖池获取</div>
          )}
        </div>
      )}

      {/* 结局 + 纪念页（完成态） */}
      {completed && (
        <div className="story-memorial">
          {ending && (
            <div className="story-ending">
              <div className="story-ending-title">🏁 {ending.title}</div>
              <div className="story-ending-text">{ending.text}</div>
            </div>
          )}
          <div className="story-memorial-head">
            <div className="story-memorial-title">📔 我的纪念页</div>
            <button className="hud-btn" onClick={copyMemorial}>📋 复制纪念文案</button>
          </div>
          <div className="story-memorial-meta">
            <span>📍 校区：{campus || '—'}</span>
            <span>⭐ 印记：{checkedCount}/{nodes.length}</span>
            <span>
              心情：
              {Object.entries(mood).map(([k, v]) => v > 0 ? `${MOOD_ICON[k] || ''}${k}${v}` : '').filter(Boolean).join(' · ') || '—'}
            </span>
            {energy > 0 && <span>⚡ 精力 +{energy}</span>}
          </div>
          {backpack && backpack.length > 0 && (
            <div className="story-memorial-items">
              {backpack.map((b, i) => (
                <span key={i} className="story-memorial-item" style={{ borderColor: RARITY_COLOR[b.rarity] || 'var(--glass-line)' }} title={b.description}>
                  {b.icon} {b.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 节点时间线 */}
      <div className="story-timeline">
        {nodes.map((n) => {
          const state = n.checked ? 'done' : n.unlocked ? 'open' : 'locked';
          const lbl = choiceLabelOf(n);
          return (
            <div key={n.id} className={'story-node ' + state}>
              <div className="story-node-marker">
                {n.checked ? '✓' : n.unlocked ? n.seq : '🔒'}
              </div>
              <div className="story-node-body">
                <div className="story-node-title">
                  {n.title}
                  <span className="story-node-type">{CHECKIN_LABEL[n.checkinType] || n.checkinType}{n.optionalProof ? ' · 可跳过' : ''}</span>
                </div>
                <div className="story-node-desc">{bodyText(n)}</div>
                {n.tips && <div className="story-node-tip">💡 {n.tips}</div>}
                {n.popup && (
                  <button className="hud-btn story-popup-btn" onClick={() => openPopup(n)}>
                    🔎 {n.popup.title || '冷知识'}{readPopups.has(n.id) ? ' ✓' : ''}
                  </button>
                )}
                {n.checked && lbl && <div className="story-node-choice">你的选择：{lbl}</div>}
                {n.checked && n.proof?.text && <div className="story-node-proof">“{n.proof.text}”</div>}
                {n.checked && n.proof?.imageUrl && <img className="story-node-img" src={n.proof.imageUrl} alt="" />}
                {state === 'open' && (
                  <button className="hud-btn story-node-btn" onClick={() => openCheckin(n)}>打卡</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 科普弹窗 */}
      {popupNode && popupNode.popup && (
        <div className="story-modal-backdrop" onClick={() => setPopupNode(null)}>
          <div className="story-modal" onClick={(e) => e.stopPropagation()}>
            <div className="story-modal-title">🔎 {popupNode.popup.title || '冷知识'}</div>
            <div className="story-popup-body">{popupNode.popup.body}</div>
            <div className="story-modal-actions">
              <button className="hud-btn" onClick={() => setPopupNode(null)}>已读完</button>
            </div>
          </div>
        </div>
      )}

      {/* 打卡弹层 */}
      {activeNode && (
        <div className="story-modal-backdrop" onClick={() => setActiveNode(null)}>
          <div className="story-modal" onClick={(e) => e.stopPropagation()}>
            <div className="story-modal-title">打卡 · {activeNode.title}</div>
            {activeNode.choices && activeNode.choices.length > 0 && (
              <div className="story-choice-list">
                <div className="story-modal-hint">选择一项（会记入你的时间线故事书）</div>
                {activeNode.choices.map((c) => {
                  const val = typeof c === 'object' ? c.value : c;
                  const lbl = typeof c === 'object' ? (c.label || c.value) : c;
                  return (
                    <button key={val} className={'story-choice' + (choice === val ? ' active' : '')} onClick={() => setChoice(val)}>{lbl}</button>
                  );
                })}
              </div>
            )}
            {activeNode.checkinType === 'text' && (
              <textarea className="story-input" rows="3" placeholder="写下你的打卡文字…" value={proof.text} onChange={(e) => setProof({ ...proof, text: e.target.value })} />
            )}
            {activeNode.checkinType === 'photo' && (
              <div className="story-photo">
                <input className="story-file" type="file" accept="image/*" onChange={handlePhotoUpload} />
                {proof.imageUrl && <img className="story-node-img" src={proof.imageUrl} alt="打卡图片预览" />}
                <input className="story-input" placeholder="或粘贴图片链接" value={proof.imageUrl} onChange={(e) => setProof({ ...proof, imageUrl: e.target.value })} />
              </div>
            )}
            {activeNode.checkinType === 'link' && (
              <input className="story-input" placeholder="粘贴链接" value={proof.link} onChange={(e) => setProof({ ...proof, link: e.target.value })} />
            )}
            <div className="story-modal-actions">
              {activeNode.optionalProof && (
                <button className="hud-btn" onClick={() => doCheckin(true)}>跳过</button>
              )}
              <button className="hud-btn" onClick={() => setActiveNode(null)}>取消</button>
              <button className="hud-btn" onClick={() => doCheckin(false)}>确认打卡</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
