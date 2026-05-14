#Requires -Version 5.1
<#
.SYNOPSIS
  Installs the Yoink for Premiere CEP panel.

.DESCRIPTION
  - Enables PlayerDebugMode for CEP 9, 10, and 11 (lets unsigned panels load)
  - Copies the plugin to %APPDATA%\Adobe\CEP\extensions\com.yoink.premiere\
  - Downloads yt-dlp.exe to %APPDATA%\Yoink\ if not already present

  Restart Premiere after running. Find the panel under:
      Window > Extensions > Yoink
#>

param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Yoink for Premiere - Installer"          -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# Step 1: Enable PlayerDebugMode (required for unsigned CEP panels)
# ---------------------------------------------------------------------------
Write-Host "[1/3] Enabling CEP PlayerDebugMode..." -ForegroundColor Yellow

$cepVersions = @('9', '10', '11', '12')
foreach ($v in $cepVersions) {
    $regPath = "HKCU:\Software\Adobe\CSXS.$v"
    try {
        if (-not (Test-Path $regPath)) {
            New-Item -Path $regPath -Force | Out-Null
        }
        Set-ItemProperty -Path $regPath -Name 'PlayerDebugMode' -Value '1' -Type String -Force
        Write-Host "  CSXS.$v -> PlayerDebugMode = 1" -ForegroundColor Green
    } catch {
        Write-Host "  CSXS.$v -> skipped ($($_.Exception.Message))" -ForegroundColor DarkYellow
    }
}

# ---------------------------------------------------------------------------
# Step 2: Copy plugin folder into Adobe's extensions directory
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[2/3] Installing panel to Adobe extensions folder..." -ForegroundColor Yellow

$extRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$extDest = Join-Path $extRoot 'com.yoink.premiere'

if (-not (Test-Path $extRoot)) {
    New-Item -ItemType Directory -Path $extRoot -Force | Out-Null
}

if (Test-Path $extDest) {
    if (-not $Force) {
        Write-Host "  Existing install detected at $extDest" -ForegroundColor DarkYellow
        Write-Host "  Removing and replacing..." -ForegroundColor DarkYellow
    }
    Remove-Item -Path $extDest -Recurse -Force
}

# Copy everything except the install scripts themselves
$srcItems = Get-ChildItem -Path $ScriptDir | Where-Object { $_.Name -notin @('install.ps1', 'uninstall.ps1', 'README.md', '.git', '.gitignore') }
New-Item -ItemType Directory -Path $extDest -Force | Out-Null
foreach ($item in $srcItems) {
    Copy-Item -Path $item.FullName -Destination $extDest -Recurse -Force
}

Write-Host "  Installed to: $extDest" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Step 3: Ensure yt-dlp.exe is available in shared location
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[3/3] Checking yt-dlp..." -ForegroundColor Yellow

$yoinkDataDir = Join-Path $env:APPDATA 'Yoink'
$ytdlpDst = Join-Path $yoinkDataDir 'yt-dlp.exe'

if (-not (Test-Path $yoinkDataDir)) {
    New-Item -ItemType Directory -Path $yoinkDataDir -Force | Out-Null
}

if (Test-Path $ytdlpDst) {
    Write-Host "  Found existing yt-dlp.exe in $yoinkDataDir" -ForegroundColor Green
} else {
    # Try PATH first
    $onPath = Get-Command yt-dlp -ErrorAction SilentlyContinue
    if ($onPath) {
        Write-Host "  yt-dlp already on PATH ($($onPath.Source)) - leaving as-is." -ForegroundColor Green
    } else {
        Write-Host "  Downloading yt-dlp.exe from GitHub..." -ForegroundColor DarkYellow
        $ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
        try {
            Invoke-WebRequest -Uri $ytdlpUrl -OutFile $ytdlpDst -UseBasicParsing -ErrorAction Stop
            $sizeMB = [math]::Round((Get-Item $ytdlpDst).Length / 1MB, 1)
            Write-Host "  Downloaded yt-dlp.exe ($sizeMB MB) to $yoinkDataDir" -ForegroundColor Green
        } catch {
            Write-Host "  Failed to download yt-dlp: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "  Place yt-dlp.exe manually at: $ytdlpDst" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Done!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Restart Premiere Pro (fully close all windows)"
Write-Host "  2. Open Premiere"
Write-Host "  3. Window > Extensions > Yoink"
Write-Host ""
