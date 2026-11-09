# 🤖 J.A.R.V.I.S. Cortex OS — Master Architecture & Evolution Blueprint

> **Repositório GitHub**: [`https://github.com/Miguel-Reis/jarvis-cortex-os`](https://github.com/Miguel-Reis/jarvis-cortex-os)  
> **Pasta do Projeto (Workspace)**: `C:\Users\guels\Desktop\jarvis-cortex-os`  
> **Modo de Motor**: `ANTIGRAVITY_NATIVE_ZERO_OLLAMA` (100% Local · 0 GB VRAM · Python 3.11+ Stdlib + WebAudio Mark-VII DSP)

---

## 1. Visão Geral do Projeto

O **J.A.R.V.I.S. Cortex OS** é um sistema operativo cognitivo e orquestrador de workflows autónomo que funde:
1. **Memória Sináptica Zero-Ollama (`SynapticDB`)**: SQLite WAL + FTS5 BM25 + Vetores Semânticos 128-D LSH + Difusão em Grafo **HippoRAG 2 Personalized PageRank (PPR)** + **Provenance Gate** (`confirmed` vs `inferred`).
2. **Os 6 Motores Enterprise Determinísticos (inspirados em `@usejarvis/brain`)**:
   - **`NextActionPlanner (Q-18)`**: Função pura determinística que calcula a **1 única ação de maior impacto** neste momento (`Score = (Impact × Urgency × Authority) / ((Effort + 0.1) × (1 + Risk × 0.2))`), cruzando bloqueios DAG, alertas AST e prazos sem gastar tokens de LLM.
   - **`TodayContractGate`**: Contrato diário de `WorkItems` onde aceitar uma tarefa não conta como progresso — apenas **Outcomes Verificados com Prova Criptográfica/Execução** (`TEST_PASS`, `FILE_EXISTS`, `CHECKSUM_MATCH`, `EXECUTIVE_SIGN`) avançam a meta do dia.
   - **`PersonalityEngine`**: Vetor dinâmico persistido em SQLite (`formality`, `conciseness`, `proactivity`, `technical_depth`, `trust_score`) que evolui automaticamente por EMA a partir de sinais nas mensagens do utilizador (`STARK_EXECUTIVE`, `TACTICAL_ENGINEER`, `WAR_ROOM_CONCISE`, `GUARDIAN_DEFENSE`).
   - **`VaultExtractor`**: Extrator de Entidades, Factos e Compromissos (`Commitments`) com **Provenance Gate** (inferências nunca sobrescrevem factos confirmados pelo utilizador).
   - **`RoutineDiscoveryEngine (routine-cues-v2)`**: Detetor de episódios recorrentes (`Source ➔ Operation ➔ Output` em janelas de 30 min) que transforma padrões repetidos em automações de 1 clique.
   - **`TrustBoundaryGate`**: Fronteiras de autoridade (`READ_ONLY`, `OPERATIONAL`, `EXECUTIVE`, `DANGEROUS`), Pinning de Ferramentas de Segurança e Canários Anti-Prompt-Injection.
3. **Voz Cinematográfica Mark-VII HUD (`MarkVIISpeechSynthesizer`)**:
   - Pipeline acústico modelado no efeito da **Skywalker Sound (*Iron Man*)**: WSOLA Baritone Formant Shifter + Filtro de Visor de Titânio (`2900 Hz`) + Duplo Micro-Chorus Holográfico em Quadratura (`5.8 ms` / `11.2 ms`) + Reflexão Interna de Capacete (`17.5 ms`).

---

## 2. Estrutura Modular do Repositório

```text
C:\Users\guels\Desktop\jarvis-cortex-os\
├── .git/                           # Ligado a https://github.com/Miguel-Reis/jarvis-cortex-os.git
├── pyproject.toml                  # Configuração de pacote Python 3.11+ (zero dependências externas)
├── README.md                       # Documentação executiva bilingue (PT/EN) + Diagramas Mermaid
├── JARVIS_OS_BLUEPRINT.md          # Este documento de arquitetura e roadmap
├── AGENTS.md                       # Regras automáticas para o Antigravity IDE neste workspace
├── jarvis_os/
│   ├── __init__.py
│   ├── cli.py                      # CLI (`status | plan | briefing | memory | routine | serve | sidecar | workflow`)
│   ├── core/
│   │   └── telemetry.py            # Windows Kernel32 GlobalMemoryStatusEx + NVMe Disk + Port Radar
│   ├── memory/
│   │   └── synaptic_db.py          # SQLite WAL + FTS5 BM25 + 128-D LSH + HippoRAG 2 PPR + Provenance Gate
│   ├── planning/
│   │   ├── next_action.py          # Deterministic Next-Action Planner (Protocolo Q-18)
│   │   └── today_contract.py       # Today Work-Items & Verified Outcome Gate
│   ├── intelligence/
│   │   ├── personality.py          # SQLite Adaptive Personality Engine & Signal Detector
│   │   ├── vault_extractor.py      # Entity, Fact & Commitment Extractor com Provenance Gate
│   │   └── routine_discovery.py    # Evidence-Backed Routine Discovery (routine-cues-v2)
│   ├── security/
│   │   └── trust_boundary.py       # Authority-Aware Tool Relevance & Prompt-Injection Canary
│   ├── voice/
│   │   └── mark_vii_tts.py         # Skywalker Sound Mark-VII Helmet DSP + Neural/SAPI Streamer
│   ├── server/
│   │   └── http_sse.py             # Servidor HTTP/SSE Real-Time + Pipeline Cognitivo Unificado
│   ├── ui/
│   │   └── dashboard.html          # Dashboard HUD Mark-VII 60 FPS + Orbe FFT + WebAudio DSP + Wake-Word
│   ├── sidecar/
│   │   └── desktop_agent.py        # Sidecar Desktop (EnumWindows/POSIX, Hotkeys, Clipboard Guard, WakeWord)
│   └── workflows/
│       └── engine.py               # AST Static Analyzer + Git Workspace Inspector + Live Test Gate
└── tests/
    └── test_jarvis_os.py           # Suite de testes unitários (13/13 PASS em <0.1s)
```

---

## 3. Comandos Rápidos de Verificação

```powershell
cd C:\Users\guels\Desktop\jarvis-cortex-os

# 1. Correr a suite completa de testes unitários (13/13 PASS)
python -m unittest discover -s tests -v

# 2. Executar o Briefing Executivo Matinal na CLI
python -m jarvis_os.cli briefing --lang pt

# 3. Ver Telemetria Windows Kernel32 + Port Radar
python -m jarvis_os.cli status

# 4. Calcular a Próxima Ação Determinística (Q-18)
python -m jarvis_os.cli plan

# 5. Inspecionar Sidecar Desktop, Janelas e Hotkeys
python -m jarvis_os.cli sidecar

# 6. Executar Workflow Autónomo & Gate de Testes
python -m jarvis_os.cli workflow

# 7. Iniciar o Servidor HTTP/SSE + Dashboard Dedicado Mark-VII HUD
python -m jarvis_os.cli serve --port 8765
```

---

## 4. Roadmap de Evolução ("Próximos Passos A Sério" no Novo Workspace)

- ✅ **Fase 1 (Concluída) — Servidor HTTP/SSE + Dashboard Dedicado (`jarvis_os/server/` & `jarvis_os/ui/`)**:
  - Servidor HTTP/SSE multithreaded zero-dependências dedicado ao **J.A.R.V.I.S. Cortex OS** com stream SSE em tempo real (`/api/events`), Orbe 60 FPS com FFT WebAudio real e consola de voz contínua (Wake-Word `"Hey Jarvis"`).
- ✅ **Fase 2 (Concluída) — Sidecar de Automação Desktop (`jarvis_os/sidecar/`)**:
  - Inspirado no `@usejarvis/sidecar`: enumeração de janelas (`EnumWindows` / `/proc`), inspeção de clipboard com `TrustBoundaryGate`, atalhos globais (`Alt+Space`, `Ctrl+Shift+J`, `Ctrl+Shift+P`, `Ctrl+Shift+G`) e `WakeWordDetector`.
- ✅ **Fase 3 (Concluída) — Conetores de Workflow & Git/CI (`jarvis_os/workflows/`)**:
  - Execução automática de pipelines de código (`analyze_python_ast`, `inspect_git_workspace`, `run_unit_test_gate`) interligados diretamente com o `TodayContractGate`.

---

## 5. Super-Prompt de Arranque (Cola no Antigravity ao abrir a pasta)

```text
Estamos no novo workspace dedicado `C:\Users\guels\Desktop\jarvis-cortex-os` (ligado a `github.com/Miguel-Reis/jarvis-cortex-os`).
Lê o `JARVIS_OS_BLUEPRINT.md` e `AGENTS.md`, corre `python -m unittest discover -s tests` para confirmar que os 10 módulos base estão a 100%, e vamos construir a Fase 1 (Servidor HTTP/SSE + Dashboard Dedicado Jarvis Cortex OS com Orbe Mark-VII 60 FPS, Wake-Word e Sidecar Windows) usando um Enxame Assimétrico!
```
