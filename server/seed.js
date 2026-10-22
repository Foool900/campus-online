import { db, nowIso } from './db.js';

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
  const insertTodo = db.prepare(
    `INSERT INTO todos (user_id, title, description, due_date, status, exp_reward, area_id, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertAchievement = db.prepare(
    'INSERT INTO achievements (code, name, description, icon, metric, threshold) VALUES (?, ?, ?, ?, ?, ?)'
  );

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

    for (const a of ACHIEVEMENTS) {
      insertAchievement.run(a.code, a.name, a.description, a.icon, a.metric, a.threshold);
    }

    // 演示用户
    const demoInfo = insertUser.run('小荷', '计算机与信息工程学院', '🐸', 30, nowIso());
    const demoUserId = Number(demoInfo.lastInsertRowid);

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

    // 示例待办
    insertTodo.run(demoUserId, '去明伦图书馆借《数据库系统概论》', '期末复习要用', '2026-10-24', 'pending', 10, areaIdByKey['minglun:图书馆'], nowIso(), null);
    insertTodo.run(demoUserId, '志义体育场跑步 3 公里', '天气好就去', '2026-10-26', 'pending', 10, areaIdByKey['jinming:志义体育场'], nowIso(), null);
    insertTodo.run(demoUserId, '去创业中心参加分享会', '学习创业经验', null, 'completed', 10, areaIdByKey['jinming:创业中心'], nowIso(), nowIso());
  })();

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
