/**
 * Tauri API mocks for Playwright E2E tests.
 * Uses page.addInitScript to mock __TAURI_INTERNALS__
 * AND creates a debounced/state-managed counter to prevent
 * StrictMode double-invocation issues.
 */

export interface MockTodo {
  id: string;
  title: string;
  level: "low" | "mid" | "high";
  completed: boolean;
  created_at: number;
  due_at: number | null;
  screen: number;
  recurrence: string | null;
  effect: string | null;
  tag: string | null;
  order: number;
}

interface MockPreferences {
  default_screen: number;
  default_level: string;
  theme?: string;
}

let todos: MockTodo[] = [];
let prefs: MockPreferences = {
  default_screen: 0,
  default_level: "high",
  theme: "system",
};
let nextId = 1;

function makeId(): string {
  return `e2e-${Date.now()}-${nextId++}`;
}

function makeTodo(overrides: Partial<MockTodo> = {}): MockTodo {
  return {
    id: overrides.id ?? makeId(),
    title: overrides.title ?? "",
    level: overrides.level ?? "low",
    completed: overrides.completed ?? false,
    created_at: overrides.created_at ?? Date.now(),
    due_at: overrides.due_at ?? null,
    screen: overrides.screen ?? 0,
    recurrence: overrides.recurrence ?? null,
    effect: overrides.effect ?? null,
    tag: overrides.tag ?? null,
    order: overrides.order ?? todos.length,
  };
}

export function resetStore(): void {
  todos = [];
  prefs = { default_screen: 0, default_level: "high", theme: "system" };
  nextId = 1;
}

export function seedStore(items: Partial<MockTodo>[]): MockTodo[] {
  const result: MockTodo[] = [];
  for (const item of items) {
    const t = makeTodo(item);
    todos.push(t);
    result.push(t);
  }
  return result;
}

export function setPreferences(p: Partial<MockPreferences>): void {
  prefs = { ...prefs, ...p };
}

export function getTodos(): MockTodo[] {
  return todos.map((t) => ({ ...t }));
}

/**
 * Generate init script that directly overrides window.__TAURI_INTERNALS__.
 * The invoke function is intercepted at window scope level, using a
 * shared state to track invocation counts and avoid StrictMode duplicates.
 */
export function getTauriMockScript(): string {
  return `
    (() => {
      let __todos = ${JSON.stringify(todos.map((t) => ({ ...t })))};
      let __prefs = ${JSON.stringify({ ...prefs })};
      let __nextId = ${nextId};
      let __screens = [{ id: 0, name: "主屏", is_primary: true }];
      let __invokeCount = {};

      function __makeId() {
        return "e2e-" + Date.now() + "-" + (__nextId++);
      }

      function __now() {
        return Date.now();
      }

      function __cloneTodos() {
        return __todos.map(function(t) { return Object.assign({}, t); });
      }

      function __findById(id) {
        for (let i = 0; i < __todos.length; i++) {
          if (__todos[i].id === id) return __todos[i];
        }
        return null;
      }

      // Override the global invoke at the Tauri internals level
      window.__TAURI_INTERNALS__ = {
        invoke: function(cmd, args, options) {
          // Track invocation count for debugging
          __invokeCount[cmd] = (__invokeCount[cmd] || 0) + 1;

          switch (cmd) {
            case "todo_list": {
              const tag = (args && args.tag && args.tag !== "undefined") ? args.tag : null;
              let result = __cloneTodos();
              if (tag) {
                result = result.filter(function(t) { return t.tag === tag; });
              }
              return Promise.resolve(result);
            }

            case "load_prefs": {
              return Promise.resolve(Object.assign({}, __prefs));
            }

            case "save_prefs": {
              if (args && args.prefs) {
                const p = args.prefs;
                if (p.theme !== undefined) __prefs.theme = p.theme;
                if (p.default_level !== undefined) __prefs.default_level = p.default_level;
                if (p.default_screen !== undefined) __prefs.default_screen = p.default_screen;
              }
              return Promise.resolve();
            }

            case "list_screens": {
              return Promise.resolve(__screens);
            }

            case "todo_create": {
              const todo = {
                id: __makeId(),
                title: (args && args.title) || "",
                level: (args && args.level) || "low",
                completed: false,
                created_at: __now(),
                due_at: (args && args.dueAt) || null,
                screen: (args && args.screen) || 0,
                recurrence: (args && args.recurrence) || null,
                effect: (args && args.effect) || null,
                tag: (args && args.tag) || null,
                order: __todos.length,
              };
              __todos.push(todo);
              return Promise.resolve(todo);
            }

            case "todo_complete": {
              const todo = __findById(args && args.id);
              if (todo) {
                todo.completed = true;
                return Promise.resolve(Object.assign({}, todo));
              }
              return Promise.reject("Todo not found");
            }

            case "todo_delete": {
              const id = args && args.id;
              const idx = __todos.findIndex(function(t) { return t.id === id; });
              if (idx !== -1) {
                const removed = __todos.splice(idx, 1)[0];
                return Promise.resolve(Object.assign({}, removed));
              }
              return Promise.reject("Todo not found");
            }

            case "todo_update": {
              const todo = __findById(args && args.id);
              if (todo) {
                if (args.title !== undefined) todo.title = args.title;
                if (args.level !== undefined) todo.level = args.level;
                if (args.completed !== undefined) todo.completed = args.completed;
                if (args.due_at !== undefined) todo.due_at = args.due_at;
                if (args.screen !== undefined) todo.screen = args.screen;
                if (args.recurrence !== undefined) todo.recurrence = args.recurrence;
                if (args.effect !== undefined) todo.effect = args.effect;
                if (args.tag !== undefined) todo.tag = args.tag;
                if (args.order !== undefined) todo.order = args.order;
                return Promise.resolve(Object.assign({}, todo));
              }
              return Promise.reject("Todo not found");
            }

            case "todo_reorder": {
              const ids = (args && args.ids) || [];
              for (let i = 0; i < ids.length; i++) {
                const todo = __findById(ids[i]);
                if (todo) todo.order = i;
              }
              __todos.sort(function(a, b) { return a.order - b.order; });
              return Promise.resolve(__cloneTodos());
            }

            case "todo_batch_complete": {
              const ids = (args && args.ids) || [];
              let count = 0;
              for (let i = 0; i < ids.length; i++) {
                const todo = __findById(ids[i]);
                if (todo) { todo.completed = true; count++; }
              }
              return Promise.resolve(count);
            }

            case "todo_batch_delete": {
              const ids = (args && args.ids) || [];
              const idSet = new Set(ids);
              let count = 0;
              __todos = __todos.filter(function(t) {
                if (idSet.has(t.id)) { count++; return false; }
                return true;
              });
              return Promise.resolve(count);
            }

            case "todo_clear_completed": {
              let count = 0;
              __todos = __todos.filter(function(t) {
                if (t.completed) { count++; return false; }
                return true;
              });
              return Promise.resolve(count);
            }

            case "export_todos": {
              return Promise.resolve();
            }

            case "import_todos": {
              return Promise.resolve(0);
            }

            case "trigger_todo": {
              return Promise.resolve();
            }

            case "send_danmaku": {
              return Promise.resolve();
            }

            case "trigger_vfx": {
              return Promise.resolve();
            }

            default: {
              return Promise.resolve(null);
            }
          }
        },
        // Added for debug: expose invoke counts
        __invokeCount: __invokeCount,
      };
    })();
  `;
}

export async function setupPage(
  page: import("@playwright/test").Page,
  options?: { seed?: Partial<MockTodo>[]; prefs?: Partial<MockPreferences> },
): Promise<void> {
  resetStore();
  if (options?.seed) seedStore(options.seed);
  if (options?.prefs) setPreferences(options.prefs);
  await page.addInitScript(getTauriMockScript());
}
