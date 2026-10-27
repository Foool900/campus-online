import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const RARITY_COLOR = { common: '#9aa4b2', uncommon: '#5bc49a', rare: '#4a90d9', epic: '#9b8ad1', legendary: '#f5c84c' };

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export default function StoryBookPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [toast, setToast] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api.storyTimeline());
    } catch (e) {
      setToast({ text: e.message || '加载失败', kind: 'err' });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!data) {
    return <div className="page story-page"><div className="story-loading">&gt; SYNC…</div></div>;
  }

  const { firstStoryAt, anniversaryAt, isAnniversary, daysUsed, story, footprint } = data;
  const f = footprint || {};

  return (
    <div className="page story-book">
      <div className="story-hero">
        <div>
          <div className="story-hero-title">📖 时间线故事书</div>
          <div className="story-hero-meta">
            {firstStoryAt
              ? `始于 ${fmtDate(firstStoryAt)} · 已走过 ${daysUsed} 天`
              : '你还没有开启任何剧情'}
          </div>
        </div>
        <button className="hud-btn" onClick={() => navigate('/story')}>← 剧情大厅</button>
      </div>

      {toast && <div className="form-error" style={{ marginBottom: 12 }}>{toast.text}</div>}

      <div className="story-book-banner">
        {isAnniversary ? '🎊 周年达成 · 你的专属故事书已定稿' : `🗓️ 距离一周年定稿还有 ${Math.max(0, 365 - daysUsed)} 天`}
      </div>

      <div className="story-book-grid">
        {/* 剧情主干 */}
        <section className="story-book-panel">
          <h3 className="story-book-h">剧情足迹</h3>
          <div className="story-book-stats">
            <div className="story-book-stat"><b>{story.completedCount}</b><span>完成剧情</span></div>
            <div className="story-book-stat"><b>{story.checkinCount}</b><span>打卡次数</span></div>
            <div className="story-book-stat"><b>{story.items.length}</b><span>剧情物品</span></div>
          </div>

          {story.completedStories.length > 0 && (
            <div className="story-book-sub">
              <div className="story-book-sub-h">完成章节</div>
              {story.completedStories.map((s, i) => (
                <div key={i} className="story-book-line">
                  <span className="story-book-line-cover">{s.cover}</span>
                  <span className="story-book-line-name">{s.title}</span>
                  <span className="story-book-line-date">{fmtDate(s.completedAt)}</span>
                </div>
              ))}
            </div>
          )}

          {story.choices.length > 0 && (
            <div className="story-book-sub">
              <div className="story-book-sub-h">你的选择</div>
              {story.choices.map((c, i) => (
                <div key={i} className="story-book-line">
                  <span className="story-book-line-name">{c.nodeTitle} → {c.choice}</span>
                  <span className="story-book-line-date">×{c.count}</span>
                </div>
              ))}
            </div>
          )}

          {story.items.length > 0 && (
            <div className="story-book-sub">
              <div className="story-book-sub-h">剧情收藏</div>
              <div className="story-book-items">
                {story.items.map((it, i) => (
                  <span key={i} className="story-book-item" style={{ color: RARITY_COLOR[it.rarity] || '#fff' }} title={it.name}>
                    {it.icon} {it.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 全站足迹 */}
        <section className="story-book-panel">
          <h3 className="story-book-h">这一年的你</h3>
          <div className="story-footprint">
            <FootRow label="💬 发言" value={f.messages} />
            <FootRow label="📝 活动帖" value={f.posts} />
            <FootRow label="✅ 完成备忘" value={f.privateTasksDone} />
            <FootRow label="💰 完成悬赏" value={f.tasksApproved} />
            <FootRow label="📅 签到天数" value={f.signinDays} />
            <FootRow label="🏅 解锁成就" value={f.achievements} />
            <FootRow label="🛍️ 市场买入" value={f.marketBought} />
            <FootRow label="🏪 市场卖出" value={f.marketSold} />
            <FootRow label="🤝 好友" value={f.friends} />
            <FootRow label="⭐ 累计经验" value={f.expTotal} />
            <FootRow label="🪙 累计金币" value={f.coinEarned} />
          </div>
        </section>
      </div>
    </div>
  );
}

function FootRow({ label, value }) {
  return (
    <div className="story-foot-row">
      <span className="story-foot-label">{label}</span>
      <span className="story-foot-value">{value ?? 0}</span>
    </div>
  );
}
