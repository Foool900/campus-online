// 免费联网搜索 + 抓取：Bing 搜索 + 网页正文抽取（无 API key，纯 Node 内置 fetch）。
// 调用期使用 globalThis.fetch，便于测试 stub。

const SEARCH_URL = 'https://cn.bing.com/search';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await globalThis.fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

// 抽取可读文本：去脚本/样式/标签 + 解码常见 HTML 实体
export function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&ensp;|&emsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

// Bing 结果链接常是 /ck/a 跳转，u=a1<base64url> 才是真实 URL
export function decodeBingUrl(href) {
  const m = String(href || '').match(/[?&]u=a1([^&]+)/i);
  if (!m) return href;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return href;
  }
}

// Bing 搜索：返回 [{ title, url, snippet }]
export async function searchBing(query, count = 5) {
  try {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&mkt=zh-CN&setlang=zh-hans`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9' } }, 10000);
    if (!res.ok) return [];
    const html = await res.text();
    // 去掉 head 和 script，避免干扰（Bing 页面里 head/script 也含 "b_algo" 等片段）
    const body = html.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<script[\s\S]*?<\/script>/gi, '');

    const results = [];
    // 结果标题都在 <h2> 里：<h2><a href="...">标题</a></h2>
    const h2Re = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;
    let m;
    while ((m = h2Re.exec(body)) !== null) {
      const title = stripTags(m[2]);
      const href = decodeBingUrl(m[1]);
      if (!title || !href || !href.startsWith('http')) continue;
      // 该标题之后最近的 <p> 作为摘要
      const after = body.slice(m.index + m[0].length, m.index + m[0].length + 1500);
      const p = after.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      results.push({ title, url: href, snippet: p ? stripTags(p[1]).slice(0, 200) : '' });
      if (results.length >= count) break;
    }
    return results;
  } catch {
    return [];
  }
}

// 抓取网页正文（去标签后的纯文本，截断到 maxChars）
export async function fetchPageText(url, maxChars = 2000) {
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9' } }, 8000);
    if (!res.ok) return '';
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('pdf') || ct.includes('octet-stream') || ct.includes('zip') || ct.includes('image')) return '';
    const html = await res.text();
    return stripTags(html).slice(0, maxChars);
  } catch {
    return '';
  }
}

// 搜索 + 抓取正文：返回 [{ title, url, snippet, text }]
export async function searchWeb(query, { topN = 3 } = {}) {
  const results = await searchBing(query, topN);
  return Promise.all(results.map(async (r) => ({ ...r, text: await fetchPageText(r.url) })));
}
