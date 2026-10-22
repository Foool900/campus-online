import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import ChatChannel from '../components/ChatChannel.jsx';

export default function CoOnlinePage() {
  const navigate = useNavigate();
  const { user } = useUser();

  const [conversations, setConversations] = useState([]);
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [mobileView, setMobileView] = useState('list');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupSelected, setGroupSelected] = useState(new Set());
  const [showManage, setShowManage] = useState(false);
  const [renameName, setRenameName] = useState('');

  const searchTimer = useRef(null);

  const refresh = async () => {
    try {
      const [cs, fs, rs] = await Promise.all([api.conversations(), api.friends(), api.friendRequests()]);
      setConversations(cs || []);
      setFriends(fs || []);
      setRequests(rs || []);
    } catch (e) {
      setError(e.message || '加载失败');
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onSearchChange = (q) => {
    setSearchQuery(q);
    clearTimeout(searchTimer.current);
    const text = q.trim();
    if (!text) {
      setSearchResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        setSearchResults(await api.searchUsers(text));
      } catch (e) {
        setError(e.message || '搜索失败');
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const openDirect = async (friendId, name, avatar) => {
    try {
      const c = await api.createDirectConversation(friendId);
      setSelected({ id: c.id, type: 'direct', name, avatar, peerId: friendId });
      setMobileView('chat');
      refresh();
    } catch (e) {
      setError(e.message || '打开会话失败');
    }
  };

  const sendRequest = async (userId) => {
    try {
      await api.friendRequest(userId, '');
      setMsg('已发送好友申请');
      onSearchChange(searchQuery);
    } catch (e) {
      setError(e.message || '发送失败');
    }
  };

  const accept = async (id) => {
    try {
      await api.acceptFriendRequest(id);
      setMsg('已接受');
      refresh();
    } catch (e) {
      setError(e.message || '操作失败');
    }
  };

  const reject = async (id) => {
    try {
      await api.rejectFriendRequest(id);
      refresh();
    } catch (e) {
      setError(e.message || '操作失败');
    }
  };

  const removeFriend = async (id) => {
    try {
      await api.removeFriend(id);
      refresh();
    } catch (e) {
      setError(e.message || '操作失败');
    }
  };

  const selectConv = async (c) => {
    setSelected({ id: c.id, type: c.type, name: c.name, avatar: c.avatar, peerId: c.peerId });
    setMobileView('chat');
    if (c.type === 'group') {
      try {
        const info = await api.conversation(c.id);
        setSelected((prev) => ({ ...prev, members: info.members, role: info.role, name: info.name || prev.name }));
      } catch (e) {
        setError(e.message || '加载群信息失败');
      }
    }
  };

  const backToList = () => setMobileView('list');

  const toggleGroupSelect = (id) => {
    setGroupSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createGroup = async () => {
    if (groupSelected.size === 0) {
      setError('请至少选择一位好友');
      return;
    }
    try {
      const c = await api.createGroup({ name: groupName.trim(), memberIds: [...groupSelected] });
      setShowGroupModal(false);
      setGroupName('');
      setGroupSelected(new Set());
      setMsg('已创建群聊');
      refresh();
      setSelected({ id: c.id, type: 'group', name: c.name, avatar: '👥' });
      setMobileView('chat');
    } catch (e) {
      setError(e.message || '创建失败');
    }
  };

  const renameGroup = async () => {
    if (!selected || !renameName.trim()) return;
    try {
      await api.renameGroup(selected.id, { name: renameName.trim() });
      setRenameName('');
      setMsg('已改群名');
      refresh();
    } catch (e) {
      setError(e.message || '改名失败');
    }
  };

  const removeMember = async (userId) => {
    if (!selected) return;
    try {
      await api.removeGroupMember(selected.id, userId);
      const info = await api.conversation(selected.id);
      setSelected((prev) => ({ ...prev, members: info.members }));
      setMsg('已移除成员');
    } catch (e) {
      setError(e.message || '移除失败');
    }
  };

  const dissolveGroup = async () => {
    if (!selected || !window.confirm('确定解散该群聊？此操作不可恢复')) return;
    try {
      await api.dissolveGroup(selected.id);
      setSelected(null);
      setMobileView('list');
      setShowManage(false);
      setMsg('已解散群聊');
      refresh();
    } catch (e) {
      setError(e.message || '解散失败');
    }
  };

  const onlineFriends = friends.filter((f) => f.online);
  const offlineFriends = friends.filter((f) => !f.online);
  const isOwner = selected?.type === 'group' && selected?.role === 'owner';

  return (
    <div className="activity-detail co-online-page">
      <div className="act-backbar">
        <button className="act-back" onClick={() => navigate('/')} aria-label="返回">← 返回</button>
        <span className="act-back-title">co-online</span>
      </div>

      <div className={'co-online-layout' + (mobileView === 'chat' ? ' show-chat' : '')}>
        {/* 左栏 / 手机列表页 */}
        <aside className="co-online-list">
          <div className="co-online-search">
            <input placeholder="搜索用户加好友" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} />
          </div>

          {searchQuery.trim() ? (
            <div className="co-online-search-results">
              {searching && <div className="chat-empty">搜索中…</div>}
              {!searching && searchResults.length === 0 && <div className="chat-empty">无匹配用户</div>}
              {searchResults.map((r) => (
                <div key={r.id} className="co-online-user">
                  <span className="co-online-avatar">{r.avatar || '🎓'}</span>
                  <span className="co-online-name">{r.nickname}</span>
                  <span className="co-online-college">{r.college || ''}</span>
                  {r.friendStatus === 'friend' ? (
                    <button className="btn primary btn-sm" onClick={() => openDirect(r.id, r.nickname, r.avatar)}>发消息</button>
                  ) : r.friendStatus === 'pending' ? (
                    <span className="co-online-muted">已申请</span>
                  ) : (
                    <button className="btn primary btn-sm" onClick={() => sendRequest(r.id)}>加好友</button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <>
              {requests.length > 0 && (
                <div className="co-online-section">
                  <div className="co-online-section-title">新的朋友（{requests.length}）</div>
                  {requests.map((r) => (
                    <div key={r.id} className="co-online-user">
                      <span className="co-online-avatar">{r.avatar || '🎓'}</span>
                      <span className="co-online-name">{r.nickname}</span>
                      <button className="btn success btn-sm" onClick={() => accept(r.id)}>接受</button>
                      <button className="btn ghost btn-sm" onClick={() => reject(r.id)}>拒绝</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="co-online-section">
                <div className="co-online-section-title">会话</div>
                {conversations.length === 0 && <div className="chat-empty">暂无会话，去加个好友吧</div>}
                {conversations.map((c) => (
                  <button key={c.id} className={'co-online-conv' + (selected?.id === c.id ? ' active' : '')} onClick={() => selectConv(c)}>
                    <span className="co-online-avatar">{c.avatar}</span>
                    <span className="co-online-conv-main">
                      <span className="co-online-name-row">
                        <span className="co-online-name">{c.name}</span>
                        {c.online && <span className="co-online-online">●</span>}
                      </span>
                      {c.lastMessage && <span className="co-online-last">{c.lastMessage}</span>}
                    </span>
                    {c.unread > 0 && <span className="co-online-unread">{c.unread}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        {/* 中栏：聊天区 */}
        <section className="co-online-chat">
          {selected ? (
            <>
              <div className="co-online-chat-head">
                <button className="co-online-back" onClick={backToList} aria-label="返回">‹</button>
                <span className="co-online-avatar">{selected.avatar || '🎓'}</span>
                <span className="co-online-name">{selected.name}</span>
                {isOwner && (
                  <button className="btn ghost btn-sm" onClick={() => { setRenameName(selected.name); setShowManage(true); }}>管理</button>
                )}
              </div>
              <ChatChannel
                conversationType={selected.type}
                conversationId={selected.id}
                canSpeak
                members={selected.type === 'direct' ? [{ userId: selected.peerId, userName: selected.name, avatar: selected.avatar }] : selected.members || []}
              />
            </>
          ) : (
            <div className="act-empty">选择一个会话开始聊天</div>
          )}
        </section>

        {/* 右栏：好友列表 */}
        <aside className="co-online-friends">
          <div className="co-online-section-title">好友</div>
          <button className="btn ghost btn-sm" onClick={() => setShowGroupModal(true)}>＋ 建群</button>
          {friends.length === 0 && <div className="chat-empty">还没有好友</div>}
          {onlineFriends.length > 0 && <div className="co-online-group">在线（{onlineFriends.length}）</div>}
          {onlineFriends.map((f) => (
            <div key={f.id} className="co-online-user">
              <span className="co-online-avatar">{f.avatar || '🎓'}<i className="co-online-dot" /></span>
              <span className="co-online-name">{f.nickname}</span>
              <button className="btn ghost btn-sm" onClick={() => openDirect(f.id, f.nickname, f.avatar)}>发消息</button>
              <button className="co-online-remove" onClick={() => removeFriend(f.id)} title="删除好友">×</button>
            </div>
          ))}
          {offlineFriends.length > 0 && <div className="co-online-group">离线（{offlineFriends.length}）</div>}
          {offlineFriends.map((f) => (
            <div key={f.id} className="co-online-user">
              <span className="co-online-avatar">{f.avatar || '🎓'}</span>
              <span className="co-online-name">{f.nickname}</span>
              <button className="btn ghost btn-sm" onClick={() => openDirect(f.id, f.nickname, f.avatar)}>发消息</button>
              <button className="co-online-remove" onClick={() => removeFriend(f.id)} title="删除好友">×</button>
            </div>
          ))}
        </aside>
      </div>

      {/* 建群弹窗 */}
      {showGroupModal && (
        <div className="modal-overlay" onClick={() => setShowGroupModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>👥 创建群聊</h3>
            <label>群名（可留空自动生成）</label>
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} maxLength={30} placeholder="例如：考研搭子群" />
            <label>选择好友</label>
            <div className="co-online-pick-list">
              {friends.map((f) => (
                <label key={f.id} className="co-online-pick">
                  <input type="checkbox" checked={groupSelected.has(f.id)} onChange={() => toggleGroupSelect(f.id)} />
                  {f.avatar || '🎓'} {f.nickname}
                </label>
              ))}
              {friends.length === 0 && <div className="chat-empty">先添加好友才能建群</div>}
            </div>
            <div className="form-actions">
              <button className="btn ghost" onClick={() => setShowGroupModal(false)}>取消</button>
              <button className="btn primary" onClick={createGroup}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 群管理弹窗 */}
      {showManage && selected && (
        <div className="modal-overlay" onClick={() => setShowManage(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>⚙️ 群管理</h3>
            <label>群名</label>
            <div className="admin-add">
              <input value={renameName} onChange={(e) => setRenameName(e.target.value)} maxLength={30} />
              <button className="btn primary" onClick={renameGroup}>改名</button>
            </div>
            <label style={{ marginTop: 10 }}>成员</label>
            <div className="co-online-pick-list">
              {selected.members?.map((m) => (
                <div key={m.id} className="co-online-user">
                  <span className="co-online-avatar">{m.avatar || '🎓'}</span>
                  <span className="co-online-name">{m.nickname}{m.role === 'owner' ? '（群主）' : ''}</span>
                  {m.role !== 'owner' && <button className="co-online-remove" onClick={() => removeMember(m.id)} title="移除">×</button>}
                </div>
              ))}
            </div>
            <div className="form-actions" style={{ marginTop: 10 }}>
              <button className="btn ghost" onClick={() => setShowManage(false)}>关闭</button>
              <button className="btn danger" onClick={dissolveGroup}>解散群聊</button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="co-online-error">{error}</div>}
      {msg && <div className="co-online-msg">{msg}</div>}
    </div>
  );
}
