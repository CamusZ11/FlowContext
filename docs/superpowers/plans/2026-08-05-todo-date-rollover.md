# To-do 日期切换与今日滚动实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 逐项执行；实现阶段严格按每个任务的测试先行顺序推进。

**目标：** 将“今日待办”标题改为可切换日期的 `MM / DD` 控件；用户进入当天时，仅将其本人前一天未完成的 To-do 原子移动到今天，并展示目标日期的 To-do。

**边界：** 浏览历史日期绝不触发搬运；已完成、早于前一天的事项不动；重复进入当天不复制、不继续向前搬运；自托管 HTTP Provider 维持现状（本期不支持该 RPC）。

**技术路径：** PostgreSQL `SECURITY INVOKER` RPC 以 `auth.uid()` 约束 owner 并在一次 `UPDATE` 中完成前一天→今天的搬运。`SupabaseFlowRepository` 暴露该端口，React Query 在选中当天后调用它、刷新今天与昨天的缓存；日期选择器同时用于 Web 和 Tauri。日期状态在 Web 继续同步 `?date=`，桌面仅保留运行期状态。

---

## 任务 1：新增 owner-scoped 原子滚动 RPC 与数据库验证

**文件：**
- 新建：`supabase/migrations/<timestamp>_rollover_incomplete_todos.sql`
- 修改：`supabase/tests/core_schema.test.sql`
- 修改：`supabase/tests/rls.test.sql`

**步骤：**
1. 先为 SQL 测试补充失败断言：未认证调用被拒绝；传入非相邻日期被拒绝；已完成、其他 owner、早于 `from_date` 的行不变。
2. 用 `supabase migration new rollover_incomplete_todos` 创建迁移，定义：
   ```sql
   create or replace function public.rollover_incomplete_todos(
     p_from_date date,
     p_to_date date
   ) returns setof public.todos
   language plpgsql
   security invoker
   set search_path = public, pg_temp
   ```
3. 在函数中拒绝空日期及非 `p_from_date + 1 = p_to_date`；以 `(select auth.uid())` 得到 owner，未认证立即异常；用单条 `UPDATE public.todos SET planned_date = p_to_date, updated_at = now()`，限定 `owner_id = auth.uid()`、`planned_date = p_from_date`、`is_completed = false`，并 `RETURN QUERY ... RETURNING *`。
4. 显式撤销 `public`、`anon` 权限，授予 `authenticated` 与 `service_role` 的 `EXECUTE`；保持 `SECURITY INVOKER`，不绕过现有 RLS。
5. 在 core schema 测试中 seed 前一天未完成、前一天完成、两天前未完成及另一 owner 的事项；认证为目标 owner 后调用函数，断言仅前一天未完成移动且返回；再次调用断言空返回和无重复。
6. 在 RLS 测试中以另一用户认证，断言函数既不能搬运目标 owner 行，也只影响调用者自己的行。
7. 执行本地数据库测试（若本机 Supabase 容器已启动）：`supabase test db`。若 Docker 未启动，记录为外部运行前置条件，不用 SQL 模拟代替。

## 任务 2：把 rollover 作为 Supabase 仓储能力暴露，并覆盖适配器契约

**文件：**
- 修改：`packages/data/src/FlowRepository.ts`
- 修改：`packages/data/src/SupabaseFlowRepository.ts`
- 修改：`packages/data/src/SupabaseFlowRepository.test.ts`
- 可能修改：`packages/data/src/HttpFlowRepository.ts`、`packages/data/src/HttpFlowRepository.test.ts`（仅为满足新增接口，方法明确抛出“暂不支持”）
- 修改：所有测试内构造的 `FlowRepository` fake（由 TypeScript 编译报错逐一定位）

**步骤：**
1. 先在 `SupabaseFlowRepository.test.ts` 扩展记录 client，添加 `rpc(name, args)` spy，并写红测：
   - 合法 `2026-08-04 → 2026-08-05` 调用 `rollover_incomplete_todos` 与 `{ p_from_date, p_to_date }`；
   - 返回行映射为 `Todo[]`；
   - 非 ISO 日期和相同/不相邻日期在网络调用前报错；
   - Supabase 错误原样上抛。
2. 在 `FlowRepository` 加入：
   ```ts
   rolloverIncompleteTodos(fromDate: string, toDate: string): Promise<Todo[]>;
   ```
3. 将 `rpc` 加到 `SupabaseClientLike`，实现仓储方法；复用 `assertIsoDate`，另设 `assertNextDay(fromDate, toDate)`，避免客户端向 RPC 发出无效日期。
4. 对现有 `HttpFlowRepository` 加入同名方法并明确抛出稳定错误（例如 `rolloverIncompleteTodos is not supported by the self-hosted provider`），不伪造非原子多请求实现；为它写对应测试。
5. 更新所有 `FlowRepository` 测试 fake，默认提供无副作用的 `async () => []`。
6. 运行：`pnpm --filter @flowcontext/data test && pnpm --filter @flowcontext/data typecheck`。

## 任务 3：以 React Query 在“进入今天”时执行一次滚动并同步日期缓存

**文件：**
- 修改：`apps/web/src/features/todos/useTodos.ts`
- 新建：`apps/web/src/features/todos/useTodos.test.tsx`（或将 hook 用例加入现有 `TodoSection.test.tsx`，以最小重复为准）

**步骤：**
1. 先写红测，用可控 `PlatformPort.today()` 和仓储 fake 验证：
   - 选中历史日不调用 `rolloverIncompleteTodos`；
   - 首次选中今天调用一次 `(yesterday, today)`，随后加载/刷新今天列表；
   - 同一挂载周期中 rerender 今天不重复调用；
   - RPC 成功后使今天和昨天的 `todosQueryKey` 失效；
   - RPC 失败时显示加载错误/可重试，而不是静默吞掉。
2. 将“今天”通过 `usePlatform().today()` 注入 `useTodos`（或从调用处显式传入，以测试可控和依赖清晰为准），使用独立 `useQuery` / `useEffect` 配合稳定的 key，例如 `['todos-rollover', today]`。
3. 仅当 `date === today` 执行仓储 RPC；计算昨天使用纯 ISO 日期工具（UTC 或明确本地日历算法），不得用 `Date#toISOString()` 造成时区越界。
4. 当滚动成功，`invalidateQueries` 今天与昨天；保证随后 `listTodos(date)` 取得服务端真实状态，Realtime 通知只作为补充刷新。
5. 不在浏览历史日期、创建/勾选 To-do、应用启动但尚未确定当天日期等路径调用该 RPC。
6. 运行：`pnpm --filter @flowcontext/web test && pnpm --filter @flowcontext/web typecheck`。

## 任务 4：统一 Web/桌面日期选择，采用 `MM / DD` 标题排版

**文件：**
- 修改：`apps/web/src/features/calendar/useSelectedDate.ts`
- 修改：`apps/web/src/features/calendar/DateSelector.tsx`
- 修改：`apps/web/src/features/calendar/DateSelector.test.tsx`
- 修改：`apps/web/src/features/todos/TodoSection.tsx`
- 修改：`apps/web/src/features/todos/TodoSection.test.tsx`
- 修改：`apps/web/src/features/todos/TodoForm.tsx`
- 修改：`apps/web/src/features/todos/todo.css`
- 视现有样式组织修改：`apps/web/src/styles/tokens.css`

**步骤：**
1. 先调整 `DateSelector` 测试：两个 mode 都渲染可访问名称为“选择日期”的原生日期输入；触发 change 均传出 ISO 日期。删除“desktop 不渲染”的旧期望。
2. 为 `useSelectedDate` 写/补单元测试：桌面改选日期后保留选择值；Web 继续更新 `?date=` 且处理浏览器后退；当 `platform.today()` 跨日更新时，仅在原本选中当天时跟随新当天，浏览历史不被强制跳回今天。
3. 移除桌面强制 today 的返回值与 effect；初始值统一读取合法 URL 日期或 `platform.today()`，但只有 Web 写入 URL。
4. 将 `DateSelector` 变成视觉隐藏但键盘可访问的日期输入（或由显式按钮触发 `showPicker()` 并保留 fallback），在 To-do 标题中显示格式化后的两段数字：
   ```tsx
   <button aria-label={`选择日期，当前 ${date}`} className="todo-date-trigger">08 <span>/</span> 19</button>
   ```
   点击后打开同一原生日期输入，选择后更新 App 的 `selectedDate`；不得依赖仅 Chromium 支持的 API 而没有 click fallback。
5. 从 `App.tsx` 将 `selectedDate/onChange` 传入日期控件所在位置；删除与 To-do 标题重复的全局日期选择器，确保 Daily Lens 和 TodoSection 都由同一个日期状态驱动。
6. `TodoSection` 标题不再固定“今日待办”，改为可访问的日期标题；空态文案从“今天还没有安排”调整为中性“这一天还没有安排”。
7. `TodoForm` 始终以当前选中 `date` 创建，移除 Web 内部独立日期字段，避免用户标题选 8/19 却把事项写到另一日期；用 effect 在外部 `date` 变化时重置内部日期状态（或直接不维护该 state）。
8. 在 `todo.css` 添加 desktop/web 共用日期触发器：`font-family: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, monospace; font-variant-numeric: tabular-nums;`，以窄字重、紧凑 `letter-spacing` 和 slash 的较小权重匹配确认图；保持点击热区与键盘焦点可见。
9. 更新 `TodoSection` 测试验证日期按钮、切换后标题/空态、创建事项计划日期跟随所选日期；保留待办排序、乐观更新及 Realtime 回归测试。
10. 运行：`pnpm --filter @flowcontext/web test && pnpm --filter @flowcontext/web typecheck`。

## 任务 5：完整回归、实机验收与项目状态记录

**文件：**
- 修改：`/Users/camus/All_in_Context/03_项目/00_收集箱/FlowContext/status.md`
- 如稳定边界变化：`/Users/camus/All_in_Context/03_项目/00_收集箱/FlowContext/index.md`

**步骤：**
1. 运行：`pnpm verify`；另运行 `pnpm --filter @flowcontext/web build`，确认 Vite/Tauri 共享前端可生产构建。
2. 在已认证 Supabase 环境手工验收：创建昨天未完成、昨天已完成、两天前未完成三项；重启/进入当天，确认仅第一项移动；退出再进确认无复制；浏览昨天确认不触发任何移动。
3. 运行桌面开发或打包应用，验收点击 `MM / DD` 可切换历史/当天、Todo 与 Daily Lens 同步、添加事项写入正在看的日期；检查窄浮窗下数字不折行、日期按钮有键盘焦点。
4. 仅暂存本功能新增/修改文件，避免把现有 sleep/wake 未提交改动带入提交；按逻辑提交（迁移+数据层、UI+测试、文档可分开）。
5. 把已验证命令、实机结果、未覆盖的自托管 Provider 边界写入 `status.md`；按 AGENTS 规则运行 `obsidian-project-context-sync` 的 `audit` 或 `scheduled-audit`。

## 验收标准

1. 用户能在 Web 和桌面浮窗点击 To-do 区域日期，看到确认格式的 `MM / DD`，切换后 Todo 与 Daily Lens 同步为该 ISO 日期数据。
2. 仅进入今天时，前一天未完成事项在服务器端单次、owner-scoped、原子地改为今天；再次进入不复制。
3. 已完成、其他 owner、早于前一天的事项绝不改变，浏览历史日期绝不触发搬运。
4. 已有排序、乐观 checkbox、Realtime 刷新和日期参数行为测试继续通过。
5. `pnpm verify`、Web build、可用时 `supabase test db` 都通过；任何 Docker 未运行导致的数据库实测会被明确记录而不伪称已验证。
