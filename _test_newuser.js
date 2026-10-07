/* 回归测试：新学生首次使用（档案对象不存在）
   真实事故：gradeExam 里直接写 a[s.id].exam=...，
   而 doLogin 从不创建档案对象 → a[s.id] 是 undefined → 抛异常
   → 成绩存不上、上报不发、结果页渲染不出来（整页功能失效）
   打卡模块有兜底，考核与练习两条路径都漏了。 */
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(String((e && e.message) || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf8'), {
  runScripts: 'dangerously',
  url: 'http://localhost:8899/',
  pretendToBeVisual: true,
  virtualConsole: vc
});
const w = dom.window, d = w.document, LS = w.localStorage;

let pass = 0, fail = 0;
function report(n, v, x) { if (v) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '  [' + x + ']' : '')); } }

const sent = [];
w.fetch = function (url, init) {
  sent.push({ url: String(url), init: init || {} });
  if (String(url).indexOf('/api/exam') >= 0) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ diagnosis: '诊断' }) });
  if (String(url).indexOf('/api/report') >= 0) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  if (String(url).indexOf('/api/config') >= 0) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ configured: true, model: 'deepseek-chat' }) });
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
};

setTimeout(async function () {
  console.log('=== 1. 构造全新学生环境 ===');
  LS.clear();   // 彻底清空，学号 2026046177 从未出现过
  LS.setItem('hxdao_users', JSON.stringify([{ id: '2026046177', name: '小白', pwd: w.hash('pw123') }]));
  LS.setItem('hxdao_session', JSON.stringify({ id: '2026046177', name: '小白' }));
  report('档案记录为空（模拟首次使用）', (LS.getItem('hxdao_records') || null) === null,
    'records=' + LS.getItem('hxdao_records'));
  report('会话指向新学号', JSON.parse(LS.getItem('hxdao_session')).id === '2026046177');
  w.enter();

  const quiz = dom.window.eval('QUIZ');

  console.log('\n=== 2. 首次直接进考核（原缺陷必崩点） ===');
  w.nav('exam');
  w.startExam();
  report('考核题已渲染', d.querySelectorAll('#exam-box .quiz-q').length === quiz.length);

  sent.length = 0;
  let threw = null;
  quiz.forEach((q, i) => { try { w.pickExam('e' + i, i, q.ans); } catch (e) {} });
  try { w.gradeExam(); } catch (e) { threw = e; }
  report('gradeExam 不抛异常（核心回归）', !threw, threw ? String(threw.message || threw) : '');
  await new Promise(r => setTimeout(r, 250));

  report('档案已自动建立', !!LS.getItem('hxdao_records'));
  const recs = JSON.parse(LS.getItem('hxdao_records') || '{}');
  report('档案含该学号', !!(recs['2026046177'] && recs['2026046177'].exam), JSON.stringify(recs).slice(0, 120));
  report('exam 成绩已保存', recs['2026046177'] && recs['2026046177'].exam && recs['2026046177'].exam.total === quiz.length);

  report('触发了上报 /api/report', sent.some(s => s.url.indexOf('/api/report') >= 0),
    sent.map(s => s.url.replace(/^https?:\/\/[^/]+/, '')).join(' | '));
  const rep = sent.find(s => s.url.indexOf('/api/report') >= 0);
  if (rep) {
    const b = JSON.parse(rep.init.body);
    report('上报学号正确', b.sid === '2026046177', b.sid);
    report('上报姓名正确', b.name === '小白', b.name);
  }

  const boxTxt = d.querySelector('#exam-box').textContent;
  report('结果页正常渲染（含正确率）', /\d+\/\d+/.test(boxTxt), boxTxt.slice(0, 60));
  report('结果页含同步提示灰字', boxTxt.indexOf('已同步给任课教师') >= 0);
  report('结果页含四维雷达容器', !!d.querySelector('#radar-exam'));

  console.log('\n=== 3. 首次直接进练习（同类缺陷） ===');
  LS.removeItem('hxdao_records');   // 再清一次，模拟只练不考
  sent.length = 0;
  w.nav('practice');
  threw = null;
  try { w.buildBankBtns && w.buildBankBtns(); } catch (e) {}
  try {
    w.startQuiz('知识');
    w.gradeQuiz('知识');
  } catch (e) { threw = e; }
  report('gradeQuiz 不抛异常', !threw, threw ? String(threw.message || threw) : '');
  const recs2 = JSON.parse(LS.getItem('hxdao_records') || '{}');
  report('练习记录已保存', recs2['2026046177'] && Array.isArray(recs2['2026046177'].practice),
    JSON.stringify(recs2).slice(0, 100));

  console.log('\n=== 4. 首次直接打卡（本来就没问题，确认没被改坏） ===');
  LS.removeItem('hxdao_records');
  threw = null;
  try {
    const mi = d.querySelector('#min-input');
    if (mi) mi.value = '30';
    w.doCheckin && w.doCheckin();
  } catch (e) { threw = e; }
  report('打卡不抛异常', !threw, threw ? String(threw.message || threw) : '');

  console.log('\n=== 5. 源码层兜底检查 ===');
  const src = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf8');
  const guards = (src.match(/if\(!a\[s\.id\]\)a\[s\.id\]=/g) || []).length;
  report('源码中有3 处建档兜底（打卡/练习/考核）', guards >= 3, '实际 ' + guards + ' 处');
  const examIdx = src.indexOf('a[s.id].exam=');
  const guardIdx = src.lastIndexOf('if(!a[s.id])a[s.id]=', examIdx);
  report('考核赋值前有兜底', guardIdx >= 0 && guardIdx < examIdx, 'guard=' + guardIdx + ' exam=' + examIdx);

  console.log('\n=== 6. 无脚本错误 ===');
  report('errors 为空', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log('\n========================================');
  console.log('通过 ' + pass + ' / 失败 ' + fail + ' / 合计 ' + (pass + fail));
  process.exit(fail ? 1 : 0);
}, 600);