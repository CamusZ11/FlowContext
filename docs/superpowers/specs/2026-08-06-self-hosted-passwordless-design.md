# FlowContext 单人免登录自托管设计
## 目标
将 FlowContext 从 Supabase Cloud 迁移到用户自有服务器。日常使用只允许已登记的 Mac 与 Windows 设备自动访问，不显示账号/密码登录页；不暴露数据库，也不保留 Supabase Auth、Realtime、Edge Function 或 SaaS 依赖。
## 范围
- 服务器运行 PostgreSQL、FlowContext API 与 Caddy；以 Docker Compose 统一部署和升级。
- 复用现有领域模型与 `FlowRepository` 前端边界，补齐现有 HTTP Provider 缺失的读取、Topic Context、Daily Projection、SSE 与 To-do 滚动能力。
- 以每设备不透明令牌替代账号会话：令牌仅保存在 macOS Keychain/Windows Credential Manager，服务端只保存 SHA-256 哈希。
- 导出现有 Supabase 的业务数据，导入新库并在切换前做行数、关系和关键业务样本校验。
- 从桌面端移除登录表单；无设备凭据时仅展示一次性设备登记界面。
## 非目标
- 不提供多人协作、浏览器公开访问、账号注册、密码找回或社交登录。
- 不新增本地业务数据库、离线写入、数据库公网端口、自动更新、备份产品能力或移动端。
- 不迁移 Supabase Auth 用户、JWT、RLS 策略或服务密钥；这些都是旧实现细节，不是业务数据。
## 总体架构
```text
FlowContext macOS / Windows
  ├─ Keychain 或 Credential Manager：device_id + device_token
  └─ HTTPS + Authorization: Bearer <device_token>
                   │
                   ▼
Caddy（仅 443；自动 TLS；请求体与访问日志不记录令牌）
                   │
                   ▼
FlowContext API（私有 Docker 网络）
  ├─ 设备令牌认证、登记、吊销
  ├─ REST 读写、SSE To-do 更新、Handoff 原子事务
  └─ PostgreSQL 事务与参数化查询
                   │
                   ▼
PostgreSQL（无 host 端口映射；仅 API 可连接）
```
## 身份与设备生命周期
### 日常访问
1. 已安装客户端从受保护系统存储取得 `device_id` 与 `device_token`。
2. 每个 API 请求带 `Authorization: Bearer <device_token>`；API 对令牌哈希查询未吊销设备并得到唯一内部 owner。
3. API 返回固定单人 `AuthSession`，因此现有 `AuthGate` 直接进入主界面；没有登录、退出和用户名密码表单。
4. API 遇到无效或被吊销令牌返回 `401 device_unauthorized`；客户端删除受保护存储并转入设备登记页。
### 首次登记与换机
1. 管理员在服务器内部命令生成单次、短时有效的登记码；数据库只保存其哈希、过期时间与使用状态。
2. 新设备在登记页输入 API 地址和登记码一次。API 校验后生成高熵设备令牌并只在该响应中返回一次。
3. 客户端立即把令牌写进系统受保护存储，登记码作废；之后不再向用户索取任何账号或密码。
4. 丢失设备时管理员用服务器内部命令吊销对应 `device_id`；该设备下一次请求即失效。恢复同一设备也按新的单次登记完成。
5. 初期登记码是受控运维动作，不在环境变量、构建产物、截图、日志、Git 或命令历史中保存。
## 数据模型与迁移
### 目标模型
- 保留业务表：`project_projections`、`topic_cards`、`sessions`、`handoffs`、`todos`、`daily_projections`、`device_workspaces`、`device_tokens`。
- 新增单人 `owners` 表，替代所有对 `auth.users` 的外键；初始化时生成一个唯一 owner，并由每台已登记设备映射到它。
- 保留主键、外键、唯一约束、时间字段、Handoff 幂等键与 To-do 日期索引；把 Supabase 专用 RLS/Realtime publication 替换为 API 层认证、数据库约束与 API 内 SSE 通知。
- Handoff 写入与 Topic 连续性更新保持一个数据库事务；To-do 日滚动保持单条原子 SQL 更新并使用设备 IANA 时区。
### 数据导入顺序
1. 对 Supabase 的业务表做只读导出，不导出认证会话、JWT、旧设备令牌或服务角色密钥。
2. 在新数据库建 schema、单人 owner 与约束，按依赖顺序导入 Project、Topic、Session、Handoff、To-do、Daily Projection、Device Workspace。
3. 为现有 Mac 与 Windows 分别生成新设备登记凭据；旧 Supabase token 绝不复用。
4. 在只读校验模式比较逐表行数、主外键完整性、每个 Topic 的最新 Handoff、指定日期 To-do、Daily Projection 内容和设备工作区路径。
5. 客户端切换到新 API 后，冻结旧 Supabase 写入；保留旧数据只读回退窗口，确认生产验收后再由用户决定何时关闭旧项目。
## API 契约
- 维持 `packages/data/src/FlowRepository.ts` 是 UI 唯一数据接口，HTTP API 完整实现其所有读取、写入、订阅和滚动方法。
- 添加 `POST /v1/devices/enroll` 作为唯一匿名端点；它只接受一次性登记码和设备元数据，响应一次性设备令牌。
- 添加 `GET /v1/auth/session`，根据设备令牌返回单人 session；删除 `sign-in`、`sign-out` 与密码语义。
- 实现 `GET /v1/todos`、`POST /v1/todos`、`PATCH/DELETE /v1/todos/:id`、`POST /v1/todos/rollover`、`GET /v1/todos/stream`、`GET /v1/topics`、`GET /v1/topics/:id/context`、`GET /v1/daily-projections/:date` 及既有 Topic/Session/Handoff/Project 写入路由。
- SSE 仅用于同一 owner 的 To-do 变化通知；断线后客户端以既有退避策略重连并重新拉取列表，保证最终一致性。
- 错误契约固定：无效/吊销设备为 `401 device_unauthorized`，越权资源为 `404`，字段错误为 `422`，冲突或已消费登记码为 `409`。
## 客户端改造
- `VITE_FLOWCONTEXT_PROVIDER=self-hosted` 成为唯一生产 Provider；构建只包含 API 基础 URL，不包含令牌或登记码。
- 以设备令牌实现无密码 `AuthPort`：有令牌则静默 session 检查，无令牌或 401 才显示登记页。
- 令牌只允许经 PlatformPort 写入 Keychain/Credential Manager；短暂原生安全存储故障按现有内存降级原则处理，不写 WebView localStorage。
- 删除 Supabase 客户端初始化、登录表单入口与依赖；保留桌面浮窗、Daily Note、Topic Deep Link、To-do 日期状态与平台行为。
## 服务器安全与运维
- 部署前创建独立非 root 运维账户并使用 SSH key；关闭 root 密码远程登录前验证新账户可恢复地登录。不会把服务器密码写进仓库或部署文件。
- Caddy 强制 HTTPS，HTTP 仅重定向；数据库和 API 容器处于私有网络，数据库不映射公网端口。
- API 限制登记与认证失败速率，拒绝在日志中写 `Authorization`、登记码、Cookie、请求体或数据库连接字符串。
- Docker secret 或服务器受限权限文件保存数据库密码和部署密钥；仓库仅保留 `.env.example`。
- 数据库每日逻辑备份与加密离机副本不在第一期产品范围，但部署前须保留一次可恢复的迁移前导出。
## 测试与验收
- 先为每个新增 API/认证行为写失败测试：设备登记、令牌哈希、吊销、无令牌/无效令牌、读取与写入路由、404/422/409 契约、SSE 重连、Handoff 原子性、To-do 滚动时区。
- 前端验证：有凭据静默进入主界面；无凭据只见登记页；登记成功后重启仍进入主界面；吊销后被安全地送回登记页；不再渲染账号密码登录表单。
- 数据库验证：迁移后逐表数量、外键、最新 Handoff、To-do 与 Daily Projection 样本一致；导入与 API 写入均在事务失败时回滚。
- 服务器验证：外网 HTTPS 可用、HTTP 重定向、5432 不可公网连接、令牌不出现在容器/API 日志、容器重启后数据与设备凭据有效。
- 桌面验收：Mac 与 Windows 各登记一台设备，完成 To-do 创建/勾选/删除、Topic Context、Handoff、跨设备实时更新及原任务 Deep Link；原生浮窗既有验收项不因本次迁移降级。
## 完成标准
- 生产客户端不再连接 `*.supabase.co`，没有 Supabase 密钥、登录页或账号密码流程。
- 两台已登记桌面设备能自动进入并读写同一份数据；未登记或已吊销设备无法读取任何数据。
- 数据已被迁移并通过上述全量结构校验和关键样本校验。
- 服务器只以 HTTPS 提供 API，数据库没有公网监听，部署与应用日志不含秘密。
- 全仓自动化、API 集成、数据库迁移、两端桌面实际操作与重新启动回归均通过。
