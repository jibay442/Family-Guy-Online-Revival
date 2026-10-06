@echo off
rem Starts Family Guy Online - Revival (co-op server + game in the browser).
cd /d "%~dp0revival"
where node >nul 2>nul || (echo Node.js 20+ is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules\three call npm install --no-fund --no-audit
if not exist node_modules\ws call npm install --no-fund --no-audit
node launcher.mjs %*
pause
