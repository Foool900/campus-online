// ============================================================
// 集中配置：经验 / 金币 / 任务 / 签到 / 市场(夜市) / 抽奖
// 前端展示以服务端返回为准；此处为唯一默认值来源。
// ============================================================

// 等级规则：level = floor(exp / 100) + 1
export const levelOf = (exp) => Math.floor(exp / 100) + 1;

// 橱窗展览位 = min(上限, 基础位 + floor(等级 / 每档等级))；服务端唯一来源，客户端不重算
export const showcaseSlots = (level) =>
  Math.min(config.showcase.maxSlots, config.showcase.baseSlots + Math.floor(Math.max(1, Number(level) || 1) / config.showcase.levelStep));

export const config = {
  // 经验（等级成长，只发不扣）
  exp: {
    todoComplete: 10, // 完成私密备忘
    taskComplete: 10, // 完成公开任务（接取者）
    dailyCap: 300,    // 每日行为经验上限（防刷）
  },
  // 金币经济（进水 / 出水 / 上限）
  coin: {
    capRatio: 0.2, // 单任务赏金 ≤ 发布者金币 × 20%
    capAbsolute: 500, // 单任务赏金全局硬上限
    dailyPublishByLevel: { '1-5': 200, '6-10': 500 }, // 每日发布赏金总额上限（按等级分档）
    dailyAccept: 300, // 每日接取获得金币上限
    dailyPairTransfer: 3, // 每日同一对用户金币往来次数上限
    tradeFeeRate: 0.05, // 市场交易手续费率（基准）
  },
  // 任务规则
  task: {
    dailyPublishPublic: 5,
    minCompleteMinutes: 10,
    maxRejectCount: 3,
    expireAction: 'autoRefund',
  },
  // 每日签到
  signin: {
    base: 10,
    streakBonus: 2,
    streakMaxBonus: 20,
  },
  // 校园夜市
  market: {
    // 期次节奏（服务端权威时间）
    signupBeforeMin: 60,     // 报名开始：开市前 60 分钟
    signupCloseBeforeMin: 5, // 报名截止：开市前 5 分钟
    openHour: 19,            // 默认开市 19:00
    openMinute: 0,
    durationMin: 240,        // 开市时长 4 小时
    // 流动地摊
    stallCount: 30,
    roamingMinutes: 30,      // 摆摊限时
    roamingItemSlots: 3,     // 地摊上架上限
    depositCoin: 5,          // 可退押金
    removeCooldownMin: 10,   // 上架后下架冷却
    // 固定店铺
    shopCount: 5,
    shopItemSlots: 20,
    shopTermDays: 7,         // 每周竞拍
    // 信誉
    reputationBase: 70,
    reputationProtectOrders: 5,
    rateWindowDays: 30,        // 订单完成后可评价天数
    // 盲盒
    blindboxDepositRatio: 0.8,  // 保证金 ≥ 80% 标价
    blindboxMinValueRatio: 0.1, // 保底 ≥ 10% 标价
    blindboxHoldHours: 24,      // 开盒后举报期
    // 砍价
    bargainPayHours: 24,        // 接受后支付期
    // 喇叭
    broadcastPerUserPerSession: 3,
    // 举报
    reportMonthlyLimit: 3,
    // 官方秒杀
    flashSaleBudget: 10000,     // 补贴预算上限
    // 摊位费/租金分配（treasury 占比，其余 sink 销毁）
    stallFeeTreasuryRatio: 0.5,
  },
  // 抽奖
  lottery: {
    cost: 50,
    prizes: [5, 10, 20, 50, 100, 200],
  },
  // 背包 / 橱窗
  showcase: {
    baseSlots: 3,  // 初始展览位
    levelStep: 5,  // 每升 5 级 +1 位
    maxSlots: 10,  // 展览位上限
  },
  // 剧情
  story: {
    anniversaryDays: 365, // 使用剧情满 N 天后「时间线故事书」解锁定稿
  },
  // 虚拟角色（像素装扮）
  character: {
    slots: ['hair', 'hat', 'outfit', 'shoes', 'accessory'], // 装备栏位（渲染从底到顶）
    skinTones: ['fair', 'warm', 'tan', 'deep'],             // 肤色档位
    bodies: ['slim', 'standard', 'sturdy'],                 // 体型档位
    faces: ['neutral', 'happy', 'cool', 'shy'],             // 表情档位
  },
};

// 按等级取每日发布赏金上限
export function dailyPublishCap(level) {
  const { dailyPublishByLevel } = config.coin;
  const ranges = Object.keys(dailyPublishByLevel)
    .map((k) => {
      const [lo, hi] = k.split('-').map(Number);
      return { lo, hi, cap: dailyPublishByLevel[k] };
    })
    .sort((a, b) => a.lo - b.lo);
  const hit = ranges.find((r) => level >= r.lo && level <= r.hi);
  if (hit) return hit.cap;
  if (level < ranges[0].lo) return ranges[0].cap;
  return ranges[ranges.length - 1].cap;
}

// 单任务赏金上限 = min(金币 × capRatio, capAbsolute)，向下取整
export function taskRewardCap(coin) {
  return Math.floor(Math.min(coin * config.coin.capRatio, config.coin.capAbsolute));
}
