# FlowContext
FlowContext 是 macOS 与 Windows 共用的个人工作上下文浮窗：显示当天 Daily Note、Topic 连续性和按计划执行时间排序的 To-do，并可通过 Codex Deep Link 恢复任务。
## 当前范围
- Web 与 Tauri 共用 React 前端
- Supabase 保存 Topic Card、Session、Handoff 与 To-do；Obsidian 继续保存 Project 事实
- 桌面端提供托盘、快捷键、所选显示器右侧 2 px 热区和 150 ms 唤出
- 鼠标位于浮窗内时保持显示，移出后在下一次 25 ms 采样隐藏
- macOS 普通桌面版本可运行；原生全屏 Space 覆盖仍待修复
- Windows 构建、安装和真实多显示器验收尚未完成
## 目录
- `apps/desktop`：Tauri 桌面壳与原生窗口逻辑
- `apps/web`：登录、Daily Note、Topic 和 To-do 界面
- `packages`：共享领域与数据层
- `supabase`：数据库与 Edge Function
- `tools`：Codex CLI 与投影同步
- `integrations`：Session/Handoff 集成
## 开始
```bash
pnpm install
pnpm verify
pnpm --filter @flowcontext/desktop tauri dev
```
浏览器开发需从 `.env.example` 创建本机 `.env.local`；不要提交实际 URL 或 Key。桌面端也可使用应用内本机配置。
## 项目上下文
状态、关键判断与详细 Handoff 位于：`/Users/camus/All_in_Context/03_项目/00_收集箱/FlowContext`。
