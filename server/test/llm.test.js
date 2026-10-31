import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletion } from '../llm.js';

test('chatCompletion 成功调用 OpenAI 兼容接口', async () => {
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, options = {}) => {
    captured = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: '云模型回答' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const text = await chatCompletion({ baseUrl: 'https://api.deepseek.com/v1/', apiKey: 'sk-123', model: 'deepseek-chat', messages: [{ role: 'user', content: '你好' }] });
    assert.equal(text, '云模型回答');
    assert.equal(captured.url, 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(captured.headers.Authorization, 'Bearer sk-123');
    assert.equal(captured.body.model, 'deepseek-chat');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chatCompletion 失败返回 null（非 2xx）', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('err', { status: 401 });
  try {
    assert.equal(await chatCompletion({ baseUrl: 'https://a.com', apiKey: 'k', model: 'm', messages: [] }), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chatCompletion 缺参数返回 null', async () => {
  assert.equal(await chatCompletion({ baseUrl: '', apiKey: 'k', model: 'm', messages: [] }), null);
  assert.equal(await chatCompletion({ baseUrl: 'https://a.com', apiKey: '', model: 'm', messages: [] }), null);
  assert.equal(await chatCompletion({ baseUrl: 'https://a.com', apiKey: 'k', model: '', messages: [] }), null);
});
