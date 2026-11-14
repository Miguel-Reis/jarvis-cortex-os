@echo off
chcp 65001 >nul
setlocal
title J.A.R.V.I.S. Cortex OS v4.0 - Stark Obsidian Studio [Port 8766]
cd /d "%~dp0"

set JARVIS_DEBUG=1
set JARVIS_HTTP_VERBOSE=1

echo ============================================================================
echo   J.A.R.V.I.S. CORTEX OS v4.0 x ANTIGRAVITY BRAIN v7.2 - WINDOWS LAUNCHER
echo   Jarvis Gateway: http://localhost:8766  ^|  Antigravity Brain: :8765
echo   Debug Mode:     FULL TRACE ENABLED     ^|  Log: logs\jarvis-debug.log
echo ============================================================================

powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 8766 -State Listen -ErrorAction SilentlyContinue; if ($c) { foreach ($p in ($c.OwningProcess | Select-Object -Unique)) { if ($p -gt 0) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } } }" >nul 2>nul

if not exist ".git" goto :skip_git
where git >nul 2>nul
if errorlevel 1 goto :skip_git
echo [0/3] A sincronizar automaticamente com GitHub [origin/main]...
git rebase --abort >nul 2>nul
git merge --abort >nul 2>nul
git fetch origin main
if not errorlevel 1 (
  git reset --hard origin/main
)
:skip_git

where node >nul 2>nul
if not errorlevel 1 goto :node_ready
echo [AVISO] Node.js nao encontrado no PATH. A iniciar motor Python de reserva na porta 8766...
start "" powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 30;$i++){try{$r=Invoke-WebRequest -UseBasicParsing http://localhost:8766/api/health -TimeoutSec 1; if($r.StatusCode -eq 200){Start-Process 'http://localhost:8766'; break}}catch{}; Start-Sleep -Milliseconds 500}"
set PORT=8766
python app.py
pause
exit /b 0

:node_ready
set NEED_NPM_INSTALL=0
if not exist "node_modules\.bin\tsx.cmd" set NEED_NPM_INSTALL=1
if not exist "node_modules\three\package.json" set NEED_NPM_INSTALL=1
if not exist "node_modules\ws\package.json" set NEED_NPM_INSTALL=1
if not exist "node_modules\vite-plugin-pwa\package.json" set NEED_NPM_INSTALL=1

if "%NEED_NPM_INSTALL%"=="1" (
  echo [1/3] A instalar/atualizar dependencias Node.js do J.A.R.V.I.S. v4.0...
  call npm install --no-audit --no-fund
) else (
  echo [1/3] Dependencias Node.js v4.0 verificadas.
)

echo [2/3] A aguardar arranque da porta 8766 para abrir o navegador automaticamente...
start "" powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){try{$r=Invoke-WebRequest -UseBasicParsing http://localhost:8766/api/health -TimeoutSec 1; if($r.StatusCode -eq 200){Start-Process 'http://localhost:8766'; break}}catch{}; Start-Sleep -Milliseconds 500}"

echo [3/3] A iniciar J.A.R.V.I.S. Cortex OS v4.0 [FULL DEBUG] em http://localhost:8766 ...
call npx tsx server.ts --port 8766
pause
