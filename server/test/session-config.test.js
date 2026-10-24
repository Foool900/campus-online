import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const { marketSessionConfig } = await import('../routes/market.js');

initDb();

test('session config 返回盲盒保证金/保底比率，与 config.js 一致', () => {
  const c = marketSessionConfig();
  assert.equal(c.blindboxDepositRatio, config.market.blindboxDepositRatio);
  assert.equal(c.blindboxMinValueRatio, config.market.blindboxMinValueRatio);
  // 原有字段仍在
  assert.ok('depositCoin' in c);
  assert.ok('broadcastFee' in c);
  assert.ok('flashSaleBudget' in c);
  assert.ok('tradeFeeRate' in c);
});

test('market_configs 覆盖 blindboxDepositRatio 时生效', () => {
  db.prepare("INSERT INTO market_configs (key, value, updated_at) VALUES ('blindboxDepositRatio', '0.6', ?)").run(nowIso());
  try {
    assert.equal(marketSessionConfig().blindboxDepositRatio, 0.6);
    // 未覆盖的保底比率仍取 config.js 值
    assert.equal(marketSessionConfig().blindboxMinValueRatio, config.market.blindboxMinValueRatio);
  } finally {
    db.prepare("DELETE FROM market_configs WHERE key = 'blindboxDepositRatio'").run();
  }
});
