@echo off
title Bryt Shell - build installer
cd /d "%~dp0"
echo Installing build tools (first time only)...
call npm install --no-audit --no-fund
if errorlevel 1 goto fail
echo.
echo Building the installer...
call npm run dist
if errorlevel 1 goto fail
echo.
echo Done. Your installer is in the "dist" folder:  Bryt-Shell-Setup-*.exe
echo Run it to install Bryt Shell with its own icon, a desktop shortcut and a Start menu entry.
start "" "%~dp0dist"
pause & exit /b 0
:fail
echo.
echo Something failed. Copy the error text above and send it to Claude.
pause & exit /b 1
