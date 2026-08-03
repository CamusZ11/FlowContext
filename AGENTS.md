# FlowContext 项目协作规则
## 项目定位
- 本目录是 FlowContext 的独立源码根，只保存当前有效的源码、配置、测试和运行入口
- Obsidian 项目 Context 位于 `/Users/camus/All_in_Context/03_项目/00_收集箱/FlowContext`，不把源码复制回 Vault
- JavaScript/TypeScript 使用 `pnpm`；功能与修复遵守测试先行
- 不写入 Secret、Token、Supabase 实际 Key 或个人凭据；只提交示例配置
- 不增加本地业务 SQLite；本机只保存设备偏好与登录会话
- 第一版暂不处理备份、签名、公证和自动更新
## 目录职责
- `apps/`：共享 Web 前端与 Tauri 桌面应用
- `packages/`：领域模型、数据访问与 Daily Note 投影
- `supabase/`：数据库迁移、RLS、Edge Function 与测试
- `tools/`：Codex CLI 与投影同步工具
- `integrations/`：Session/Handoff 集成及其测试
- `tests/`：工作区结构与跨组件固定样例

<!-- obsidian-project-context:start -->
## Obsidian 项目上下文
- 原始项目根：`/Users/camus/Documents/FlowContext`
- Obsidian Context：`/Users/camus/All_in_Context/03_项目/00_收集箱/FlowContext`
- Vault 入口：`[[03_项目/00_收集箱/FlowContext/index]]`
- 开工前读取 `index.md`、`status.md`、`source.md`，以及已经存在的 `handoff.md`、`decisions.md`。
- 收工后把已验证进展、卡点、下一步和验证证据写入 `status.md`；稳定边界变化更新 `index.md`；来源与入口变化更新 `source.md`。
- `index.md` 是稳定首页；`status.md` 是动态工作面；`source.md` 是权威来源索引；复杂后才增加 `handoff.md` 和 `decisions.md`。
- 原始项目保存源码、数据、配置和交付物；Obsidian 只保存项目目的、阶段、判断、证据和入口，不复制原始资产或凭据。
- 修改 B/C 项目的 `status.md.status` 后，在任务结束前调用 `$obsidian-project-context-sync` 并运行 `scheduled-audit` 或 `audit` 检查目录与项目看板。
- 只同步已验证事实；推断和未知必须明确标记，不得删除仍可能有效的旧事实。
<!-- obsidian-project-context:end -->
