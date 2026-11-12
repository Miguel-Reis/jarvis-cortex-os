#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${JARVIS_PORT:-8766}"
export JARVIS_DEBUG="${JARVIS_DEBUG:-1}"
export JARVIS_HTTP_VERBOSE="${JARVIS_HTTP_VERBOSE:-1}"

echo "============================================================================"
echo "  J.A.R.V.I.S. CORTEX OS v3.0 — LINUX / MACOS LAUNCHER [FULL DEBUG]"
echo "  Jarvis Gateway: http://127.0.0.1:${PORT}  |  Antigravity Brain: :8765"
echo "  Debug Log File: logs/jarvis-debug.log"
echo "============================================================================"

if [ -d ".git" ] && command -v git >/dev/null 2>&1; then
  echo "[0/2] A sincronizar automaticamente com GitHub (origin/main)..."
  git pull --rebase --autostash origin main || true
fi

if [ ! -x "node_modules/.bin/tsx" ] || [ ! -f "node_modules/three/package.json" ]; then
  echo "[1/2] A instalar/atualizar dependências Node.js..."
  npm install
fi

echo "[2/2] A iniciar J.A.R.V.I.S. Cortex OS v3.0 [DEBUG=${JARVIS_DEBUG}] na porta ${PORT}..."
exec npx tsx server.ts --port "${PORT}"
