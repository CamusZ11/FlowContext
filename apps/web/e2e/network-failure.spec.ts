import { test, expect } from "@playwright/test";

test("network failure does not fake completion", async ({ page }) => {
  await page.goto("/?e2e=network-failure");
  const checkbox = page.getByRole("checkbox", { name: "完成 上午任务" });
  // A rejected mutation must leave the controlled checkbox unchanged; use a
  // click rather than Playwright's `check()`, which itself requires a state
  // transition before the assertion can run.
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByText("保存失败，请重试")).toBeVisible();
});
