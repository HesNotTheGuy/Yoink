@echo off
cd /d "%~dp0"

REM Locate Node.js — prefer system PATH, fall back to common install locations
where node >nul 2>&1
IF %ERRORLEVEL% EQU 0 goto RUN

FOR %%D IN (
    "%ProgramFiles%\nodejs"
    "%ProgramFiles(x86)%\nodejs"
    "%LOCALAPPDATA%\Programs\nodejs"
) DO (
    IF EXIST "%%~D\node.exe" (
        SET "PATH=%%~D;%PATH%"
        goto RUN
    )
)

echo.
echo  ERROR: Node.js not found on PATH or in common install locations.
echo  Install Node.js from https://nodejs.org and re-run.
echo.
pause
exit /b 1

:RUN
IF "%PORT%"=="" (
    npm run dev
) ELSE (
    npm run dev -- --port %PORT%
)
