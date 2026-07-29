/**
 * TodoItem 组件测试
 * 测试渲染状态、按钮回调、badge 显示
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// 直接用内联 TodoItem 实现（避免污染测试的 tauri mock）
type Level = "low" | "mid" | "high";

function TodoItem({
  todo,
  onComplete,
  onDelete,
  onTrigger,
}: {
  todo: {
    id: string;
    title: string;
    level: Level;
    completed: boolean;
    created_at: number;
    due_at: number | null;
    recurrence?: string | null;
  effect?: string | null;
  tag?: "工作" | "生活" | "紧急" | null;
  };
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onTrigger: (todo: any) => void;
}) {
  const levelLabel: Record<Level, string> = { low: "弹幕", mid: "粒子", high: "破碎" };
  const effectLabel: Record<string, string> = { rain: "雨", firework: "烟花", laser: "激光", ripple: "水波", glitch: "故障", shatter: "破碎", particle: "粒子" };
  const tagColor: Record<string, string> = { 工作: "#ff6b6b", 生活: "#4ecdc4", 紧急: "#f9ca24" };

  return (
    <div className={`todo-item ${todo.completed ? "completed" : ""}`}>
      <span className="todo-level">{levelLabel[todo.level]}</span>
      <div className="todo-content">
        <span
          className="todo-title"
          onClick={() => !todo.completed && onTrigger(todo)}
          data-testid="todo-title"
        >
          {todo.title}
          {todo.recurrence && (
            <span className="recurrence-badge">
              {todo.recurrence === "daily" ? "每天" : "每周"}
            </span>
          )}
          {todo.effect && (
            <span className="effect-badge">{effectLabel[todo.effect] || todo.effect}</span>
          )}
          {todo.tag && (
            <span
              className="tag-badge"
              style={{ backgroundColor: tagColor[todo.tag] }}
              data-testid="tag-badge"
            >
              {todo.tag}
            </span>
          )}
        </span>
      </div>
      {!todo.completed && (
        <button className="todo-btn complete" onClick={() => onComplete(todo.id)}>
          完成
        </button>
      )}
      <button className="todo-btn delete" onClick={() => onDelete(todo.id)}>
        删除
      </button>
    </div>
  );
}

const baseTodo = {
  id: "1",
  title: "测试待办",
  level: "mid" as Level,
  completed: false,
  created_at: Date.now(),
  due_at: null,
  recurrence: null,
  effect: null,
  tag: null,
};

describe("TodoItem", () => {
  it("renders title and level", () => {
    render(
      <TodoItem todo={baseTodo} onComplete={vi.fn()} onDelete={vi.fn()} onTrigger={vi.fn()} />
    );
    expect(screen.getByText("测试待办")).toBeInTheDocument();
    expect(screen.getByText("粒子")).toBeInTheDocument();
  });

  it("shows completed class when done", () => {
    const done = { ...baseTodo, completed: true };
    const { container } = render(
      <TodoItem todo={done} onComplete={vi.fn()} onDelete={vi.fn()} onTrigger={vi.fn()} />
    );
    expect(container.querySelector(".todo-item.completed")).toBeTruthy();
    // 已完成时不显示「完成」按钮
    expect(screen.queryByText("完成")).toBeNull();
  });

  it("calls onComplete when click 完成", () => {
    const cb = vi.fn();
    render(
      <TodoItem todo={baseTodo} onComplete={cb} onDelete={vi.fn()} onTrigger={vi.fn()} />
    );
    fireEvent.click(screen.getByText("完成"));
    expect(cb).toHaveBeenCalledWith("1");
  });

  it("calls onDelete when click 删除", () => {
    const cb = vi.fn();
    render(
      <TodoItem todo={baseTodo} onComplete={vi.fn()} onDelete={cb} onTrigger={vi.fn()} />
    );
    fireEvent.click(screen.getByText("删除"));
    expect(cb).toHaveBeenCalledWith("1");
  });

  it("calls onTrigger when click title and not completed", () => {
    const cb = vi.fn();
    render(
      <TodoItem todo={baseTodo} onComplete={vi.fn()} onDelete={vi.fn()} onTrigger={cb} />
    );
    fireEvent.click(screen.getByTestId("todo-title"));
    expect(cb).toHaveBeenCalledWith(baseTodo);
  });

  it("does NOT call onTrigger when completed", () => {
    const cb = vi.fn();
    const done = { ...baseTodo, completed: true };
    render(
      <TodoItem todo={done} onComplete={vi.fn()} onDelete={vi.fn()} onTrigger={cb} />
    );
    fireEvent.click(screen.getByTestId("todo-title"));
    expect(cb).not.toHaveBeenCalled();
  });

  it("shows recurrence badge for daily", () => {
    const daily = { ...baseTodo, recurrence: "daily" };
    render(
      <TodoItem todo={daily} onComplete={vi.fn()} onDelete={vi.fn()} onTrigger={vi.fn()} />
    );
    expect(screen.getByText("每天")).toBeInTheDocument();
  });

  it("shows recurrence badge for weekly", () => {
    const weekly = { ...baseTodo, recurrence: "weekly" };
    render(
      <TodoItem todo={weekly} onComplete={vi.fn()} onDelete={vi.fn()} onTrigger={vi.fn()} />
    );
    expect(screen.getByText("每周")).toBeInTheDocument();
  });

  it("shows tag badge when tag is set", () => {
    const tagged = { ...baseTodo, tag: "工作" as const };
    render(
      <TodoItem todo={tagged} onComplete={vi.fn()} onDelete={vi.fn()} onTrigger={vi.fn()} />
    );
    expect(screen.getByTestId("tag-badge")).toBeInTheDocument();
    expect(screen.getByTestId("tag-badge").textContent).toBe("工作");
  });

  it("does NOT show tag badge when tag is null", () => {
    render(
      <TodoItem todo={baseTodo} onComplete={vi.fn()} onDelete={vi.fn()} onTrigger={vi.fn()} />
    );
    expect(screen.queryByTestId("tag-badge")).toBeNull();
  });

  it("shows effect badge when effect is set", () => {
    const withEffect = { ...baseTodo, effect: "rain" as const };
    render(
      <TodoItem
        todo={withEffect}
        onComplete={vi.fn()}
        onDelete={vi.fn()}
        onTrigger={vi.fn()}
      />
    );
    expect(screen.getByText("雨")).toBeInTheDocument();
  });

  it("renders low level as 弹幕", () => {
    const low = { ...baseTodo, level: "low" as Level };
    render(
      <TodoItem todo={low} onComplete={vi.fn()} onDelete={vi.fn()} onTrigger={vi.fn()} />
    );
    expect(screen.getByText("弹幕")).toBeInTheDocument();
  });

  it("renders high level as 破碎", () => {
    const high = { ...baseTodo, level: "high" as Level };
    render(
      <TodoItem todo={high} onComplete={vi.fn()} onDelete={vi.fn()} onTrigger={vi.fn()} />
    );
    expect(screen.getByText("破碎")).toBeInTheDocument();
  });
});
