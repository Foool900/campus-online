import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import PostEditor from './PostEditor.jsx';
import ChatChannel from './ChatChannel.jsx';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

const STATUS_LABELS = { draft: '草稿', open: '报名中', ongoing: '进行中', ended: '已结束', cancelled: '已取消' };

export default function AreaDialog({ area, onClose }) {
  const { user } = useUser();
  const navigate = useNavigate();
  const [zone, setZone] = useState('activity');
  const [channel, setChannel] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(true);

  // 加载该区域的频道（活动区 / 聊天区共用）
  useEffect(() => {
    let active = true;
    setChannel(null);
    api
      .channels(area.id)
      .then((chans) => {
        if (active && chans.length) setChannel(chans[0]);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [area.id]);

  // 加载活动帖（带 userId 获取卡片聚合：在线数/未读数/@我/回复我）
  useEffect(() => {
    if (!channel) return;
    setPostsLoading(true);
    api
      .posts(channel.id, user?.id)
      .then(setPosts)
      .catch(() => {})
      .finally(() => setPostsLoading(false));
  }, [channel?.id, user?.id]);

  const handlePublished = (post) => {
    setPosts((prev) => [post, ...prev]);
    setShowEditor(false);
  };

  return (
    <div className="chat-drawer area-dialog">
      <div className="chat-header">
        <div>
          <h3>
            {area.emoji} {area.name} · {channel ? channel.name : '加载中…'}
          </h3>
          <p className="chat-desc">{area.description}</p>
        </div>
        <button className="chat-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <div className="zone-tabs">
        <button className={'zone-tab' + (zone === 'activity' ? ' active' : '')} onClick={() => setZone('activity')}>
          📌 活动区
        </button>
        <button className={'zone-tab' + (zone === 'chat' ? ' active' : '')} onClick={() => setZone('chat')}>
          💬 聊天区
        </button>
      </div>

      {zone === 'activity' ? (
        <div className="zone-body activity-zone">
          {postsLoading && <div className="chat-empty">加载中…</div>}
          {!postsLoading && posts.length === 0 && (
            <div className="chat-empty">还没有活动帖，点右下角「+」发布第一篇～</div>
          )}
          {posts.map((p) => (
            <div
              key={p.id}
              className="post-card post-card-link"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/activity/${p.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/activity/${p.id}`);
                }
              }}
              title="查看活动详情"
            >
              <div className="post-head">
                <span className="post-category">{p.category}</span>
                <span className="post-title">{p.title}</span>
                {p.status && <span className={'status-badge status-' + p.status}>{STATUS_LABELS[p.status] || p.status}</span>}
                <span className="post-card-arrow">›</span>
              </div>
              {p.content && <div className="post-content">{p.content}</div>}
              {p.recentMessages?.length > 0 && (
                <div className="post-recent">
                  {p.recentMessages.map((rm, i) => (
                    <div key={i} className="post-recent-line">
                      <span className="post-recent-nick">{rm.nickname}</span>：{rm.content}
                    </div>
                  ))}
                </div>
              )}
              <div className="post-meta">
                <span>
                  {p.avatar || '🎓'} {p.nickname}
                </span>
                {p.userId === user?.id && <span className="act-admin-badge">管理员</span>}
                <span>{formatTime(p.createdAt)}</span>
                <span className="post-meta-spacer" />
                {p.onlineCount > 0 && <span className="post-online">● {p.onlineCount} 在线</span>}
                {p.unreadCount > 0 && <span className="post-unread">{p.unreadCount} 未读</span>}
                {(p.hasMentionMe || p.hasReplyMe) && <span className="post-dot" title={p.hasMentionMe ? '有人 @ 我' : '有人回复我'} />}
              </div>
            </div>
          ))}
          {user?.role !== 'member' && (
            <button className="fab" onClick={() => setShowEditor(true)} aria-label="发布活动帖">
              ＋
            </button>
          )}
        </div>
      ) : (
        <div className="zone-body chat-zone">
          {channel ? (
            <ChatChannel
              conversationType="chat"
              conversationId={channel.id}
              canSpeak={!!user && user.role !== 'member'}
              lockMessage="提交认证材料后才能发言"
            />
          ) : (
            <div className="chat-empty">加载中…</div>
          )}
        </div>
      )}

      {showEditor && channel && (
        <PostEditor channel={channel} onClose={() => setShowEditor(false)} onPublished={handlePublished} />
      )}
    </div>
  );
}
