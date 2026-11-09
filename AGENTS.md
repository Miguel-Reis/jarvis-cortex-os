# AGENTS.md — J.A.R.V.I.S. Cortex OS Workspace Rules

## 1. Architecture & Zero-Dependency Principle
- **J.A.R.V.I.S. Cortex OS** (`jarvis_os/`) is a 100% local, deterministic, zero-Ollama cognitive & workflow operating system written in Python 3.11+.
- Keep core modules in `jarvis_os/` free of heavy external dependencies so startup latency remains `<15ms` and VRAM usage remains `0 GB`.

## 2. Core Modules Map
- `jarvis_os/core/telemetry.py`: Windows Kernel32 `GlobalMemoryStatusEx`, Disk NVMe & TCP Port Radar.
- `jarvis_os/memory/synaptic_db.py`: SQLite WAL + FTS5 BM25 + 128-D LSH SimHash + HippoRAG 2 Personalized PageRank (PPR) + SHA-256 Provenance Gate.
- `jarvis_os/planning/next_action.py`: Deterministic Q-18 Next-Action Planner (`plan_next_action`).
- `jarvis_os/planning/today_contract.py`: Today Work-Items with cryptographic/execution Outcome Verification Gate (`TodayContractGate`).
- `jarvis_os/intelligence/personality.py`: SQLite Adaptive Personality Engine (`PersonalityEngine`).
- `jarvis_os/intelligence/vault_extractor.py`: Entity, Fact & Commitment Extractor with Provenance Gate (`VaultExtractor`).
- `jarvis_os/intelligence/routine_discovery.py`: Evidence-Backed Routine Discovery (`routine-cues-v2`).
- `jarvis_os/security/trust_boundary.py`: Authority-Aware Tool Relevance & Prompt-Injection Canary (`TrustBoundaryGate`).
- `jarvis_os/voice/mark_vii_tts.py`: Skywalker Sound Mark-VII Helmet HUD Acoustic Synthesizer (`MarkVIISpeechSynthesizer`).
- `jarvis_os/cli.py`: Unified CLI entrypoint.

## 3. Verification Before Completion
- Always run `python -m unittest discover -s tests -v` before committing or pushing to `origin/main`.
- Always respond to the user in **European Portuguese (PT-PT)**.
