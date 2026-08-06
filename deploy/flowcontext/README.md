# FlowContext 自托管部署
该目录部署私有 PostgreSQL、FlowContext API 与 Caddy；只有 Caddy 对外发布 80/443，数据库与 API 均处于内部 Docker 网络。
## 前置条件
- 一台可用 Docker Compose v2 的 Linux 服务器；使用**非 root**的 SSH 部署账号和 SSH key 登录。
- 一个指向该服务器公网 IP 的域名/DNS 记录。Caddy 的公网 HTTPS 必须使用域名/DNS；不要使用裸 IP，也不要使用自签名 TLS。
- 防火墙允许公网访问 TCP 80 和 443；部署账号对 `/srv/flowcontext/data`（或 `FLOWCONTEXT_DATA_DIR`）可写。
## 首次配置
在服务器的仓库根执行：
```sh
cd deploy/flowcontext
cp .env.example .env
chmod 0600 .env
```
编辑 `.env`，只填入本服务器使用的值：
- `POSTGRES_PASSWORD`：新的强随机密码；请使用 URL 安全字符，避免破坏 API 的数据库连接 URL。
- `FLOWCONTEXT_OWNER_ID`：迁移工具导出的唯一 owner UUID。
- `FLOWCONTEXT_PUBLIC_URL`：仅填写域名，例如 `flowcontext.example.com`，不带 `https://`。
- `ACME_EMAIL`：用于 Caddy/Let's Encrypt 的通知邮箱。
`.env` 不得提交、复制到聊天或终端记录中；它的权限必须保持 0600。
## 部署与日常运维
先运行 `./preflight.sh`，再运行 `./deploy.sh`。预检会校验 `.env` 为 0600、Docker Compose 配置、DNS、可写数据目录和 80/443 监听摘要；部署会等待容器健康并以公网 HTTPS `/healthz` 复验，任一步失败即以非零状态退出，不会打印成功 URL。
为新设备签发一次性注册码：
```sh
./create-enrollment.sh <device-id UUID>
```
该命令把注册码预绑定到该 UUID 对应的设备，只在服务器私有 API 容器内执行并输出一次注册码；请通过安全渠道输入该设备，勿记录或转发。
撤销设备：
```sh
./revoke-device.sh <device-id UUID>
```
撤销后该设备下次请求会被拒绝并清除本地凭据。不要把注册码、设备令牌、`.env` 或数据库导出文件放入 Git、日志或聊天记录。
## 验证
部署后检查 `docker compose ps`，并从另一台机器访问 `https://<你的域名>/healthz`。仅应看到 Caddy 的 80/443 公网端口；不要为 PostgreSQL 或 API 添加端口映射。
