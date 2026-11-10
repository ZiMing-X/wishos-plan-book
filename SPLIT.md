# SPLIT · 「计划任务书」独立拆解清单（**0.2.0 公开版**）

> 拆解日期 2026-11-07 · 公开版整理 2026-11-08 · 拆解人 **ZiMing-X**（GitHub: <https://github.com/ZiMing-X>）· 宿主 dsh 0.2.1-rc.2 / profile `web`
> 许可证 **Apache-2.0**（见 `LICENSE`）。本文件回答三件事：**拆了哪些**、**为什么边界划在这里**、**怎么退场**。
> 判据：`tools/dev/gate.mjs` 退码 0（结构 10 条 + mock 冒烟 + 7 项夹具 + 3 项能红测试 + parity）。

## 一 · 边界（为什么只拆这一段）

「计划任务书」＝**文档态计划**这一形态。V12 的计划线是两条，只有一条归本包：

| 资产 | 判定 | 处置 | 理由 |
|:--|:--|:--|:--|
| `doc-plan-protocol`（v1.2.4 · 40,867 B） | **归入** | 全文复制为 `skills/plan-book/references/doc-plan-protocol.md` | 它就是"任务书怎么写/怎么冻结/怎么验收"的规程本体，不拆就没内容 |
| `plan-template` §三点六「文档态四要素」（v1.5） | **只取判据，不搬全文** | 四要素写法进入 `references/four-elements.md` | `plan-template` 主体是 JSON/MetaSkill 机器态模板引擎（18,924 B），搬过来会把机器态混进文档态包 |
| `_plan4-check.py`（v1.0 · 9,431 B） | **判据同源重实现** | `plugin.js` 内 `analyzeText/checkFile`（JS，零依赖）；Python 原件留在 `某元项目\tools\` 不动 | 插件不能依赖外部 Python 进程；双实现做 parity，**互为探针**（不共用同一份代码即不共谋） |
| `plan`（入口 · 3,023 B） | **留在原处** | — | 它是"计划线"总路由，横跨机器态/文档态两条线；拆进本包会制造半截路由 |
| `plan-executor` / `plan-auditor` / `introspect-guard` / `execution-log` | **留在原处** | — | 机器态执行与逐步校验，与"任务书"这一文档形态是两件事 |
| `criteria-design-standard` | **只引用，不复制** | 技能正文点名调用 | 判据怎么设计是通用内核，复制即制造第二份口径 |

**一句话边界**：本包只负责「**一份任务书**从判档到复盘的全生命周期」，不负责「机器能直接跑的步骤定义」。

## 二 · 逐件登记（可复核）

| # | 源 | 字节 | md5 | 目标 | 处理 |
|:-:|:--|--:|:--|:--|:--|
| 1 | `<DSH_HOME>\.agent-presets\wishos\v12-core\skills\doc-plan-protocol\SKILL.md` | 40,867 | `9922A5314C1806F18CC9529B609F4F1D`（内部原稿） | `skills\plan-book\references\doc-plan-protocol.md` | **公开版改写**：署名归一（作者/批红人 → ZiMing-X）+ 内部项目代号脱敏 ⇒ 新 **41,117 B · md5 `F67B35E2B6C599047F227607F6BC3867`**（gate A9 登记） |
| 2 | `<DSH_HOME>\.agent-presets\wishos\v12-core\skills\plan-template\SKILL.md` | 18,924 | `B13DBE3F6401E41DD15E4AA790C633A9` | 不复制 | 仅引用其 §三点六 判据（见 `references/four-elements.md`） |
| 3 | `<元项目>\tools\_plan4-check.py` | 9,431 | `1060C68CDFBFF94F8B67C87BBC5FEBAA` | `plugin.js`（JS 重实现） | 判据对齐：四键分列 + 行内非空 + 总门禁在册；parity 见 §五 |
| 4 | `<DSH_HOME>\.agent-presets\wishos\v12-core\skills\plan\SKILL.md` | 3,023 | `32F00982C99D810B4C84B665591F74DC` | 不复制 | 判档规则在本包 SKILL.md §零 重述（只重述判据，不复述子技能清单） |

新增件（非搬迁）：`skills\plan-book\SKILL.md`、`plugin.js`、`tools\dev\gate.mjs`、`schemas\plan-book.schema.json`、`locale\{en,zh}.json`、`icon.svg`。

## 三 · 红线（本包不做什么）

1. **不改预设技能根**（`.agent-presets\wishos\v12-core\skills` 原字节不动；拆解不删原件）。
2. **不改 profile 配置** —— 安装时才在 `profiles\web\package.json` 加两处（dependency + `dsh.profile.bundles`），改前留 `.bak`，回滚＝删两行。
3. **零第三方依赖** —— 只 import `node:` 内建（gate A10）。
4. **只写盘一处** —— 只有 `plan_book_new` 写文件，且默认拒绝覆盖已存在文件；`check` / `health` 全程只读。
5. **不自造第二份口径** —— 版本号、四要素键名、判据阈值只在 `references/` 与 `plugin.js` 各声明一次；`SKILL.md` 不复述数字。
6. **公开版条款** —— Apache-2.0（`LICENSE`）；公开版 reference 已脱敏，原内部 md5 与改写记录保留在本文件 §二/§八，**不伪造历史**。

## 四 · 退场（**opt-in，装成并通过验证后才执行**）

> 仅适用于「本机同时装过内部 `doc-plan-protocol`」的内部部署场景；**公开版不随包分发该预设件**，通常无需退场。

目标：让 `doc-plan-protocol` 只有**一个**活副本（本包），避免同名技能双注册。

| 步 | 动作 | 门禁（不满足即停） |
|:-:|:--|:--|
| 1 | 安装本包并重启 host（见 `README.md` §安装） | `plan_book_health` 返回 `ok=true` |
| 2 | 确认新技能已可见（技能目录出现 `plan-book`） | 目录内可见，且 `plan_book_check` 可调用 |
| 3 | 从预设技能根**移出** `doc-plan-protocol`（移到 `_trash\` 或 `.retired\`，不硬删） | 移动后 `plan_book_health` 仍 `ok=true` |
| 4 | 复跑 `node tools/dev/gate.mjs --parity docs` | 退码 0 |

**回滚**：删 `profiles\web\package.json` 的两行 + 重启；`doc-plan-protocol` 从 `_trash\` 移回原目录。全程无需重建本包。

## 五 · 判据（可证伪）

| # | 判据 | 现测（2026-11-07T20:4x） |
|:-:|:--|:--|
| 1 | 包内门禁 18 项全过（含 3 项能红测试） | ✅ `node tools/dev/gate.mjs` 退码 0（加 `--parity` 则 19 项） |
| 2 | JS 校验器与 Python 参考实现在 `<元项目>\docs` 全量 **127 份** .md 上同判 | ✅ `--parity docs`：22 份 PASS 桶 / 105 份 FAIL 桶，mismatch **0** |
| 2b | 已知好/坏样本对照 | ✅ 医保 v1.1 → `extractable`（12 行）；v1.0 → `not_extractable`（理由「缺表」），与 2026-09-24 历史结论一致 |
| 3 | 生成件自洽：`plan_book_new` 骨架自身结构可提取 | ✅ C2 项；宿主机实测 2,368 B / 3 行 / 19 占位符 |
| 4 | 占位符诚实位：骨架 `placeholders>0` ⇒ 不得宣称"任务书完成" | ✅ 工具返回 `extractable_with_placeholders` |
| 5 | **安装后真激活**（技能注册 + 工具在面 + 自检 ok） | ✅ **已实测**：`plan_book_health` → `ok=true`（3/3 文件 · 已注册 · 7/7 夹具）；`plan_book_check` / `plan_book_new` 均可调用 |
| 6 | 退场后 `doc-plan-protocol` 单副本 | ⬜ **未执行**（§四 步 3，等裁） |

## 六 · 安装与激活记录（实测）

| 项 | 值 |
|:--|:--|
| 命令 | `dsh plugin --profile web add "link:<包源码目录>"`（dsh CLI 0.2.1-rc.2 · pnpm 11.28.7 · 8.7 s） |
| profile 变更 | `profiles\web\package.json` **自动加两处**：`dependencies["wishos-plan-book"]="link:<包源码目录>"` + `dsh.profile.bundles` 末尾 `"wishos-plan-book"` —— **`dsh plugin add` 会同时写入 bundles**，不是只加依赖 |
| 备份 | `package.json.bak-wishos-plan-book-20261107-204216`（before md5 `A948A9D4…` / 1,001 B → after `BDEF34EB…` / 1,096 B） |
| 链接 | `profiles\web\node_modules\wishos-plan-book` → 符号链接到包目录 |
| 激活方式 | **宿主热加载，未重启**：安装后本次会话的技能目录立即出现 `plan-book`，且 `plan_book_health` 可直接调用 |
| 回滚 | `dsh plugin --profile web remove wishos-plan-book`；**实测（2026-11-08 · dsh 0.2.1-rc.2 · 临时 profile）会同时清掉 `dependencies` 与 `dsh.profile.bundles` 两处**，并移除 `node_modules\wishos-plan-book` |

## 七 · 仍未验证（诚实登记）

1. **GUI 面板可见性**：未在设置/插件面板肉眼确认条目与图标（技能目录与工具面已实测可见）。
2. **`dsh plugin remove` 是否自动清 bundles 行**：✅ **已实测（2026-11-08）会清两处**（`dependencies` + `dsh.profile.bundles`）并移除 node_modules；`uninstall.ps1` 仍作双保险核对。
3. **退场未做**：内部机器上预设里的 `doc-plan-protocol` 仍在役，当前是"两份并存"（新 `plan-book` + 旧 `doc-plan-protocol`），内容不冲突但属重复引导；公开版不涉及。
4. **JS 校验器与 Python 的 parity 只覆盖结构判据**：Python 的 stdout 文案与 `--selftest` 行为未逐字对齐（不需要）。
5. **gate 的 SemVer 判定是极简实现**：只覆盖 `>=`/`>`/`<=`/`<`/`=`/`||`；遇 `^`/`~`/`*` 判 false（本包区间不含这些记号）。

## 八 · 公开版差异（0.2.0 · 2026-11-08）

> 目的：可用于 GitHub 公开发布。原则：**只归一归属与内部代号，不改条款含义、不伪造历史**（原内部 md5 保留于 §二）。

| # | 变更 | 明细 |
|:-:|:--|:--|
| 1 | 创作者归属归一 | `package.json author` + README/安装说明/本文件 → **ZiMing-X**；reference 内**作者署名 ×6、批红人署名 ×1** 统一为 **ZiMing-X** |
| 2 | 内部项目代号脱敏 | 内部项目代号 ×23 → `某内部项目`；元项目代号 ×15 → `某元项目`；业务域词 ×11 → `某业务场景`；临时目录路径 ×1 → `.agent/tmp/`（**原始→脱敏映射明细保留在内部发布记录，不写入公开包**） |
| 3 | reference md5 换登记 | 内部原稿 `9922A531…`（40,867 B）→ 公开版 **`F67B35E2B6C599047F227607F6BC3867`（41,117 B）**；`gate.mjs` A9 改为比对该登记值 |
| 4 | 许可 | `private: true` → 开源 **Apache-2.0**；新增 `LICENSE`（Copyright 2026 ZiMing-X）；README §许可证同步 |
| 5 | 元数据 | 版本 0.1.2 → **0.2.0**；manifest `private:false`、`source` 标注公开版改写 |

**未改**：四要素判据、3 个工具行为、技能正文（SKILL.md）、schema、locale、宿主门禁其余 17 项。

