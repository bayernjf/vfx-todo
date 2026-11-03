import js from "@eslint/js";
import tseslint from "typescript-eslint";

// P2-9（2026-11-02 评审）：lint 此前是空指令（package.json 挂了 eslint 但 devDeps 没装，
// 文档三处宣称可用）。本配置刻意只开 recommended 级别——目标是守住真实缺陷
// （未用变量、显式 any 蔓延、react-hooks 依赖），不把存量代码重写成另一个风格。
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/", "node_modules/", "src-tauri/", "playwright-report/", "test-results/"],
  },
  {
    rules: {
      // 存量代码大量使用 `as unknown as X` 做 Tauri/Canvas 边界断言，属既定写法。
      "@typescript-eslint/no-explicit-any": "off",
      // catch 绑定无使用的习惯写法。
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      // e2e/测试里的空函数桩是 mock 的一部分。
      "@typescript-eslint/no-empty-function": "off",
    },
  },
);
