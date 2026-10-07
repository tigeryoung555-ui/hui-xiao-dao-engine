/* =============================================================
   D1 mock —— 供 _test_worker.mjs 的学情接口测试使用
   模拟 Cloudflare D1 的 prepare().bind().run() / .all() / .first()
   数据存在内存数组里，行为对齐真实 D1：
     · INSERT ... ON CONFLICT(sid,date) DO UPDATE  按主键覆盖
     · SELECT 的字段别名、ORDER BY、GITHUB 聚合按简单规则处理
   ============================================================= */

function makeD1(seed) {
  const rows = (seed || []).map(r => Object.assign({}, r));

  // 从 SQL 里抽出目标表（只处理 reports）
  function tableOf(sql) {
    const m = String(sql).match(/\b(?:into|from)\s+([a-z_][a-z0-9_]*)/i);
    return m ? m[1].toLowerCase() : '';
  }

  // 极简 SELECT 列解析：只处理 "SELECT a,b,c AS x FROM" 或 "SELECT COUNT(*) AS n"
  function colsOf(sql) {
    const m = String(sql).match(/select\s+([\s\S]*?)\s+from\s/i);
    if (!m) return null;
    return m[1].split(',').map(s => s.trim()).filter(Boolean).map(c => {
      const am = c.match(/\s+as\s+([a-z0-9_]+)$/i);
      if (am) return { expr: c.replace(/\s+as\s+[a-z0-9_]+$/i, ''), alias: am[1] };
      return { expr: c, alias: c };
    });
  }

  function evalCol(row, col) {
    let expr = String(col.expr || '').trim();
    let out = row;
    // COUNT(*) AS n
    let m = expr.match(/count\s*\(\s*\*\s*\)/i);
    if (m) return { n: row.__count };
    // ROUND(score*100.0/total) AS rate
    m = expr.match(/round\s*\(\s*([a-z0-9_]+)\s*\*\s*([\d.]+)\s*\/\s*([a-z0-9_]+)\s*\)/i);
    if (m) {
      const v = Number(row[m[1]]) * Number(m[2]) / (Number(row[m[3]]) || 1);
      return { v: Math.round(v) };
    }
    // AVG(x) AS y —— 聚合在外层处理，这里给不到
    m = expr.match(/^([a-z0-9_]+)$/i);
    if (m) {
      const v = row[m[1]];
      return { [col.alias]: v === undefined ? null : v };
    }
    return { [col.alias]: null };
  }

  function selectRows(sql, bound) {
    const isAgg = /\bgroup\s+by\b/i.test(sql);
    const cols = colsOf(sql);
    let out;

    if (isAgg) {
      // GROUP BY date
      const g = new Map();
      rows.forEach(r => {
        const key = r.date;
        if (!g.has(key)) g.set(key, []);
        g.get(key).push(r);
      });
      out = [];
      g.forEach((group, date) => {
        const rec = { date: date };
        (cols || []).forEach(c => {
          // 顺序要紧：先判ROUND(AVG(x*y/z)) 这种带内层表达式的，
          // 否则会被下面宽松的 AVG(x) 分支抢先匹配掉，别名也会丢。
          const rm = String(c.expr).match(/^\s*round\s*\(\s*avg\s*\(\s*([a-z0-9_]+)\s*\*\s*([\d.]+)\s*\/\s*([a-z0-9_]+)\s*\)\s*\)/i);
          if (rm) {
            const key = String(c.expr).match(/\s+as\s+([a-z0-9_]+)$/i);
            const alias = c.alias || (key ? key[1] : 'rate');
            const avg = group.reduce((s, r) =>
              s + ((Number(r[rm[1]]) || 0) * Number(rm[2]) / (Number(r[rm[3]]) || 1)), 0) / group.length;
            rec[alias] = Math.round(avg);
            return;
          }
          const cm2 = String(c.expr).match(/count\s*\(\s*\*\s*\)/i);
          if (cm2) {
            rec[c.alias || 'n'] = group.length;
            return;
          }
          // ROUND(AVG(x)) AS k —— 外层套了ROUND，别名在 AS 后面
          const am = String(c.expr).match(/^\s*round\s*\(\s*avg\s*\(\s*([a-z0-9_]+)\s*\)\s*\)\s*$/i);
          if (am) {
            const avg = group.reduce((s, r) => s + (Number(r[am[1]]) || 0), 0) / group.length;
            rec[c.alias || am[1]] = Math.round(avg);
            return;
          }
          const cm = String(c.expr).match(/^\s*avg\s*\(\s*([a-z0-9_]+)\s*\)\s*$/i);
          if (cm) {
            const avg = group.reduce((s, r) => s + (Number(r[cm[1]]) || 0), 0) / group.length;
            rec[c.alias || cm[1]] = Math.round(avg);
            return;
          }
          rec[c.alias] = date;
        });
        out.push(rec);
      });
    } else {
      let sel = rows.slice();
      // ORDER BY rate ASC | date DESC, sid
      const om = String(sql).match(/order\s+by\s+([\s\S]+)$/i);
      if (om) {
        const keys = om[1].split(',').map(s => s.trim()).filter(Boolean).map(s => {
          const dm = s.match(/^([a-z0-9_]+)\s+(asc|desc)$/i);
          if (dm) return { k: dm[1].toLowerCase(), desc: /desc/i.test(dm[2]) };
          return { k: s.toLowerCase(), desc: false };
        });
        sel.sort((a, b) => {
          for (const kk of keys) {
            let av, bv;
            const isRate = kk.k === 'rate' || kk.k === 'avg_rate';
            if (isRate) {
              av = Math.round((Number(a.score) * 100) / (Number(a.total) || 1));
              bv = Math.round((Number(b.score) * 100) / (Number(b.total) || 1));
            } else {
              av = a[kk.k]; bv = b[kk.k];
            }
            if (av === bv) continue;
            const r = av > bv ? 1 : -1;
            return kk.desc ? -r : r;
          }
          return 0;
        });
      }
      out = sel.map(r => {
        const rec = {};
        (cols || ['sid', 'name', 'score', 'total', 'date']).forEach(c => {
          if (typeof c === 'string') { rec[c] = r[c]; return; }
          const val = evalCol(r, c);
          if (val && Object.keys(val).length === 1 && val.n !== undefined) rec[c.alias] = val.n;
          else if (val && val.v !== undefined) rec[c.alias] = val.v;
          else if (val) { Object.keys(val).forEach(kk => { rec[c.alias] = val[kk]; }); }
        });
        return rec;
      });
    }
    return out;
  }

  return {
    __rows: rows,
    prepare(sql) {
      const s = String(sql);
      return {
        sql: s,
        bind(...vals) {
          return {
            sql: s,
            _vals: vals,
            async run() {
              const t = tableOf(s);
              if (t !== 'reports') return { success: true, meta: { changes: 0 } };
              // INSERT
              if (/^\s*insert/i.test(s)) {
                const cols = (s.match(/\(([^)]+)\)\s*values/i) || [, ''])[1]
                  .split(',').map(x => x.trim()).filter(Boolean);
                const row = {};
                cols.forEach((c, i) => { row[c] = vals[i]; });
                const idx = rows.findIndex(r => r.sid === row.sid && r.date === row.date);
                if (idx >= 0) {
                  // ON CONFLICT DO UPDATE：保留 sid/date，覆盖其余字段
                  Object.keys(row).forEach(k => {
                    if (k === 'sid' || k === 'date') return;
                    rows[idx][k] = row[k];
                  });
                  return { success: true, meta: { changes: 1 } };
                }
                rows.push(row);
                return { success: true, meta: { changes: 1 } };
              }
              return { success: true, meta: { changes: 0 } };
            },
            async all() {
              if (/^\s*select/i.test(s)) return { success: true, results: selectRows(s, vals) };
              return { success: true, results: [] };
            },
            async first() {
              if (/count\s*\(\s*\*\s*\)/i.test(s)) return { n: rows.length };
              const rs = selectRows(s, vals);
              return rs.length ? rs[0] : null;
            }
          };
        },
        async all() { return { success: true, results: selectRows(s, []) }; },
        async first() {
          if (/count\s*\(\s*\*\s*\)/i.test(s)) return { n: rows.length };
          const rs = selectRows(s, []);
          return rs.length ? rs[0] : null;
        },
        async run() { return { success: true, meta: { changes: 0 } }; }
      };
    }
  };
}

module.exports = { makeD1 };