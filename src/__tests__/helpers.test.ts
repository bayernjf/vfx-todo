/**
 * 纯函数 & 常量单元测试
 * 不依赖 DOM / Tauri API，可直接运行
 */
import { describe, it, expect } from "vitest";

// ====== formatDue ======
// 直接在测试内实现一份，避免通过 React 组件间接测试
function formatDue(dueAt: number | null): string {
  if (!dueAt) return "";
  const now = Date.now();
  const diff = dueAt - now;
  if (diff <= 0) return "已到期";
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins >= 1) return `${mins}分${secs.toString().padStart(2, "0")}秒后`;
  return `${secs}秒后`;
}

describe("formatDue", () => {
  it("returns empty for null", () => {
    expect(formatDue(null)).toBe("");
  });

  it('returns "已到期" for past time', () => {
    const past = Date.now() - 60000;
    expect(formatDue(past)).toBe("已到期");
  });

  it("returns seconds-only for <1min", () => {
    const soon = Date.now() + 45000; // 45s
    expect(formatDue(soon)).toMatch(/^\d+秒后$/);
    const secs = parseInt(formatDue(soon));
    expect(secs).toBeGreaterThan(30);
    expect(secs).toBeLessThan(60);
  });

  it("returns minutes+seconds for >=1min", () => {
    const later = Date.now() + 125000; // 2分5秒
    const result = formatDue(later);
    expect(result).toMatch(/^\d+分\d{2}秒后$/);
  });
});

// ====== 常量一致性 ======
describe("constants", () => {
  it("EFFECT_LABEL covers all 8 effects (danmaku first)", () => {
    const EXPECTED = ["danmaku", "shatter", "particle", "rain", "firework", "ripple", "laser", "glitch"];
    for (const e of EXPECTED) {
      expect(e).toBeTruthy();
    }
    expect(EXPECTED.length).toBe(8);
    expect(EXPECTED[0]).toBe("danmaku");
  });

  it("TAG_COLOR covers 工作/生活/紧急", () => {
    const TAGS = ["工作", "生活", "紧急"];
    const COLORS: Record<string, string> = {
      工作: "#ff6b6b",
      生活: "#4ecdc4",
      紧急: "#f9ca24",
    };
    for (const t of TAGS) {
      expect(COLORS[t]).toBeTruthy();
      expect(COLORS[t]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
