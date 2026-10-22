// ============================================================
// 集中配置：经验 / 任务规则与上限（修改位置：本文件）
// 前端展示以服务端返回为准；此处为唯一默认值来源。
// ============================================================

// 等级规则：level = floor(exp / 100) + 1
// 注意：client/src/pages/TasksPage.jsx 里有一份同名实现，改这里时要同步改那边。
export const levelOf = (exp) => Math.floor(exp / 100) + 1;

export const config = {
  // 经验奖励上限
  reward: {
    capRatio: 0.2, // 单任务奖励 ≤ 发布者 availableExp × 20%
    capAbsolute: 500, // 单任务奖励全局硬上限
    dailyPublishByLevel: { '1-5': 200, '6-10': 500 }, // 每日发布经验总额上限（按等级分档）
    dailyAccept: 300, // 每日接取获得经验上限
    dailyPairTransfer: 3, // 每日同一对用户经验往来次数上限
  },
  // 任务规则
  task: {
    dailyPublishPublic: 5, // 每日可发公开任务数
    minCompleteMinutes: 10, // 发布后最短提交时间（分钟）
    maxRejectCount: 3, // 被驳回 N 次后任务终止
    expireAction: 'autoRefund', // 超时未验收默认退回（可选 autoApprove）
  },
};

// 按等级取每日发布经验上限（等级超出分档时：低于最低档按最低，高于最高档按最高）
export function dailyPublishCap(level) {
  const { dailyPublishByLevel } = config.reward;
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

// 单任务奖励上限 = min(availableExp × capRatio, capAbsolute)，向下取整
export function taskRewardCap(availableExp) {
  return Math.floor(Math.min(availableExp * config.reward.capRatio, config.reward.capAbsolute));
}
