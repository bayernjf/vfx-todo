import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

interface DanmakuItem {
  id: number;
  text: string;
  color: string;
  x: number;
  y: number;
  speed: number;
}

interface VfxPayload {
  id: number;
  effect: "shatter" | "particle";
  text: string;
  color: string;
}

// ============ WebGL 特效引擎 ============

const VERT_SRC = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// 屏幕破碎特效 shader：闪光 + 裂纹扩散 + 边缘 vignette
const SHATTER_FRAG_SRC = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;      // 0 → 1 进度
uniform vec2 u_center;     // 破碎中心（0-1）
uniform vec3 u_color;
uniform float u_seed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 toCenter = uv - u_center;
  float dist = length(toCenter);

  // 裂纹：角度 + 距离的双层噪声
  float angle = atan(toCenter.y, toCenter.x);
  float crack1 = noise(vec2(angle * 8.0, dist * 20.0 + u_seed * 10.0));
  float crack2 = noise(vec2(angle * 16.0, dist * 30.0 - u_seed * 5.0));
  float crackMask = step(0.72, crack1 * crack2);

  // 裂纹扩散波：随时间从中心向外
  float wave = u_time * 0.7;
  float waveMask = smoothstep(wave + 0.08, wave - 0.08, dist);

  // 闪光：开始时全屏白光，指数衰减
  float flash = exp(-u_time * 4.0);

  // 边缘震动线条
  float ring = smoothstep(0.005, 0.0, abs(dist - wave));
  ring *= step(0.3, u_time);

  vec3 color = u_color * crackMask * waveMask * 1.8;
  color += vec3(1.0) * flash * 0.5;
  color += u_color * ring * 1.5;

  // vignette
  float vig = 1.0 - smoothstep(0.4, 0.9, dist);
  color *= mix(0.6, 1.0, vig);

  float alpha = max(crackMask * waveMask, max(flash * 0.6, ring));
  gl_FragColor = vec4(color, alpha);
}
`;

// 粒子聚合特效 shader：粒子从四周向中心聚集，形成文字光晕
const PARTICLE_FRAG_SRC = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_center;
uniform vec3 u_color;
uniform float u_seed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 toCenter = uv - u_center;
  float dist = length(toCenter);

  // 粒子：多层 hash 网格
  float particles = 0.0;
  for (float i = 1.0; i <= 4.0; i++) {
    vec2 grid = uv * (20.0 * i) + u_seed * i;
    vec2 cell = floor(grid);
    vec2 cellUv = fract(grid) - 0.5;
    float r = hash(cell + i);
    // 粒子向中心移动
    vec2 offset = vec2(hash(cell), hash(cell + 1.0)) - 0.5;
    float pull = 1.0 - u_time;
    vec2 pos = cellUv + offset * pull * 0.3;
    float d = length(pos);
    float size = (0.15 + r * 0.1) * (1.0 - u_time * 0.5);
    particles += smoothstep(size, size * 0.5, d) * r;
  }

  // 中心光晕：聚集时变亮
  float glow = exp(-dist * 4.0) * u_time;
  float flash = exp(-u_time * 3.0) * 0.3;

  vec3 color = u_color * particles * 1.2;
  color += u_color * glow * 0.8;
  color += vec3(1.0) * flash;

  float alpha = max(particles * 0.7, max(glow, flash));
  gl_FragColor = vec4(color, alpha);
}
`;

class VfxEngine {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private raf = 0;
  private startTime = 0;
  private duration = 1500; // ms
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private currentColor: string = "#ff6b6b";

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    if (!gl) {
      console.error("WebGL not supported");
      return;
    }
    this.gl = gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private compile(type: number, src: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("shader compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private buildProgram(fragSrc: string) {
    const gl = this.gl!;
    const vert = this.compile(gl.VERTEX_SHADER, VERT_SRC)!;
    const frag = this.compile(gl.FRAGMENT_SHADER, fragSrc)!;
    const program = gl.createProgram()!;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("program link error:", gl.getProgramInfoLog(program));
      return;
    }
    if (this.program) gl.deleteProgram(this.program);
    this.program = program;

    // 全屏 quad（两个三角形）
    const verts = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]);
    if (!this.buffer) this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // 缓存 uniform 位置
    this.uniforms = {
      u_resolution: gl.getUniformLocation(program, "u_resolution"),
      u_time: gl.getUniformLocation(program, "u_time"),
      u_center: gl.getUniformLocation(program, "u_center"),
      u_color: gl.getUniformLocation(program, "u_color"),
      u_seed: gl.getUniformLocation(program, "u_seed"),
    };
  }

  trigger(effect: "shatter" | "particle", color: string) {
    if (!this.gl) return;
    this.currentColor = color;
    this.buildProgram(effect === "shatter" ? SHATTER_FRAG_SRC : PARTICLE_FRAG_SRC);

    const dpr = window.devicePixelRatio;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this.startTime = performance.now();
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  private hexToRgb(hex: string): [number, number, number] {
    const m = hex.match(/^#([0-9a-f]{6})$/i);
    if (!m) return [1, 1, 1];
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  private loop = () => {
    const gl = this.gl;
    if (!gl || !this.program) return;
    const elapsed = performance.now() - this.startTime;
    const t = Math.min(elapsed / this.duration, 1);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.u_time, t);
    gl.uniform2f(this.uniforms.u_center, 0.5, 0.5);
    gl.uniform3f(this.uniforms.u_color, ...this.hexToRgb(this.currentColor));
    gl.uniform1f(this.uniforms.u_seed, Math.random() * 100);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (t < 1) {
      this.raf = requestAnimationFrame(this.loop);
    } else {
      // 结束后清屏，释放 GPU
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    if (this.gl) {
      if (this.program) this.gl.deleteProgram(this.program);
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
    }
  }
}

// ============ Overlay 组件 ============

function Overlay() {
  const danmakuCanvasRef = useRef<HTMLCanvasElement>(null);
  const vfxCanvasRef = useRef<HTMLCanvasElement>(null);
  const itemsRef = useRef<DanmakuItem[]>([]);
  const vfxEngineRef = useRef<VfxEngine | null>(null);
  const [, setDebugInfo] = useState("init");

  useEffect(() => {
    document.body.classList.add("overlay-mode");

    // 弹幕 Canvas 2D 引擎
    const danmakuCanvas = danmakuCanvasRef.current;
    if (!danmakuCanvas) {
      setDebugInfo("ERROR: danmakuCanvas ref is null");
      return;
    }
    const ctx = danmakuCanvas.getContext("2d");
    if (!ctx) {
      setDebugInfo("ERROR: 2d context null");
      return;
    }

    const dpr = window.devicePixelRatio;
    const resize = () => {
      danmakuCanvas.width = danmakuCanvas.clientWidth * dpr;
      danmakuCanvas.height = danmakuCanvas.clientHeight * dpr;
      setDebugInfo(`canvas=${danmakuCanvas.width}x${danmakuCanvas.height} dpr=${dpr}`);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, danmakuCanvas.width, danmakuCanvas.height);

      const fontHeight = 24 * dpr;
      ctx.font = `${fontHeight}px "PingFang SC", system-ui, sans-serif`;
      ctx.textBaseline = "top";

      const items = itemsRef.current;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.x -= it.speed * dt * dpr;
        const w = ctx.measureText(it.text).width;
        if (it.x + w < 0) {
          items.splice(i, 1);
          continue;
        }
        ctx.fillStyle = it.color;
        ctx.shadowColor = "rgba(0,0,0,0.7)";
        ctx.shadowBlur = 4 * dpr;
        ctx.fillText(it.text, it.x, it.y);
      }
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // WebGL 特效引擎
    if (vfxCanvasRef.current) {
      vfxEngineRef.current = new VfxEngine(vfxCanvasRef.current);
    }

    // 监听事件
    let unlistenDanmaku: (() => void) | undefined;
    let unlistenVfx: (() => void) | undefined;

    (async () => {
      const u1 = await listen<DanmakuItem>("danmaku", (event) => {
        const p = event.payload;
        const canvas = danmakuCanvasRef.current;
        if (!canvas) return;
        itemsRef.current.push({
          id: p.id,
          text: p.text,
          color: p.color,
          x: canvas.clientWidth * dpr,
          y: Math.random() * (canvas.clientHeight - 40) * dpr,
          speed: p.speed,
        });
      });
      unlistenDanmaku = u1;

      const u2 = await listen<VfxPayload>("vfx", (event) => {
        const p = event.payload;
        console.log("[vfx] received", p.effect, p.text);
        vfxEngineRef.current?.trigger(p.effect, p.color);
      });
      unlistenVfx = u2;
    })();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      unlistenDanmaku?.();
      unlistenVfx?.();
      vfxEngineRef.current?.destroy();
    };
  }, []);

  return (
    <>
      <canvas ref={vfxCanvasRef} className="vfx-canvas" />
      <canvas ref={danmakuCanvasRef} className="overlay-canvas" />
    </>
  );
}

export default Overlay;
