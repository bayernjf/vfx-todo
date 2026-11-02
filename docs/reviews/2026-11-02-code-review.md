# vfx-todo 深度代码评审报告

- **评审日期**:2026-11-02
- **评审方式**:只读静态审查 + 实际执行验证门 + 针对性实证探针(node 内联脚本,未改动任何仓库文件)
- **评审人**:AI 代码评审代理(应 owner 要求执行)

---

## 1. 仓库定位与规模概览

带 WebGL/Canvas 视觉特效的桌面端 Todo 应用,Tauri v2(Rust)+ React 18 + TypeScript + Vite 5。单仓单包,前后端同仓:

| 部分 | 文件 | 行数 |
|---|---|---|
| 前端源码 | `src/App.tsx` (2092)、`src/Overlay.tsx` (821)、`src/styles.css` (1555)、`src/main.tsx` (25) | ~4500 |
| Rust 后端 | `src-tauri/src/lib.rs` (1962)、`update.rs` (148)、`main.rs` (6) | ~2100 |
| 前端测试 | `src/__tests__/` 6 个文件 | ~1250(75 用例) |
| E2E | `e2e/` 4 个 spec + mocks.ts | ~950(38 用例) |
| 合计(含 CSS/测试) | | **~8.8k 行** |

架构:主窗口(`App.tsx`,全部 UI 逻辑)+ 每屏一个透明 Overlay 窗口(`Overlay.tsx` 渲染特效),Rust 侧单文件 `lib.rs` 承载全部命令/调度/持久化(JSON 文件落盘 + 5s 后台 flush)。发布走 GitHub Actions `release.yml`(tauri-action + minisign 签名 + updater)。

## 2. 结论摘要

- **P0:0 条;P1:6 条;P2:13 条;P3:7 条**
- 验证门实测:`npm run check` ✅ / `npm test` ✅ 75 通过 / `npm run test:e2e` ✅ 38 通过 / `npm run build` ✅ / `cargo test` ✅ 34 通过(需非沙箱重跑,详见 §5)/ `npm run lint` ❌ **失败(eslint 未安装)**

最关键的三条:

1. **撤销"完成"对真实后端是静默空操作** —— 前端用 `todo_update` 传 `completed:false` 撤销完成,但 Rust 命令根本没有 `completed` 参数,多余参数被 serde 静默忽略;e2e 通过只是因为 mock 实现了真实后端不存在的字段(见 P1-2)。
2. **新建待办默认 3 秒后到期并自动触发特效+自动标记完成**,代码里留着作者自述的 `BLOCKER: 上线前改回 300` 注释,且集成测试把 3 秒固化成了断言(见 P1-1)。
3. **内联编辑表单真实键入不可用** —— 编辑态基于每次渲染重建的临时对象 + `Object.assign` 突变、无 setState:实测受控输入每键入一个字符立即回显还原;带到期时间的待办还有每秒重渲染清空未保存修改。fill 式 e2e 恰好绕过了该路径(见 P1-4)。

## 3. 逐条发现

### P1 —— 严重缺陷

#### P1-1 新建待办默认 3 秒到期(代码自述 BLOCKER 未修)

- **位置**:`src/App.tsx:168-169` `const DEFAULT_DUE_SECS = 3;`(注释:`BLOCKER: 上线前改回 300`);使用处 `src/App.tsx:789`(初始 state)、`src/App.tsx:1070`(添加后重置)。
- **影响**:默认状态下每创建一个待办,3 秒后调度器(`src-tauri/src/lib.rs:320-338`)即派发特效 + 弹系统通知并把待办标记为已完成。正常记录任务会被特效轰炸且任务"自动完成"。
- **佐证**:`src/__tests__/App.integration.test.tsx:166-169`("到期提示显示默认 3 秒")与 `:142-154`(`dueAt > Date.now()+2000`)把该调试残留固化成了测试断言,修复需同步改测试。
- **修复建议**:`DEFAULT_DUE_SECS` 改回 300 或默认无到期(`null`);同步更新上述两处断言。

#### P1-2 撤销"完成"对真实后端无效;e2e mock 掩盖

- **位置**:前端 `src/App.tsx:885`(批量撤销)、`src/App.tsx:1121`(单个撤销):`invoke("todo_update", { id, completed: false })`;后端 `src-tauri/src/lib.rs:736-748` `todo_update` 参数列表**无 `completed`**(仅 title/due_at/screen/recurrence/effect/tag/repeat_count/play_duration/danmaku_speed)。
- **影响**:Tauri 对多余参数静默忽略 → 调用返回成功但 `completed` 不变,撤销完成实际是 no-op。`e2e/filters.spec.ts:135-148` "undo complete via toast button" 通过是因为 `e2e/mocks.ts:121` 的 mock 实现了 `completed: args.completed ?? td.completed` —— mock 与真实后端行为漂移,恰好掩盖了该 bug。
- **修复建议**:后端 `todo_update` 增加 `completed: Option<bool>` 参数;e2e mock 对未知参数应抛错而不是容忍,防止再次漂移。

#### P1-3 CSV 导出/导入转义互不兼容,含英文逗号/换行的标题 round-trip 数据损坏

- **位置**:导出 `src-tauri/src/lib.rs:1281`(`t.title.replace(",", "\\,")` 自制转义,且不处理引号/换行);导入 `src-tauri/src/lib.rs:1316`(`line.split(',')`)+ `:1329`。
- **实测证据**(node 探针镜像两端逻辑):标题 `开会, 讨论` 导出为 `id1,开会\, 讨论,false,...`;导入侧 `split(',')` 得到 10 列,`parts[1]` 为 `"开会\"`,其后的 `completed`、`created_at` 等全部错位解析失败(分别落成 `false`、`0`)。
- **影响**:任何含英文逗号或换行的标题,导出再导入后该行所有字段错位损坏;属用户数据损坏。
- **修复建议**:改用标准 CSV(双引号包裹 + `""` 转义)并做引号感知解析,或直接引入 `csv` crate。

#### P1-4 内联编辑表单键入回显重置;带 due 的待办每秒被清空未保存修改

- **位置**:`src/App.tsx:653` `const edit = editFromTodo();`(每次渲染重建临时对象)+ `src/App.tsx:677-680` `onChange` 仅 `Object.assign(edit, patch)`、无 setState;`src/App.tsx:624-628` 对 `todo.due_at && !todo.completed` 的待办每秒 `setTick` 强制重渲染。
- **实测证据**:用仓库自带 react-dom@18.3.1 + jsdom 做探针:受控输入(value=临时对象字段、onChange 不 setState)键入 `'X'` 后,DOM value 在事件处理结束即被 React 恢复为原值 `"Original"`(突变对象捕获到 `"OriginalX"`)。即真实逐字符键入时显示逐字符回退、内容不可预期;且任何重渲染都会用 todo props 重建 `edit`,未保存修改全部丢失 —— 而新建待办默认带 due(P1-1),恰好触发每秒重渲染。
- **为何测试未抓到**:vitest 无 EditForm 用例;e2e 编辑用例(`e2e/app.spec.ts:158-172`、`e2e/multi-screen.spec.ts:81-105`)用 `fill()` 一次写入完整值并立即点保存,突变对象已捕获全值,绕过逐字符路径;且种子数据 `due_at` 为 null,不触发每秒 tick。
- **修复建议**:把 `EditState` 改为 `TodoItem` 内 `useState`(进入编辑时初始化一次),或把 EditForm 改为持有自身状态的组件。

#### P1-5 "播放时长(非弹幕)"设置端到端无效

- **位置**:UI 与参数链路完整(`src/App.tsx:460-486` → `todo_create.repeat_count/play_duration` → `src-tauri/src/lib.rs:81-88` `VfxPayload.play_duration`),但 `src/Overlay.tsx:26-32` 的 TS `VfxPayload` 接口**没有 `play_duration` 字段**;`src/Overlay.tsx:280` `VfxEngine.duration = 2000` 写死,`trigger()`(`:365-380`)不接收时长参数。
- **影响**:用户调整播放时长(1-5s)不产生任何效果,所有非弹幕特效恒为 2 秒。
- **修复建议**:Overlay 侧接口补 `play_duration`,`trigger()` 接收并赋值 `this.duration = play_duration * 1000`。

#### P1-6 公告拉取为同步 command,内嵌最长 10s 阻塞 HTTP,冻结主线程

- **位置**:`src-tauri/src/update.rs:31` `pub fn fetch_announcements()`(非 async)+ `:49-67` `reqwest::blocking` 客户端 timeout 10s;前端启动即调(`src/App.tsx:964-967`)。
- **影响**:Tauri v2 中非 async command 在主线程执行 → 网络不佳时启动后 UI 冻结最长约 10 秒。
- **修复建议**:改为 `async fn`(Tauri 自动丢入线程池)或用 reqwest async + tokio。

### P2 —— 质量/可维护性/正确性隐患

1. **持久化线程丢写竞态** —— `src-tauri/src/lib.rs:386-400`:读 dirty → clone → 写盘 → 置 `dirty=false`。clone 之后、置 false 之前发生的新修改,其 dirty 标记被覆盖丢失;若此后无新修改,退出时丢失最多 5s 数据。建议先清 dirty 再写盘,失败时恢复标记。
2. **Rust 单测测的是复制实现,不是真实命令** —— `src-tauri/src/lib.rs:1542-1643` 的 `*_sync` wrapper 重新实现命令逻辑且已漂移:如 `todo_complete_sync` 对不存在 id 返回 `Err`,而真实 `todo_complete`(`:722-733`)对不存在 id 返回 `Ok(())`。34 个通过的 cargo 测试不能证明真实命令行为。建议直接调用 command 函数本身或抽共享核心。
3. **3 个 vitest 文件为同义反复测试** —— `src/__tests__/TodoItem.test.tsx:8-70` 内联复制了 TodoItem 实现(文件头自述"直接用内联 TodoItem 实现");`helpers.test.ts:9-18` 复制 `formatDue`;`shaders.test.ts:17-63` 复制常量表(如 `expect(EXPECTED_EFFECTS.length).toBe(7)` 断言测试文件自身常量)。改坏源码这些测试不会失败,虚增覆盖假象。
4. **导入无 id 去重** —— `src-tauri/src/lib.rs:1347-1350` `todos.extend(imported)`:JSON/CSV 导入可引入与现有重复或外部任意 id;complete/delete 按首个匹配操作(`:725-730`、`:779`),重复 id 会操作错对象。另 CSV 分支 `recurrence` 字段未校验(`:1334`),与 effect/tag 的校验不一致;JSON 分支则三个字段都不校验。
5. **导出/导入列不对称** —— 导出 9 列(`:1276`,无 repeat_count/play_duration/danmaku_speed),导入读第 10-12 列(`:1338-1340`)→ CSV round-trip 静默丢失特效参数。
6. **循环任务停机后补放风暴** —— `src-tauri/src/lib.rs:341-365`:`next_due = due + 固定间隔`。停机 N 天后重开,过期实例每秒触发一次并再造一个仍过期的实例,连环补放 N 次特效+系统通知。建议循环推进 `next_due` 至未来,或只补最近一次。
7. **调度器持锁做通知/emit,且全库 `lock().unwrap()`** —— `src-tauri/src/lib.rs:298-336`:持有 `todos` 锁期间调用系统通知与事件派发;任何一处 panic 使 Mutex poison 后,所有命令线程随后 100% panic。
8. **CI 验证门缺口** —— `.github/workflows/ci.yml`:仅 cargo test + `tsc --noEmit` + vitest;不跑 lint、e2e、前端 build;`push` 触发仅监听 `main`/`master`,dev 推送不跑 CI。`.github/workflows/release.yml` build job 只 type-check,不跑任何测试即出包发布。
9. **lint 命令实际坏掉** —— `package.json:11` `"lint": "eslint . --ext ts,tsx"`,但 devDependencies 无 eslint。实测:`npm run lint` → `eslint: command not found`。README.md:32、AGENTS.md:49、docs/TECH_STACK.md 三处文档仍宣称 lint 可用。
10. **多屏热插拔** —— Overlay 窗口只在启动时创建(`src-tauri/src/lib.rs:405-444`),新接显示器永远没有 overlay;前端虽每 5s 刷新屏幕列表(`src/App.tsx:1030`),但可把待办指向无 overlay 的屏 → 弹幕被丢弃(`lib.rs:226` warn+drop;与 VFX 的 fallback overlay-0 行为 `:258-262` 不一致)。屏幕枚举 index 热插拔后亦可能漂移。
11. **e2e mock 与真实后端多处漂移** —— `e2e/mocks.ts:111-131` 的 `todo_update` 支持真实后端没有的 `completed`、且读取 `args.repeat_count` 等 snake_case 字段,而前端实际发 camelCase(`src/App.tsx:668-670` 发 `repeatCount`,依赖 Tauri 自动转换);mock 的 `todo_batch_complete`/`todo_clear_completed` 返回 `true` 而真实返回计数(前端 `count > 0` 恰好兼容)。mock 未核对未知命令/参数。
12. **弱断言** —— `e2e/theme-drag.spec.ts:107-108` `expect(orderChanged || newTitles.length === 3).toBeTruthy()` 恒为真,排序失效也不会失败;`:48-61` 条件断言(theme 非 dark 时整个用例无断言)。vitest Overlay 用例有大量 `act(...)` 警告未处理(实测输出可见)。
13. **公告 url 无协议校验;"查看详情"桌面端行为未确认** —— `src/App.tsx:2063-2071` 直接把远程 JSON 的 `url` 放进 `<a href target="_blank">`:未限制 `https?:` 协议(`javascript:` 会在 webview 内执行);数据源虽为自有仓库 raw(HTTPS),建议仍做协议白名单。另外 `@tauri-apps/plugin-opener` 已装未用,target="_blank" 在 Tauri v2 桌面端默认是否打开系统浏览器**未确认**(需真机验证,可能点击无响应)。

### P3 —— 体验/规范

1. **死依赖**:`package.json` 中 `@tauri-apps/plugin-fs`、`plugin-opener`、`plugin-dialog`、`plugin-global-shortcut` 前端零引用(grep 实测仅 `plugin-updater` 与 `api` 被 import)。
2. **文档漂移**:`AGENTS.md:22` 称"5 files, 38 tests"(实测 6 文件 75 用例)、e2e 列表漏 `multi-screen.spec.ts`;`AGENTS.md:32` 说公告走 GitHub Gist,实际 `src-tauri/src/update.rs:9-10` 已改为 raw.githubusercontent.com;`handoff.md` 仍描述已删除的 level(low/mid/high)概念,`src-tauri/src/lib.rs:1359-1363` 快捷键注释同样残留 level;`MIGRATION_CONVENTION.md` + `tools/check-migrations.sh` 面向数据库 migration,本仓无 migration 目录(无数据库),脚本运行即 exit 1,属死规范。
3. **编辑表单预设高亮单位错误** —— `src/App.tsx:633` `p.secs * 60000`(秒误当分钟换算),与 `:639` 正确的 `p.secs * 1000` 不一致 → 编辑时预设按钮高亮判断不可靠。
4. **CSP 为 null** —— `src-tauri/tauri.conf.json:26-28`。全仓无 `dangerouslySetInnerHTML`/远程页面加载(grep 实测 0 处),现实风险有限,但建议按 Tauri 官方建议配置显式 CSP 做纵深防御。
5. **前端多处 invoke 无失败处理**:`addTodo`(`src/App.tsx:1055`)、`handleExport`(`:1249-1251`)、`handleImport`(`:1253-1256`,失败后用户无任何提示);后端 `export_todos`/`import_todos` 的 `path.as_path().unwrap()`(`src-tauri/src/lib.rs:1296,1309`)理论可 panic(桌面端实际恒为 Some)。
6. **release.yml 在 main 上自动 bump 版本并直接 `git push origin HEAD:main`**(`.github/workflows/release.yml:113-145`)—— 绕过 PR review;若 main 开了分支保护会失败(远程设置未确认)。dev 分支每次推送都会产生一条 `chore(snapshot)` 提交并回推。
7. **`gen_id`(`src-tauri/src/lib.rs:179-183`)毫秒+进程内计数器,与导入保留的外部 id 存在理论碰撞可能**(极低概率)。

## 4. 安全评估

本地单机应用,无认证/多用户/远程攻击面,未发现 P0:

- updater 使用 minisign 签名校验,pubkey 入库是公钥(安全);私钥走 GitHub Secrets(`TAURI_SIGNING_PRIVATE_KEY*`),未在源码/日志出现(grep 实测无硬编码密钥)。
- capabilities(`src-tauri/capabilities/default.json`)仅授予 core/event/global-shortcut/dialog/updater,无 fs/shell/http 给 webview;公告 HTTP 在 Rust 侧完成。
- 公告/待办标题均按纯文本渲染(canvas `fillText` 或 React 文本节点),无 HTML 注入面;残留风险为 P2-13 的 url 协议与 P3-4 的 CSP。
- `macOSPrivateApi: true`(tauri.conf.json:10)用于透明 overlay:意味着无法上架 Mac App Store(仅影响分发渠道,记录备查)。

## 5. 验证门实际执行结果

| 门 | 命令 | 结果 | 证据摘要 |
|---|---|---|---|
| 类型检查 | `npm run check` | ✅ 通过 | `tsc --noEmit` 无输出,exit 0 |
| 单元/组件测试 | `npm test` | ✅ 75/75 通过(6 文件) | vitest `Test Files 6 passed (6), Tests 75 passed (75)`,3.67s;Overlay 用例有 act() 警告 |
| E2E | `npm run test:e2e` | ✅ 38/38 通过 | Playwright `38 passed (24.8s)`(自动起停 vite dev,端口 1420) |
| 前端构建 | `npm run build` | ✅ 通过 | `tsc -b && vite build` 成功,`dist/assets/index-*.js` 214KB(gzip 67KB) |
| Lint | `npm run lint` | ❌ **失败** | `eslint: command not found`(eslint 不在 devDependencies;见 P2-9) |
| Rust 测试 | `cd src-tauri && cargo test` | ✅ 34/34 通过 | `test result: ok. 34 passed; 0 failed`;**过程受阻**:前两次沙箱内运行因 crates.io 下载超时失败(网络抖动),第三次沙箱拦截 `target/debug/.cargo-build-lock` 写入;最终以非沙箱重跑成功 |

说明:build / cargo test 需要写入仓库内 `dist/`、`target/`(均为 gitignored 的可再生产物),且目标仓库不在本会话沙箱可写清单内,故这两条以非沙箱方式执行;全程未改动任何被 git 跟踪的文件(结束复核 `git status` 干净)。

## 6. 修复优先级建议

**第一梯队(发布前必须)**:
1. P1-1 默认 3 秒到期(改回 300/无到期 + 同步测试断言)
2. P1-2 撤销完成无效(后端补 `completed` 参数 + mock 严格化)
3. P1-4 编辑表单状态化重构(可用性硬伤)
4. P1-3 CSV 转义(用户数据损坏)

**第二梯队(尽快)**:
5. P1-5 接通 play_duration;P1-6 公告拉取改 async
6. P2-1 持久化竞态;P2-6 循环任务补放风暴;P2-8/9 CI 补齐 lint/e2e 并修复 lint 本身

**第三梯队(择机)**:
7. P2-2/3 测试真实性整改(Rust 直测真实命令、删除/改造同义反复测试、mock 与后端契约对齐)
8. P2-10 多屏热插拔;P3-1 清理死依赖;P3-2 文档同步
