// Tauri API mock utilities for E2E tests
// Simulates the Rust backend entirely in-page so Playwright can run
// against the Vite dev server without a real Tauri runtime.
// Single source of truth: window.__STORE__ (todos + prefs).
//
// CONTRACT: handlers and param whitelists mirror the real Rust commands in
// src-tauri/src/lib.rs. Unknown commands throw (except plugin:* passthrough),
// and each handler rejects params the real command does not accept, so the
// mock can never silently drift ahead of the real backend again.
// Wire keys are camelCase because Tauri v2 deserializes command params from
// camelCase JS keys to snake_case Rust params by default.

export interface MockTodo {
  title: string;
  tag?: string;
  due_time?: number;
  screen?: number;
  effect?: string;
}

// Mirrors the real Preferences struct in src-tauri/src/lib.rs.
export interface MockPreferences {
  default_screen: number;
  theme: string;
  default_effect: string;
  summon_shortcut: string | null;
}

export interface MockScreen {
  id: number;
  name: string;
  is_primary: boolean;
}

const DEFAULT_SCREENS: MockScreen[] = [
  { id: 0, name: "主屏", is_primary: true },
];

const DEFAULT_PREFS = {
  default_screen: 0,
  theme: "system",
  default_effect: "danmaku",
  summon_shortcut: null,
};

// Real command param contracts (wire keys, camelCase per Tauri v2).
// Keep in sync with src-tauri/src/lib.rs command signatures.
const COMMAND_PARAMS: Record<string, string[]> = {
  todo_list: ["tag"],
  todo_create: [
    "title", "dueAt", "screen", "recurrence", "effect", "tag",
    "repeatCount", "playDuration", "danmakuSpeed",
  ],
  todo_complete: ["id"],
  todo_update: [
    "id", "title", "dueAt", "screen", "recurrence", "effect", "tag",
    "repeatCount", "playDuration", "danmakuSpeed", "completed",
  ],
  todo_delete: ["id"],
  todo_clear_completed: [],
  todo_batch_complete: ["ids"],
  todo_batch_delete: ["ids"],
  todo_reorder: ["ids"],
  trigger_todo: ["id"],
  trigger_vfx: ["effect", "screen"],
  send_danmaku: ["text", "color", "speed", "screen"],
  flash_screen: ["screen", "screenName"],
  set_current_effect: ["effect"],
  list_screens: [],
  load_prefs: [],
  save_prefs: ["prefs"],
  get_platform: [],
  set_summon_shortcut: ["shortcut"],
  fetch_announcements: [],
  export_todos: ["format"],
  import_todos: ["format"],
};

function makeTodo(t: any, i = 0): any {
  return {
    id: t.id || `id-${i}-${t.title}`,
    title: t.title,
    completed: t.completed ?? false,
    created_at: t.created_at ?? Date.now() - (i + 1) * 60000,
    due_at: t.due_at ?? t.due_time ?? null,
    screen: t.screen ?? 0,
    recurrence: t.recurrence ?? null,
    effect: t.effect ?? null,
    tag: t.tag ?? null,
    order: t.order ?? 0,
    repeat_count: t.repeat_count ?? 1,
    play_duration: t.play_duration ?? 2,
    danmaku_speed: t.danmaku_speed ?? 120,
  };
}

export function getTauriMockScript(screens: MockScreen[] = DEFAULT_SCREENS): string {
  return `
    (() => {
      let __screens = ${JSON.stringify(screens)};
      let __invokeCount = {};
      let __lastArgs = {};

      const COMMAND_PARAMS = ${JSON.stringify(COMMAND_PARAMS)};

      if (!window.__STORE__) {
        window.__STORE__ = { todos: [], prefs: ${JSON.stringify(DEFAULT_PREFS)} };
      }

      const __clone = (list) =>
        JSON.parse(JSON.stringify(list || window.__STORE__.todos));

      const __assertContract = (name, args) => {
        const allowed = COMMAND_PARAMS[name];
        if (!allowed) {
          throw new Error('[mock] unknown command "' + name + '" (not in real backend contract)');
        }
        for (const key of Object.keys(args || {})) {
          if (!allowed.includes(key)) {
            throw new Error(
              '[mock] ' + name + ': unknown param "' + key +
              '" (real backend accepts: ' + allowed.join(', ') + ')'
            );
          }
        }
      };

      const __defaults = {
        repeat_count: 1,
        play_duration: 2,
        danmaku_speed: 120,
      };

      const handlers = {
        todo_list: async (args) => {
          const tag = args && args.tag;
          const list = tag
            ? window.__STORE__.todos.filter((t) => t.tag === tag)
            : window.__STORE__.todos;
          return __clone(list);
        },
        todo_create: async (args) => {
          const todo = {
            id: "id-" + Math.random().toString(36).slice(2),
            title: args.title,
            completed: false,
            created_at: Date.now(),
            due_at: args.dueAt ?? null,
            screen: args.screen ?? 0,
            recurrence: args.recurrence ?? null,
            effect: args.effect ?? null,
            tag: args.tag ?? null,
            order: window.__STORE__.todos.length,
            repeat_count: args.repeatCount ?? __defaults.repeat_count,
            play_duration: args.playDuration ?? __defaults.play_duration,
            danmaku_speed: args.danmakuSpeed ?? __defaults.danmaku_speed,
          };
          window.__STORE__.todos.push(todo);
          return todo;
        },
        // Real: Result<(), String> — returns null on success
        todo_complete: async (args) => {
          window.__STORE__.todos = window.__STORE__.todos.map((td) =>
            td.id === args.id ? { ...td, completed: true } : td
          );
          return null;
        },
        todo_update: async (args) => {
          const target = window.__STORE__.todos.find((td) => td.id === args.id);
          if (!target) throw new Error("todo not found");
          const updated = {
            ...target,
            title: args.title ?? target.title,
            tag: args.tag !== undefined ? args.tag : target.tag,
            due_at: args.dueAt !== undefined ? args.dueAt : target.due_at,
            recurrence: args.recurrence !== undefined ? args.recurrence : target.recurrence,
            screen: args.screen ?? target.screen,
            completed: args.completed ?? target.completed,
            effect: args.effect !== undefined ? args.effect : target.effect,
            repeat_count: args.repeatCount ?? target.repeat_count ?? __defaults.repeat_count,
            play_duration: args.playDuration ?? target.play_duration ?? __defaults.play_duration,
            danmaku_speed: args.danmakuSpeed ?? target.danmaku_speed ?? __defaults.danmaku_speed,
          };
          window.__STORE__.todos = window.__STORE__.todos.map((td) =>
            td.id === args.id ? updated : td
          );
          return updated;
        },
        // Real: Result<(), String> — returns null on success
        todo_delete: async (args) => {
          window.__STORE__.todos = window.__STORE__.todos.filter((td) => td.id !== args.id);
          return null;
        },
        // Real: Result<usize, String> — number of removed todos
        todo_clear_completed: async () => {
          const before = window.__STORE__.todos.length;
          window.__STORE__.todos = window.__STORE__.todos.filter((td) => !td.completed);
          return before - window.__STORE__.todos.length;
        },
        // Real: Result<usize, String> — number of newly completed todos
        todo_batch_complete: async (args) => {
          const ids = new Set(args.ids || []);
          let count = 0;
          window.__STORE__.todos = window.__STORE__.todos.map((td) => {
            if (ids.has(td.id) && !td.completed) {
              count += 1;
              return { ...td, completed: true };
            }
            return td;
          });
          return count;
        },
        // Real: Result<usize, String> — number of removed todos
        todo_batch_delete: async (args) => {
          const ids = new Set(args.ids || []);
          const before = window.__STORE__.todos.length;
          window.__STORE__.todos = window.__STORE__.todos.filter((td) => !ids.has(td.id));
          return before - window.__STORE__.todos.length;
        },
        // Real: Result<(), String> — returns null on success
        todo_reorder: async (args) => {
          const byId = Object.fromEntries(window.__STORE__.todos.map((t) => [t.id, t]));
          window.__STORE__.todos = (args.ids || []).map((id) => byId[id]).filter(Boolean);
          return null;
        },
        trigger_todo: async () => null,
        trigger_vfx: async () => null,
        send_danmaku: async (args) => {
          const screen = args.screen ?? 0;
          console.log("[MOCK] send_danmaku -> overlay-" + screen);
          return null;
        },
        flash_screen: async () => null,
        set_current_effect: async () => null,
        list_screens: async () => __screens,
        load_prefs: async () => ({ ...window.__STORE__.prefs }),
        save_prefs: async (args) => {
          window.__STORE__.prefs = { ...window.__STORE__.prefs, ...(args.prefs || {}) };
          return null;
        },
        get_platform: async () => "macos",
        set_summon_shortcut: async (args) => {
          window.__STORE__.prefs = {
            ...window.__STORE__.prefs,
            summon_shortcut: (args && args.shortcut) ?? null,
          };
          return null;
        },
        fetch_announcements: async () => [],
        export_todos: async () => null,
        import_todos: async () => 0,
      };

      const __channel = (name, args) => {
        // Tauri plugin commands (updater/event/...) are not app commands:
        // passthrough with null like before, they are outside our contract.
        if (name.startsWith("plugin:")) return Promise.resolve(null);
        __assertContract(name, args);
        __invokeCount[name] = (__invokeCount[name] || 0) + 1;
        __lastArgs[name] = args;
        return Promise.resolve(handlers[name](args));
      };

      window.__TAURI_INTERNALS__ = { invoke: (cmd, args) => __channel(cmd, args) };
      window.__TAURI__ = {
        core: { invoke: (cmd, args) => __channel(cmd, args) },
        event: {
          listen: () => Promise.resolve(() => {}),
          emit: () => Promise.resolve(),
        },
      };

      // Inspection helpers for E2E assertions
      window.__MOCK__ = {
        todos: () => __clone(),
        prefs: () => ({ ...window.__STORE__.prefs }),
        screens: () => __screens,
        invokeCount: (cmd) => __invokeCount[cmd] || 0,
        lastArgs: (cmd) => __lastArgs[cmd] || null,
      };

      console.log("Tauri mock initialized");
    })();
  `;
}

// Setup page with Tauri mocks and seed data
export async function setupPage(
  page: import("@playwright/test").Page,
  options?: { seed?: MockTodo[]; prefs?: Partial<MockPreferences>; screens?: MockScreen[] }
) {
  await page.addInitScript(getTauriMockScript(options?.screens ?? DEFAULT_SCREENS));

  // Seed todos + prefs into the global store before app code runs
  const mergedPrefs = Object.assign({}, DEFAULT_PREFS, options?.prefs || {});
  await page.addInitScript(
    (data) => {
      const seedTodos = (data.seed || []).map((t: any, i: number) => ({
        id: `id-${i}-${t.title}`,
        title: t.title,
        completed: t.completed ?? false,
        created_at: Date.now() - (data.seed.length - i) * 60000,
        due_at: t.due_time ?? null,
        screen: t.screen ?? 0,
        recurrence: t.recurrence ?? null,
        effect: t.effect ?? null,
        tag: t.tag ?? null,
        order: i,
        repeat_count: t.repeat_count ?? 1,
        play_duration: t.play_duration ?? 2,
        danmaku_speed: t.danmaku_speed ?? 120,
      }));
      if (!window.__STORE__) window.__STORE__ = { todos: seedTodos, prefs: data.prefs };
      window.__STORE__.todos = seedTodos;
      window.__STORE__.prefs = data.prefs;
    },
    {
      seed: options?.seed || [],
      prefs: mergedPrefs,
    }
  );
}
