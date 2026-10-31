# CLIProxyAPI

[English](README.md) | 简体中文

一个可自托管的 AI 网关，为 CLI 类 AI 提供商提供 OpenAI、Gemini、Claude 和 Codex 兼容 API。支持 OAuth 凭证与上游 API 密钥、多账号路由，以及内置管理面板。

> 本项目基于上游 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 定制，详见[致谢](#致谢)。

## 功能概览

- 提供 OpenAI Chat Completions、Responses、Claude Messages、Gemini 和 OpenAI 兼容端点。
- 支持通过 OAuth 或 API 密钥接入 Codex、Claude、Gemini、AI Studio、Vertex、Antigravity、Kimi、xAI、Meta 以及 OpenAI 兼容提供商。
- 多凭证支持轮询、加权轮询或填充优先路由，并支持重试和故障转移。
- 在支持的场景下提供流式、非流式和 WebSocket 响应，支持工具调用与多模态输入。
- 内置管理面板：仪表盘、API 密钥、AI 提供商、OAuth 登录、认证文件、配额管理、配置面板、日志查看、请求监控和系统信息。
- 默认使用本地文件存储，也支持 Postgres、Git 和对象存储后端。
- `sdk/` 下提供可复用的 Go SDK。

## Docker 部署

推荐使用 Linux + Docker Engine + Docker Compose v2 部署。

### 首次启动

1. 创建本地数据目录和配置文件：

   ```bash
   mkdir -p data auths logs plugins
   cp config.example.yaml data/config.yaml
   cp .env.example .env
   ```

2. 编辑 `.env`，设置一个强随机的 `MANAGEMENT_PASSWORD`。
3. 按需修改 `data/config.yaml`。Docker 部署请保持 `server.host: ""`，让容器监听所有接口。
4. 构建并启动：

   ```bash
   docker compose up -d --build
   ```

   也可以运行 `bash docker-build.sh`，脚本会在缺少 `data/config.yaml` 和 `.env` 时自动创建。

5. 打开管理面板：`http://<服务器地址>:8317/management.html`。
   API 基础地址：`http://<服务器地址>:8317/v1`。
6. 查看日志：`docker compose logs -f`。

默认 Compose 会持久化以下目录：

- `./data` — `config.yaml`、`api-keys.json`、请求监控数据和请求日志。
- `./auths` — OAuth 凭证文件。
- `./logs` — 应用日志。
- `./plugins` — 可选插件。

设置 `MANAGEMENT_PASSWORD` 后会启用管理 API，并允许非本机客户端访问管理接口。对外网开放时请使用长随机密码，并通过 HTTPS 反向代理访问。

`docker-compose.yml` 中已注释列出可选的 OAuth 回调端口 `1455`、`54545` 和 `51121`。仅在本地容器中完成浏览器登录时取消注释。

### 不使用 Docker

```bash
cp config.example.yaml config.yaml
go build -o cli-proxy-api ./cmd/server
./cli-proxy-api
```

通过环境变量 `MANAGEMENT_PASSWORD` 或 `config.yaml` 中的 `management.secret-key` 启用管理接口。

## 配置说明

- `config.example.yaml` — v8 配置模板。
- `docs/management-api-v8.md` — 管理 API 说明。
- `api-keys.json` — 由管理面板创建，保存在当前配置文件所在目录。
- `auths/` — OAuth 凭证文件。

请保持配置中的 `management.disable-auto-update-panel: true`，以固定使用仓库内置的定制面板。启用该设置后，服务不会在运行时从上游下载面板版本。

## 管理面板源码

构建后的面板已提交为 `static/management.html`，并会打包进 Docker 镜像。源码位于 `webui/`，使用 Bun 构建：

```bash
cd webui
bun install
bun run verify
cp dist/management.html ../static/management.html
```

## 版本与更新

当前应用版本为 `0.0.3`。管理面板的“中心信息”页会显示运行版本，并从 GitHub Releases 检查更新。

推送 `v0.0.3` 这类标签会触发 `.github/workflows/release.yml`，发布 Linux amd64/arm64 安装包、`checksums.txt` 和 `management.html`。自动更新会先校验 SHA-256，再同时替换当前 Linux 可执行文件和内置的 `static/management.html` 管理面板。

自动更新适用于原生 Linux 部署。Docker 容器可以更新当前运行中的二进制，但重新创建容器后会恢复为镜像内的版本；Docker 部署请构建或拉取新镜像后重新创建容器。

## 开发

```bash
gofmt -w .
go build -o cli-proxy-api ./cmd/server
go test ./...
```

SDK 文档见 `docs/`，自定义提供商和插件示例见 `examples/`。

## 致谢

本项目基于 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)，内置管理面板基于 [Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center)。两个上游项目均使用 MIT 许可证，详见 `LICENSE`、`THIRD_PARTY_NOTICES.md` 和 `webui/LICENSE`。

## 许可证

本项目使用 MIT 许可证，详见 [LICENSE](LICENSE)。
