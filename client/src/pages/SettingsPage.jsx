import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import { useBackgroundMusic } from '../components/BackgroundMusic.jsx';
import { useTheme } from '../ThemeContext.jsx';
import { CheckIcon, CrownIcon, GearIcon, IdCardIcon, InboxIcon, MusicIcon, ShieldIcon } from '../components/MarketIcons.jsx';

const STATUS_LABELS = { pending: '审核中', approved: '已通过', rejected: '已拒绝' };

// RBAC 权限 → 职责（与 server/auth.js 的 PERMISSIONS 保持一致）
const PERM_LABELS = {
  ADMIN_GRANT: '管理员授权',
  COIN_ADD: '发放金币',
  COIN_MINUS: '扣除金币',
  ACHIEVEMENT_MANAGE: '成就管理',
  USER_MANAGE: '用户管理',
};
const PERMISSION_KEYS = Object.keys(PERM_LABELS);

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export default function SettingsPage() {
  const { user } = useUser();
  const [tab, setTab] = useState('personal');
  const [myApp, setMyApp] = useState(null);
  const [img1, setImg1] = useState('');
  const [img2, setImg2] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [promoteNick, setPromoteNick] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const isAdmin = user?.role === 'admin';
  const isStudent = user?.role === 'student';
  // 超级管理员：admin 且持有 ADMIN_GRANT（与后端 isSuperAdmin 一致）
  const isSuper = isAdmin && (user?.permissions || []).includes('ADMIN_GRANT');
  const bgm = useBackgroundMusic();
  const { theme, themes, setTheme } = useTheme();

  useEffect(() => {
    api.verificationMe().then(setMyApp).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    api.verificationPending().then(setPending).catch(() => {});
    api.adminList().then(setAdmins).catch(() => {});
  }, [isAdmin]);

  // 角色变化导致当前分区不可见时，回退到默认
  useEffect(() => {
    if ((tab === 'review' && !isAdmin) || (tab === 'admin' && !isSuper)) setTab('personal');
  }, [tab, isAdmin, isSuper]);

  // 侧栏分区（按角色过滤）
  const sections = [
    { key: 'personal', label: '个性化', icon: <MusicIcon /> },
    { key: 'verify', label: '身份认证', icon: <IdCardIcon /> },
    ...(isAdmin ? [{ key: 'review', label: '待审核', icon: <InboxIcon /> }] : []),
    ...(isSuper ? [{ key: 'admin', label: '管理员', icon: <CrownIcon /> }] : []),
  ];

  if (!user) {
    return (
      <div className="page settings-page">
        <div className="settings-main">
          <div className="settings-inner">
            <div className="page-head"><h1><GearIcon size={20} /> 设置</h1></div>
          </div>
        </div>
      </div>
    );
  }

  const uploadImage = async (file, setUrl) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const r = await api.verificationUpload(file);
      setUrl(r.url);
    } catch (e) {
      setError(e.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!img1 || !img2) {
      setError('请先上传两张截图');
      return;
    }
    setSubmitting(true);
    setError('');
    setMsg('');
    try {
      const app = await api.submitVerification({ images: [img1, img2] });
      setMyApp(app);
      setMsg('已提交，等待管理员审核');
    } catch (e) {
      setError(e.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const refreshPending = () => api.verificationPending().then(setPending).catch(() => {});

  const approve = async (id) => {
    try {
      await api.approveVerification(id);
      setMsg('已通过');
      refreshPending();
    } catch (e) {
      setError(e.message || '操作失败');
    }
  };

  const reject = async (id) => {
    try {
      await api.rejectVerification(id, { note: '' });
      setMsg('已拒绝');
      refreshPending();
    } catch (e) {
      setError(e.message || '操作失败');
    }
  };

  const promote = async () => {
    const nick = promoteNick.trim();
    if (!nick) {
      setError('请输入要添加的管理员昵称');
      return;
    }
    setError('');
    setMsg('');
    try {
      await api.promoteAdmin({ nickname: nick });
      setPromoteNick('');
      setMsg('已添加管理员');
      api.adminList().then(setAdmins).catch(() => {});
    } catch (e) {
      setError(e.message || '操作失败');
    }
  };

  const removeAdmin = async (id) => {
    try {
      await api.removeAdmin(id);
      setMsg('已移除管理员');
      api.adminList().then(setAdmins).catch(() => {});
    } catch (e) {
      setError(e.message || '操作失败');
    }
  };

  // 切换某管理员的单个权限（乐观更新，失败回滚并重拉名单）
  const togglePerm = async (admin, perm) => {
    const perms = admin.permissions.includes(perm)
      ? admin.permissions.filter((p) => p !== perm)
      : [...admin.permissions, perm];
    setAdmins((list) =>
      list.map((x) => (x.id === admin.id ? { ...x, permissions: perms, isSuper: perms.includes('ADMIN_GRANT') } : x))
    );
    try {
      await api.adminSetPermissions(admin.id, { permissions: perms });
      setMsg(`已更新 ${admin.nickname} 的权限`);
    } catch (e) {
      setError(e.message || '保存失败');
      api.adminList().then(setAdmins).catch(() => {});
    }
  };

  return (
    <div className="page settings-page">
      {/* 左侧极简玻璃导航 */}
      <aside className="mk-sidebar" aria-label="设置导航">
        {sections.map((s) => (
          <button
            key={s.key}
            title={s.label}
            className={'mk-nav' + (tab === s.key ? ' active' : '')}
            onClick={() => setTab(s.key)}
          >
            {s.icon}
          </button>
        ))}
      </aside>

      {/* 右侧内容 */}
      <div className="settings-main">
        <div className="settings-inner">
          <div className="page-head">
            <h1><GearIcon size={20} /> 设置</h1>
            <p>身份认证与账号管理</p>
          </div>

          {error && <div className="error-banner">{error}</div>}
          {msg && <div className="hint-banner">{msg}</div>}

          {/* 个性化：背景音乐 */}
          {tab === 'personal' && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>个性化</h3>

              <div className="bgm-row">
                <span className="bgm-label">主题</span>
                <div className="theme-seg" role="radiogroup" aria-label="主题">
                  {themes.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={theme === t.id}
                      className={'theme-seg-btn' + (theme === t.id ? ' active' : '')}
                      onClick={() => setTheme(t.id)}
                    >
                      <span aria-hidden="true">{t.icon}</span> {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bgm-row">
                <span className="bgm-label">背景音乐</span>
                <label className="bgm-switch">
                  <input type="checkbox" checked={bgm.enabled} onChange={(e) => bgm.setEnabled(e.target.checked)} />
                  <span className="bgm-switch-slider" />
                </label>
              </div>

              <div className="bgm-tracks">
                {bgm.tracks.map((t) => (
                  <label key={t.id} className={'bgm-track' + (bgm.track === t.id ? ' active' : '')}>
                    <input type="radio" name="bgm" checked={bgm.track === t.id} onChange={() => bgm.setTrack(t.id)} />
                    <span className="bgm-track-title">{t.title}</span>
                    {bgm.track === t.id && <span className="bgm-track-play">▶</span>}
                  </label>
                ))}
              </div>

              <p className="verify-desc" style={{ marginBottom: 0 }}>背景音乐会在整个网站循环播放，可随时开关或切换曲目。</p>
            </div>
          )}

          {/* 身份认证 */}
          {tab === 'verify' && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>身份认证</h3>
              {isAdmin ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#F5A623' }}><CrownIcon size={14} /> 你是管理员，无需认证</div>
              ) : isStudent ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#34d399' }}><CheckIcon size={14} /> 你已是认证学员</div>
              ) : (
                <>
                  {myApp?.status === 'pending' && <div className="hint-banner">你的申请正在审核中，请耐心等待</div>}
                  {myApp?.status === 'rejected' && <div className="error-banner">你的申请被拒绝，可重新提交</div>}
                  <p className="verify-desc">
                    上传「学信网截图」和「今日学院截图」两张图片（png/jpg，单张 ≤5MB）。提交后等待管理员人工审核，通过后即可获得学员权限。
                  </p>
                  <div className="verify-images">
                    <div className="verify-slot">
                      <label>学信网截图</label>
                      {img1 ? <img src={img1} alt="学信网截图" /> : <div className="verify-empty">未上传</div>}
                      <input type="file" accept="image/png,image/jpeg" onChange={(e) => uploadImage(e.target.files?.[0], setImg1)} />
                    </div>
                    <div className="verify-slot">
                      <label>今日学院截图</label>
                      {img2 ? <img src={img2} alt="今日学院截图" /> : <div className="verify-empty">未上传</div>}
                      <input type="file" accept="image/png,image/jpeg" onChange={(e) => uploadImage(e.target.files?.[0], setImg2)} />
                    </div>
                  </div>
                  <button className="btn primary" onClick={submit} disabled={submitting || uploading || !img1 || !img2}>
                    {uploading ? '上传中…' : submitting ? '提交中…' : '提交认证'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* 管理员：待审核 */}
          {tab === 'review' && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>待审核（{pending.length}）</h3>
              {pending.length === 0 && <div className="empty-state">暂无待审核申请</div>}
              {pending.map((a) => (
                <div key={a.id} className="verify-app">
                  <div className="verify-app-info">
                    <strong>{a.nickname}</strong>（{a.college || '未填学院'}）
                    <div className="verify-app-time">{formatTime(a.submittedAt)}</div>
                    <div className="verify-images-sm">
                      {a.images.map((url, i) => (
                        <img key={i} src={url} alt="材料" />
                      ))}
                    </div>
                  </div>
                  <div className="verify-app-actions">
                    <button className="btn success" onClick={() => approve(a.id)}>通过</button>
                    <button className="btn ghost" onClick={() => reject(a.id)}>拒绝</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 超级管理员：管理员分层名单与分工管理 */}
          {tab === 'admin' && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>管理员管理</h3>

              <div className="admin-mgr-legend">
                <p><strong style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#F5A623' }}><CrownIcon size={13} /> 超级管理员</strong>：拥有全部权限，可增删管理员并分配分工。</p>
                <p><strong style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#8fd3ff' }}><ShieldIcon size={13} /> 普通管理员</strong>：协助日常运营（身份认证审核、集市管理），权限由超级管理员按需授予。</p>
              </div>

              <div className="admin-mgr-duties">
                {PERMISSION_KEYS.map((perm) => (
                  <span key={perm} className="duty-tag">{PERM_LABELS[perm]}</span>
                ))}
              </div>

              {[
                { key: 'super', title: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#F5A623' }}><CrownIcon size={13} /> 超级管理员</span>, list: admins.filter((a) => a.isSuper) },
                { key: 'normal', title: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8fd3ff' }}><ShieldIcon size={13} /> 普通管理员</span>, list: admins.filter((a) => !a.isSuper) },
              ].map((group) =>
                group.list.length === 0 ? null : (
                  <div key={group.key} className="admin-mgr-group">
                    <div className="admin-mgr-group-title">{group.title}（{group.list.length}）</div>
                    {group.list.map((a) => (
                      <div key={a.id} className="admin-mgr-row">
                        <div className="admin-mgr-head">
                          <span className="admin-mgr-avatar">{a.avatar}</span>
                          <strong>{a.nickname}</strong>
                          {a.id === user.id && <span className="admin-mgr-self">我</span>}
                        </div>
                        <div className="admin-mgr-perms">
                          {PERMISSION_KEYS.map((perm) => (
                            <label key={perm} className={'perm-check' + (a.permissions.includes(perm) ? ' on' : '')}>
                              <input
                                type="checkbox"
                                disabled={a.id === user.id}
                                checked={a.permissions.includes(perm)}
                                onChange={() => togglePerm(a, perm)}
                              />
                              <span>{PERM_LABELS[perm]}</span>
                            </label>
                          ))}
                        </div>
                        {a.id !== user.id && (
                          <button className="btn danger admin-mgr-remove" onClick={() => removeAdmin(a.id)}>移除</button>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}

              <div className="admin-add">
                <input
                  placeholder="输入要添加的管理员昵称"
                  value={promoteNick}
                  onChange={(e) => setPromoteNick(e.target.value)}
                />
                <button className="btn primary" onClick={promote}>添加管理员</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
