# Yoink Browser Extension — Native Messaging Host Installer
# Run this script once from PowerShell (no admin rights required for HKCU).
# Requirements: Node.js must be on PATH.

$ErrorActionPreference = 'Stop'

$helperDir = $PSScriptRoot

Write-Host ""
Write-Host "=== Yoink Native Messaging Host Installer ===" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Create launcher .cmd
# ---------------------------------------------------------------------------
$launcherPath = Join-Path $helperDir "run-host.cmd"
$launcherContent = "@echo off`r`nnode `"%~dp0host.js`"`r`n"
[System.IO.File]::WriteAllText($launcherPath, $launcherContent, [System.Text.Encoding]::ASCII)
Write-Host "[1/5] Created launcher: $launcherPath" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. Write NMH manifest to %APPDATA%\Yoink\helper\manifest.json
# ---------------------------------------------------------------------------
$manifestDir = Join-Path $env:APPDATA "Yoink\helper"
if (-not (Test-Path $manifestDir)) {
    New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
}

$manifest = @{
    name        = "com.yoink.helper"
    description = "Yoink native messaging host"
    path        = $launcherPath
    type        = "stdio"
    allowed_origins = @("chrome-extension://PLACEHOLDER_EXTENSION_ID/")
    allowed_extensions = @("yoink@extension")
} | ConvertTo-Json -Depth 5

$manifestPath = Join-Path $manifestDir "manifest.json"
[System.IO.File]::WriteAllText($manifestPath, $manifest, [System.Text.Encoding]::UTF8)
Write-Host "[2/5] Wrote NMH manifest: $manifestPath" -ForegroundColor Green

Write-Host ""
Write-Host "  NOTE: After loading the extension in Chrome, update 'allowed_origins'" -ForegroundColor Yellow
Write-Host "  in $manifestPath with your actual extension ID." -ForegroundColor Yellow
Write-Host ""

# ---------------------------------------------------------------------------
# 3. Register in registry — Chrome
# ---------------------------------------------------------------------------
$chromeKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.yoink.helper"
if (-not (Test-Path $chromeKey)) {
    New-Item -Path $chromeKey -Force | Out-Null
}
Set-ItemProperty -Path $chromeKey -Name "(Default)" -Value $manifestPath
Write-Host "[3/5] Registered Chrome NMH: $chromeKey" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 4. Register in registry — Firefox
# ---------------------------------------------------------------------------
$firefoxKey = "HKCU:\Software\Mozilla\NativeMessagingHosts\com.yoink.helper"
if (-not (Test-Path $firefoxKey)) {
    New-Item -Path $firefoxKey -Force | Out-Null
}
Set-ItemProperty -Path $firefoxKey -Name "(Default)" -Value $manifestPath
Write-Host "[4/5] Registered Firefox NMH: $firefoxKey" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 5. Check / download yt-dlp
# ---------------------------------------------------------------------------
$ytdlpDir = Join-Path $env:APPDATA "Yoink"
if (-not (Test-Path $ytdlpDir)) {
    New-Item -ItemType Directory -Path $ytdlpDir -Force | Out-Null
}
$ytdlpPath = Join-Path $ytdlpDir "yt-dlp.exe"

if (Test-Path $ytdlpPath) {
    Write-Host "[5/5] yt-dlp already present: $ytdlpPath" -ForegroundColor Green
} else {
    Write-Host "[5/5] Downloading yt-dlp..." -ForegroundColor Yellow
    $url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    try {
        Invoke-WebRequest -Uri $url -OutFile $ytdlpPath -UseBasicParsing
        Write-Host "      Downloaded to: $ytdlpPath" -ForegroundColor Green
    } catch {
        Write-Host "      WARNING: Failed to download yt-dlp. Install it manually." -ForegroundColor Red
        Write-Host "      Download from: https://github.com/yt-dlp/yt-dlp/releases/latest" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== Installation complete! ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Load extension\src\ as an unpacked extension in Chrome/Firefox." -ForegroundColor White
Write-Host "  2. Note your extension ID from the browser's extensions page." -ForegroundColor White
Write-Host "  3. Update 'allowed_origins' in $manifestPath with the real ID." -ForegroundColor White
Write-Host ""
