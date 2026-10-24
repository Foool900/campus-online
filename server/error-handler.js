// 全局错误处理中间件：
// - entity.too.large（body 超限）→ 413 通用文案
// - 4xx 业务错误（带 err.status 且 < 500）→ 透传 err.message（业务文案），附带 err.code
// - 其余（含 5xx / 未知错误）→ 500 兜底，不泄露 err.message（可能含 SQL 错误 / 文件路径等内部信息）
export default function errorHandler(err, req, res, next) {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: '文件过大' });
  }
  if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error('[server] 未处理错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
}
