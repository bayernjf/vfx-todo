# vfx-todo Handoff Document

## Project Overview

**Name:** vfx-todo
**Tech Stack:** Tauri v2 + React 18 + TypeScript + Vite
**Repository:** github.com:bayernjf/vfx-todo

A VFX-focused todo application that triggers visual effects (danmaku, particles, shatter, rain, firework, ripple, laser, glitch) when todos are due. Supports multi-screen overlay, batch operations, recurring tasks, and system tray integration.

## Current Branch

`feature/20260729` - Multi-screen support + performance optimization + full feature set branch

## Commits (chronological, all pushed)

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

### 7. Testing
- **Rust integration tests (lib.rs):** CRUD, batch ops, level routing (color/speed/effect), VFX validation, tag validation, Preferences/DanmakuPayload/VfxPayload/ScreenInfo serialization, deterministic effect dispatch, idempotency, edge cases
- **Frontend tests (vitest):** TodoItem component, helpers, shaders, App integration, Overlay integration (Canvas 2D danmaku + all 7 WebGL effects)
- All tests passing (74 total: 36 Rust + 38 frontend)

## Key Files

### Frontend
| File | Purpose |
|------|---------|
| `src/App.tsx` | Main UI: todo CRUD, search, sort, filter, batch ops, multi-screen selector |
| `src/Overlay.tsx` | Overlay window: WebGL + Canvas 2D effect rendering, 7 VFX types |
| `src/components/TodoItem.tsx` | Single todo row with countdown timer |
| `src/styles.css` | All styles including overlay mode, batch bar, sort controls |
| `src/helpers.ts` | Utility functions (level routing, effect dispatch, data export/import) |
| `src/shaders.ts` | WebGL shader sources (vertex + fragment for all effects) |
| `src/main.tsx` | React entry point |
| `src/__tests__/` | Test files (5 files, 38 tests total) |

### Backend (Rust)
| File | Purpose |
|------|---------|
| `src-tauri/src/lib.rs` | Core logic: Todo struct, AppState, all Tauri commands, scheduler, persist thread |
| `src-tauri/src/main.rs` | Tauri app entry point |

### Config
| File | Purpose |
|------|---------|
| `src-tauri/capabilities/default.json` | Window + system permissions |
| `src-tauri/tauri.conf.json` | Tauri app configuration |
| `Cargo.toml` | Rust dependencies (serde, chrono, uuid, rand, etc.) |
| `package.json` | Frontend dependencies |
| `vite.config.ts` | Vite + vitest configuration |
| `tsconfig.json` | TypeScript config |

## Commands

```bash
npm run dev          # Start frontend dev server
npm run tauri dev    # Start full Tauri app
npm run build        # Build frontend
npm run check        # TypeScript type check (tsc -b)
npm test             # Run vitest frontend tests
cargo test           # Run Rust tests
```

## Pending Tasks

1. **Test multi-screen functionality** on actual multi-monitor setup
2. **Create PR** to merge into integration branch (dev/main - TBD)

## Notes

- Commit messages use English (Conventional Commits format: `type: message`)
- AGENTS.md file should be kept (project convention)
- Rust + frontend test suites are passing; run before push
- `e3fbd94` fixed tsc build artifacts polluting project root (`tsconfig.json` added `outDir`)
