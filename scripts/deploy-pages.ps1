# Deploy ChatWave frontend to Cloudflare Pages
# Requires: wrangler CLI (npm install -g wrangler)
# Usage: .\scripts\deploy-pages.ps1

param(
  [string]$Env = "production"
)

Write-Host "=== ChatWave Cloudflare Pages Deployment ===" -ForegroundColor Cyan

# Check wrangler
if (-not (Get-Command "wrangler" -ErrorAction SilentlyContinue)) {
  Write-Host "ERROR: wrangler not found. Install with: npm install -g wrangler" -ForegroundColor Red
  exit 1
}

# Check Cloudflare login
$whoami = wrangler whoami 2>$null
if (-not $whoami) {
  Write-Host "Logging in to Cloudflare..." -ForegroundColor Yellow
  wrangler login
}

# Build config.js with the socket server URL from env
$socketUrl = $env:SOCKET_SERVER_URL
if (-not $socketUrl) {
  Write-Host "SOCKET_SERVER_URL not set. Frontend will connect to same origin." -ForegroundColor Yellow
  $socketUrl = ""
}

$configContent = "window.CONFIG = { SOCKET_URL: '$socketUrl' };"
Set-Content -Path "public\js\config.js" -Value $configContent -NoNewline
Write-Host "Config written: SOCKET_URL=$socketUrl" -ForegroundColor Green

# Deploy
Write-Host "Deploying to Cloudflare Pages ($Env)..." -ForegroundColor Yellow
wrangler pages deploy public --project-name chatwave --branch $Env

Write-Host "Done!" -ForegroundColor Green
