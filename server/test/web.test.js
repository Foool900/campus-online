import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTags, decodeBingUrl, searchBing } from '../web.js';

test('stripTags 去标签并解码实体', () => {
  assert.equal(stripTags('<h2>标题 <b>加粗</b></h2>'), '标题 加粗');
  assert.equal(stripTags('<p>a&nbsp;b&ensp;c</p>'), 'a b c');
  assert.equal(stripTags('<script>var x=1;</script><p>正文</p>'), '正文');
});

test('decodeBingUrl 解码 /ck/a 跳转链接', () => {
  const real = 'https://baike.baidu.com/item/人工智能';
  const b64 = Buffer.from(real, 'utf8').toString('base64url');
  assert.equal(decodeBingUrl(`https://www.bing.com/ck/a?u=a1${b64}`), real);
  // 非跳转链接原样返回
  assert.equal(decodeBingUrl('https://example.com/x'), 'https://example.com/x');
});

test('searchBing 解析 h2 标题与链接（含跳转解码）', async () => {
  const originalFetch = globalThis.fetch;
  const html = `
    <html><head><script>x</script></head><body>
      <h2><a href="https://www.bing.com/ck/a?u=a1${Buffer.from('https://a.com/1', 'utf8').toString('base64url')}">结果一</a></h2><p>摘要一</p>
      <h2><a href="https://b.com/2">结果二</a></h2><p>摘要二</p>
    </body></html>`;
  globalThis.fetch = async () => new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
  try {
    const r = await searchBing('test', 3);
    assert.equal(r.length, 2);
    assert.equal(r[0].title, '结果一');
    assert.equal(r[0].url, 'https://a.com/1');
    assert.equal(r[1].title, '结果二');
    assert.equal(r[1].url, 'https://b.com/2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
