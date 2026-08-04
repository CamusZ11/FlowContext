import { test, expect } from "@playwright/test";

function alpha(color: string) {
  const match = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(color);
  return match ? Number(match[1]) : 1;
}

test("desktop shell provides a translucent rounded frame with spacing around its cards", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto("/?e2e=desktop-density");

  await expect(page.getByRole("heading", { name: "今天，继续推进" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /关闭|收起 FlowContext/ })).toHaveCount(0);

  const shell = page.locator('.flowcontext-app[data-mode="desktop"]');
  const todo = page.locator(".todo-section");
  const topics = page.locator(".topics-section");
  const daily = page.locator(".daily-lens-section");
  const topicCard = page.locator(".topic-card");
  await expect(todo).toBeVisible();
  await expect(topics).toBeVisible();

  expect(await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

  const styles = await Promise.all([shell, todo, daily, topicCard].map((locator) => locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, borderTopWidth: style.borderTopWidth, boxShadow: style.boxShadow };
  })));
  const [shellStyle, todoStyle, dailyStyle, topicStyle] = styles;
  expect(shellStyle.borderTopWidth).toBe("1px");
  expect(shellStyle.background).toBe("rgba(0, 0, 0, 0)");
  const shellBackground = await shell.evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    return { image: style.backgroundImage, opacity: style.opacity };
  });
  expect(shellBackground.image).toContain("desktop-shell-background");
  expect(shellBackground.opacity).toBe("0.65");
  expect(await shell.evaluate((element) => getComputedStyle(element, "::before").zIndex)).toBe("0");
  expect(await shell.locator(":scope > .app-header").evaluate((element) => getComputedStyle(element).zIndex)).toBe("1");
  expect(shellStyle.boxShadow).toBe("none");
  const shellBox = await shell.boundingBox();
  const todoBox = await todo.boundingBox();
  expect(shellBox).not.toBeNull();
  expect(todoBox).not.toBeNull();
  expect(420 - (shellBox!.x + shellBox!.width)).toBeGreaterThanOrEqual(24);
  expect(todoBox!.x - shellBox!.x).toBeGreaterThanOrEqual(10);
  expect(alpha(todoStyle.background)).toBeGreaterThan(alpha(dailyStyle.background));
  expect(alpha(topicStyle.background)).toBeLessThan(alpha(todoStyle.background));
  await expect(page).toHaveScreenshot("desktop-layering-420x900.png", { animations: "disabled", maxDiffPixelRatio: 0.02 });
});
