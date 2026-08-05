# 日期浮层与 Handoff 工作区自动绑定设计
## 目标
将 To-do 日期入口从原生日期选择器外观升级为参考图的悬浮日期列表；消除“继续此主题”无原因置灰，使每次确认 Handoff 自动保存当前 Codex Session 在当前设备上的项目工作区路径。
## 日期浮层
- 点击现有 `MM / DD` 触发器，在 To-do 卡片内左上方弹出紧凑浮层，不改变卡片布局高度。
- 列表以当前选中日期为中心，固定渲染前后各 3 天，共 7 行；每行格式为 `MM / DD 周X`。
- 当前选中行使用细蓝色描边，其他日期可点击切换；点击外部、Escape 或选中日期后关闭。
- 浮层有受控滚动容器与顶部/底部淡出，不在窄浮窗横向溢出。
- 日期触发器保持键盘可访问；原生 `input[type=date]` 保留为无障碍/系统选择器兜底，但不重复进入 Tab 或辅助技术导航。
- Web 仍同步 `?date=` 与 popstate；桌面仍保留运行期日期；Todo 与 Daily Lens 继续使用同一日期状态。
## Continuity 按钮状态
- Topic context 正在加载时，按钮显示加载中且不可触发，不使用“灰色且无说明”的最终禁用态。
- 无 Handoff/Session 时保留不可继续的解释文案；有 Handoff 但缺当前设备 workspace 时显示“下次 Handoff 将自动配置此设备”，不伪造 Codex 链接。
- 已得到完整 context 后，`继续此主题` 使用当前设备映射生成 `codex://new`；仍有进行中的 Session 时打开既有 thread。
## Session 平台事实与 Handoff 原子工作区绑定
- Session 增加不可变 `platform`（`macos | windows`）；`flowcontext-session` 在开工绑定时由当前运行平台写入，旧 Session 不推测平台。
- `generating-handoff` 的确认写入契约扩展为：从已绑定 Session 取得 `device_id`、`platform`、`workspace_path` 与 Topic 对应 Project，并在同一数据库 RPC 中 upsert `device_workspaces(owner_id, device_id, project_id)`。
- Handoff、Topic 连续性更新和 device workspace upsert 属于单一事务：任一校验或写入失败则全部回滚；幂等重试不得创建重复 Handoff 或错误覆盖无关项目映射。
- 路径仅来自服务器已验证的 Session，不从客户端 Handoff JSON 接收；不会允许 Handoff 改写 Project、Topic state 或任意其他设备的路径。
- 现有已写入 Handoff 不主动猜测/回填；下一次确认 Handoff 自动补齐。当前 FlowContext Topic 的已知映射只可通过一次受控、owner-scoped backfill 写入 `/Users/camus/Documents/FlowContext`，作为单独可审计操作。
## 测试与验收
- 日期：7 行、星期格式、选中样式、点击/外部/Escape 关闭、Web URL、桌面状态、窄窗无溢出和键盘访问。
- Continuity：context loading、缺 workspace 的说明、完整 context 可点击、现有 Session 打开 thread。
- Handoff：同事务成功、工作区写入失败全回滚、重试幂等、仅 Session 的 owner/device/project/path 可写、其他 owner/项目不受影响。
- 自动化：Web 单测、Edge/数据库测试、`pnpm verify`、Web build、Playwright；发布前对远端 RPC 执行最小 owner-scoped验证。
## 非目标
- 不引入任意路径选择器，不让浏览器前端直接写 `device_workspaces`，不恢复自托管 HTTP Provider 的未完成 GET 路由，也不改变 Topic 完成语义。
