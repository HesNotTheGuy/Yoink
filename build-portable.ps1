#Requires -Version 5.1
param(
    [switch]$SkipBuild,
    [switch]$SkipZip,
    [switch]$BundleYtdlp,
    # Compile a Windows installer (.exe via Inno Setup) after the build.
    # Implies -BundleYtdlp because the installer wants the full bundle.
    # Will auto-download Inno Setup if it's not already installed.
    [switch]$Installer,
    # Read the Yoink version from app/page.tsx GUI_VERSION (stamped into
    # the installer's Add/Remove Programs entry). Override via -AppVersion.
    [string]$AppVersion
)

$ErrorActionPreference = "Stop"

# Installer requires the full bundle to install yt-dlp alongside
if ($Installer) { $BundleYtdlp = $true }

$AppName  = if ($BundleYtdlp) { "ytdlp-gui-full" } else { "ytdlp-gui" }
$AppTitle = "yt-dlp GUI"
$Port     = 3000

# Resolve the GUI version - read from app/page.tsx unless caller overrode it
if (-not $AppVersion) {
    $pageFile = Join-Path $PSScriptRoot "app\page.tsx"
    if (Test-Path $pageFile) {
        $verMatch = Select-String -Path $pageFile -Pattern 'const GUI_VERSION\s*=\s*"([^"]+)"' | Select-Object -First 1
        if ($verMatch) { $AppVersion = $verMatch.Matches[0].Groups[1].Value }
    }
    if (-not $AppVersion) { $AppVersion = "0.0.0" }
}

$ScriptDir = $PSScriptRoot
$DistRoot  = Join-Path $ScriptDir "dist"
$AppDir    = Join-Path $DistRoot $AppName
$ServerDir = Join-Path $AppDir "server"
$NodeDir   = Join-Path $AppDir "node"
$FfmpegDir = Join-Path $AppDir "ffmpeg"
$YtdlpDir  = Join-Path $AppDir "yt-dlp"

function Write-Step([int]$n, [int]$total, [string]$msg) {
    Write-Host ""
    Write-Host "[$n/$total] $msg" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  $AppTitle  -  Portable Builder"          -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# -------------------------------------------------------------------
# Step 1: Build Next.js
# -------------------------------------------------------------------
$totalSteps = 7
Write-Step 1 $totalSteps "Building Next.js (standalone)..."

if ($SkipBuild) {
    Write-Host "  Skipped (-SkipBuild)" -ForegroundColor DarkGray
} else {
    # Stop any running dev server on port 3000 so the build doesn't conflict
    $devProc = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
               Select-Object -ExpandProperty OwningProcess -ErrorAction SilentlyContinue
    if ($devProc) {
        Write-Host "  Stopping dev server (PID $devProc)..." -ForegroundColor DarkYellow
        Stop-Process -Id $devProc -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    $env:PATH = "C:\Program Files\nodejs;$env:PATH"
    Push-Location $ScriptDir

    # Temporarily patch next.config.ts to add standalone output for this build only
    $configPath = Join-Path $ScriptDir "next.config.ts"
    $origConfig = Get-Content $configPath -Raw
    $buildConfig = "import type { NextConfig } from 'next';`nconst nextConfig: NextConfig = { output: 'standalone' };`nexport default nextConfig;`n"
    [System.IO.File]::WriteAllText($configPath, $buildConfig)

    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "next build failed with exit code $LASTEXITCODE" }
    } finally {
        # Always restore original config
        [System.IO.File]::WriteAllText($configPath, $origConfig)
        Pop-Location
    }
    Write-Host "  Build succeeded." -ForegroundColor Green
}

$StandaloneDir = Join-Path $ScriptDir ".next\standalone"
if (-not (Test-Path $StandaloneDir)) {
    throw "ERROR: .next\standalone not found. The build may have failed."
}

# -------------------------------------------------------------------
# Step 2: Create dist folder structure
# -------------------------------------------------------------------
Write-Step 2 $totalSteps "Creating dist structure..."

if (Test-Path $AppDir) {
    Write-Host "  Removing old dist..." -ForegroundColor DarkGray
    Remove-Item $AppDir -Recurse -Force
}

foreach ($d in @($AppDir, $ServerDir, $NodeDir, $FfmpegDir, $YtdlpDir)) {
    New-Item -ItemType Directory -Path $d | Out-Null
}

Write-Host "  Copying standalone server..."
Copy-Item "$StandaloneDir\*" $ServerDir -Recurse -Force

Write-Host "  Copying .next/static..."
$StaticSrc = Join-Path $ScriptDir ".next\static"
$StaticDst = Join-Path $ServerDir ".next\static"
Copy-Item $StaticSrc $StaticDst -Recurse -Force

Write-Host "  Copying public folder..."
$PublicSrc = Join-Path $ScriptDir "public"
$PublicDst = Join-Path $ServerDir "public"
Copy-Item $PublicSrc $PublicDst -Recurse -Force

# Write build-info.json so the UI can show the variant in its footer
$variantLabel = if ($BundleYtdlp) { "Full" } else { "Standard" }
$buildInfoJson = "{`"variant`":`"$variantLabel`"}"
[System.IO.File]::WriteAllText((Join-Path $PublicDst "build-info.json"), $buildInfoJson)

# Scrub build-machine paths from Next.js metadata (required-server-files.json
# embeds the source directory at build time; replace with a neutral placeholder)
$rsfPath = Join-Path $ServerDir ".next\required-server-files.json"
if (Test-Path $rsfPath) {
    $rsfContent = [System.IO.File]::ReadAllText($rsfPath)
    # In the JSON file each backslash is stored as \\ — match that form
    $jsonEscaped = $ScriptDir.Replace("\", "\\")
    $rsfContent  = $rsfContent.Replace($jsonEscaped, "C:\\ytdlp-gui")
    # Also cover forward-slash form (less common but possible)
    $fwdSlash    = $ScriptDir.Replace("\", "/")
    $rsfContent  = $rsfContent.Replace($fwdSlash, "C:/ytdlp-gui")
    [System.IO.File]::WriteAllText($rsfPath, $rsfContent)
    Write-Host "  Scrubbed build paths from required-server-files.json" -ForegroundColor Green
}

Write-Host "  Done." -ForegroundColor Green

# -------------------------------------------------------------------
# Step 3: Bundle portable node.exe
# -------------------------------------------------------------------
Write-Step 3 $totalSteps "Bundling portable Node.js..."

$NodeSrc = "C:\Program Files\nodejs\node.exe"
if (Test-Path $NodeSrc) {
    Copy-Item $NodeSrc (Join-Path $NodeDir "node.exe")
    $nodeVer = (& "$NodeSrc" --version 2>$null)
    Write-Host "  Copied node.exe ($nodeVer)" -ForegroundColor Green
} else {
    Write-Host "  node.exe not found locally -- downloading from nodejs.org..." -ForegroundColor DarkYellow
    $nodeUrl = "https://nodejs.org/dist/latest-v24.x/node.exe"
    Invoke-WebRequest $nodeUrl -OutFile (Join-Path $NodeDir "node.exe") -UseBasicParsing
    Write-Host "  Downloaded node.exe" -ForegroundColor Green
}

# -------------------------------------------------------------------
# Step 4: Bundle ffmpeg
# -------------------------------------------------------------------
Write-Step 4 $totalSteps "Bundling ffmpeg..."

$FfmpegSrc = (Get-ChildItem "C:\ffmpeg" -Directory | Where-Object { Test-Path "$($_.FullName)\bin\ffmpeg.exe" } | Select-Object -First 1 -ExpandProperty FullName) + "\bin"
if (-not $FfmpegSrc -or -not (Test-Path "$FfmpegSrc\ffmpeg.exe")) { $FfmpegSrc = "C:\ffmpeg\bin" }
if (Test-Path "$FfmpegSrc\ffmpeg.exe") {
    foreach ($bin in @("ffmpeg.exe", "ffprobe.exe")) {
        $src = Join-Path $FfmpegSrc $bin
        if (Test-Path $src) {
            Copy-Item $src $FfmpegDir
            $sizeMB = [math]::Round((Get-Item $src).Length / 1048576, 1)
            Write-Host "  Copied $bin ($sizeMB MB)"
        }
    }
    Write-Host "  Done." -ForegroundColor Green
} else {
    Write-Host "  WARNING: ffmpeg not found at $FfmpegSrc -- skipping. HD video merging won't work." -ForegroundColor DarkYellow
}

# -------------------------------------------------------------------
# Step 5: Write launcher scripts
# -------------------------------------------------------------------
Write-Step 5 $totalSteps "Writing launcher scripts..."

# yt-dlp: bundle exe or write placeholder README
if ($BundleYtdlp) {
    $ytdlpExeDst = Join-Path $YtdlpDir "yt-dlp.exe"
    $ytdlpUrl    = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    Write-Host "  Downloading yt-dlp.exe (latest)..." -ForegroundColor DarkYellow
    Invoke-WebRequest $ytdlpUrl -OutFile $ytdlpExeDst -UseBasicParsing -ErrorAction Stop
    $ytdlpSizeMB = [math]::Round((Get-Item $ytdlpExeDst).Length / 1048576, 1)
    Write-Host "  Downloaded yt-dlp.exe ($ytdlpSizeMB MB)" -ForegroundColor Green
} else {
    $readmeTxt  = "Put your yt-dlp.exe file in this folder.`r`n"
    $readmeTxt += "Alternatively, install yt-dlp globally so it is on your system PATH.`r`n"
    $readmeTxt += "`r`nDownload yt-dlp: https://github.com/yt-dlp/yt-dlp/releases/latest`r`n"
    [System.IO.File]::WriteAllText((Join-Path $YtdlpDir "README.txt"), $readmeTxt)
}

# Main README
$readme  = "yt-dlp GUI  -  Portable Edition`r`n"
$readme += "================================`r`n"
$readme += "`r`n"
$readme += "A simple graphical interface for yt-dlp that lets you download videos and audio`r`n"
$readme += "from YouTube, Twitch, Twitter/X, and thousands of other sites.`r`n"
$readme += "`r`n"
$readme += "`r`n"
$readme += "REQUIREMENTS`r`n"
$readme += "------------`r`n"
if ($BundleYtdlp) {
$readme += "Everything is included -- no additional downloads needed.`r`n"
$readme += "yt-dlp and ffmpeg are both bundled.`r`n"
$readme += "`r`n"
$readme += "NOTE: yt-dlp updates frequently. To get the latest version, use the Update`r`n"
$readme += "button inside the app, or replace yt-dlp\yt-dlp.exe with a newer download.`r`n"
} else {
$readme += "yt-dlp.exe is NOT included (it updates frequently, so you supply your own).`r`n"
$readme += "ffmpeg is bundled -- no separate install needed.`r`n"
$readme += "`r`n"
$readme += "Download the latest yt-dlp.exe here:`r`n"
$readme += "  https://github.com/yt-dlp/yt-dlp/releases/latest`r`n"
$readme += "  -> grab  yt-dlp.exe  from the Assets section`r`n"
}
$readme += "`r`n"
$readme += "`r`n"
if ($BundleYtdlp) {
$readme += "SETUP`r`n"
$readme += "-----`r`n"
$readme += "No setup required. Everything is ready to go.`r`n"
} else {
$readme += "SETUP (one-time)`r`n"
$readme += "----------------`r`n"
$readme += "1. Drop  yt-dlp.exe  into the  yt-dlp\  folder inside this directory.`r`n"
$readme += "   (Alternatively, if yt-dlp is already on your system PATH, skip this step.)`r`n"
}
$readme += "`r`n"
$readme += "`r`n"
$readme += "LAUNCHING`r`n"
$readme += "---------`r`n"
$readme += "Double-click  ytdlp-gui.exe  to start the app.`r`n"
$readme += "`r`n"
$readme += "This will:`r`n"
$readme += "  - Start a local web server in the background (port $Port)`r`n"
$readme += "  - Wait until it is ready`r`n"
$readme += "  - Open the interface in your default browser`r`n"
$readme += "`r`n"
$readme += "If your antivirus blocks ytdlp-gui.exe, run  launch.cmd  instead -- it does`r`n"
$readme += "exactly the same thing.`r`n"
$readme += "`r`n"
$readme += "`r`n"
$readme += "USING THE APP`r`n"
$readme += "-------------`r`n"
$readme += "1. Paste a video URL into the box at the top (supports YouTube, Twitch, X/Twitter,`r`n"
$readme += "   Reddit, and thousands of other sites supported by yt-dlp).`r`n"
$readme += "`r`n"
$readme += "2. Choose a format:`r`n"
$readme += "   Video:  Best Quality, 1080p, 720p, 480p, 360p`r`n"
$readme += "   Audio:  MP3 (audio only)`r`n"
$readme += "`r`n"
$readme += "3. Optionally set an output folder (defaults to your Downloads folder).`r`n"
$readme += "   Click Browse to pick a folder with a dialog.`r`n"
$readme += "`r`n"
$readme += "4. Click Download. A progress bar will appear for each download.`r`n"
$readme += "   You can queue multiple downloads at once.`r`n"
$readme += "`r`n"
$readme += "5. When a download finishes, click the folder icon to open the output folder.`r`n"
$readme += "`r`n"
$readme += "Other features (accessible via the settings gear icon):`r`n"
$readme += "  - Batch mode: paste multiple URLs at once (one per line)`r`n"
$readme += "  - Embed metadata and thumbnail into the file`r`n"
$readme += "  - Pass a cookies.txt file for age-restricted or members-only content`r`n"
$readme += "  - Update yt-dlp to the latest version with one click`r`n"
$readme += "  - View download history`r`n"
$readme += "`r`n"
$readme += "`r`n"
$readme += "STOPPING THE APP`r`n"
$readme += "----------------`r`n"
$readme += "Simply close the browser tab/window. The background server will automatically`r`n"
$readme += "shut itself down after 10 seconds of inactivity.`r`n"
$readme += "`r`n"
$readme += "`r`n"
$readme += "NOTES`r`n"
$readme += "-----`r`n"
$readme += "- The server only listens on 127.0.0.1 (localhost) -- it is not exposed to your`r`n"
$readme += "  network or the internet.`r`n"
$readme += "- Downloaded files go to your Downloads folder by default, or whatever folder`r`n"
$readme += "  you specify in the output path field.`r`n"
$readme += "- To update yt-dlp, replace the yt-dlp.exe in the  yt-dlp\  folder with a`r`n"
$readme += "  newer version, or use the Update button inside the app.`r`n"
[System.IO.File]::WriteAllText((Join-Path $AppDir "README.txt"), $readme)

# Copy icon
$IconSrc = Join-Path $ScriptDir "yoink.ico"
if (Test-Path $IconSrc) {
    Copy-Item $IconSrc $AppDir
    Write-Host "  Copied icon."
}

# start-server.cmd  -- sets env and runs node
$startServerCmd  = "@echo off`r`n"
$startServerCmd += "SET APPDIR=%~dp0`r`n"
$startServerCmd += "cd /d `"%APPDIR%server`"`r`n"
$startServerCmd += "SET `"PATH=%APPDIR%node;%APPDIR%ffmpeg;%APPDIR%yt-dlp;%PATH%`"`r`n"
$startServerCmd += "IF `"%PORT%`"==`"`" SET PORT=$Port`r`n"
$startServerCmd += "SET NODE_ENV=production`r`n"
$startServerCmd += "SET HOSTNAME=127.0.0.1`r`n"
$startServerCmd += "`"%APPDIR%node\node.exe`" `"%APPDIR%server\server.js`"`r`n"
[System.IO.File]::WriteAllText((Join-Path $AppDir "start-server.cmd"), $startServerCmd)

# start-server.vbs  -- hides the CMD window, forwards PORT env var
$startServerVbs  = "Set wsh = CreateObject(`"WScript.Shell`")`r`n"
$startServerVbs += "Dim appDir`r`n"
$startServerVbs += "appDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, `"\`"))`r`n"
$startServerVbs += "Dim port : port = wsh.Environment(`"Process`")(`"PORT`")`r`n"
$startServerVbs += "Dim cmd : cmd = `"cmd /c `"`"`" & appDir & `"start-server.cmd`"`"`r`n"
$startServerVbs += "If port <> `"`" Then cmd = `"cmd /c SET PORT=`" & port & `" && `"`"`" & appDir & `"start-server.cmd`"`"`r`n"
$startServerVbs += "wsh.Run cmd, 0, False`r`n"
[System.IO.File]::WriteAllText((Join-Path $AppDir "start-server.vbs"), $startServerVbs)

# launch.cmd  -- user double-clicks this
$launchCmd  = "@echo off`r`n"
$launchCmd += "SETLOCAL`r`n"
$launchCmd += "SET APPDIR=%~dp0`r`n"
$launchCmd += "`r`n"
$launchCmd += "REM Check if Yoink is already running on port $Port`r`n"
$launchCmd += "curl -s -m 2 http://localhost:$Port/api/ping >nul 2>&1`r`n"
$launchCmd += "IF %ERRORLEVEL% EQU 0 (`r`n"
$launchCmd += "    SET PORT=$Port`r`n"
$launchCmd += "    goto OPEN`r`n"
$launchCmd += ")`r`n"
$launchCmd += "`r`n"
$launchCmd += "REM Find a free port`r`n"
$launchCmd += "FOR /F %%p IN ('powershell -NoProfile -Command `"`$l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);`$l.Start();`$p=`$l.LocalEndpoint.Port;`$l.Stop();`$p`"') DO SET PORT=%%p`r`n"
$launchCmd += "`r`n"
$launchCmd += "REM Start server silently in background`r`n"
$launchCmd += "wscript.exe `"%APPDIR%start-server.vbs`"`r`n"
$launchCmd += "`r`n"
$launchCmd += "REM Wait for server to become ready`r`n"
$launchCmd += ":WAIT`r`n"
$launchCmd += "timeout /t 1 /nobreak >nul`r`n"
$launchCmd += "curl -s -m 1 http://localhost:%PORT% >nul 2>&1`r`n"
$launchCmd += "IF %ERRORLEVEL% NEQ 0 GOTO WAIT`r`n"
$launchCmd += "`r`n"
$launchCmd += ":OPEN`r`n"
$launchCmd += "SET BRAVE_LOCAL=`"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe`"`r`n"
$launchCmd += "SET BRAVE_PROG=`"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`"`r`n"
$launchCmd += "SET CHROME=`"C:\Program Files\Google\Chrome\Application\chrome.exe`"`r`n"
$launchCmd += "SET EDGE=`"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`"`r`n"
$launchCmd += "`r`n"
$launchCmd += "IF EXIST %BRAVE_LOCAL% (`r`n"
$launchCmd += "    start `"`" %BRAVE_LOCAL% --app=http://localhost:%PORT% --new-window`r`n"
$launchCmd += ") ELSE IF EXIST %BRAVE_PROG% (`r`n"
$launchCmd += "    start `"`" %BRAVE_PROG% --app=http://localhost:%PORT% --new-window`r`n"
$launchCmd += ") ELSE IF EXIST %CHROME% (`r`n"
$launchCmd += "    start `"`" %CHROME% --app=http://localhost:%PORT% --new-window`r`n"
$launchCmd += ") ELSE IF EXIST %EDGE% (`r`n"
$launchCmd += "    start `"`" %EDGE% --app=http://localhost:%PORT% --new-window`r`n"
$launchCmd += ") ELSE (`r`n"
$launchCmd += "    start `"`" http://localhost:%PORT%`r`n"
$launchCmd += ")`r`n"
[System.IO.File]::WriteAllText((Join-Path $AppDir "launch.cmd"), $launchCmd)

Write-Host "  Launcher scripts written." -ForegroundColor Green

# -------------------------------------------------------------------
# Step 6: Compile ytdlp-gui.exe launcher
# -------------------------------------------------------------------
Write-Step 6 $totalSteps "Compiling launcher exe..."

$ExeOut = Join-Path $AppDir "ytdlp-gui.exe"
$IconPath = Join-Path $ScriptDir "yoink.ico"

try {
    # Load ps2exe -- download to temp dir and import directly (avoids Install-Module prompts)
    $ps2exeTempDir = Join-Path $env:TEMP "ps2exe-$PID"
    if (-not (Get-Command ps2exe -ErrorAction SilentlyContinue)) {
        Write-Host "  Downloading ps2exe (requires internet)..." -ForegroundColor DarkYellow
        $tempZip = "$ps2exeTempDir.zip"
        Invoke-WebRequest "https://www.powershellgallery.com/api/v2/package/ps2exe" -OutFile $tempZip -UseBasicParsing -ErrorAction Stop
        Expand-Archive $tempZip $ps2exeTempDir -Force -ErrorAction Stop
        Remove-Item $tempZip -ErrorAction SilentlyContinue
        Import-Module (Join-Path $ps2exeTempDir "ps2exe.psd1") -ErrorAction Stop
        Write-Host "  ps2exe loaded." -ForegroundColor Green
    }

    # Tiny launcher: finds its own folder and runs launch.cmd
    $launcherPs1Path = Join-Path $env:TEMP "ytdlp-launcher-$PID.ps1"
    $launcherSrc  = '$dir = [System.AppDomain]::CurrentDomain.BaseDirectory.TrimEnd("\")' + "`r`n"
    $launcherSrc += 'Start-Process "cmd.exe" -ArgumentList ("/c `"" + $dir + "\launch.cmd`"")' + "`r`n"
    [System.IO.File]::WriteAllText($launcherPs1Path, $launcherSrc)

    $ps2exeParams = @{
        inputFile  = $launcherPs1Path
        outputFile = $ExeOut
        noconsole  = $true
        noOutput   = $true
        noError    = $true
    }
    if (Test-Path $IconPath) { $ps2exeParams.iconFile = $IconPath }

    ps2exe @ps2exeParams
    Remove-Item $launcherPs1Path -ErrorAction SilentlyContinue
    if (Test-Path $ps2exeTempDir) { Remove-Item $ps2exeTempDir -Recurse -Force -ErrorAction SilentlyContinue }

    if (Test-Path $ExeOut) {
        $exeKB = [math]::Round((Get-Item $ExeOut).Length / 1024, 0)
        Write-Host "  Created ytdlp-gui.exe ($exeKB KB)" -ForegroundColor Green
        Write-Host "  NOTE: Some antivirus may flag ps2exe-compiled exes as suspicious." -ForegroundColor DarkGray
        Write-Host "        This is a known false positive. launch.cmd always works as a fallback." -ForegroundColor DarkGray
    } else {
        Write-Host "  WARNING: Compilation produced no output -- skipping exe." -ForegroundColor DarkYellow
    }
} catch {
    Write-Host "  WARNING: Could not compile exe: $_" -ForegroundColor DarkYellow
    Write-Host "           Users can still run launch.cmd instead." -ForegroundColor DarkGray
}

# -------------------------------------------------------------------
# Step 7: Create ZIP
# -------------------------------------------------------------------
Write-Step 7 $totalSteps "Creating ZIP archive..."

if ($SkipZip) {
    Write-Host "  Skipped (-SkipZip)" -ForegroundColor DarkGray
} else {
    if (-not (Test-Path $DistRoot)) {
        New-Item -ItemType Directory -Path $DistRoot | Out-Null
    }
    $ZipPath = Join-Path $DistRoot "$AppName.zip"
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

    Write-Host "  Compressing (this may take a moment)..."
    Compress-Archive -Path $AppDir -DestinationPath $ZipPath -CompressionLevel Optimal

    $zipMB = [math]::Round((Get-Item $ZipPath).Length / 1048576, 1)
    Write-Host "  Created: $ZipPath ($zipMB MB)" -ForegroundColor Green
}

# -------------------------------------------------------------------
# Optional Step: Inno Setup installer
# -------------------------------------------------------------------
$InstallerPath = $null
if ($Installer) {
    Write-Host ""
    Write-Host "[+] Compiling Windows installer (Inno Setup)..." -ForegroundColor Yellow

    # Locate ISCC.exe (Inno Setup compiler)
    $isccCandidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 5\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 5\ISCC.exe"
    )
    $iscc = $isccCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

    if (-not $iscc) {
        Write-Host "  Inno Setup not found." -ForegroundColor DarkYellow
        $reply = Read-Host "  Download and install Inno Setup automatically? (y/N)"
        if ($reply -match '^[Yy]') {
            $isExe = Join-Path $env:TEMP "innosetup-installer.exe"
            Write-Host "  Downloading from jrsoftware.org..." -ForegroundColor DarkGray
            try {
                Invoke-WebRequest -Uri "https://jrsoftware.org/download.php/is.exe" -OutFile $isExe -UseBasicParsing -ErrorAction Stop
                Write-Host "  Installing silently (this triggers a UAC prompt)..." -ForegroundColor DarkGray
                $proc = Start-Process -FilePath $isExe -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART" -Wait -PassThru
                Remove-Item $isExe -Force -ErrorAction SilentlyContinue
                if ($proc.ExitCode -ne 0) { throw "Inno Setup installer exited with code $($proc.ExitCode)" }
                # Re-detect
                $iscc = $isccCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
                if ($iscc) { Write-Host "  Installed: $iscc" -ForegroundColor Green }
            } catch {
                Write-Host "  Auto-install failed: $_" -ForegroundColor Red
                Write-Host "  Install Inno Setup manually from https://jrsoftware.org/isdl.php" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  Skipping installer build." -ForegroundColor DarkGray
            Write-Host "  Install Inno Setup from https://jrsoftware.org/isdl.php to enable -Installer." -ForegroundColor DarkGray
        }
    }

    if ($iscc) {
        $issFile = Join-Path $ScriptDir "installer\yoink.iss"
        if (-not (Test-Path $issFile)) {
            Write-Host "  ERROR: $issFile not found." -ForegroundColor Red
        } else {
            Write-Host "  Compiling with version $AppVersion..." -ForegroundColor DarkGray
            $isccArgs = @("/DAppVersion=$AppVersion", "/Qp", $issFile)
            $proc = Start-Process -FilePath $iscc -ArgumentList $isccArgs -Wait -NoNewWindow -PassThru
            if ($proc.ExitCode -eq 0) {
                $InstallerPath = Join-Path $DistRoot "Yoink-Setup-$AppVersion.exe"
                if (Test-Path $InstallerPath) {
                    $instMB = [math]::Round((Get-Item $InstallerPath).Length / 1048576, 1)
                    Write-Host "  Created: $InstallerPath ($instMB MB)" -ForegroundColor Green
                } else {
                    Write-Host "  WARNING: ISCC succeeded but output not found at $InstallerPath" -ForegroundColor DarkYellow
                }
            } else {
                Write-Host "  ISCC exited with code $($proc.ExitCode) - installer not produced." -ForegroundColor Red
            }
        }
    }
}

# -------------------------------------------------------------------
# Cleanup: remove production .next/ so dev mode starts fresh
# -------------------------------------------------------------------
$nextDir = Join-Path $ScriptDir ".next"
if (Test-Path $nextDir) {
    Write-Host ""
    Write-Host "  Cleaning up production .next/ so dev server starts fresh..." -ForegroundColor DarkGray
    Remove-Item $nextDir -Recurse -Force -ErrorAction SilentlyContinue
}

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Build complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Portable folder : $AppDir"
if (-not $SkipZip) {
    Write-Host "  ZIP to send     : $ZipPath"
}
if ($InstallerPath -and (Test-Path $InstallerPath)) {
    Write-Host "  Installer (exe) : $InstallerPath"
}
Write-Host ""
Write-Host "  Recipient setup:" -ForegroundColor Cyan
if ($BundleYtdlp) {
    Write-Host "    1. Extract  $AppName.zip"
    Write-Host "    2. Double-click  ytdlp-gui.exe  (or launch.cmd if blocked by antivirus)"
} else {
    Write-Host "    1. Extract  $AppName.zip"
    Write-Host "    2. Drop yt-dlp.exe in the  yt-dlp\  folder  (or ensure it is on PATH)"
    Write-Host "    3. Double-click  ytdlp-gui.exe  (or launch.cmd if blocked by antivirus)"
}
Write-Host ""
