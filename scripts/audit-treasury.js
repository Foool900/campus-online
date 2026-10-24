// 对账脚本：金币守恒（mint−sink vs 用户总金币）+ 当前奖池（SYSTEM 账户）展示。
// 用法：node scripts/audit-treasury.js [dbPath]
// 只读：仅执行 SELECT，不写任何数据。

const dbPath =
  process.argv[2] ||
  process.env.DB_PATH ||
  new URL('../server/data/campus.db', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
process.env.DB_PATH = dbPath;

const { db } = await import('../server/db.js');

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

console.log('=== 对账报告 ===');
console.log('DB:', dbPath);

// ============================================================
// 一、对账（守恒校验）
// 公式：SUM(coin+frozen) = mint − sink + 历史回填(白名单)
// 说明：pay / transfer / freeze / refund 守恒，不计入 mint/sink。
// ============================================================

let userCoins = { coin: 0, frozen: 0 };
if (tableExists('users')) {
  userCoins = db.prepare('SELECT COALESCE(SUM(coin),0) AS coin, COALESCE(SUM(frozen_coin),0) AS frozen FROM users').get();
}

console.log('\n--- 对账（守恒校验）---');
console.log('SUM(users.coin)        =', userCoins.coin);
console.log('SUM(users.frozen_coin) =', userCoins.frozen);
console.log('用户金币总量           =', userCoins.coin + userCoins.frozen);

let tx = [];
if (tableExists('coin_transactions')) {
  tx = db.prepare('SELECT type, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM coin_transactions GROUP BY type').all();
}
console.log('--- coin_transactions 按类型 ---');
if (tx.length === 0) console.log('（无 coin_transactions 表或空）');
for (const r of tx) console.log(`${r.type.padEnd(8)} ${String(r.n).padStart(5)} 笔, 总额 ${r.total}`);

const mint = tx.find((r) => r.type === 'mint')?.total ?? 0;
const sink = tx.find((r) => r.type === 'sink')?.total ?? 0;
const netMinted = mint - sink;
const realTotal = userCoins.coin + userCoins.frozen;
const rawDiff = netMinted - realTotal;

// 已知历史差异（白名单）：已解释、不视为账务异常。
const KNOWN_DIFFS = [
  // v0 迁移把旧 available_exp 回填为 coin（未写对应 mint 流水），账本少记约 30。
  { label: 'v0 迁移 available_exp→coin 回填（未写 mint 流水）', delta: -30 },
];
const explained = KNOWN_DIFFS.reduce((s, d) => s + d.delta, 0);
const unexplained = rawDiff - explained;

console.log('净铸造 (mint - sink)   =', netMinted);
console.log('守恒差（原始）         =', rawDiff);
console.log('已解释差异             =', explained);
for (const d of KNOWN_DIFFS) console.log(`  · ${d.label}: ${d.delta}`);
console.log('未解释差异（目标 0）   =', unexplained);

// ============================================================
// 二、当前奖池（SYSTEM 账户）
// 仅展示；SYSTEM 进出走 pay/transfer 守恒，不参与上面的守恒校验。
// ============================================================

let sysCoin = 0;
if (tableExists('users')) {
  sysCoin = db.prepare("SELECT COALESCE(SUM(coin),0) AS coin FROM users WHERE role='system'").get()?.coin ?? 0;
}
console.log('\n--- 当前奖池（SYSTEM 账户）---');
console.log('SYSTEM.coin            =', sysCoin);
console.log('（仅展示，不参与守恒校验）');

// ============================================================
// 三、market_ledger 相关流水（业务级，可追溯）
// ============================================================

console.log('\n--- market_ledger 相关流水 ---');
let ledger = [];
if (tableExists('market_ledger')) {
  ledger = db.prepare('SELECT biz_type, op, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM market_ledger GROUP BY biz_type, op ORDER BY biz_type').all();
}
if (ledger.length === 0) console.log('（无 market_ledger 流水）');
for (const r of ledger) {
  console.log(`${r.biz_type.padEnd(22)} ${r.op.padEnd(12)} ${String(r.n).padStart(5)} 笔, 总额 ${r.total}`);
}

// ============================================================
// 四、结论
// ============================================================

console.log('\n--- 结论 ---');
console.log('· 守恒公式：SUM(coin+frozen) = mint − sink + 30（30 为历史回填白名单）；');
console.log('· pay / transfer / freeze / refund 守恒，不计入 mint/sink；');
console.log('· 奖池 = SYSTEM 账户 coin：来源为手续费/摊位费/租金/喇叭费/秒杀收入，去向为抽奖奖金；');
console.log('· 未解释差异应为 0（否则有账务异常，需排查）。');
