import { db, nowIso } from './db.js';
import { grantStarterPack } from './inventory.js';

const CAMPUSES = [
  { name: '明伦校区', slug: 'minglun' },
  { name: '金明校区', slug: 'jinming' },
];

// 画布坐标：SVG viewBox 1000 x 1900
// campus / name / emoji / color / cat(分类) / x / y
const AREAS = [
  // ============ 明伦校区 ============
  // 运动与休闲设施
  { campus: 'minglun', name: '运动场', emoji: '⚽', color: '#8fd3a8', cat: '运动设施', x: 210, y: 120 },
  { campus: 'minglun', name: '西运动场', emoji: '⚽', color: '#8fd3a8', cat: '运动设施', x: 130, y: 300 },
  { campus: 'minglun', name: '体育馆', emoji: '🏟️', color: '#8fd3a8', cat: '运动设施', x: 350, y: 620 },
  { campus: 'minglun', name: '室内篮球馆', emoji: '🏀', color: '#8fd3a8', cat: '运动设施', x: 470, y: 640 },
  { campus: 'minglun', name: '室内运动场', emoji: '🏟️', color: '#8fd3a8', cat: '运动设施', x: 610, y: 620 },
  { campus: 'minglun', name: '训练馆', emoji: '🏋️', color: '#8fd3a8', cat: '运动设施', x: 350, y: 740 },
  { campus: 'minglun', name: '游泳馆', emoji: '🏊', color: '#8fd3a8', cat: '运动设施', x: 470, y: 760 },
  { campus: 'minglun', name: '东操场', emoji: '⚽', color: '#8fd3a8', cat: '运动设施', x: 860, y: 920 },
  { campus: 'minglun', name: '轮滑场', emoji: '⛸️', color: '#8fd3a8', cat: '运动设施', x: 860, y: 1060 },

  // 教学、办公与科研楼
  { campus: 'minglun', name: '大礼堂', emoji: '🏛️', color: '#f5c84c', cat: '礼堂', x: 500, y: 280 },
  { campus: 'minglun', name: '小礼堂', emoji: '🏛️', color: '#f5c84c', cat: '礼堂', x: 500, y: 380 },
  { campus: 'minglun', name: '文学院', emoji: '📖', color: '#4a90d9', cat: '院系', x: 170, y: 420 },
  { campus: 'minglun', name: '历史文化学院', emoji: '🏛️', color: '#4a90d9', cat: '院系', x: 320, y: 420 },
  { campus: 'minglun', name: '法学院', emoji: '⚖️', color: '#4a90d9', cat: '院系', x: 470, y: 420 },
  { campus: 'minglun', name: '外语学院', emoji: '🗣️', color: '#4a90d9', cat: '院系', x: 620, y: 420 },
  { campus: 'minglun', name: '艺术学院', emoji: '🎨', color: '#4a90d9', cat: '院系', x: 770, y: 420 },
  { campus: 'minglun', name: '新闻传播学院', emoji: '📰', color: '#4a90d9', cat: '院系', x: 890, y: 430 },
  { campus: 'minglun', name: '博文楼', emoji: '🏫', color: '#4a90d9', cat: '院系', x: 500, y: 500 },
  { campus: 'minglun', name: '商学楼', emoji: '🏫', color: '#4a90d9', cat: '院系', x: 170, y: 560 },
  { campus: 'minglun', name: '综合教学楼', emoji: '🏫', color: '#4a90d9', cat: '院系', x: 320, y: 560 },
  { campus: 'minglun', name: '九号楼', emoji: '🏢', color: '#4a90d9', cat: '院系', x: 470, y: 560 },
  { campus: 'minglun', name: '文学馆', emoji: '📚', color: '#4a90d9', cat: '院系', x: 620, y: 560 },
  { campus: 'minglun', name: '国际汉学院', emoji: '🌏', color: '#4a90d9', cat: '院系', x: 770, y: 560 },
  { campus: 'minglun', name: '马克思主义学院', emoji: '📕', color: '#4a90d9', cat: '院系', x: 890, y: 560 },
  { campus: 'minglun', name: '综合办公楼北楼', emoji: '🏢', color: '#6c7bd9', cat: '院系', x: 170, y: 700 },
  { campus: 'minglun', name: '综合办公楼南楼', emoji: '🏢', color: '#6c7bd9', cat: '院系', x: 320, y: 700 },
  { campus: 'minglun', name: '科技馆', emoji: '🔬', color: '#6c7bd9', cat: '院系', x: 470, y: 700 },
  { campus: 'minglun', name: '远程与继续教育学院', emoji: '💻', color: '#6c7bd9', cat: '院系', x: 620, y: 700 },
  { campus: 'minglun', name: '活动中心', emoji: '🎪', color: '#6c7bd9', cat: '院系', x: 770, y: 700 },

  // 学生公寓与生活服务
  { campus: 'minglun', name: '顺河公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 45, y: 800 },
  { campus: 'minglun', name: '学一公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 160, y: 900 },
  { campus: 'minglun', name: '学二公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 300, y: 900 },
  { campus: 'minglun', name: '学三公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 440, y: 900 },
  { campus: 'minglun', name: '学四公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 580, y: 900 },
  { campus: 'minglun', name: '学四公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 720, y: 900 },
  { campus: 'minglun', name: '学七公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 160, y: 1040 },
  { campus: 'minglun', name: '学九公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 300, y: 1040 },
  { campus: 'minglun', name: '学十公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 440, y: 1040 },
  { campus: 'minglun', name: '学十公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 580, y: 1040 },
  { campus: 'minglun', name: '学十二公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 720, y: 1040 },
  { campus: 'minglun', name: '学十三公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 160, y: 1180 },
  { campus: 'minglun', name: '静心公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 300, y: 1180 },
  { campus: 'minglun', name: '禾禧公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 440, y: 1180 },
  { campus: 'minglun', name: '研究生公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 580, y: 1180 },
  { campus: 'minglun', name: '青年教师公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 720, y: 1180 },
  { campus: 'minglun', name: '中心食堂', emoji: '🍜', color: '#f27b7b', cat: '食堂', x: 360, y: 1320 },
  { campus: 'minglun', name: '商业食堂', emoji: '🍜', color: '#f27b7b', cat: '食堂', x: 500, y: 1320 },
  { campus: 'minglun', name: '教职工活动中心', emoji: '🎪', color: '#43b3b0', cat: '生活服务', x: 640, y: 1320 },
  { campus: 'minglun', name: '快递收发', emoji: '📦', color: '#43b3b0', cat: '生活服务', x: 780, y: 1320 },
  { campus: 'minglun', name: '教育购物中心', emoji: '🛒', color: '#43b3b0', cat: '生活服务', x: 360, y: 1460 },
  { campus: 'minglun', name: '大超市', emoji: '🛒', color: '#43b3b0', cat: '生活服务', x: 500, y: 1460 },
  { campus: 'minglun', name: '校园网服务中心', emoji: '💻', color: '#43b3b0', cat: '生活服务', x: 640, y: 1460 },
  { campus: 'minglun', name: '校医院', emoji: '🏥', color: '#43b3b0', cat: '生活服务', x: 780, y: 1460 },
  { campus: 'minglun', name: '浴池', emoji: '🛁', color: '#43b3b0', cat: '生活服务', x: 360, y: 1600 },
  { campus: 'minglun', name: '建设银行', emoji: '🏦', color: '#43b3b0', cat: '生活服务', x: 500, y: 1600 },
  { campus: 'minglun', name: 'ATM', emoji: '🏧', color: '#43b3b0', cat: '生活服务', x: 640, y: 1600 },

  // 地标与大门
  { campus: 'minglun', name: '明园', emoji: '🌳', color: '#5bc49a', cat: '地标', x: 790, y: 170 },
  { campus: 'minglun', name: '东苑', emoji: '🌳', color: '#5bc49a', cat: '地标', x: 900, y: 590 },
  { campus: 'minglun', name: '西大门', emoji: '🚪', color: '#5bc49a', cat: '地标', x: 60, y: 900 },
  { campus: 'minglun', name: '西门外小吃街', emoji: '🍢', color: '#5bc49a', cat: '地标', x: 35, y: 1050 },
  { campus: 'minglun', name: '东大门', emoji: '🚪', color: '#5bc49a', cat: '地标', x: 945, y: 700 },
  { campus: 'minglun', name: '图书馆', emoji: '📚', color: '#4a90d9', cat: '地标', x: 500, y: 760 },
  { campus: 'minglun', name: '锅炉房', emoji: '🏭', color: '#8a7f72', cat: '地标', x: 890, y: 1300 },
  { campus: 'minglun', name: '广场', emoji: '⛲', color: '#f5c84c', cat: '地标', x: 500, y: 1560 },
  { campus: 'minglun', name: '河南大学（大门牌坊）', emoji: '🏛️', color: '#5bc49a', cat: '地标', x: 500, y: 1750 },
  { campus: 'minglun', name: '南大门', emoji: '🚪', color: '#5bc49a', cat: '地标', x: 500, y: 1840 },

  // ============ 金明校区 ============
  // 运动与休闲设施
  { campus: 'jinming', name: '志义体育场', emoji: '⚽', color: '#8fd3a8', cat: '运动设施', x: 820, y: 1100 },
  { campus: 'jinming', name: '运动场', emoji: '⚽', color: '#8fd3a8', cat: '运动设施', x: 860, y: 1250 },
  { campus: 'jinming', name: '轮滑场', emoji: '⛸️', color: '#8fd3a8', cat: '运动设施', x: 820, y: 1380 },

  // 教学、办公与科研楼
  { campus: 'jinming', name: '药学院', emoji: '💊', color: '#4a90d9', cat: '院系', x: 160, y: 300 },
  { campus: 'jinming', name: '护理学院', emoji: '🩺', color: '#4a90d9', cat: '院系', x: 320, y: 300 },
  { campus: 'jinming', name: '化学实验中心', emoji: '🧪', color: '#4a90d9', cat: '院系', x: 480, y: 300 },
  { campus: 'jinming', name: '生命科学学院', emoji: '🧬', color: '#4a90d9', cat: '院系', x: 640, y: 300 },
  { campus: 'jinming', name: '化学化工学院', emoji: '🧪', color: '#4a90d9', cat: '院系', x: 800, y: 300 },
  { campus: 'jinming', name: '计算机与信息工程学院', emoji: '💻', color: '#4a90d9', cat: '院系', x: 160, y: 440 },
  { campus: 'jinming', name: '软件学院', emoji: '💻', color: '#4a90d9', cat: '院系', x: 320, y: 440 },
  { campus: 'jinming', name: '经济学院', emoji: '📈', color: '#4a90d9', cat: '院系', x: 480, y: 440 },
  { campus: 'jinming', name: '教育学院', emoji: '📖', color: '#4a90d9', cat: '院系', x: 640, y: 440 },
  { campus: 'jinming', name: '物理与电子学院', emoji: '⚛️', color: '#4a90d9', cat: '院系', x: 800, y: 440 },
  { campus: 'jinming', name: '土木建筑学院', emoji: '🏗️', color: '#4a90d9', cat: '院系', x: 160, y: 580 },
  { campus: 'jinming', name: '结构实验室', emoji: '🧱', color: '#4a90d9', cat: '院系', x: 320, y: 580 },
  { campus: 'jinming', name: '环境与规划学院', emoji: '🌱', color: '#4a90d9', cat: '院系', x: 480, y: 580 },
  { campus: 'jinming', name: '创业中心', emoji: '🚀', color: '#4a90d9', cat: '院系', x: 640, y: 580 },
  { campus: 'jinming', name: '曾宪梓楼', emoji: '🏢', color: '#4a90d9', cat: '院系', x: 800, y: 580 },
  { campus: 'jinming', name: '哲学与公共管理学院', emoji: '📕', color: '#4a90d9', cat: '院系', x: 160, y: 720 },
  { campus: 'jinming', name: '办公楼', emoji: '🏢', color: '#6c7bd9', cat: '院系', x: 320, y: 720 },
  { campus: 'jinming', name: '1、2号教学楼', emoji: '🏫', color: '#6c7bd9', cat: '院系', x: 480, y: 720 },
  { campus: 'jinming', name: '5号、6号教学楼', emoji: '🏫', color: '#6c7bd9', cat: '院系', x: 640, y: 720 },

  // 学生公寓与生活服务
  { campus: 'jinming', name: '北苑学生公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 160, y: 900 },
  { campus: 'jinming', name: '学十八公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 320, y: 900 },
  { campus: 'jinming', name: '学十七公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 480, y: 900 },
  { campus: 'jinming', name: '学十六公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 640, y: 900 },
  { campus: 'jinming', name: '学十五公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 800, y: 900 },
  { campus: 'jinming', name: '学九公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 160, y: 1040 },
  { campus: 'jinming', name: '学十公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 320, y: 1040 },
  { campus: 'jinming', name: '学十一公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 480, y: 1040 },
  { campus: 'jinming', name: '学十二公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 640, y: 1040 },
  { campus: 'jinming', name: '学十二公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 800, y: 1040 },
  { campus: 'jinming', name: '学八公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 160, y: 1180 },
  { campus: 'jinming', name: '学七公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 320, y: 1180 },
  { campus: 'jinming', name: '学六公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 480, y: 1180 },
  { campus: 'jinming', name: '学五公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 640, y: 1180 },
  { campus: 'jinming', name: '学四公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 800, y: 1180 },
  { campus: 'jinming', name: '学三公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 160, y: 1320 },
  { campus: 'jinming', name: '学二公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 320, y: 1320 },
  { campus: 'jinming', name: '学一公寓', emoji: '🏠', color: '#9b8ad1', cat: '学生公寓', x: 480, y: 1320 },
  { campus: 'jinming', name: '北苑餐厅', emoji: '🍜', color: '#f27b7b', cat: '食堂', x: 700, y: 1320 },
  { campus: 'jinming', name: '南苑餐厅', emoji: '🍜', color: '#f27b7b', cat: '食堂', x: 820, y: 1320 },
  { campus: 'jinming', name: '金明酒店', emoji: '🏨', color: '#43b3b0', cat: '生活服务', x: 160, y: 1460 },
  { campus: 'jinming', name: '校园网服务中心', emoji: '💻', color: '#43b3b0', cat: '生活服务', x: 320, y: 1460 },
  { campus: 'jinming', name: '办事大厅', emoji: '🏢', color: '#43b3b0', cat: '生活服务', x: 480, y: 1460 },
  { campus: 'jinming', name: '商业街', emoji: '🛍️', color: '#43b3b0', cat: '生活服务', x: 640, y: 1460 },
  { campus: 'jinming', name: '水果饮料', emoji: '🧃', color: '#43b3b0', cat: '生活服务', x: 800, y: 1460 },
  { campus: 'jinming', name: '大超市', emoji: '🛒', color: '#43b3b0', cat: '生活服务', x: 160, y: 1600 },
  { campus: 'jinming', name: '菜鸟驿站', emoji: '📦', color: '#43b3b0', cat: '生活服务', x: 320, y: 1600 },
  { campus: 'jinming', name: '营业厅', emoji: '🏪', color: '#43b3b0', cat: '生活服务', x: 480, y: 1600 },
  { campus: 'jinming', name: 'ATM', emoji: '🏧', color: '#43b3b0', cat: '生活服务', x: 640, y: 1600 },
  { campus: 'jinming', name: '校医院', emoji: '🏥', color: '#43b3b0', cat: '生活服务', x: 800, y: 1600 },
  { campus: 'jinming', name: '浴池', emoji: '🛁', color: '#43b3b0', cat: '生活服务', x: 160, y: 1740 },
  { campus: 'jinming', name: '干部培训中心', emoji: '🏫', color: '#43b3b0', cat: '生活服务', x: 320, y: 1740 },

  // 地标与大门
  { campus: 'jinming', name: '北大门', emoji: '🚪', color: '#5bc49a', cat: '地标', x: 500, y: 60 },
  { campus: 'jinming', name: '实验室/样地', emoji: '🧪', color: '#5bc49a', cat: '地标', x: 130, y: 120 },
  { campus: 'jinming', name: '西大门', emoji: '🚪', color: '#5bc49a', cat: '地标', x: 60, y: 1000 },
  { campus: 'jinming', name: '图书馆', emoji: '📚', color: '#4a90d9', cat: '地标', x: 500, y: 760 },
  { campus: 'jinming', name: '东大门', emoji: '🚪', color: '#5bc49a', cat: '地标', x: 940, y: 800 },
  { campus: 'jinming', name: '明德广场', emoji: '⛲', color: '#f5c84c', cat: '地标', x: 500, y: 1650 },
  { campus: 'jinming', name: '河南大学（大门牌坊）', emoji: '🏛️', color: '#5bc49a', cat: '地标', x: 500, y: 1840 },
];

// 成就定义（threshold 为 0 的「地图全开」在查询时按频道总数动态计算）
const ACHIEVEMENTS = [
  { code: 'hero-arrives', name: '主角登场', description: '首次创建账号，踏入校园', icon: '🚪', metric: 'user_created', threshold: 1 },
  { code: 'first-message', name: '轻轻推开一扇门', description: '在任意频道发出第一条消息', icon: '💬', metric: 'messages_sent', threshold: 1 },
  { code: 'chatty', name: '满级话痨', description: '累计发出 50 条消息', icon: '📢', metric: 'messages_sent', threshold: 50 },
  { code: 'first-post', name: '开团第一人', description: '发布第一篇活动帖', icon: '📝', metric: 'posts_created', threshold: 1 },
  { code: 'guild-master', name: '公会会长', description: '累计发布 5 篇活动帖', icon: '📌', metric: 'posts_created', threshold: 5 },
  { code: 'first-todo', name: '欢迎来到新手村', description: '完成第一个待办任务', icon: '✅', metric: 'todos_completed', threshold: 1 },
  { code: 'goal-hunter', name: '目标猎人', description: '累计完成 10 个待办任务', icon: '🏅', metric: 'todos_completed', threshold: 10 },
  { code: 'exp-100', name: '初露锋芒', description: '累计经验达到 100', icon: '⭐', metric: 'exp_total', threshold: 100 },
  { code: 'exp-500', name: '满级大佬', description: '累计经验达到 500', icon: '🏆', metric: 'exp_total', threshold: 500 },
  { code: 'explorer', name: '地图全开', description: '在两校区所有区域频道都发过言', icon: '🗺️', metric: 'areas_visited', threshold: 0 },
  { code: 'collector-5', name: '收藏家', description: '背包累计持有 5 件物品', icon: '🎒', metric: 'inventory_items', threshold: 5 },
  { code: 'story-first', name: '人生如戏', description: '完成第一个剧情', icon: '📖', metric: 'stories_completed', threshold: 1 },
  { code: 'story-5', name: '剧情收藏家', description: '累计完成 5 个剧情', icon: '📚', metric: 'stories_completed', threshold: 5 },
  { code: 'story-checkin-10', name: '打卡达人', description: '累计剧情打卡 10 次', icon: '📍', metric: 'story_checkins', threshold: 10 },
];

export function seedIfEmpty() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM campuses').get();
  if (c > 0) return false;

  const campusName = {};
  const insertCampus = db.prepare('INSERT INTO campuses (name, slug) VALUES (?, ?)');
  const insertArea = db.prepare(
    'INSERT INTO areas (campus_id, name, slug, description, x, y, color, emoji, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertChannel = db.prepare('INSERT INTO channels (area_id, name) VALUES (?, ?)');
  const insertUser = db.prepare('INSERT INTO users (nickname, college, avatar, exp, created_at) VALUES (?, ?, ?, ?, ?)');
  const insertMessage = db.prepare('INSERT INTO messages (channel_id, user_id, conversation_type, conversation_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const insertPost = db.prepare('INSERT INTO posts (channel_id, user_id, title, content, category, created_at) VALUES (?, ?, ?, ?, ?, ?)');

  let demoUserId = null;

  db.transaction(() => {
    const campusIdBySlug = {};
    for (const c of CAMPUSES) {
      const info = insertCampus.run(c.name, c.slug);
      campusIdBySlug[c.slug] = Number(info.lastInsertRowid);
      campusName[c.slug] = c.name;
    }

    const areaIdByKey = {};
    const channelIdByKey = {};
    AREAS.forEach((a, i) => {
      const slug = `${a.campus}-${i + 1}`;
      const description = `${campusName[a.campus]} · ${a.cat}`;
      const areaInfo = insertArea.run(
        campusIdBySlug[a.campus], a.name, slug, description, a.x, a.y, a.color, a.emoji, 0
      );
      const areaId = Number(areaInfo.lastInsertRowid);
      const key = `${a.campus}:${a.name}`;
      areaIdByKey[key] = areaId;
      const channelInfo = insertChannel.run(areaId, `${a.name}频道`);
      channelIdByKey[key] = Number(channelInfo.lastInsertRowid);
    });

    // 世界频道：隐藏区域（不显示在地图/任务下拉里），承载全局聊天
    const worldAreaInfo = insertArea.run(
      campusIdBySlug['minglun'], '世界广场', 'world', '全局世界频道', 0, 0, '#38bdf8', '🌐', 1
    );
    insertChannel.run(Number(worldAreaInfo.lastInsertRowid), '世界频道');

    // 演示用户
    const demoInfo = insertUser.run('小荷', '计算机与信息工程学院', '🐸', 30, nowIso());
    demoUserId = Number(demoInfo.lastInsertRowid);

    // 示例消息（chat 会话，conversation_id = 频道 id）
    insertMessage.run(channelIdByKey['minglun:图书馆'], demoUserId, 'chat', channelIdByKey['minglun:图书馆'], '明伦图书馆今天安静又舒服 📚', nowIso());
    insertMessage.run(channelIdByKey['minglun:图书馆'], demoUserId, 'chat', channelIdByKey['minglun:图书馆'], '靠窗的位置阳光正好～', nowIso());
    insertMessage.run(channelIdByKey['minglun:中心食堂'], demoUserId, 'chat', channelIdByKey['minglun:中心食堂'], '老校区食堂的烩面 yyds！', nowIso());
    insertMessage.run(channelIdByKey['jinming:图书馆'], demoUserId, 'chat', channelIdByKey['jinming:图书馆'], '金明图书馆预约到座位啦，冲！', nowIso());
    insertMessage.run(channelIdByKey['jinming:图书馆'], demoUserId, 'chat', channelIdByKey['jinming:图书馆'], '有没有一起考研复习的搭子？', nowIso());

    // 示例活动帖
    insertPost.run(channelIdByKey['minglun:图书馆'], demoUserId, '【自习搭子】明伦图书馆一起自习', '每天 19:00-22:00，四楼靠窗区，想来的留言～', '自习', nowIso());
    insertPost.run(channelIdByKey['minglun:东操场'], demoUserId, '【约跑】今晚东操场 5 公里', '19:30 操场南门集合，配速 6 分，新手友好！', '运动', nowIso());
    insertPost.run(channelIdByKey['jinming:图书馆'], demoUserId, '【资料分享】高数期末复习笔记', '整理了一份高数知识点汇总，需要的同学评论区扣 1', '学习', nowIso());
  })();

  // 演示用户的新手礼包（在 seed 事务外发放，避免嵌套事务）
  if (demoUserId) grantStarterPack(demoUserId);

  return true;
}

// 幂等：为已存在的库补齐「世界频道」（隐藏区域 + 频道），返回频道 id
export function ensureWorldChannel() {
  const world = db.prepare("SELECT id FROM areas WHERE slug = 'world'").get();
  if (world) {
    const ch = db.prepare('SELECT id FROM channels WHERE area_id = ? ORDER BY id ASC LIMIT 1').get(world.id);
    if (ch) return Number(ch.id);
    const info = db.prepare('INSERT INTO channels (area_id, name) VALUES (?, ?)').run(world.id, '世界频道');
    return Number(info.lastInsertRowid);
  }

  const campus = db.prepare("SELECT id FROM campuses WHERE slug = 'minglun'").get();
  const campusId = campus?.id ?? db.prepare('SELECT id FROM campuses ORDER BY id ASC LIMIT 1').get()?.id;
  if (!campusId) return null;

  const areaInfo = db
    .prepare(
      `INSERT INTO areas (campus_id, name, slug, description, x, y, color, emoji, hidden)
       VALUES (?, ?, 'world', ?, 0, 0, '#38bdf8', '🌐', 1)`
    )
    .run(campusId, '世界广场', '全局世界频道');
  const chInfo = db.prepare('INSERT INTO channels (area_id, name) VALUES (?, ?)').run(Number(areaInfo.lastInsertRowid), '世界频道');
  return Number(chInfo.lastInsertRowid);
}

// 幂等：确保管理员账号存在（昵称可用环境变量 ADMIN_NICKNAME 覆盖，默认 FOolish）
export function ensureAdmin() {
  const nick = process.env.ADMIN_NICKNAME || 'FOolish';
  const fullPerms = JSON.stringify(['COIN_ADD', 'COIN_MINUS', 'USER_MANAGE', 'ADMIN_GRANT', 'ACHIEVEMENT_MANAGE']);
  const existing = db.prepare('SELECT id FROM users WHERE nickname = ? COLLATE NOCASE').get(nick);
  if (!existing) {
    const info = db
      .prepare("INSERT INTO users (nickname, college, avatar, exp, role, permissions, created_at) VALUES (?, '', '🎓', 0, 'admin', ?, ?)")
      .run(nick, fullPerms, nowIso());
    return Number(info.lastInsertRowid);
  }
  db.prepare("UPDATE users SET role = 'admin', permissions = ? WHERE id = ?").run(fullPerms, existing.id);
  return existing.id;
}

// 触发式成就（kind='trigger'，由 server/achievements.js 的 triggerAchievement 幂等解锁）
const TRIGGER_ACHIEVEMENTS = [
  { code: 'EXP_001', name: '初次校准', hint: '接入明伦校区星图', description: '首次登录并加载地图', icon: '🛰️', type: 'exploration' },
  { code: 'EXP_002', name: '微观视界', hint: '拉近你的镜头，看清世界的纹理', description: '地图缩放达到最大倍率', icon: '🔬', type: 'exploration' },
  { code: 'EXP_003', name: '幽灵坐标', hint: '有些节点隐藏着秘密，多试探几次', description: '连续点击特定节点5次', icon: '👻', type: 'exploration' },
  { code: 'EXP_004', name: '迷途羔羊', hint: '你的鼠标似乎在寻找什么', description: '拖拽地图累计位移超50000px', icon: '🌀', type: 'exploration' },
  { code: 'EXP_005', name: '赏金猎人', hint: '完成他人的委托', description: '首次成功完成公开任务', icon: '💰', type: 'task' },
  { code: 'EXP_006', name: '商业巨头', hint: '用重金悬赏你的需求', description: '发布任务冻结经验累计超1000', icon: '📈', type: 'task' },
  { code: 'EXP_007', name: '备忘录成精', hint: '大脑装不下了，就用终端记录', description: '创建20个私密备忘', icon: '📝', type: 'task' },
  { code: 'EXP_008', name: '赛博乞丐', hint: '空空如也的钱包也想发悬赏', description: '余额为0时尝试发布公开任务', icon: '🪙', type: 'task' },
  { code: 'EXP_009', name: '连续被拒', hint: '你的交付物似乎不合老板胃口', description: '同一任务被连续驳回3次', icon: '🚫', type: 'task' },
  { code: 'EXP_010', name: '全频段阻塞', hint: '让全校听到你的声音', description: '在世界频道发送首条消息', icon: '📡', type: 'social' },
  { code: 'EXP_011', name: '话痨终端', hint: '手速快到突破系统限制', description: '1分钟内发送10条消息', icon: '💬', type: 'social' },
  { code: 'EXP_012', name: '社交悍匪', hint: '让你的名字频繁出现在别人屏幕上', description: '累计发送@提及50次', icon: '🔗', type: 'social' },
  { code: 'EXP_013', name: '表情包大户', hint: '图库比图书馆还丰富', description: '上传表情包达上限并发送', icon: '🎭', type: 'social' },
  { code: 'EXP_014', name: '夜行者', hint: '在深夜保持连线', description: '凌晨2点-4点在世界频道发言', icon: '🌙', type: 'social' },
  { code: 'EXP_015', name: '摸鱼先锋', hint: '什么都不做，也是一种修行', description: '在地图界面无操作挂机60分钟', icon: '🦥', type: 'secret' },
];

// 幂等：确保成就定义存在（进度型 + 触发型）。只补缺失，绝不覆盖——管理员后台的编辑以数据库为准。
export function ensureAchievements() {
  const insertProgress = db.prepare(
    `INSERT INTO achievements (code, name, description, icon, metric, threshold, kind)
     VALUES (?, ?, ?, ?, ?, ?, 'progress')
     ON CONFLICT(code) DO NOTHING`
  );
  for (const a of ACHIEVEMENTS) {
    insertProgress.run(a.code, a.name, a.description, a.icon, a.metric, a.threshold);
  }

  const insertTrigger = db.prepare(
    `INSERT INTO achievements (code, name, description, hint, icon, metric, threshold, type, kind)
     VALUES (?, ?, ?, ?, ?, 'trigger', 1, ?, 'trigger')
     ON CONFLICT(code) DO NOTHING`
  );
  for (const a of TRIGGER_ACHIEVEMENTS) {
    insertTrigger.run(a.code, a.name, a.description, a.hint, a.icon, a.type);
  }
}

// 演示剧情（确保存在；策划正式内容走 POST /api/stories/import）
const DEMO_STORIES = [
  {
    code: 'freshman-week',
    title: '新生周打卡',
    subtitle: '用七天认识你的校园',
    cover: '🎒',
    category: '日常',
    obtainMode: 'claim',
    availability: 'permanent',
    rewards: {
      exp: 50,
      coin: 100,
      items: [{ name: '开学纪念徽章', icon: '🎖️', rarity: 'rare', description: '完成新生周打卡的证明。' }],
    },
    nodes: [
      { seq: 1, title: '逛一圈校园', description: '线下走一遍你的校区', checkinType: 'photo', tips: '拍一张校园地标照片' },
      { seq: 2, title: '吃一次食堂', description: '去食堂吃一顿饭', checkinType: 'none' },
      { seq: 3, title: '去一次图书馆', description: '在图书馆坐一会儿', checkinType: 'text', tips: '写一句你的感受' },
    ],
  },
  {
    code: 'library-seven-days',
    title: '图书馆七日谈',
    subtitle: '连续打卡，把习惯种进书页',
    cover: '📚',
    category: '成长',
    obtainMode: 'claim',
    availability: 'permanent',
    rewards: { exp: 30, coin: 50 },
    nodes: [
      { seq: 1, title: '第一天', description: '在图书馆待 30 分钟', checkinType: 'none' },
      { seq: 2, title: '第二天', description: '在图书馆待 30 分钟', checkinType: 'none' },
      { seq: 3, title: '第三天', description: '在图书馆待 30 分钟', checkinType: 'none' },
    ],
  },
  {
    code: 'school-festival',
    title: '校庆限定·回望来路',
    subtitle: '校庆周限定剧情，过期不候',
    cover: '🎉',
    category: '节日',
    obtainMode: 'claim',
    availability: 'festival',
    festivalCode: 'anniversary',
    timeboxed: true,
    rewards: {
      exp: 80,
      coin: 150,
      items: [{ name: '校庆限定徽章', icon: '🏵️', rarity: 'epic', description: '校庆周限定，见证这一刻。' }],
    },
    nodes: [
      { seq: 1, title: '打卡校门牌坊', description: '到大门牌坊拍张照', checkinType: 'photo' },
      { seq: 2, title: '给母校写一句祝福', description: '写一句祝福语', checkinType: 'text' },
    ],
  },
];

// 幂等：确保演示剧情存在（按 code 判重，绝不覆盖已导入内容）
export function ensureStories() {
  const now = nowIso();
  const winStart = now;
  const winEnd = new Date(Date.now() + 180 * 86400000).toISOString();

  const insStory = db.prepare(
    `INSERT INTO stories (code, title, subtitle, cover, category, obtain_mode, availability,
       window_start_at, window_end_at, festival_code, sequential, timeboxed, rewards_json, sort_order, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'published', ?, ?)`
  );
  const insNode = db.prepare('INSERT INTO story_nodes (story_id, seq, title, description, checkin_type, tips, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');

  for (const s of DEMO_STORIES) {
    if (db.prepare('SELECT id FROM stories WHERE code = ?').get(s.code)) continue;
    const info = insStory.run(
      s.code, s.title, s.subtitle, s.cover, s.category, s.obtainMode, s.availability,
      s.availability === 'festival' ? winStart : null,
      s.availability === 'festival' ? winEnd : null,
      s.festivalCode || null,
      s.sequential === false ? 0 : 1,
      s.timeboxed ? 1 : 0,
      JSON.stringify(s.rewards || { exp: 0, coin: 0, items: [] }),
      now, now
    );
    const storyId = Number(info.lastInsertRowid);
    for (const n of s.nodes) {
      insNode.run(storyId, n.seq, n.title, n.description, n.checkinType || 'none', n.tips || '', now);
    }
  }
}
