# vfx-todo Handoff Document

## Project Overview

**Name:** vfx-todo
**Tech Stack:** Tauri v2 + React 18 + TypeScript + Vite
**Repository:** github.com:bayernjf/vfx-todo

A VFX-focused todo application that triggers visual effects (danmaku, particles, shatter, rain, firework, ripple, laser, glitch) when todos are due. Supports multi-screen overlay, batch operations, recurring tasks, and system tray integration.

## Current Branch

`dev` - Active development branch (feature/20260729 merged, ongoing work)

## Commits (chronological)

| Hash | Type | Message |
|------|------|---------|
| 92e31a2 | chore | expand window permissions for multi-window support |
| ec9ed02 | feat | add multi-screen support for danmaku and effects |
| 60c1ccf | feat | add screen selector to main app |
| 911a98d | refactor | add canvas initialization debug info |
| 79d92d5 | style | add debug overlay styles |
| eb37649 | docs | add AGENTS.md placeholder |
| fdae4ef | perf | cache compiled WebGL programs and optimize danmaku rendering |
| ff472eb | perf | add in-memory todo cache with background persist thread |
| a176f13 | docs | update handoff with performance optimizations |
| 38eb8fd | feat | add custom datetime picker for due time |
| 3781022 | feat | add sound effects and danmaku lane system |
| 9ac4a64 | feat | add global shortcuts and system tray |
| 2001f93 | feat | add recurring tasks with daily/weekly auto-recreate |
| d210a64 | feat | add JSON/CSV import and export for todo data |
| 6f45c3e | perf | extract TodoItem component to isolate countdown re-renders |
| 6c19163 | feat | wire up 5 new VFX effects (rain/firework/ripple/laser/glitch) |
| c0a08fd | feat | add todo tag/grouping (work/life/urgent) with filter view |
| 20db920 | test | add 23 tests for helpers, shaders, TodoItem component |
| e3fbd94 | fix | stop tsc -b from polluting project root with build artifacts |
| 35e8a51 | feat | add edit, search, clear-completed, notification, preferences |
| 0eb8476 | feat | sort, pre-warning notification, batch select/complete/delete |
| dd5e017 | test | add E2E/integration tests covering overlay + app flows |
| ab96a5d | docs | update handoff with full feature list and test coverage |
| 33bc008 | feat | add dark/light/system theme with CSS variables and toggle |
| 277c2f3 | feat | add undo toast for complete/delete/batch operations |
| 283aaed | feat | add drag-and-drop manual reorder with backend persistence |
| 3e7afd8 | chore | add Playwright dependency and config |
| 9b56d90 | test | add E2E test suites with Tauri API mock |
| bf43384 | chore | exclude e2e/ from vitest run |
| 9831583 | docs | update handoff with E2E tests and latest features |
| 0c7d01a | feat | add summon-shortcut settings UI and unified tooltips |
| 9e15da4 | feat | add summon shortcut preference and reposition window to cursor |
| 36f5198 | test | add summon-shortcut mocks and fix theme-toggle selector |
| b1489b8 | fix | preserve original due offset on duplicate todo |
| f50500f | feat | add updater and http plugin configuration |
| 880a514 | feat | add update check and announcement UI |
| bd2cba6 | chore | ignore .webview2-data local cache |
| b272764 | fix | add color-scheme for native controls theme support |

## Implemented Features

### 1. Todo Management
- Create todos with title, level (low/mid/high), tag (work/life/urgent), optional due time, optional recurrence
- Edit todos (title, level, tag, due time)
- Complete / delete single todos
- Clear all completed todos
- Search/filter by text
- Filter by tag (all/work/life/urgent)
- Sort todos (by created_at, due_at, level)
- Batch select / batch complete / batch delete
- JSON/CSV import and export
- Recurring tasks (daily/weekly auto-recreate on completion)

### 2. Visual Effects System
- **Low level:** Danmaku (弹幕飘过) with lane system
- **Mid level:** Particle effects (粒子特效)
- **High level:** Shatter effects (破碎特效)
- **Additional effects:** Rain, Firework, Ripple, Laser, Glitch
- **Sound effects** triggered alongside visual effects

### 3. Multi-Screen Support
- Frontend screen selector dropdown to choose target display
- Backend routes effects to specific screen via `overlay-{screen_id}` window label
- Uses `emit_to` instead of broadcast `emit` for precise targeting
- Fallback to `overlay-0` if target screen not found
- **Real-hardware self-test (DONE):** `run_multi_screen_self_test` in `lib.rs`, gated by env var `VFX_TODO_SELFTEST`. On a real multi-monitor machine it enumerates real screens, spawns one overlay window per physical display, and uses Rust-side `window.listen` to prove `emit_to` delivers **only** to the targeted `overlay-{n}` (no broadcast). Verified on a 3-display macOS setup (2026-08-01): `list_screens` returned 3 monitors; danmaku→overlay-1, vfx→overlay-2, danmaku→overlay-0 each arrived at exactly one window with zero cross-screen leakage. Run with: `VFX_TODO_SELFTEST=1 npm run tauri dev`

### 4. Notifications & Pre-Warning
- Native notification when todo is due
- Pre-warning notification 1 minute before due time (deduplicated per todo)
- Configurable notification preferences

### 5. Performance Optimizations
- **WebGL program cache:** Compiled shader programs are cached and reused across triggers
- **Danmaku rendering:** `measureText` widths cached per item; `shadowBlur` applied once per frame; font setup hoisted
- **Rust memory cache:** All todo ops use `Arc<Mutex<Vec<Todo>>>` in-memory; background thread flushes to disk every 5 seconds
- **TodoItem isolation:** Extracted TodoItem component to isolate countdown re-renders

### 6. Desktop Integration
- Global keyboard shortcuts
- System tray with quick actions
- Custom datetime picker for due time

### 7. UX Enhancements
- Dark / Light / System theme with CSS variables; `color-scheme` per theme for native controls
- Undo toast for complete/delete/batch operations (auto-dismiss 4s)
- Drag-and-drop manual reorder with backend persistence
- **Summon shortcut:** Configurable global hotkey (Ctrl+Shift+K etc.) to bring the main window to front; macro-triggered via `notify_global_shortcut` for Cursor/IDE integration
- **Announcement system:** Remote JSON (GitHub Gist) fetched on startup; new-announcement popup with localStorage read tracking; history list in header popover
- **Application update:** `tauri-plugin-updater` with GitHub Releases + minisign pubkey; silent check on startup + manual ⟳ button; download progress bar; updates install on next launch

### 8. Testing
- **Rust integration tests (lib.rs):** CRUD, batch ops, level routing (color/speed/effect), VFX validation, tag validation, Preferences/DanmakuPayload/VfxPayload/ScreenInfo serialization, deterministic effect dispatch, idempotency, edge cases
- **Frontend unit/integration tests (vitest):** TodoItem component, helpers, shaders, App integration, Overlay integration (Canvas 2D danmaku + all 7 WebGL effects)
- **E2E tests (Playwright):** Full Tauri API mock, Todo CRUD, search/sort/filter, undo, batch operations, theme cycles, drag-and-drop reorder, multi-screen routing
- All tests passing (**112 total:** 36 Rust + 38 frontend + 38 E2E) — note: E2E tests may need mock updates for new features (summon shortcut, update, announcement)

## Key Files

### Frontend
| File | Purpose |
|------|---------|
| `src/App.tsx` | Main UI: todo CRUD, search, sort, filter, batch ops, multi-screen selector, theme toggle, undo toast, summon shortcut UI, update check, announcement system; includes TodoItem, component, helper functions, shader sources |
| `src/Overlay.tsx` | Overlay window: WebGL + Canvas 2D effect rendering, 7 VFX types |
| `src/styles.css` | All styles including overlay mode, batch bar, theme CSS vars, drag states, floating panels, modals, tooltips |
| `src/main.tsx` | React entry point |
| `src/__tests__/` | Vitest test files (5 files, 38 tests total) |

### E2E Tests
| File | Purpose |
|------|---------|
| `playwright.config.ts` | Playwright config: Chromium headless + Vite dev server |
| `e2e/mocks.ts` | Complete Tauri API mock (13 commands), seed data, preferences |
| `e2e/app.spec.ts` | Todo CRUD + edit mode (13 tests) |
| `e2e/filters.spec.ts` | Search, sort, tag filter, undo, batch operations (16 tests) |
| `e2e/theme-drag.spec.ts` | Theme toggle cycles + drag-and-drop reorder (7 tests) |
| `e2e/multi-screen.spec.ts` | Multi-screen selector, danmaku/vfx routing, edit reassignment (5 tests) |

### Backend (Rust)
| File | Purpose |
|------|---------|
| `src-tauri/src/lib.rs` | Core logic: Todo struct, AppState, all Tauri commands, scheduler, persist thread |
| `src-tauri/src/main.rs` | Tauri app entry point |

### Config
| File | Purpose |
|------|---------|
| `src-tauri/capabilities/default.json` | Window + system permissions (updater, http, dialog grants) |
| `src-tauri/tauri.conf.json` | Tauri app configuration (incl. updater public key + endpoint) |
| `src-tauri/Cargo.toml` | Rust dependencies (serde, chrono, uuid, rand, tauri-plugin-updater, tauri-plugin-http, etc.) |
| `package.json` | Frontend dependencies, E2E scripts |
| `vite.config.ts` | Vite + vitest configuration (excludes e2e/) |
| `tsconfig.json` | TypeScript config |
| `announcements.example.json` | Announcement JSON template for GitHub Gist |

## Commands

```bash
npm run dev           # Start frontend dev server
npm run tauri dev     # Start full Tauri app
npm run build         # Build frontend
npm run check         # TypeScript type check (tsc --noEmit)
npm test              # Run vitest frontend unit/integration tests
npm run test:e2e      # Run Playwright E2E tests
npm run test:e2e:ui   # Run Playwright in interactive UI mode
npm run test:e2e:headed # Run Playwright with visible browser
cargo test            # Run Rust tests
```

## Pending Tasks

1. ~~Run E2E tests on CI pipeline~~ **DONE** — `.github/workflows/ci.yml` runs `cargo test` + `npm test` + `npm run test:e2e` on every push/PR
2. ~~Verify multi-screen on real multi-monitor hardware~~ **DONE** — real-hardware self-test (`VFX_TODO_SELFTEST=1 npm run tauri dev`) verified 3-display routing isolation on 2026-08-01
3. **Create PR** to merge `dev` into `main`

## Notes

- Commit messages use English (Conventional Commits format: `type: message`)
- AGENTS.md file should be kept (project convention)
- Rust + frontend + E2E test suites are all passing; run before push
- E2E tests use a full Tauri API mock in `page.addInitScript` — no Tauri runtime needed
- Playwright `webServer` points at the Vite dev port **1420** (Tauri's fixed port); `reuseExistingServer: false` avoids colliding with other local dev servers
- **Tauri debug build loads from `dist/` locally** (no devUrl/beforeDevCommand); run `npm run build` after frontend changes
- **TRAE sandbox on Windows** blocks `app.exe` from writing to `AppData\Local\com.vfxtodo.app`; run the compiled binary directly from `src-tauri\target\debug\app.exe` to bypass
- **`.webview2-data/`** is a local cache generated on app startup; listed in `.gitignore`
- **Announcement URL** is hardcoded in `src/App.tsx` as `ANNOUNCEMENT_URL` pointing to GitHub Gist; update before deploying to a different Gist
