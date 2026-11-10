#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${JARVIS_PORT:-8766}"
echo "============================================================================"
echo "  J.A.R.V.I.S. CORTEX OS v2.0 — LINUX / MACOS LAUNCHER"
echo "  Jarvis Gateway: http://127.0.0.1:${PORT}  |  Antigravity Brain: :8765"
echo "============================================================================"

if [ ! -d "node_modules" ]; then
  echo "[1/2] A instalar dependências Node.js..."
  npm install
fi

echo "[2/2] A iniciar J.A.R.V.I.S. Cortex OS v2.0 na porta ${PORT}..."
exec npx tsx server.ts --port "${PORT}"
