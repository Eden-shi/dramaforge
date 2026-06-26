@echo off
setlocal
cd /d "%~dp0"
if not exist "apps\web\dist" call npm.cmd run -w @dramaforge/web build
if not exist "apps\server\dist" call npm.cmd run -w @dramaforge/server build
echo [DramaForge] starting at http://127.0.0.1:7800
node.exe apps\server\dist\index.js
endlocal
