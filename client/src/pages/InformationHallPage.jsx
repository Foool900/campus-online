import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// 活动状态 → 中文标签 + 配色（与后端 STATUS_LABELS 对齐）
const STATUS_LABELS = { draft: '草稿', open: '报名中', ongoing: '进行中', ended: '已结束', cancelled: '已取消' };
const STATUS_COLORS = { draft: '#93a0ad', open: '#34d399', ongoing: '#8b9df5', ended: '#6b7280', cancelled: '#f87171' };

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 左侧导航图标（16×16 线框，继承 currentColor）
const Icons = {
  discovery: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M10.2 5.8l-1.4 3.1-3.1 1.4 1.4-3.1z" />
    </>
  ),
  echo: (
    <>
      <circle cx="7" cy="7" r="4.4" />
      <path d="M10.4 10.4L14 14" />
    </>
  ),
  radar: (
    <>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 2v2.6M8 13.4V14" />
      <path d="M8 8l4.5-2.6" />
    </>
  ),
  lens: (
    <>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.4V3M8 13v1.6M1.4 8H3M13 8h1.6" />
    </>
  ),
};

const NAV = [
  { key: 'discovery', label: '发现', en: 'DISCOVERY', icon: Icons.discovery },
  { key: 'echo', label: '回响', en: 'ECHO', icon: Icons.echo },
  { key: 'radar', label: '雷达', en: 'RADAR', icon: Icons.radar },
  { key: 'lens', label: '聚焦', en: 'LENS', icon: Icons.lens },
];

// 统计卡
function StatCard({ label, value, accent }) {
  return (
    <div className="mk-stat">
      <div className="mk-stat-label">{label}</div>
      <div className={'mk-stat-value' + (accent ? ' accent' : '')}>{value}</div>
    </div>
  );
}

// 活动卡片（可点击跳转活动详情）
function ActivityCard({ post, onOpen }) {
  const color = STATUS_COLORS[post.status] || '#93a0ad';
  return (
    <button className="info-activity" onClick={() => onOpen(post.id)}>
      <div className="info-activity-head">
        <span className="info-activity-title">{post.title || '（无标题）'}</span>
        <span className="info-status" style={{ color, borderColor: color }}>
          {post.statusLabel || post.status}
        </span>
      </div>
      <div className="info-activity-meta">
        <span>{post.areaEmoji || '📍'} {post.areaName || ''}</span>
        <span>{post.nickname || ''}</span>
        <span>{post.category || ''}</span>
        <span>{fmtTime(post.createdAt)}</span>
      </div>
    </button>
  );
}

// 资讯条目
function NewsItem({ item, onOpen }) {
  const clickable = !!item.link;
  return (
    <button
      className={'info-news-item' + (clickable ? ' clickable' : '')}
      onClick={() => clickable && onOpen(item.link)}
    >
      <div className="info-news-title">
        <span className="info-news-src">{item.source}</span>
        <span>{item.title}</span>
      </div>
      {item.summary && <div className="info-news-summary">{item.summary}</div>}
      <div className="info-news-time">{fmtTime(item.time)}</div>
    </button>
  );
}

// 雷达图（手写 SVG：同心环 + 扫描线 + 按区域聚合的进行中活动热点）
function RadarChart({ posts }) {
  const ongoing = posts.filter((p) => p.status === 'open' || p.status === 'ongoing');
  const byArea = new Map();
  for (const p of ongoing) {
    const key = p.areaId ?? 'unknown';
    const cur = byArea.get(key) || { area: p, count: 0 };
    cur.count += 1;
    byArea.set(key, cur);
  }
  const blips = [...byArea.values()];
  const cx = 150;
  const cy = 150;
  const hash = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  };
  const nodes = blips.map((b) => {
    const a = ((hash(String(b.area.areaId)) % 360) * Math.PI) / 180;
    const r = 42 + (hash(String(b.area.areaId) + ':r') % 80);
    return { ...b, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });

  return (
    <svg className="info-radar" viewBox="0 0 300 300" role="img" aria-label="进行中活动雷达">
      <circle cx={cx} cy={cy} r="120" className="radar-ring" />
      <circle cx={cx} cy={cy} r="80" className="radar-ring" />
      <circle cx={cx} cy={cy} r="40" className="radar-ring" />
      <line x1={cx} y1={cy - 120} x2={cx} y2={cy + 120} className="radar-grid" />
      <line x1={cx - 120} y1={cy} x2={cx + 120} y2={cy} className="radar-grid" />
      <line x1={cx - 85} y1={cy - 85} x2={cx + 85} y2={cy + 85} className="radar-grid" />
      <line x1={cx + 85} y1={cy - 85} x2={cx - 85} y2={cy + 85} className="radar-grid" />
      <g>
        <line x1={cx} y1={cy} x2={cx + 118} y2={cy} className="radar-sweep" />
        <animateTransform attributeName="transform" type="rotate" from="0 150 150" to="360 150 150" dur="4s" repeatCount="indefinite" />
      </g>
      {nodes.map((b) => (
        <g key={b.area.areaId}>
          <circle cx={b.x} cy={b.y} r={4 + Math.min(b.count, 6)} className="radar-blip" />
          <title>{b.area.areaName || '未知区域'} · {b.count} 个进行中活动</title>
        </g>
      ))}
      <circle cx={cx} cy={cy} r="3" className="radar-core" />
    </svg>
  );
}

export default function InformationHallPage() {
  const navigate = useNavigate();
  const [view, setView] = useState('discovery');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // { posts, tasks } | null（Echo 结果）
  const [searching, setSearching] = useState(false);
  const [posts, setPosts] = useState([]);
  const [news, setNews] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [lens, setLens] = useState({ category: '', status: '', areaId: '' });

  useEffect(() => {
    let alive = true;
    Promise.allSettled([api.informationPosts(), api.informationNews(), api.tasks('public')]).then(
      ([p, n, t]) => {
        if (!alive) return;
        setPosts(p.status === 'fulfilled' ? p.value : []);
        setNews(n.status === 'fulfilled' ? n.value.items || [] : []);
        setTasks(t.status === 'fulfilled' ? t.value : []);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  const doSearch = async () => {
    const q = query.trim();
    setView('echo');
    setError('');
    if (!q) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      setResults(await api.informationSearch(q));
    } catch (e) {
      setError(e.message);
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  // Discovery 统计
  const stats = useMemo(() => {
    const ongoingCount = posts.filter((p) => p.status === 'ongoing').length;
    const openCount = posts.filter((p) => p.status === 'open').length;
    const openTaskCount = tasks.filter((t) => t.status === 'published').length;
    return { ongoingCount, openCount, openTaskCount, newsCount: news.length };
  }, [posts, tasks, news]);

  // 活动状态分布（Discovery 分布图）
  const statusDist = useMemo(() => {
    const order = ['open', 'ongoing', 'ended', 'cancelled', 'draft'];
    return order.map((s) => ({ status: s, label: STATUS_LABELS[s], count: posts.filter((p) => p.status === s).length }));
  }, [posts]);

  // Lens 筛选选项（由已拉取活动去重而来）
  const lensOptions = useMemo(() => {
    const categories = [...new Set(posts.map((p) => p.category).filter(Boolean))].sort();
    const statuses = [...new Set(posts.map((p) => p.status).filter(Boolean))];
    const areaMap = new Map();
    for (const p of posts) if (p.areaId != null && !areaMap.has(p.areaId)) areaMap.set(p.areaId, p);
    const areas = [...areaMap.values()];
    return { categories, statuses, areas };
  }, [posts]);

  const lensFiltered = useMemo(
    () =>
      posts.filter(
        (p) =>
          (!lens.category || p.category === lens.category) &&
          (!lens.status || p.status === lens.status) &&
          (!lens.areaId || String(p.areaId) === String(lens.areaId))
      ),
    [posts, lens]
  );

  return (
    <div className="page information-page">
      {/* 左侧玻璃导航 */}
      <aside className="mk-sidebar" aria-label="Horizon 导航">
        {NAV.map((n) => (
          <button
            key={n.key}
            title={n.en}
            className={'info-nav' + (view === n.key ? ' active' : '')}
            onClick={() => setView(n.key)}
          >
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {n.icon}
            </svg>
            <span>{n.label}</span>
          </button>
        ))}
      </aside>

      {/* 主列 */}
      <div className="mk-main">
        <div className="info-head">
          <div className="page-head">
            <h1>Horizon</h1>
            <p>搜索 · 全景 · 探索 · 聚焦</p>
          </div>
          <button className="info-help-btn" onClick={() => setHelpOpen(true)} title="Horizon 说明" aria-label="帮助">
            ?
          </button>
        </div>

        {/* 顶部搜索栏（持久） */}
        <div className="info-searchbar">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="输入关键词，回响结果（活动 / 任务）"
            aria-label="搜索"
          />
          <button className="hud-btn" onClick={doSearch} disabled={searching}>
            {searching ? '搜索中…' : '搜索'}
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="mk-content">
          {/* Discovery 探索信息流 */}
          {view === 'discovery' && (
            <div className="info-stack">
              <div className="mk-stats">
                <StatCard label="进行中活动" value={stats.ongoingCount} accent />
                <StatCard label="报名中活动" value={stats.openCount} />
                <StatCard label="开放公开任务" value={stats.openTaskCount} />
                <StatCard label="最新资讯" value={stats.newsCount} />
              </div>

              <div className="info-columns">
                {/* 全部活动 */}
                <section className="mk-card info-panel">
                  <div className="info-panel-head">
                    <h3>全部活动</h3>
                    <span className="info-panel-count">{posts.length}</span>
                  </div>
                  <div className="info-list">
                    {posts.length === 0 ? (
                      <div className="empty-state">&gt; 暂无活动</div>
                    ) : (
                      posts.slice(0, 12).map((p) => <ActivityCard key={p.id} post={p} onOpen={(id) => navigate(`/activity/${id}`)} />)
                    )}
                  </div>
                </section>

                {/* 最新资讯 */}
                <section className="mk-card info-panel">
                  <div className="info-panel-head">
                    <h3>最新资讯</h3>
                    <span className="info-panel-note">占位 · 未来接校园新闻</span>
                  </div>
                  <div className="info-list">
                    {news.length === 0 ? (
                      <div className="empty-state">&gt; 暂无资讯</div>
                    ) : (
                      news.map((it, i) => <NewsItem key={i} item={it} onOpen={(link) => navigate(link)} />)
                    )}
                  </div>
                </section>
              </div>

              {/* 活动状态分布 */}
              <section className="mk-card info-panel">
                <div className="info-panel-head"><h3>活动状态分布</h3></div>
                <div className="info-dist">
                  {statusDist.map((d) => (
                    <div className="info-dist-row" key={d.status}>
                      <span className="info-dist-label">{d.label}</span>
                      <div className="info-dist-bar">
                        <i style={{ width: posts.length ? `${Math.round((d.count / posts.length) * 100)}%` : '0%', background: STATUS_COLORS[d.status] }} />
                      </div>
                      <span className="info-dist-num">{d.count}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* Echo 回响：搜索结果 */}
          {view === 'echo' && (
            <div className="info-stack">
              <div className="info-result-head">
                <h3>{query.trim() ? `「${query.trim()}」的结果` : '输入关键词开始搜索'}</h3>
              </div>
              {!results ? (
                <div className="info-empty-hint">
                  <div className="mk-empty-title">Echo 回响</div>
                  <div className="mk-empty-sub">你输入关键词，系统反馈结果</div>
                </div>
              ) : (
                <>
                  <section className="mk-card info-panel">
                    <div className="info-panel-head"><h3>活动</h3><span className="info-panel-count">{results.posts.length}</span></div>
                    <div className="info-list">
                      {results.posts.length === 0 ? (
                        <div className="empty-state">&gt; 无匹配活动</div>
                      ) : (
                        results.posts.map((p) => <ActivityCard key={p.id} post={p} onOpen={(id) => navigate(`/activity/${id}`)} />)
                      )}
                    </div>
                  </section>

                  <section className="mk-card info-panel">
                    <div className="info-panel-head"><h3>任务</h3><span className="info-panel-count">{results.tasks.length}</span></div>
                    <div className="info-list">
                      {results.tasks.length === 0 ? (
                        <div className="empty-state">&gt; 无匹配任务</div>
                      ) : (
                        results.tasks.map((t) => (
                          <button className="info-task" key={t.id} onClick={() => navigate(`/task/${t.id}`)}>
                            <div className="info-activity-head">
                              <span className="info-activity-title">{t.title}</span>
                              <span className="info-reward">{t.rewardCoin} 币</span>
                            </div>
                            <div className="info-activity-meta">
                              <span>{t.publisherName || ''}</span>
                              <span>{t.status}</span>
                              <span>{fmtTime(t.createdAt)}</span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>
          )}

          {/* Radar 雷达 */}
          {view === 'radar' && (
            <div className="info-stack">
              <section className="mk-card info-panel">
                <div className="info-panel-head"><h3>进行中活动雷达</h3><span className="info-panel-note">热点按区域聚合</span></div>
                <RadarChart posts={posts} />
              </section>

              <section className="mk-card info-panel">
                <div className="info-panel-head"><h3>热榜</h3></div>
                <div className="info-list">
                  {posts.filter((p) => p.status === 'open' || p.status === 'ongoing').length === 0 ? (
                    <div className="empty-state">&gt; 暂无进行中活动</div>
                  ) : (
                    posts
                      .filter((p) => p.status === 'open' || p.status === 'ongoing')
                      .slice(0, 10)
                      .map((p) => <ActivityCard key={p.id} post={p} onOpen={(id) => navigate(`/activity/${id}`)} />)
                  )}
                </div>
              </section>
            </div>
          )}

          {/* Lens 聚焦：筛选 */}
          {view === 'lens' && (
            <div className="info-stack">
              <section className="mk-card info-panel">
                <div className="info-panel-head"><h3>聚焦筛选</h3></div>
                <div className="info-filters">
                  <select value={lens.category} onChange={(e) => setLens({ ...lens, category: e.target.value })} aria-label="分类">
                    <option value="">全部分类</option>
                    {lensOptions.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={lens.status} onChange={(e) => setLens({ ...lens, status: e.target.value })} aria-label="状态">
                    <option value="">全部状态</option>
                    {lensOptions.statuses.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
                  </select>
                  <select value={lens.areaId} onChange={(e) => setLens({ ...lens, areaId: e.target.value })} aria-label="区域">
                    <option value="">全部区域</option>
                    {lensOptions.areas.map((a) => <option key={a.areaId} value={a.areaId}>{a.areaEmoji || ''} {a.areaName}</option>)}
                  </select>
                  <span className="info-panel-count">共 {lensFiltered.length} 条</span>
                </div>
                <div className="info-list">
                  {lensFiltered.length === 0 ? (
                    <div className="empty-state">&gt; 无匹配活动</div>
                  ) : (
                    lensFiltered.map((p) => <ActivityCard key={p.id} post={p} onOpen={(id) => navigate(`/activity/${id}`)} />)
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {/* 「？」帮助浮层：未来校园新闻接入计划 */}
      {helpOpen && (
        <div className="info-help-mask" onClick={() => setHelpOpen(false)}>
          <div className="info-help-panel" onClick={(e) => e.stopPropagation()}>
            <h3>Horizon · 说明</h3>
            <div className="info-help-intro">
              Horizon 是校园信息的搜索与探索中枢——把散落在各处的活动、任务与资讯，集中到一个大厅里。
            </div>
            <div className="info-help-views">
              <div className="info-help-view">
                <b>发现 Discovery</b>
                <span>信息流首页 · 全部活动 / 最新资讯 / 状态分布</span>
              </div>
              <div className="info-help-view">
                <b>回响 Echo</b>
                <span>关键词搜索 · 输入即回显匹配的活动与任务</span>
              </div>
              <div className="info-help-view">
                <b>雷达 Radar</b>
                <span>全景扫描 · 雷达图呈现各区域进行中活动热点</span>
              </div>
              <div className="info-help-view">
                <b>聚焦 Lens</b>
                <span>条件筛选 · 按分类 / 状态 / 区域下钻</span>
              </div>
            </div>
            <div className="info-help-note">
              「最新资讯」当前为占位数据（最新活动 + 全服喇叭）。未来接入<strong>校园新闻</strong>（学校实时消息）：
              新增 <code>announcements</code> 公告表 + 管理员发布 / 列表接口，切换后前端零改动。
            </div>
            <button className="hud-btn" onClick={() => setHelpOpen(false)}>知道了</button>
          </div>
        </div>
      )}
    </div>
  );
}
