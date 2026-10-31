# CLIProxyAPI

English | [简体中文](README_CN.md)

A self-hosted gateway that exposes CLI-oriented AI providers through OpenAI-, Gemini-, Claude-, and Codex-compatible APIs. It supports OAuth credentials and upstream API keys, multi-account routing, and a bundled management panel.

> This repository is a customized distribution of the upstream [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) project. See [Credits](#credits).

## Highlights

- OpenAI Chat Completions, Responses, Claude Messages, Gemini, and OpenAI-compatible endpoints.
- Upstream accounts through OAuth or API key: Codex, Claude, Gemini, AI Studio, Vertex, Antigravity, Kimi, xAI, Meta, and OpenAI-compatible providers.
- Multiple credentials with round-robin, weighted round-robin, or fill-first routing, plus retries and failover.
- Streaming, non-streaming, and WebSocket responses where supported, with tool calling and multimodal input.
- Bundled management panel for dashboard, API keys, AI providers, OAuth login, auth files, quota management, configuration, logs, request monitoring, and system information.
- File-based local storage by default, with optional Postgres, Git, and object storage backends.
- Reusable Go SDK under `sdk/`.

## Docker Deployment

The recommended deployment target is Linux with Docker Engine and Docker Compose v2.

### First Start

1. Create the local data directories and configuration:

   ```bash
   mkdir -p data auths logs plugins
   cp config.example.yaml data/config.yaml
   cp .env.example .env
   ```

2. Edit `.env` and set a strong `MANAGEMENT_PASSWORD`.
3. Optionally edit `data/config.yaml`. For Docker, keep `server.host: ""` so the container listens on all interfaces.
4. Build and start the service:

   ```bash
   docker compose up -d --build
   ```

   Alternatively, run `bash docker-build.sh`; it creates `data/config.yaml` and `.env` when they are missing.

5. Open the management panel at `http://<server>:8317/management.html`.
   The API base URL is `http://<server>:8317/v1`.
6. Follow the logs with `docker compose logs -f`.

The default Compose file persists these paths:

- `./data` — `config.yaml`, `api-keys.json`, request monitoring data, and request logs.
- `./auths` — OAuth credential files.
- `./logs` — application logs.
- `./plugins` — optional plugins.

`MANAGEMENT_PASSWORD` enables the management API and allows management access from non-localhost clients. Use a long random password and serve the panel over HTTPS when the service is exposed to the internet.

OAuth callback ports `1455`, `54545`, and `51121` are listed as optional mappings in `docker-compose.yml`. Uncomment them only when completing browser-based login against the local container.

### Run Without Docker

```bash
cp config.example.yaml config.yaml
go build -o cli-proxy-api ./cmd/server
./cli-proxy-api
```

Set `MANAGEMENT_PASSWORD` in the environment or `management.secret-key` in `config.yaml` to enable management.

## Configuration

- `config.example.yaml` — minimal v8 configuration template.
- `docs/management-api-v8.md` — management API notes.
- `api-keys.json` — client API keys created by the management panel next to the active configuration file.
- `auths/` — OAuth credential files.

Keep `management.disable-auto-update-panel: true` in the shipped configuration so the bundled custom panel stays pinned. With this setting, the server does not download panel releases from upstream at runtime.

## Management Panel Source

The built panel is committed as `static/management.html` and bundled into the Docker image. Its source lives in `webui/` and uses Bun:

```bash
cd webui
bun install
bun run verify
cp dist/management.html ../static/management.html
```

## Releases and Updates

The current application version is `0.0.3`. The System page in the management panel shows the running version and checks GitHub Releases for updates.

Pushing a tag such as `v0.0.3` runs `.github/workflows/release.yml` and publishes Linux amd64/arm64 archives, `checksums.txt`, and `management.html`. The in-place updater verifies the SHA-256 checksum before replacing the running Linux binary and its bundled `static/management.html` management panel.

In-place updates apply to native Linux installs. Docker containers can install an update into the running container, but recreating the container from its image restores the image version; for durable Docker upgrades, build or pull a new image and recreate the container.

## Development

```bash
gofmt -w .
go build -o cli-proxy-api ./cmd/server
go test ./...
```

See `docs/` for SDK guides and `examples/` for custom providers and plugins.

## Credits

This repository is based on [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). The bundled management panel is based on [Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center). Both upstream projects are MIT-licensed; see `LICENSE`, `THIRD_PARTY_NOTICES.md`, and `webui/LICENSE`.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
