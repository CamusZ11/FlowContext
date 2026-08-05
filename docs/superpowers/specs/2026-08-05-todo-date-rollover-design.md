# To-do 日期切换与隔日顺延设计
## 目标
将桌面端固定的“今日待办”改为可切换日期的待办视图。日期以 `08 / 19` 的零填充月/日格式显示，使用紧凑等宽数字字形；点击日期后选择目标日期并展示该日 To-do。用户进入当天时，昨天未完成事项自动顺延到当天；历史日期浏览不改变数据。
## 非目标
不迁移两天以前的未完成事项；不复制 To-do；不改变已完成事项的日期；不新增本地业务存储；不为本次默认云端路径补全自托管 HTTP API 的既有 CRUD 缺口。
## 交互
- To-do 卡片标题区显示一个可点击的日期按钮，视觉为 `MM / DD`，例如 `08 / 19`；采用 `ui-monospace`、`SFMono-Regular`、`SF Mono`、`Menlo` 的回退栈，数字大号、细字重、紧凑字距。
- 按钮有完整无障碍名称，例如“选择日期：2026年8月19日”。点击打开原生日期选择器；选中后更新当前日期、To-do 查询和 Daily Projection。
- 当前日期不再由 Desktop 强制锁定为今天。新建 To-do 默认写入当前所选日期；完成、删除和订阅继续限定在当前日期。
- 日期为今天时，应用先执行昨天到今天的顺延，再读取/订阅今天的列表；日期不是今天时只读取。
## 数据与一致性
- 新增 owner-scoped Supabase RPC：输入 `from_date` 与 `to_date`，仅更新 `owner_id = auth.uid()`、`planned_date = from_date`、`is_completed = false` 的行，将 `planned_date` 改为 `to_date`。
- RPC 在单条 UPDATE 中执行，重复调用没有副作用；不会生成副本，也不触及已完成项、两天前事项、关联 Project/Topic、标题或时间。
- 数据访问层公开 `rolloverIncompleteTodos(fromDate, toDate)`；默认 Supabase repository 调用 RPC。`useTodos` 只在 `date === platform.today()` 时调用它，并在完成后刷新昨天和今天的缓存与当前订阅视图。
- RPC 失败时保留原列表并显示既有待办错误状态；不得静默把前一日事项从 UI 隐藏。
## 验收与测试
- 领域/数据测试：仅迁移严格前一天的未完成项；完成项与更早事项不变；重复执行幂等；按 owner 隔离。
- RLS/数据库测试：未登录不可调用，调用者不能迁移其他 owner 的 To-do。
- 前端测试：Desktop 与 Web 都可切换日期；日期按钮显示 `MM / DD` 并带完整 accessible name；历史日期不调用 rollover；打开今天后今日列表包含被顺延事项；新增事项带当前选择日期。
- 回归：现有完成乐观更新、排序、删除和日期实时订阅测试继续通过。
## 实施边界
涉及 `apps/web` 日期选择/To-do UI、`packages/domain` 与 `packages/data` repository、`supabase` 新迁移及 RLS 测试；不修改 macOS overlay、认证、Topic/Handoff 或实际 Supabase 凭据。
