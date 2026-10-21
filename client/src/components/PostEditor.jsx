import { useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

const CATEGORIES = ['学习', '运动', '活动', '求助', '闲聊', '其他'];

export default function PostEditor({ channel, onClose, onPublished }) {
  const { user } = useUser();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('活动');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!user) return;
    const t = title.trim();
    if (!t) {
      setError('请填写标题');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const post = await api.createPost(channel.id, {
        userId: user.id,
        title: t,
        content: content.trim(),
        category,
      });
      onPublished(post);
    } catch (err) {
      setError(err.message || '发布失败');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card post-editor" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>📝 发布活动帖</h3>
        <p className="modal-sub">发布到「{channel.name}」活动区</p>

        <label htmlFor="post-title">标题 *</label>
        <input
          id="post-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          placeholder="一句话说明活动 / 话题"
          autoFocus
        />

        <label htmlFor="post-category">分类</label>
        <select id="post-category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label htmlFor="post-content">正文</label>
        <textarea
          id="post-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={2000}
          placeholder="活动详情、时间地点、参与方式…"
          rows={5}
        />

        {error && <div className="form-error">{error}</div>}

        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn primary" disabled={submitting}>
            {submitting ? '发布中…' : '发布'}
          </button>
        </div>
      </form>
    </div>
  );
}
