import { useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';
import { COLLEGES } from '../colleges.js';

export default function NicknameModal() {
  const { setUser } = useUser();
  const [nickname, setNickname] = useState('');
  const [college, setCollege] = useState(COLLEGES[0]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const name = nickname.trim();
    if (!name) {
      setError('请填写昵称');
      return;
    }
    if (name.length < 2 || name.length > 20) {
      setError('昵称长度需为 2-20 个字符');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const u = await api.createUser({ nickname: name, college });
      setUser(u);
    } catch (err) {
      setError(err.message || '创建失败，请重试');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <form className="modal-card" onSubmit={submit}>
        <h2>🎓 欢迎来到 Campus Online</h2>
        <p className="modal-sub">河南大学 · 校园游戏化社交原型</p>

        <label htmlFor="nickname">昵称（2-20 字）</label>
        <input
          id="nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={20}
          placeholder="给自己起个响亮的名字"
          autoFocus
        />

        <label htmlFor="college">学院</label>
        <select id="college" value={college} onChange={(e) => setCollege(e.target.value)}>
          {COLLEGES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {error && <div className="form-error">{error}</div>}

        <button type="submit" className="btn primary modal-submit" disabled={submitting}>
          {submitting ? '进入中…' : '进入校园'}
        </button>
      </form>
    </div>
  );
}
