const {JSDOM,VirtualConsole}=require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('F:/.workbuddy/2026-08-29-19-15-55/会小导学习中心/index.html','utf8');
const errors=[];
const vc=new VirtualConsole();
vc.on('jsdomError',e=>errors.push('jsdomError: '+(e&&e.message)));
vc.on('error',(...a)=>errors.push('console.error: '+a.join(' ')));
const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost:8000/',pretendToBeVisual:true,virtualConsole:vc});
const w=dom.window,d=w.document;
const ev=s=>w.eval(s);
let pass=0,fail=0;
function report(n,v,x){ if(v){pass++;console.log('PASS  '+n)} else {fail++;console.log('FAIL  '+n+(x?'  ['+x+']':''))} }

setTimeout(()=>{
  const KB=ev('KB'),QUIZ=ev('QUIZ'),API_BASE=ev('API_BASE');
  report('KB=22',KB.length===22,'KB='+KB.length);
  report('QUIZ=27',QUIZ.length===27,'QUIZ='+QUIZ.length);
  const dims={};QUIZ.forEach(q=>dims[q.obe]=(dims[q.obe]||0)+1);
  report('四维 12/5/5/5',dims['知识']===12&&dims['能力']===5&&dims['素养']===5&&dims['规划']===5,JSON.stringify(dims));
  report('KB 去学校化',!/南航|金城|南京航空航天/.test(ev('JSON.stringify(KB)')));
  report('QUIZ 去学校化',!/南航|金城|南京航空航天/.test(ev('JSON.stringify(QUIZ)')));
  // 关键回归：API_BASE 绝不能是空串。
  // 空串会让请求发到 GitHub Pages 自己（404），学生端上报/问答全部静默失败。
  // 历史教训：这里原本断言的是「API_BASE 空串」，等于把缺陷当规范。
  report('API_BASE 非空串',API_BASE!=='',JSON.stringify(API_BASE));
  report('API_BASE 指向线上 Worker',/workers\.dev$/.test(API_BASE),API_BASE);
  report('API_BASE 无尾部斜杠',!/\/$/.test(API_BASE),API_BASE);
  report('有默认地址常量 DEFAULT_API',typeof ev('DEFAULT_API')==='string'&&ev('DEFAULT_API').indexOf('workers.dev')>0,ev('DEFAULT_API'));
  report('file:// 场景仍指向本地 8000',
    ev('resolveApiBase.toString()').indexOf('http://localhost:8000')>=0);

  const md=w.formatLLM('### 标题\n- 要点一\n- 要点二\n\n1. 第一\n2. 第二\n\n正文 **粗体** `code`');
  report('md-h',md.includes('md-h'));
  report('ul→ol 正确切换',md.includes('</ul><ol class="md-ol">'),md);
  report('标签配对平衡',(md.match(/<ol/g)||[]).length===(md.match(/<\/ol>/g)||[]).length&&(md.match(/<ul/g)||[]).length===(md.match(/<\/ul>/g)||[]).length,md);
  report('粗体',md.includes('<b>粗体</b>'));
  report('code',md.includes('<code>code</code>'));
  report('连续空行无空段',!w.formatLLM('a\n\n\n\nb').includes('</p><p class="md-p"></p>'));
  report('纯文本成段',w.formatLLM('一句话')==='<p class="md-p">一句话</p>',w.formatLLM('一句话'));
  // XSS：转义后不得产生可执行标签
  const xss=w.formatLLM('<img src=x onerror=alert(1)>');
  report('XSS:无裸 <img',!/<img/i.test(xss),xss);
  report('XSS:无裸 <script',!/<script/i.test(w.formatLLM('<script>alert(1)<\/script>')));
  report('escapeHTML',w.escapeHTML('<b>&"')==='&lt;b&gt;&amp;&quot;'.replace(/&quot;/g,'"')||w.escapeHTML('<b>')==='&lt;b&gt;');

  // 检索：标题精确命中应胜出
  report('localReply「会计等式是什么」→会计等式',w.localReply('会计等式是什么').includes('会计等式'),w.localReply('会计等式是什么').slice(0,70));
  report('localReply「会计是什么」→会计是什么',w.localReply('会计是什么').includes('会计是什么'));
  report('localReply「挂科了怎么办」→挂科',w.localReply('挂科了怎么办').includes('挂科'));
  report('localReply「mpacc怎么考」→考研留学',w.localReply('mpacc怎么考').includes('考研'),w.localReply('mpacc怎么考').slice(0,70));
  report('localReply 未命中给引导',w.localReply('今天天气').includes('未在我的知识库'));
  report('新增节点：会计循环',w.localReply('会计循环的正确顺序').includes('会计循环'),w.localReply('会计循环的正确顺序').slice(0,60));
  report('新增节点：试算平衡',w.localReply('试算平衡能查出什么错').includes('试算平衡'),w.localReply('试算平衡能查出什么错').slice(0,60));
  report('新增节点：借贷记账法',w.localReply('借贷记账法怎么记').includes('借贷记账法'),w.localReply('借贷记账法怎么记').slice(0,60));
  report('localReply 用户输入转义',!w.localReply('<img src=x onerror=1>').includes('<img'));

  // 完整注册→登录流程（必须真的填表单）
  d.querySelector('#reg-id').value='20260001';
  d.querySelector('#reg-name').value='张三';
  d.querySelector('#reg-pwd').value='abc123';
  d.querySelector('#reg-pwd2').value='abc123';
  w.doReg();
  report('注册后用户表有 1 人',ev('users()').length===1,JSON.stringify(ev('users()')));
  d.querySelector('#login-user').value='20260001';
  d.querySelector('#login-pwd').value='abc123';
  w.doLogin();
  report('会话已建立',!!w.localStorage.getItem('hxdao_session'));
  report('应用区显示',!d.querySelector('#app').classList.contains('hidden'));
  report('登录区隐藏',d.querySelector('#login-wrap').classList.contains('hidden'));
  report('欢迎语含用户名',d.querySelector('#welcome').textContent.includes('张三'),d.querySelector('#welcome').textContent);
  report('侧栏显示姓名',d.querySelector('#side-name').textContent==='张三');
  report('侧栏显示学号',d.querySelector('#side-id').textContent.includes('20260001'));
  report('OBE 四维列表有内容',d.querySelector('#dim-home').textContent.trim().length>10,d.querySelector('#dim-home').textContent.slice(0,50));
  report('四课次面板=4',d.querySelectorAll('details.lesson').length===4);
  report('课次资源=20 项',d.querySelectorAll('details.lesson li').length===20,'实际='+d.querySelectorAll('details.lesson li').length);
  report('引擎标签存在',!!d.querySelector('#online-tag'));

  // 导航
  ['checkin','practice','ask','exam','home'].forEach(p=>{
    w.nav(p);
    report('导航 '+p,!d.querySelector('#page-'+p).classList.contains('hidden'));
  });

  // 打卡（需先设值）
  w.nav('checkin');
  const b4=(w.rec()['20260001']||{checkins:[]}).checkins.length;
  d.querySelector('#ck-topic').value='课余自学';
  d.querySelector('#ck-min').value='45';
  w.doCheckin();
  const af=(w.rec()['20260001']||{checkins:[]}).checkins.length;
  report('打卡 +1',af===b4+1,b4+'->'+af);
  report('打卡天数显示 1',d.querySelector('#st-checkin').textContent==='1',d.querySelector('#st-checkin').textContent);

  // 重复打卡应被拦截
  d.querySelector('#ck-min').value='30';
  w.doCheckin();
  const af2=(w.rec()['20260001']||{checkins:[]}).checkins.length;
  report('同日同内容不重复打卡',af2===af,af+'->'+af2);

  // 练习判分
  w.nav('practice');
  w.buildBankBtns();
  report('练习模块按钮=5',d.querySelectorAll('#bank-btns .stat').length===5,'实际='+d.querySelectorAll('#bank-btns .stat').length);
  w.startQuiz('知识');
  report('知识题已渲染',d.querySelectorAll('#quiz-box .quiz-q').length>0,'题数='+d.querySelectorAll('#quiz-box .quiz-q').length);
  const firstOpts=d.querySelectorAll('#quiz-box .quiz-q')[0].querySelectorAll('.opt');
  report('选项可点击',firstOpts.length>=2,'选项数='+firstOpts.length);
  w.pick('q0',0,0,'知识');
  w.gradeQuiz('知识');
  report('判分后显示解析',d.querySelectorAll('#quiz-box .explain').length>0);

  // 未作答直接提交（原缺陷：parseInt(undefined)=NaN 导致整页崩溃）
  w.startQuiz('能力');
  w.gradeQuiz('能力');
  report('能力模块：全部未作答提交不崩溃',true);
  report('未作答标记正确',d.querySelector('#quiz-box').textContent.includes('未作答'),d.querySelector('#quiz-box').textContent.slice(0,80));
  report('未作答仍标出正确答案',d.querySelectorAll('#quiz-box .correct').length===5,'correct='+d.querySelectorAll('#quiz-box .correct').length);

  // 考核全流程
  w.nav('exam');
  w.startExam();
  report('考核题已渲染',d.querySelectorAll('#exam-box .quiz-q').length===27,'题数='+d.querySelectorAll('#exam-box .quiz-q').length);
  // 全部选对（直接按 ans 选）
  const QUIZarr=ev('QUIZ');
  QUIZarr.forEach((q,i)=>{ w.pickExam('e'+i,i,q.ans) });
  w.gradeExam();
  report('全对 → 100%',d.querySelector('#exam-box').textContent.includes('100%'),d.querySelector('#exam-box').textContent.match(/\d+\/\d+/)?.[0]);
  report('诊断区已填充',d.querySelector('#exam-diagnosis').textContent.trim().length>10,d.querySelector('#exam-diagnosis').textContent.slice(0,60));

  report('无脚本运行时错误',errors.length===0);
  if(errors.length) errors.slice(0,8).forEach(e=>console.log('      ! '+e));
  console.log('\n通过 '+pass+' / 失败 '+fail);
  process.exit(fail?1:0);
},800);