// 一次性对账脚本：账面 treasury vs 真实金币总量，作为「treasury 迁移为真实账户」前的基线。
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

// 1) 账面 treasury
let treasury = null;
if (tableExists('treasury')) {
  treasury = db.prepare('SELECT balance_coin FROM treasury WHERE id=1').get();
}
console.log('\n--- 账面 ---');
console.log('treasury.balance_coin =', treasury?.balance_coin ?? 0);

// 2) 真实金币
let userCoins = { coin: 0, frozen: 0 };
if (tableExists('users')) {
  userCoins = db.prepare('SELECT COALESCE(SUM(coin),0) AS coin, COALESCE(SUM(frozen_coin),0) AS frozen FROM users').get();
}
console.log('\n--- 真实金币（users）---');
console.log('SUM(users.coin)        =', userCoins.coin);
console.log('SUM(users.frozen_coin) =', userCoins.frozen);
console.log('SUM(coin+frozen)       =', userCoins.coin + userCoins.frozen);

// 3) coin_transactions 按类型（真实金币流水）
console.log('\n--- coin_transactions 按类型 ---');
let tx = [];
if (tableExists('coin_transactions')) {
  tx = db.prepare('SELECT type, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM coin_transactions GROUP BY type').all();
}
if (tx.length === 0) {
  console.log('（无 coin_transactions 表或空）');
}
for (const r of tx) {
  console.log(`${r.type.padEnd(8)} ${String(r.n).padStart(5)} 笔, 总额 ${r.total}`);
}

// 4) 守恒校验：净铸造 (mint - sink) 应等于用户金币总量
const mint = tx.find((r) => r.type === 'mint')?.total ?? 0;
const sink = tx.find((r) => r.type === 'sink')?.total ?? 0;
const netMinted = mint - sink;
const realTotal = userCoins.coin + userCoins.frozen;
const rawDiff = netMinted - realTotal;

// 已知历史差异（白名单）：已解释、不视为账务异常。
// delta 为该条目贡献给「守恒差」的有符号部分（正=账本多记，负=账本少记）。
const KNOWN_DIFFS = [
  // v0 迁移把旧 available_exp 回填为 coin（未写对应 mint 流水），账本少记约 30。
  { label: 'v0 迁移 available_exp→coin 回填（未写 mint 流水）', delta: -30 },
];
const explained = KNOWN_DIFFS.reduce((s, d) => s + d.delta, 0);
const unexplained = rawDiff - explained;

console.log('\n--- 守恒校验 ---');
console.log('净铸造 (mint - sink)   =', netMinted);
console.log('用户金币总量           =', realTotal);
console.log('守恒差（原始）         =', rawDiff);
console.log('已解释差异             =', explained);
for (const d of KNOWN_DIFFS) console.log(`  · ${d.label}: ${d.delta}`);
console.log('未解释差异（目标 0）   =', unexplained);

// 5) market_ledger 里 treasury 相关 op（部分可追溯）
console.log('\n--- market_ledger treasury 相关 op ---');
let ledger = [];
if (tableExists('market_ledger')) {
  ledger = db.prepare("SELECT op, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM market_ledger WHERE op IN ('treasury_in','treasury_out','budget_spend') GROUP BY op").all();
}
if (ledger.length === 0) {
  console.log('（无 market_ledger treasury 相关流水）');
}
for (const r of ledger) {
  console.log(`${r.op.padEnd(12)} ${String(r.n).padStart(5)} 笔, 总额 ${r.total}`);
}

// 6) 结论
console.log('\n--- 结论 ---');
console.log('treasury.balance_coin 是「账面数字」，不对应真实金币：');
console.log('  · 手续费 addTreasury 前，金币已被 sink 销毁（守恒差不变）；');
console.log('  · 抽奖 spendTreasury 后，金币被 mint 铸造（守恒差不变）；');
console.log('  · 因此 treasury 账面余额与真实金币无一一映射，迁移为真实账户时需以「守恒差归零」为目标。');
console.log('  · 另：addTreasury / spendTreasury 本身无独立流水表，只有 net 结果落在 treasury.balance_coin。');
