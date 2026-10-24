// 敏感词过滤（v1）：线性遍历 String.includes。
// 性能前提：词表 < 100 条时线性遍历可接受；超百后再换 Trie / 正则优化。
// 词表分三类：脏话 / 诈骗 / 广告引流，每元素一个字符串，方便 diff 与运营补充。

const SENSITIVE_WORDS = [
  // 脏话类
  '傻逼', '煞笔', '傻叉', '草泥马', '妈的', '操你', '狗日的', '去你妈的',
  '贱人', '废物', '智障', '脑残', '滚犊子', '日你', '你麻痹',
  'fuck', 'shit', 'bitch', 'asshole', 'nmsl',
  // 诈骗类
  '先打款', '刷单', '兼职刷单', '代充', '套现', '洗钱', '博彩', '赌博',
  '内幕消息', '稳赚不赔', '高额回报', '转账返利', '刷好评', '刷信用',
  '彩票内幕', '赚钱项目',
  // 广告引流类
  '加微信', '加我微信', '加qq', '加我qq', '私聊我', '加我私聊',
  '扫码进群', '引流', '微商', '代购', '外链', '微信号', 'qq号', '群号',
];

export function containsSensitiveWord(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();
  for (const w of SENSITIVE_WORDS) {
    if (t.includes(w.toLowerCase())) return true;
  }
  return false;
}
