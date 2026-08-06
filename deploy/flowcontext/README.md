# FlowContext 自托管部署
该目录部署私有 PostgreSQL、FlowContext API 和内部 Caddy。现有 Nginx 独占公网 80/443 与 `flowcontext.zkabi.cn` 的 TLS；Caddy 只监听主机回环地址 `127.0.0.1:18080`。数据库和 API 没有主机端口。
## 前置条件
- 一台已由 Nginx 服务其他站点的 Linux 服务器，部署账号使用 SSH key（非 root）。
- `flowcontext.zkabi.cn` 已解析到此服务器；公网 80/443 继续由现有 Nginx 管理。
- Docker Compose v2；部署账号可写 `/srv/flowcontext/data`（或 `FLOWCONTEXT_DATA_DIR`）。
- 用于安装 Nginx 站点和签发证书的受控 root 操作；不得修改默认站点或其他站点。
## 首次配置
在服务器仓库根执行：
```sh
cd deploy/flowcontext
cp .env.example .env
chmod 0600 .env
```
编辑 `.env`，只填入本服务器使用的值：
- `POSTGRES_PASSWORD`：新的强随机密码，使用 URL 安全字符。
- `FLOWCONTEXT_OWNER_ID`：迁移工具导出的唯一 owner UUID。
- `FLOWCONTEXT_PUBLIC_URL`：固定填写 `flowcontext.zkabi.cn`，不带协议或路径。
`.env` 不得提交、复制到聊天或终端记录中；权限必须是 0600。
## 安装隔离 Nginx TLS 站点
这一步只增加 `flowcontext.zkabi.cn` 站点，不替换、禁用或重启其他 Nginx 站点。先以 root 安装仅 HTTP 的 ACME 路由：
```sh
./install-nginx-site.sh --http-only
```
用 webroot 签发证书（Certbot 不修改 Nginx 配置）：
```sh
mkdir -p /var/www/certbot
certbot certonly --webroot -w /var/www/certbot -d flowcontext.zkabi.cn
install -d -m 0755 /etc/nginx/snippets
cat >/etc/nginx/snippets/flowcontext.zkabi.cn-certbot.conf <<'EOF'
ssl_certificate /etc/letsencrypt/live/flowcontext.zkabi.cn/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/flowcontext.zkabi.cn/privkey.pem;
include /etc/letsencrypt/options-ssl-nginx.conf;
EOF
rm /etc/nginx/sites-enabled/flowcontext.zkabi.cn /etc/nginx/sites-available/flowcontext.zkabi.cn
./install-nginx-site.sh --enable-tls
```
证书路径只保存在服务器受限目录，不在仓库模板、`.env` 或聊天记录中。续期时应保留 ACME webroot 路由；配置 Certbot 的 deploy hook 只测试并 reload Nginx。
## 部署与日常运维
以非 root SSH 部署账号运行 `./preflight.sh`，再运行 `./deploy.sh`。预检验证 `.env` 权限、域名、Nginx 安装、Docker Compose 和未占用的回环 `18080`；Nginx 配置仅在 root 站点安装脚本中由 `nginx -t` 验证。部署等待容器健康，先验证内部 HTTP，再经 Nginx HTTPS 复验。任一步失败会非零退出且不会打印成功 URL。
为新设备签发一次性注册码：
```sh
./create-enrollment.sh <device-id UUID>
```
该命令仅在私有 API 容器内执行并输出一次注册码。撤销设备：
```sh
./revoke-device.sh <device-id UUID>
```
不要把注册码、设备令牌、`.env` 或数据库导出文件放入 Git、日志或聊天记录。
## 验证
部署后检查 `docker compose ps`，本机只能看到 `127.0.0.1:18080`；从另一台机器访问 `https://flowcontext.zkabi.cn/healthz`。不得为 PostgreSQL 或 API 添加端口映射，也不得让 Caddy 绑定公网 80/443 或申请证书。
