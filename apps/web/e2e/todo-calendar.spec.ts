import { expect, test, type Page } from "@playwright/test";

test("expands the selected day into the complete week and returns to the day view", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto("/?e2e=1&date=2026-08-05");
  await page.getByRole("button", { name: "日历", exact: true }).click();
  await page.getByRole("button", { name: "2026-08-05 10:00 创建日程" }).press("Enter");
  await addTodo(page, "周中会议");
  await page.getByRole("button", { name: "周视图", exact: true }).click();

  const week = page.getByRole("dialog", { name: "周视图" });
  await expect(week.getByRole("list", { name: /的定时任务/ })).toHaveCount(7);
  await expect(week.getByRole("button", { name: "2026-08-03", exact: true })).toBeVisible();
  await expect(week.getByRole("button", { name: "2026-08-09", exact: true })).toBeVisible();
  const checkbox = week.getByRole("checkbox", { name: "完成 周中会议" });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await week.getByRole("button", { name: "下一周" }).click();
  await expect(week.getByRole("button", { name: "2026-08-10", exact: true })).toBeVisible();
  await week.getByRole("button", { name: "关闭周视图" }).click();
  await expect(week).toHaveCount(0);
  await expect(page.getByRole("list", { name: /的定时任务/ })).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: "完成 周中会议" })).toBeChecked();
});

test("loads the standalone week window at its requested date even at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 650 });
  await page.goto("/?e2e=desktop-density&date=2026-08-05#todo-week");
  await expect(page.getByRole("list", { name: /的定时任务/ })).toHaveCount(7);
  await expect(page.getByRole("button", { name: "2026-08-05", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "建议继续" })).toHaveCount(0);
});

test("restores the last selected task view after reopening FlowContext", async ({ page }) => {
  await page.goto("/?e2e=desktop-density");
  const calendarButton = page.getByRole("button", { name: "日历", exact: true });
  const listButton = page.getByRole("button", { name: "列表", exact: true });
  const calendar = page.getByRole("region", { name: "任务日历" });

  await expect(listButton).toHaveAttribute("aria-pressed", "true");
  await calendarButton.click();
  await page.reload();
  await expect(calendarButton).toHaveAttribute("aria-pressed", "true");
  await expect(calendar).toBeVisible();

  await listButton.click();
  await page.reload();
  await expect(listButton).toHaveAttribute("aria-pressed", "true");
  await expect(calendar).toHaveCount(0);
});

async function addTodo(page: Page, title: string) {
  await page.getByLabel("添加事项").fill(title);
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

test("shows timed todos in a week on wide screens and by day in narrow windows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto("/?e2e=calendar-coverage&date=2026-08-05");
  const checkbox = page.getByRole("checkbox", { name: "完成 写结算说明" });
  await checkbox.click();
  await expect(checkbox).toBeChecked();

  await page.getByRole("button", { name: "选择日期，当前 2026-08-05" }).click();
  await page.getByRole("option", { name: "08 / 06 周四" }).click();

  const calendarButton = page.getByRole("button", { name: "日历", exact: true });
  await expect(calendarButton).toBeVisible();
  await calendarButton.click();
  const calendar = page.getByRole("region", { name: "任务日历" });
  const wednesday = calendar.getByRole("list", { name: "2026-08-05 的定时任务" });
  const thursday = calendar.getByRole("list", { name: "2026-08-06 的定时任务" });
  await expect(calendar.getByRole("list", { name: /的定时任务/ })).toHaveCount(7);
  const timeAxis = calendar.locator(".todo-calendar-hours");
  await expect(timeAxis.getByText("07:00", { exact: true })).toBeVisible();
  await expect(timeAxis.getByText("23:00", { exact: true })).toBeInViewport();
  await expect(wednesday.getByText("写结算说明")).toHaveCSS("text-decoration-line", "line-through");
  await expect(wednesday.getByText("收尾")).toBeVisible();
  await expect(wednesday.getByRole("listitem")).toHaveCount(3);
  await expect(thursday.getByText("发送结算单")).toBeVisible();
  await expect(calendar.getByRole("list", { name: "2026-08-05 的未排时间任务" }).getByText("准备资料")).toBeVisible();
  await expect(calendar.getByText(/提前出发|夜间备份/)).toHaveCount(0);

  const completed = await wednesday.getByRole("listitem").filter({ hasText: "写结算说明" }).boundingBox();
  const overlapping = await wednesday.getByRole("listitem").filter({ hasText: "核对汇总" }).boundingBox();
  expect(overlapping!.y).toBeGreaterThan(completed!.y);
  expect(overlapping!.x).toBeGreaterThanOrEqual(completed!.x + completed!.width - 1);
  const tallHeight = (await thursday.boundingBox())!.height;
  await page.setViewportSize({ width: 1280, height: 640 });
  expect((await thursday.boundingBox())!.height).toBeLessThan(tallHeight);

  await page.getByRole("button", { name: "下一周" }).click();
  await expect(calendar.getByRole("list", { name: "2026-08-13 的定时任务" })).toBeVisible();
  await page.getByRole("button", { name: "上一周" }).click();
  await expect(thursday.getByText("发送结算单")).toBeVisible();

  await page.setViewportSize({ width: 420, height: 700 });
  await expect(calendar.getByRole("list", { name: /的定时任务/ })).toHaveCount(1);
  await expect(thursday.getByText("发送结算单")).toBeInViewport();
  await expect(wednesday).toHaveCount(0);
  await page.getByRole("button", { name: "前一天" }).click();
  await expect(wednesday.getByText("写结算说明")).toBeVisible();
  await page.getByRole("button", { name: "2026-08-05 12:00 创建日程" }).press("Enter");
  await addTodo(page, "午间复核");
  await expect(wednesday.getByText("午间复核")).toBeVisible();
  await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.getByText("准备资料")).toBeVisible();
  await expect(page.getByText("提前出发")).toBeVisible();
});

test("creates at a clicked hour and moves untimed and timed cards across the calendar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto("/?e2e=1&date=2026-08-05");
  await addTodo(page, "安排复核");
  await page.getByRole("button", { name: "日历", exact: true }).click();

  const untimed = page.getByRole("list", { name: "2026-08-05 的未排时间任务" });
  const wednesday = page.getByRole("list", { name: "2026-08-05 的定时任务" });
  const thursday = page.getByRole("list", { name: "2026-08-06 的定时任务" });
  await expect(untimed.getByText("安排复核")).toBeVisible();

  const wednesdayGrid = (await wednesday.boundingBox())!;
  const thursdayGrid = (await thursday.boundingBox())!;
  const wednesdayX = wednesdayGrid.x + wednesdayGrid.width / 2;
  const thursdayX = thursdayGrid.x + thursdayGrid.width / 2;
  const hourY = (hour: number) => wednesdayGrid.y + wednesdayGrid.height * (hour - 7) / 16;

  await page.getByLabel("添加事项").fill("发出结算单");
  await page.mouse.click(thursdayX, hourY(10.5));
  await expect(page.getByLabel("添加事项")).toBeFocused();
  await expect(page.getByLabel("添加事项")).toHaveValue("发出结算单");
  await page.getByLabel("添加事项").press("Enter");
  await expect(thursday.getByRole("listitem").filter({ hasText: "发出结算单" })).toContainText("10:30");

  async function dragTask(source: ReturnType<Page["getByText"]>, x: number, y: number) {
    const box = (await source.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.up();
  }

  await dragTask(untimed.getByText("安排复核"), wednesdayX, hourY(11.25));
  await expect(wednesday.getByRole("listitem").filter({ hasText: "安排复核" })).toContainText("11:15");
  await expect(untimed.getByText("安排复核")).toHaveCount(0);

  // The time grid can move up after the final untimed task leaves the top row.
  const nextGrid = (await thursday.boundingBox())!;
  await dragTask(wednesday.getByText("安排复核"), thursdayX, nextGrid.y + nextGrid.height * (14 - 7) / 16);
  await expect(thursday.getByRole("listitem").filter({ hasText: "安排复核" })).toContainText("14:00");
  await expect(wednesday.getByText("安排复核")).toHaveCount(0);
  await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.getByTestId("todo-row").filter({ hasText: "安排复核" })).toContainText("14:00");
  await addTodo(page, "快捷追加");
  await expect(page.getByTestId("todo-row").filter({ hasText: "快捷追加" }).locator("time")).toHaveCount(0);
});

test("fits the whole day in the standard desktop panel and scrolls on shorter screens", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 7, 5, 12));
  await page.goto("/?e2e=desktop-density&date=2026-08-05");
  await page.getByRole("button", { name: "日历", exact: true }).click();
  await page.getByRole("button", { name: "2026-08-05 23:00 创建日程" }).press("Enter");
  await addTodo(page, "最后一项");

  const calendar = page.getByRole("region", { name: "任务日历" });
  const start = calendar.locator(".todo-calendar-hours").getByText("07:00");
  const last = calendar.getByText("最后一项");
  await expect(calendar.getByRole("list", { name: /的定时任务/ })).toHaveCount(1);
  await expect(start).toBeInViewport({ ratio: 1 });
  await expect(last).toBeInViewport({ ratio: 1 });

  await page.setViewportSize({ width: 360, height: 720 });
  await expect(last).not.toBeInViewport();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
});

test("opens time slots from the keyboard and leaves tasks in place when rescheduling fails", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 7, 5, 12));
  await page.goto("/?e2e=network-failure&date=2026-08-05");
  await page.getByRole("button", { name: "日历", exact: true }).click();
  const firstSlot = page.getByRole("button", { name: "2026-08-05 07:00 创建日程" });
  await firstSlot.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("添加事项")).toBeFocused();
  await addTodo(page, "键盘日程");
  await expect(page.getByRole("listitem").filter({ hasText: "键盘日程" })).toContainText("08:00");

  await page.getByRole("button", { name: /上午任务/ }).click();
  const form = page.getByRole("form", { name: "调整任务时间" });
  await form.getByLabel("任务时间").fill("14:00");
  await form.getByLabel("任务时间").blur();
  await expect(page.getByRole("alert")).toHaveText("时间调整失败，请重试");
  await expect(page.getByRole("list", { name: "2026-08-05 的定时任务" })).toContainText("09:00");
  await expect(form.getByLabel("任务时间")).toHaveValue("14:00");
});

test("automatically saves a category and preserves its color through completion", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto("/?e2e=calendar-coverage&date=2026-08-04");
  await page.getByRole("button", { name: "日历", exact: true }).click();

  const card = page.getByRole("listitem").filter({ hasText: "整理材料" });
  const task = card.getByRole("button", { name: /整理材料/ });
  await task.click();
  const category = page.getByLabel("分类", { exact: true });
  await expect(page.getByRole("form", { name: "调整任务时间" }).getByRole("button", { name: /保存|取消/ })).toHaveCount(0);
  await expect(category.locator("option")).toHaveText(["未分类", "工作", "学习", "日常", "健康"]);
  await category.selectOption("study");
  await expect(card).toHaveCSS("background-color", "rgb(253, 240, 223)");
  await expect(card).toContainText("14:00–17:00");
  await category.press("Escape");
  await card.getByRole("checkbox").click();
  await expect(card.getByRole("checkbox")).toBeChecked();
  await expect(card).toHaveCSS("background-color", "rgb(253, 240, 223)");
  await task.click();
  await expect(category).toHaveValue("study");
  await category.selectOption("");
  await expect(card).not.toHaveAttribute("data-category", "study");
});

test("automatically saves the end time and date when leaving the edited field", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto("/?e2e=calendar-coverage&date=2026-08-04");
  await page.getByRole("button", { name: "日历", exact: true }).click();

  const card = page.getByRole("listitem").filter({ hasText: "整理材料" });
  await card.getByRole("button", { name: /整理材料/ }).click();
  const endTime = page.getByLabel("结束时间");
  await endTime.fill("16:45");
  await endTime.blur();
  await expect(card).toContainText("14:00–16:45");

  const date = page.getByLabel("任务日期");
  await date.fill("2026-08-05");
  await date.blur();
  await expect(card).toHaveCount(0);
  await date.press("Escape");
  await page.getByRole("button", { name: "后一天" }).click();
  await expect(card).toContainText("14:00–16:45");
});

test("shows the task's archived timers and total in the calendar and list", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto("/?e2e=calendar-coverage&date=2026-08-04");
  await page.getByRole("button", { name: "计时记录 整理材料" }).click();
  const history = page.getByRole("dialog", { name: "计时记录" });
  await expect(history.getByText("累计耗时")).toBeVisible();
  await expect(history.getByText("02:15")).toBeVisible();
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(history.getByText("01:30")).toBeVisible();
  await expect(history.getByText("00:45")).toBeVisible();
  await history.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "日历", exact: true }).click();
  await page.getByRole("button", { name: /整理材料/ }).click();
  await page.getByRole("button", { name: "计时记录", exact: true }).click();
  await expect(history.getByText("02:15")).toBeVisible();
});

test("leaves a small gap between back-to-back calendar tasks", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto("/?e2e=calendar-coverage&date=2026-08-04");
  await page.getByRole("button", { name: "日历", exact: true }).click();

  const tasks = page.getByRole("list", { name: "2026-08-04 的定时任务" });
  const first = tasks.getByRole("listitem").filter({ hasText: "整理材料" });
  const second = tasks.getByRole("listitem").filter({ hasText: "复核材料" });
  await expect(first).toContainText("14:00–17:00");
  await expect(second).toContainText("17:00–18:00");
  const firstBox = (await first.boundingBox())!;
  const secondBox = (await second.boundingBox())!;
  const gap = secondBox.y - (firstBox.y + firstBox.height);
  expect(gap).toBeGreaterThanOrEqual(2);
  expect(gap).toBeLessThanOrEqual(4);
});

test("resizes either end of a calendar task and toggles completion in both rows", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto("/?e2e=1&date=2026-08-05");
  await addTodo(page, "待排任务");
  await page.getByRole("button", { name: "日历", exact: true }).click();
  await page.getByRole("button", { name: "2026-08-05 10:00 创建日程" }).press("Enter");
  await addTodo(page, "时段任务");

  const calendar = page.getByRole("region", { name: "任务日历" });
  const grid = calendar.getByRole("list", { name: "2026-08-05 的定时任务" });
  const card = grid.getByRole("listitem").filter({ hasText: "时段任务" });
  const { y, height } = (await grid.boundingBox())!;
  const timeY = (hour: number) => y + height * (hour - 7) / 16;

  async function dragEdge(edge: "开始" | "结束", hour: number) {
    const handle = await card.locator(`[data-resize-edge="${edge}"]`).boundingBox();
    expect(handle).not.toBeNull();
    const x = handle!.x + handle!.width / 2;
    await page.mouse.move(x, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, timeY(hour), { steps: 8 });
    await page.mouse.up();
  }

  await dragEdge("结束", 12);
  await expect(card).toContainText("10:00–12:00");
  await dragEdge("开始", 9.5);
  await expect(card).toContainText("09:30–12:00");

  const body = (await card.getByRole("button").boundingBox())!;
  const middleX = body.x + body.width / 2;
  const middleY = body.y + body.height / 2;
  await page.mouse.move(middleX, middleY);
  await page.mouse.down();
  await page.mouse.move(middleX, middleY + height / 16, { steps: 8 });
  await page.mouse.up();
  await expect(card).toContainText("10:30–13:00");

  await card.getByRole("button").click();
  const editor = page.getByRole("form", { name: "调整任务时间" });
  await editor.getByLabel("任务时间", { exact: true }).fill("06:30");
  await editor.getByLabel("任务时间", { exact: true }).blur();
  await expect(card).toContainText("06:30–13:00");
  await editor.getByLabel("任务时间", { exact: true }).press("Escape");
  await dragEdge("结束", 8);
  await expect(card).toContainText("06:30–08:00");

  for (const title of ["待排任务", "时段任务"]) {
    const checkbox = calendar.getByRole("checkbox", { name: `完成 ${title}` });
    await checkbox.click();
    await expect(checkbox).toBeChecked();
  }
  await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "完成 时段任务" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "完成 待排任务" })).toBeChecked();
});
