import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import { useAchievementToast } from '../components/AchievementToast.jsx';
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

// 进度型成就的紧凑指标名（卡片进度条左侧）
const METRIC_LABEL = {
  user_created: '账号',
  messages_sent: '消息',
  posts_created: '活动',
  todos_completed: '待办',
  exp_total: '经验',
  areas_visited: '区域',
  page_opens: '打开',
};

// 判断图标是否为图片 URL/路径（否则按 emoji 文本渲染）
function isImageIcon(icon) {
  return typeof icon === 'string' && /^(https?:\/\/|\/uploads\/|data:)/.test(icon);
}

// 成就面板：进度型 + 触发型统一九宫格
function AchievementsPanel() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api
      .achievements()
      .then((d) => {
        if (active) setList(d.achievements ?? []);
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
              data-tip={
                a.unlocked
                  ? `解锁于 ${fmtDateTime(a.unlockedAt)}`
                  : a.description
                    ? `解锁条件：${a.description}`
                    : '解锁条件隐藏'
              }
            >
              <div className="ach-icon">
                {a.unlocked || a.kind === 'progress'
                  ? (isImageIcon(a.icon) ? <img src={a.icon} alt="" /> : a.icon)
                  : '?'}
              </div>
              <div className="ach-name">{a.name}</div>

              {a.kind === 'progress' ? (
                <div className="ach-meter-wrap">
                  <div className="ach-meter-label">{METRIC_LABEL[a.metric] || a.metric} {a.current}/{a.target}</div>
                  <div className="ach-meter"><i style={{ width: `${a.progressPct}%` }} /></div>
                </div>
              ) : a.unlocked ? (
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

const ALL_PERMS = ['COIN_ADD', 'COIN_MINUS', 'USER_MANAGE', 'ADMIN_GRANT', 'ACHIEVEMENT_MANAGE'];

// 进度型成就指标（与 server/achievements.js 的 ACHIEVEMENT_METRICS 保持一致）
const ACHIEVEMENT_METRICS = [
  ['user_created', '创建账号'],
  ['messages_sent', '发送消息数'],
  ['posts_created', '发布活动数'],
  ['todos_completed', '完成待办数'],
  ['exp_total', '累计经验'],
  ['areas_visited', '到访区域数'],
  ['page_opens', '打开界面次数'],
];

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
        <input className="admin-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入完整昵称（精确匹配）" />
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
        <input className="admin-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入完整昵称（精确匹配）" />
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

// 管理员控制台：成就管理（增删改进度型/触发型成就定义，控制面板在右侧）
function AchievementManage() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ code: '', name: '', description: '', icon: '🏅', hint: '', type: 'exploration', kind: 'progress', metric: 'messages_sent', threshold: '1', conditionVisible: true, page: '' });
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const showAchievement = useAchievementToast();

  const reload = () => api.adminAchievements().then(setList).catch(() => {});
  useEffect(() => { reload(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const reset = () => {
    setForm({ code: '', name: '', description: '', icon: '🏅', hint: '', type: 'exploration', kind: 'progress', metric: 'messages_sent', threshold: '1', conditionVisible: true, page: '' });
    setEditing(null); setMsg(''); setErr('');
  };
  const startEdit = (a) => {
    setEditing(a.code);
    setForm({
      code: a.code,
      name: a.name,
      description: a.description,
      icon: a.icon,
      hint: a.hint || '',
      type: a.type,
      kind: a.kind,
      metric: a.kind === 'progress' ? a.metric : 'messages_sent',
      threshold: String(a.threshold ?? 1),
      conditionVisible: a.condition_visible !== 0,
      page: a.page || '',
    });
    setMsg(''); setErr('');
  };

  const uploadIcon = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setErr('');
    try {
      const { url } = await api.adminUploadAchievementIcon(file);
      setForm((f) => ({ ...f, icon: url }));
    } catch (err2) {
      setErr(err2.message || '上传失败');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const submit = async () => {
    const body = { name: form.name, description: form.description, icon: form.icon, type: form.type, kind: form.kind, condition_visible: form.conditionVisible };
    if (form.kind === 'progress') {
      body.metric = form.metric;
      body.threshold = Number(form.threshold);
      body.page = form.page;
    } else {
      body.hint = form.hint;
    }
    try {
      if (editing) {
        await api.adminUpdateAchievement(editing, body);
        setMsg('已保存');
      } else {
        await api.adminCreateAchievement({ ...body, code: form.code });
        setMsg('已创建');
        reset();
      }
      setErr('');
      reload();
    } catch (e) {
      setErr(e.message || '操作失败');
    }
  };

  const remove = async (code) => {
    if (!window.confirm(`确认删除成就 ${code}？`)) return;
    try {
      await api.adminDeleteAchievement(code);
      setMsg('已删除'); setErr('');
      if (editing === code) reset();
      reload();
    } catch (e) {
      setErr(e.message || '删除失败');
    }
  };

  return (
    <div className="ach-admin">
      <section className="ach-admin-card ach-admin-left">
        <header className="ach-admin-head">
          <h3 className="ach-admin-title">成就列表</h3>
          <span className="ach-admin-count">{list.length} 项</span>
        </header>
        <div className="ach-admin-list">
          {list.map((a) => (
            <div key={a.code} className="ach-item" onClick={() => startEdit(a)}>
              <span className="ach-item-icon">{isImageIcon(a.icon) ? <img src={a.icon} alt="" /> : a.icon}</span>
              <div className="ach-item-main">
                <div className="ach-item-name">
                  {a.name}
                  <span className="ach-item-code">{a.code}</span>
                </div>
                <div className="ach-item-desc">{a.description}</div>
              </div>
              <span className="ach-item-kind">{a.kind === 'trigger' ? '触发型' : (METRIC_LABEL[a.metric] || a.metric)}</span>
              <div className="ach-item-actions">
                <button className="ach-btn" onClick={(e) => { e.stopPropagation(); startEdit(a); }}>编辑</button>
                <button className="ach-btn danger" onClick={(e) => { e.stopPropagation(); remove(a.code); }}>删除</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="ach-admin-card ach-admin-right">
        <header className="ach-admin-head">
          <h3 className="ach-admin-title">{editing ? '编辑成就' : '新增成就'}</h3>
        </header>
        <div className="ach-admin-form">
          <div className="ach-field">
            <label>code</label>
            <input value={form.code} onChange={set('code')} placeholder="字母 / 数字 / _-" disabled={!!editing} />
          </div>
          <div className="ach-field">
            <label>名称</label>
            <input value={form.name} onChange={set('name')} placeholder="成就名称" />
          </div>
          <div className="ach-field">
            <label>描述（解锁条件）</label>
            <textarea value={form.description} onChange={set('description')} rows={2} placeholder="明确的解锁条件" />
          </div>

          <div className="ach-field">
            <label>图标</label>
            <input value={isImageIcon(form.icon) ? '' : form.icon} onChange={set('icon')} placeholder="emoji（或上传图片）" />
            <div className="ach-icon-row">
              <label className="ach-btn">
                {uploading ? '上传中…' : '上传图片'}
                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{ display: 'none' }} onChange={uploadIcon} />
              </label>
              {form.icon && (
                <button className="ach-btn danger" onClick={() => setForm((f) => ({ ...f, icon: '🏅' }))}>清除</button>
              )}
            </div>
            {form.icon && (
              <div className="ach-admin-icon-preview">
                {isImageIcon(form.icon) ? <img src={form.icon} alt="图标预览" /> : <span className="ach-admin-icon-emoji">{form.icon}</span>}
              </div>
            )}
          </div>

          <div className="ach-grid-2">
            <div className="ach-field">
              <label>类型</label>
              <select value={form.kind} onChange={set('kind')}>
                <option value="progress">进度型</option>
                <option value="trigger">触发型</option>
              </select>
            </div>
            <div className="ach-field">
              <label>分类</label>
              <input value={form.type} onChange={set('type')} placeholder="exploration / task / social / secret" />
            </div>
          </div>

          {form.kind === 'progress' ? (
            <>
              <div className="ach-grid-2">
                <div className="ach-field">
                  <label>指标</label>
                  <select value={form.metric} onChange={set('metric')}>
                    {ACHIEVEMENT_METRICS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                </div>
                <div className="ach-field">
                  <label>阈值</label>
                  <input type="number" value={form.threshold} onChange={set('threshold')} placeholder="如 100" />
                </div>
              </div>
              {form.metric === 'page_opens' && (
                <div className="ach-field">
                  <label>界面（路由路径）</label>
                  <input value={form.page} onChange={set('page')} placeholder="如 /market、/tasks、/profile" />
                </div>
              )}
            </>
          ) : (
            <div className="ach-field">
              <label>线索</label>
              <input value={form.hint} onChange={set('hint')} placeholder="未解锁时显示的提示线索" />
            </div>
          )}

          <label className="ach-check">
            <input type="checkbox" checked={form.conditionVisible} onChange={(e) => setForm((f) => ({ ...f, conditionVisible: e.target.checked }))} />
            解锁条件对用户可见
          </label>
          <div className="ach-admin-hint">关闭后，未解锁用户看不到「描述」里的明确条件，只显示线索。</div>

          {form.kind === 'trigger' && (
            <div className="ach-warn">提示：触发型成就需在代码里补触发点才会解锁。</div>
          )}

          <div className="ach-actions">
            <button className="ach-submit" onClick={submit}>{editing ? '保存修改' : '创建成就'}</button>
            {editing && <button className="ach-btn" onClick={reset}>取消</button>}
            <button
              className="ach-btn"
              onClick={() => showAchievement({ name: '初次校准', icon: '🛰️', description: '首次登录并加载地图' })}
            >
              预览弹窗
            </button>
          </div>

          {msg && <div className="form-success">{msg}</div>}
          {err && <div className="form-error">{err}</div>}
        </div>
      </section>
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
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get('tab') || 'basic');
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

  // 成就管理仅对「超级管理员（ADMIN_GRANT）或持有 ACHIEVEMENT_MANAGE 权限」的管理员可见
  const canManageAchievements =
    user.role === 'admin' &&
    (user.permissions || []).some((p) => p === 'ADMIN_GRANT' || p === 'ACHIEVEMENT_MANAGE');

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
          {(user.role === 'admin'
            ? [...NAV, ...(canManageAchievements ? [['achievement-admin', '成就管理']] : []), ['admin', '管理员控制台']]
            : NAV
          ).map(([k, label]) => (
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
          {tab === 'achievement-admin' && (canManageAchievements ? <AchievementManage /> : (
            <section className="ps-section">
              <h2 className="ps-section-title">[ ACHIEVEMENT_ADMIN ]</h2>
              <div className="ps-pending">&gt; 无权限访问</div>
            </section>
          ))}
          {tab === 'admin' && <AdminPanel />}
        </div>
      </main>
    </div>
  );
}
