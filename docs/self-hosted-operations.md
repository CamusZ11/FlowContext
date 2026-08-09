# FlowContext 自建服务运维
## 事实边界
- 生产数据由用户自有 PostgreSQL 与 FlowContext API 保存；客户端只通过 `VITE_FLOWCONTEXT_PROVIDER=self-hosted` 访问 HTTPS API。
- 公网 TLS 由既有 Nginx 管理；FlowContext Caddy 仅监听 `127.0.0.1:18080`。PostgreSQL 与 API 不得映射公网端口。
- API 地址、设备令牌、注册码、数据库连接串与 `.env` 内容均不得写入 Git、日志、截图或聊天。
## 日常检查
在服务器部署目录运行：
```sh
cd deploy/flowcontext
./preflight.sh
docker compose ps
```
从外部确认 HTTPS 健康检查可用，并确认 PostgreSQL 与 API 端口未暴露。部署、重启、设备登记与撤销的精确命令见 [`deploy/flowcontext/README.md`](../deploy/flowcontext/README.md)。
## 客户端发布
1. 在 `apps/web/.env` 配置自建 API URL。
2. 运行 `pnpm verify`，再运行 `pnpm --filter @flowcontext/desktop build`。
3. 对候选 `.app` 进行 ad-hoc 签名和严格校验后再安装。
4. macOS 与 Windows 的自动化、运行和 UI 实机证据必须分开记录；未执行的 UI 项不得标记为通过。
## 故障处理
- 应用显示未配置：检查 `apps/web/.env` 的 self-hosted provider 与 API URL，并重新打包；桌面打包守卫应阻止未配置产物。
- 设备无法读取数据：先检查钥匙串/Credential Manager 授权与 API `/v1/auth/session`，不要导出或打印设备令牌。
- 面板未出现或全屏被遮挡：遵循 `apps/desktop/tests/acceptance-checklist.md` 的对应矩阵，使用原生窗口运行证据而非仅凭构建结果判断。
