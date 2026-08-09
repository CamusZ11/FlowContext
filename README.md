# FlowContext
FlowContext 是 macOS 与 Windows 共用的个人工作上下文浮窗：显示当天 To-do、Topic 连续性与 Daily Note 投影，并能从当前设备继续 Codex 任务。
## 当前运行方式
- `apps/api` 是唯一生产数据服务：用户自有 PostgreSQL + HTTPS API；设备以一次性注册码登记，令牌只保存在系统受保护存储。
- Obsidian 保存 Project 的长期事实；API 保存 Topic Card、Session、Handoff、To-do、Daily Projection 与设备工作区映射。
- macOS 版支持托盘、`CommandOrControl+Shift+Space`、所选显示器右侧 2 px 热区和原生全屏应用之上的非激活浮层。
- Windows 构建、安装及多显示器实机验收仍待完成。
## 目录
- `apps/api`：自托管 API、PostgreSQL schema、设备登记与集成测试。
- `apps/desktop`：Tauri 桌面壳、热区、原生窗口、托盘与安全存储。
- `apps/web`：无密码设备登记、To-do、Topic、Daily Note 界面。
- `packages`：共享领域、HTTP 仓储与 Obsidian 投影。
- `deploy/flowcontext`：服务器部署和日常运维入口。
- `tools`：Codex CLI 与 Obsidian 投影同步。
- `integrations`：FlowContext Session 与 Handoff Skills 及测试。
## 本地开发
```bash
pnpm install
pnpm verify
pnpm --filter @flowcontext/desktop tauri dev
```
从 `.env.example` 创建本机 `apps/web/.env`，配置：
```dotenv
VITE_FLOWCONTEXT_PROVIDER=self-hosted
VITE_FLOWCONTEXT_API_URL=https://your-flowcontext-api.example
```
实际 URL、设备令牌、注册码和数据库连接串不得写入 Git。
## 部署与验收
- 服务器部署与设备管理见 [`deploy/flowcontext/README.md`](deploy/flowcontext/README.md)。
- 当前运行边界、常规检查和故障排查见 [`docs/self-hosted-operations.md`](docs/self-hosted-operations.md)。
- 桌面端人工验收见 [`apps/desktop/tests/acceptance-checklist.md`](apps/desktop/tests/acceptance-checklist.md)。
## 项目上下文
状态、关键判断与当前 Handoff 位于 `/Users/camus/All_in_Context/03_项目/00_收集箱/FlowContext`。
