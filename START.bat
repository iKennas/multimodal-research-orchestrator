@echo off
setlocal enabledelayedexpansion
title Multimodal Research Orchestrator
cd /d "%~dp0"

echo.
echo   ============================================
echo    Multimodal Research Orchestrator
echo    SENG 456 - Agent Orchestration
echo   ============================================
echo.

REM --- Node.js present? -------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo   [!] Node.js was not found on this computer.
    echo.
    echo       Install it from https://nodejs.org
    echo       then run this file again.
    echo.
    pause
    exit /b 1
)

REM --- Node new enough? -------------------------------------------------
REM  --env-file-if-exists needs Node 20.6 or newer.
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if !NODEMAJOR! LSS 20 (
    echo   [!] Node.js !NODEMAJOR! is too old - version 20.6 or newer is required.
    echo       Update it from https://nodejs.org
    echo.
    pause
    exit /b 1
)

REM --- Dependencies installed? -----------------------------------------
if not exist "node_modules\" (
    echo   First run - installing dependencies. This takes a moment...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo   [!] npm install failed. Check your internet connection.
        echo.
        pause
        exit /b 1
    )
    echo.
)

REM --- Find a free port so a second copy never collides -------------------
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

REM --- Report which mode we are about to start in ------------------------
if exist ".env" (
    echo   Mode : LIVE  - .env found (Groq or Gemini)
) else (
    echo   Mode : OFFLINE MOCK - no .env, no API key needed
)
echo   URL  : http://localhost:!PORT!
echo.
echo   The browser opens automatically in a few seconds.
echo   Close this window to stop the server.
echo.
echo   --------------------------------------------
echo.

REM Open the browser shortly after, while the server starts in this window.
REM  ping is used as the delay rather than timeout, which refuses to run when
REM  stdin is redirected.
start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & start "" http://localhost:!PORT!"

node --env-file-if-exists=.env server.js --port !PORT!

REM --- Only reached once the server exits --------------------------------
echo.
echo   Server stopped.
echo.
pause
