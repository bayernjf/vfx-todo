/**
 * ErrorBoundary 测试
 * 覆盖：错误捕获、降级 UI、重试按钮、正常渲染透传
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "../App";

// 辅助：可控抛错的组件
function Thrower({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("测试错误消息");
  }
  return <div data-testid="thrower-ok">正常内容</div>;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ErrorBoundary", () => {
  it("正常渲染时透传子组件", () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">hello</div>
      </ErrorBoundary>
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("子组件抛错时显示降级 UI", () => {
    render(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("error-boundary")).toBeTruthy();
    expect(screen.getByText("出错了")).toBeTruthy();
    expect(screen.getByText("测试错误消息")).toBeTruthy();
  });

  it("降级 UI 包含重试按钮", () => {
    render(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>
    );
    const retryBtn = screen.getByTestId("error-retry");
    expect(retryBtn).toBeTruthy();
    expect(retryBtn.textContent).toBe("重试");
  });

  it("捕获错误时调用 console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("未知错误显示默认消息", () => {
    function ThrowPlain(): React.ReactElement {
      throw "string error";
    }
    render(
      <ErrorBoundary>
        <ThrowPlain />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("error-boundary")).toBeTruthy();
    expect(screen.getByText("未知错误")).toBeTruthy();
  });

  it("拆卸后重新挂载正常子组件恢复渲染", () => {
    const { unmount } = render(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("error-boundary")).toBeTruthy();
    unmount();

    // 重新挂载时用不抛错的子组件
    render(
      <ErrorBoundary>
        <Thrower shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("thrower-ok")).toBeTruthy();
    expect(screen.queryByTestId("error-boundary")).toBeNull();
  });

  it("错误边界本身不抛错", () => {
    // 多次渲染也不应该崩溃
    const { rerender } = render(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>
    );
    rerender(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("error-boundary")).toBeTruthy();
  });

  it("重试按钮点击不抛错", () => {
    render(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>
    );
    // 点击重试按钮不应崩溃
    expect(() => {
      fireEvent.click(screen.getByTestId("error-retry"));
    }).not.toThrow();
  });
});
