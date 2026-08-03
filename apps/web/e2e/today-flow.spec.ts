import { test, expect } from "@playwright/test";

test("today flow creates, checks, and strikes a todo", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.getByPlaceholder("添加事项…").fill("验证 FlowContext");
  await page.getByRole("button", { name: "添加" }).click();
  const checkbox = page.getByRole("checkbox", { name: "完成 验证 FlowContext" });
  await expect(checkbox).toBeVisible();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(page.getByText("验证 FlowContext")).toHaveCSS("text-decoration-line", "line-through");
});
