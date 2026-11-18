@echo off
rem Double-click to fetch the latest version, render the clip with the graphics card and open it.
cd /d "%~dp0"
git restore . & git pull & call npm.cmd install --no-audit --no-fund & call npm.cmd run build:gpu && start "" "out\shoulder-clip.mp4"
echo.
pause
