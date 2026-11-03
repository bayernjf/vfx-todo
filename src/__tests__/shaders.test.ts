/**
 * Overlay shader 一致性测试
 * 直接 import Overlay.tsx 的 SHADER_MAP 和 App.tsx 的真实常量。
 */
import { describe, it, expect } from "vitest";
import { SHADER_MAP } from "../Overlay";
import { EFFECT_LABEL, EFFECT_COLOR } from "../App";

const EFFECTS = [
  "shatter",
  "particle",
  "rain",
  "firework",
  "ripple",
  "laser",
  "glitch",
] as const;

describe("SHADER_MAP", () => {
  it("contains exactly the 7 WebGL effects", () => {
    expect(Object.keys(SHADER_MAP).sort()).toEqual([...EFFECTS].sort());
  });

  it("every effect maps to a real fragment shader source", () => {
    for (const effect of EFFECTS) {
      expect(SHADER_MAP[effect]).toBeTruthy();
      expect(SHADER_MAP[effect]).toContain("void main()");
      expect(SHADER_MAP[effect]).toContain("gl_FragColor");
    }
  });

  it("every effect has a label and a valid hex color", () => {
    for (const effect of EFFECTS) {
      expect(EFFECT_LABEL[effect]).toBeTruthy();
      expect(EFFECT_COLOR[effect]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
