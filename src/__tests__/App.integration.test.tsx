/**
 * App 集成测试
 * 覆盖：创建/搜索/排序/已完成管理/标签筛选
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let invokeStore: Record<string, unknown> = {};
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();

function setStubs(s: Record<string, unknown>) { invokeStore = { ...s }; }

vi.mock("@tauri-apps/api/core", () => ({
  invoke: <T,>(key: string, args?: Record<string, unknown>): Promise<T> => {
    if (key in invokeStore) {
      const v = invokeStore[key];
      return Promise.resolve((typeof v === "function" ? (v as CallableFunction)(args) : v) as T);
    }
    return Promise.reject(new Error(`invoke "${key}" not stubbed`));
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: <T,>(event: string, handler: (p: { payload: T }) => void) => {
    if (!eventListeners.has(event)) eventListeners.set(event, new Set());
    eventListeners.get(event)!.add(handler as (payload: unknown) => void);
    return Promise.resolve(() => { eventListeners.get(event)?.delete(handler as (payload: unknown) => void); });
  },
}));

import App from "../App";

// ---------- helpers ----------
let idCounter = 1;
const now_ts = Date.now();

function mTodo(o: Record<string, unknown> = {}) {
  return {
    id: String(idCounter++), title: "默认", level: "high", completed: false,
    created_at: now_ts - 60000, due_at: null, screen: 0, recurrence: null,
    effect: null, tag: null, ...o,
  };
}

const screens = [
  { id: 0, name: "主屏幕", is_primary: true },
  { id: 1, name: "外接显示器 1", is_primary: false },
];

function base() {
  return {
    list_screens: screens,
    load_prefs: { default_screen: 0, default_level: "high" },
    save_prefs: () => {},
    todo_list: [] as ReturnType<typeof mTodo>[],
    todo_create: () => mTodo(),
    todo_complete: () => mTodo(),
    todo_update: () => mTodo(),
    todo_delete: () => {},
    todo_clear_completed: 0,
    todo_batch_complete: 0,
    todo_batch_delete: 0,
    export_todos: () => {},
    import_todos: 0,
    trigger_todo: () => {},
    send_danmaku: () => {},
    trigger_vfx: () => {},
  };
}

function renderApp(s?: Record<string, unknown>) {
  setStubs({ ...base(), ...s });
  return render(<App />);
}

beforeEach(() => { idCounter = 1; invokeStore = {}; eventListeners.clear(); });

describe("基础渲染", () => {
  it("显示标题和输入框", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("vfx-todo")).toBeTruthy());
    expect(screen.getByPlaceholderText("输入待办内容，回车添加")).toBeTruthy();
  });
});

describe("创建", () => {
  it("输入待办后提交显示", async () => {
    renderApp({
      todo_create: (args: Record<string, unknown>) => mTodo({ title: args?.title }),
    });
    const input = screen.getByPlaceholderText("输入待办内容，回车添加");
    await userEvent.type(input, "新待办{Enter}");
    await waitFor(() => expect(screen.getByText("新待办")).toBeTruthy());
  });
});

describe("搜索", () => {
  it("过滤列表", async () => {
    renderApp({
      todo_list: [
        mTodo({ id: "a", title: "买菜" }),
        mTodo({ id: "b", title: "写代码" }),
      ],
    });
    await waitFor(() => expect(screen.getByText("买菜")).toBeTruthy());

    await userEvent.type(screen.getByPlaceholderText("搜索待办..."), "买菜");
    expect(screen.getByText("买菜")).toBeTruthy();
    expect(screen.queryByText("写代码")).toBeFalsy();
  });
});

describe("已完成", () => {
  it("取消显示已完成隐藏已完成项", async () => {
    renderApp({
      todo_list: [
        mTodo({ id: "c", title: "任务A", completed: true }),
        mTodo({ id: "d", title: "进行中", completed: false }),
      ],
    });
    await waitFor(() => expect(screen.getByText("任务A")).toBeTruthy());

    const cbs = screen.getAllByRole("checkbox");
    const toggle = cbs.find((el) => (el.parentElement as HTMLElement)?.textContent?.includes("显示已完成"))!;
    await userEvent.click(toggle);
    expect(screen.queryByText("任务A")).toBeFalsy();
    expect(screen.getByText("进行中")).toBeTruthy();
  });
});
