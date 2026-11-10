# wishos-plan-book · 计划任务书（文档态计划）独立插件

> **创作者 / Creator**：**ZiMing-X**（GitHub: <https://github.com/ZiMing-X>）· **许可证 / License**：**Apache-2.0**（见 `LICENSE`）
>
> **一句话**：把「计划任务书」从 V12 技能束里**拆出来单独装** —— 1 个入口技能 + 3 个工具 + 规程全文，**即插即用**、自带门禁、可一行回滚。
>
> 这是 **0.2.0 公开版**：`references/` 已做「署名归一 + 内部项目代号脱敏」（md5 见 `gate.mjs` A9 与 `SPLIT.md`），原私有版归档在内部 dist。

## 30 秒上手（装完之后）

```text
① 自检      plan_book_health()                        → ok=true（技能已注册 · 7/7 夹具）
② 生成骨架  plan_book_new    path=docs/某任务-任务书-v1.0.md  title="某任务"  batches=5
③ 填实质内容（人/agent 逐批填四要素）
④ 校验      plan_book_check  path=docs/某任务-任务书-v1.0.md
            → extractable 且 placeholders=0 = 真过；
              extractable_with_placeholders = 结构过但还没填完；
              not_extractable = 缺表 / 表里缺键 / 没总门禁
```

对话里直接说下面这些词，技能会自动触发：
**计划任务书 / 任务书 / 文档态计划 / 分批执行计划 / 四要素 / 推进门禁 / 总门禁 / 计划冻结 / 执行记录 / 复盘回流**。

| 你想干什么 | 怎么说 / 怎么调 |
|:--|:--|
| 判断这事该不该写任务书 | 「这任务要不要写任务书？」→ 技能按门槛表判（单步/即问即答 ⇒ 豁免） |
| 写一份新任务书 | 「帮我写个任务书」或 `plan_book_new` |
| 审一份已有任务书 | 「按四要素校验这份计划」或 `plan_book_check` |
| 查插件是否正常 | `plan_book_health` |
| 看四要素怎么写 / 正反样例 | 让技能读 `references/four-elements.md`（按需，不常驻上下文） |

## 它是不是独立 / 即插即用

- **零第三方依赖**：`plugin.js` 只 import `node:fs` / `node:path` / `node:url`（门禁 A10 每次复跑）。
- **只依赖 DSH 核心服务**：`inject = ['skills', 'tools']`，两者都是宿主自带能力，不需要其它插件。
- **资源全在包内**：技能正文读 `skills/plan-book/SKILL.md`，`references/`、`schema`、`manifest` 都按包内路径解析（`resourceBase` 指向包内目录）；**不读宿主其它目录、不改预设技能根**。
- **一条命令安装**：`dsh plugin add "file:<tgz>"` —— 同时写 `dependencies` 与 `dsh.profile.bundles`，本机实测**热加载**、无需重启。
- **与其它 wishos 包无关**：`wishos-v12-core-skills`（不依赖）、`wishos-core` / `wishos-ops`（无关）。
- **兼容面**：Node `>=22.19.0`；dsh `>=0.2.1-rc.2 <0.2.2-0 || >=0.2.2-rc.1 <0.3.0-0`（`engines` 声明，门禁 A6 校验）。

已知边界（诚实登记）：

| # | 边界 | 处置 |
|:-:|:--|:--|
| 1 | `install.cmd` / `install.ps1` 仅 Windows | Linux/macOS（如 NAS 容器）直接用 tgz：`dsh plugin add "file:/path/x.tgz"` |
| 2 | `dsh plugin remove` 是否自动清 `dsh.profile.bundles` 那一行**未验证** | 卸载后用 `uninstall.ps1` 报告残留，或人工核对 profile 的 `package.json` 两处 |
| 3 | 宿主若不支持热加载 | 重启 dsh（会中断当前会话）后再调 `plan_book_health` |
| 4 | 本包是文档态计划 | 机器态计划（JSON / MetaSkill）走 `plan-template → plan-executor`，不归本包 |

## 包布局

```
wishos-plan-book/
├── package.json              # dsh.bundle.patch + exports/files + engines.dsh
├── cordis.patch.yml          # 一行 insert（id = wishos-plan-book）
├── plugin.js                 # 技能注册 + 3 工具 + 结构判据内核（零依赖）
├── skills.manifest.json      # 技能清单（name/description/whenToUse）
├── skills/plan-book/
│   ├── SKILL.md              # 入口技能：判档 → 六步 → 四要素 → 三条硬规则 → 反模式
│   └── references/
│       ├── doc-plan-protocol.md   # 规程全文（字节一致复制 · md5 见 SPLIT.md）
│       └── four-elements.md       # 四要素写法 + 正反样例
├── schemas/plan-book.schema.json  # 任务书 frontmatter 约束
├── locale/{zh,en}.json · icon.svg
├── tools/dev/gate.mjs        # 包内门禁（结构 10 + mock 冒烟 + 夹具 + 能红 + parity）
├── SPLIT.md                  # 拆解清单：边界 / 逐件 md5 / 退场 / 未验证
├── LICENSE                   # Apache-2.0
└── README.md
```

## 工具

| 工具 | 参数 | 判据（缺一不可） |
|:--|:--|:--|
| `plan_book_check` | `path` | `status=extractable` **且** `placeholders=0` 才算真过；`extractable_with_placeholders` 表示结构过关但实质未填 |
| `plan_book_new` | `path` `title` `[plan_id] [batches=3] [date] [execution_log] [scope] [redlines] [force=false]` | 生成件自身须过 `plan_book_check`；已存在文件默认拒绝覆盖 |
| `plan_book_health` | — | `ok=true`：1 技能已注册 + references 在盘 + 7 项结构夹具全过 |

结构判据与 Python 参考实现 `_plan4-check.py` **同源不同实现**（互为探针）：
表头四键须落在 **4 个不同列** · 每行四列非空（`—` 表示“无”，不等于留空）· 全文须有 `total_gate`/「总门禁」声明。

## 安装

### 方式 A（推荐 · 即插即用）：tgz 一条命令

```powershell
# 1) 找 dsh CLI（不在 PATH 时用本机 checkout 路径，按实际安装位置改）
$dsh = (Get-Command dsh -ErrorAction SilentlyContinue).Source
if (-not $dsh) { $dsh = "$env:USERPROFILE\dsh-0.2.1\node_modules\.bin\dsh.cmd" }

# 2) 备份 profile 配置（保险）
$pkg = "$env:USERPROFILE\.dsh\profiles\web\package.json"
Copy-Item $pkg "$pkg.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"

# 3) 安装（file: + 正斜杠；包在哪个目录就 Resolve-Path 哪个）
& $dsh plugin --profile web add "file:$((Resolve-Path .\wishos-plan-book-0.2.0.tgz).Path -replace '\\','/')"
```

Linux / macOS：

```bash
dsh plugin --profile web add "file:/path/to/wishos-plan-book-0.2.0.tgz"
```

> 实测 2026-11-07：dsh CLI `0.2.1-rc.2` · pnpm `11.28.7` · 8.7 s。`dsh plugin add` 会**同时**写
> `dependencies` 与 `dsh.profile.bundles`，宿主热加载后 `plan-book` 技能与 3 个工具即可用。

### 方式 B（开发态）：link 源码目录

```powershell
& $dsh plugin --profile web add "link:<包源码目录绝对路径>"
node <包源码目录>\tools\dev\gate.mjs --parity "<元项目>\docs"
```

`link:` 指向源码，改完即生效；挪走/改名包目录会断链。`file:`（tgz）是安装副本，不受源码改动影响。

**装完就地验证（三步，均已实测通过）**

```powershell
node "$env:USERPROFILE\.dsh\profiles\web\node_modules\wishos-plan-book\tools\dev\verify-install.mjs" "$env:USERPROFILE\.dsh\profiles\web"
# V0–V4 全绿：包可解析 / 入口可 import / 导出形态对 / 版本一致
# 然后在会话里调用：
#   plan_book_health                                   → ok=true（3/3 文件 · 已注册 · 7/7 夹具）
#   plan_book_check  path=<任一任务书.md>                → 真任务书应 extractable
#   plan_book_new    path=<新路径> title=<标题> batches=3 → extractable_with_placeholders + 拒覆盖
```

宿主侧门槛（包内自证）：`dsh.bundle.patch` 已声明 · `engines.dsh` 覆盖 `0.2.1-rc.2` · 零第三方依赖 · 包内零盘符绝对路径 · 入口同时声明 `main` 与 `exports["."]`。

## 验证（不需要装宿主）

```powershell
cd <包源码目录>
node tools/dev/gate.mjs                 # 结构 + mock 宿主冒烟 + 夹具 + 能红 → 期望退码 0（18 项）
node tools/dev/gate.mjs --parity "<元项目>\docs"   # 追加 JS↔Python parity（127 份真实文档：22 PASS / 105 FAIL，mismatch 0）
```

`--parity` 需要 Python 在 PATH（参考实现路径写在 `gate.mjs` 顶部 `PY_REF`，只读；便携包里可用环境变量 `PLAN4_CHECK` 指定）。
已知好/坏样本对照也已实测：`医保 v1.1`（12 行四键）→ `extractable`；`v1.0` → `not_extractable`（理由「缺表」）。

## 卸载 / 回滚

```powershell
& $dsh plugin --profile web remove wishos-plan-book
# 删后人工核对 profile\package.json 两处（dependencies + dsh.profile.bundles）是否都已清掉
# —— remove 是否自动清 bundles 行未验证；然后重启宿主
```

包目录保留不删即可（未激活＝零副作用）。一键卸载（Windows）：`uninstall.ps1 -Profile web`，它会报告 bundles 残留。

退场（移走预设里同名的 `doc-plan-protocol`，避免双副本）见 `SPLIT.md` §四 —— **装成并通过验证后才做**。

## 与其它包的关系

| 包 | 关系 |
|:--|:--|
| `wishos-v12-core-skills` | **不依赖**。它若装过，本包的 `plan-book` 与它的 `doc-plan-protocol` 是**两套并存**；退场步骤负责收掉重复 |
| `wishos-core` | 无关（persona/工具面 vs 计划文档形态） |
| `wishos-ops` | 无关 |

## 许可证 / License

**Apache-2.0**（全文见 `LICENSE`）：可自由使用、修改、再分发；请保留 `LICENSE` 与版权声明。
技能正文与规程全文改写自项目内部协议（公开版已做「署名归一 + 内部项目代号脱敏」，不改变条款含义）。
Copyright 2026 **ZiMing-X**（GitHub: <https://github.com/ZiMing-X>）。
