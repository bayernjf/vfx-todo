/**
 * E2E tests for core Todo CRUD operations.
 */
import { test, expect } from "@playwright/test";
import { setupPage } from "./mocks";

// Selectors extracted for maintainability
const TITLE_INPUT = 'input[placeholder="输入待办内容，回车添加"]';
const ADD_BUTTON = '.todo-input button:has-text("添加")';
const TODO_ITEM = ".todo-item";
const TODO_TITLE = ".todo-title";
const COMPLETE_BTN = ".todo-btn.complete";
const DELETE_BTN = ".todo-btn.delete";
const EDIT_BTN = ".todo-btn.edit";
const EDIT_FORM = ".edit-form";
const EDIT_TITLE = ".edit-title-input";
const SAVE_BTN = ".todo-btn.save";
const CANCEL_BTN = ".todo-btn.cancel";
const TODO_EMPTY = ".todo-empty";
const UNDO_TOAST = ".undo-toast";
const UNDO_BTN = ".undo-toast-btn";
const UNDO_CLOSE = ".undo-toast-close";
const COMPLETED_ITEM = ".todo-item.completed";
const TAG_BADGE = ".tag-badge";

test.describe("Todo CRUD", () => {
  test("app loads and renders the header", async ({ page }) => {
    await setupPage(page);
    await page.goto("/");

    await expect(page.locator(".app-title")).toHaveText("VFX Todo");
    await expect(page.locator(".counter")).toBeVisible();
  });

  test("empty state shows placeholder text", async ({ page }) => {
    await setupPage(page);
    await page.goto("/");

    await expect(page.locator(TODO_EMPTY)).toContainText("暂无待办");
    await expect(page.locator(TODO_ITEM)).toHaveCount(0);
  });

  test("input bar exists and is interactive", async ({ page }) => {
    await setupPage(page);
    await page.goto("/");

    const input = page.locator(TITLE_INPUT);
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("placeholder", "输入待办内容，回车添加");

    const addBtn = page.locator(ADD_BUTTON);
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toHaveText("添加");
  });

  test("create a new todo with Add button click", async ({ page }) => {
    await setupPage(page);
    await page.goto("/");

    const input = page.locator(TITLE_INPUT);
    await input.fill("Buy groceries");
    await page.locator(ADD_BUTTON).click();

    await expect(page.locator(TODO_ITEM)).toHaveCount(1);
    await expect(page.locator(TODO_TITLE).first()).toContainText("Buy groceries");
    await expect(input).toHaveValue("");
  });

  test("create multiple todos", async ({ page }) => {
    await setupPage(page);
    await page.goto("/");

    const input = page.locator(TITLE_INPUT);

    await input.fill("Task 1");
    await page.locator(ADD_BUTTON).click();
    await page.waitForTimeout(200);

    await input.fill("Task 2");
    await page.locator(ADD_BUTTON).click();
    await page.waitForTimeout(200);

    await input.fill("Task 3");
    await page.locator(ADD_BUTTON).click();
    await page.waitForTimeout(200);

    await expect(page.locator(TODO_ITEM)).toHaveCount(3);
  });

  test("empty input should not create a todo", async ({ page }) => {
    await setupPage(page);
    await page.goto("/");

    const input = page.locator(TITLE_INPUT);
    await input.fill("   ");
    await page.locator(ADD_BUTTON).click();

    await expect(page.locator(TODO_ITEM)).toHaveCount(0);
  });

  test("complete a todo shows completed state", async ({ page }) => {
    await setupPage(page, {
      seed: [{ title: "Test task" }],
    });
    await page.goto("/");

    await page.locator(COMPLETE_BTN).first().click();

    await expect(page.locator(COMPLETED_ITEM)).toHaveCount(1);
    await expect(page.locator(UNDO_TOAST)).toBeVisible();
    await expect(page.locator(UNDO_TOAST)).toContainText("已完成");
  });

  test("delete a todo removes it", async ({ page }) => {
    await setupPage(page, {
      seed: [{ title: "Delete me" }],
    });
    await page.goto("/");

    await page.locator(DELETE_BTN).first().click();

    await expect(page.locator(TODO_ITEM)).toHaveCount(0);
    await expect(page.locator(UNDO_TOAST)).toBeVisible();
    await expect(page.locator(UNDO_TOAST)).toContainText("已删除");
  });

  test("create todo with tag", async ({ page }) => {
    await setupPage(page);
    await page.goto("/");

    // Select a tag from dropdown (3rd select in the form)
    const tagSelects = page.locator(".todo-input select");
    const tagSelect = tagSelects.nth(2);
    await tagSelect.selectOption("工作");

    const input = page.locator(TITLE_INPUT);
    await input.fill("Design review");
    await page.locator(ADD_BUTTON).click();

    await expect(page.locator(TODO_ITEM)).toHaveCount(1);
    await expect(page.locator(TAG_BADGE).first()).toContainText("工作");
  });
});

test.describe("Edit Mode", () => {
  test("clicking edit opens inline edit form", async ({ page }) => {
    await setupPage(page, {
      seed: [{ title: "Editable task" }],
    });
    await page.goto("/");

    await page.locator(EDIT_BTN).first().click();

    await expect(page.locator(EDIT_FORM)).toBeVisible();
    await expect(page.locator(EDIT_TITLE).first()).toBeVisible();
  });

  test("edit and save todo title", async ({ page }) => {
    await setupPage(page, {
      seed: [{ title: "Original title" }],
    });
    await page.goto("/");

    await page.locator(EDIT_BTN).first().click();

    const titleInput = page.locator(EDIT_TITLE).first();
    await titleInput.fill("Updated title");

    await page.locator(SAVE_BTN).first().click();

    await expect(page.locator(TODO_TITLE).first()).toContainText("Updated title");
  });

  test("cancel edit preserves original title", async ({ page }) => {
    await setupPage(page, {
      seed: [{ title: "Keep me" }],
    });
    await page.goto("/");

    await page.locator(EDIT_BTN).first().click();

    const titleInput = page.locator(EDIT_TITLE).first();
    await titleInput.fill("Changed");

    await page.locator(CANCEL_BTN).first().click();

    await expect(page.locator(TODO_TITLE).first()).toContainText("Keep me");
  });
});
