# vfx-todo Handoff Document

## Project Overview

**Name:** vfx-todo
**Tech Stack:** Tauri v2 + React 18 + TypeScript + Vite
**Repository:** github.com:bayernjf/vfx-todo

A VFX-focused todo application that triggers visual effects (danmaku, particles, shatter) when todos are due.

## Current Branch

`feature/20260729` - Multi-screen support + performance optimization branch

## Commits (pushed)

| Hash | Type | Message |
|------|------|---------|
| 92e31a2 | chore | expand window permissions for multi-window support |
| ec9ed02 | feat | add multi-screen support for danmaku and effects |
| 60c1ccf | feat | add screen selector to main app |
| 911a98d | refactor | add canvas initialization debug info |
| 79d92d5 | style | add debug overlay styles |
| eb37649 | docs | add AGENTS.md placeholder |

## Commits (local, pending push)

| Type | Message |
|------|---------|
| perf | cache compiled WebGL programs and optimize danmaku rendering |
| perf | add in-memory todo cache with background persist thread |
| docs | update handoff with performance optimizations |

## Implemented Features

### 1. Todo Management
- Create todos with title, level (low/mid/high), and optional due time
- Complete todos manually
- Auto-trigger effects when due time arrives

### 2. Visual Effects System
- **Low level:** Danmaku (弹幕飘过)
- **Mid level:** Particle effects (粒子特效)
- **High level:** Shatter effects (破碎特效)

### 3. Multi-Screen Support
- Frontend screen selector dropdown to choose target display
- Backend routes effects to specific screen via `overlay-{screen_id}` window label
- Uses `emit_to` instead of broadcast `emit` for precise targeting
- Fallback to `overlay-0` if target screen not found

### 4. Performance Optimizations (New)
- **WebGL program cache:** Compiled shader programs are cached and reused across triggers, eliminating redundant compilation
- **Danmaku rendering:** `measureText` widths cached per item; `shadowBlur` applied once per frame instead of per item; font setup hoisted out of render loop
- **Rust memory cache:** All todo operations read/write an in-memory `Arc<Mutex<Vec<Todo>>>` instead of disk; a background thread flushes to disk every 5 seconds when dirty, reducing IO from once-per-second to once-per-5s

## Key Files

### Frontend
- `src/App.tsx` - Main UI with todo list and danmaku sender
- `src/Overlay.tsx` - Overlay window for rendering effects (WebGL + Canvas 2D)
- `src/styles.css` - Styles including overlay mode

### Backend (Rust)
- `src-tauri/src/lib.rs` - Core logic:
  - `Todo` struct with `screen` field
  - `AppState` with in-memory todo cache and dirty flag
  - `list_screens` command - enumerates available displays
  - `dispatch_danmaku` / `dispatch_by_level` - screen-aware event dispatch
  - `start_scheduler` - auto-triggers due todos (reads memory)
  - `start_persist_thread` - flushes todos to disk every 5s

### Config
- `src-tauri/capabilities/default.json` - Window permissions
- `src-tauri/tauri.conf.json` - Tauri configuration

## Pending Tasks

1. **Test multi-screen functionality** on actual multi-monitor setup
2. **Create PR** to merge into integration branch (dev/main - TBD)

## Commands

```bash
npm run dev          # Start frontend dev server
npm run tauri dev   # Start full Tauri app
npm run build       # Build frontend
npm run check       # TypeScript type check
```

## Notes

- Commit messages use English (Conventional Commits format)
- AGENTS.md file should be kept (project convention)
- No test files currently exist
