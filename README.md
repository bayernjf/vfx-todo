# vfx-todo

带视觉特效的桌面端 Todo 应用（Tauri v2）。完成任务时触发全屏特效反馈，
支持全局快捷键呼出，数据本地保存。

- 落地页 / 官网：仓库 `vfx-todo-landing`
- 应用信息：`productName` 为 `vfx-todo`（见 `src-tauri/tauri.conf.json`）

## 技术栈

| 层 | 方案 |
|---|---|
| 前端 | React 18 + TypeScript + Vite 5 |
| 桌面 | Tauri v2（Rust 后端，`src-tauri/`） |
| 特效 | WebGL + Canvas 2D（`src/Overlay.tsx`） |
| 样式 | 纯 CSS（CSS 变量做主题） |
| 测试 | Vitest（单测）+ Playwright（E2E）+ `cargo test`（Rust） |
| Tauri 插件 | dialog、fs、global-shortcut、opener、updater |

## 特效类型

与后端 Rust `VfxPayload.effect` 保持一致，共 7 种：
`shatter`、`particle`、`rain`、`firework`、`ripple`、`laser`、`glitch`。

## 快速开始

```bash
npm install
npm run dev          # Vite 开发服务器
npm run build        # tsc -b + vite build
npm run check        # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run
npm run test:e2e     # playwright test
npm run tauri        # Tauri CLI（桌面端 dev / build）
```

## 目录结构

```
src/
├── App.tsx        # 主窗口：UI 逻辑、TodoItem、helpers、shaders
├── Overlay.tsx    # Overlay 窗口：WebGL + Canvas 2D 特效渲染
├── styles.css     # 全部样式（overlay、batch bar、主题变量、拖拽态、弹窗）
├── main.tsx       # React 入口
├── __tests__/     # Vitest 测试
└── __mocks__/
src-tauri/
├── src/           # Rust 后端（todos / prefs 落盘到应用目录的 json 文件）
├── capabilities/  # 权限声明
├── icons/  gen/
├── tauri.conf.json  Cargo.toml  build.rs
e2e/             # Playwright E2E
```

## 注意

- 改窗口 / 权限相关能力要同时动 `src-tauri/capabilities/` 与 `tauri.conf.json`，否则插件调用会被拒。
- 特效渲染在独立 Overlay 窗口，改 `Overlay.tsx` 时同步 `styles.css` 的 overlay 段。
- 所有样式集中在单个 `styles.css`，主题走 CSS 变量，新增主题色不要硬编码。
- 技术栈细节见 `docs/TECH_STACK.md`，项目约定见 `AGENTS.md` 与 `handoff.md`。
