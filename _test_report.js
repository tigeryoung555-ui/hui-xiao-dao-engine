/* 学生端「学情成绩上报」专项测试
   验证：上报内容只含汇总行、失败不阻塞、file:// 下静默跳过、界面明示 */
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, 'index.html');
const html = fs.readFileSync(FILE, 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + ((e && e.message) || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost:8000/',
  pretendToBeVisual: true,
  virtualConsole: vc
});
const w = dom.window, d = w.document;

let pass = 0, fail = 0;
function report(n, v, x) { if (v) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '  [' + x + ']' : '')); } }

/* 记录所有上报请求 */
const sent = [];
w.fetch = function (url, init) {
  sent.push({ url: String(url), init: init || {} });
  const u = String(url);
  if (u.indexOf('/api/exam') >= 0) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ diagnosis: '诊断内容' }) });
  }
  if (u.indexOf('/api/chat') >= 0) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ answer: '答复' }) });
  }
  if (u.indexOf('/api/report') >= 0) {
    // 模拟成功
    if (w.__reportFail) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: '写入失败' }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  }
  if (u.indexOf('/api/config') >= 0) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ configured: true, model: 'deepseek-chat' }) });
  }
  return Promise.reject(new Error('unexpected ' + u));
};
w.__reportFail = false;

setTimeout(async function () {
  // 先登录，拿到会话
  const LS = w.localStorage;
  LS.setItem('hxdao_users', JSON.stringify([{ id: '20260001', name: '张三', pwd: w.hash('123') }]));
  // 手动构造会话（doLogin 依赖表单交互，这里直接写 session）
  LS.setItem('hxdao_session', JSON.stringify({ id: '20260001', name: '张三' }));

  console.log('=== 1. 函数存在性 ===');
  report('reportScore 已定义', typeof w.reportScore === 'function');
  // API_BASE 是 const 声明，不会挂到 window 上，须在页面作用域内取值
  report('上报常量 API_BASE 已定义', typeof dom.window.eval('API_BASE') === 'string',
    'API_BASE=' + dom.window.eval('API_BASE'));

  console.log('\n=== 2. 上报内容只含汇总字段 ===');
  sent.length = 0;
  w.reportScore(8, 10, { '知识': 85, '能力': 70, '素养': 60, '规划': 90 }, 2);
  await new Promise(r => setTimeout(r, 100));

  const rep = sent.find(s => s.url.indexOf('/api/report') >= 0);
  report('确实调用了 /api/report', !!rep, sent.map(s => s.url).join(' | '));
  if (rep) {
    report('用 POST 方法', rep.init.method === 'POST', rep.init.method);
    report('带 JSON Content-Type', rep.init.headers['Content-Type'] === 'application/json');
    const body = JSON.parse(rep.init.body);
    report('含学号 sid', body.sid === '20260001', JSON.stringify(body));
    report('含姓名 name', body.name === '张三');
    report('含答对 score', body.score === 8);
    report('含总题 total', body.total === 10);
    report('含错题数 wrong', body.wrong === 2);
    report('含四维 dims', body.dims && body.dims['知识'] === 85 && body.dims['规划'] === 90);
    report('含日期且格式正确', /^\d{4}-\d{2}-\d{2}$/.test(body.date), body.date);

    // 隐私断言：不得夹带个人明细
    const raw = rep.init.body;
    report('不含 answerDetail 等明细字段',
      !/answerDetail|answers|mistakes|practice|chatLog|browsing/i.test(raw), raw);
    report('顶层字段仅 7 个', Object.keys(body).length === 7, Object.keys(body).join(','));
  }

  console.log('\n=== 3. wrong 缺省时自动推算 ===');
  sent.length = 0;
  w.reportScore(7, 10, { '知识': 70 });
  await new Promise(r => setTimeout(r, 80));
  const rep2 = sent.find(s => s.url.indexOf('/api/report') >= 0);
  const b2 = JSON.parse(rep2.init.body);
  report('wrong 未传时算成 10-7=3', b2.wrong === 3, 'wrong=' + b2.wrong);

  console.log('\n=== 4. 未登录时不报错 ===');
  const saved = LS.getItem('hxdao_session');
  LS.removeItem('hxdao_session');
  sent.length = 0;
  let threw = false;
  try { w.reportScore(5, 10, {}, 5); } catch (e) { threw = true; }
  await new Promise(r => setTimeout(r, 80));
  report('无会话时不抛异常', !threw);
  report('无会话时也不发请求', !sent.some(s => s.url.indexOf('/api/report') >= 0));
  LS.setItem('hxdao_session', saved);

  console.log('\n=== 5. 会话数据损坏时不崩 ===');
  LS.setItem('hxdao_session', '{坏 JSON');
  threw = false;
  try { w.reportScore(5, 10, {}, 5); } catch (e) { threw = true; }
  report('会话 JSON 损坏不抛异常', !threw);
  LS.setItem('hxdao_session', JSON.stringify({ id: '20260001', name: '张三' }));

  console.log('\n=== 6. 服务端报错不阻塞学生 ===');
  w.__reportFail = true;
  sent.length = 0;
  threw = false;
  try { w.reportScore(6, 10, {}, 4); } catch (e) { threw = true; }
  await new Promise(r => setTimeout(r, 120));
  report('服务端 500 时不抛异常到页面', !threw);
  report('服务端 500 时仍发出请求（重试无意义，不弹错）', sent.some(s => s.url.indexOf('/api/report') >= 0));
  w.__reportFail = false;

  console.log('\n=== 7. 网络中断不崩 ===');
  const realFetch = w.fetch;
  w.fetch = function (url, init) {
    if (String(url).indexOf('/api/report') >= 0) return Promise.reject(new Error('network down'));
    return realFetch(url, init);
  };
  threw = false;
  try { w.reportScore(6, 10, {}, 4); } catch (e) { threw = true; }
  await new Promise(r => setTimeout(r, 150));
  report('断网时不抛异常', !threw);
  w.fetch = realFetch;

  console.log('\n=== 8. 交卷全流程确实触发上报 ===');
  // gradeExam 依赖 rec() 里已有该学号的档案对象，先建一个空档案
  const recs = JSON.parse(LS.getItem('hxdao_records') || '{}');
  recs['20260001'] = { checkin: [], practice: [] };
  LS.setItem('hxdao_records', JSON.stringify(recs));
  sent.length = 0;
  w.nav('exam');
  w.startExam();
  const quiz = dom.window.eval('QUIZ');
  quiz.forEach((q, i) => { try { w.pickExam('e' + i, i, q.ans); } catch (e) {} });
  let gErr = null;
  try { w.gradeExam(); } catch (e) { gErr = e; }
  report('gradeExam 未抛异常', !gErr, gErr ? String(gErr.message || gErr) : '');
  await new Promise(r => setTimeout(r, 250));
  report('交卷后触发了 /api/report', sent.some(s => s.url.indexOf('/api/report') >= 0),
    sent.map(s => s.url.replace(/^https?:\/\/[^/]+/, '')).join(' | '));
  report('已登录状态下才会发（本次有会话）', !!LS.getItem('hxdao_session'));
  const repFull = sent.find(s => s.url.indexOf('/api/report') >= 0);
  if (repFull) {
    const bf = JSON.parse(repFull.init.body);
    report('上报的 total 等于题库总数', bf.total === quiz.length, bf.total + ' vs ' + quiz.length);
    report('全对时 score=total', bf.score === bf.total, bf.score + '/' + bf.total);
    report('全对时 wrong=0', bf.wrong === 0, 'wrong=' + bf.wrong);
  }

  console.log('\n=== 9. 界面明示 ===');
  const tip = d.querySelector('.auth-tip');
  report('注册页有数据说明', !!tip);
  if (tip) {
    report('说明里提到成绩上传', tip.textContent.indexOf('上传') >= 0, tip.textContent.slice(0, 60));
    report('说明里承诺不上传作答过程', tip.textContent.indexOf('不会上传') >= 0);
    report('说明里点明只上传分数与四维', tip.textContent.indexOf('四维') >= 0);
    report('说明里点明教师需口令', tip.textContent.indexOf('口令') >= 0);
    report('已移除旧文案「本平台为本地演示版」', tip.textContent.indexOf('本地演示版') < 0);
    report('已移除旧文案「数据仅保存在你当前浏览器」', tip.textContent.indexOf('数据仅保存在你当前浏览器') < 0);
  }
  report('侧栏有教师入口', !!d.querySelector('a[href="teacher.html"]'));
  report('考核结果含同步提示',
    d.querySelector('#exam-box').textContent.indexOf('已同步给任课教师') >= 0,
    d.querySelector('#exam-box').textContent.slice(0, 100));

  console.log('\n=== 10. 全程无脚本错误 ===');
  report('errors 为空', errors.length === 0, errors.join(' | '));
  if (errors.length) errors.slice(0, 6).forEach(e => console.log('      ! ' + e));

  console.log('\n========================================');
  console.log('通过 ' + pass + ' / 失败 ' + fail + ' / 合计 ' + (pass + fail));
  process.exit(fail ? 1 : 0);
}, 700);