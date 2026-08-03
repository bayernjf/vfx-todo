/**
 * Overlay 集成测试
 * 覆盖：弹幕渲染 / WebGL 特效触发 / 事件监听 / Canvas resize / 卸载清理
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

// ---------- mock state ----------
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();

// ---------- mock 注入 ----------
vi.mock("@tauri-apps/api/event", () => ({
  listen: <T,>(event: string, handler: (p: { payload: T }) => void) => {
    if (!eventListeners.has(event)) eventListeners.set(event, new Set());
    eventListeners.get(event)!.add(handler as (payload: unknown) => void);
    return Promise.resolve(() =>
      eventListeners.get(event)?.delete(handler as (payload: unknown) => void),
    );
  },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: <T,>(event: string, handler: (p: { payload: T }) => void) => {
      if (!eventListeners.has(event)) eventListeners.set(event, new Set());
      eventListeners.get(event)!.add(handler as (payload: unknown) => void);
      return Promise.resolve(() =>
        eventListeners.get(event)?.delete(handler as (payload: unknown) => void),
      );
    },
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve() }));

import Overlay from "../Overlay";

// ---------- send event (wrapped in { payload }) ----------
function emit<E>(event: string, payload: E) {
  eventListeners.get(event)?.forEach((cb) => cb({ payload }));
}

// ---------- op recorders ----------
let c2dOps: string[] = [];
let wglOps: string[] = [];

// Mock AudioContext
class MockAudioContext {
  readonly currentTime = 0;
  readonly destination = { connect: vi.fn() } as unknown as AudioDestinationNode;
  readonly sampleRate = 44100;
  readonly state = "running" as AudioContextState;
  createOscillator() { return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, type: "sine" } as unknown as OscillatorNode; }
  createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() } as unknown as GainNode; }
  createBiquadFilter() { return { connect: vi.fn(), frequency: { value: 0 }, type: "highpass" } as unknown as BiquadFilterNode; }
  createBuffer() { return { getChannelData: () => new Float32Array(100) } as unknown as AudioBuffer; }
  createBufferSource() { return { buffer: null, connect: vi.fn(), start: vi.fn() } as unknown as AudioBufferSourceNode; }
  close() {}
}

beforeEach(() => {
  eventListeners.clear();
  c2dOps = [];
  wglOps = [];

  (globalThis as Record<string, unknown>).AudioContext = MockAudioContext as unknown as typeof AudioContext;

  const spyFn = function (this: HTMLCanvasElement, contextId: string): RenderingContext | null {
    if (contextId === "2d") {
      const ctx: Record<string, unknown> = {
        font: "", textBaseline: "top", shadowColor: "", shadowBlur: 0, fillStyle: "",
        clearRect: () => c2dOps.push("clearRect"),
        fillText: (t: string) => c2dOps.push("fillText(" + t + ")"),
        measureText: (t: string) => { c2dOps.push("measureText(" + t + ")"); return { width: t.length * 12 }; },
        save: () => c2dOps.push("save"), restore: () => c2dOps.push("restore"),
        setTransform: () => c2dOps.push("setTransform"),
      };
      Object.defineProperty(ctx, "canvas", { get: () => ({ width: 800, height: 600, clientWidth: 800, clientHeight: 600 }) });
      return ctx as unknown as RenderingContext;
    }
    if (contextId === "webgl" || contextId === "experimental-webgl") {
      let progId = 1, fragId = 1;
      const gl = {
        VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, TRIANGLES: 4, ARRAY_BUFFER: 34962, STATIC_DRAW: 35044,
        BLEND: 3042, SRC_ALPHA: 770, ONE_MINUS_SRC_ALPHA: 771, COLOR_BUFFER_BIT: 16384,
        clearColor: () => wglOps.push("clearColor"), enable: () => wglOps.push("enable"),
        blendFunc: () => wglOps.push("blendFunc"), clear: () => wglOps.push("clear"),
        useProgram: () => wglOps.push("useProgram"), drawArrays: () => wglOps.push("drawArrays"),
        viewport: () => wglOps.push("viewport"),
        createShader: () => { wglOps.push("createShader"); return fragId++; },
        shaderSource: () => wglOps.push("shaderSource"),
        compileShader: () => wglOps.push("compileShader"),
        getShaderParameter: () => { wglOps.push("getShaderParameter"); return true; },
        getShaderInfoLog: () => { wglOps.push("getShaderInfoLog"); return null; },
        deleteShader: () => wglOps.push("deleteShader"),
        createProgram: () => { wglOps.push("createProgram"); return progId++; },
        attachShader: () => wglOps.push("attachShader"),
        linkProgram: () => wglOps.push("linkProgram"),
        getProgramParameter: () => { wglOps.push("getProgramParameter"); return true; },
        getProgramInfoLog: () => { wglOps.push("getProgramInfoLog"); return null; },
        deleteProgram: () => wglOps.push("deleteProgram"),
        createBuffer: () => { wglOps.push("createBuffer"); return {}; },
        deleteBuffer: () => wglOps.push("deleteBuffer"),
        bindBuffer: () => wglOps.push("bindBuffer"),
        bufferData: () => wglOps.push("bufferData"),
        getAttribLocation: () => { wglOps.push("getAttribLocation"); return 0; },
        enableVertexAttribArray: () => wglOps.push("enableVertexAttribArray"),
        vertexAttribPointer: () => wglOps.push("vertexAttribPointer"),
        getUniformLocation: () => { wglOps.push("getUniformLocation"); return {}; },
        uniform1f: () => wglOps.push("uniform1f"), uniform2f: () => wglOps.push("uniform2f"),
        uniform3f: () => wglOps.push("uniform3f"),
      };
      return gl as unknown as RenderingContext;
    }
    return null;
  };

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(spyFn);
});

afterEach(() => { vi.restoreAllMocks(); eventListeners.clear(); });

// ===================== Canvas =====================
describe("Canvas 创建", () => {
  it("渲染两个 canvas", () => {
    render(<Overlay />);
    expect(document.querySelectorAll("canvas").length).toBe(2);
  });
});

// ===================== 弹幕 =====================
describe("弹幕事件", () => {
  it("emit 后调用 measureText", async () => {
    render(<Overlay />);
    emit("danmaku", { id: 1, text: "测试弹幕", color: "#f00", speed: 200 });
    await waitFor(() => expect(c2dOps).toContain("measureText(测试弹幕)"), { timeout: 3000 });
  });

  it("多条弹幕全部渲染", async () => {
    render(<Overlay />);
    for (let i = 0; i < 6; i++) emit("danmaku", { id: i + 1, text: "弹幕" + i, color: "#f00", speed: 200 });
    await waitFor(() => {
      const cnt = c2dOps.filter((o) => o.startsWith("measureText")).length;
      expect(cnt).toBe(6);
    }, { timeout: 3000 });
  });
});

// ===================== 特效 =====================
describe("WebGL VFX", () => {
  it("shatter 触发 WebGL pipeline", async () => {
    render(<Overlay />);
    // 稍微等待 useEffect 中的 VfxEngine 初始化
    await new Promise((r) => setTimeout(r, 100));
    emit("vfx", { id: 1, effect: "shatter", text: "break", color: "#f00" });
    await waitFor(() => {
      expect(wglOps).toContain("compileShader");
      expect(wglOps).toContain("drawArrays");
    }, { timeout: 10000 });
  });

  const effects = ["particle", "rain", "firework", "ripple", "laser", "glitch"] as const;
  effects.forEach((ef) => {
    it("触发 " + ef + " 不崩溃", async () => {
      render(<Overlay />);
      await new Promise((r) => setTimeout(r, 50));
      emit("vfx", { id: 1, effect: ef, text: "t-" + ef, color: "#0fc" });
      await waitFor(() => expect(wglOps).toContain("drawArrays"), { timeout: 10000 });
    });
  });
});

// ===================== 卸载 =====================
describe("卸载", () => {
  it("unmount 后 emit 不报错", () => {
    const { unmount } = render(<Overlay />);
    unmount();
    expect(() => {
      emit("danmaku", { id: 1, text: "x", color: "#fff", speed: 100 });
      emit("vfx", { id: 1, effect: "particle", text: "y", color: "#fff" });
    }).not.toThrow();
  });
});
