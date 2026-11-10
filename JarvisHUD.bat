@echo off
title J.A.R.V.I.S. Cortex OS — Mark-VII HUD (Port 8766 ^<-^> Brain Port 8765)
cd /d "%~dp0"
echo ========================================================================
echo   J.A.R.V.I.S. CORTEX OS — MARK-VII HUD LAUNCHER
echo   Jarvis Port: 8766  ^|  Antigravity Brain Bridge: 8765
echo ========================================================================
git pull origin main
python jarvis_app.py --port 8766 --brain-url http://127.0.0.1:8765 --open
pause
