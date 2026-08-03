/**
 * E2E tests for search, sort, filter, undo, and batch operations.
 */
import { test, expect } from "@playwright/test";
import { setupPage } from "./mocks";

// Shared selectors
const TODO_ITEM = ".todo-item";
const TODO_TITLE = ".todo-title";
const COMPLETED_ITEM = ".todo-item.completed";
const UNDO_TOAST = ".undo-toast";
const UNDO_BTN = ".undo-toast-btn";
const UNDO_CLOSE = ".undo-toast-close";
const COMPLETE_BTN = ".todo-btn.complete";
const DELETE_BTN = ".todo-btn.delete";
const TODO_CHECKBOX = ".todo-checkbox";

test.describe("Search", () => {
  test("search filters todos", async ({ page }) => {
    await setupPage(page, {
      seed: [
        { title: "Buy groceries" },
        { title: "Write code" },
        { title: "Buy milk" },
      ],
    });
    await page.goto("/");

    const searchInput = page.locator(".search-bar .search-input").first();
    await searchInput.fill("Buy");

    await expect(page.locator(TODO_ITEM)).toHaveCount(2);

    await searchInput.fill("code");
    await expect(page.locator(TODO_ITEM)).toHaveCount(1);
    await expect(page.locator(TODO_TITLE)).toContainText("Write code");

    await page.locator(".search-clear").click();
    await expect(page.locator(TODO_ITEM)).toHaveCount(3);
  });

  test("search with no results shows empty state", async ({ page }) => {
    await setupPage(page, {
      seed: [{ title: "Only task" }],
    });
    await page.goto("/");

    const searchInput = page.locator(".search-bar .search-input").first();
    await searchInput.fill("zzz_nonexistent_zzz");

    await expect(page.locator(".todo-empty")).toBeVisible();
    await expect(page.locator(TODO_ITEM)).toHaveCount(0);
  });
});

test.describe("Sort", () => {
  test("sort selector is present with options", async ({ page }) => {
    await setupPage(page, {
      seed: [
        { title: "Task A" },
        { title: "Task B" },
      ],
    });
    await page.goto("/");

    const sortSelect = page.locator(".sort-select");
    await expect(sortSelect).toBeVisible();

    const options = await sortSelect.locator("option").allTextContents();
    expect(options.length).toBeGreaterThanOrEqual(2);
  });

  test("sort by due changes order", async ({ page }) => {
    const now = Date.now();
    await setupPage(page, {
      seed: [
        { title: "Later task", due_time: now + 1000 * 60 * 10 },
        { title: "Soon task", due_time: now + 1000 * 60 * 1 },
        { title: "Mid task", due_time: now + 1000 * 60 * 5 },
      ],
    });
    await page.goto("/");

    const sortSelect = page.locator(".sort-select");
    await sortSelect.selectOption("due");

    // 升序：越近的截止时间越靠前 → Soon, Mid, Later
    await expect(page.locator(TODO_TITLE).nth(0)).toContainText("Soon");
    await expect(page.locator(TODO_TITLE).nth(1)).toContainText("Mid");
    await expect(page.locator(TODO_TITLE).nth(2)).toContainText("Later");
  });
});

test.describe("Tag Filter", () => {
  test("tag filter pills clickable and filter todos", async ({ page }) => {
    await setupPage(page, {
      seed: [
        { title: "Work task", tag: "工作" },
        { title: "Personal task", tag: "个人" },
        { title: "Another work", tag: "工作" },
      ],
    });
    await page.goto("/");

    const pills = page.locator(".tag-filter-pill");
    await expect(pills.first()).toBeVisible();

    const workPill = page.locator('.tag-filter-pill:has-text("工作")').first();
    await workPill.click();

    await expect(page.locator(TODO_ITEM)).toHaveCount(2);
    await expect(page.locator(TODO_TITLE).first()).toContainText("work");
  });

  test("click active tag filter again clears it", async ({ page }) => {
    await setupPage(page, {
      seed: [
        { title: "Work task", tag: "工作" },
        { title: "Personal task", tag: "个人" },
      ],
    });
    await page.goto("/");

    const workPill = page.locator('.tag-filter-pill:has-text("工作")').first();
    await workPill.click();
    await expect(page.locator(TODO_ITEM)).toHaveCount(1);

    const allPill = page.locator('.tag-filter-pill:has-text("全部")').first();
    await allPill.click();
    await expect(page.locator(TODO_ITEM)).toHaveCount(2);
  });
});

test.describe("Undo", () => {
  test("undo complete via toast button", async ({ page }) => {
    await setupPage(page, {
      seed: [{ title: "Undoable task" }],
    });
    await page.goto("/");

    await page.locator(COMPLETE_BTN).first().click();

    await expect(page.locator(UNDO_TOAST)).toBeVisible();
    await page.locator(UNDO_BTN).click();

    await expect(page.locator(COMPLETED_ITEM)).toHaveCount(0);
    await expect(page.locator(TODO_ITEM)).toHaveCount(1);
  });

  test("undo delete via toast button", async ({ page }) => {
    await setupPage(page, {
      seed: [{ title: "Restorable" }],
    });
    await page.goto("/");

    await page.locator(DELETE_BTN).first().click();

    await expect(page.locator(TODO_ITEM)).toHaveCount(0);
    await expect(page.locator(UNDO_TOAST)).toBeVisible();

    await page.locator(UNDO_BTN).click();

    await expect(page.locator(TODO_ITEM)).toHaveCount(1);
    await expect(page.locator(TODO_TITLE)).toContainText("Restorable");
  });

  test("undo toast close button dismisses it", async ({ page }) => {
    await setupPage(page, {
      seed: [{ title: "Test" }],
    });
    await page.goto("/");

    await page.locator(COMPLETE_BTN).first().click();
    await expect(page.locator(UNDO_TOAST)).toBeVisible();

    await page.locator(UNDO_CLOSE).click();
    await expect(page.locator(UNDO_TOAST)).not.toBeVisible();
  });

  test("undo toast auto-dismissed after timeout", async ({ page }) => {
    await setupPage(page, {
      seed: [{ title: "Auto dismiss" }],
    });
    await page.goto("/");

    await page.locator(COMPLETE_BTN).first().click();
    await expect(page.locator(UNDO_TOAST)).toBeVisible();

    await page.waitForTimeout(4000);
    await expect(page.locator(UNDO_TOAST)).not.toBeVisible();
  });
});

test.describe("Batch Operations", () => {
  test("selecting todos shows batch bar", async ({ page }) => {
    await setupPage(page, {
      seed: [
        { title: "Task 1" },
        { title: "Task 2" },
      ],
    });
    await page.goto("/");

    // Click checkbox to select first todo
    await page.locator(TODO_CHECKBOX).first().click();
    await page.waitForTimeout(150);

    // Batch bar shows "已选" text
    await expect(page.getByText(/已选/)).toBeVisible();
  });

  test("batch complete selected todos", async ({ page }) => {
    await setupPage(page, {
      seed: [
        { title: "Batch A" },
        { title: "Batch B" },
        { title: "Batch C" },
      ],
    });
    await page.goto("/");

    // Select first two by clicking checkboxes
    await page.locator(TODO_CHECKBOX).nth(0).click();
    await page.locator(TODO_CHECKBOX).nth(1).click();
    await page.waitForTimeout(150);

    // Click "批量完成" button
    await page.getByText("批量完成", { exact: true }).click();

    await expect(page.locator(COMPLETED_ITEM)).toHaveCount(2);
    await expect(page.locator(UNDO_TOAST)).toBeVisible();
  });

  test("batch delete removes selected todos", async ({ page }) => {
    await setupPage(page, {
      seed: [
        { title: "Delete A" },
        { title: "Keep" },
        { title: "Delete B" },
      ],
    });
    await page.goto("/");

    // Select first and third by clicking checkboxes
    await page.locator(TODO_CHECKBOX).nth(0).click();
    await page.locator(TODO_CHECKBOX).nth(2).click();
    await page.waitForTimeout(150);

    // Click "批量删除" button
    await page.getByText("批量删除", { exact: true }).click();

    await expect(page.locator(TODO_ITEM)).toHaveCount(1);
    await expect(page.locator(TODO_TITLE)).toContainText("Keep");
    await expect(page.locator(UNDO_TOAST)).toBeVisible();
  });
});
