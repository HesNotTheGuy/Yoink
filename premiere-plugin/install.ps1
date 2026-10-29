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

function Install-VerifiedYtDlp {
    param(
        [Parameter(Mandatory = $true)][string]$Destination
    )
    $assetName = 'yt-dlp.exe'
    $latest = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$assetName"
    $request = [System.Net.HttpWebRequest]::Create($latest)
    $request.AllowAutoRedirect = $false
    $request.Method = 'GET'
    $request.UserAgent = 'yoink'
    $request.Timeout = 60000
    try {
        $response = $request.GetResponse()
    } catch {
        throw "Could not resolve the yt-dlp release ($($_.Exception.Message)). Refusing to install an unverified binary."
    }
    try {
        $status = [int]$response.StatusCode
        $location = $response.Headers['Location']
    } finally {
        $response.Close()
    }
    if ($location -is [array]) { $location = $location[0] }
    if ($status -lt 300 -or $status -ge 400 -or [string]::IsNullOrWhiteSpace([string]$location)) {
        throw "Could not resolve the yt-dlp release (HTTP $status). Refusing to install an unverified binary."
    }
    $redirectUri = $null
    if (-not [Uri]::TryCreate([string]$location, [UriKind]::Absolute, [ref]$redirectUri)) {
        throw "yt-dlp release redirect was not a URL. Refusing to install an unverified binary."
    }
    if ($redirectUri.AbsolutePath -notmatch '/yt-dlp/yt-dlp/releases/download/([^/]+)/([^/]+)$') {
        throw "Could not read a yt-dlp release tag. Refusing to install an unverified binary."
    }
    $tag = [Uri]::UnescapeDataString($Matches[1])
    $file = [Uri]::UnescapeDataString($Matches[2])
    if ($tag -notmatch '^\d{4}\.\d{2}\.\d{2}(\.\d+)?$' -or $tag.Contains('..')) {
        throw "Refusing yt-dlp release tag '$tag'. Refusing to install an unverified binary."
    }
    if ($file -ne $assetName) {
        throw "yt-dlp redirect pointed at $file, not $assetName. Refusing to install an unverified binary."
    }

    $sumsUrl = "https://github.com/yt-dlp/yt-dlp/releases/download/$tag/SHA2-256SUMS"
    $assetUrl = "https://github.com/yt-dlp/yt-dlp/releases/download/$tag/$assetName"
    $work = Join-Path ([System.IO.Path]::GetTempPath()) ("yoink-ytdlp-" + [guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    $sumsFile = Join-Path $work 'SHA2-256SUMS'
    $binFile = Join-Path $work $assetName
    try {
        Write-Host "  Fetching SHA2-256SUMS for yt-dlp $tag..."
        try {
            Invoke-WebRequest -Uri $sumsUrl -OutFile $sumsFile -UseBasicParsing -ErrorAction Stop
        } catch {
            throw "Could not fetch SHA2-256SUMS for yt-dlp ${tag} ($($_.Exception.Message)). Refusing to install an unverified binary."
        }
        $expected = $null
        foreach ($line in Get-Content -LiteralPath $sumsFile) {
            $trim = $line.Trim()
            if (-not $trim -or $trim.StartsWith('#')) { continue }
            if ($trim -notmatch '^([a-fA-F0-9]{64})\s+\*?(\S+)$') {
                throw "SHA2-256SUMS has an unreadable line. Refusing to install an unverified binary."
            }
            if ($Matches[2] -eq $assetName) {
                $hash = $Matches[1].ToLower()
                if ($expected -and $expected -ne $hash) {
                    throw "SHA2-256SUMS lists conflicting hashes for $assetName. Refusing to install an unverified binary."
                }
                $expected = $hash
            }
        }
        if (-not $expected) {
            throw "SHA2-256SUMS has no entry for $assetName. Refusing to install an unverified binary."
        }
        Write-Host "  Downloading yt-dlp $tag..."
        try {
            Invoke-WebRequest -Uri $assetUrl -OutFile $binFile -UseBasicParsing -ErrorAction Stop
        } catch {
            throw "yt-dlp download failed ($($_.Exception.Message)). Refusing to install an unverified binary."
        }
        $actual = (Get-FileHash -LiteralPath $binFile -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $expected) {
            throw "Checksum mismatch for $assetName. Refusing to install an unverified binary."
        }
        $destDir = Split-Path -Parent $Destination
        if (-not (Test-Path -LiteralPath $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Move-Item -LiteralPath $binFile -Destination $Destination -Force
        Write-Host "  Installed yt-dlp $tag (checksum ok)"
    } finally {
        if (Test-Path -LiteralPath $work) {
            Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

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
        Install-VerifiedYtDlp -Destination $ytdlpDst
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
