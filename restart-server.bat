@echo off
setlocal EnableExtensions

net session >nul 2>&1
if errorlevel 1 (
    echo Please run this script as Administrator.
    echo Right-click restart-server.bat and choose "Run as administrator".
    pause
    exit /b 1
)

cd /d "%~dp0"

echo Stopping any process listening on port 3000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /F /T /PID %%p >nul 2>&1
)

timeout /t 2 /nobreak >nul

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js was not found in PATH.
    echo Install Node.js 18+ and try again.
    pause
    exit /b 1
)

echo Starting Mountain Goats server on http://localhost:3000
echo Press Ctrl+C to stop.
echo.

node server.js
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
    echo.
    echo Server exited with code %EXIT_CODE%.
    pause
    exit /b %EXIT_CODE%
)

endlocal
