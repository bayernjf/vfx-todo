import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

interface DanmakuItem {
  id: number;
  text: string;
  color: string;
  x: number;
  y: number;
  speed: number;
  width: number;
  lane: number;
}

// 支持的特效类型（与后端 Rust VfxPayload.effect 保持一致）
export type EffectType =
  | "shatter"
  | "particle"
  | "rain"
  | "firework"
  | "ripple"
  | "laser"
  | "glitch";

interface VfxPayload {
  id: number;
  effect: EffectType;
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
uniform float u_time;      // 0 → 1 缓动进度
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
  float crack1 = noise(vec2(angle * 8.0, dist * 16.0 + u_seed * 10.0));
  float crack2 = noise(vec2(angle * 16.0, dist * 24.0 - u_seed * 5.0));
  float crackMask = smoothstep(0.7, 0.85, crack1 * crack2);

  // 裂纹扩散波：随时间从中心向外，柔化边缘
  float wave = u_time * 0.85;
  float waveMask = smoothstep(wave + 0.12, wave - 0.12, dist);

  // 柔和起手光晕：着色而非纯白，强度大幅降低
  float flash = exp(-u_time * 3.0) * 0.18;

  vec3 color = u_color * crackMask * waveMask * 1.0;
  color += mix(u_color, vec3(1.0), 0.3) * flash;

  // vignette
  float vig = 1.0 - smoothstep(0.35, 0.95, dist);
  color *= mix(0.75, 1.0, vig);

  float fadeIn = smoothstep(0.0, 0.06, u_time);
  float alpha = max(crackMask * waveMask * 0.9, flash) * fadeIn;
  gl_FragColor = vec4(color * fadeIn, alpha);
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

  // 粒子：更稀疏的多层网格，节奏舒缓
  float particles = 0.0;
  for (float i = 1.0; i <= 4.0; i++) {
    vec2 grid = uv * (16.0 * i) + u_seed * i;
    vec2 cell = floor(grid);
    vec2 cellUv = fract(grid) - 0.5;
    float r = hash(cell + i);
    vec2 offset = vec2(hash(cell), hash(cell + 1.0)) - 0.5;
    float pull = 1.0 - u_time;
    vec2 pos = cellUv + offset * pull * 0.25;
    float d = length(pos);
    float size = (0.12 + r * 0.08) * (1.0 - u_time * 0.6);
    particles += smoothstep(size, size * 0.4, d) * r;
  }

  // 中心光晕：聚集时变亮
  float glow = exp(-dist * 5.0) * u_time;
  float flash = exp(-u_time * 3.0) * 0.12;

  vec3 color = u_color * particles * 0.9;
  color += u_color * glow * 0.7;
  color += mix(u_color, vec3(1.0), 0.25) * flash;

  float fadeIn = smoothstep(0.0, 0.06, u_time);
  float alpha = max(particles * 0.6, max(glow, flash)) * fadeIn;
  gl_FragColor = vec4(color * fadeIn, alpha);
}
`;

// 雨滴特效
const RAIN_FRAG_SRC = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;
uniform float u_seed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float rain = 0.0;
  for (float i = 1.0; i <= 5.0; i++) {
    float speed = 0.3 + i * 0.08;
    float x = hash(vec2(i, u_seed)) + sin(u_time * 0.25 + i) * 0.08;
    float y = fract(uv.x * (6.0 + i * 2.5) + x + u_time * speed);
    float drop = smoothstep(0.03, 0.0, abs(uv.y - y)) * smoothstep(0.35, 0.0, length(uv - vec2(x, y)));
    rain += drop;
  }
  float fadeIn = smoothstep(0.0, 0.1, u_time);
  gl_FragColor = vec4(u_color * (0.4 + rain * 1.4), rain * 0.32 + 0.04) * fadeIn;
}
`;

// 烟花特效
const FIREWORK_FRAG_SRC = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;
uniform float u_seed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy - 0.5;
  uv.x *= u_resolution.x / u_resolution.y;
  float t = u_time;
  float burst = 0.0;
  for (float i = 0.0; i < 36.0; i++) {
    float angle = i * 0.349 + hash(vec2(i, u_seed)) * 0.5;
    float speed = 0.25 + hash(vec2(i + 1.0, u_seed)) * 0.35;
    float r = t * speed;
    vec2 pos = vec2(cos(angle), sin(angle)) * r;
    float d = length(uv - pos);
    float size = 0.02 * (1.0 - t);
    burst += smoothstep(size, 0.0, d) * (1.0 - t);
  }
  float glow = exp(-length(uv) * 3.5) * (1.0 - t) * 0.35;
  vec3 col = u_color * burst * 0.8 + vec3(1.0, 0.85, 0.65) * glow;
  float fadeIn = smoothstep(0.0, 0.08, u_time);
  gl_FragColor = vec4(col * fadeIn, max(burst, glow) * fadeIn);
}
`;

// 水波纹特效
const RIPPLE_FRAG_SRC = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;
uniform float u_seed;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 center = 0.5 + vec2(sin(u_seed) * 0.15, cos(u_seed * 1.3) * 0.15);
  float dist = length(uv - center);
  float rings = sin(dist * 28.0 - u_time * 3.5) * 0.5 + 0.5;
  rings *= exp(-dist * 3.0) * (1.0 - u_time * 0.25);
  float fadeIn = smoothstep(0.0, 0.08, u_time);
  float alpha = rings * 0.42 * (1.0 - u_time) * fadeIn;
  gl_FragColor = vec4(u_color * (0.3 + rings * 0.8) * fadeIn, alpha);
}
`;

// 激光扫描特效
const LASER_FRAG_SRC = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;
uniform float u_seed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  // 半圈旋转（更慢），减少扫动带来的眩晕
  float angle = u_time * 3.14159 + u_seed;
  vec2 dir = vec2(cos(angle), sin(angle));
  float dist = abs(dot(uv - 0.5, vec2(-dir.y, dir.x)));
  float beam = smoothstep(0.09, 0.0, dist) * (1.0 - u_time * 0.4);
  float fadeIn = smoothstep(0.0, 0.1, u_time);
  float fadeOut = 1.0 - smoothstep(0.7, 1.0, u_time);
  gl_FragColor = vec4(u_color * (beam * 0.9), beam * 0.55 * fadeIn * fadeOut);
}
`;

// 故障特效
const GLITCH_FRAG_SRC = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;
uniform float u_seed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time;
  float glitch = 0.0;
  for (float i = 0.0; i < 6.0; i++) {
    float y = hash(vec2(i, u_seed)) * 0.8 + 0.1;
    float h = 0.008 + hash(vec2(i + 10.0, u_seed)) * 0.02;
    // 错位位移大幅降低，避免横向抖动眩晕
    float shift = (hash(vec2(i + 20.0, u_seed + floor(t * 6.0))) - 0.5) * 0.025 * (1.0 - t);
    float line = smoothstep(h, 0.0, abs(uv.y - y));
    glitch += line;
    if (abs(uv.y - y) < h) {
      uv.x += shift;
    }
  }
  float noise = hash(uv * 80.0 + floor(t * 12.0));
  vec3 col = mix(u_color, vec3(noise), 0.12) * (1.0 + glitch * 0.8);
  float fadeIn = smoothstep(0.0, 0.06, u_time);
  float fadeOut = 1.0 - smoothstep(0.75, 1.0, u_time);
  gl_FragColor = vec4(col * fadeIn, (glitch + noise * 0.12) * (1.0 - t) * fadeIn * fadeOut);
}
`;

const SHADER_MAP: Record<string, string> = {
  shatter: SHATTER_FRAG_SRC,
  particle: PARTICLE_FRAG_SRC,
  rain: RAIN_FRAG_SRC,
  firework: FIREWORK_FRAG_SRC,
  ripple: RIPPLE_FRAG_SRC,
  laser: LASER_FRAG_SRC,
  glitch: GLITCH_FRAG_SRC,
};

class VfxEngine {
  private gl: WebGLRenderingContext | null = null;
  private programs = new Map<string, { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> }>();
  private buffer: WebGLBuffer | null = null;
  private raf = 0;
  private startTime = 0;
  private duration = 1500; // ms
  private currentProgram: WebGLProgram | null = null;
  private currentUniforms: Record<string, WebGLUniformLocation | null> = {};
  private currentColor: string = "#ff6b6b";
  private currentSeed = 0;

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

  private getOrBuildProgram(fragSrc: string) {
    const cached = this.programs.get(fragSrc);
    if (cached) {
      this.currentProgram = cached.program;
      this.currentUniforms = cached.uniforms;
      return;
    }

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

    const uniforms = {
      u_resolution: gl.getUniformLocation(program, "u_resolution"),
      u_time: gl.getUniformLocation(program, "u_time"),
      u_center: gl.getUniformLocation(program, "u_center"),
      u_color: gl.getUniformLocation(program, "u_color"),
      u_seed: gl.getUniformLocation(program, "u_seed"),
    };

    this.programs.set(fragSrc, { program, uniforms });
    this.currentProgram = program;
    this.currentUniforms = uniforms;
  }

  trigger(effect: EffectType, color: string) {
    if (!this.gl) return;
    const fragSrc = SHADER_MAP[effect];
    if (!fragSrc) {
      console.warn("VfxEngine: unknown effect", effect);
      return;
    }
    this.currentColor = color;
    this.currentSeed = Math.random() * 100;
    this.getOrBuildProgram(fragSrc);

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
    if (!gl || !this.currentProgram) return;
    const elapsed = performance.now() - this.startTime;
    const t = Math.min(elapsed / this.duration, 1);
    // 缓动进度：平滑淡入淡出，避免突兀闪烁
    const te = t * t * (3 - 2 * t);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.currentProgram);
    gl.uniform2f(this.currentUniforms.u_resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.currentUniforms.u_time, te);
    gl.uniform2f(this.currentUniforms.u_center, 0.5, 0.5);
    gl.uniform3f(this.currentUniforms.u_color, ...this.hexToRgb(this.currentColor));
    gl.uniform1f(this.currentUniforms.u_seed, this.currentSeed);
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
      for (const { program } of this.programs.values()) {
        this.gl.deleteProgram(program);
      }
      this.programs.clear();
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
    }
  }
}

function playVfxSound(effect: EffectType) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;

    switch (effect) {
      case "particle": {
        // 粒子：中频滑音，能量感
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(900, now + 0.25);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
        break;
      }
      case "shatter": {
        // 破碎：低频冲击 + 高频碎裂 noise
        const t = now;
        const osc1 = ctx.createOscillator();
        const g1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(180, t);
        osc1.frequency.exponentialRampToValueAtTime(60, t + 0.15);
        g1.gain.setValueAtTime(0.25, t);
        g1.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc1.connect(g1);
        g1.connect(ctx.destination);
        osc1.start(t);
        osc1.stop(t + 0.25);
        const bufferSize = ctx.sampleRate * 0.3;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
        }
        const noise = ctx.createBufferSource();
        const g2 = ctx.createGain();
        noise.buffer = buffer;
        g2.gain.setValueAtTime(0.12, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        noise.connect(g2);
        g2.connect(ctx.destination);
        noise.start(t);
        break;
      }
      case "rain": {
        // 雨：连续高频白噪声（模拟细密雨点）
        const bufferSize = ctx.sampleRate * 0.8;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          // 用较高频率振荡 × 噪声塑造"滴落感"
          data[i] = (Math.random() * 2 - 1) * (0.4 + 0.6 * Math.sin(i * 0.02));
        }
        const noise = ctx.createBufferSource();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 2000;
        noise.buffer = buffer;
        gain.gain.setValueAtTime(0.0, now);
        gain.gain.linearRampToValueAtTime(0.18, now + 0.1);
        gain.gain.linearRampToValueAtTime(0.0, now + 0.8);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noise.start(now);
        break;
      }
      case "firework": {
        // 烟花：先上行嗡鸣 → 炸开时高频泛音 + 噪声
        // 上行
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.35);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.4);
        // 炸开
        const t = now + 0.4;
        const bufferSize = ctx.sampleRate * 0.4;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
        }
        const noise = ctx.createBufferSource();
        const g2 = ctx.createGain();
        noise.buffer = buffer;
        g2.gain.setValueAtTime(0.2, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        noise.connect(g2);
        g2.connect(ctx.destination);
        noise.start(t);
        break;
      }
      case "ripple": {
        // 水波纹：低频正弦缓慢起伏
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.linearRampToValueAtTime(80, now + 0.6);
        gain.gain.setValueAtTime(0.0, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.1);
        gain.gain.linearRampToValueAtTime(0.0, now + 0.7);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.7);
        break;
      }
      case "laser": {
        // 激光：高频锯齿 + 短促扫描
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.15);
        gain.gain.setValueAtTime(0.0, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      }
      case "glitch": {
        // 故障：短促锯齿噪音 × 3 次错位爆裂
        for (let k = 0; k < 3; k++) {
          const t = now + k * 0.08;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "square";
          osc.frequency.setValueAtTime(150 + k * 70, t);
          osc.frequency.exponentialRampToValueAtTime(50, t + 0.05);
          gain.gain.setValueAtTime(0.0, t);
          gain.gain.linearRampToValueAtTime(0.1, t + 0.005);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.07);
        }
        break;
      }
    }

    // 自动关闭 AudioContext 避免资源泄漏
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // 浏览器禁用音频或 AudioContext 不支持时静默失败
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
    const fontHeight = 24 * dpr;
    ctx.font = `${fontHeight}px "PingFang SC", system-ui, sans-serif`;
    ctx.textBaseline = "top";

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, danmakuCanvas.width, danmakuCanvas.height);

      const items = itemsRef.current;
      if (items.length > 0) {
        ctx.shadowColor = "rgba(0,0,0,0.7)";
        ctx.shadowBlur = 4 * dpr;
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          it.x -= it.speed * dt * dpr;
          if (it.x + it.width < 0) {
            items.splice(i, 1);
            continue;
          }
          ctx.fillStyle = it.color;
          ctx.lineWidth = 3 * dpr;
          ctx.strokeStyle = "rgba(0,0,0,0.45)";
          ctx.strokeText(it.text, it.x, it.y);
          ctx.fillText(it.text, it.x, it.y);
        }
        ctx.shadowBlur = 0;
      }

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
        ctx.font = `${fontHeight}px "PingFang SC", system-ui, sans-serif`;
        const width = ctx.measureText(p.text).width;

        const LANE_COUNT = 6;
        const laneHeight = (canvas.clientHeight * dpr) / LANE_COUNT;

        // 计算每条轨道当前最右侧弹幕的右边界
        const edges = new Array(LANE_COUNT).fill(-Infinity);
        for (const it of itemsRef.current) {
          const right = it.x + it.width;
          if (right > edges[it.lane]) edges[it.lane] = right;
        }

        // 分配到最空的轨道（右边界最小）
        let bestLane = 0;
        let minEdge = Infinity;
        for (let i = 0; i < LANE_COUNT; i++) {
          if (edges[i] < minEdge) {
            minEdge = edges[i];
            bestLane = i;
          }
        }

        const y = bestLane * laneHeight + (laneHeight - fontHeight) / 2;

        itemsRef.current.push({
          id: p.id,
          text: p.text,
          color: p.color,
          x: canvas.clientWidth * dpr,
          y: Math.max(0, y),
          speed: p.speed,
          width,
          lane: bestLane,
        });
      });
      unlistenDanmaku = u1;

      const u2 = await listen<VfxPayload>("vfx", (event) => {
        const p = event.payload;
        vfxEngineRef.current?.trigger(p.effect, p.color);
        playVfxSound(p.effect);
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
