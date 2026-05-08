@echo off
SETLOCAL
SET APPDIR=%~dp0

REM ── Check if a Yoink server is already running on port 3000 ───────────────
curl -s -m 2 http://localhost:3000/api/ping >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    SET PORT=3000
    goto OPEN
)

REM ── Find a free port ──────────────────────────────────────────────────────
FOR /F %%p IN ('powershell -NoProfile -Command "$l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$l.Start();$p=$l.LocalEndpoint.Port;$l.Stop();$p"') DO SET PORT=%%p

REM ── Start server silently in background ───────────────────────────────────
wscript.exe "%APPDIR%start-hidden.vbs"

REM ── Wait for server to become ready ───────────────────────────────────────
:WAIT
timeout /t 1 /nobreak >nul
curl -s -m 1 http://localhost:%PORT% >nul 2>&1
IF %ERRORLEVEL% NEQ 0 GOTO WAIT

:OPEN
SET BRAVE_LOCAL="%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"
SET BRAVE_PROG="C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
SET CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
SET EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

IF EXIST %BRAVE_LOCAL% (
    start "" %BRAVE_LOCAL% --app=http://localhost:%PORT% --new-window
) ELSE IF EXIST %BRAVE_PROG% (
    start "" %BRAVE_PROG% --app=http://localhost:%PORT% --new-window
) ELSE IF EXIST %CHROME% (
    start "" %CHROME% --app=http://localhost:%PORT% --new-window
) ELSE IF EXIST %EDGE% (
    start "" %EDGE% --app=http://localhost:%PORT% --new-window
) ELSE (
    start "" http://localhost:%PORT%
)
