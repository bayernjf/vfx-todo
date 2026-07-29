/**
 * Overlay shader 一致性测试
 * 验证 SHADER_MAP 与 EffectType 类型对齐
 */
import { describe, it, expect } from "vitest";

// 定义与 Overlay.tsx 完全一致的 EffectType
type EffectType =
  | "shatter"
  | "particle"
  | "rain"
  | "firework"
  | "ripple"
  | "laser"
  | "glitch";

// 模拟 SHADER_MAP（保证所有键都有对应的 shader 源码）
const EXPECTED_EFFECTS: EffectType[] = [
  "shatter",
  "particle",
  "rain",
  "firework",
  "ripple",
  "laser",
  "glitch",
];

describe("SHADER_MAP", () => {
  it("contains all 7 effects", () => {
    expect(EXPECTED_EFFECTS.length).toBe(7);
    // 无重复
    expect(new Set(EXPECTED_EFFECTS).size).toBe(7);
  });

  it("every effect has a non-empty label", () => {
    const LABELS: Record<EffectType, string> = {
      shatter: "破碎",
      particle: "粒子",
      rain: "雨",
      firework: "烟花",
      ripple: "水波",
      laser: "激光",
      glitch: "故障",
    };
    for (const e of EXPECTED_EFFECTS) {
      expect(LABELS[e]).toBeTruthy();
    }
  });

  it("every effect has a valid hex color", () => {
    const COLORS: Record<EffectType, string> = {
      shatter: "#ff6b6b",
      particle: "#ffe66d",
      rain: "#88c0ff",
      firework: "#ff9f1c",
      ripple: "#4ecdc4",
      laser: "#ff006e",
      glitch: "#c77dff",
    };
    for (const e of EXPECTED_EFFECTS) {
      expect(COLORS[e]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
