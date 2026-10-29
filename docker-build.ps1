# docker-build.ps1 - Build and run the Docker image with version metadata.
$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

foreach ($dir in @("data", "auths", "logs", "plugins")) {
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
    }
}
if (-not (Test-Path -LiteralPath "data/config.yaml")) {
    Copy-Item -LiteralPath "config.example.yaml" -Destination "data/config.yaml"
    Write-Host "Created data/config.yaml from config.example.yaml."
}
if (-not (Test-Path -LiteralPath ".env")) {
    Copy-Item -LiteralPath ".env.example" -Destination ".env"
    Write-Host "Created .env from .env.example. Set MANAGEMENT_PASSWORD before exposing the service."
}
if ((Get-Content -LiteralPath ".env" -Raw) -notmatch "(?m)^MANAGEMENT_PASSWORD=.+") {
    Write-Warning "MANAGEMENT_PASSWORD is not set in .env; the management panel will be disabled."
}

$VERSION = (git describe --tags --abbrev=0 2>$null)
if (-not $VERSION) { $VERSION = "0.0.1" }
$VERSION = $VERSION -replace '^[vV]', ''
$COMMIT = (git rev-parse --short HEAD 2>$null)
if (-not $COMMIT) { $COMMIT = "none" }
$BUILD_DATE = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
if (-not $env:CLI_PROXY_IMAGE) { $env:CLI_PROXY_IMAGE = "cli-proxy-api:local" }

Write-Host "Building $env:CLI_PROXY_IMAGE..."
docker compose build --build-arg VERSION=$VERSION --build-arg COMMIT=$COMMIT --build-arg BUILD_DATE=$BUILD_DATE

docker compose up -d --remove-orphans
Write-Host "Services are starting. Run 'docker compose logs -f' to follow the logs."
