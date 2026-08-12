/**
 * App 集成测试
 * 覆盖：创建/搜索/排序/已完成管理/标签筛选/批量操作/编辑/undo/新参数
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
    return Promise.resolve(() => {
      eventListeners.get(event)?.delete(handler as (payload: unknown) => void);
    });
  },
}));

import App from "../App";

// ---------- helpers ----------
let idCounter = 1;
const now_ts = Date.now();

function mTodo(o: Record<string, unknown> = {}) {
  return {
    id: String(idCounter++),
    title: "默认",
    completed: false,
    created_at: now_ts - 60000,
    due_at: null,
    screen: 0,
    recurrence: null,
    effect: null,
    tag: null,
    ...o,
  };
}

const screens = [
  { id: 0, name: "主屏幕", is_primary: true },
  { id: 1, name: "外接显示器 1", is_primary: false },
];

function base() {
  return {
    list_screens: screens,
    load_prefs: { default_screen: 0 },
    save_prefs: () => {},
    set_current_effect: () => {},
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

beforeEach(() => {
  idCounter = 1;
  invokeStore = {};
  eventListeners.clear();
});

// DOM helpers
function getEffectSelect(): HTMLSelectElement {
  // effect select is the first select inside .input-config
  return document.querySelector(".input-config select") as HTMLSelectElement;
}

describe("基础渲染", () => {
  it("显示标题和输入框", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("VFX Todo")).toBeTruthy());
    expect(screen.getByPlaceholderText("输入待办内容，回车添加")).toBeTruthy();
  });
});

describe("创建", () => {
  it("输入待办后提交显示", async () => {
    renderApp({
      todo_create: (args: Record<string, unknown>) =>
        mTodo({ title: args?.title }),
    });
    const input = screen.getByPlaceholderText("输入待办内容，回车添加");
    await userEvent.type(input, "新待办{Enter}");
    await waitFor(() => expect(screen.getByText("新待办")).toBeTruthy());
  });

  it("创建待办传递新参数 playDuration 和 danmakuSpeed", async () => {
    let capturedArgs: Record<string, unknown> = {};
    renderApp({
      todo_create: (args: Record<string, unknown>) => {
        capturedArgs = args || {};
        return mTodo({ title: args?.title });
      },
    });
    const input = screen.getByPlaceholderText("输入待办内容，回车添加");
    await userEvent.type(input, "带参数{Enter}");
    await waitFor(() => expect(screen.getByText("带参数")).toBeTruthy());
    expect(capturedArgs.playDuration).toBe(2);
    expect(capturedArgs.danmakuSpeed).toBe(120);
  });

  it("空输入不创建待办", async () => {
    const createSpy = vi.fn();
    renderApp({ todo_create: createSpy });
    const input = screen.getByPlaceholderText("输入待办内容，回车添加");
    await userEvent.type(input, "   {Enter}");
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("创建待办带到期时间", async () => {
    let capturedArgs: Record<string, unknown> = {};
    renderApp({
      todo_create: (args: Record<string, unknown>) => {
        capturedArgs = args || {};
        return mTodo({ title: args?.title, due_at: args?.dueAt });
      },
    });
    const input = screen.getByPlaceholderText("输入待办内容，回车添加");
    await userEvent.type(input, "到期{Enter}");
    await waitFor(() => expect(screen.getByText("到期")).toBeTruthy());
    expect(capturedArgs.dueAt).toBeGreaterThan(Date.now() + 2000);
  });
});

describe("到期时间", () => {
  it("显示到期预设按钮", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("+3s")).toBeTruthy());
    expect(screen.getByText("+1m")).toBeTruthy();
    expect(screen.getByText("+5m")).toBeTruthy();
    expect(screen.getByText("+30m")).toBeTruthy();
  });

  it("到期提示显示默认 3 秒", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText(/3秒后触发/)).toBeTruthy());
  });
});

describe("特效选择", () => {
  it("默认特效为弹幕", async () => {
    renderApp();
    await waitFor(() => {
      const sel = getEffectSelect();
      expect(sel).toBeTruthy();
      expect(sel.value).toBe("danmaku");
    });
  });

  it("切换特效到粒子", async () => {
    renderApp({
      set_current_effect: () => {},
    });
    await waitFor(() => {
      expect(getEffectSelect()).toBeTruthy();
    });
    await userEvent.selectOptions(getEffectSelect(), "particle");
    expect(getEffectSelect().value).toBe("particle");
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
    const toggle = cbs.find((el) =>
      (el.parentElement as HTMLElement)?.textContent?.includes("显示已完成")
    )!;
    await userEvent.click(toggle);
    expect(screen.queryByText("任务A")).toBeFalsy();
    expect(screen.getByText("进行中")).toBeTruthy();
  });

  it("清空已完成按钮出现", async () => {
    renderApp({
      todo_list: [mTodo({ id: "e", title: "已完成项", completed: true })],
    });
    await waitFor(() =>
      expect(screen.getByText("清空已完成 (1)")).toBeTruthy()
    );
  });
});

describe("排序", () => {
  it("默认按创建时间排序", async () => {
    renderApp();
    await waitFor(() => {
      const sortSelect = document.querySelector(".sort-select") as HTMLSelectElement;
      expect(sortSelect).toBeTruthy();
      expect(sortSelect.value).toBe("created");
    });
  });
});

describe("操作", () => {
  it("点击完成按钮调用后端", async () => {
    const completeSpy = vi
      .fn()
      .mockReturnValue(mTodo({ title: "做完了", completed: true }));
    renderApp({
      todo_list: [mTodo({ id: "x", title: "要完成的事" })],
      todo_complete: completeSpy,
    });
    await waitFor(() => expect(screen.getByText("要完成的事")).toBeTruthy());
    await userEvent.click(screen.getByText("完成"));
    expect(completeSpy).toHaveBeenCalled();
  });

  it("点击删除按钮调用后端", async () => {
    const deleteSpy = vi.fn();
    renderApp({
      todo_list: [mTodo({ id: "y", title: "要删除的事" })],
      todo_delete: deleteSpy,
    });
    await waitFor(() => expect(screen.getByText("要删除的事")).toBeTruthy());
    await userEvent.click(screen.getByText("删除"));
    expect(deleteSpy).toHaveBeenCalled();
  });
});

describe("批量操作", () => {
  it("勾选后出现批量栏", async () => {
    renderApp({
      todo_list: [
        mTodo({ id: "b1", title: "批量项1" }),
        mTodo({ id: "b2", title: "批量项2" }),
      ],
    });
    await waitFor(() => expect(screen.getByText("批量项1")).toBeTruthy());

    // Find todo checkboxes (not the show-completed toggle)
    const checkboxes = screen
      .getAllByRole("checkbox")
      .filter(
        (cb) =>
          !(cb.parentElement as HTMLElement)?.textContent?.includes("显示已完成")
      );
    await userEvent.click(checkboxes[0]);
    await waitFor(() => {
      const batchBar = document.querySelector(".batch-bar");
      expect(batchBar).toBeTruthy();
    });
  });

  it("批量完成", async () => {
    const batchSpy = vi.fn().mockReturnValue(1);
    renderApp({
      todo_list: [mTodo({ id: "c1", title: "批完1" })],
      todo_batch_complete: batchSpy,
    });
    await waitFor(() => expect(screen.getByText("批完1")).toBeTruthy());

    const checkboxes = screen
      .getAllByRole("checkbox")
      .filter(
        (cb) =>
          !(cb.parentElement as HTMLElement)?.textContent?.includes("显示已完成")
      );
    await userEvent.click(checkboxes[0]);
    await waitFor(() => expect(screen.getByText("批量完成")).toBeTruthy());
    await userEvent.click(screen.getByText("批量完成"));
    expect(batchSpy).toHaveBeenCalled();
  });
});

describe("Undo", () => {
  it("批量完成后出现撤销按钮", async () => {
    const batchSpy = vi.fn().mockReturnValue(2);
    renderApp({
      todo_list: [
        mTodo({ id: "u1", title: "撤销项1" }),
        mTodo({ id: "u2", title: "撤销项2" }),
      ],
      todo_batch_complete: batchSpy,
      todo_update: () => mTodo(),
    });
    await waitFor(() => expect(screen.getByText("撤销项1")).toBeTruthy());

    const checkboxes = screen
      .getAllByRole("checkbox")
      .filter(
        (cb) =>
          !(cb.parentElement as HTMLElement)?.textContent?.includes("显示已完成")
      );
    await userEvent.click(checkboxes[0]);
    await userEvent.click(checkboxes[1]);

    await waitFor(() => expect(screen.getByText("批量完成")).toBeTruthy());
    await userEvent.click(screen.getByText("批量完成"));

    await waitFor(() => expect(screen.getByText("撤销")).toBeTruthy());
  });
});

describe("空状态", () => {
  it("空列表显示提示", async () => {
    renderApp({ todo_list: [] });
    await waitFor(() =>
      expect(screen.getByText("暂无待办，添加一个试试")).toBeTruthy()
    );
  });
});

describe("播放次数", () => {
  it("显示播放次数控件", async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("播放次数：")).toBeTruthy();
    });
  });

  it("点击+按钮增加播放次数", async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("播放次数：")).toBeTruthy();
    });
    // Find the increment button in the 播放次数 row
    const steppers = document.querySelectorAll(".repeat-stepper");
    const repeatStepper = steppers[0];
    const plusBtn = repeatStepper.querySelectorAll(".due-btn")[1];
    await userEvent.click(plusBtn);
    // Count should change (default 1 -> 2)
    const countDisplay = repeatStepper.querySelector(".repeat-count");
    expect(countDisplay?.textContent?.trim()).toBe("2");
  });
});

describe("播放时长", () => {
  it("显示播放时长选项", async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("播放时长（非弹幕）：")).toBeTruthy();
    });
    // Use getAllByText since "1s", "2s", "3s" also appear in edit form
    expect(screen.getAllByText("1s").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2s").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3s").length).toBeGreaterThan(0);
  });
});

describe("弹幕速度", () => {
  it("显示弹幕速度选项", async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("弹幕速度：")).toBeTruthy();
    });
    expect(screen.getByText("慢")).toBeTruthy();
    expect(screen.getByText("正常")).toBeTruthy();
    expect(screen.getByText("快")).toBeTruthy();
  });
});

describe("重复设置", () => {
  it("显示重复选项", async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("不重复")).toBeTruthy();
      expect(screen.getByText("每天")).toBeTruthy();
      expect(screen.getByText("每周")).toBeTruthy();
    });
  });
});

describe("特效演示区", () => {
  it("显示特效演示折叠按钮", async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText(/特效演示/)).toBeTruthy();
    });
  });
});

describe("到期时间渲染", () => {
  it("显示未来到期时间", async () => {
    const futureDue = Date.now() + 120000; // 2 minutes from now
    renderApp({
      todo_list: [mTodo({ id: "due1", title: "有到期", due_at: futureDue })],
    });
    await waitFor(() => expect(screen.getByText("有到期")).toBeTruthy());
    // Should show countdown in .todo-due element
    const dueEl = document.querySelector(".todo-due");
    expect(dueEl).toBeTruthy();
    expect(dueEl!.textContent).toMatch(/秒后/);
  });

  it("显示已到期的待办", async () => {
    const pastDue = Date.now() - 60000; // 1 minute ago
    renderApp({
      todo_list: [mTodo({ id: "due2", title: "过期了", due_at: pastDue })],
    });
    await waitFor(() => expect(screen.getByText("过期了")).toBeTruthy());
    expect(screen.getByText("已到期")).toBeTruthy();
  });
});

describe("标签显示", () => {
  it("有标签的待办显示标签徽章", async () => {
    renderApp({
      todo_list: [
        mTodo({ id: "tag1", title: "带标签", tag: "工作" }),
        mTodo({ id: "tag2", title: "紧急事", tag: "紧急" }),
      ],
    });
    await waitFor(() => {
      expect(screen.getByText("带标签")).toBeTruthy();
      expect(screen.getByText("紧急事")).toBeTruthy();
    });
    // Tag badges should appear (styled as spans with tag text)
    const badges = document.querySelectorAll(".tag-badge");
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });
});

describe("主题切换", () => {
  it("点击主题按钮切换模式", async () => {
    renderApp({
      save_prefs: () => {},
      load_prefs: { default_screen: 0, theme: "dark" },
    });
    await waitFor(() => {
      const themeBtn = document.querySelector(".theme-toggle");
      expect(themeBtn).toBeTruthy();
    });
    // Click theme toggle button
    const themeBtn = document.querySelector(".theme-toggle");
    await userEvent.click(themeBtn!);
    // Theme should change to light (uses data-theme attribute on html)
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });
  });
});

describe("搜索清空", () => {
  it("搜索后显示清空按钮", async () => {
    renderApp({
      todo_list: [mTodo({ id: "s1", title: "搜索测试" })],
    });
    await waitFor(() => expect(screen.getByText("搜索测试")).toBeTruthy());

    const searchInput = screen.getByPlaceholderText("搜索待办...");
    await userEvent.type(searchInput, "搜索");

    // Clear button (✕) should appear
    await waitFor(() => expect(screen.getByText("✕")).toBeTruthy());
  });
});

describe("排序切换", () => {
  it("切换到按到期时间排序", async () => {
    renderApp();
    await waitFor(() => {
      const sortSelect = document.querySelector(".sort-select") as HTMLSelectElement;
      expect(sortSelect).toBeTruthy();
    });
    const sortSelect = document.querySelector(".sort-select") as HTMLSelectElement;
    await userEvent.selectOptions(sortSelect, "due");
    expect(sortSelect.value).toBe("due");
  });
});

describe("重复设置", () => {
  it("选择每天重复", async () => {
    let capturedArgs: Record<string, unknown> = {};
    renderApp({
      todo_create: (args: Record<string, unknown>) => {
        capturedArgs = args || {};
        return mTodo({ title: args?.title, recurrence: args?.recurrence as string });
      },
    });
    await waitFor(() => {
      expect(screen.getByText("每天")).toBeTruthy();
    });
    // Click "每天"
    await userEvent.click(screen.getByText("每天"));

    const input = screen.getByPlaceholderText("输入待办内容，回车添加");
    await userEvent.type(input, "重复任务{Enter}");
    await waitFor(() => expect(screen.getByText("重复任务")).toBeTruthy());
    expect(capturedArgs.recurrence).toBe("daily");
  });
});

describe("个性化面板聚焦/失焦", () => {
  it("输入框聚焦时展开个性化面板", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText(/个性化/)).toBeTruthy());
    const input = screen.getByPlaceholderText("输入待办内容，回车添加");
    fireEvent.focus(input);
    await waitFor(() => expect(screen.getByText("到期提醒：")).toBeTruthy());
  });

  it("失焦到原生控件(relatedTarget=null)保持展开，失焦到面板外才收起", async () => {
    renderApp();
    const input = screen.getByPlaceholderText("输入待办内容，回车添加");
    fireEvent.focus(input);
    await waitFor(() => expect(screen.getByText("到期提醒：")).toBeTruthy());

    // 点击系统原生日期/时间选择器时，blur 的 relatedTarget 为 null（原生控件不在 DOM 中）。
    // 此前会因此误判收起面板，导致选择器刚打开就被卸载。修复后应保持展开。
    fireEvent.blur(input, { relatedTarget: null });
    await waitFor(() => expect(screen.getByText("到期提醒：")).toBeTruthy());

    // 真正点击面板外的 DOM 元素（如待办列表区）时应收起
    const outside = document.querySelector(".todo-list") as HTMLElement;
    fireEvent.blur(input, { relatedTarget: outside });
    await waitFor(() => expect(screen.queryByText("到期提醒：")).toBeFalsy());
  });
});

describe("已完成快捷动作", () => {
  it("重复图标按原配置重复添加（新建同样待办，按默认延迟重新触发）", async () => {
    let captured: Record<string, unknown> = {};
    renderApp({
      todo_list: [
        mTodo({
          id: "dup1",
          title: "再跑一次",
          completed: true,
          effect: "firework",
          tag: "工作",
          screen: 1,
          recurrence: "daily",
          repeat_count: 3,
          play_duration: 4,
          danmaku_speed: 180,
          due_at: now_ts - 1000,
        }),
      ],
      todo_create: (args: Record<string, unknown>) => {
        captured = args || {};
        return mTodo({ id: "dup2", title: args?.title as string, completed: false });
      },
    });
    await waitFor(() => expect(screen.getByText("再跑一次")).toBeTruthy());

    await userEvent.click(
      screen.getByRole("button", { name: "按原配置重复添加" })
    );

    await waitFor(() => expect(captured.title).toBe("再跑一次"));
    // 原配置全部保留
    expect(captured.effect).toBe("firework");
    expect(captured.tag).toBe("工作");
    expect(captured.screen).toBe(1);
    expect(captured.recurrence).toBe("daily");
    expect(captured.repeatCount).toBe(3);
    expect(captured.playDuration).toBe(4);
    expect(captured.danmakuSpeed).toBe(180);
    // 新建实例带到期时间（按默认延迟），会照常触发特效，而非 null
    expect(typeof captured.dueAt).toBe("number");
    expect(captured.dueAt as number).toBeGreaterThan(now_ts);
    // 新建的是未完成实例，应出现「完成」按钮
    await waitFor(() => expect(screen.getByText("完成")).toBeTruthy());
  });

  it("向下图标一键把标题填充到输入框", async () => {
    renderApp({
      todo_list: [mTodo({ id: "f1", title: "填充这个", completed: true })],
    });
    await waitFor(() => expect(screen.getByText("填充这个")).toBeTruthy());

    const input = screen.getByPlaceholderText(
      "输入待办内容，回车添加"
    ) as HTMLInputElement;
    expect(input.value).toBe("");

    await userEvent.click(screen.getByRole("button", { name: "填充到输入框" }));

    expect(input.value).toBe("填充这个");
  });
});

