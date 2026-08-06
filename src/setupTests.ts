import "@testing-library/jest-dom/vitest";

// jsdom 未实现 matchMedia，App 的主题 effect 依赖它
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// jsdom 未实现 canvas 2D/WebGL 上下文，Overlay 渲染循环会调用 strokeText/fillText 等
const ctxNoop = () => {};
const ctxProxy = new Proxy(
  {
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: new Uint8ClampedArray() }),
    createImageData: () => ({ data: new Uint8ClampedArray() }),
  },
  {
    get(target, prop) {
      if (prop in target) return (target as Record<string, unknown>)[prop as string];
      return ctxNoop;
    },
    set() {
      return true;
    },
  }
);
HTMLCanvasElement.prototype.getContext = (() =>
  ctxProxy as unknown) as typeof HTMLCanvasElement.prototype.getContext;
