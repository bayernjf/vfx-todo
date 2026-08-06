# AGENTS.md

This file provides guidance to AI agents working on this repository.

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite
- **Desktop:** Tauri v2 (Rust backend)
- **Testing:** Vitest (unit/integration) + Playwright (E2E) + Cargo test (Rust)
- **Styling:** Plain CSS with CSS variables for theming

## Project Structure

```
src/
  App.tsx         # Main window: all UI logic, TodoItem component, helpers, shaders
  Overlay.tsx     # Overlay window: WebGL + Canvas 2D VFX rendering (7 effect types)
  styles.css      # All styles (overlay, batch bar, theme vars, drag states)
  main.tsx        # React entry point
  __tests__/      # Vitest tests (5 files, 38 tests)
  __mocks__/      # Tauri API mocks for testing
e2e/
  mocks.ts        # Tauri API mock for Playwright (13 commands)
  app.spec.ts     # Todo CRUD + edit mode tests (13 tests)
  filters.spec.ts # Search/sort/filter/undo/batch tests (16 tests)
  theme-drag.spec.ts # Theme toggle + drag-reorder tests (7 tests)
src-tauri/src/
  lib.rs          # All Rust logic: Todo struct, AppState, commands, scheduler, persist thread
  main.rs         # Tauri app entry point
```

## Key Conventions

- **Single-file frontend:** `App.tsx` contains TodoItem component, helper functions, and shader sources inline (no separate component/helper files)
- **All Rust logic in lib.rs:** Todo struct, CRUD commands, scheduler, persistence — all in one file
- **Commit messages:** English, Conventional Commits format (`type: message`)
- **AGENTS.md:** Keep this file (project convention)

## Commands

```bash
npm run dev           # Frontend dev server
npm run tauri dev     # Full Tauri app (frontend + Rust)
npm run build         # Build frontend (tsc + vite)
npm run check         # TypeScript type check (tsc --noEmit)
npm test              # Vitest unit/integration tests
npm run test:e2e      # Playwright E2E tests
cargo test            # Rust tests (run from src-tauri/)
```

## Running Tests

- Run all three test suites before pushing: `npm test && npm run test:e2e && cd src-tauri && cargo test`
- E2E tests use Tauri API mocks — no Tauri runtime needed
- Rust tests must be run from `src-tauri/` directory

## Architecture Notes

- **VFX effects:** 8 types (danmaku, particle, shatter, rain, firework, ripple, laser, glitch) routed by todo level
- **Multi-screen:** Effects target specific displays via `overlay-{screen_id}` window labels
- **Performance:** WebGL shader caching, in-memory Rust cache with 5s background persist, TodoItem component isolation
- **Theme:** Dark/Light/System via CSS variables
- **Persistence:** JSON file in app data directory, in-memory cache with background flush

## UI Layout: Floating Panel Design

The bottom area uses two collapsible floating panels that expand upward:

```
待办列表
─────────────────────────
[特效演示 ▾]  [个性化 ▾]     ← click to expand upward
─────────────────────────
输入框 (increased height)
```

### Panel: 个性化 (Personalization)

Contains parameter controls grouped together:
- 到期提醒 (due time presets)
- 播放次数 (repeat count)
- 播放时长（非弹幕）(play duration)
- 弹幕速度 (danmaku speed)
- 重复 (recurrence)

### Panel: 特效演示 (Effect Demo)

Existing debug section with effect trigger buttons.

### Interaction Rules

1. **Mutual exclusion:** Only one panel can be expanded at a time. Expanding one auto-collapses the other.
2. **Input focus trigger:** When the todo input gains focus, 个性化 auto-expands (特效演示 collapses).
3. **Submit collapse:** Clicking 添加 or pressing Enter collapses 个性化.
4. **Expand direction:** Panels float upward from the button position with semi-transparent background.
5. **Manual toggle:** Clicking a panel header toggles its expand/collapse state.
