import { test, expect } from "@playwright/test";

async function openDesktopDensity(page: import("@playwright/test").Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/?e2e=desktop-density");
  await expect(page.locator('.flowcontext-app[data-mode="desktop"]')).toBeVisible();
}

test("desktop panel uses compact density without headline or close control", async ({ page }) => {
  await openDesktopDensity(page, 420, 900);
  await expect(page.getByRole("heading", { name: "今天，继续推进" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /关闭|收起 FlowContext/ })).toHaveCount(0);

  const shell = page.locator('.flowcontext-app[data-mode="desktop"]');
  const row = page.getByTestId("todo-row").first();
  const editButton = page.getByRole("button", { name: /^编辑 / }).first();
  const shellBox = await shell.boundingBox();
  const rowBox = await row.boundingBox();
  const buttonBox = await editButton.boundingBox();

  expect(shellBox?.width).toBeGreaterThanOrEqual(368);
  expect(shellBox?.width).toBeLessThanOrEqual(374);
  expect(rowBox?.height).toBeLessThanOrEqual(44);
  expect(buttonBox?.width).toBeLessThanOrEqual(32);
  expect(buttonBox?.height).toBeLessThanOrEqual(32);
  await expect(page).toHaveScreenshot("desktop-density-420x900.png", { animations: "disabled", maxDiffPixelRatio: 0.02 });
});

test("desktop compact controls do not expand or overlap across supported widths", async ({ page }) => {
  for (const viewport of [{ width: 360, height: 720 }, { width: 560, height: 900 }, { width: 420, height: 1080 }]) {
    await openDesktopDensity(page, viewport.width, viewport.height);
    const shell = page.locator('.flowcontext-app[data-mode="desktop"]');
    const form = page.locator(".todo-form");
    const addButton = page.getByRole("button", { name: "添加" });
    const checkbox = page.getByRole("checkbox").first();
    const dateTrigger = page.getByRole("button", { name: /^选择日期，当前 \d{4}-\d{2}-\d{2}$/ });
    const shellScrollWidth = await shell.evaluate((element) => element.scrollWidth);
    const shellClientWidth = await shell.evaluate((element) => element.clientWidth);
    const formBox = await form.boundingBox();
    const addBox = await addButton.boundingBox();
    const checkboxBox = await checkbox.boundingBox();

    expect(shellScrollWidth).toBeLessThanOrEqual(shellClientWidth);
    expect(formBox?.width).toBeGreaterThan(0);
    expect(addBox?.width).toBeLessThanOrEqual(42);
    expect(addBox?.height).toBeLessThanOrEqual(42);
    expect(checkboxBox?.width).toBeLessThanOrEqual(20);
    await expect(dateTrigger).toHaveCSS("font-size", "18px");
  }
});
