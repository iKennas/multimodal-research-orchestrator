@echo off
setlocal enabledelayedexpansion
title Multimodal Research Orchestrator - DEMO MODE
cd /d "%~dp0"

echo.
echo   ============================================
echo    Multimodal Research Orchestrator
echo    OFFLINE DEMO MODE
echo   ============================================
echo.
echo   Every agent returns a fixed offline response.
echo   No API key is used and no request leaves this
echo   computer, so this can never hit a rate limit
echo   or fail in front of an audience.
echo.
echo   The interface behaves exactly as it does live,
echo   including the streaming text animation.
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo   [!] Node.js was not found. Install it from https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo   First run - installing dependencies...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo   [!] npm install failed.
        echo.
        pause
        exit /b 1
    )
    echo.
)

REM --- Find a free port so this can run alongside a live instance --------
REM  goto is kept out of parenthesised blocks on purpose - cmd mis-parses it there.
set /a PORT=4172
:findport
set /a PORT+=1
if !PORT! GTR 4200 goto noport
REM  Two chained literal matches = AND. A single findstr with a space would be
REM  treated as OR and would match every LISTENING line.
netstat -ano | findstr /c:":!PORT! " | findstr /c:"LISTENING" >nul 2>nul
if not errorlevel 1 goto findport
goto gotport

:noport
echo   [!] No free port between 4173 and 4200.
echo.
pause
exit /b 1

:gotport

echo   URL  : http://localhost:!PORT!
echo.
echo   Close this window to stop the server.
echo.
echo   --------------------------------------------
echo.

REM Force offline mode: clear any inherited key and do NOT load .env,
REM so a configured key cannot leak into a live demo by accident.
set "GEMINI_API_KEY="

REM  ping is used as the delay rather than timeout, which refuses to run when
REM  stdin is redirected.
start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & start "" http://localhost:!PORT!"

node server.js --port !PORT!

echo.
echo   Server stopped.
echo.
pause
