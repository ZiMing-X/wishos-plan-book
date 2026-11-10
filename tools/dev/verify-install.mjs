#!/usr/bin/env node
// wishos-plan-book / tools/dev/verify-install.mjs
//
// 验证「已安装但未激活」这一段（不需要重启宿主）：
//   ① 包在 profile 里可解析（createRequire 走 profile 的 node_modules）
//   ② 入口可被 Node 真 import（ESM 语法 / 顶层 import 全部成立）
//   ③ 导出形态符合宿主约定（apply 函数 + name + inject）
//   ④ 版本与包内 package.json 一致
//   ⑤ 报告激活开关状态：profile package.json 的 dsh.profile.bundles 是否已含本包
//      （未含 ⇒ 装上了但宿主不会加载；这不是失败，是"等你决定激活"）
//
// 用法：node tools/dev/verify-install.mjs [profileDir]
//       默认 profileDir = %USERPROFILE%\.dsh\profiles\web
// 只读：不改任何文件、不装、不激活。

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..', '..');
const PKG_NAME = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).name;
const PROFILE = resolve(process.argv[2]
  ?? join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'web'));

const rows = [];
const add = (id, title, pass, detail) => rows.push({ id, title, pass, detail });

add('V0', 'profile 目录存在', existsSync(join(PROFILE, 'package.json')), PROFILE);

let resolved = null;
try {
  const req = createRequire(join(PROFILE, 'package.json'));
  resolved = req.resolve(PKG_NAME);
  add('V1', '包可被 profile 解析（已安装）', true, resolved);
} catch (error) {
  add('V1', '包可被 profile 解析（已安装）', false, '未解析到 → 还没装：' + String(error.message ?? error));
}

let mod = null;
if (resolved) {
  try {
    mod = await import(pathToFileURL(resolved).href);
    add('V2', '入口可被 Node 真 import（ESM 语法成立）', true, resolved);
  } catch (error) {
    add('V2', '入口可被 Node 真 import（ESM 语法成立）', false, 'import 失败: ' + String(error.message ?? error));
  }
}

if (mod) {
  const ok = typeof mod.apply === 'function' && typeof mod.name === 'string' && Array.isArray(mod.inject);
  add('V3', '导出形态符合宿主约定（apply/name/inject）', ok,
    `apply=${typeof mod.apply} name=${mod.name} inject=${JSON.stringify(mod.inject)}`);
}

// 版本一致性：解析到的 package.json 与包内一致
if (resolved) {
  try {
    const req = createRequire(join(PROFILE, 'package.json'));
    const installedPkg = JSON.parse(readFileSync(req.resolve(`${PKG_NAME}/package.json`), 'utf8'));
    const localPkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
    const ok = installedPkg.version === localPkg.version;
    add('V4', '安装副本版本与本地包一致', ok, `installed=${installedPkg.version} local=${localPkg.version}`);
  } catch (error) {
    add('V4', '安装副本版本与本地包一致', false, String(error.message ?? error));
  }
}

// 激活开关（不是失败项，只报告）
let bundles = [];
let deps = {};
try {
  const profilePkg = JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8'));
  bundles = profilePkg?.dsh?.profile?.bundles ?? [];
  deps = profilePkg?.dependencies ?? {};
} catch {}
const inDeps = Object.keys(deps).includes(PKG_NAME);
const inBundles = bundles.includes(PKG_NAME);

console.log('='.repeat(78));
console.log(`  verify-install · ${PKG_NAME} @ ${PROFILE}`);
console.log('='.repeat(78));
let failed = 0;
for (const r of rows) {
  if (!r.pass) failed += 1;
  console.log(`  ${r.pass ? '✅' : '🔴'} ${r.id} ${r.title}`);
  console.log(`        ${r.detail}`);
}
console.log('-'.repeat(78));
console.log(`  激活开关：dependencies=${inDeps ? '在' : '不在'} · dsh.profile.bundles=${inBundles ? '在（宿主加载/热加载即注册）' : '不在（装而未激活）'}`);
if (inDeps && !inBundles) console.log('  ⇒ 已安装但未激活：要真验证注册，把包名加进 bundles 并重启宿主；回滚＝删该行。');
if (!inDeps) console.log('  ⇒ 尚未安装：先 `dsh plugin --profile web add "link:<包绝对路径>"`。');
console.log('-'.repeat(78));
console.log(failed === 0 ? '  ✅ 安装段验证通过（"真注册"请在宿主里调用 plan_book_health 取证）' : `  🔴 ${failed} 项未过`);
console.log('='.repeat(78));
process.exit(failed === 0 ? 0 : 2);
