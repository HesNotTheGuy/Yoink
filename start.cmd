@echo off
SET PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0"
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev
