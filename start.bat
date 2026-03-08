@echo off
echo ========================================
echo   数独2048 - Starting...
echo ========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please download and install Node.js from:
    echo https://nodejs.org/
    echo.
    pause
    exit /b
)

if not exist node_modules (
    echo Installing dependencies, please wait...
    npm install electron --save-dev
    echo.
)

echo Launching...
npx electron .
pause
