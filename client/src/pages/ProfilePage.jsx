import { useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import { COLLEGES } from '../colleges.js';

const ROLE_LABELS = { member: '会员（未认证）', student: '学员（已认证）', admin: '管理员' };

export default function ProfilePage() {
  const { user, setUser, logout } = useUser();
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [college, setCollege] = useState(user?.college || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (!user) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>👤 我的</h1>
        </div>
      </div>
    );
  }

  const progress = user.exp % 100;
  const progressPct = Math.min(100, progress);

  const save = async (e) => {
    e.preventDefault();
    const name = nickname.trim();
    if (!name) {
      setError('昵称不能为空');
      return;
    }
    if (name.length < 2 || name.length > 20) {
      setError('昵称长度需为 2-20 个字符');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const updated = await api.updateUser(user.id, { nickname: name, college: college.trim() });
      setUser(updated);
      setNickname(updated.nickname);
      setCollege(updated.college);
      setMessage('已保存');
    } catch (err) {
      setError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>👤 我的</h1>
      </div>

      <div className="card profile-card">
        <div className="profile-avatar">{user.avatar || '🎓'}</div>
        <div>
          <p className="profile-name">{user.nickname}</p>
          <p className="profile-college">{user.college || '未填写学院'}</p>
          <p className="profile-role">{ROLE_LABELS[user.role] || user.role}</p>
        </div>
        <div className="profile-stats">
          <div className="stat">
            <div className="stat-num">{user.exp}</div>
            <div className="stat-label">经验值</div>
          </div>
          <div className="stat">
            <div className="stat-num">Lv{user.level}</div>
            <div className="stat-label">等级</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="progress-row">
          <span>距下一级 Lv{user.level + 1}</span>
          <span>
            {progress}/100 XP
          </span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <form className="card profile-form" onSubmit={save}>
        <h3 style={{ marginTop: 0 }}>编辑资料</h3>
        <div className="row">
          <div className="field">
            <label>昵称</label>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20} />
          </div>
          <div className="field">
            <label>学院</label>
            <select value={college} onChange={(e) => setCollege(e.target.value)}>
              {COLLEGES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? '保存中…' : '保存修改'}
          </button>
        </div>
        {message && <div className="form-success">{message}</div>}
        {error && <div className="form-error">{error}</div>}
      </form>

      <div className="card">
        <button type="button" className="btn ghost" onClick={logout}>🚪 退出登录</button>
      </div>
    </div>
  );
}
