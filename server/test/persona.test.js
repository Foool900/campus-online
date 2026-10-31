import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, MOODS, dailyMood, personaStyle, personaIntro } from '../persona.js';

test('personaStyle 返回对应人格描述，未知回退软萌', () => {
  assert.ok(personaStyle('aojiao').includes('傲娇'));
  assert.ok(personaStyle('xueba').includes('学霸'));
  assert.equal(personaStyle('unknown'), PERSONAS.ruanmeng.style);
});

test('dailyMood 一天内稳定且合法', () => {
  assert.ok(MOODS.includes(dailyMood()));
  assert.equal(dailyMood(), dailyMood());
});

test('personaIntro 预设人设含说话语气与关系', () => {
  const intro = personaIntro({ type: 'preset', key: 'aojiao' }, '陌生');
  assert.match(intro, /傲娇/);
  assert.match(intro, /说话语气参考/);
  assert.match(intro, /陌生/);
  assert.match(intro, /哼/); // 傲娇口头禅示例
});

test('personaIntro 默认是百科助手（中立）', () => {
  const intro = personaIntro({ type: 'default' });
  assert.match(intro, /中立/);
  assert.doesNotMatch(intro, /同班同学/);
});
