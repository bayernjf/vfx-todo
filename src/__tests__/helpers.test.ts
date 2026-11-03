/**
 * 纯函数 & 常量单元测试
 * 直接 import App.tsx 的真实实现/常量，不再在测试内复制一份。
 */
import { describe, it, expect } from "vitest";
import { formatDue, EFFECT_LABEL, TAG_COLOR } from "../App";

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

describe("constants", () => {
  it("EFFECT_LABEL covers all 8 effects (danmaku first)", () => {
    expect(EFFECT_LABEL).toEqual({
      danmaku: "弹幕",
      shatter: "破碎",
      particle: "粒子",
      rain: "雨",
      firework: "烟花",
      ripple: "水波",
      laser: "激光",
      glitch: "故障",
    });
  });

  it("TAG_COLOR covers 工作/生活/紧急 with hex colors", () => {
    expect(TAG_COLOR).toEqual({
      工作: "#ff6b6b",
      生活: "#4ecdc4",
      紧急: "#f9ca24",
    });
  });
});
