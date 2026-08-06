import { test, expect } from "@playwright/test";
import { setupPage } from "./mocks";

const THREE_SCREENS = [
  { id: 0, name: "主屏", is_primary: true },
  { id: 1, name: "屏 2", is_primary: false },
  { id: 2, name: "屏 3", is_primary: false },
];

const TITLE_INPUT = 'input[placeholder="输入待办内容，回车添加"]';
const ADD_BUTTON = '.todo-input button:has-text("添加")';
const EDIT_BTN = '.todo-btn.edit';
const SAVE_BTN = '.todo-btn.save';

test.describe("Multi-Screen Support", () => {
  test("screen selector lists all available screens", async ({ page }) => {
    await setupPage(page, { screens: THREE_SCREENS });
    await page.goto("/");

    // Wait for the app to call list_screens on mount
    await page.waitForFunction(
      () => (window as any).__MOCK__.invokeCount("list_screens") > 0
    );

    // Create-form screen <select> should expose 4 options (全部 + 3 screens)
    const screenSelect = page.locator(".input-config select").nth(1);
    await expect(screenSelect).toBeVisible();
    await expect(screenSelect.locator("option")).toHaveCount(4);
  });

  test("creating a todo targets the selected screen", async ({ page }) => {
    await setupPage(page, { screens: THREE_SCREENS });
    await page.goto("/");

    await page.locator(".input-config select").nth(1).selectOption({ label: "屏 2" });

    await page.locator(TITLE_INPUT).fill("Screen-bound task");
    await page.locator(ADD_BUTTON).click();
    await page.waitForTimeout(150);

    const screen = await page.evaluate(() => {
      const todos = (window as any).__MOCK__.todos();
      const t = todos.find((x: any) => x.title === "Screen-bound task");
      return t ? t.screen : null;
    });

    expect(screen).toBe(1); // 屏 2 has id 1
  });

  test("sending danmaku routes to the selected screen", async ({ page }) => {
    await setupPage(page, { screens: THREE_SCREENS });
    await page.goto("/");
    await page.locator('.panel-toggle:has-text("特效演示")').click();

    await page.locator(".input-config select").nth(1).selectOption({ label: "屏 2" });
    await page.locator('.danmaku-bar input[placeholder="直接发弹幕..."]').fill("hello multi-screen");

    await page.locator('.danmaku-bar button:has-text("发送")').click();
    await page.waitForTimeout(150);

    const args = await page.evaluate(() => (window as any).__MOCK__.lastArgs("send_danmaku"));
    expect(args).not.toBeNull();
    expect(args.screen).toBe(1);
  });

  test("preview effect routes to the selected screen", async ({ page }) => {
    await setupPage(page, { screens: THREE_SCREENS });
    await page.goto("/");
    await page.locator('.panel-toggle:has-text("特效演示")').click();

    await page.locator(".input-config select").nth(1).selectOption({ label: "屏 3" });
    // First effect-demo button (EFFECT_LABEL order) previews that effect
    await page.locator(".effect-demo-btn").first().click();
    await page.waitForTimeout(150);

    const args = await page.evaluate(() => (window as any).__MOCK__.lastArgs("trigger_vfx"));
    expect(args).not.toBeNull();
    expect(args.screen).toBe(2); // 屏 3 has id 2
  });

  test("editing a todo can reassign its screen", async ({ page }) => {
    await setupPage(page, {
      screens: THREE_SCREENS,
      seed: [{ title: "Reassign me", tag: "work" }],
    });
    await page.goto("/");

    await page.locator(EDIT_BTN).first().click();
    await page.waitForTimeout(100);

    // 3rd select in the edit form is the screen selector
    const editScreen = page.locator(".edit-form select").nth(2);
    await editScreen.selectOption({ label: "屏 2" });

    await page.locator(SAVE_BTN).first().click();
    await page.waitForTimeout(150);

    const screen = await page.evaluate(() => {
      const todos = (window as any).__MOCK__.todos();
      const t = todos.find((x: any) => x.title === "Reassign me");
      return t ? t.screen : null;
    });

    expect(screen).toBe(1);
  });
});
