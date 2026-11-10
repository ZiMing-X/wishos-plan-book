#!/usr/bin/env node
// wishos-plan-book / tools/dev/gate.mjs — 包内门禁（零依赖 · 可离线复跑）
//
// 判据分四组，任一组红 ⇒ 退码 2：
//   A 结构（对应《DSH 插件发布要求调研 v0.4》§四 包内硬门槛 10 条）
//   B mock 宿主冒烟（不装宿主也能证明 plugin.js 能注册、工具能跑）
//   C 结构夹具（正样本过 / 负样本拦 / 真阴性拦对理由 / 挤一格不假通过 / 无总门禁拦 / 骨架自洽）
//   D 能红测试（故意注坏 ⇒ 必须变红；不能红的判据不算判据）
//
// 用法：
//   node tools/dev/gate.mjs                    # A+B+C+D
//   node tools/dev/gate.mjs --parity <dir>     # 追加 JS↔Python 双实现 parity（对目录内 *.md）
// 只读：除自建临时目录外不写任何文件；不安装、不激活、不改 profile。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..', '..');
const HOST_DSH_VERSION = '0.2.1-rc.2'; // 宿主版本判据（与 package.json engines.dsh 比对；换宿主时同步改）
// Python 参考实现（仅 --parity 用；不在盘则 parity 跳过）。用 PLAN4_CHECK 指定：
//   $env:PLAN4_CHECK = '<元项目>\tools\_plan4-check.py'
const PY_REF = process.env.PLAN4_CHECK ?? '';

const checks = [];
async function check(group, id, title, fn) {
  let pass = false;
  let detail = '';
  try {
    const r = await fn();
    pass = r === true || (r && r.pass === true);
    detail = (r && r.detail) || (pass ? 'ok' : 'fail');
  } catch (error) {
    pass = false;
    detail = 'EXCEPTION: ' + String(error && error.message ? error.message : error);
  }
  checks.push({ group, id, title, pass, detail });
  return pass;
}

// ───────────────────────────── A · 结构（10 条硬门槛） ─────────────────────────────

const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
const patchPath = join(PKG, 'cordis.patch.yml');

await check('A', 'A1', 'package.json 声明 dsh.bundle.patch 且 patch 在盘', () => {
  const p = pkg?.dsh?.bundle?.patch;
  const ok = typeof p === 'string' && p.length > 0 && existsSync(join(PKG, p));
  return { pass: ok, detail: ok ? p : '缺 dsh.bundle.patch 或文件不存在（最高频拒收录原因）' };
});

await check('A', 'A2', 'patch 有 insert 行 · id/name 唯一且与包名一致', () => {
  const txt = readFileSync(patchPath, 'utf8');
  const ids = [...txt.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const names = [...txt.matchAll(/^\s*name:\s*['"]?([^'"\n]+)['"]?\s*$/gm)].map((m) => m[1].trim());
  const ok = ids.length === 1 && new Set(ids).size === 1 && ids[0] === pkg.name && names.includes(pkg.name);
  return { pass: ok, detail: `ids=${JSON.stringify(ids)} names=${JSON.stringify(names)}` };
});

await check('A', 'A3', 'locale/en.json + zh.json 有 meta.title/description', () => {
  const bad = [];
  for (const l of ['en', 'zh']) {
    const f = join(PKG, 'locale', `${l}.json`);
    if (!existsSync(f)) { bad.push(`${l}:缺文件`); continue; }
    const j = JSON.parse(readFileSync(f, 'utf8'));
    if (!j?.meta?.title) bad.push(`${l}:缺 meta.title`);
    if (!j?.meta?.description) bad.push(`${l}:缺 meta.description`);
  }
  return { pass: bad.length === 0, detail: bad.length ? bad.join(' / ') : 'ok' };
});

await check('A', 'A4', 'icon 在包内且 ≤256 KiB', () => {
  const f = join(PKG, pkg.icon ?? 'icon.svg');
  if (!existsSync(f)) return { pass: false, detail: 'icon 不存在' };
  const size = statSync(f).size;
  const inside = resolve(f).startsWith(resolve(PKG));
  return { pass: inside && size <= 256 * 1024, detail: `${size} B · in-package=${inside}` };
});

await check('A', 'A5', 'exports/files 覆盖 plugin·patch·locale·icon·skills·schemas', () => {
  const exp = Object.keys(pkg.exports ?? {}).join(' ');
  const files = (pkg.files ?? []).map((s) => s.replace(/\/$/, ''));
  const needExp = ['.', './cordis.patch.yml', './locale/*.json', './icon'];
  const missExp = needExp.filter((k) => !exp.includes(k));
  const needFiles = ['plugin.js', 'cordis.patch.yml', 'skills', 'locale', 'icon.svg', 'schemas', 'skills.manifest.json'];
  const missFiles = needFiles.filter((k) => !files.includes(k));
  return { pass: !missExp.length && !missFiles.length, detail: `exports缺=${missExp.join(',') || '—'} · files缺=${missFiles.join(',') || '—'}` };
});

await check('A', 'A6', 'engines.dsh 声明且本机宿主 0.2.1-rc.2 满足', () => {
  const range = pkg?.engines?.dsh;
  if (typeof range !== 'string' || !range.trim()) return { pass: false, detail: '未声明 engines.dsh' };
  const sat = satisfies(HOST_DSH_VERSION, range);
  return { pass: sat, detail: `host=${HOST_DSH_VERSION} range=${range} satisfied=${sat}` };
});

await check('A', 'A7', 'manifest 每项都有 SKILL.md 且正文非空', () => {
  const mf = JSON.parse(readFileSync(join(PKG, 'skills.manifest.json'), 'utf8'));
  const bad = [];
  for (const s of mf.skills ?? []) {
    const f = join(PKG, 'skills', s.dir, 'SKILL.md');
    if (!existsSync(f)) { bad.push(`${s.dir}:缺SKILL.md`); continue; }
    const body = readFileSync(f, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
    if (!body) bad.push(`${s.dir}:正文空`);
    if (!s.name || !s.description) bad.push(`${s.dir}:manifest 缺 name/description`);
  }
  return { pass: bad.length === 0, detail: bad.length ? bad.join(' / ') : `${(mf.skills ?? []).length} 技能` };
});

await check('A', 'A8', '运行时文本件零盘符绝对路径（可移植性）', () => {
  const roots = ['plugin.js', 'cordis.patch.yml', 'package.json', 'skills.manifest.json'];
  const dirs = ['skills', 'schemas', 'locale'];
  const files = [...roots.filter(existsSync).map((f) => join(PKG, f)), ...dirs.flatMap((d) => walk(join(PKG, d)))];
  const hits = [];
  for (const f of files) {
    if (!/\.(js|mjs|json|yml|yaml|md|svg)$/i.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    const m = text.match(/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/g); // `https://` 的 `s:/` 不算盘符
    if (m) hits.push(`${relative(PKG, f)}(${m.length})`);
  }
  return { pass: hits.length === 0, detail: hits.length ? hits.join(' ') : `${files.length} 件扫描 0 命中` };
});

await check('A', 'A9', 'references 齐全且 md5 与登记一致（公开版）', () => {
  const ref = join(PKG, 'skills', 'plan-book', 'references', 'doc-plan-protocol.md');
  const fe = join(PKG, 'skills', 'plan-book', 'references', 'four-elements.md');
  // 公开版（0.2.0）登记 md5：在内部原稿基础上做「署名归一 + 内部项目代号脱敏」后的文本。
  // 若后续有意再改 reference，须同步更新此常量与 SPLIT.md §二 登记。
  const REF_MD5 = 'F67B35E2B6C599047F227607F6BC3867';
  const need = [ref, fe].every((f) => existsSync(f) && statSync(f).size > 0);
  if (!need) return { pass: false, detail: 'refs 缺失或为空' };
  const got = md5(readFileSync(ref));
  return { pass: got === REF_MD5, detail: `ref md5=${got} · 登记=${REF_MD5}` };
});

await check('A', 'A10', '零第三方依赖（只 import node: 内建）', () => {
  const js = [...walk(join(PKG, 'skills')), join(PKG, 'plugin.js')].filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  const bad = [];
  for (const f of js) {
    const text = readFileSync(f, 'utf8');
    const specs = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const s of specs) if (!s.startsWith('node:')) bad.push(`${relative(PKG, f)} → ${s}`);
  }
  const deps = Object.keys(pkg.dependencies ?? {});
  return { pass: bad.length === 0 && deps.length === 0, detail: bad.length ? bad.join(' ') : `deps=${deps.length} · 全部 node: 内建` };
});

// ───────────────────────────── B/C/D · 运行时冒烟与夹具 ─────────────────────────────

const mod = await import(pathToFileURL(join(PKG, 'plugin.js')).href);

await check('B', 'B1', 'mock 宿主：apply 注册 1 技能 + 3 工具（幂等、可卸载）', () => {
  const { ctx, skills, tools, disposers } = mockCtx();
  mod.apply(ctx, {});
  const skillNames = [...skills.keys()];
  const toolNames = [...tools.keys()].sort();
  const expectTools = ['plan_book_check', 'plan_book_health', 'plan_book_new'];
  const okReg = skillNames.length === 1 && skillNames[0] === 'plan-book' && JSON.stringify(toolNames) === JSON.stringify(expectTools);
  // 技能正文须非空且不含 frontmatter
  const body = skills.get('plan-book')?.content ?? '';
  const bodyOk = body.length > 200 && !body.startsWith('---');
  const rb = skills.get('plan-book')?.resourceBase;
  const rbOk = rb?.kind === 'directory' && existsSync(join(rb.path, 'references', 'doc-plan-protocol.md'));
  // 卸载
  for (const fn of disposers) {
    try { fn(); } catch {}
  }
  const disposed = skills.size === 0 && tools.size === 0;
  const ok = okReg && bodyOk && rbOk && disposed;
  return { pass: ok, detail: `skills=${JSON.stringify(skillNames)} tools=${JSON.stringify(toolNames)} body=${body.length}B resourceBase=${rbOk} disposed=${disposed}` };
});

const tmp = mkdtempSync(join(tmpdir(), 'planbook-gate-'));

await check('C', 'C1', '工具 plan_book_check：正样本 PASS / 负样本 FAIL / 无表文档判「缺表」', async () => {
  const { ctx, tools, disposers } = mockCtx();
  mod.apply(ctx, {});
  const tool = tools.get('plan_book_check');
  const pos = join(tmp, 'pos.md'); writeFileSync(pos, fixturePos(), 'utf8');
  const neg = join(tmp, 'neg.md'); writeFileSync(neg, fixtureNeg(), 'utf8');
  const good = join(tmp, 'good.md'); writeFileSync(good, '# 普通文档\n\n无表。\n', 'utf8');
  const rp = await tool.execute({ path: pos });
  const rn = await tool.execute({ path: neg });
  const rg = await tool.execute({ path: good });
  for (const fn of disposers) try { fn(); } catch {}
  const ok = rp.status === 'extractable' && rn.status === 'not_extractable' && rg.status === 'not_extractable'
    && rg.analysis.reasonKind === 'no_table' && rn.analysis.empty.length === 1;
  return { pass: ok, detail: `pos=${rp.status} neg=${rn.status}(empty=${rn.analysis.empty.length}) good=${rg.status}(${rg.analysis.reasonKind})` };
});

await check('C', 'C2', '工具 plan_book_new：生成件自洽（结构可提取）+ 拒绝覆盖 + 占位符 >0', async () => {
  const { ctx, tools, disposers } = mockCtx();
  mod.apply(ctx, {});
  const tool = tools.get('plan_book_new');
  const p = join(tmp, '骨架任务书.md');
  const r1 = await tool.execute({ path: p, title: '门禁夹具 · 任务书', batches: 4, date: '2026-11-07' });
  const r2 = await tool.execute({ path: p, title: '重复写' }); // 应被拒
  for (const fn of disposers) try { fn(); } catch {}
  const ok = r1.ok === true && r1.check.status === 'extractable_with_placeholders'
    && r1.check.analysis.rows === 4 && r1.check.analysis.placeholders > 0
    && r2.ok === false && /已存在/.test(r2.error ?? '');
  return { pass: ok, detail: `new=${r1.check?.status} rows=${r1.check?.analysis?.rows} ph=${r1.check?.analysis?.placeholders} 覆盖被拒=${r2.ok === false}` };
});

await check('C', 'C3', '工具 plan_book_health：自检 ok=true（含 7 项夹具）', async () => {
  const { ctx, tools, disposers } = mockCtx();
  mod.apply(ctx, {});
  const tool = tools.get('plan_book_health');
  const r = await tool.execute({});
  for (const fn of disposers) try { fn(); } catch {}
  return { pass: r.ok === true, detail: `ok=${r.ok} fixtures=${r.selftest.total - r.selftest.failed}/${r.selftest.total} errors=${JSON.stringify(r.errors)}` };
});

await check('C', 'C4', 'selftest() 直调：7 项夹具全过', () => {
  const r = mod.selftest();
  return { pass: r.ok === true, detail: `${r.total - r.failed}/${r.total}` };
});

await check('D', 'D1', '能红测试：把正样本的门禁列清空 ⇒ 必须变红', () => {
  const broken = fixturePos().replace('| 不通过 → 挂起 |', '|  | ');
  const a = mod.analyzeText(broken);
  return { pass: a.ok === false && a.empty.length >= 1, detail: `ok=${a.ok} empty=${a.empty.length}` };
});

await check('D', 'D2', '能红测试：四键挤在同一格 ⇒ 不得假通过', () => {
  const squeezed = [
    '# 压缩表头',
    '',
    '| 批 | 四要素（依赖/可并行/完成判定/门禁） |',
    '|:--|:--|',
    '| B0 | 都有 |',
    '',
    '**总门禁（total_gate）**：退码 0',
  ].join('\n');
  const a = mod.analyzeText(squeezed);
  return { pass: a.ok === false && a.reasonKind === 'no_table', detail: `ok=${a.ok} reason=${a.reasonKind}` };
});

await check('D', 'D3', '能红测试：删掉总门禁声明 ⇒ 必须变红（理由含「无总门禁」）', () => {
  const noGate = fixturePos().replace(/\n\*\*总门禁[^\n]*/, '');
  const a = mod.analyzeText(noGate);
  return { pass: a.ok === false && /无总门禁/.test(a.reason), detail: `ok=${a.ok} reason=${a.reason}` };
});

// ───────────────────────────── 可选：JS ↔ Python parity ─────────────────────────────

let parity = null;
const parityIdx = process.argv.indexOf('--parity');
if (parityIdx !== -1) {
  const dir = process.argv[parityIdx + 1];
  parity = runParity(dir);
  checks.push({
    group: 'E',
    id: 'E1',
    title: `JS↔Python 双实现 parity（${parity.total} 份真实任务书）`,
    pass: parity.total > 0 && parity.mismatch.length === 0,
    detail: `total=${parity.total} mismatch=${parity.mismatch.length}${parity.mismatch.length ? ' → ' + JSON.stringify(parity.mismatch.slice(0, 5)) : ''}`,
  });
}

// ─────────────────────────────── 汇总 ───────────────────────────────

const failed = checks.filter((c) => !c.pass);
console.log('='.repeat(78));
console.log(`  wishos-plan-book · 包内门禁（${PKG}）`);
console.log('='.repeat(78));
for (const g of ['A', 'B', 'C', 'D', 'E']) {
  const rows = checks.filter((c) => c.group === g);
  if (!rows.length) continue;
  console.log(`\n【${g}】`);
  for (const c of rows) {
    console.log(`  ${c.pass ? '✅' : '🔴'} ${c.id.padEnd(3)} ${c.title}`);
    console.log(`        ${c.detail}`);
  }
}
console.log('\n' + '-'.repeat(78));
console.log(`  合计 ${checks.length} 项 · 通过 ${checks.length - failed.length} · 失败 ${failed.length}`);
console.log(failed.length === 0 ? '  ✅ 门禁全过（退码 0）' : '  🔴 门禁未过（退码 2）');
console.log('='.repeat(78));

try { rmSync(tmp, { recursive: true, force: true }); } catch {}
process.exit(failed.length === 0 ? 0 : 2);

// ─────────────────────────────── helpers ───────────────────────────────

function fixturePos() {
  return [
    '# 计划',
    '',
    '| 批 | 依赖 | 可并行 | 完成判定 | 门禁 |',
    '|:--|:--|:--|:--|:--|',
    '| B0 | — | — | 产出 `a.md` | 不通过 → 挂起 |',
    '| B1 | B0 | — | 计数 = 3 | 缺件 → 回退 1 次 |',
    '',
    '**总门禁（total_gate）**：脚本退码 0',
  ].join('\n');
}

function fixtureNeg() {
  return fixturePos().replace('| 缺件 → 回退 1 次 |', '|  |');
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function md5(buf) {
  return createHash('md5').update(buf).digest('hex').toUpperCase();
}

function mockCtx() {
  const skills = new Map();
  const tools = new Map();
  const disposers = [];
  const ctx = {
    skills: {
      register(def) {
        if (!def?.name) throw new Error('skill 缺 name');
        if (skills.has(def.name)) throw new Error('重复注册技能: ' + def.name);
        skills.set(def.name, def);
        return () => skills.delete(def.name);
      },
      async get(name) {
        return skills.get(name);
      },
      async list() {
        return [...skills.values()];
      },
    },
    tools: {
      register(def) {
        if (!def?.name) throw new Error('tool 缺 name');
        if (tools.has(def.name)) throw new Error('重复注册工具: ' + def.name);
        tools.set(def.name, def);
        return () => tools.delete(def.name);
      },
    },
    effect(fn) {
      // 与 Cordis 语义一致：effect 回调返回的函数才是清理函数
      const d = fn();
      if (typeof d === 'function') disposers.push(d);
    },
    on() {},
  };
  return { ctx, skills, tools, disposers };
}

/** 极简 SemVer 比较与 range 判定（只覆盖 >=,>,<=,<,=, || 与 -0 预发布尾） */
function parseVer(v) {
  const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] ?? null };
}

function cmpVer(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] < b.nums[i] ? -1 : 1;
  }
  const ap = a.pre;
  const bp = b.pre;
  if (ap === null && bp === null) return 0;
  if (ap === null) return 1; // 正式版 > 预发布
  if (bp === null) return -1;
  return ap === bp ? 0 : ap < bp ? -1 : 1;
}

function satisfies(version, range) {
  const v = parseVer(version);
  if (!v) return false;
  return String(range)
    .split('||')
    .map((s) => s.trim())
    .some((clause) => {
      const tokens = clause.split(/\s+/).filter(Boolean);
      if (!tokens.length) return false;
      return tokens.every((t) => {
        const m = t.match(/^(>=|<=|>|<|=)?(.+)$/);
        if (!m) return false;
        const op = m[1] ?? '=';
        const target = parseVer(m[2]);
        if (!target) return false;
        const c = cmpVer(v, target);
        if (op === '>=') return c >= 0;
        if (op === '>') return c > 0;
        if (op === '<=') return c <= 0;
        if (op === '<') return c < 0;
        return c === 0;
      });
    });
}

function runParity(dir) {
  if (!dir || !existsSync(dir)) return { total: 0, mismatch: [{ error: '目录不存在: ' + String(dir) }] };
  if (!PY_REF || !existsSync(PY_REF)) {
    return { total: 0, mismatch: [{ error: 'PLAN4_CHECK 未配置或参考实现不在盘（--parity 需先指定）' }], pythonAvailable: false, ref: PY_REF };
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => join(dir, f));
  const mismatch = [];
  let pyOk = true;
  for (const f of files) {
    const js = mod.checkFile(f);
    const jsCode = js.status === 'unreadable' ? 3 : js.ok ? 0 : 2;
    let pyCode = null;
    try {
      execFileSync('python', [PY_REF, f], { stdio: 'pipe', encoding: 'utf8' });
      pyCode = 0;
    } catch (error) {
      if (error && typeof error.status === 'number') pyCode = error.status;
      else { pyOk = false; pyCode = -1; }
    }
    if (pyCode !== jsCode) mismatch.push({ file: relative(dir, f), js: jsCode, py: pyCode });
  }
  return { total: files.length, mismatch, pythonAvailable: pyOk, ref: PY_REF };
}
