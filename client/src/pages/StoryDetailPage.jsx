import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';

const CHECKIN_LABEL = { none: '纯打卡', text: '写文字', photo: '传图片', link: '附链接' };
const RARITY_COLOR = { common: '#9aa4b2', uncommon: '#5bc49a', rare: '#4a90d9', epic: '#9b8ad1', legendary: '#f5c84c' };

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

  const doCheckin = async () => {
    if (!activeNode) return;
    const body = {
      nodeId: activeNode.id,
      proof: { text: proof.text, imageUrl: proof.imageUrl, link: proof.link },
    };
    if (choice) body.choice = choice;
    try {
      const r = await api.storyCheckin(id, body);
      if (r.completed) say('🎉 剧情完成，奖励已发放');
      else say('已打卡');
      setActiveNode(null);
      refresh();
    } catch (e) {
      say(e.message || '打卡失败', 'err');
    }
  };

  if (!data) {
    return <div className="page story-page"><div className="story-loading">&gt; SYNC…</div></div>;
  }

  const { story, nodes, myRun, obtainable } = data;
  const rewards = story.rewards || {};
  const rewardItems = rewards.items || [];

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

      {/* 节点时间线 */}
      <div className="story-timeline">
        {nodes.map((n) => {
          const state = n.checked ? 'done' : n.unlocked ? 'open' : 'locked';
          return (
            <div key={n.id} className={'story-node ' + state}>
              <div className="story-node-marker">
                {n.checked ? '✓' : n.unlocked ? n.seq : '🔒'}
              </div>
              <div className="story-node-body">
                <div className="story-node-title">
                  {n.title}
                  <span className="story-node-type">{CHECKIN_LABEL[n.checkinType] || n.checkinType}</span>
                </div>
                <div className="story-node-desc">{n.description}</div>
                {n.tips && <div className="story-node-tip">💡 {n.tips}</div>}
                {n.checked && n.choice && <div className="story-node-choice">你的选择：{n.choice}</div>}
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

      {/* 打卡弹层 */}
      {activeNode && (
        <div className="story-modal-backdrop" onClick={() => setActiveNode(null)}>
          <div className="story-modal" onClick={(e) => e.stopPropagation()}>
            <div className="story-modal-title">打卡 · {activeNode.title}</div>
            {activeNode.choices && activeNode.choices.length > 0 && (
              <div className="story-choice-list">
                <div className="story-modal-hint">选择一项（会记入你的时间线故事书）</div>
                {activeNode.choices.map((c) => (
                  <button key={c} className={'story-choice' + (choice === c ? ' active' : '')} onClick={() => setChoice(c)}>{c}</button>
                ))}
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
              <button className="hud-btn" onClick={() => setActiveNode(null)}>取消</button>
              <button className="hud-btn" onClick={doCheckin}>确认打卡</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
