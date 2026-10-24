import { test } from 'node:test';
import assert from 'node:assert/strict';

import errorHandler from '../error-handler.js';

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
}
const next = () => {};

test('entity.too.large → 413 通用文案（不泄露 body 解析错误）', () => {
  const res = mockRes();
  const err = Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413 });
  errorHandler(err, {}, res, next);
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.body, { error: '文件过大' });
});

test('4xx 业务错误透传 status/code/message', () => {
  const res = mockRes();
  const err = Object.assign(new Error('市场未开市'), { status: 409, code: 'MARKET_CLOSED' });
  errorHandler(err, {}, res, next);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: '市场未开市', code: 'MARKET_CLOSED' });
});

test('err.status=500 → 500 兜底，不泄露内部 message', () => {
  const res = mockRes();
  const internal = 'SQLITE_BUSY: database is locked at /home/app/server/data/campus.db';
  const err = Object.assign(new Error(internal), { status: 500 });
  errorHandler(err, {}, res, next);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: '服务器内部错误' });
  assert.notEqual(res.body.error, internal); // 内部信息不泄露
});

test('普通 Error（无 status）→ 500 兜底，不泄露内部 message', () => {
  const res = mockRes();
  const internal = 'Cannot read properties of undefined (reading \'id\')';
  const err = new Error(internal);
  errorHandler(err, {}, res, next);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: '服务器内部错误' });
  assert.notEqual(res.body.error, internal);
});
