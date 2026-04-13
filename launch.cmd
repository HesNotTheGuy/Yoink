@echo off
SET PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0"

REM Check if server is already running
curl -s http://localhost:3000 >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    goto OPEN
)

REM Start server silently in background (no visible window)
wscript.exe "%~dp0start-hidden.vbs"

REM Wait for server to be ready
:WAIT
timeout /t 1 /nobreak >nul
curl -s http://localhost:3000 >nul 2>&1
IF %ERRORLEVEL% NEQ 0 GOTO WAIT

:OPEN
REM Open as standalone app window (no browser UI)
SET BRAVE_LOCAL="%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"
SET BRAVE_PROG="C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
SET CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
SET EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

IF EXIST %BRAVE_LOCAL% (
    start "" %BRAVE_LOCAL% --app=http://localhost:3000 --new-window
) ELSE IF EXIST %BRAVE_PROG% (
    start "" %BRAVE_PROG% --app=http://localhost:3000 --new-window
) ELSE IF EXIST %CHROME% (
    start "" %CHROME% --app=http://localhost:3000 --new-window
) ELSE IF EXIST %EDGE% (
    start "" %EDGE% --app=http://localhost:3000 --new-window
) ELSE (
    start "" http://localhost:3000
)
