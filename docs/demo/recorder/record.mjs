// Campus Online 演示视频自动录制脚本（5 分钟版）
// 按 docs/demo/演示脚本-5min.md 的节奏，每屏停留到对应解说时长，总长约 300s。
// 用系统 Edge 无头打开 localhost:5173，登录小荷，边录视频边截屏。
// 用法：node record.mjs
import { chromium } from 'playwright';
import { mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(__dirname, '..', 'screenshots');
const VIDEO = path.join(__dirname, '..', 'video');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(VIDEO, { recursive: true });

const BASE = 'http://localhost:5173';
const VIEW = { width: 1920, height: 1080 };
const T0 = Date.now();

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: VIEW,
  deviceScaleFactor: 1,
  recordVideo: { dir: VIDEO, size: VIEW },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);

let n = 0;
async function shot(name) {
  n += 1;
  const f = path.join(SHOTS, `${String(n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f });
  console.log(`📸 ${String(n).padStart(2, '0')} ${name}  [${((Date.now() - T0) / 1000).toFixed(1)}s]`);
  return f;
}
const hold = (sec) => page.waitForTimeout(Math.round(sec * 1000));
async function step(name, fn) {
  console.log(`▶ ${name}  [${((Date.now() - T0) / 1000).toFixed(1)}s]`);
  try {
    await fn();
  } catch (e) {
    console.log(`⚠ ${name} 跳过：${e.message?.split('\n')[0]}`);
  }
}

// ===== 1. 开场 + 登录（0:00–0:20）=====
await step('登录', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nickname', { timeout: 15000 });
  await page.fill('#nickname', '小荷');
  await page.fill('#password', 'demo1234');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForSelector('.map-viewport', { timeout: 15000 });
  await hold(14);
  await shot('01-登录-地图');
});

// ===== 2. 地图 + 区域频道（0:20–0:50）=====
await step('切换校区', async () => {
  await hold(5);
  await page.getByRole('button', { name: '换地图', exact: true }).click();
  await hold(6);
  await shot('02-切换校区');
});
await step('区域对话框', async () => {
  const node = page.locator('g.node').first();
  if (await node.count()) {
    await node.click({ force: true, timeout: 4000 }).catch(() => {});
    await hold(3);
    if (await page.locator('.area-dialog').count()) {
      await shot('03-区域对话框');
      await page.getByRole('button', { name: '关闭' }).click().catch(() => {});
    }
  }
  await hold(12);
});

// ===== 3. 世界频道（0:50–1:20）=====
await step('世界频道发消息', async () => {
  await page.fill('input[placeholder=">_ 输入消息…"]', '大家好，这是 Campus Online 的世界频道～');
  await page.keyboard.press('Enter');
  await hold(4);
  await shot('04-世界频道');
  await hold(24);
});

// ===== 4. 任务（1:20–1:50）=====
await step('任务', async () => {
  await page.goto(`${BASE}/tasks`, { waitUntil: 'domcontentloaded' });
  await hold(12);
  await shot('05-任务');
  await page.goto(`${BASE}/task/1`, { waitUntil: 'domcontentloaded' });
  await hold(14);
  await shot('06-任务详情');
});

// ===== 5. 成长系统（1:50–2:25）=====
await step('排行榜/成就/个人页/签到', async () => {
  await page.goto(`${BASE}/leaderboard`, { waitUntil: 'domcontentloaded' });
  await hold(8);
  await shot('07-排行榜');
  await page.goto(`${BASE}/profile?tab=achievements`, { waitUntil: 'domcontentloaded' });
  await hold(8);
  await shot('08-成就');
  await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
  await hold(8);
  await shot('09-个人页');
  await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' });
  await hold(4);
  await shot('10-签到-前');
  await page.getByRole('button', { name: /签到 \+/ }).click().catch(() => {});
  await hold(4);
  await shot('11-签到-后');
});

// ===== 6. 夜市市场（2:25–3:25）=====
await step('夜市市场', async () => {
  await page.goto(`${BASE}/market`, { waitUntil: 'domcontentloaded' });
  await hold(20);
  await shot('12-夜市市场');
  await page.mouse.wheel(0, 700).catch(() => {});
  await hold(20);
  await shot('13-夜市市场-下');
  await hold(16);
});

// ===== 7. 奖池 + 背包 + 虚拟角色（3:25–4:05）=====
await step('奖池/背包/角色', async () => {
  await page.goto(`${BASE}/lottery`, { waitUntil: 'domcontentloaded' });
  await hold(12);
  await shot('14-奖池');
  await page.goto(`${BASE}/bag`, { waitUntil: 'domcontentloaded' });
  await hold(12);
  await shot('15-背包');
  await page.goto(`${BASE}/character`, { waitUntil: 'domcontentloaded' });
  await hold(14);
  await shot('16-虚拟角色');
});

// ===== 8. 剧情 + 信息大厅 + 好友（4:05–4:45）=====
await step('剧情/信息大厅/好友', async () => {
  await page.goto(`${BASE}/story`, { waitUntil: 'domcontentloaded' });
  await hold(12);
  await shot('17-剧情');
  await page.goto(`${BASE}/story/1`, { waitUntil: 'domcontentloaded' });
  await hold(10);
  await shot('18-剧情详情');
  await page.goto(`${BASE}/information`, { waitUntil: 'domcontentloaded' });
  await hold(8);
  await shot('19-信息大厅');
  await page.goto(`${BASE}/co-online`, { waitUntil: 'domcontentloaded' });
  await hold(8);
  await shot('20-好友');
  await page.getByRole('button', { name: '接受', exact: true }).first().click().catch(() => {});
  await hold(2);
});

// ===== 9. 收尾（4:45–5:00）=====
await step('收尾', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await hold(14);
  await shot('21-收尾-地图');
});

const elapsed = ((Date.now() - T0) / 1000).toFixed(1);
console.log(`\n===== 录制完成，耗时 ${elapsed}s =====`);

// 结束并落盘视频，改名为 demo-5min.webm
await context.close();
const rawVideo = await page.video().path();
const outVideo = path.join(VIDEO, 'demo-5min.webm');
renameSync(rawVideo, outVideo);
console.log(`截屏目录：${SHOTS}`);
console.log(`视频文件：${outVideo}`);
await browser.close();
