# 会小导 · 智能引擎后端

会计学专业导论 AI 学习平台的**后端服务**。零外部依赖，只用 Node 内置模块。

前端（GitHub Pages 静态托管）通过 HTTP 调用本服务，获得大模型问答与考核诊断能力。

---

## 快速开始

```bash
# 1. 设密钥
export LLM_API_KEY="sk-你的密钥"

# 2. 启动
node server.js

# 3. 访问
#    http://localhost:8000
```

Windows（CMD）：
```cmd
set LLM_API_KEY=sk-你的密钥
node server.js
```

启动后页面右上角会显示 `● 智能引擎已连接（模型名）`。

---

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `LLM_API_KEY` | 是 | — | 模型密钥。仅存在于服务端，不下发浏览器 |
| `LLM_BASE_URL` | 否 | `https://api.deepseek.com/v1` | 任何 OpenAI 兼容端点 |
| `LLM_MODEL` | 否 | `deepseek-chat` | 模型名 |
| `PORT` | 否 | `8000` | 监听端口（平台会自动注入） |

### 切换服务商

```bash
# 腾讯混元
LLM_BASE_URL="https://api.hunyuan.cloud.tencent.com/v1" LLM_MODEL="hunyuan-turbo"

# 阿里通义
LLM_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1" LLM_MODEL="qwen-plus"

# 月之暗面
LLM_BASE_URL="https://api.moonshot.cn/v1" LLM_MODEL="moonshot-v1-8k"
```

---

## 部署

### Render / Railway / Zeabur

| 配置项 | 值 |
|---|---|
| Build Command | `npm install`（零依赖，留空亦可） |
| Start Command | `node server.js` |
| Environment | `LLM_API_KEY` = 你的密钥（勾 Secret） |

部署完成后，把 `https://你的服务域名` 填到前端即可（打开页面点右上角状态标识，或用 `?api=` 参数）。

### 容器

项目零依赖，直接用官方 Node 镜像：

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=8000
EXPOSE 8000
CMD ["node", "server.js"]
```

---

## 接口

### `GET /api/config`

```json
{ "configured": true, "model": "deepseek-chat" }
```

`configured: false` 表示未配置密钥，此时前端自动降级到内置离线知识库。

### `POST /api/chat`

```json
// 请求
{ "question": "会计等式是什么？", "history": [] }

// 响应
{
  "answer": "## 会计等式\n\n- **静态**：资产＝负债＋所有者权益\n...",
  "grounded": ["会计等式", "借贷规则"]
}
```

`grounded` 是本次回答所依据的知识库节点，前端会渲染为「依据知识库：…」。

### `POST /api/exam`

```json
// 请求
{
  "dims": { "知识": 45, "能力": 85, "素养": 75, "规划": 90 },
  "weak": "知识",
  "mistakes": ["会计循环的正确顺序是？"]
}

// 响应
{ "diagnosis": "【薄弱环节分析】\n\n..." }
```

诊断固定四段结构：薄弱环节分析 / 下一步行动清单 / 本周学习安排 / 课程建议。

### 错误码

| 状态码 | 含义 | 前端行为 |
|---|---|---|
| 200 | 正常 | 展示模型回答 |
| 400 | 参数非法（空问题、超长、非法 JSON） | 降级离线 |
| 503 | 服务端未配置 `LLM_API_KEY` | 降级离线 |
| 502 | 模型调用失败或超时 | 降级离线 |

所有失败路径前端均自动降级到离线知识库，不会出现白屏。

---

## RAG 设计

不是把问题直接丢给模型，而是**先检索、后生成**：

```
学生问题
  ↓ 关键词打分（命中字长累加 + 标题整体命中加权 10分）
取 Top 3 知识库节点
  ↓
节点正文作为「参考材料」+ 教学系统提示词
  ↓
大模型组织语言、推理、扩展
  ↓
答案 + 依据节点清单
```

### 系统提示词约束

1. 优先依据知识库作答，末尾标注对应 OBE 编号
2. 知识库未覆盖时用通用知识补足，但必须区分「知识库结论」与「补充说明」
3. 语气亲切、给可执行步骤，不说空话套话
4. 职业道德与法规红线问题立场明确，不给规避监管的建议
5. Markdown 组织，400 字以内（移动端阅读）
6. 不复述问题，不写「根据参考资料」这类无信息量的话
7. 报考条件、学分要求等易变内容，提醒以当年官方文件为准

考核诊断另有独立提示词，固定四段结构，并明确要求**四维全达标时不得硬造薄弱点**。

---

## 知识库

`KB` 常量（19 个节点）与前端 `index.html` 的 `KB` 数组保持同步。

> **修改题库时必须两处都改**，否则离线降级与在线回答会不一致。

节点结构：
```js
{ k: '节点标题', keys: ['检索关键词'], a: '答案正文', obe: '成果达成度编号' }
```

`keys` 决定能否被检索命中，漏了关键词会导致该节点永远答不出来。

---

## 测试

```bash
node _test_server.js    # 后端 42 项：接口、RAG、目录穿越防护、输入校验
```

覆盖场景：
- 未配置密钥时如实返回 503，且 `/api/config` 不泄露任何敏感信息
- RAG 检索命中正确节点，系统提示词确实注入了知识库材料
- 模型服务返回 5xx 时转成 502 供前端降级
- 目录穿越（`%2e%2e`、双层编码）被拦截
- `server.js`、`package.json`、隐藏文件不可通过 HTTP 下载

---

## 安全

- API Key 只存在于服务端环境变量，不写入任何前端文件
- `server.js` / `package.json` / dotfile 已列入禁止下载名单
- 目录穿越防护：`decodeURIComponent` + `path.posix.normalize` + `resolve` 后校验根目录前缀
- 请求体大小、问题长度有限制
- `.gitignore` 已排除 `.env*`，防止密钥误提交
- CORS 允许任意来源（前端托管在 GitHub Pages，需跨域调用）

> CORS 开放意味着任何人拿到你的服务地址都能调用。若需限制，请在网关层加域名白名单。