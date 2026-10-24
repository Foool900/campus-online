import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useUser } from '../UserContext.jsx';

const STATUS_LABELS = {
  pending: '待处理',
  reviewing: '处理中',
  resolved_buyer: '买家胜诉',
  resolved_seller: '卖家胜诉',
  dismissed: '已驳回',
};

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

// 纠纷举报（举报方视角）：开盒 24h 内可举报的盲盒订单 + 本月配额 + 我的举报记录
// 自包含：GET /market/disputes/mine，30s 轮询（仅页面可见时）；只 gate isStudent，不 gate open（售后）
export default function MarketDisputeReport() {
  const { user } = useUser();
  const isStudent = user && (user.role === 'student' || user.role === 'admin');

  const [data, setData] = useState(null); // { limit, used, remaining, reportable, disputes }
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [formOrderId, setFormOrderId] = useState(null); // 正在填写举报的订单
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // load 不清 err/msg（30s 轮询不清提示），只在失败时清旧 msg 再设 err
  const load = useCallback(() => {
    api.marketDisputes()
      .then(setData)
      .catch((e) => { setMsg(''); setErr(e.message); });
  }, []);

  useEffect(() => {
    if (!isStudent) return;
    load();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30000);
    return () => clearInterval(poll);
  }, [isStudent, load]);

  // 成功提示 3 秒自动清除
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  if (!isStudent) return null;

  const limit = data?.limit ?? 0;
  const used = data?.used ?? 0;
  const remaining = data?.remaining ?? 0;
  const reportable = data?.reportable ?? [];
  const disputes = data?.disputes ?? [];

  const openForm = (o) => {
    setErr(''); setMsg('');
    setFormOrderId(o.orderId);
    setReason('');
    setEvidence('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    if (!reason.trim()) return setErr('请填写举报原因');
    const body = { orderId: formOrderId, type: 'blindbox_mismatch', reason: reason.trim() };
    if (evidence.trim()) body.evidenceJson = evidence.trim();
    setBusy(true);
    try {
      await api.marketDispute(body);
      setFormOrderId(null);
      setReason('');
      setEvidence('');
      setMsg('举报已提交');
      load();
    } catch (e) {
      if (e.code === 'SENSITIVE_CONTENT') setErr('内容包含违规词，请修改');
      else if (e.code === 'REPORT_WINDOW_EXPIRED') setErr('盲盒举报已超过开盒后 24 小时');
      else if (e.code === 'REPORT_LIMIT_EXCEEDED') setErr('本月举报次数已达上限');
      else if (e.code === 'REPORTED') setErr('你已举报过该订单');
      else setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ margin: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>⚖️ 纠纷举报</span>
        {data && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            本月已举报 {used}/{limit}{remaining > 0 ? `（剩 ${remaining} 次）` : '（已用完）'}
          </span>
        )}
      </div>

      {data && remaining <= 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>本月举报次数已用完</div>}

      {!data ? (
        <div className="empty-state">&gt; 加载中...</div>
      ) : reportable.length === 0 ? (
        <div className="empty-state">&gt; 暂无可举报的盲盒订单</div>
      ) : (
        reportable.map((o) => {
          const editing = formOrderId === o.orderId;
          return (
            <div key={o.orderId} className="card" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{o.title}</span>
                  <span className="post-category" style={{ marginLeft: 8 }}>盲盒</span>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    保底 🪙{o.valueCoin} · 举报截止 {fmtTime(o.deadlineAt)}
                  </div>
                </div>
                {!editing && (
                  <button className="btn primary" disabled={remaining <= 0} onClick={() => openForm(o)}>举报</button>
                )}
              </div>

              {editing && (
                <form onSubmit={submit} style={{ marginTop: 8 }}>
                  <div className="field" style={{ marginTop: 6 }}>
                    <label>举报原因 *</label>
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={200}
                      placeholder="请描述货不对板 / 欺诈情况" style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
                  </div>
                  <div className="field" style={{ marginTop: 6 }}>
                    <label>证据说明（可选）</label>
                    <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} maxLength={500}
                      placeholder="补充证据描述（纯文本）" style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button type="submit" className="btn primary" disabled={busy}>{busy ? '提交中...' : '提交举报'}</button>
                    <button type="button" className="btn ghost" disabled={busy} onClick={() => setFormOrderId(null)}>取消</button>
                  </div>
                </form>
              )}
            </div>
          );
        })
      )}

      {disputes.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="tabs" style={{ margin: '6px 0' }}><span style={{ fontWeight: 600 }}>📋 我的举报记录</span></div>
          {disputes.map((d) => (
            <div key={d.id} style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 0' }}>
              <span className={'status-badge status-' + d.status} style={{ marginRight: 8 }}>{STATUS_LABELS[d.status] || d.status}</span>
              {d.reason}
              <span style={{ marginLeft: 8 }}>{fmtTime(d.createdAt)}</span>
            </div>
          ))}
        </div>
      )}

      {err && <div className="form-error">{err}</div>}
      {msg && <div className="form-success">{msg}</div>}
    </div>
  );
}
