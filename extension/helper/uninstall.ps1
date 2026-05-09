# Yoink Browser Extension — Native Messaging Host Uninstaller

$ErrorActionPreference = 'SilentlyContinue'

Write-Host ""
Write-Host "=== Yoink Native Messaging Host Uninstaller ===" -ForegroundColor Cyan
Write-Host ""

$chromeKey  = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.yoink.helper"
$firefoxKey = "HKCU:\Software\Mozilla\NativeMessagingHosts\com.yoink.helper"

if (Test-Path $chromeKey) {
    Remove-Item -Path $chromeKey -Recurse -Force
    Write-Host "[1/2] Removed Chrome registry key: $chromeKey" -ForegroundColor Green
} else {
    Write-Host "[1/2] Chrome registry key not found (already removed?): $chromeKey" -ForegroundColor Yellow
}

if (Test-Path $firefoxKey) {
    Remove-Item -Path $firefoxKey -Recurse -Force
    Write-Host "[2/2] Removed Firefox registry key: $firefoxKey" -ForegroundColor Green
} else {
    Write-Host "[2/2] Firefox registry key not found (already removed?): $firefoxKey" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Uninstall complete." -ForegroundColor Cyan
Write-Host "The helper files and yt-dlp in %APPDATA%\Yoink\ were NOT removed." -ForegroundColor White
Write-Host "Delete that folder manually if you no longer need it." -ForegroundColor White
Write-Host ""
