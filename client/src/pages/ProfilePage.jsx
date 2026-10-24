import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import { COLLEGES } from '../colleges.js';

const ROLE_LABELS = { member: '会员（未认证）', student: '学员（已认证）', admin: '管理员' };

const NAV = [
  ['basic', '基本信息'],
  ['achievements', '成就徽章'],
  ['growth', '成长路径'],
  ['tags', '个性标签'],
  ['chats', '最近聊天'],
];

// 未实现的模块占位
function Pending({ title }) {
  return (
    <section className="ps-section">
      <h2 className="ps-section-title">[ {title} ]</h2>
      <div className="ps-pending">&gt; MODULE PENDING...</div>
    </section>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

// 成就徽章网格（触发式成就）
function AchievementsPanel() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api
      .userAchievements()
      .then((l) => {
        if (active) setList(l);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const unlockedCount = list.filter((a) => a.unlocked).length;
  return (
    <section className="ps-section">
      <h2 className="ps-section-title">[ ACHIEVEMENTS: {unlockedCount} / {list.length} ]</h2>
      {loading ? (
        <div className="ps-pending">&gt; SYNC…</div>
      ) : (
        <div className="ach-grid">
          {list.map((a) => (
            <div
              key={a.code}
              className={'ach-badge' + (a.unlocked ? ' unlocked' : ' locked')}
              data-tip={a.unlocked ? `解锁于 ${fmtDateTime(a.unlockedAt)}` : `解锁条件：${a.description}`}
            >
              <div className="ach-icon">{a.unlocked ? a.icon : '?'}</div>
              <div className="ach-name">{a.unlocked ? a.name : '???'}</div>
              {a.unlocked ? (
                a.unlockedAt && <div className="ach-time">{fmtDate(a.unlockedAt)}</div>
              ) : (
                <div className="ach-hint">[ 线索: {a.hint} ]</div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const ALL_PERMS = ['COIN_ADD', 'COIN_MINUS', 'USER_MANAGE', 'ADMIN_GRANT'];

// 管理员控制台：金币发放
function CoinGrant() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [target, setTarget] = useState(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const search = () => api.adminSearchUsers(q).then(setResults).catch(() => {});
  const submit = async () => {
    if (!target) return setErr('请选择目标用户');
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt === 0) return setErr('请输入非零整数');
    try {
      await api.adminGrantCoin(target.id, { amount: amt, reason });
      setMsg('已执行'); setErr('');
    } catch (e) {
      setErr(e.message || '执行失败');
    }
  };
  return (
    <div className="admin-mod">
      <div className="admin-row">
        <input className="admin-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索昵称" />
        <button className="hud-btn" onClick={search}>搜索</button>
      </div>
      {results.map((u) => (
        <button key={u.id} className={'admin-result' + (target?.id === u.id ? ' active' : '')} onClick={() => { setTarget(u); setResults([]); }}>
          {u.nickname}（{u.role}）
        </button>
      ))}
      {target && <div className="admin-target">目标：{target.nickname}（ID {target.id}）</div>}
      <div className="admin-row">
        <input className="admin-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="金币数（负数为扣除）" />
      </div>
      <div className="admin-row">
        <input className="admin-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="理由/备注" />
        <button className="hud-btn" onClick={submit}>执行</button>
      </div>
      {msg && <div className="form-success">{msg}</div>}
      {err && <div className="form-error">{err}</div>}
    </div>
  );
}

// 管理员控制台：任命
function Appoint() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [target, setTarget] = useState(null);
  const [perms, setPerms] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const search = () => api.adminSearchUsers(q).then(setResults).catch(() => {});
  const toggle = (p) => setPerms((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  const submit = async () => {
    if (!target) return setErr('请选择用户');
    try {
      await api.adminSetPermissions(target.id, { permissions: perms });
      setMsg('已保存');
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="admin-mod">
      <div className="admin-row">
        <input className="admin-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索昵称" />
        <button className="hud-btn" onClick={search}>搜索</button>
      </div>
      {results.map((u) => (
        <button key={u.id} className="admin-result" onClick={() => { setTarget(u); setPerms(u.permissions || []); setResults([]); }}>
          {u.nickname}（{u.role}）
        </button>
      ))}
      {target && (
        <>
          <div className="admin-target">目标：{target.nickname}</div>
          {ALL_PERMS.map((p) => (
            <label key={p} className="perm-row">
              <input type="checkbox" checked={perms.includes(p)} onChange={() => toggle(p)} /> {p}
            </label>
          ))}
          <button className="hud-btn" onClick={submit}>保存权限</button>
        </>
      )}
      {msg && <div className="form-success">{msg}</div>}
      {err && <div className="form-error">{err}</div>}
    </div>
  );
}

// 管理员控制台主容器
function AdminPanel() {
  const [mode, setMode] = useState('coin');
  return (
    <section className="ps-section">
      <h2 className="ps-section-title">[ ADMIN_CONSOLE ]</h2>
      <div className="admin-tabs">
        <button className={'admin-tab' + (mode === 'coin' ? ' active' : '')} onClick={() => setMode('coin')}>金币发放</button>
        <button className={'admin-tab' + (mode === 'appoint' ? ' active' : '')} onClick={() => setMode('appoint')}>管理员任命</button>
      </div>
      {mode === 'coin' && <CoinGrant />}
      {mode === 'appoint' && <Appoint />}
    </section>
  );
}

export default function ProfilePage() {
  const { user, setUser, logout } = useUser();
  const navigate = useNavigate();
  const [tab, setTab] = useState('basic');
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [college, setCollege] = useState(user?.college || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (!user) {
    return (
      <div className="profile-dashboard">
        <button className="profile-close" onClick={() => navigate('/')}>[ ESC ]</button>
        <main className="profile-main"><div className="ps-pending">&gt; NO USER</div></main>
      </div>
    );
  }

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
    <div className="profile-dashboard">
      <button className="profile-close" onClick={() => navigate('/')} aria-label="关闭">[ ESC ]</button>

      <aside className="profile-sidebar">
        <div className="ps-user">
          <div className="ps-avatar"><span className="ps-avatar-em">{user.avatar || '🎓'}</span></div>
          <div className="ps-nick">{user.nickname}</div>
          <div className="ps-level">LV {user.level} · {user.exp} XP</div>
          <div className="ps-level">🪙 {user.coin ?? 0}（冻结 {user.frozenCoin ?? 0}）</div>
        </div>

        <nav className="ps-nav">
          {(user.role === 'admin' ? [...NAV, ['admin', '管理员控制台']] : NAV).map(([k, label]) => (
            <button
              key={k}
              className={'ps-nav-item' + (tab === k ? ' active' : '')}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="profile-main">
        <div key={tab} className="profile-panel-in">
          {tab === 'basic' && (
            <section className="ps-section">
              <h2 className="ps-section-title">[ BASIC_INFO ]</h2>

              <div className="ps-basic">
                <div className="ps-avatar ps-avatar-lg"><span className="ps-avatar-em">{user.avatar || '🎓'}</span></div>
                <div className="ps-basic-info">
                  <div className="ps-basic-nick">{user.nickname}</div>
                  <div className="ps-basic-college">{user.college || '未填写学院'}</div>
                  <div className="ps-basic-role">{ROLE_LABELS[user.role] || user.role}</div>
                </div>
              </div>

              <form className="ps-form" onSubmit={save}>
                <h3 className="ps-form-title">// 编辑资料</h3>
                <div className="row">
                  <div className="field">
                    <label>昵称</label>
                    <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20} />
                  </div>
                  <div className="field">
                    <label>学院</label>
                    <select value={college} onChange={(e) => setCollege(e.target.value)}>
                      {COLLEGES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="ps-actions">
                  <button type="submit" className="btn primary" disabled={saving}>
                    {saving ? '保存中…' : '保存修改'}
                  </button>
                  <button type="button" className="btn ghost" onClick={logout}>退出登录</button>
                </div>
                {message && <div className="form-success">{message}</div>}
                {error && <div className="form-error">{error}</div>}
              </form>
            </section>
          )}

          {tab === 'achievements' && <AchievementsPanel />}
          {tab === 'growth' && <Pending title="成长路径" />}
          {tab === 'tags' && <Pending title="个性标签" />}
          {tab === 'chats' && <Pending title="最近聊天" />}
          {tab === 'admin' && <AdminPanel />}
        </div>
      </main>
    </div>
  );
}
