// Tauri API mock utilities for E2E tests
// Simulates the Rust backend entirely in-page so Playwright can run
// against the Vite dev server without a real Tauri runtime.
// Single source of truth: window.__STORE__ (todos + prefs).
// Todo shape mirrors the frontend `Todo` interface (completed / created_at / due_at).

export interface MockTodo {
  title: string;
  tag?: string;
  due_time?: number;
  screen?: number;
  effect?: string;
}

export interface MockPreferences {
  theme: string;
  default_screen: number;
  notify: boolean;
  notify_minutes: number;
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
  theme: "system",
  default_screen: 0,
  notify: true,
  notify_minutes: 1,
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

      if (!window.__STORE__) {
        window.__STORE__ = { todos: [], prefs: ${JSON.stringify(DEFAULT_PREFS)} };
      }

      const __clone = (list) =>
        JSON.parse(JSON.stringify(list || window.__STORE__.todos));

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
            order: 0,
            repeat_count: args.repeatCount ?? 1,
            play_duration: args.playDuration ?? 2,
            danmaku_speed: args.danmakuSpeed ?? 120,
          };
          window.__STORE__.todos.push(todo);
          return todo;
        },
        todo_complete: async (args) => {
          const next = window.__STORE__.todos.map((td) =>
            td.id === args.id ? { ...td, completed: true } : td
          );
          window.__STORE__.todos = next;
          return next.find((t) => t.id === args.id);
        },
        todo_delete: async (args) => {
          window.__STORE__.todos = window.__STORE__.todos.filter((td) => td.id !== args.id);
          return true;
        },
        todo_update: async (args) => {
          const next = window.__STORE__.todos.map((td) =>
            td.id === args.id
              ? {
                  ...td,
                  title: args.title ?? td.title,
                  tag: args.tag ?? td.tag,
                  due_at: args.due_at ?? td.due_at,
                  recurrence: args.recurrence ?? td.recurrence,
                  screen: args.screen ?? td.screen,
                  completed: args.completed ?? td.completed,
                  effect: args.effect ?? td.effect,
                  repeat_count: args.repeat_count ?? td.repeat_count ?? 1,
                  play_duration: args.play_duration ?? td.play_duration ?? 2,
                  danmaku_speed: args.danmaku_speed ?? td.danmaku_speed ?? 120,
                }
              : td
          );
          window.__STORE__.todos = next;
          return next.find((t) => t.id === args.id);
        },
        todo_reorder: async (args) => {
          const byId = Object.fromEntries(window.__STORE__.todos.map((t) => [t.id, t]));
          window.__STORE__.todos = (args.ids || []).map((id) => byId[id]).filter(Boolean);
          return true;
        },
        todo_batch_complete: async (args) => {
          const ids = new Set(args.ids || []);
          window.__STORE__.todos = window.__STORE__.todos.map((td) =>
            ids.has(td.id) ? { ...td, completed: true } : td
          );
          return true;
        },
        todo_batch_delete: async (args) => {
          const ids = new Set(args.ids || []);
          window.__STORE__.todos = window.__STORE__.todos.filter((td) => !ids.has(td.id));
          return true;
        },
        todo_clear_completed: async () => {
          window.__STORE__.todos = window.__STORE__.todos.filter((td) => !td.completed);
          return true;
        },
        todo_import: async (args) => {
          window.__STORE__.todos = (args.data || {}).todos || [];
          return true;
        },
        todo_export: async () => ({ todos: __clone(), prefs: window.__STORE__.prefs }),
        load_prefs: async () => ({ ...window.__STORE__.prefs }),
        save_prefs: async (args) => {
          window.__STORE__.prefs = { ...window.__STORE__.prefs, ...(args || {}) };
          return true;
        },
        list_screens: async () => __screens,
        trigger_todo: async () => true,
        trigger_vfx: async () => true,
        send_danmaku: async (args) => {
          const screen = args.screen ?? 0;
          console.log("[MOCK] send_danmaku -> overlay-" + screen);
          return true;
        },
        open_overlay: async () => true,
        show_window: async () => true,
        hide_window: async () => true,
        start_scheduler: async () => true,
        stop_scheduler: async () => true,
      };

      const __channel = (name, args) => {
        const fn = handlers[name];
        if (fn) {
          __invokeCount[name] = (__invokeCount[name] || 0) + 1;
          __lastArgs[name] = args;
          return Promise.resolve(fn(args));
        }
        return Promise.resolve(null);
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
        completed: false,
        created_at: Date.now() - (data.seed.length - i) * 60000,
        due_at: t.due_time ?? null,
        screen: t.screen ?? 0,
        recurrence: null,
        effect: null,
        tag: t.tag ?? null,
        order: i,
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
