-- 会小导 · 学情成绩汇总表
-- 只存一行汇总：某学号在某次考核的分数与四维得分
-- 不存个人作答明细、不存浏览行为、不存 AI 提问内容
CREATE TABLE IF NOT EXISTS reports (
  sid         TEXT NOT NULL,                -- 学号
  name        TEXT NOT NULL DEFAULT '',    -- 姓名
  score       INTEGER NOT NULL DEFAULT 0,  -- 答对题数
  total       INTEGER NOT NULL DEFAULT 1,  -- 总题数
  d_knowledge REAL    NOT NULL DEFAULT 0,  -- 知识维度得分
  d_ability  REAL    NOT NULL DEFAULT 0,  -- 能力维度得分
  d_literacy REAL    NOT NULL DEFAULT 0,  -- 素养维度得分
  d_planning REAL    NOT NULL DEFAULT 0,  -- 规划维度得分
  wrong       INTEGER NOT NULL DEFAULT 0,  -- 错题数
  date        TEXT    NOT NULL,            -- 考核日期 YYYY-MM-DD
  ts          INTEGER NOT NULL DEFAULT 0,  -- 上报时间戳（毫秒）
  PRIMARY KEY (sid, date)
);

CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(date);