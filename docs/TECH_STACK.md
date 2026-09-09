# 技术栈 — vfx-todo

更新时间：2026-09-09

## 概览
桌面端 Todo 应用，带 WebGL / Canvas 2D 视觉特效（Overlay 窗口，7 种效果类型）与全局快捷键。

## 技术选型
| 层 | 选型 |
|---|---|
| 前端 | React 18 + TypeScript + Vite 5 |
| 桌面 | Tauri v2（Rust 后端，`src-tauri/`） |
| 样式 | 纯 CSS（CSS 变量做主题） |
| 测试 | Vitest（单测，`src/__tests__/`）+ Playwright（E2E，`e2e/`）+ Cargo test（Rust） |
| Tauri 插件 | dialog、fs、global-shortcut、opener、updater |

## 常用命令
```bash
npm run dev          # Vite 开发服务器
npm run build        # tsc -b + vite build
npm run check        # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run
npm run test:e2e     # playwright test
npm run tauri        # Tauri CLI（打包 / dev 桌面端）
```

## 目录结构
```
src/
  App.tsx        # 主窗口：UI 逻辑、TodoItem、helpers、shaders
  Overlay.tsx    # Overlay 窗口：WebGL + Canvas 2D 特效渲染（7 种效果）
  styles.css     # 全部样式（overlay、batch bar、主题变量、拖拽态、弹窗）
  main.tsx       # React 入口
  __tests__/     # Vitest 测试
  __mocks__/
src-tauri/
  src/ capabilities/ icons/ gen/
  tauri.conf.json  Cargo.toml  build.rs
e2e/             # Playwright E2E
```

## 注意点
- 改窗口 / 权限相关能力要同时动 `src-tauri/capabilities/` 与 `tauri.conf.json`，否则插件调用会被拒。
- 特效渲染在主窗口之外独立窗口，改动 `Overlay.tsx` 时注意与 `styles.css` 的 overlay 段保持一致。
- 所有样式集中在单个 `styles.css`，主题用 CSS 变量，新增主题色走变量而不是硬编码。
- 项目指引见根目录 `AGENTS.md` 与 `handoff.md`。
