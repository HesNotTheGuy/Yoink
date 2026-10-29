# Yoink Browser Extension — Native Messaging Host Installer
# Run this script once from PowerShell (no admin rights required for HKCU).
# Requirements: Node.js must be on PATH.

$ErrorActionPreference = 'Stop'

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
    Install-VerifiedYtDlp -Destination $ytdlpPath
}

Write-Host ""
Write-Host "=== Installation complete! ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Load extension\src\ as an unpacked extension in Chrome/Firefox." -ForegroundColor White
Write-Host "  2. Note your extension ID from the browser's extensions page." -ForegroundColor White
Write-Host "  3. Update 'allowed_origins' in $manifestPath with the real ID." -ForegroundColor White
Write-Host ""
