import { db, nowIso } from './db.js';
import { grantStarterPack } from './inventory.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  {
    code: 'henu-one-day',
    title: '河大的一天',
    subtitle: '用选择与照片，把你自己的一天嵌进河大',
    cover: '🏫',
    category: '日常',
    obtainMode: 'claim',
    availability: 'permanent',
    sequential: true,
    rewards: {
      exp: 60,
      coin: 120,
      items: [{ name: '《我的河大一日纪念册》', icon: '📔', rarity: 'legendary', description: '把今天的票根、落叶、便签、拍立得按时间顺序贴进册页，这是属于你的河大一日。' }],
    },
    endings: [
      { mood: '宁静', code: 'qinxue', title: '勤学结局 · 灯火长明', text: '你合上书本时，图书馆还有一半灯亮着。河大的夜晚安静又热闹，而你是其中一束光。' },
      { mood: '热闹', code: 'yanhuo', title: '烟火结局 · 西门夜色', text: '烧饼夹鸡腿的热气模糊了眼镜，这条小街装着无数河大人的深夜快乐。' },
      { mood: '自在', code: 'zizai', title: '自在结局 · 湖畔晚风', text: '跑完最后一圈，风从湖面吹过来，你觉得这一天值了。' },
    ],
    nodes: [
      {
        seq: 1, title: '序章 · 07:00 宿舍醒来', checkinType: 'text',
        description: '7:00，闹钟第三次响起。你摸过手机，宿舍里还静悄悄的，有人床位已经空了——那是真·早八战士。窗外的树影晃在墙上，新的一天开始了。',
        tips: '先给今天的自己起个称呼，并告诉我：你在哪个学院？（示例：我是软件学院的小辰）',
        choices: [
          { value: '明伦', label: '明伦校区（老校区）', var: 'campus' },
          { value: '金明', label: '金明校区（新校区）', var: 'campus' },
        ],
        items: [{ name: '宿舍钥匙牌', icon: '🔑', rarity: 'common', description: '一天的起点，也是晚归时最安心的一声脆响。' }],
      },
      {
        seq: 2, title: '07:30 早餐，吃什么', checkinType: 'text', optionalProof: true,
        description: '踩着铃声往食堂走。胡辣汤的热气、灌饼的油香，都是河大早晨的背景音。',
        tips: '你今天早餐实际吃了什么？（示例：一个鸡蛋灌饼 + 一杯豆浆。）',
        campusVariants: {
          明伦: '踩着铃声往食堂走。学五食堂的胡辣汤冒着热气，中心食堂的窗口前已经排起小队——河大饭点的队伍，是学生们心照不宣的默契。',
          金明: '教苑、南苑、北苑几大餐厅一字排开，你端着餐盘在窗口间穿梭，性价比拉满的早餐任你挑。',
        },
        choices: [
          { value: '食堂胡辣汤', label: '学五/教苑食堂，来一碗热胡辣汤 + 包子', moods: { 宁静: 1 }, energy: 10 },
          { value: '边走边买', label: '边走边买，赶在铃声前冲去教学楼', moods: { 热闹: 1 }, energy: 5 },
          { value: '宿舍咖啡', label: '回宿舍泡杯咖啡，从容出门', moods: { 自在: 1 }, energy: 8 },
        ],
        items: [
          { name: '胡辣汤蒸汽书签', icon: '🍜', rarity: 'common', description: '一碗热汤把清晨叫醒。', when: { choice: '食堂胡辣汤' } },
          { name: '鸡蛋灌饼油纸', icon: '🥞', rarity: 'common', description: '赶课的人，手里都攥着一张油纸。', when: { choice: '边走边买' } },
          { name: '半杯冷掉的咖啡', icon: '☕', rarity: 'common', description: '从容需要练习，先从接受半杯凉咖啡开始。', when: { choice: '宿舍咖啡' } },
        ],
      },
      {
        seq: 3, title: '08:00 早八路上', checkinType: 'photo', optionalProof: true,
        description: '你穿过晨光，往教学楼走去，顺路瞥一眼河大最日常的一角。',
        tips: '📷 上传一张「你早八路上看到的河大一角」：教学楼、树影、食堂门口的队伍，或你走出宿舍拍的第一张照片。（可跳过）',
        campusVariants: {
          明伦: '你穿过红砖绿树，往教学楼走。路边就是六号楼（博文楼）——1919 年建成的中西合璧老建筑，1925 年李大钊曾登上三楼，在这里讲过《大英帝国主义侵略中国史》。七号楼（博雅楼）的红墙在晨光里很安静，范文澜等先生当年曾在此耕耘。',
          金明: '你沿着伯襄路走向教学楼，路旁先闻湖里的黑天鹅（河大「校宠」）正慢悠悠划水，远处 4.7 万平方米的图书大楼是整个校区的标志性建筑。',
        },
        choices: [
          { value: '前排坐下', label: '赶紧找前排位置坐下', moods: { 宁静: 1 } },
          { value: '边走边聊', label: '和顺路的同学边走边聊', moods: { 热闹: 1 } },
        ],
        items: [
          { name: '六号楼红墙下的一片落叶', icon: '🍂', rarity: 'rare', description: '1919 年的墙根接住的叶子，叶脉里都是书声。', when: { campus: '明伦' } },
          { name: '先闻湖的一根黑天鹅羽毛', icon: '🪶', rarity: 'rare', description: '校宠施舍的，别指望第二根。', when: { campus: '金明' } },
          { name: '今日第一张拍立得', icon: '📸', rarity: 'common', description: '你早八路上的第一张照片，成了今天的物品。', slot: 'extra', when: { proofPhoto: true } },
        ],
      },
      {
        seq: 4, title: '10:00 课堂时刻', checkinType: 'text', optionalProof: true,
        description: '课间十分钟。如果在明伦，你正坐在六号楼或七号楼这样的老建筑里上课，桌椅间仿佛还留着近百年的书声；如果在金明，现代的组团式教学楼掩映在大片绿化带里。老师刚讲完一个章节，黑板上还留着推导。',
        tips: '这节课你最想向老师提的一个问题是什么？（示例：这个算法在机器人上怎么落地？）',
        popup: { title: '冷知识 · 明伦大礼堂', body: '明伦大礼堂 1934 年落成，建的时候全校师生只有五百余人，礼堂却能容纳三千人，钢梁屋架全部从德国进口；1937 年人民音乐家冼星海曾在这里活动。它是河大当之无愧的地标。' },
        items: [
          { name: '一页课堂笔记', icon: '📄', rarity: 'common', description: '黑板会擦，纸页替你记住。' },
          { name: '提问便签', icon: '📝', rarity: 'rare', description: '你的问题折成方块，收进包里。', slot: 'extra', when: { proofText: true } },
          { name: '1912 年的明信片', icon: '💌', rarity: 'legendary', description: '河大前身是 1912 年的河南留学欧美预备学校，这张明信片替你寄给百年前的校门。', slot: 'extra', when: { readPopup: true } },
        ],
      },
      {
        seq: 5, title: '12:00 午餐时分 · 地标打卡', checkinType: 'photo', optionalProof: true,
        description: '吃完饭，你往校园的地标处溜达过去，那里是河大最出片的地方。',
        tips: '📷 上传一张「你心中河大的标志性建筑/地点」：明伦可选大礼堂、六号楼、博雅楼、十二斋；金明可选图书大楼、先闻湖黑天鹅、志义体育场。（可跳过）',
        campusVariants: {
          明伦: '吃完饭，你溜达到中轴线的大礼堂广场。宫殿式的红墙灰瓦恢弘凝重，1934 年建成时曾入选「亚洲十大建筑」。午后阳光落在台阶上，有人在这里背书，有人在这里拍照。',
          金明: '你来到图书大楼前的广场，一池碧水、天鹅游弋，海棠与绿意围着凉亭，是金明最出片的地方。',
        },
        choices: [
          { value: '回寝午睡', label: '回宿舍午睡半小时', moods: { 宁静: 1 }, energy: 20 },
          { value: '随便走走', label: '不回寝，在校园里随便走走', moods: { 自在: 1 } },
        ],
        items: [
          { name: '大礼堂台阶的光斑', icon: '🌞', rarity: 'rare', description: '1934 年的台阶上，今天的阳光也有座。', when: { campus: '明伦' } },
          { name: '图书大楼预约成功二维码', icon: '🎫', rarity: 'rare', description: '4.7 万㎡里，属于你的那个坐标。', when: { campus: '金明' } },
          { name: '地标拍立得', icon: '📷', rarity: 'epic', description: '你选的河大标志，定格成一张相纸。', slot: 'extra', when: { proofPhoto: true } },
        ],
      },
      {
        seq: 6, title: '14:00 下午的选择', checkinType: 'text', optionalProof: true,
        description: '下午的时间攥在你自己手里。河大从不缺安静专注的角落：图书馆可以线上预约座位，不用再靠书占座；空置教室全天开放，适合小组讨论；社团招新的摊位也许正摆在路边。',
        tips: '你下午计划完成的一件小事是什么？（示例：把高数错题整理完。）',
        choices: [
          { value: '图书馆自习', label: '图书馆/自习室线：线上约座，刷题、查文献', moods: { 宁静: 2 } },
          { value: '社团招新', label: '社团/社交线：去招新摊位转一圈，报一个感兴趣的社团', moods: { 热闹: 2 } },
          { value: '实验室项目', label: '实验室/项目线：去实验室或科创小组，捣鼓自己的项目', moods: { 宁静: 1, 自在: 1 } },
        ],
        items: [
          { name: '图书馆预约座位号', icon: '🔢', rarity: 'common', description: '一串数字，也是今天的固定坐标。', when: { choice: '图书馆自习' } },
          { name: '社团招新报名表', icon: '📋', rarity: 'common', description: '你的名字进了一个新集体的名单。', when: { choice: '社团招新' } },
          { name: '一颗焊好的小元件', icon: '🔩', rarity: 'common', description: '有点歪，但通电了。', when: { choice: '实验室项目' } },
        ],
      },
      {
        seq: 7, title: '17:30 黄昏湖畔', checkinType: 'photo', optionalProof: true,
        description: '天色渐晚，你走到湖边，看夕阳把一天的疲惫泡软。',
        tips: '📷 上传一张「你今天拍到的黄昏/天空/湖面」。（可跳过）',
        campusVariants: {
          明伦: '你走到铁塔湖边。十三层的褐色琉璃砖塔（铁塔）八棱挺拔，每层翘角挂着铜铃，风一过叮当作响。夕阳把铁塔的影子拉在湖面上，波光像撒了金——这是河大人公认的网红打卡时刻。',
          金明: '你来到先闻湖或访秋湖边，柳色低垂，黑天鹅掠过水面，伯襄路上落叶斑驳，晚霞把楼宇染成暖红。',
        },
        choices: [
          { value: '再坐一会儿', label: '安静地再坐一会儿', moods: { 宁静: 1 } },
          { value: '顺路逛逛', label: '顺路去逛一逛', moods: { 热闹: 1 } },
        ],
        items: [
          { name: '铁塔铜铃的一记余响', icon: '🔔', rarity: 'rare', description: '十三层琉璃砖塔的铜铃替你响了一声。', when: { campus: '明伦' } },
          { name: '先闻湖晚霞色块', icon: '🌇', rarity: 'rare', description: '用眼睛调出来的一块暖橙。', when: { campus: '金明' } },
          { name: '黄昏拍立得', icon: '🌅', rarity: 'epic', description: '一天里光线最温柔的九十秒。', slot: 'extra', when: { proofPhoto: true } },
        ],
      },
      {
        seq: 8, title: '19:00 河大的夜晚', checkinType: 'none',
        description: '19:00，自习室的灯亮得整整齐齐，图书馆走廊里有人戴着耳机背单词；操场上有人夜跑；而学校西门外的夜市，油锅刚热起来。',
        choices: [
          { value: '夜读自习', label: '勤学线：回到自习室/图书馆夜读', moods: { 宁静: 2 } },
          { value: '西门夜市', label: '烟火线：出西门逛夜市——烧饼夹鸡腿、牛肉火烧、炒凉粉，四方坑夜市的炒海盘冒着热气', moods: { 热闹: 2 }, energy: 15 },
          { value: '夜跑三圈', label: '自在线：去志义体育场（金明）/东操场（明伦）夜跑三圈', moods: { 自在: 2 }, energy: 10 },
        ],
        items: [
          { name: '自习室台灯下的便签', icon: '🏷️', rarity: 'common', description: '写着明日待办，也写着此刻的专注。', when: { choice: '夜读自习' } },
          { name: '烧饼夹鸡腿的油纸袋', icon: '🍗', rarity: 'common', description: '油纸渗着油光，是西门夜市给你的盖章。', when: { choice: '西门夜市' } },
          { name: '夜跑擦汗的腕带', icon: '🧵', rarity: 'common', description: '三圈下来，它记住了你的心率。', when: { choice: '夜跑三圈' } },
        ],
      },
      {
        seq: 9, title: '21:30 我的河大一日', checkinType: 'text',
        description: '回到宿舍，台灯亮起。今天你走过的路、拍下的照片、写下的句子，都在这里——系统会为你拼出《我的河大一日》纪念页。',
        tips: '今天最让你难忘的一个河大瞬间是什么？一句话就好。（示例：黄昏时铁塔湖的铜铃响了一声。）',
      },
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
       window_start_at, window_end_at, festival_code, sequential, timeboxed, rewards_json, endings_json, sort_order, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'published', ?, ?)`
  );
  const insNode = db.prepare(
    `INSERT INTO story_nodes (story_id, seq, title, description, checkin_type, tips, choices_json, campus_variants_json, items_json, popup_json, optional_proof, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

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
      s.endings && s.endings.length ? JSON.stringify(s.endings) : null,
      now, now
    );
    const storyId = Number(info.lastInsertRowid);
    for (const n of s.nodes) {
      insNode.run(
        storyId,
        n.seq,
        n.title,
        n.description || '',
        n.checkinType || 'none',
        n.tips || '',
        n.choices && n.choices.length ? JSON.stringify(n.choices) : null,
        n.campusVariants ? JSON.stringify(n.campusVariants) : null,
        n.items && n.items.length ? JSON.stringify(n.items) : null,
        n.popup ? JSON.stringify(n.popup) : null,
        n.optionalProof ? 1 : 0,
        now
      );
    }
  }
}

// 知识库静态种子：FAQ / 规则 / 社区规范（供离线知识库助手检索回答）
const KNOWLEDGE_DOCS = [
  {
    code: 'faq-port',
    category: 'FAQ',
    title: '端口被占用怎么办',
    source_ref: 'README#faq',
    content: `后端默认端口 3001，前端开发端口 5173。端口被占用时：Windows 下用 netstat -ano | findstr 3001 查看占用进程，再用 taskkill /F /PID <PID> 结束进程。也可以修改 server/index.js 里的后端端口，或 client/vite.config.js 里的前端端口，并同步更新代理 target。`,
  },
  {
    code: 'faq-sqlite',
    category: 'FAQ',
    title: 'better-sqlite3 安装失败',
    source_ref: 'README#faq',
    content: `better-sqlite3 是原生模块，一般会下载预编译二进制。若安装报编译错误：1. 确保 Node 版本 >= 22；2. 安装 Windows 构建工具（npm install -g windows-build-tools）；3. 手动指定匹配版本（cd server && npm install better-sqlite3@13）。`,
  },
  {
    code: 'faq-reset-db',
    category: 'FAQ',
    title: '如何重置数据库',
    source_ref: 'README#faq',
    content: `直接删除数据库文件即可，下次启动会自动重新建表并写入种子数据。命令：rm -f server/data/campus.db server/data/campus.db-wal server/data/campus.db-shm。`,
  },
  {
    code: 'faq-account',
    category: 'FAQ',
    title: '账号与登录（昵称即用户名）',
    source_ref: 'README#faq',
    content: `昵称即用户名，全局唯一（不区分大小写）。启动后在登录框输入昵称和密码；新昵称首次登录即注册创建账号。登录态保存在浏览器 localStorage 的 campus_token 键，30 天内有效。想换新账号：清除 localStorage 的 campus_token 并重置数据库。`,
  },
  {
    code: 'rule-task',
    category: '规则',
    title: '任务系统规则',
    source_ref: 'TASKS.md#rules',
    content: `任务分私密备忘与公开任务。私密备忘：todo 待办 → done 已完成（可撤销），奖励恒为 0。公开任务：published 发布 → accepted 接取 → submitted 提交 → approved 验收通过；驳回回到 accepted 可重新提交，累计驳回 3 次则 terminated 终止并退回金币；到期无人接或未验收则 expired 过期退回金币；发布者取消则 cancelled 取消退回金币。金币：发布公开任务时冻结金币作为赏金，验收通过后转给接取者，取消/过期/终止退回发布者。经验只发不扣，完成私密备忘与验收通过公开任务都会获得经验（行为经验，每日上限 300）。等级 = 经验/100 向下取整再加 1。`,
  },
  {
    code: 'rule-market',
    category: '规则',
    title: '校园夜市规则',
    source_ref: 'MarketHelp#rules',
    content: `报名：开市前 60～5 分钟；开市持续 4 小时。流动地摊 30 个，摆摊 30 分钟，押金 5 金币（可退），上架 3 件。固定店铺 5 家，每周竞拍，上架 20 件，租金 50% 进奖池。交易手续费为成交价 5%，进奖池。砍价需低于标价，卖家接受后 24 小时内支付。盲盒上架冻结 80% 保证金，保底 10% 标价，开盒后 24 小时举报期。全服喇叭每期每人 3 条。纠纷举报每月 3 次配额。评价：成交后 30 天内评 1-5 星，影响卖家信誉。`,
  },
  {
    code: 'norm-community',
    category: '社区规范',
    title: '社区发言与角色规范',
    source_ref: '社区规范',
    content: `请文明发言、尊重他人，不发布违法、低俗、广告或人身攻击内容。聊天内容仅做基础过滤（空消息拦截、长度限制、前端安全渲染），请自觉遵守。发现违规可在相关功能里举报（如夜市纠纷举报，每月 3 次配额）。用户角色：member 普通成员 → student 认证学员（管理员审核认证后授予）→ admin 管理员；大部分发帖、发消息需要 student 及以上角色。管理员由系统启动时根据 ADMIN_NICKNAME 环境变量（默认 FOolish）自动创建。`,
  },
];

// 幂等：确保知识库静态文档存在（按 code 判重，绝不覆盖已存在内容）
export function ensureKnowledgeDocs() {
  const ins = db.prepare(
    'INSERT INTO knowledge_docs (code, title, content, category, source_ref, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO NOTHING'
  );
  for (const d of KNOWLEDGE_DOCS) {
    ins.run(d.code, d.title, d.content, d.category, d.source_ref, nowIso());
  }
}

// 项目根目录：把仓库里的文档读进知识库（供知识库助手「Ala」回答网站相关问题）
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DOC_SOURCES = [
  { code: 'doc:readme', file: 'README.md', title: '平台功能与使用指南' },
  { code: 'doc:tasks', file: 'TASKS.md', title: '任务系统规则' },
  { code: 'doc:economy', file: 'ECONOMY.md', title: '经验与金币经济说明' },
  { code: 'doc:story', file: 'STORY.md', title: '剧情系统说明' },
  { code: 'doc:deploy', file: 'DEPLOY.md', title: '部署指南' },
  { code: 'doc:usage', file: '使用情况材料.md', title: '平台使用场景与概览' },
  { code: 'doc:henu', file: '河南大学.md', title: '河南大学校园知识' },
];

// 每次启动按文件内容 upsert（文档改了自动同步进知识库）
export function ensureDocKnowledge() {
  const upsert = db.prepare(
    `INSERT INTO knowledge_docs (code, title, content, category, source_ref, created_at)
     VALUES (?, ?, ?, '文档', ?, ?)
     ON CONFLICT(code) DO UPDATE SET title = excluded.title, content = excluded.content, source_ref = excluded.source_ref`
  );
  let count = 0;
  for (const d of DOC_SOURCES) {
    try {
      const content = fs.readFileSync(path.join(REPO_ROOT, d.file), 'utf8');
      upsert.run(d.code, d.title, content, d.file, nowIso());
      count += 1;
    } catch (e) {
      console.warn(`[seed] 读取文档 ${d.file} 失败：`, e.message);
    }
  }
  return count;
}
