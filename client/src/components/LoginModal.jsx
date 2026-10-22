import { useState } from 'react';
import { api } from '../api.js';
import { COLLEGES } from '../colleges.js';

// 登录 / 注册 / 老账号设置密码 三合一弹窗
export default function LoginModal({ onAuth }) {
  const [mode, setMode] = useState('login'); // login | register | set-password
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [college, setCollege] = useState(COLLEGES[0]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    const name = nickname.trim();
    if (name.length < 2 || name.length > 20) return '昵称长度需为 2-20 个字符';
    if (password.length < 6) return '密码至少 6 位';
    return null;
  };

  const submit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      let r;
      if (mode === 'login') r = await api.authLogin({ nickname: nickname.trim(), password });
      else if (mode === 'register') r = await api.authRegister({ nickname: nickname.trim(), password, college });
      else r = await api.authSetPassword({ nickname: nickname.trim(), password });
      onAuth(r.token, r.user);
    } catch (err2) {
      if (mode === 'login' && err2.status === 409) {
        setMode('set-password');
        setError('该账号还未设置密码，请先设置一个密码');
      } else {
        setError(err2.message || '操作失败，请重试');
      }
      setSubmitting(false);
    }
  };

  const title =
    mode === 'register' ? '🎓 注册账号' : mode === 'set-password' ? '🔐 设置密码' : '🎓 登录 Campus Online';

  const switchText =
    mode === 'login' ? '没有账号？去注册' : mode === 'register' ? '已有账号？去登录' : '返回登录';

  return (
    <div className="modal-overlay">
      <form className="modal-card" onSubmit={submit}>
        <h2>{title}</h2>
        <p className="modal-sub">河南大学 · 校园游戏化社交</p>

        <label htmlFor="nickname">昵称（2-20 字）</label>
        <input
          id="nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={20}
          placeholder="你的昵称"
          autoFocus
        />

        <label htmlFor="password">密码（至少 6 位）</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={100}
          placeholder="输入密码"
        />

        {mode === 'register' && (
          <>
            <label htmlFor="college">学院</label>
            <select id="college" value={college} onChange={(e) => setCollege(e.target.value)}>
              {COLLEGES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </>
        )}

        {error && <div className="form-error">{error}</div>}

        <button type="submit" className="btn primary modal-submit" disabled={submitting}>
          {submitting ? '请稍候…' : mode === 'login' ? '登录' : mode === 'register' ? '注册' : '设置密码'}
        </button>

        <button
          type="button"
          className="modal-switch"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
        >
          {switchText}
        </button>
      </form>
    </div>
  );
}
