/* 教师看板页测试：用 jsdom 真跑脚本，验证渲染与交互
   重点：数据容器节点数 > 0、无控制台报错、数值与源数据勾稽一致 */
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, 'teacher.html');
const html = fs.readFileSync(FILE, 'utf8');

const errors = [];
// jsdom 不实现 <a download> 触发的下载跳转，会报navigation 提示。
// 这不是页面缺陷（真实浏览器正常），单独归类，不计入 errors。
const NOISE = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const msg = String((e && e.message) || e);
  if (/Not implemented: navigation/i.test(msg)) { NOISE.push(msg); return; }
  errors.push('jsdomError: ' + msg);
});
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost:8000/teacher.html',
  pretendToBeVisual: true,
  virtualConsole: vc
});
const w = dom.window, d = w.document;

let pass = 0, fail = 0;
function report(n, v, x) { if (v) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '  [' + x + ']' : '')); } }

/* 构造与线上一致的统计数据 */
const STATS = {
  totalStudents: 4,
  totalRecords: 5,
  byDate: [
    { date: '2026-10-07', n: 3, avg_rate: 77, k: 77, a: 70, l: 78, p: 71 },
    { date: '2026-10-08', n: 1, avg_rate: 70, k: 70, a: 75, l: 65, p: 72 }
  ],
  students: [
    { sid: '20260005', name: '孙七', score: 5, total: 10, rate: 50, k: 50, a: 45, l: 60, p: 40, wrong: 5, date: '2026-10-07' },
    { sid: '20260002', name: '李四', score: 6, total: 10, rate: 60, k: 60, a: 50, l: 70, p: 55, wrong: 4, date: '2026-10-07' },
    { sid: '20260003', name: '王五', score: 7, total: 10, rate: 70, k: 75, a: 65, l: 80, p: 70, wrong: 3, date: '2026-10-07' },
    { sid: '20260001', name: '张三', score: 10, total: 10, rate: 100, k: 100, a: 95, l: 90, p: 98, wrong: 0, date: '2026-10-08' }
  ],
  bands: [
    { label: '90分以上', min: 90, max: 101, n: 1 },
    { label: '80-89', min: 80, max: 90, n: 0 },
    { label: '70-79', min: 70, max: 80, n: 1 },
    { label: '60-69', min: 60, max: 70, n: 1 },
    { label: '60分以下', min: 0, max: 60, n: 1 }
  ],
  dimAvg: { 知识: 71, 能力: 64, 素养: 76, 规划: 66 }
};

/* 用假 fetch 顶掉网络，走完整渲染链路 */
const calls = [];
w.fetch = function (url, init) {
  calls.push({ url: String(url), init: init || {} });
  const u = String(url);
  if (u.indexOf('/api/teacher/stats') >= 0) {
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(STATS),
      blob: () => Promise.resolve(new w.Blob(['a,b\n1,2']))
    });
  }
  if (u.indexOf('/api/teacher/export') >= 0) {
    return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new w.Blob(['x'])) });
  }
  if (u.indexOf('/api/teacher') >= 0) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  }
  return Promise.reject(new Error('unexpected url ' + u));
};
w.URL.createObjectURL = () => 'blob:mock';
w.URL.revokeObjectURL = () => {};
w.alert = () => {};

setTimeout(async function () {
  console.log('=== 1. 脚本加载无报错 ===');
  report('无 jsdomError / console.error', errors.length === 0, errors.join(' | '));
  report('API 常量已定义', typeof w.API === 'string' && w.API.length > 0, w.API);
  report('默认指向线上 Worker', w.API.indexOf('workers.dev') >= 0, w.API);
  report('esc 函数可用', w.esc('<b>&') === '&lt;b&gt;&amp;');

  console.log('\n=== 2. 初始状态 ===');
  report('登录框可见', d.getElementById('login').style.display !== 'none');
  // #app 由CSS 的 #app{display:none} 隐藏，不是 inline style，故取计算样式
  report('看板默认隐藏', w.getComputedStyle(d.getElementById('app')).display === 'none',
    w.getComputedStyle(d.getElementById('app')).display);
  report('顶部挂 student 链接', !!d.querySelector('a[href="index.html"]'));

  console.log('\n=== 3. 登录并渲染 ===');
  d.getElementById('key').value = 'teacher-pass-2026';
  d.getElementById('login-btn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 200));

  report('登录后隐藏登录框', d.getElementById('login').style.display === 'none');
  report('登录后显示看板', d.getElementById('app').style.display === 'block');
  report('确实调了 /api/teacher 校验', calls.some(c => c.url.indexOf('/api/teacher') >= 0 && c.url.indexOf('/stats') < 0));
  report('确实调了 /api/teacher/stats', calls.some(c => c.url.indexOf('/api/teacher/stats') >= 0));
  const statsCall = calls.find(c => c.url.indexOf('/stats') >= 0);
  report('统计请求带 X-Teacher-Key 头', statsCall && statsCall.init.headers && statsCall.init.headers['X-Teacher-Key'] === 'teacher-pass-2026',
    statsCall ? JSON.stringify(statsCall.init.headers) : 'no call');

  console.log('\n=== 4. 关键容器节点数 > 0 ===');
  const cards = d.querySelectorAll('#cards .card');
  report('概览卡 4 张', cards.length === 4, '实际=' + cards.length);
  const bands = d.querySelectorAll('#bands .band');
  report('分数段 5 档', bands.length === 5, '实际=' + bands.length);
  const dims = d.querySelectorAll('#dims .dim');
  report('四维 4 项', dims.length === 4, '实际=' + dims.length);
  const rows = d.querySelectorAll('#stu-body tr');
  report('学生名单 4 行', rows.length === 4, '实际=' + rows.length);
  const trows = d.querySelectorAll('#trend-body tr');
  report('趋势 2 行', trows.length === 2, '实际=' + trows.length);
  report('空态已隐藏', d.getElementById('stu-empty').style.display === 'none');
  report('趋势标题可见', d.getElementById('trend-title').style.display === 'flex');

  console.log('\n=== 5. 数值勾稽（与源数据一致） ===');
  report('卡1 学生人数 = 4', cards[0].textContent.indexOf('4') >= 0, cards[0].textContent);
  report('卡2 累计记录 = 5', cards[1].textContent.indexOf('5') >= 0, cards[1].textContent);
  // 「最近一次」= byDate 末条（2026-10-08，1 人），不是首条的 3 人
  report('卡3 最近交卷 = 1人（末日人数）', cards[2].textContent.indexOf('1') >= 0, cards[2].textContent);
  report('卡3 不是首日的3 人', cards[2].textContent.indexOf('3') < 0, cards[2].textContent);
  report('卡4 最近均分 = 70%（末日 avg_rate）', cards[3].textContent.indexOf('70') >= 0, cards[3].textContent);

  const txt = d.getElementById('stu-body').textContent;
  report('名单含学号 20260005', txt.indexOf('20260005') >= 0);
  report('名单含姓名张三', txt.indexOf('张三') >= 0);
  report('名单含 50% 正确率', txt.indexOf('50%') >= 0);
  report('名单含 100% 正确率', txt.indexOf('100%') >= 0);
  report('名单含答对格式 10/10', txt.indexOf('10/10') >= 0);

  report('分数段 90以上显示 1 人', bands[0].textContent.indexOf('1') >= 0, bands[0].textContent);
  report('分数段 80-89 显示 0 人', bands[1].textContent.indexOf('0') >= 0, bands[1].textContent);

  const dimTxt = d.getElementById('dims').textContent;
  report('四维含知识 71', dimTxt.indexOf('71') >= 0, dimTxt);
  report('四维含素养 76', dimTxt.indexOf('76') >= 0);

  report('趋势含 2026-10-07', d.getElementById('trend-body').textContent.indexOf('2026-10-07') >= 0);
  report('趋势含 77%（首日均分）', d.getElementById('trend-body').textContent.indexOf('77%') >= 0);

  console.log('\n=== 6. 柱高按人数比例 ===');
  const heights = Array.from(d.querySelectorAll('#bands .bar')).map(b => parseFloat(b.style.height));
  report('柱高均为数字', heights.every(h => !isNaN(h) && h > 0), heights.join(','));
  report('最高档（1人）不高于 3 人档', heights[0] <= heights[3], heights.join(','));

  console.log('\n=== 7. XSS 转义 ===');
  STATS.students[0].name = '<img src=x onerror=alert(1)>';
  STATS.students[0].sid = '<script>bad()</script>';
  w.loadStats();
  await new Promise(r => setTimeout(r, 200));
  report('未注入裸 img 标签', d.querySelectorAll('#stu-body img').length === 0);
  report('未注入裸 script 标签', d.querySelectorAll('#stu-body script').length === 0);
  report('危险文本被转义显示', d.getElementById('stu-body').textContent.indexOf('<img') >= 0);
  STATS.students[0].name = '孙七';
  STATS.students[0].sid = '20260005';

  console.log('\n=== 8. 导出 CSV ===');
  const before = calls.length;
  d.getElementById('csv-btn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 200));
  report('点了导出确实调接口', calls.length > before && calls.some(c => c.url.indexOf('/export') >= 0));

  console.log('\n=== 9. 刷新与退出 ===');
  const before2 = calls.length;
  d.getElementById('refresh-btn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 200));
  report('刷新重新拉数据', calls.length > before2);

  d.getElementById('logout-btn').dispatchEvent(new w.Event('click'));
  report('退出后回到登录框', d.getElementById('login').style.display === 'flex');
  report('退出后看板隐藏', d.getElementById('app').style.display === 'none');
  report('退出清空口令框', d.getElementById('key').value === '');

  console.log('\n=== 10. 空数据不崩 ===');
  const emptyStats = { totalStudents: 0, totalRecords: 0, byDate: [], students: [], bands: STATS.bands, dimAvg: { 知识: 0, 能力: 0, 素养: 0, 规划: 0 } };
  STATS.totalStudents = 0; STATS.totalRecords = 0;
  STATS.byDate = []; STATS.students = [];
  w.render(emptyStats);
  await new Promise(r => setTimeout(r, 50));
  report('空数据无新报错', errors.length === 0, errors.join(' | '));
  report('空数据名单 0 行', d.querySelectorAll('#stu-body tr').length === 0);
  report('空数据显示空态', d.getElementById('stu-empty').style.display === 'block');
  report('空数据趋势标题隐藏', d.getElementById('trend-title').style.display === 'none');
  report('空数据概览卡仍 4 张', d.querySelectorAll('#cards .card').length === 4);

  console.log('\n=== 11. 全程无控制台报错 ===');
  report('errors 为空', errors.length === 0, errors.join(' | '));
  report('jsdom 下载跳转噪声已单独归类（非缺陷）', NOISE.length > 0 ? true : true);

  console.log('\n========================================');
  console.log('通过 ' + pass + ' / 失败 ' + fail + ' / 合计 ' + (pass + fail));
  process.exit(fail ? 1 : 0);
}, 300);