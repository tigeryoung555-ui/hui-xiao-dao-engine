/* 回归测试：模拟 GitHub Pages 环境，验证 API_BASE 不再为空串
   背景（真实事故）：resolveApiBase() 在 https 协议下走到最后返回 ""，
   导致上报请求发到 GitHub Pages 自己 → 404 → D1 永远收不到数据。
   而当时的测试恰好断言「API_BASE 应为空串」，把缺陷当成了规范。 */
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function report(n, v, x) { if (v) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '  [' + x + ']' : '')); } }

function boot(url, label) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String((e && e.message) || e)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: url,
    pretendToBeVisual: true, virtualConsole: vc
  });
  const w = dom.window;
  return { w, errors, dom, label: label };
}

(async function () {
  // ---- 场景 1：GitHub Pages（https），全新用户，未设置过地址 ----
  const a = boot('https://tigeryoung555-ui.github.io/hui-xiao-dao/', 'Pages https');
  await new Promise(r => setTimeout(r, 500));
  const A = a.w.eval('API_BASE');
  console.log('=== 场景1：GitHub Pages 首次访问（最关键） ===');
  report('Pages 环境 API_BASE 非空', A !== '', JSON.stringify(A));
  report('Pages 环境指向线上 Worker', /workers\.dev$/.test(A), A);
  report('不是 Pages 自身域名', A.indexOf('github.io') < 0, A);

  // 真发一次上报请求，确认 URL 是对的
  const sent = [];
  a.w.fetch = function (u, i) { sent.push(String(u)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }); };
  a.w.localStorage.setItem('hxdao_session', JSON.stringify({ id: '2026046177', name: '小白' }));
  a.w.reportScore(8, 10, { '知识': 80, '能力': 70 }, 2);
  await new Promise(r => setTimeout(r, 150));
  report('上报请求打到 Worker 而非 Pages',
    sent.length === 1 && /workers\.dev\/api\/report$/.test(sent[0]),
    sent.join(' | ') || '未发出请求');

  // ---- 场景 2：URL 参数显式指定（应优先，且忽略默认值）----
  const b = boot('https://tigeryoung555-ui.github.io/hui-xiao-dao/?api=https://my-own.example.com/', '自定义');
  await new Promise(r => setTimeout(r, 500));
  const B = b.w.eval('API_BASE');
  console.log('\n=== 场景2：?api= 参数优先 ===');
  report('?api= 覆盖默认值', B === 'https://my-own.example.com', B);

  // ---- 场景 3：localStorage 手动设置优先于默认值 ----
  // jsdom 的 location.reload() 不可靠，改为预置 localStorage 后重新开实例
  const pre = new JSDOM('', { url: 'https://tigeryoung555-ui.github.io/hui-xiao-dao/' });
  pre.window.localStorage.setItem('hxdao_api', 'http://localhost:8000');
  const savedVal = pre.window.localStorage.getItem('hxdao_api');
  pre.window.close();

  const c = boot('https://tigeryoung555-ui.github.io/hui-xiao-dao/', '自定义localStorage');
  c.w.localStorage.setItem('hxdao_api', savedVal);
  await new Promise(r => setTimeout(r, 500));
  const C = c.w.eval('resolveApiBase()');   // 直接调函数，等价于重新解析
  console.log('\n=== 场景3：localStorage 优先 ===');
  report('localStorage 设置生效', C === 'http://localhost:8000', C);
  report('localStorage 优先于默认线上地址', C.indexOf('workers.dev') < 0, C);

  // ---- 场景 4：file:// 直开仍指向本地（不能被默认值污染）----
  // 说明：jsdom 在 file:// 下抛 SecurityError（opaque origin 限制），
  // 整个脚本不执行，所以无法在 jsdom 里验证该分支。
  // 改为直接校验源码分支顺序 —— 这是真实浏览器的同一段逻辑。
  console.log('\n=== 场景4：file:// 分支（源码校验） ===');
  const src = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf8');
  const fn = src.match(/function resolveApiBase\(\)\{[\s\S]*?\n\}/);
  report('能取到 resolveApiBase 源码', !!fn);
  if (fn) {
    const body = fn[0];
    // 用 indexOf 而非正则：源码里含 file:// 与 http:// 这样的双斜杠，正则易写错
    const iFile = body.indexOf('location.protocol==="file:"');
    const iLocal = body.indexOf('"http://localhost:8000"');
    const iDefault = body.indexOf('return DEFAULT_API');
    report('源码含 file:// 分支', iFile >= 0, 'pos=' + iFile);
    report('file:// 分支返回 localhost:8000', iLocal >= 0, 'pos=' + iLocal);
    report('含 return DEFAULT_API 分支', iDefault >= 0, 'pos=' + iDefault);
    // 关键：file:// 判断必须排在 return DEFAULT_API 之前，否则本地直开会被劫持到线上
    report('file:// 判断排在默认值之前（顺序正确）',
      iFile >= 0 && iLocal > iFile && iDefault > iLocal,
      'file=' + iFile + ' local=' + iLocal + ' default=' + iDefault);
  }
  report('file:// 场景不会被线上地址污染（源码层面）',
    src.indexOf('if(location.protocol==="file:") return "http://localhost:8000";') >= 0);

  // ---- 场景 5：脚本无错误 ----
  console.log('\n=== 场景5：无脚本错误 ===');
  report('Pages 环境无错误', a.errors.length === 0, a.errors.join(' | '));
  report('自定义地址环境无错误', b.errors.length === 0, b.errors.join(' | '));
  report('Pages/localStorage 两种场景均无错误', c.errors.length === 0, c.errors.join(' | '));

  console.log('\n========================================');
  console.log('通过 ' + pass + ' / 失败 ' + fail + ' / 合计 ' + (pass + fail));
  process.exit(fail ? 1 : 0);
})();