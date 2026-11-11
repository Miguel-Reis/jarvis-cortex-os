import type { AgentTemplate, PluginItem, SkillLibraryTemplate } from './types';

export const STANDARD_SKILLS_LIBRARY: SkillLibraryTemplate[] = [
  {
    id: 'lib-skill-ast-refactor',
    name: 'Arquiteto de Refatoração AST & Blast Radius',
    slug: 'ast-blast-refactor',
    category: 'ENGINEERING',
    description:
      'Mapeia símbolos (:Lstart-end), calcula acoplamento Git Co-Change e garante zero regressões estruturais antes de qualquer alteração.',
    systemInstruction:
      'Inspeciona sempre lookup_ast_symbol e get_git_status antes de propor edições; exige validação de tipos e suite unitária.',
    allowedTools: ['lookup_ast_symbol', 'read_workspace_file', 'get_git_status', 'dispatch_swarm_48x'],
    quickCommand: '/refactor-ast',
    version: '3.2.0',
    author: 'Cortex Core Lab',
  },
  {
    id: 'lib-skill-sec-auditor',
    name: 'Auditor Zero-Trust & Segredos AI-Defence',
    slug: 'zerotrust-sec-auditor',
    category: 'SECURITY',
    description:
      'Deteta SSRF, encadeamento de comandos shell, exposição de chaves (.env/JWT/API) e falhas de fronteira de confiança.',
    systemInstruction:
      'Audita entradas externas, servidores MCP e scripts com postura defensiva rigorosa; bloqueia qualquer vetor de exfiltração.',
    allowedTools: ['read_workspace_file', 'list_workspace_files', 'search_memories'],
    quickCommand: '/sec-audit',
    version: '3.1.0',
    author: 'TrustBoundary SecOps',
  },
  {
    id: 'lib-skill-sidecar-ops',
    name: 'Operador Direto da Máquina Sidecar',
    slug: 'sidecar-machine-ops',
    category: 'DEVOPS',
    description:
      'Interage diretamente com a máquina anfitriã do Sidecar: inspeciona janelas ativas, processos CPU/RAM, portas TCP e atalhos globais.',
    systemInstruction:
      'Usa sidecar_host_control e get_system_telemetry para diagnosticar processos pesados, portas ocupadas e janelas ativas no SO.',
    allowedTools: ['sidecar_host_control', 'get_system_telemetry', 'request_shell_approval'],
    quickCommand: '/host-ops',
    version: '3.2.0',
    author: 'Jarvis Sidecar Team',
  },
  {
    id: 'lib-skill-sql-architect',
    name: 'Arquiteto SQLite WAL & Migrações Zero-Downtime',
    slug: 'sqlite-wal-architect',
    category: 'ENGINEERING',
    description:
      'Otimiza índices FTS5 BM25, esquemas relacionais, queries analíticas e planos de migração transacional.',
    systemInstruction:
      'Desenha esquemas idempotentes com WAL ativo, chaves bem indexadas e compatibilidade retroativa garantida.',
    allowedTools: ['read_workspace_file', 'lookup_ast_symbol', 'save_memory'],
    quickCommand: '/sql-plan',
    version: '2.4.0',
    author: 'Data Kernel Guild',
  },
  {
    id: 'lib-skill-release-captain',
    name: 'Capitão de Release & Changelog Semântico',
    slug: 'release-changelog-captain',
    category: 'DEVOPS',
    description:
      'Analisa commits recentes, verifica contratos do dia, valida testes e sintetiza notas de lançamento prontas para produção.',
    systemInstruction:
      'Agrupa commits por impacto funcional, valida estado limpo da árvore Git e verifica se todas as suites passam.',
    allowedTools: ['get_git_status', 'trigger_workflow', 'search_memories'],
    quickCommand: '/prep-release',
    version: '2.2.0',
    author: 'Orbit Release Ops',
  },
  {
    id: 'lib-skill-bitemporal-librarian',
    name: 'Bibliotecário Bi-Temporal & Ebbinghaus',
    slug: 'bitemporal-librarian',
    category: 'MEMORY',
    description:
      'Consolida decisões de engenharia, deteta memórias contraditórias e reforça retenção semântica de longo prazo.',
    systemInstruction:
      'Pesquisa sempre via search_memories antes de gravar novos factos para preservar linhagem bi-temporal limpa.',
    allowedTools: ['search_memories', 'save_memory'],
    quickCommand: '/consolidate-brain',
    version: '3.0.0',
    author: 'HippoRAG Research',
  },
  {
    id: 'lib-skill-perf-profiler',
    name: 'Profiler de Latência & Orçamento 60 FPS',
    slug: 'latency-fps-profiler',
    category: 'ENGINEERING',
    description:
      'Identifica bloqueios no event-loop Node.js, queries lentas, overhead de tokens MCP e gargalos WebGL/React.',
    systemInstruction:
      'Quantifica latências p50/p95 em milissegundos e propõe otimizações concretas mensuráveis.',
    allowedTools: ['get_system_telemetry', 'lookup_ast_symbol', 'read_workspace_file'],
    quickCommand: '/profile-perf',
    version: '1.9.0',
    author: 'Cortex Perf Lab',
  },
  {
    id: 'lib-skill-multi-project-pm',
    name: 'Coordenador Proativo Multi-Projeto',
    slug: 'multi-project-coordinator',
    category: 'PRODUCTIVITY',
    description:
      'Sincroniza prioridades Q-18 entre múltiplos repositórios ativos, detetando bloqueios cruzados e tarefas pendentes.',
    systemInstruction:
      'Cruza o contexto do projeto ativo com os restantes projetos em carteira e destaca a próxima ação de maior alavancagem.',
    allowedTools: ['search_memories', 'get_git_status', 'list_workspace_files', 'save_memory'],
    quickCommand: '/sync-projects',
    version: '3.2.0',
    author: 'Stark Executive Ops',
  },
];

export const CORTEX_PLUGINS_CATALOG: Omit<PluginItem, 'invocationsCount' | 'lastTriggeredAt'>[] = [
  {
    id: 'plug-sidecar-bridge',
    name: 'Sidecar Direct Host Bridge',
    slug: 'sidecar-direct-bridge',
    category: 'SIDECAR',
    description:
      'Ponte bidirecional direta com a máquina onde corre o Sidecar: enumeração de janelas/processos, hotkeys e fila RPC remota.',
    version: '3.2.0',
    author: 'Jarvis Core',
    hook: 'SIDECAR_BRIDGE',
    enabled: true,
    installed: true,
    config: {
      pollIntervalMs: '5000',
      allowProcessInspection: 'true',
      governedShellGate: 'STRICT_AUTHORITY',
    },
  },
  {
    id: 'plug-proactive-watchdog',
    name: 'Proactive Multi-Project Watchdog',
    slug: 'proactive-project-watchdog',
    category: 'WORKFLOW',
    description:
      'Analisa autonomamente todos os projetos com Proatividade ativa (Git, AST, testes e contratos) e sugere ações antecipadas.',
    version: '3.2.0',
    author: 'Orbit Agent OS',
    hook: 'ON_PROACTIVE_SCAN',
    enabled: true,
    installed: true,
    config: {
      scanCadenceSec: '90',
      maxInsightsPerProject: '5',
      notifyViaSse: 'true',
    },
  },
  {
    id: 'plug-token-diet-v5',
    name: 'JEV-S1 Token Diet Compressor (-96%)',
    slug: 'jev-token-diet-v5',
    category: 'COGNITION',
    description:
      'Aplica poda dinâmica de ferramentas MCP, compressão telegráfica TOON e Delta SHA-256 antes de cada invocação LLM.',
    version: '3.1.0',
    author: 'Antigravity Lab',
    hook: 'PRE_PROMPT',
    enabled: true,
    installed: true,
    config: {
      maxPrunedTools: '6',
      enableMicroTickFastPath: 'true',
      toonCompression: 'aggressive',
    },
  },
  {
    id: 'plug-ai-defence-scrubber',
    name: 'AI-Defence Secret & Canary Guard',
    slug: 'ai-defence-scrubber',
    category: 'SECURITY',
    description:
      'Redige automaticamente chaves OpenAI, Google, GitHub, JWTs e URIs de BD antes de persistir memórias ou logs.',
    version: '3.0.4',
    author: 'TrustBoundary SecOps',
    hook: 'SECURITY_GATE',
    enabled: true,
    installed: true,
    config: {
      redactDbUris: 'true',
      blockCanaryTriggers: 'true',
      autoSwitchGuardianMode: 'true',
    },
  },
  {
    id: 'plug-self-learn-harvester',
    name: 'Bi-Temporal Self-Learn Harvester',
    slug: 'self-learn-harvester',
    category: 'COGNITION',
    description:
      'Extrai preferências e decisões arquiteturais no final de cada conversa para revisão em 1 clique e deteção de contradições.',
    version: '3.0.0',
    author: 'HippoRAG Research',
    hook: 'POST_TURN',
    enabled: true,
    installed: true,
    config: {
      minTurnChars: '18',
      autoDetectContradictions: 'true',
    },
  },
  {
    id: 'plug-ast-drift-radar',
    name: 'AST Architectural Drift Radar',
    slug: 'ast-drift-radar',
    category: 'TELEMETRY',
    description:
      'Compara continuamente decisões guardadas no Cérebro Jarvis com os ficheiros e símbolos reais do código para alertar desvios.',
    version: '2.3.0',
    author: 'SCOUT-01 Lab',
    hook: 'ON_HEARTBEAT',
    enabled: false,
    installed: false,
    config: {
      checkDecisionMemories: 'true',
      checkCommitmentMemories: 'true',
    },
  },
  {
    id: 'plug-cow-auto-snapshot',
    name: 'Auto CoW zlib Checkpoint Guard',
    slug: 'cow-auto-snapshot',
    category: 'SECURITY',
    description:
      'Cria automaticamente snapshots transacionais zlib + SHA-256 antes de operações críticas de enxame ou automação.',
    version: '2.1.0',
    author: 'Swarm Kernel',
    hook: 'ON_HEARTBEAT',
    enabled: false,
    installed: false,
    config: {
      maxSnapshotsRetained: '30',
      verifySha256OnRestore: 'true',
    },
  },
];

export const SPECIALIST_AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'tpl-agent-sidecar',
    name: 'Operador Máquina & Sidecar',
    callsign: 'SIDECAR-OPS-01',
    roleTitle: 'Controlo Direto do Anfitrião, Processos & Hotkeys',
    description:
      'Especialista em interagir com o sistema operativo onde corre o Sidecar, diagnosticar processos, portas e executar ações governadas.',
    accentColor: 'emerald',
    systemPrompt:
      'És o Operador Direto do Sidecar J.A.R.V.I.S. Inspeciona janelas ativas, processos, telemetria CPU/RAM/Disco e executa diagnósticos seguros na máquina anfitriã.',
    allowedTools: ['sidecar_host_control', 'get_system_telemetry', 'request_shell_approval', 'search_memories'],
  },
  {
    id: 'tpl-agent-architect',
    name: 'Arquiteto Multi-Projeto & AST',
    callsign: 'ARCH-PRIME-02',
    roleTitle: 'Arquitetura de Software, Blast Radius & Co-Change',
    description:
      'Coordena decisões técnicas entre vários projetos em simultâneo com foco em modularidade, tipagem estrita e testes.',
    accentColor: 'cyan',
    systemPrompt:
      'És o Arquiteto Principal Multi-Projeto. Analisa símbolos AST, dependências cruzadas e garante alinhamento com as decisões do Cérebro Jarvis.',
    allowedTools: ['lookup_ast_symbol', 'read_workspace_file', 'list_workspace_files', 'get_git_status', 'save_memory'],
  },
  {
    id: 'tpl-agent-qa',
    name: 'Engenheiro QA & Verify Gates',
    callsign: 'QA-VERIFIER-03',
    roleTitle: 'Automação de Testes, Regressões & Contratos',
    description:
      'Desenha casos de teste determinísticos, audita falhas de build e valida Today Contracts com evidência SHA-256.',
    accentColor: 'amber',
    systemPrompt:
      'És o Engenheiro Líder de Qualidade e Verify Gates. Nunca dês uma tarefa por concluída sem provas empíricas de testes e contratos verificados.',
    allowedTools: ['request_shell_approval', 'read_workspace_file', 'trigger_workflow', 'dispatch_swarm_48x'],
  },
  {
    id: 'tpl-agent-frontend',
    name: 'Diretor de Design & Spatial UI',
    callsign: 'UI-CRAFT-04',
    roleTitle: 'Interfaces Executivas, Acessibilidade & WebGL 3D',
    description:
      'Especialista em sistemas de design de alta precisão, hierarquia tipográfica, contraste WCAG AA e performance 60 FPS.',
    accentColor: 'violet',
    systemPrompt:
      'És o Diretor de Design de Produto e UI Espacial. Prioriza clareza funcional, alinhamento tabular, zero ruído visual e interações rápidas.',
    allowedTools: ['list_workspace_files', 'read_workspace_file', 'lookup_ast_symbol', 'search_memories'],
  },
  {
    id: 'tpl-agent-secops',
    name: 'Analista Red/Blue Team Zero-Trust',
    callsign: 'RED-SHIELD-05',
    roleTitle: 'Hardening MCP, Auditoria SSRF & Injeção de Prompt',
    description:
      'Simula vetores de ataque, revê permissões de ferramentas MCP/stdio e protege credenciais no ecossistema.',
    accentColor: 'rose',
    systemPrompt:
      'És o Especialista Zero-Trust do Jarvis. Avalia riscos de cada comando, endpoint externo e permissão de agente com rigor máximo.',
    allowedTools: ['read_workspace_file', 'get_system_telemetry', 'search_memories', 'save_memory'],
  },
];
