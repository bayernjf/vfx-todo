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
