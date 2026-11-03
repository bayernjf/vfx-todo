/**
 * TodoItem 组件测试
 * 直接渲染 App.tsx 中真实导出的 TodoItem，不复制实现。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TodoItem } from "../App";

const screens = [{ id: 0, name: "主屏幕", is_primary: true }];

const baseProps = {
  screens,
  onComplete: vi.fn(),
  onDelete: vi.fn(),
  onTrigger: vi.fn(),
  onUpdate: vi.fn(),
  onDuplicate: vi.fn(),
  onFillInput: vi.fn(),
  selected: false,
  onToggleSelect: vi.fn(),
  dragOverId: null,
  onDragStart: vi.fn(),
  onDragOver: vi.fn(),
  onDrop: vi.fn(),
  onDragEnd: vi.fn(),
  sortBy: "created",
  isLight: false,
};

const baseTodo = {
  id: "1",
  title: "测试待办",
  completed: false,
  created_at: Date.now(),
  due_at: null,
  screen: 0,
  recurrence: null,
  effect: null,
  tag: null,
};

describe("TodoItem", () => {
  it("renders title", () => {
    render(<TodoItem {...baseProps} todo={baseTodo} />);
    expect(screen.getByText("测试待办")).toBeInTheDocument();
  });

  it("shows completed class when done", () => {
    const done = { ...baseTodo, completed: true };
    const { container } = render(<TodoItem {...baseProps} todo={done} />);
    expect(container.querySelector(".todo-item.completed")).toBeTruthy();
    // 已完成时不显示「完成」按钮
    expect(screen.queryByText("完成")).toBeNull();
  });

  it("calls onComplete when click 完成", () => {
    const cb = vi.fn();
    render(<TodoItem {...baseProps} onComplete={cb} todo={baseTodo} />);
    fireEvent.click(screen.getByText("完成"));
    expect(cb).toHaveBeenCalledWith("1");
  });

  it("calls onDelete when click 删除", () => {
    const cb = vi.fn();
    render(<TodoItem {...baseProps} onDelete={cb} todo={baseTodo} />);
    fireEvent.click(screen.getByText("删除"));
    expect(cb).toHaveBeenCalledWith("1");
  });

  it("calls onTrigger when click title and not completed", () => {
    const cb = vi.fn();
    render(<TodoItem {...baseProps} onTrigger={cb} todo={baseTodo} />);
    fireEvent.click(screen.getByText("测试待办"));
    expect(cb).toHaveBeenCalledWith(baseTodo);
  });

  it("does NOT call onTrigger when completed", () => {
    const cb = vi.fn();
    const done = { ...baseTodo, completed: true };
    render(<TodoItem {...baseProps} onTrigger={cb} todo={done} />);
    fireEvent.click(screen.getByText("测试待办"));
    expect(cb).not.toHaveBeenCalled();
  });

  it("shows recurrence badge for daily", () => {
    const daily = { ...baseTodo, recurrence: "daily" };
    render(<TodoItem {...baseProps} todo={daily} />);
    expect(screen.getByText("每天")).toBeInTheDocument();
  });

  it("shows recurrence badge for weekly", () => {
    const weekly = { ...baseTodo, recurrence: "weekly" };
    render(<TodoItem {...baseProps} todo={weekly} />);
    expect(screen.getByText("每周")).toBeInTheDocument();
  });

  it("shows tag badge when tag is set", () => {
    const tagged = { ...baseTodo, tag: "工作" as const };
    const { container } = render(<TodoItem {...baseProps} todo={tagged} />);
    const badge = container.querySelector(".tag-badge");
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe("工作");
  });

  it("does NOT show tag badge when tag is null", () => {
    const { container } = render(<TodoItem {...baseProps} todo={baseTodo} />);
    expect(container.querySelector(".tag-badge")).toBeNull();
  });

  it("shows effect label when effect is set", () => {
    const withEffect = { ...baseTodo, effect: "rain" as const };
    render(<TodoItem {...baseProps} todo={withEffect} />);
    expect(screen.getByText("雨")).toBeInTheDocument();
  });
});
