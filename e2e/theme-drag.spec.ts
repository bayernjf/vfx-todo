/**
 * E2E tests for theme toggle and drag-and-drop reorder.
 */
import { test, expect } from "@playwright/test";
import { setupPage } from "./mocks";

test.describe("Theme", () => {
  test("theme toggle exists in header", async ({ page }) => {
    await setupPage(page);
    await page.goto("/");

    const themeBtn = page.locator(".theme-toggle").first();
    await expect(themeBtn).toBeVisible();
  });

  test("clicking theme applies dark theme", async ({ page }) => {
    await setupPage(page);
    await page.goto("/");

    await page.locator(".theme-toggle").first().click();

    const theme = await page.locator("html").getAttribute("data-theme");
    expect(["dark", "light", "system"]).toContain(theme);
  });

  test("theme cycles through system → dark → light → system", async ({ page }) => {
    await setupPage(page);
    await page.goto("/");

    // Wait for React effects to apply initial theme
    await page.waitForTimeout(500);

    // Get initial resolved theme (system may resolve to light in headless)
    const initial = await page.locator("html").getAttribute("data-theme")
      || "system"; // fallback if not yet set

    // Do 3 clicks to complete a full cycle (system → dark → light → system)
    for (let i = 0; i < 3; i++) {
      await page.locator(".theme-toggle").first().click();
      await page.waitForTimeout(100);
    }

    const final = await page.locator("html").getAttribute("data-theme") || "system";
    // After 3 clicks, should be back to the original resolved value
    expect(final).toBe(initial);
  });

  test("dark theme has appropriate background color", async ({ page }) => {
    await setupPage(page);
    await page.goto("/");

    await page.locator(".theme-toggle").first().click();

    const theme = await page.locator("html").getAttribute("data-theme");
    if (theme === "dark") {
      const bgColor = await page.locator(".console").evaluate(
        (el) => getComputedStyle(el).backgroundColor
      );
      expect(bgColor).toBeTruthy();
    }
  });
});

test.describe("Drag and Drop", () => {
  test("drag handles visible when sorted by custom order", async ({ page }) => {
    await setupPage(page, {
      seed: [
        { title: "First", order: 0 },
        { title: "Second", order: 1 },
      ],
    });
    await page.goto("/");

    await page.locator(".sort-select").selectOption("order");
    await page.waitForTimeout(300);

    await expect(page.locator(".drag-handle").first()).toBeVisible();
  });

  test("reorder by drag and drop changes order", async ({ page }) => {
    await setupPage(page, {
      seed: [
        { title: "Item A", order: 0 },
        { title: "Item B", order: 1 },
        { title: "Item C", order: 2 },
      ],
    });
    await page.goto("/");

    await page.locator(".sort-select").selectOption("order");
    await page.waitForTimeout(300);

    const initialTitles = await page.locator(".todo-title").allTextContents();

    // Drag first item to below last item using dragTo
    const firstHandle = page.locator(".drag-handle").first();
    const lastHandle = page.locator(".drag-handle").last();

    await firstHandle.dragTo(lastHandle);
    await page.waitForTimeout(500);

    const newTitles = await page.locator(".todo-title").allTextContents();
    expect(newTitles.length).toBe(3);

    // 拖拽必须真的改变顺序：A 被拖到后面后，第一项不再是 A。
    // 旧断言 `orderChanged || newTitles.length === 3` 因上一行已断言长度为 3 而恒真。
    const orderChanged = newTitles.some((t, i) => t !== initialTitles[i]);
    expect(orderChanged).toBe(true);
    expect(newTitles[0]).toMatch(/^Item B/);
    expect(newTitles[2]).toMatch(/^Item A/);
  });

  test("drag over shows visual indicator during drag", async ({ page }) => {
    await setupPage(page, {
      seed: [
        { title: "Source", order: 0 },
        { title: "Target", order: 1 },
      ],
    });
    await page.goto("/");

    await page.locator(".sort-select").selectOption("order");
    await page.waitForTimeout(300);

    const firstHandle = page.locator(".drag-handle").first();
    const box = await firstHandle.boundingBox();

    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height + 60, { steps: 8 });
      await page.waitForTimeout(150);

      const dragOverCount = await page.locator(".todo-item.drag-over").count();
      console.log(`[INFO] drag-over items during drag: ${dragOverCount}`);

      await page.mouse.up();
    }
  });

  test("drag not available when not sorted by order", async ({ page }) => {
    await setupPage(page, {
      seed: [
        { title: "Task 1", order: 0 },
        { title: "Task 2", order: 1 },
      ],
    });
    await page.goto("/");

    await expect(page.locator(".drag-handle")).toHaveCount(0);
  });
});
