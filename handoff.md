# Handoff
### Handoff｜FlowContext 跨平台桌面端继续实现
- 已得到：Supabase 数据层、共享 Web/Tauri 前端、登录入口、当日 To-do、Codex Deep Link、macOS 右侧热区基础版本已实现；Rust 35 项与 Web 30 项测试通过；macOS 安装包可启动
- 停在：macOS 普通桌面可唤出，但原生全屏 Space 覆盖仍未通过真实验收；`CanJoinAllSpaces | FullScreenAuxiliary` 与取消自动聚焦均未最终解决
- 原因：先把混在 Obsidian/worktree 内的软件资产迁到独立、干净的项目根，再从稳定路径继续调试；不继续沿用旧目录里的本地 Vault ADR、自托管/备份方案和已执行计划
- 下一步：
  - 在新项目根复现并解决 macOS 原生全屏覆盖，优先验证非激活 `orderFront`/窗口类型，而不是继续叠加窗口 flag
  - 在 Windows 建立同一代码库环境，安装 Node/pnpm、Rust MSVC 与 WebView2，运行前端、Rust 和 Tauri 构建
  - 验证 Windows 所选显示器的 2 px 右侧热区、150 ms 唤出、浮窗内驻留、移出后下一次 25 ms 采样隐藏、托盘与快捷键
  - 配置 Windows 端 Supabase 公共 URL/Key 的本机存储，不把实际配置写入 Git
  - 完成 Windows 登录、当天 To-do 读取/勾选、SSE 更新、Codex Deep Link、多显示器和安装包验收
  - 第一版暂不处理备份、签名、公证和自动更新
- 重新浮现：本次迁移验证完成后；Windows 设备可用时进入 Windows 验收
- 恢复第一步：打开 `/Users/camus/Documents/FlowContext`，读取 `AGENTS.md`，再读取本 Handoff 并运行基础测试
