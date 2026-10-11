@echo off
title Bryt Shell setup - BrytMa Tech Uganda
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org and run this again.
  pause & exit /b 1
)
echo Installing packages (no compiling needed)...
call npm install --no-audit --no-fund
if errorlevel 1 goto fail
echo.
echo Setup finished. Double-click start.bat to run Bryt Shell.
pause & exit /b 0
:fail
echo.
echo Something failed. Copy the error text above and send it to Claude.
pause & exit /b 1
