# FlowContext
FlowContext 是 macOS 与 Windows 共用的个人工作上下文浮窗：显示当天 Daily Note、Topic 连续性和按计划执行时间排序的 To-do，并可通过 Codex Deep Link 恢复任务。
## 当前范围
- Web 与 Tauri 共用 React 前端
- 用户自有 PostgreSQL 与 FlowContext API 保存 Topic Card、Session、Handoff 与 To-do；Obsidian 继续保存 Project 事实
- 桌面端提供托盘、快捷键、所选显示器右侧 2 px 热区和 150 ms 唤出
- 鼠标位于浮窗内时保持显示，移出后在下一次 25 ms 采样隐藏
- macOS 普通桌面版本可运行；原生全屏 Space 覆盖仍待修复
- Windows 构建、安装和真实多显示器验收尚未完成
## 目录
- `apps/desktop`：Tauri 桌面壳与原生窗口逻辑
- `apps/web`：登录、Daily Note、Topic 和 To-do 界面
- `apps/api`：自托管 PostgreSQL schema、HTTP API 与设备登记
- `packages`：共享领域与数据层
- `supabase`：迁移完成前保留的历史 schema 与测试，不再作为生产运行时
- `tools`：Codex CLI、投影同步与一次性数据迁移工具
- `integrations`：Session/Handoff 集成
## 开始
```bash
pnpm install
pnpm verify
pnpm --filter @flowcontext/desktop tauri dev
```
浏览器开发需从 `.env.example` 创建本机 `.env.local`，配置 `VITE_FLOWCONTEXT_PROVIDER=self-hosted` 与 `VITE_FLOWCONTEXT_API_URL`；不要提交实际 URL 或凭据。桌面端也可使用应用内本机配置。
## 一次性数据迁移
迁移工具只处理 `project_projections`、`topic_cards`、`sessions`、`handoffs`、`todos`、`daily_projections`、`device_workspaces` 七张业务表，不导出认证用户、会话、设备 token 或服务器密钥。连接信息必须放在用户明确提供且未被 Git 跟踪的本机 env 文件中：
```dotenv
FLOWCONTEXT_SOURCE_DATABASE_URL=postgresql://...
FLOWCONTEXT_TARGET_DATABASE_URL=postgresql://...
```
```bash
pnpm flowcontext-migrate export --env-file .env.migration --output flowcontext-migration
pnpm flowcontext-migrate import --env-file .env.migration --input flowcontext-migration
pnpm flowcontext-migrate verify --env-file .env.migration --input flowcontext-migration
```
导出目录内是七个 NDJSON 文件与 `manifest.json`，文件权限为 `0600`。导入默认只接受空目标；`--replace-empty-target` 仍要求目标数据库显式设置 `flowcontext.disposable_target=true`，只应用于可丢弃环境。切换设备后应重新登记并签发新设备凭据。
## 项目上下文
状态、关键判断与详细 Handoff 位于：`/Users/camus/All_in_Context/03_项目/00_收集箱/FlowContext`。
