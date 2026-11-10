// wishos-plan-book / plugin.js — 计划任务书（文档态计划）独立插件
//
// 三件事，全部可离线自证：
//   1. 运行时注册 1 个技能 `plan-book`（正文读自 skills/plan-book/SKILL.md，
//      references/ 不注入、按需读 —— resourceBase 指向技能目录）
//   2. 注册 3 个工具：plan_book_check / plan_book_new / plan_book_health
//   3. 结构判据与 Python 参考实现 `_plan4-check.py` 同源（四键分列 + 行内非空 + 总门禁在册），
//      另加两项本插件自己的诚实位：
//        · placeholders —— 骨架占位符计数：结构过关 ≠ 实质填好
//        · reasonKind   —— 区分「缺表」与「表里缺键」，防把好文档误诊成坏表
//
// 只读纪律：check/health 不写任何文件；只有 plan_book_new 写盘，且默认拒绝覆盖已存在文件。
// 卸载即回到拆解前状态（不写预设、不改 profile 配置）。

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'wishos-plan-book';
export const inject = ['skills', 'tools'];

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(HERE, 'skills');
const MANIFEST = join(HERE, 'skills.manifest.json');

// ─────────────────────────── 结构判据（与 Python 参考实现同源） ───────────────────────────

const KEY_ALIASES = {
  depends_on: ['依赖', 'depends_on'],
  parallel_with: ['可并行', 'parallel_with'],
  done_when: ['完成判定', 'done_when'],
  gate: ['门禁', 'gate'],
};
const KEY_ORDER = ['depends_on', 'parallel_with', 'done_when', 'gate'];
const KEY_LABEL = { depends_on: '前置依赖', parallel_with: '可并行', done_when: '完成判定', gate: '推进门禁' };
const SEP_RE = /^:?-{2,}:?$/;
const PLACEHOLDER_RES = [/⟨[^⟩]{0,120}⟩/g, /待填/g, /\bTODO\b/g, /\bTBD\b/g];

/** Markdown 管道表 → 单元格数组；非表格行返回 null（与 Python `_cells` 同义） */
function splitCells(line) {
  const s = String(line).trim();
  if (!s.startsWith('|')) return null;
  const body = s.replace(/^\|+/, '').replace(/\|+$/, '');
  return body.split('|').map((c) => c.trim());
}

/** 分隔行（|---|:--:|） */
function isSeparator(cells) {
  return cells.every((c) => c === '' || SEP_RE.test(c));
}

/** 表头 → {key: 列号}；四键必须落在 4 个**不同**列，否则 null（防「一格里写四个词」假阳性） */
function columnIndex(header) {
  const idx = {};
  for (const [key, aliases] of Object.entries(KEY_ALIASES)) {
    for (let i = 0; i < header.length; i += 1) {
      if (aliases.some((a) => header[i].includes(a))) {
        idx[key] = i;
        break;
      }
    }
  }
  if (Object.keys(idx).length !== 4) return null;
  if (new Set(Object.values(idx)).size !== 4) return null;
  return idx;
}

function countPlaceholders(text) {
  let n = 0;
  for (const re of PLACEHOLDER_RES) {
    const hits = String(text).match(re);
    if (hits) n += hits.length;
  }
  return n;
}

/**
 * 分析一份任务书文本。
 * @returns {{status:'extractable'|'not_extractable', ok:boolean, reasonKind:string,
 *            reason:string, headerLine:number|null, rows:number, columns:object|null,
 *            missing:Array, empty:Array, totalGateLines:number[], placeholders:number}}
 */
export function analyzeText(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  const placeholders = countPlaceholders(text);

  let header = null;
  let headerAt = null;
  let rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cells = splitCells(lines[i]);
    if (!cells) continue;
    const idx = columnIndex(cells);
    if (!idx) continue;
    header = cells;
    headerAt = i;
    rows = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const r = splitCells(lines[j]);
      if (r === null) break;
      if (isSeparator(r)) continue;
      rows.push({ line: j + 1, cells: r });
    }
    break;
  }

  const totalGateLines = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes('total_gate') || lines[i].includes('总门禁')) totalGateLines.push(i + 1);
  }

  if (header === null) {
    return {
      status: 'not_extractable',
      ok: false,
      reasonKind: 'no_table',
      reason: '未找到「表头同时含 依赖/可并行/完成判定/门禁 四键且分列」的表',
      headerLine: null,
      rows: 0,
      columns: null,
      missing: [],
      empty: [],
      totalGateLines,
      placeholders,
    };
  }

  const idx = columnIndex(header);
  const columnNames = {};
  for (const key of KEY_ORDER) columnNames[key] = header[idx[key]];

  const missing = [];
  const empty = [];
  for (const row of rows) {
    for (const key of KEY_ORDER) {
      const ci = idx[key];
      if (ci >= row.cells.length) missing.push({ line: row.line, key, label: KEY_LABEL[key] });
      else if (row.cells[ci] === '') empty.push({ line: row.line, key, label: KEY_LABEL[key] });
    }
  }

  const problems = [];
  if (missing.length) problems.push(`缺键 ${missing.length} 处`);
  if (empty.length) problems.push(`空格 ${empty.length} 处`);
  if (totalGateLines.length === 0) problems.push('无总门禁声明');
  const ok = problems.length === 0;

  return {
    status: ok ? 'extractable' : 'not_extractable',
    ok,
    reasonKind: ok ? 'ok' : problems.join(' · '),
    reason: ok ? '四要素可机械提取' : problems.join(' · '),
    headerLine: headerAt + 1,
    rows: rows.length,
    columns: columnNames,
    missing,
    empty,
    totalGateLines,
    placeholders,
  };
}

/** 校验一个文件（不写盘）；status: extractable | not_extractable | unreadable */
export function checkFile(filePath) {
  const abs = resolve(String(filePath ?? ''));
  let st;
  try {
    st = statSync(abs);
  } catch {
    return { path: abs, ok: false, status: 'unreadable', error: '文件不可读（不存在或无权限）', analysis: null };
  }
  if (!st.isFile()) {
    return { path: abs, ok: false, status: 'unreadable', error: '不是文件（目录？）', analysis: null };
  }
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (error) {
    return { path: abs, ok: false, status: 'unreadable', error: '读取失败: ' + String(error), analysis: null };
  }
  const analysis = analyzeText(text);
  // 诚实位：结构过关但仍有占位符 ⇒ 单独标出，禁止据此宣称「任务书完成」
  if (analysis.ok && analysis.placeholders > 0) {
    return {
      path: abs,
      ok: true,
      status: 'extractable_with_placeholders',
      bytes: Buffer.byteLength(text, 'utf8'),
      error: null,
      analysis,
    };
  }
  return {
    path: abs,
    ok: analysis.ok,
    status: analysis.ok ? 'extractable' : 'not_extractable',
    bytes: Buffer.byteLength(text, 'utf8'),
    error: null,
    analysis,
  };
}

// ───────────────────────────────── 任务书骨架生成 ─────────────────────────────────

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 生成任务书骨架正文。要求：生成件自身必须过 analyzeText（结构自洽）。
 * @param {{title?:string, planId?:string, date?:string, batches?:number,
 *          executionLog?:string, scope?:string, redlines?:string}} spec
 */
export function buildTaskBook(spec = {}) {
  const title = String(spec.title ?? '⟨任务书标题⟩').trim() || '⟨任务书标题⟩';
  const planId = String(spec.planId ?? '⟨plan-id⟩').trim() || '⟨plan-id⟩';
  const date = String(spec.date ?? todayStamp()).trim();
  let batches = Number.parseInt(String(spec.batches ?? 3), 10);
  if (!Number.isFinite(batches)) batches = 3;
  batches = Math.max(1, Math.min(batches, 30));
  const executionLog = String(spec.executionLog ?? '⟨同名-执行记录.md⟩').trim();
  const scope = String(spec.scope ?? '⟨本任务书覆盖什么、不覆盖什么⟩').trim();
  const redlines = String(spec.redlines ?? '正本只读 · 不就地改计划 · 不引入新依赖').trim();

  const rowLines = [];
  for (let i = 1; i <= batches; i += 1) {
    const dep = i === 1 ? '—' : `B${i - 1}`;
    rowLines.push(
      `| **B${i}** | ⟨批次 ${i} 名称⟩ | ${dep} | — | 完成判定：⟨文件路径 + 客观读数（阈值/退码/计数）⟩ | 门禁：不满足 ⇒ 回退修补 1 次 → 仍失败 → 挂起待人工确认 |`,
    );
  }

  return `---
title: "${title}"
plan_id: "${planId}"
type: 计划任务书（文档态计划）
version: v1.0
date: ${date}
status: 草案 · 待批红
frozen: false
execution_log: "${executionLog}"
scope: ${scope}
redlines: ${redlines}
---

# ${title}

> **一句话**：⟨这份任务书要达成什么，一行说完⟩
> **纪律**：计划本体冻结 —— 批红后不就地打勾改字；进度/实绩/偏差一律记 \`${executionLog}\`。
> **口径变更**：起新版本（v1.1），旧版保留可对账。

## 一 · 目标与不做什么

- **目标**：⟨可验收的目标⟩
- **不做**：⟨明确排除项⟩

## 二 · 前置（只读事实基线）

| 项 | 值 |
|:--|:--|
| 依据 | ⟨设计稿 / 评估报告路径 + 日期⟩ |
| 落点 | ⟨产物目录⟩ |
| 现状 | ⟨实测读数，不写"大概">⟩ |

## 三 · 批次计划（四要素）

| ID | 批次 | 依赖 | 可并行 | 完成判定 | 门禁 |
|:--|:--|:--|:--|:--|:--|
${rowLines.join('\n')}

## 总门禁（total_gate）

\`\`\`text
plan_book_check "<本文件路径>"      # 须 status=extractable 且 placeholders=0
⟨机器可判命令⟩                       # 退码 0
用户批红 + 验收签字
\`\`\`

## 四 · 风险与回退

| 风险 | 触发信号 | 回退 |
|:--|:--|:--|
| ⟨风险⟩ | ⟨可观测信号⟩ | ⟨动作⟩ |

## 五 · 明确不做（本批）

- ⟨排除项逐条⟩

## 六 · 验收与签字

| 项 | 判据 |
|:--|:--|
| 机器 | 总门禁全退码 0；各批完成判定逐条复跑一致 |
| 人工 | ⟨谁签字、签什么⟩ |
`;
}

export function writeTaskBook(filePath, spec = {}) {
  const abs = resolve(String(filePath ?? ''));
  const force = spec.force === true;
  if (!abs.toLowerCase().endsWith('.md')) {
    return { ok: false, path: abs, error: '路径须以 .md 结尾' };
  }
  if (existsSync(abs) && !force) {
    return { ok: false, path: abs, error: '文件已存在；如确需覆盖请传 force=true（计划件不鼓励覆盖，升版更安全）' };
  }
  const content = buildTaskBook(spec);
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  } catch (error) {
    return { ok: false, path: abs, error: '写入失败: ' + String(error) };
  }
  const check = checkFile(abs);
  return {
    ok: true,
    path: abs,
    bytes: Buffer.byteLength(content, 'utf8'),
    executionLog: spec.executionLog ?? null,
    check,
  };
}

// ─────────────────────────────────── 三夹具自证 ───────────────────────────────────

const FIXTURES = {
  pos: [
    '# 计划',
    '',
    '| 批 | 依赖 | 可并行 | 完成判定 | 门禁 |',
    '|:--|:--|:--|:--|:--|',
    '| B0 | — | — | 产出 `a.md` | 不通过 → 挂起 |',
    '| B1 | B0 | — | 计数 = 3 | 缺件 → 回退 1 次 |',
    '',
    '**总门禁（total_gate）**：脚本退码 0',
  ].join('\n'),
  neg: [
    '# 计划',
    '',
    '| 批 | 依赖 | 可并行 | 完成判定 | 门禁 |',
    '|:--|:--|:--|:--|:--|',
    '| B0 | — | — | 产出 `a.md` | 不通过 → 挂起 |',
    '| B1 | B0 | — | 计数 = 3 |  |',
    '',
    '**总门禁（total_gate）**：脚本退码 0',
  ].join('\n'),
  good: '# 一份普通文档\n\n它没有批次表。\n\n这是**好样本**：不该被误报成「表里缺键」。\n',
  squeezed: [
    '# 压缩表头（四键挤在一格 ⇒ 应判缺表）',
    '',
    '| 批 | 四要素（依赖/可并行/完成判定/门禁） |',
    '|:--|:--|',
    '| B0 | 都有 |',
    '',
    '**总门禁（total_gate）**：脚本退码 0',
  ].join('\n'),
};

/** 三要求自证 + 两项本插件诚实位；返回明细（供 health 工具与 gate.mjs 共用） */
export function selftest() {
  const cases = [];
  const run = (text, expectOk, expectKind, label) => {
    const a = analyzeText(text);
    const ok = a.ok === expectOk && (expectKind === null || a.reasonKind === expectKind);
    cases.push({ label, expectOk, expectKind, gotOk: a.ok, gotKind: a.reasonKind, pass: ok });
    return ok;
  };

  run(FIXTURES.pos, true, 'ok', '① 正样本（四要素齐全 + 总门禁）⇒ 该过的过');
  run(FIXTURES.neg, false, null, '② 负样本（某行门禁留空）⇒ 该拦的拦');
  run(FIXTURES.good, false, 'no_table', '③ ⚪真阴性（普通文档）⇒ 拦下且理由为「缺表」，不得误诊为缺键');
  run(FIXTURES.squeezed, false, 'no_table', '④ 假阳性位（四键挤在一格）⇒ 判缺表，不得假通过');
  run(FIXTURES.pos.replace(/\n\*\*总门禁[^\n]*/, ''), false, null, '⑤ 无总门禁 ⇒ 拦下');

  const skeleton = buildTaskBook({ title: '自证骨架', planId: 'selftest', batches: 3 });
  const sk = analyzeText(skeleton);
  const skeletonOk = sk.ok === true && sk.rows === 3;
  cases.push({
    label: '⑥ 生成件自洽（plan_book_new 骨架自身结构可提取 · 3 行）',
    expectOk: true,
    expectKind: 'ok',
    gotOk: sk.ok,
    gotKind: sk.reasonKind,
    pass: skeletonOk,
  });

  const placeholdersDetected = sk.placeholders > 0;
  cases.push({
    label: '⑦ 占位符诚实位（骨架 placeholders > 0 ⇒ 不得宣称"任务书完成"）',
    expectOk: true,
    expectKind: 'ok',
    gotOk: placeholdersDetected,
    gotKind: `placeholders=${sk.placeholders}`,
    pass: placeholdersDetected,
  });

  const bad = cases.filter((c) => !c.pass);
  return { ok: bad.length === 0, total: cases.length, failed: bad.length, cases };
}

// ──────────────────────────────────── 宿主注册 ────────────────────────────────────

function stripFrontmatter(text) {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? text.slice(m[0].length) : text;
}

function lossless(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

export function apply(ctx, config) {
  void config;
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const registered = new Map();
  const errors = [];

  for (const entry of manifest.skills ?? []) {
    const dir = join(SKILLS_DIR, entry.dir);
    const file = join(dir, 'SKILL.md');
    try {
      if (!existsSync(file)) throw new Error('缺 SKILL.md: ' + file);
      const body = stripFrontmatter(readFileSync(file, 'utf8')).trim();
      if (!body) throw new Error('SKILL.md 正文为空');
      const definition = {
        name: entry.name,
        description: entry.description,
        ...(entry.whenToUse ? { whenToUse: entry.whenToUse } : {}),
        content: body,
        source: 'runtime',
        resourceBase: { kind: 'directory', path: dir },
      };
      const remove = ctx.skills.register(definition);
      if (typeof remove !== 'function') throw new Error('skills.register 未返回卸载函数');
      registered.set(entry.name, { remove, dir });
    } catch (error) {
      errors.push({ name: entry.name, error: String(error) });
      try {
        console.error('[wishos-plan-book] register failed:', entry.name, String(error));
      } catch {}
    }
  }

  // 工具 1 · 校验
  const checkTool = ctx.tools.register({
    name: 'plan_book_check',
    description:
      '计划任务书结构校验（只读）：判断一份 .md 是否「四要素可机械提取」—— 表头四键分列 / 每行四列非空 / 有总门禁声明。返回 status（extractable | extractable_with_placeholders | not_extractable | unreadable）、逐处缺失位置、占位符计数。不写任何文件。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '任务书 .md 的绝对或相对路径' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        const r = value ?? {};
        const a = r.analysis ?? {};
        const lines = [`计划任务书校验 · ${r.path ?? '(未给路径)'}`];
        lines.push(`- 判定：${r.status ?? '?'} ${r.ok ? '✅' : '🔴'}　${a.reason ?? r.error ?? ''}`);
        if (a.headerLine) lines.push(`- 四要素总表：表头 L${a.headerLine} · 数据行 ${a.rows} 条`);
        if (a.columns) lines.push(`- 列映射：${KEY_ORDER.map((k) => `${k}→${a.columns[k]}`).join(' · ')}`);
        if (a.missing?.length) lines.push(`- 缺键 ${a.missing.length} 处：` + a.missing.slice(0, 5).map((m) => `L${m.line}/${m.label}`).join(' '));
        if (a.empty?.length) lines.push(`- 空格 ${a.empty.length} 处：` + a.empty.slice(0, 5).map((m) => `L${m.line}/${m.label}`).join(' '));
        if (a.totalGateLines) lines.push(`- 总门禁声明：${a.totalGateLines.length} 处` + (a.totalGateLines.length ? `（L${a.totalGateLines.slice(0, 5).join(',L')}）` : ''));
        if (typeof a.placeholders === 'number') {
          lines.push(`- 占位符：${a.placeholders} 处` + (a.placeholders > 0 ? '　⚠️ 结构过关 ≠ 实质填好，不得据此宣称"任务书完成"' : ''));
        }
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    execute: async (args) => lossless(checkFile(args?.path)),
  });

  // 工具 2 · 生成骨架
  const newTool = ctx.tools.register({
    name: 'plan_book_new',
    description:
      '生成计划任务书骨架（frontmatter + 四要素批次表 + 总门禁 + 风险/验收节）。默认拒绝覆盖已存在文件；写入后立即自校验结构是否可提取，占位符（⟨…⟩）留待人工填写。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目标 .md 路径（可不存在，父目录会自动创建）' },
        title: { type: 'string', description: '任务书标题' },
        plan_id: { type: 'string', description: '计划 id（默认 ⟨plan-id⟩ 占位）' },
        batches: { type: 'integer', description: '批次行数（1~30，默认 3）' },
        date: { type: 'string', description: '日期 YYYY-MM-DD（默认今天）' },
        execution_log: { type: 'string', description: '配套执行记录文件名/路径（默认 ⟨同名-执行记录.md⟩ 占位）' },
        scope: { type: 'string', description: '覆盖范围一句话' },
        redlines: { type: 'string', description: '红线（默认：正本只读 · 不就地改计划 · 不引入新依赖）' },
        force: { type: 'boolean', description: 'true 才允许覆盖已存在文件（默认 false）' },
      },
      required: ['path', 'title'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        const r = value ?? {};
        if (!r.ok) return [{ type: 'text', text: `🔴 生成失败：${r.error ?? '未知原因'}（${r.path ?? ''}）` }];
        const a = r.check?.analysis ?? {};
        const lines = [
          `✅ 任务书骨架已生成：${r.path}`,
          `- 字节：${r.bytes} · 批次行：${a.rows ?? 0} · 结构校验：${r.check?.status ?? '?'}`,
          `- 占位符：${a.placeholders ?? 0} 处 ⇒ 逐条替换 ⟨…⟩ 后再跑 plan_book_check`,
        ];
        if (r.executionLog) lines.push(`- 执行记录：${r.executionLog}（计划本体冻结，实绩另记此处）`);
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    execute: async (args) => lossless(
      writeTaskBook(args?.path, {
        title: args?.title,
        planId: args?.plan_id,
        batches: args?.batches,
        date: args?.date,
        executionLog: args?.execution_log,
        scope: args?.scope,
        redlines: args?.redlines,
        force: args?.force === true,
      }),
    ),
  });

  // 工具 3 · 自检
  const healthTool = ctx.tools.register({
    name: 'plan_book_health',
    description:
      '插件自检（只读）：核对包内技能文件与 references、当前宿主是否已注册 plan-book 技能，并跑 6+2 项结构夹具（正样本过 / 负样本拦 / 普通文档拦对理由 / 四键挤一格不假通过 / 无总门禁拦 / 骨架自洽 + 占位符诚实位）。不修改任何配置。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        const r = value ?? {};
        const lines = [`wishos-plan-book 自检 ${r.ok ? '✅ 通过' : '🔴 未通过'}`, `- 技能文件：${r.files.filter((f) => f.ok).length}/${r.files.length} 在盘`];
        lines.push(`- 技能注册：${r.registration.registered === true ? '已注册 ✅' : '未注册 ❌'}`);
        lines.push(`- 结构夹具：${r.selftest.total - r.selftest.failed}/${r.selftest.total} 通过`);
        for (const c of r.selftest.cases) lines.push(`  - ${c.pass ? '✅' : '🔴'} ${c.label}`);
        for (const e of r.errors ?? []) lines.push(`- ❌ ${e}`);
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    execute: async () => {
      const files = [
        { path: join(SKILLS_DIR, 'plan-book', 'SKILL.md'), label: 'SKILL.md' },
        { path: join(SKILLS_DIR, 'plan-book', 'references', 'doc-plan-protocol.md'), label: 'references/doc-plan-protocol.md' },
        { path: join(SKILLS_DIR, 'plan-book', 'references', 'four-elements.md'), label: 'references/four-elements.md' },
      ].map((f) => ({ ...f, ok: existsSync(f.path) && statSync(f.path).size > 0 }));

      let reg = { registered: false, error: null };
      try {
        if (typeof ctx.skills.get === 'function') {
          reg = { registered: (await ctx.skills.get('plan-book')) !== undefined, error: null };
        } else {
          reg = { registered: registered.has('plan-book'), error: null };
        }
      } catch (error) {
        reg = { registered: false, error: String(error) };
      }

      const st = selftest();
      const errors = [];
      if (!files.every((f) => f.ok)) errors.push('包内技能文件缺失');
      if (reg.registered !== true) errors.push('plan-book 技能未在宿主注册');
      if (!st.ok) errors.push(`结构夹具 ${st.failed} 项不符`);

      return lossless({
        ok: errors.length === 0 && st.ok && files.every((f) => f.ok),
        plugin: 'wishos-plan-book',
        version: '0.2.0',
        files,
        registration: reg,
        selftest: st,
        errors,
      });
    },
  });

  const dispose = () => {
    for (const { remove } of registered.values()) {
      try {
        remove();
      } catch (error) {
        try {
          console.error('[wishos-plan-book] unregister failed:', String(error));
        } catch {}
      }
    }
    registered.clear();
    for (const t of [checkTool, newTool, healthTool]) {
      try {
        if (typeof t === 'function') t();
      } catch {}
    }
  };

  if (typeof ctx.effect === 'function') ctx.effect(() => dispose);
  else if (typeof ctx.on === 'function') ctx.on('dispose', dispose);
}
