$ErrorActionPreference = 'Stop'
$pricingRoot = $PSScriptRoot
$pricingNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $pricingNode) { Write-Host 'Node.js 20 or newer is required. Please install it from nodejs.org.'; Read-Host 'Press Enter'; exit 1 }
$pricingReady = $false
try { $pricingReady = (Invoke-WebRequest -Uri 'http://127.0.0.1:8772/' -UseBasicParsing -TimeoutSec 2).Content.Contains('Ocean Pricing') } catch {}
if (-not $pricingReady) {
  Start-Process -FilePath $pricingNode -ArgumentList @('server.cjs') -WorkingDirectory $pricingRoot -WindowStyle Hidden
  for ($pricingTry = 0; $pricingTry -lt 20; $pricingTry++) {
    Start-Sleep -Milliseconds 250
    try { $pricingReady = (Invoke-WebRequest -Uri 'http://127.0.0.1:8772/' -UseBasicParsing -TimeoutSec 1).Content.Contains('Ocean Pricing') } catch {}
    if ($pricingReady) { break }
  }
}
if ($pricingReady) { Start-Process 'http://127.0.0.1:8772/' } else { Write-Host 'Could not start the app. Check whether port 8772 is already in use.'; Read-Host 'Press Enter' }
