# Setup Cloudflare Tunnel for ChatWave backend
# Prerequisites:
#   1. Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
#   2. Create a tunnel in Cloudflare Zero Trust dashboard
#   3. Copy the tunnel token
#
# Usage:
#   1. .\scripts\deploy-tunnel.ps1
#   2. Follow the prompts

param(
  [string]$TunnelName = "chatwave-tunnel"
)

Write-Host "=== ChatWave Cloudflare Tunnel Setup ===" -ForegroundColor Cyan

# Check cloudflared
if (-not (Get-Command "cloudflared" -ErrorAction SilentlyContinue)) {
  Write-Host "WARNING: cloudflared not found." -ForegroundColor Yellow
  Write-Host "Download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  Write-Host "Or use Docker: docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run" -ForegroundColor Gray
  $useDocker = Read-Host "Use Docker instead? (Y/N)"
  if ($useDocker -ne "Y") {
    exit 1
  }
}

Write-Host ""
Write-Host "Step 1: Install cloudflared (if not already)"
Write-Host "  winget install cloudflare.cloudflared" -ForegroundColor Gray

Write-Host ""
Write-Host "Step 2: Login to Cloudflare"
Write-Host "  cloudflared tunnel login" -ForegroundColor Gray

Write-Host ""
Write-Host "Step 3: Create a tunnel"
Write-Host "  cloudflared tunnel create chatwave-tunnel" -ForegroundColor Gray

Write-Host ""
Write-Host "Step 4: Configure DNS (replace with your domain)"
Write-Host "  cloudflared tunnel route dns chatwave-tunnel chatwave.yourdomain.com" -ForegroundColor Gray

Write-Host ""
Write-Host "Step 5: Run the tunnel (or use docker-compose)"
Write-Host "  cloudflared tunnel run chatwave-tunnel" -ForegroundColor Gray
Write-Host "  -- OR --" -ForegroundColor Cyan
Write-Host "  \$env:CLOUDFLARE_TUNNEL_TOKEN = 'your-token-here'" -ForegroundColor Gray
Write-Host "  docker-compose up -d" -ForegroundColor Gray

Write-Host ""
Write-Host "=== Quick Start ===" -ForegroundColor Green
Write-Host "1. docker-compose build" -ForegroundColor Gray
Write-Host "2. Set env var: `$env:CLOUDFLARE_TUNNEL_TOKEN = 'your-token-here'" -ForegroundColor Gray
Write-Host "3. docker-compose up -d" -ForegroundColor Gray
Write-Host "4. App will be available at https://chatwave.yourdomain.com" -ForegroundColor Gray

Write-Host ""
Write-Host "Step 6: Create config for Cloudflare Pages frontend"
Write-Host "  `$env:SOCKET_SERVER_URL = 'https://chatwave.yourdomain.com'" -ForegroundColor Gray
Write-Host "  .\scripts\deploy-pages.ps1" -ForegroundColor Gray
