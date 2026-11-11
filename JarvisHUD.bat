@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title J.A.R.V.I.S. Cortex OS v3.0 — Stark Obsidian Studio (Port 8766 ^<-^> Brain 8765)
cd /d "%~dp0"

set JARVIS_DEBUG=1
set JARVIS_HTTP_VERBOSE=1

echo ============================================================================
echo   J.A.R.V.I.S. CORTEX OS v3.0 x ANTIGRAVITY BRAIN v7.2 — WINDOWS LAUNCHER
echo   Jarvis Gateway: http://localhost:8766  ^|  Antigravity Brain: :8765
echo   Debug Mode:     FULL TRACE ENABLED     ^|  Log: logs\jarvis-debug.log
echo ============================================================================

where node >nul 2>nul
if errorlevel 1 (
  echo [AVISO] Node.js nao encontrado no PATH. A iniciar motor Python de reserva na porta 8766...
  powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 30;$i++){try{$r=Invoke-WebRequest -UseBasicParsing http://localhost:8766/api/health -TimeoutSec 1; if($r.StatusCode -eq 200){Start-Process 'http://localhost:8766'; break}}catch{}; Start-Sleep -Milliseconds 500}"
  set PORT=8766
  python app.py
  pause
  exit /b 0
)

if not exist "node_modules\.bin\tsx.cmd" (
  echo [1/3] A instalar dependencias Node.js / React 19 / Three.js...
  call npm install
) else if not exist "node_modules\three\package.json" (
  echo [1/3] A atualizar dependencias do painel v3.0...
  call npm install
) else (
  echo [1/3] Dependencias Node.js verificadas.
)

echo [2/3] A aguardar arranque da porta 8766 para abrir o navegador automaticamente...
start "" powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){try{$r=Invoke-WebRequest -UseBasicParsing http://localhost:8766/api/health -TimeoutSec 1; if($r.StatusCode -eq 200){Start-Process 'http://localhost:8766'; break}}catch{}; Start-Sleep -Milliseconds 500}"

echo [3/3] A iniciar J.A.R.V.I.S. Cortex OS v3.0 [FULL DEBUG] em http://localhost:8766 ...
call npx tsx server.ts --port 8766
pause
