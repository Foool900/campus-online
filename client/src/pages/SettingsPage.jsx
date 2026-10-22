import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

const STATUS_LABELS = { pending: '审核中', approved: '已通过', rejected: '已拒绝' };

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

  useEffect(() => {
    api.verificationMe().then(setMyApp).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    api.verificationPending().then(setPending).catch(() => {});
    api.adminList().then(setAdmins).catch(() => {});
  }, [isAdmin]);

  if (!user) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>⚙️ 设置</h1>
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

  return (
    <div className="page">
      <div className="page-head">
        <h1>⚙️ 设置</h1>
        <p>身份认证与账号管理</p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {msg && <div className="hint-banner">{msg}</div>}

      {/* 身份认证 */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>身份认证</h3>
        {isAdmin ? (
          <div>👑 你是管理员，无需认证</div>
        ) : isStudent ? (
          <div>✅ 你已是认证学员</div>
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

      {/* 管理员：待审核 */}
      {isAdmin && (
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

      {/* 管理员：管理员管理 */}
      {isAdmin && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>管理员管理</h3>
          <div className="admin-list">
            {admins.map((a) => (
              <span key={a.id} className="admin-item">
                {a.avatar} {a.nickname}
                {a.id !== user.id && (
                  <button className="admin-remove" onClick={() => removeAdmin(a.id)} title="移除管理员" aria-label="移除管理员">×</button>
                )}
              </span>
            ))}
          </div>
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
  );
}
