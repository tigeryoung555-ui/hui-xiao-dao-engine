/* =============================================================
   会小导 · 智能引擎后端（Cloudflare Worker 版）
   -------------------------------------------------------------
   用途：RAG 智能引擎 + 学情数据上报与教师看板 API
         部署到 Cloudflare Workers（免费额度：10 万次请求/天）

   路由：
     GET  /api/config      引擎是否就绪
     POST /api/chat         知识库检索(RAG) + 大模型作答
     POST /api/exam         基于考核结果生成个性化诊断
     POST /api/report       上报一次考核成绩（学情汇总用）
     POST /api/teacher      教师登录校验
     GET  /api/teacher/stats 教师看板数据（需口令）
     GET  /api/teacher/export 导出 CSV（需口令）

   环境变量（全部用 wrangler secret put 设置，不写进代码）：
     LLM_API_KEY   必填，模型服务商的密钥
     TEACHER_KEY   必填，教师端口令明文（比对用，留痕风险低于存哈希）
     LLM_BASE_URL  可选
     LLM_MODEL     可选
     DB            绑定名，Cloudflare D1 数据库

   数据与隐私：
     · 只上报「谁在何时考了多少分、四维各多少」这一行汇总数据
     · 不上传个人作答明细、不上传浏览行为、不上传 AI 提问内容
     · 上报失败不阻塞学生答题（前端已做降级处理）
   ============================================================= */

'use strict';

/* ---------- 运行环境 ---------- */
function readEnv(env, name, fallback) {
  const v = env && env[name];
  return v === undefined || v === null || v === '' ? fallback : v;
}

/* ---------- 知识库（与前端 index.html中的 KB、与 server.js 保持同步） ---------- */
const KB = [
  { k: '会计是什么', keys: ['会计', '定义', '本质', '通用语言', '商业'], a: '会计是企业经济活动的「商业通用语言」，也是经济信息系统与治理工具——把经营活动翻译成可比、可验证、可沟通的数字信息，保障交易信任链。它不只是记账算账。', obe: '知识1.1' },
  { k: '会计基本假设', keys: ['假设', '会计主体', '持续经营', '会计分期', '货币计量'], a: '会计四大基本假设：会计主体、持续经营、会计分期、货币计量。理解这四点是后续学习报表的基础。', obe: '知识1.2' },
  { k: '会计等式', keys: ['等式', '资产', '负债', '所有者权益', '利润', '收入', '费用'], a: '静态等式：资产＝负债＋所有者权益；动态等式：利润＝收入－费用。六大会计要素分为静态三要素与动态三要素。', obe: '知识1.3' },
  { k: '借贷规则', keys: ['借', '贷', '借贷', '复式', '分录'], a: '借≠借钱、贷≠贷款。借方记资产/费用增加、负债/权益减少；贷方相反。核心规则：有借必有贷，借贷必相等。', obe: '知识1.3' },
  { k: '财务报表', keys: ['报表', '资产负债表', '利润表', '现金流量表', '三张'], a: '三大报表：资产负债表（时点）、利润表（期间）、现金流量表（现金进出），三者存在勾稽关系。', obe: '知识1.3' },
  { k: '会计分支', keys: ['分支', '财务会计', '管理会计', '审计', '税务', '信息系统', '五大'], a: '会计五大分支：①财务会计（外部报告）②管理会计（内部决策）③审计学（鉴证）④税务会计（准则与税法协同）⑤会计信息系统（流程+数据治理）。', obe: '知识1.4' },
  { k: '会计信息质量', keys: ['质量', '可靠性', '相关性', '可比性', '谨慎性', '实质重于形式'], a: '会计信息八大质量要求：可靠性、相关性、可理解性、可比性、实质重于形式、重要性、谨慎性、及时性。可靠、相关是底线，谨慎性防高估资产与利润。', obe: '知识1.2' },
  { k: '毕业要求', keys: ['毕业', '学位', '要求', '九大', '德育'], a: '毕业要求 9 大维度：思想品德、学科知识、专业知识、专业应用能力、数据应用能力、信息能力、创新创业、合作沟通、持续发展。修满 150 学分并通过论文答辩授予管理学学士。', obe: '知识1.5' },
  { k: '会计发展史', keys: ['发展史', '帕乔利', '结绳', '四柱', '数智', '阶段'], a: '会计四阶段：手工会计 → 电算化 → 信息化 → 数智化（大数据+AI+RPA）。1494 年帕乔利系统总结复式簿记，被誉为会计学之父；中国唐宋有「四柱清册」。', obe: '知识1.6' },
  { k: '五维能力', keys: ['能力', '五维', '专业', '数据', 'AI', '业务', '学习'], a: '五维能力模型：专业能力（准则判断）、数据能力（Excel/SQL/Python/BI）、AI能力（Prompt/RPA）、业务能力（业财融合）、学习能力（持续学习）。AI 能力是核心新增。', obe: '能力2.3' },
  { k: '会计诚信', keys: ['诚信', '伦理', '合规', '红线', '康得新', '造假'], a: '会计诚信：不伪造、不隐瞒、不迎合不当要求；客观、专业胜任。违法红线：虚假财务报告、隐匿收入、虚假发票。案例警示：康得新、康美药业。', obe: '素养3.1' },
  { k: '证书', keys: ['证书', '初级', 'CPA', 'ACCA', '税务师', '考证'], a: '国内：初级会计（大一可报）/中级/高级/CPA（5年过6科）/税务师；国际：ACCA（大一可注册）/CMA。规划：初级→ACCA→CPA。', obe: '规划4.1' },
  { k: '岗位', keys: ['岗位', '出纳', 'CFO', '事务所', '审计', '财务BP'], a: '岗位分类：企业财务（出纳→会计→CFO）、事务所（审计助理→合伙人）、金融机构、公务员、新兴岗位（财务BP、智能风控、数据分析师、ESG专员）。', obe: '规划4.1' },
  { k: 'AI冲击', keys: ['AI', '替代', '自动化', '机器人', '护城河', '不器'], a: '可替代：凭证录入、对账、报表编制、发票OCR等重复工作；不可替代：专业判断、商业解释、跨部门沟通、伦理决策、战略筹划。君子不器——AI 是放大镜不是替身。', obe: '素养3.2' },
  { k: '大一规划', keys: ['大一', '规划', '基础', '初级会计', '高数'], a: '大一打基础：高数、英语、会计学原理（4学分核心）、计算机基础；目标：通过初级会计考试（次年5月）、加入1个社团。', obe: '能力2.2' },
  { k: '考研留学', keys: ['考研', 'MPAcc', '留学', '保研'], a: '考研：会计学硕/会计专硕MPAcc（199管理类联考+英语二+政治+复试）/审计硕/税务硕。留学：英/澳/美/香港，大三上定方向、大三下系统复习。', obe: '规划4.3' },
  { k: 'CIMA', keys: ['CIMA', '方向班', '特色', 'CGMA', '本校'], a: '本校 CIMA 方向班是特色项目（独立招生选拔），大二开始加修 CIMA 专属课程，毕业后可获 CIMA 基础阶段证书进入 CGMA 通道，需单独申请选拔。', obe: '规划4.1' },
  { k: '挂科', keys: ['挂科', '重修', '补考', '绩点', '学分'], a: '挂科可补考（开学1-2周）或重修；绩点 90+为4.0。课程约 50 门，务必重视基础课。', obe: '知识1.5' },
  { k: '会计循环', keys: ['会计循环', '循环', '凭证', '过账', '试算', '调整', '结账', '编报', '八步', '步骤'], a: '会计循环 8 步闭环：业务发生 → 填制原始凭证 → 编制记账凭证（分录）→ 登记账簿（过账）→ 试算平衡 → 期末调整（应计、折旧、摊销）→ 结转（收入费用结转到本年利润）→ 编制财务报表。记忆口诀：凭证→分录→过账→试算→调整→结账→编报。注意：试算平衡只能查出「借贷不等」，漏记整笔业务或借贷方向同时写反时试算表仍是平的，所以试算平衡不等于账一定对。', obe: '知识1.3' },
  { k: '试算平衡', keys: ['试算', '平衡', '借贷不等', '对账', '账实', '勾稽'], a: '试算平衡是核对借贷合计是否相等的方法（全部账户借方发生额合计＝贷方发生额合计），只能发现记账错误，不能发现记账正确但记录不完整（如漏记整笔业务、借贷方向同时写反、金额同错）。因此试算表平了不等于账一定对，还需账账核对、账证核对、账实核对、账表核对。', obe: '知识1.3' },
  { k: '借贷记账法', keys: ['记账方法', '借贷记账', '账户', '借方', '贷方', '余额'], a: '借贷记账法以「借」「贷」为记账符号：借方登记资产、费用、成本增加，登记负债、所有者权益减少；贷方反之。账户结构分四类：资产（借方登记余额在借方）、负债与所有者权益（贷方登记余额在贷方）、费用（借方）、收入（利润类，贷方余额表示增加）。有借必有贷，借贷必相等。', obe: '知识1.3' },
  { k: '实习竞赛', keys: ['实习', '竞赛', '比赛', '案例', '大三'], a: '实习大三开始为佳；竞赛推荐：数学建模、互联网+、案例分析、ACCA就业力大比拼、CIMA商业精英挑战赛、网中网杯财务决策大赛。', obe: '规划4.3' },
];

/* ---------- 检索 ---------- */
function retrieve(question, topN) {
  topN = topN || 3;
  const q = String(question || '');
  const scored = [];
  for (const node of KB) {
    let score = 0;
    const hit = [];
    for (const k of node.keys) {
      if (k && q.indexOf(k) >= 0) { score += k.length; hit.push(k); }
    }
    if (node.k && q.indexOf(node.k) >= 0) score += 10;
    if (score > 0) scored.push({ node: node, score: score, hit: hit });
  }
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, topN);
}

function buildContext(hits) {
  if (!hits.length) return '';
  return hits.map(function (h) {
    return '【' + h.node.k + '（对应 OBE ' + h.node.obe + '）】\n' + h.node.a;
  }).join('\n\n');
}

const SYSTEM_PROMPT = [
  '你是"会小导"，会计学专业导论课程的 AI 学习助教，面向正在修读该课程的大学生。',
  '',
  '你的行为准则：',
  '1. 优先依据下方【课程知识库】作答，并在回答末尾用「对应 OBE：编号」标注所用知识点。',
  '2. 知识库没有覆盖的部分，用你自己的会计与 AI 素养补足，但必须明确区分：先说知识库结论，再写"补充说明"。',
  '3. 语气亲切、像学长学姐答疑，不说空话套话；学生问"怎么学""怎么办"时给可执行的具体步骤。',
  '4. 涉及会计职业道德、法规红线时立场明确，不给出任何规避监管的建议。',
  '5. 用 Markdown 组织答案：小标题、要点列表、必要时用加粗。控制在 400 字以内，学生是在手机上看的。',
  '6. 不要复述问题，不要写"根据参考资料"这类无信息量的话。',
  '7. 涉及具体证书报考条件、学分要求、招生政策等可能因学校和年份变动的内容，提醒学生以当年官方文件为准。',
  '',
  '【课程知识库】'
].join('\n');

const EXAM_SYSTEM_PROMPT = [
  '你是"会小导"，会计学专业导论课程的 AI 学习助教，正在为学生生成考核后的个性化学习诊断。',
  '',
  '要求：',
  '1. 结构固定为四段，每段用小标题：【薄弱环节分析】【下一步行动清单】【本周学习安排】【课程建议】。',
  '2. 诊断要基于学生给出的四维得分和错题，点名具体知识点，不要泛泛而谈"要努力学习"。',
  '3. 行动清单给 3-5 条，每条都要具体可执行（做什么、做多少、什么时候）。',
  '4. 总长度 500 字以内，用 Markdown 组织，不要客套开场白。',
  '5. 如果四个维度都达标，就转向更高阶的学习建议（竞赛、证书、科研、AI 工具实践），不要硬造薄弱点。'
].join('\n');

/* ---------- 调用大模型 ---------- */
async function callLLM(cfg, messages, timeoutMs) {
  const url = cfg.baseUrl + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs || 45000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model, messages: messages, temperature: 0.6, max_tokens: 1200, stream: false }),
      signal: controller.signal
    });
    const raw = await res.text();
    if (res.status !== 200) throw new Error('模型服务返回 ' + res.status + '：' + raw.slice(0, 300));
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { throw new Error('模型返回解析失败：' + raw.slice(0, 200)); }
    const text = parsed.choices && parsed.choices[0] && parsed.choices[0].message ? parsed.choices[0].message.content : '';
    if (!text) throw new Error('模型返回内容为空');
    return String(text);
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('模型响应超时');
    throw e;
  } finally { clearTimeout(timer); }
}

/* ---------- 响应工具 ---------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Teacher-Key',
  'Access-Control-Max-Age': '86400'
};

function json(code, obj) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
function jsonSec(code, obj) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS)
  });
}
function text(code, msg) {
  return new Response(msg, { status: code, headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS) });
}

function authOk(request, cfg) {
  if (!cfg.teacherKey) return false;
  const h = request.headers.get('X-Teacher-Key') || '';
  return h.length > 0 && h === cfg.teacherKey;
}

/* ---------- 路由 ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    const cfg = {
      apiKey: readEnv(env, 'LLM_API_KEY', ''),
      baseUrl: String(readEnv(env, 'LLM_BASE_URL', 'https://api.deepseek.com/v1')).replace(/\/+$/, ''),
      model: readEnv(env, 'LLM_MODEL', 'deepseek-chat'),
      teacherKey: readEnv(env, 'TEACHER_KEY', '')
    };
    const CONFIGURED = Boolean(cfg.apiKey);
    const db = (env && env.DB) || null;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    /* --- 引擎状态 --- */
    if (p === '/api/config' && request.method === 'GET') {
      return jsonSec(200, { configured: CONFIGURED, model: CONFIGURED ? cfg.model : null });
    }

    /* --- 智能问答 --- */
    if (p === '/api/chat' && request.method === 'POST') {
      let payload;
      try { payload = await request.json(); } catch (e) { return jsonSec(400, { error: '请求体不是合法 JSON' }); }
      if (!payload || typeof payload !== 'object') return jsonSec(400, { error: '请求体不是合法 JSON' });
      const question = String(payload.question || '').trim();
      if (!question) return jsonSec(400, { error: '问题不能为空' });
      if (question.length > 500) return jsonSec(400, { error: '问题过长' });
      if (!CONFIGURED) return jsonSec(503, { error: '服务端未配置 LLM_API_KEY' });

      const hits = retrieve(question, 3);
      const context = buildContext(hits);
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT + (context ? '\n\n' + context : '\n\n（本轮未命中知识库节点，请依据通用会计知识回答，并提示学生可从四课次配套资源中查找对应知识点。）') },
        { role: 'user', content: question }
      ];
      try {
        const answer = await callLLM(cfg, messages);
        return jsonSec(200, { answer: answer, grounded: hits.map(function (h) { return h.node.k; }) });
      } catch (e) {
        return jsonSec(502, { error: '模型调用失败：' + e.message });
      }
    }

    /* --- 考核诊断 --- */
    if (p === '/api/exam' && request.method === 'POST') {
      let payload;
      try { payload = await request.json(); } catch (e) { return jsonSec(400, { error: '请求体不是合法 JSON' }); }
      if (!payload || typeof payload !== 'object') return jsonSec(400, { error: '请求体不是合法 JSON' });
      if (!CONFIGURED) return jsonSec(503, { error: '服务端未配置 LLM_API_KEY' });

      const dims = payload.dims || {};
      const mistakes = Array.isArray(payload.mistakes) ? payload.mistakes.slice(0, 20) : [];
      const weak = String(payload.weak || '');
      const lines = [
        '四维得分：知识 ' + (dims['知识'] || 0) + '%、能力 ' + (dims['能力'] || 0) + '%、素养 ' + (dims['素养'] || 0) + '%、规划 ' + (dims['规划'] || 0) + '%。',
        '最薄弱维度：' + (weak || '无') + '。'
      ];
      if (mistakes.length) { lines.push('错题记录：'); for (const m of mistakes) lines.push('- ' + m); }
      else { lines.push('本次无错题。'); }

      try {
        const diagnosis = await callLLM(cfg, [
          { role: 'system', content: EXAM_SYSTEM_PROMPT },
          { role: 'user', content: lines.join('\n') }
        ]);
        return jsonSec(200, { diagnosis: diagnosis });
      } catch (e) {
        return jsonSec(502, { error: '模型调用失败：' + e.message });
      }
    }

    /* --- 上报一次考核成绩（仅汇总行，不含个人作答明细） --- */
    if (p === '/api/report' && request.method === 'POST') {
      let payload;
      try { payload = await request.json(); } catch (e) { return jsonSec(400, { error: '请求体不是合法 JSON' }); }
      if (!payload || typeof payload !== 'object') return jsonSec(400, { error: '请求体不是合法 JSON' });
      if (!db) return jsonSec(503, { error: '未绑定数据库 D1' });

      const sid = String(payload.sid || '').trim();
      const name = String(payload.name || '').trim();
      if (!sid) return jsonSec(400, { error: '缺少学号 sid' });
      if (sid.length > 32 || name.length > 32) return jsonSec(400, { error: '学号或姓名过长' });

      const score = clampNum(payload.score, 0, 1000);
      const total = clampNum(payload.total, 1, 1000);
      const dims = payload.dims || {};
      const wrong = clampNum(payload.wrong, 0, 1000);

      // 按「学号 + 日期」去重：同一天重复交卷只保留最后一次
      const date = String(payload.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonSec(400, { error: '日期格式应为 YYYY-MM-DD' });

      try {
        await db.prepare(
          'INSERT INTO reports (sid,name,score,total,d_knowledge,d_ability,d_literacy,d_planning,wrong,date,ts) ' +
          'VALUES (?,?,?,?,?,?,?,?,?,?,?) ' +
          'ON CONFLICT(sid,date) DO UPDATE SET ' +
          'name=excluded.name,score=excluded.score,total=excluded.total,' +
          'd_knowledge=excluded.d_knowledge,d_ability=excluded.d_ability,' +
          'd_literacy=excluded.d_literacy,d_planning=excluded.d_planning,' +
          'wrong=excluded.wrong,ts=excluded.ts'
        ).bind(
          sid, name, score, total,
          clampNum(dims['知识'], 0, 100), clampNum(dims['能力'], 0, 100),
          clampNum(dims['素养'], 0, 100), clampNum(dims['规划'], 0, 100),
          wrong, date, Date.now()
        ).run();
        return jsonSec(200, { ok: true });
      } catch (e) {
        return jsonSec(500, { error: '写入失败：' + String(e.message || e).slice(0, 200) });
      }
    }

    /* --- 教师看板：登录校验 --- */
    if (p === '/api/teacher' && request.method === 'POST') {
      let payload;
      try { payload = await request.json(); } catch (e) { return jsonSec(400, { error: '请求体不是合法 JSON' }); }
      const k = String((payload && payload.key) || '');
      if (!cfg.teacherKey) return jsonSec(503, { error: '服务端未设置 TEACHER_KEY' });
      if (k !== cfg.teacherKey) return jsonSec(401, { error: '口令不正确' });
      return jsonSec(200, { ok: true });
    }

    /* --- 教师看板：统计数据（需口令） --- */
    if (p === '/api/teacher/stats' && request.method === 'GET') {
      if (!authOk(request, cfg)) return jsonSec(401, { error: '口令不正确' });
      if (!db) return jsonSec(503, { error: '未绑定数据库 D1' });

      try {
        // 各日期的提交情况与四维均分
        const byDate = await db.prepare(
          'SELECT date, COUNT(*) AS n, ROUND(AVG(score*100.0/total)) AS avg_rate, ' +
          'ROUND(AVG(d_knowledge)) AS k, ROUND(AVG(d_ability)) AS a, ' +
          'ROUND(AVG(d_literacy)) AS l, ROUND(AVG(d_planning)) AS p ' +
          'FROM reports GROUP BY date ORDER BY date'
        ).all();

        // 学生名单（去重，取最新一次）
        const students = await db.prepare(
          'SELECT sid, name, score, total, ROUND(score*100.0/total) AS rate, ' +
          'd_knowledge AS k, d_ability AS a, d_literacy AS l, d_planning AS p, date ' +
          'FROM reports ORDER BY rate ASC'
        ).all();

        const rows = (byDate.results) || [];
        const stus = (students.results) || [];

        // 分数段分布（按最后一次成绩）
        const bands = [
          { label: '90分以上', min: 90, max: 101, n: 0 },
          { label: '80-89', min: 80, max: 90, n: 0 },
          { label: '70-79', min: 70, max: 80, n: 0 },
          { label: '60-69', min: 60, max: 70, n: 0 },
          { label: '60分以下', min: 0, max: 60, n: 0 }
        ];
        stus.forEach(function (s) {
          const r = Number(s.rate) || 0;
          for (let i = 0; i < bands.length; i++) {
            if (r >= bands[i].min && r < bands[i].max) { bands[i].n++; break; }
          }
        });

        // 四维整体均分
        const dimAvg = { 知识: 0, 能力: 0, 素养: 0, 规划: 0 };
        if (stus.length) {
          dimAvg.知识 = Math.round(stus.reduce(function (s, x) { return s + (Number(x.k) || 0); }, 0) / stus.length);
          dimAvg.能力 = Math.round(stus.reduce(function (s, x) { return s + (Number(x.a) || 0); }, 0) / stus.length);
          dimAvg.素养 = Math.round(stus.reduce(function (s, x) { return s + (Number(x.l) || 0); }, 0) / stus.length);
          dimAvg.规划 = Math.round(stus.reduce(function (s, x) { return s + (Number(x.p) || 0); }, 0) / stus.length);
        }

        return jsonSec(200, {
          totalStudents: stus.length,
          totalRecords: (await db.prepare('SELECT COUNT(*) AS n FROM reports').first()).n,
          byDate: rows,
          students: stus,
          bands: bands,
          dimAvg: dimAvg
        });
      } catch (e) {
        return jsonSec(500, { error: '查询失败：' + String(e.message || e).slice(0, 200) });
      }
    }

    /* --- 教师看板：导出 CSV --- */
    if (p === '/api/teacher/export' && request.method === 'GET') {
      if (!authOk(request, cfg)) return text(401, '口令不正确');
      if (!db) return text(503, '未绑定数据库 D1');
      try {
        const res = await db.prepare(
          'SELECT date,sid,name,score,total,ROUND(score*100.0/total) AS rate,' +
          'd_knowledge,d_ability,d_literacy,d_planning,wrong FROM reports ORDER BY date DESC, sid'
        ).all();
        const head = '日期,学号,姓名,答对,总题,正确率%,知识%,能力%,素养%,规划%,错题数';
        const lines = [(res.results || []).map(function (r) {
          return [r.date, r.sid, r.name, r.score, r.total, r.rate, r.d_knowledge, r.d_ability, r.d_literacy, r.d_planning, r.wrong].join(',');
        }).join('\n')];
        const csv = head + '\n' + lines[0];
        return new Response('\ufeff' + csv, {
          headers: Object.assign({
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="class-report.csv"'
          }, CORS)
        });
      } catch (e) {
        return text(500, '导出失败：' + String(e.message || e).slice(0, 200));
      }
    }

    /* --- 健康检查 --- */
    if (p === '/' || p === '/health') {
      return jsonSec(200, { ok: true, service: '会小导 · 智能引擎', configured: CONFIGURED, hasDb: Boolean(db) });
    }

    return text(404, '404 Not Found');
  }
};

function clampNum(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}