@echo off
chcp 65001 >nul
title J.A.R.V.I.S. Cortex OS v2.0 — Stark Obsidian Studio (Port 8766 ^<-^> Brain 8765)
cd /d "%~dp0"
echo ============================================================================
echo   J.A.R.V.I.S. CORTEX OS v2.0 — WINDOWS LOCAL LAUNCHER
echo   Jarvis Gateway: http://127.0.0.1:8766  ^|  Antigravity Brain: :8765
echo ============================================================================
if not exist "node_modules" (
  echo [1/2] A instalar dependencias Node.js...
  call npm install
)
echo [2/2] A iniciar J.A.R.V.I.S. Cortex OS v2.0 na porta 8766...
start "" "http://127.0.0.1:8766"
call npx tsx server.ts --port 8766
pause
