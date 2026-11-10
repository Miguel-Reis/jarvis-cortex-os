import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import {
  compressFactTelegraphic,
  computeBinaryQuantization128,
  computeSimHash128,
} from '../shared/cortex-math.ts';
import {
  buildDefaultMcpRegistryResources,
  buildDefaultMcpRegistryTools,
  buildSeedMcpServers,
} from '../shared/mcp-catalog.ts';
import type { JarvisStoreData, MemoryItem, SwarmLane, SwarmTask } from '../shared/types.ts';

const require = createRequire(import.meta.url);

interface SqliteStatementLike {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): unknown;
}

interface SqliteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementLike;
  close(): void;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SQLITE_PATH = path.join(DATA_DIR, 'jarvis-v2.sqlite');
const JSON_FALLBACK_PATH = path.join(DATA_DIR, 'jarvis-store.json');

function buildInitialSwarmTasks(nowIso: string): SwarmTask[] {
  const lanes: SwarmLane[] = ['UI', 'API', 'TESTS', 'DOCS'];
  const callsigns: Record<SwarmLane, string[]> = {
    UI: ['UI-ARCHITECT-01', 'THREE-SPATIAL-02', 'MOTION-HUD-03'],
    API: ['API-GATEWAY-01', 'MCP-BRIDGE-02', 'SQLITE-WAL-03'],
    TESTS: ['QA-SENTINEL-01', 'CANARY-AUDIT-02', 'UNIT-RUNNER-03'],
    DOCS: ['SCOUT-01', 'GRAPH-SCRIBE-02', 'TOON-FORGE-03'],
  };
  const files: Record<SwarmLane, string[]> = {
    UI: ['src/components/SwarmOffice3D.tsx', 'src/components/views/SwarmView.tsx', 'src/App.tsx'],
    API: ['server.ts', 'src/server/mcp-server.ts', 'src/server/swarm-orbit-engine.ts'],
    TESTS: ['src/shared/cortex-math.test.ts', 'tests/test_jarvis_os.py'],
    DOCS: ['AGENTS.md', 'src/shared/types.ts', 'src/shared/cortex-math.ts'],
  };

  const tasks: SwarmTask[] = [];
  let ema = 0.89;
  for (let l = 0; l < lanes.length; l++) {
    const lane = lanes[l];
    for (let i = 0; i < 12; i++) {
      ema = Number((0.75 * ema + 0.25 * (0.92 + ((i + l) % 4) * 0.02)).toFixed(3));
      const targetFile = files[lane][i % files[lane].length];
      tasks.push({
        id: `swarm-seed-${lane.toLowerCase()}-${String(i + 1).padStart(2, '0')}`,
        lane,
        agentCallsign: callsigns[lane][i % callsigns[lane].length],
        title: `[${lane} #${i + 1}] Verificar ${targetFile.split('/').pop()}`,
        targetFile,
        status: 'VERIFIED',
        pheromoneScore: ema,
        verify1: {
          passed: true,
          checkedAt: nowIso,
          summary: 'AST :Lstart-end & Blast Radius aprovados',
          evidenceHash: `v1-${lane.toLowerCase()}-${100 + i}`,
        },
        verify2: {
          passed: true,
          checkedAt: nowIso,
          summary: 'Testes verdes · 0 segredos AI-Defence',
          evidenceHash: `v2-${lane.toLowerCase()}-${200 + i}`,
        },
        durationMs: 16 + ((i * 5 + l * 3) % 28),
      });
    }
  }
  return tasks;
}

function buildInitialSeed(): JarvisStoreData {
  const nowIso = new Date().toISOString();
  const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString();
  const osType: 'WINDOWS' | 'LINUX' | 'MACOS' =
    process.platform === 'win32'
      ? 'WINDOWS'
      : process.platform === 'darwin'
        ? 'MACOS'
        : 'LINUX';

  const rawMemories = [
    {
      id: 'mem-core-01',
      topic: 'Arquitetura J.A.R.V.I.S. Cortex OS v3.0 × Antigravity v7.2',
      content:
        'Sistema Operativo Cognitivo unificado fundindo Swarm 48x Assimétrico, Roteador JEV-S1 (<1ms), Memória Bi-Temporal 4-Way RRF + Ebbinghaus, Escritório Espacial 3D e Ponte MCP 2026.',
      category: 'ENTITY' as const,
      provenance: 'CONFIRMED' as const,
      confidence: 0.99,
      tags: ['arquitetura', 'core', 'v3', 'swarm'],
      pinned: true,
      sourceUri: 'blueprint://server.ts',
      tier: 'SEMANTIC' as const,
      accessCount: 12,
      importance: 5,
      validFrom: nowIso,
      validUntil: null,
      supersededBy: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'mem-hipporag-02',
      topic: 'Fusão Híbrida 4-Way RRF (k=60) + 128-Bit BQ POPCNT',
      content:
        'Combina BM25 lexical, Quantização Binária 128-bit por sub-palavras morfológicas (<0.2ms), HippoRAG 2 PPR (alpha=0.85) e Curva de Esquecimento de Ebbinghaus.',
      category: 'FACT' as const,
      provenance: 'CONFIRMED' as const,
      confidence: 0.99,
      tags: ['memoria', 'hipporag', 'rrf', 'ebbinghaus'],
      pinned: true,
      sourceUri: 'blueprint://src/shared/cortex-math.ts',
      tier: 'SEMANTIC' as const,
      accessCount: 9,
      importance: 5,
      validFrom: nowIso,
      validUntil: null,
      supersededBy: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'mem-q18-03',
      topic: 'Fórmula Determinística Q-18 Next-Action',
      content:
        'Prioriza a ação executiva de maior alavancagem através de (Impacto × Urgência × Autoridade) / ((Esforço + 0.1) × (1 + 0.2 × Risco)).',
      category: 'DECISION' as const,
      provenance: 'CONFIRMED' as const,
      confidence: 0.97,
      tags: ['planeamento', 'q18', 'executivo'],
      pinned: false,
      sourceUri: 'blueprint://jarvis_os/planning/next_action.py',
      tier: 'SEMANTIC' as const,
      accessCount: 6,
      importance: 4,
      validFrom: nowIso,
      validUntil: null,
      supersededBy: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'mem-voice-04',
      topic: 'Acústica Skywalker Sound Mark-VII DSP',
      content:
        'Cadeia WebAudio com filtro passa-banda (320Hz–3800Hz), atraso comb metálico de 18.5ms simulando viseira de titânio e análise FFT a 60 FPS no Pebble Orb.',
      category: 'PREFERENCE' as const,
      provenance: 'CONFIRMED' as const,
      confidence: 0.96,
      tags: ['voz', 'dsp', 'pebble'],
      pinned: false,
      sourceUri: 'blueprint://src/lib/audio-dsp.ts',
      tier: 'EPISODIC' as const,
      accessCount: 4,
      importance: 3,
      validFrom: nowIso,
      validUntil: null,
      supersededBy: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'mem-openclaw-05',
      topic: 'Regra Owner Allow-List & Human Wins Hierarchy',
      content:
        'Canais externos sem allow-list são bloqueados automaticamente. Na frota Orbit e Swarm, qualquer diretiva do Operador assume prioridade HUMAN_WINS sobre subagentes.',
      category: 'COMMITMENT' as const,
      provenance: 'CONFIRMED' as const,
      confidence: 1.0,
      tags: ['seguranca', 'openclaw', 'orbit'],
      pinned: true,
      sourceUri: 'policy://trust-boundary',
      tier: 'SEMANTIC' as const,
      accessCount: 10,
      importance: 5,
      validFrom: nowIso,
      validUntil: null,
      supersededBy: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'mem-bridge-06',
      topic: 'Ponte Híbrida Antigravity Brain (:8766 ⇄ :8765 + MCP 2026)',
      content:
        'Executa todos os motores v7.2 nativamente em TypeScript e sincroniza via HTTP/SSE e WAL brain.db quando o daemon Antigravity Brain está online em 127.0.0.1:8765.',
      category: 'ENTITY' as const,
      provenance: 'CONFIRMED' as const,
      confidence: 0.98,
      tags: ['bridge', '8765', 'mcp-2026'],
      pinned: true,
      sourceUri: 'blueprint://src/server/swarm-orbit-engine.ts',
      tier: 'SEMANTIC' as const,
      accessCount: 8,
      importance: 5,
      validFrom: nowIso,
      validUntil: null,
      supersededBy: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'mem-pref-07',
      topic: 'Preferência Linguística e Estilo Operacional',
      content:
        'Comunicação predefinida em Português Europeu (PT-PT), tom executivo conciso, zero janelas bloqueantes e verificação empírica antes de concluir tarefas.',
      category: 'PREFERENCE' as const,
      provenance: 'CONFIRMED' as const,
      confidence: 0.99,
      tags: ['pt-pt', 'operador', 'ux'],
      pinned: false,
      sourceUri: 'operator://profile',
      tier: 'SEMANTIC' as const,
      accessCount: 7,
      importance: 4,
      validFrom: nowIso,
      validUntil: null,
      supersededBy: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'mem-infer-08',
      topic: 'Padrão Matinal de Auditoria CI & Git',
      content:
        'Inferido a partir do histórico: o operador executa testes unitários Python e verifica git status antes de iniciar sessões de engenharia.',
      category: 'FACT' as const,
      provenance: 'INFERRED' as const,
      confidence: 0.84,
      tags: ['rotina', 'ci', 'git'],
      pinned: false,
      sourceUri: 'routine-cues://v2',
      tier: 'WORKING' as const,
      accessCount: 2,
      importance: 3,
      validFrom: nowIso,
      validUntil: null,
      supersededBy: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'mem-superseded-09',
      topic: 'Arquitetura J.A.R.V.I.S. Cortex OS Legacy v1.0',
      content:
        'Versão legado de turno único sem enxame Swarm 48x nem quantização binária 128-bit (superada bi-temporalmente pela v3.0).',
      category: 'ENTITY' as const,
      provenance: 'CONFIRMED' as const,
      confidence: 0.9,
      tags: ['legacy', 'bitemporal-history'],
      pinned: false,
      sourceUri: 'history://v1',
      tier: 'EPISODIC' as const,
      accessCount: 1,
      importance: 2,
      validFrom: yesterdayIso,
      validUntil: nowIso,
      supersededBy: 'mem-core-01',
      createdAt: yesterdayIso,
      updatedAt: nowIso,
    },
  ];

  const memories = rawMemories.map((m) => ({
    ...m,
    lastAccessedAt: m.updatedAt,
    simHash: computeSimHash128(`${m.topic} ${m.content}`),
    bq128Hex: computeBinaryQuantization128(`${m.topic} ${m.content}`),
  }));

  const graphEdges = [
    { id: 'edge-1', source: 'mem-core-01', target: 'mem-hipporag-02', relation: 'USA_MEMORIA_RRF', weight: 1.0 },
    { id: 'edge-2', source: 'mem-core-01', target: 'mem-q18-03', relation: 'ORQUESTRA_PLANO', weight: 0.95 },
    { id: 'edge-3', source: 'mem-core-01', target: 'mem-voice-04', relation: 'SINTETIZA_VOZ', weight: 0.85 },
    { id: 'edge-4', source: 'mem-core-01', target: 'mem-openclaw-05', relation: 'PROTEGE_CANAIS', weight: 1.0 },
    { id: 'edge-5', source: 'mem-core-01', target: 'mem-bridge-06', relation: 'SINCRONIZA_COM', weight: 0.96 },
    { id: 'edge-6', source: 'mem-hipporag-02', target: 'mem-bridge-06', relation: 'REPLICA_GRAFO', weight: 0.9 },
    { id: 'edge-7', source: 'mem-q18-03', target: 'mem-infer-08', relation: 'PRIORIZA_ROTINA', weight: 0.82 },
    { id: 'edge-8', source: 'mem-pref-07', target: 'mem-voice-04', relation: 'CALIBRA_IDIOMA', weight: 0.78 },
    { id: 'edge-9', source: 'mem-openclaw-05', target: 'mem-q18-03', relation: 'GOVERNANCA_EXEC', weight: 0.86 },
    { id: 'edge-10', source: 'mem-core-01', target: 'mem-superseded-09', relation: 'SUPERSEDES', weight: 0.98 },
  ];

  const seedSwarmTasks = buildInitialSwarmTasks(nowIso);

  return {
    settings: {
      operatorName: 'Comandante',
      organizationName: 'Stark Obsidian Lab',
      language: 'pt-PT',
      personalityMode: 'STARK_EXECUTIVE',
      autonomyLevel: 'BALANCED_PROACTIVE',
      modelProvider: 'GEMINI_STUDIO',
      preferredGeminiModel: 'gemini-3.8-flash',
      ollamaEndpoint: 'http://127.0.0.1:11434',
      ollamaModel: 'qwen2.5-coder:7b',
      openRouterEndpoint: 'https://openrouter.ai/api/v1',
      openRouterModel: 'anthropic/claude-3.7-sonnet',
      antigravityBrainUrl: 'http://127.0.0.1:8765',
      alwaysApprovedCommands: [
        'git status --short',
        'git log -n 5 --oneline',
        'python3 -m unittest discover -s tests -v',
        'npx --yes tsx --test src/shared/cortex-math.test.ts',
        'node -v',
      ],
      onboardingCompleted: false,
      wakeWordEnabled: false,
      voiceDspEnabled: true,
      focusModeEnabled: false,
    },
    goals: [
      {
        id: 'goal-01',
        title: 'Convergência Swarm 48x & Persistência Zero-Falhas (Windows/Linux)',
        category: 'Enxame & Infraestrutura',
        progress: 96,
        targetMetric: '96/96 Verify Gates + CoW Sandboxes atómicas ativas',
        deadline: '2026-11-30',
        status: 'ACTIVE',
      },
      {
        id: 'goal-02',
        title: 'Eficiência Token Diet (-96% MCP Overhead) & JEV-S1 (<1ms)',
        category: 'Cognição & Orbit OS',
        progress: 91,
        targetMetric: 'Poda dinâmica de 18 tools para 4-6 tools por intenção',
        deadline: '2026-11-20',
        status: 'ACTIVE',
      },
      {
        id: 'goal-03',
        title: 'Segurança Zero-Trust OpenClaw & Redação AI-Defence',
        category: 'Cibersegurança',
        progress: 88,
        targetMetric: 'Owner Allow-List + 0 fugas de segredos em Self-Learn',
        deadline: '2026-11-15',
        status: 'ACTIVE',
      },
    ],
    contracts: [
      {
        id: 'contract-01',
        title: 'Validar Suite Unitária Core Python (15/15 Testes)',
        verificationRule: 'TEST_PASS',
        verificationTarget: 'python3 -m unittest discover -s tests -v',
        status: 'PENDING',
      },
      {
        id: 'contract-02',
        title: 'Confirmar Integridade dos Launchers Locais (Windows & Linux)',
        verificationRule: 'FILE_EXISTS',
        verificationTarget: 'JarvisHUD.bat',
        status: 'VERIFIED',
        evidenceHash: 'a94f82e1c30d77b4',
        lastCheckedAt: nowIso,
        outputSummary: 'Ficheiro JarvisHUD.bat verificado na raiz do workspace.',
      },
      {
        id: 'contract-03',
        title: 'Verificar Sonda HTTP /api/health do Gateway v3.0',
        verificationRule: 'HTTP_CHECK',
        verificationTarget: '/api/health',
        status: 'VERIFIED',
        evidenceHash: 'f31d9902b8e411ca',
        lastCheckedAt: nowIso,
        outputSummary: 'Endpoint /api/health operacional com latência <3ms.',
      },
      {
        id: 'contract-04',
        title: 'Assinar Auditoria Criptográfica da Fila de Aprovações',
        verificationRule: 'EXEC_SIGN',
        verificationTarget: 'TRUST_BOUNDARY_AUDIT_V3',
        status: 'PENDING',
      },
    ],
    candidates: [
      {
        id: 'q18-act-01',
        title: 'Executar Verificação Criptográfica da Suite de Testes (TEST_PASS)',
        description:
          'Corre a suite real de testes unitários e assina o Today Contract Gate com hash de evidência SHA-256.',
        targetComponent: 'tests/test_jarvis_os.py',
        impact: 9.6,
        urgency: 9.2,
        effort: 1.2,
        risk: 0.1,
        authorityWeight: 1.15,
        dependencies: [],
        actionPayload: { kind: 'VERIFY_CONTRACT', refId: 'contract-01' },
        completed: false,
      },
      {
        id: 'q18-act-02',
        title: 'Disparar Workflow de Diagnóstico Matinal CI & Git',
        description:
          'Executa o DAG completo de inspeção de repositório, verificação de testes e síntese executiva.',
        targetComponent: 'Workflows / wf-morning-ci',
        impact: 8.9,
        urgency: 8.4,
        effort: 1.5,
        risk: 0.15,
        authorityWeight: 1.05,
        dependencies: [],
        actionPayload: { kind: 'RUN_WORKFLOW', refId: 'wf-morning-ci' },
        completed: false,
      },
      {
        id: 'q18-act-03',
        title: 'Rever Pedido de Aprovação Pendente na Inbox de Autoridade',
        description:
          'Existe 1 comando sensível de limpeza de cache em espera na fila de governação humana.',
        targetComponent: 'Autoridade / Inbox',
        impact: 8.4,
        urgency: 8.0,
        effort: 1.0,
        risk: 0.2,
        authorityWeight: 1.0,
        dependencies: [],
        actionPayload: { kind: 'RUN_DIAGNOSTIC', refId: 'authority' },
        completed: false,
      },
    ],
    decisions: [
      {
        id: 'dec-01',
        title: 'Política de Sincronização Bi-Temporal com Antigravity Brain (:8765)',
        context:
          'Definir como novas memórias extraídas pelo Self-Learn Studio são propagadas para a ponte híbrida.',
        optionA: {
          label: 'Apenas Memórias Confirmadas',
          summary: 'Sincroniza apenas itens com Provenance Gate CONFIRMED e 0 segredos AI-Defence.',
          impactScore: 9.4,
          riskLevel: 'LOW',
        },
        optionB: {
          label: 'Espelhamento Completo em Tempo Real',
          summary: 'Propaga factos confirmados e inferidos imediatamente após cada turno.',
          impactScore: 8.4,
          riskLevel: 'MEDIUM',
        },
        status: 'PENDING',
      },
      {
        id: 'dec-02',
        title: 'Escala Predefinida de Despacho do Enxame Swarm',
        context:
          'Escolher entre enxame tático rápido (24x tarefas) ou verificação exaustiva (48x tarefas · 96 Verify Gates).',
        optionA: {
          label: 'Enxame 48x Assimétrico (96 Gates)',
          summary: 'Cobertura máxima nas 4 lanes (UI, API, TESTS, DOCS) com snapshot CoW completo.',
          impactScore: 9.5,
          riskLevel: 'LOW',
        },
        optionB: {
          label: 'Enxame Rápido 24x (48 Gates)',
          summary: 'Latência mínima para pequenas alterações incrementais.',
          impactScore: 8.2,
          riskLevel: 'LOW',
        },
        status: 'PENDING',
      },
    ],
    routineCues: [
      {
        id: 'cue-01',
        title: 'Auditoria Diária de Testes & Git às 09:00',
        patternDescription: 'Detetado em 6 sessões consecutivas no início da manhã.',
        confidence: 0.94,
        suggestedCron: '0 9 * * *',
        promptTemplate: 'Todos os dias às 9h verifica os testes Python, lê o Git status e gera um resumo executivo',
      },
      {
        id: 'cue-02',
        title: 'Snapshot de Saúde de Memória & Portas às 18:00',
        patternDescription: 'Verificação recorrente de RAM livre e radar de portas antes de encerrar o turno.',
        confidence: 0.87,
        suggestedCron: '0 18 * * *',
        promptTemplate: 'Todos os dias às 18h verifica a saúde de CPU/RAM e portas locais e gera um resumo',
      },
    ],
    rooms: [
      {
        id: 'room-exec',
        name: 'Geral Executivo',
        roleTitle: 'Chefe de Gabinete Cognitivo · JEV-S1',
        description: 'Síntese estratégica, decisões Q-18, enxame Swarm 48x e coordenação Orbit.',
        systemPrompt:
          'Atua como J.A.R.V.I.S. v3.0 na Sala Geral Executiva: claro, conciso, em Português Europeu (PT-PT), focado em impacto, prioridades Q-18 e rigor factual.',
        accentColor: 'cyan',
        allowedTools: [
          'search_memories',
          'save_memory',
          'dispatch_swarm_48x',
          'get_system_telemetry',
          'trigger_workflow',
        ],
      },
      {
        id: 'room-eng',
        name: 'Engenharia & AST Scout',
        roleTitle: 'Arquiteto Principal · Lookahead & CoW',
        description: 'Inspeção AST (:Lstart-end), Blast Radius Git Co-Change, testes e screenshots.',
        systemPrompt:
          'Atua como Arquiteto de Engenharia do J.A.R.V.I.S. v3.0: inspeciona símbolos AST, ficheiros reais, estado Git e testes com precisão cirúrgica.',
        accentColor: 'emerald',
        allowedTools: [
          'lookup_ast_symbol',
          'list_workspace_files',
          'read_workspace_file',
          'get_git_status',
          'request_shell_approval',
        ],
      },
      {
        id: 'room-devops',
        name: 'DevOps & Sistema',
        roleTitle: 'Operador de Telemetria Windows/Linux',
        description: 'Monitorização de recursos, radar de portas, workflows Cron e governação de comandos.',
        systemPrompt:
          'Atua como Especialista DevOps Windows/Linux do J.A.R.V.I.S.: analisa CPU, RAM, disco, portas TCP e automações com segurança.',
        accentColor: 'amber',
        allowedTools: ['get_system_telemetry', 'get_git_status', 'trigger_workflow', 'request_shell_approval'],
      },
      {
        id: 'room-research',
        name: 'Pesquisa & HippoRAG 4-Way',
        roleTitle: 'Curador Bi-Temporal & Ebbinghaus',
        description: 'Fusão 4-Way RRF no Memory Vault, linhagem bi-temporal e planeamento DOTS.',
        systemPrompt:
          'Atua como Analista de Estratégia do J.A.R.V.I.S.: cruza factos bi-temporais do Memory Vault, avalia trade-offs e regista compromissos estruturados.',
        accentColor: 'rose',
        allowedTools: ['search_memories', 'save_memory', 'lookup_ast_symbol'],
      },
    ],
    messages: [
      {
        id: 'msg-welcome-exec',
        roomId: 'room-exec',
        role: 'assistant',
        content:
          'Bom dia, Comandante. O núcleo **J.A.R.V.I.S. Cortex OS v3.0** encontra-se operacional com os motores **Swarm 48x**, **Roteador JEV-S1 (`<1ms`)**, **Memória Bi-Temporal 4-Way RRF + Ebbinghaus**, **Escritório Espacial 3D** e **Orbit MCP 2026**. Envia qualquer diretiva ou dispara um enxame completo.',
        createdAt: nowIso,
        engineUsed: 'CORTEX_V3_BOOT',
      },
      {
        id: 'msg-welcome-eng',
        roomId: 'room-eng',
        role: 'assistant',
        content:
          'Sala de **Engenharia & AST Scout** pronta. O `SCOUT-01` já indexou os símbolos `:Lstart-end` e o acoplamento Git Co-Change para avisar sobre raio de impacto em pré-voo.',
        createdAt: nowIso,
        engineUsed: 'CORTEX_V3_BOOT',
      },
    ],
    workflows: [
      {
        id: 'wf-morning-ci',
        name: 'Auditoria Matinal CI & Git',
        description: 'Corre os testes unitários Python, lê o estado Git atual e sintetiza o relatório técnico.',
        enabled: true,
        cronExpr: '0 9 * * *',
        createdAt: nowIso,
        lastRunAt: nowIso,
        lastStatus: 'SUCCESS',
        nodes: [
          {
            id: 'n1',
            type: 'trigger',
            label: 'Cron Diário (09:00)',
            config: { triggerKind: 'cron', cronExpr: '0 9 * * *' },
            nextIds: ['n2'],
          },
          {
            id: 'n2',
            type: 'shell',
            label: 'Testes Unitários Core',
            config: { command: 'python3 -m unittest discover -s tests -v' },
            nextIds: ['n3'],
          },
          {
            id: 'n3',
            type: 'shell',
            label: 'Estado do Repositório Git',
            config: { command: 'git status --short' },
            nextIds: ['n4'],
          },
          {
            id: 'n4',
            type: 'ai',
            label: 'Síntese Executiva CI',
            config: { prompt: 'Resume o estado dos testes e alterações pendentes no repositório.' },
            nextIds: [],
          },
        ],
      },
      {
        id: 'wf-sec-radar',
        name: 'Radar de Portas & Saúde de Memória',
        description: 'Inspeciona telemetria nativa Windows/Linux, valida condições de RAM livre e regista auditoria.',
        enabled: true,
        cronExpr: '*/30 * * * *',
        createdAt: nowIso,
        lastRunAt: nowIso,
        lastStatus: 'SUCCESS',
        nodes: [
          {
            id: 's1',
            type: 'trigger',
            label: 'Trigger a cada 30 min',
            config: { triggerKind: 'cron', cronExpr: '*/30 * * * *' },
            nextIds: ['s2'],
          },
          {
            id: 's2',
            type: 'shell',
            label: 'Verificar Runtime Node',
            config: { command: 'node -v' },
            nextIds: ['s3'],
          },
          {
            id: 's3',
            type: 'condition',
            label: 'Condição: Exit Code == 0',
            config: { conditionExpr: 'prev.exitCode === 0' },
            nextIds: ['s4'],
          },
          {
            id: 's4',
            type: 'ai',
            label: 'Relatório de Estabilidade SO',
            config: { prompt: 'Avalia a saúde operacional do anfitrião local.' },
            nextIds: [],
          },
        ],
      },
      {
        id: 'wf-staged-deploy',
        name: 'Release Governada com Aprovação Humana',
        description: 'Valida o estado do projeto e aguarda autorização explícita do Operador antes da publicação.',
        enabled: true,
        createdAt: nowIso,
        nodes: [
          {
            id: 'd1',
            type: 'trigger',
            label: 'Disparo Manual / Webhook',
            config: { triggerKind: 'manual' },
            nextIds: ['d2'],
          },
          {
            id: 'd2',
            type: 'shell',
            label: 'Últimos Commits Git',
            config: { command: 'git log -n 5 --oneline' },
            nextIds: ['d3'],
          },
          {
            id: 'd3',
            type: 'approval',
            label: 'Aprovação Humana Obrigatória',
            config: { approverNote: 'Autorizar promoção da build para ambiente de produção?' },
            nextIds: ['d4'],
          },
          {
            id: 'd4',
            type: 'ai',
            label: 'Gerar Notas de Lançamento',
            config: { prompt: 'Gera notas de lançamento concisas em PT-PT com base nos commits.' },
            nextIds: [],
          },
        ],
      },
    ],
    workflowRuns: [
      {
        id: 'run-seed-01',
        workflowId: 'wf-morning-ci',
        workflowName: 'Auditoria Matinal CI & Git',
        triggerSource: 'CRON',
        status: 'SUCCESS',
        startedAt: nowIso,
        finishedAt: nowIso,
        totalDurationMs: 142,
        steps: [
          {
            nodeId: 'n1',
            nodeLabel: 'Cron Diário (09:00)',
            nodeType: 'trigger',
            status: 'SUCCESS',
            output: 'Disparo agendado iniciado.',
            durationMs: 2,
            startedAt: nowIso,
          },
          {
            nodeId: 'n2',
            nodeLabel: 'Testes Unitários Core',
            nodeType: 'shell',
            status: 'SUCCESS',
            output: 'Ran 15 tests in 0.08s — OK',
            durationMs: 85,
            startedAt: nowIso,
          },
          {
            nodeId: 'n3',
            nodeLabel: 'Estado do Repositório Git',
            nodeType: 'shell',
            status: 'SUCCESS',
            output: 'Working tree inspecionada com sucesso.',
            durationMs: 24,
            startedAt: nowIso,
          },
          {
            nodeId: 'n4',
            nodeLabel: 'Síntese Executiva CI',
            nodeType: 'ai',
            status: 'SUCCESS',
            output: 'Suite Python 100% íntegra e workspace pronto para operação.',
            durationMs: 31,
            startedAt: nowIso,
          },
        ],
      },
    ],
    heartbeat: {
      enabled: true,
      intervalSeconds: 60,
      checkPorts: true,
      checkDiskAndRam: true,
      checkGoals: true,
      lastBeatAt: nowIso,
      totalBeats: 1,
      recentAlerts: [
        {
          id: 'hb-boot-1',
          timestamp: nowIso,
          severity: 'NOMINAL',
          title: 'Daemon OpenClaw Heartbeat Ativo',
          detail: 'Monitorização periódica de portas locais, memória física e objetivos iniciada sem anomalias.',
        },
      ],
    },
    memories,
    graphEdges,
    skills: [
      {
        id: 'skill-01',
        name: 'Auditor AST & Testes (SCOUT-01)',
        slug: 'repo-test-auditor',
        description: 'Analisa símbolos :Lstart-end, acoplamento Git Co-Change e executa verificações determinísticas.',
        enabled: true,
        systemInstruction: 'Prioriza evidência empírica de testes e raio de impacto AST antes de sugerir refatorações.',
        allowedTools: ['lookup_ast_symbol', 'get_git_status', 'list_workspace_files', 'read_workspace_file'],
        quickCommand: '/audit-repo',
        version: '3.0.0',
      },
      {
        id: 'skill-02',
        name: 'Curador Bi-Temporal 4-Way RRF',
        slug: 'hipporag-curator',
        description: 'Extrai factos duradouros com superação automática de contradições e curva Ebbinghaus.',
        enabled: true,
        systemInstruction: 'Guarda apenas factos de elevado valor semântico com redação AI-Defence.',
        allowedTools: ['search_memories', 'save_memory'],
        quickCommand: '/curate-vault',
        version: '3.0.0',
      },
      {
        id: 'skill-03',
        name: 'Sentinela Windows & Linux Sidecar',
        slug: 'os-sentinel',
        description: 'Diagnostica carga de CPU, pressão de RAM, espaço NVMe e radar de portas TCP locais.',
        enabled: true,
        systemInstruction: 'Cruza métricas reais do sistema operativo e alerta quando RAM > 85%.',
        allowedTools: ['get_system_telemetry', 'request_shell_approval'],
        quickCommand: '/diag-os',
        version: '2.1.0',
      },
      {
        id: 'skill-04',
        name: 'Comandante Enxame Swarm 48x',
        slug: 'swarm-commander',
        description: 'Despacha 48 subagentes assimétricos (UI, API, TESTS, DOCS) com CoW Sandboxes e Dual Verify Gates.',
        enabled: true,
        systemInstruction: 'Exige sempre 96/96 Verify Gates antes de promover alterações para MERGED.',
        allowedTools: ['dispatch_swarm_48x', 'lookup_ast_symbol', 'trigger_workflow'],
        quickCommand: '/swarm-48x',
        version: '3.0.0',
      },
    ],
    channels: [
      {
        id: 'chan-telegram',
        platform: 'TELEGRAM',
        name: 'Telegram Ponte Executiva',
        enabled: true,
        endpointOrBotTag: '@JarvisStarkExecBot',
        ownerAllowList: ['tg_owner_774109', 'tg_ops_882104'],
        lastEventAt: nowIso,
      },
      {
        id: 'chan-webhook',
        platform: 'WEBHOOK',
        name: 'Webhook CI/CD Interno',
        enabled: true,
        endpointOrBotTag: '/api/channels/webhook/inbound',
        ownerAllowList: ['ci_master_key_01', 'dev_lead_02'],
        lastEventAt: nowIso,
      },
      {
        id: 'chan-discord',
        platform: 'DISCORD',
        name: 'Discord War Room (Bloqueado — Sem Allow-List)',
        enabled: true,
        endpointOrBotTag: 'guild#war-room-jarvis',
        ownerAllowList: [],
      },
      {
        id: 'chan-slack',
        platform: 'SLACK',
        name: 'Slack Engenharia #jarvis-ops',
        enabled: false,
        endpointOrBotTag: 'workspace/jarvis-ops',
        ownerAllowList: ['U01STARKOWNER'],
      },
    ],
    devices: [
      {
        id: 'dev-local-host',
        name: `Anfitrião Principal (${os.hostname()})`,
        osType,
        hostname: os.hostname(),
        ipAddress: '127.0.0.1',
        status: 'ONLINE',
        isCurrentHost: true,
        lastSeenAt: nowIso,
        capabilities: ['Telemetry', 'WorkspaceFS', 'PortRadar', 'MarkVII-Audio', 'Swarm48x', 'MCP-2026'],
      },
    ],
    enrollmentTokens: [
      {
        id: 'tok-seed-01',
        token: 'JRV3-WIN-9F4A-C81E-772B',
        label: 'Workstation Windows RTX Local (:8766 ⇄ :8765)',
        targetOs: 'WINDOWS',
        createdAt: nowIso,
        expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      },
    ],
    approvals: [
      {
        id: 'appr-seed-01',
        title: 'Limpeza de Artefactos Temporários de Build',
        commandOrAction: 'git clean -fdX tmp/',
        source: 'WORKFLOW',
        riskLevel: 'MEDIUM',
        requestedAt: nowIso,
        status: 'PENDING',
      },
    ],
    auditLogs: [
      {
        id: 'aud-01',
        timestamp: nowIso,
        actor: 'SYSTEM_BOOT',
        category: 'SYSTEM',
        action: 'CORTEX_V3_INIT',
        detail: 'Núcleo v3.0 (Swarm 48x + JEV-S1 + 4-Way RRF Bi-Temporal + MCP 2026) ativo sem node-gyp.',
        status: 'VERIFIED',
      },
      {
        id: 'aud-02',
        timestamp: nowIso,
        actor: 'OPENCLAW_GATE',
        category: 'CHANNEL',
        action: 'EMPTY_ALLOWLIST_LOCK',
        detail: 'Canal Discord War Room mantido em contenção preventiva por não possuir Owner Allow-List.',
        status: 'BLOCKED',
      },
      {
        id: 'aud-03',
        timestamp: nowIso,
        actor: 'SWARM_ORCHESTRATOR',
        category: 'SWARM',
        action: 'SWARM_48X_BASELINE',
        detail: 'Baseline Swarm 48x (UI/API/TESTS/DOCS) verificada com 96/96 Verify Gates e Ruflo EMA 0.962.',
        status: 'VERIFIED',
      },
    ],
    // v3.0 Seeded Swarm 48x + Orbit Agent OS Collections
    swarmRuns: [
      {
        id: 'swarm-seed-48x',
        objective: 'Verificação Integral da Arquitetura J.A.R.V.I.S. Cortex OS v3.0',
        scale: 48,
        status: 'VERIFIED',
        startedAt: nowIso,
        finishedAt: nowIso,
        scoutSummary:
          '[SCOUT_SHARED_MAP] Workspace indexado uma única vez por SCOUT-01 (-85% leituras redundantes) e partilhado pelas 4 lanes.',
        rufloConvergence: 0.962,
        verifyGatesPassed: 96,
        verifyGatesTotal: 96,
        tasks: seedSwarmTasks,
      },
    ],
    sandboxes: [],
    dotsTasks: [
      {
        id: 'dots-01',
        slug: '.dots/jev-s1-reflex-router',
        title: 'Calibrar Roteador JEV-S1 (<1ms) + Poda Dinâmica MCP (-96%)',
        lane: 'API',
        priority: 'P0',
        status: 'COMPLETED',
        dependsOn: [],
        assignedAgent: 'API-GATEWAY-01',
        tokenEstimate: 140,
        verifiedAt: nowIso,
      },
      {
        id: 'dots-02',
        slug: '.dots/bitemporal-4way-rrf',
        title: 'Ativar Fusão 4-Way RRF + Quantização Binária 128-Bit POPCNT',
        lane: 'API',
        priority: 'P0',
        status: 'COMPLETED',
        dependsOn: ['dots-01'],
        assignedAgent: 'SQLITE-WAL-03',
        tokenEstimate: 185,
        verifiedAt: nowIso,
      },
      {
        id: 'dots-03',
        slug: '.dots/spatial-3d-agent-office',
        title: 'Renderizar Escritório Espacial 3D PBR + Heatmap AST InstancedMesh',
        lane: 'UI',
        priority: 'P1',
        status: 'IN_PROGRESS',
        dependsOn: ['dots-01'],
        assignedAgent: 'THREE-SPATIAL-02',
        tokenEstimate: 220,
      },
      {
        id: 'dots-04',
        slug: '.dots/cow-sandbox-drill',
        title: 'Executar Simulação de Mutação & Rollback Atómico zlib SHA-256',
        lane: 'TESTS',
        priority: 'P1',
        status: 'READY',
        dependsOn: ['dots-02'],
        assignedAgent: 'QA-SENTINEL-01',
        tokenEstimate: 130,
      },
      {
        id: 'dots-05',
        slug: '.dots/mcp-2026-audit-report',
        title: 'Publicar GRAPH_REPORT.md via Recurso brain://graph/report',
        lane: 'DOCS',
        priority: 'P2',
        status: 'READY',
        dependsOn: ['dots-02', 'dots-03'],
        assignedAgent: 'GRAPH-SCRIBE-02',
        tokenEstimate: 95,
      },
    ],
    handoffs: [
      {
        id: 'ho-seed-01',
        timestamp: nowIso,
        fromAgent: 'SCOUT-01',
        toAgent: 'API-GATEWAY-01',
        authorityLevel: 'ORCHESTRATOR',
        taskRef: '.dots/jev-s1-reflex-router',
        contextToon: compressFactTelegraphic(
          'Mapa AST extraído com sucesso; acoplamento elevado entre server.ts e src/server/db.ts.'
        ),
        status: 'ACCEPTED',
      },
      {
        id: 'ho-seed-02',
        timestamp: nowIso,
        fromAgent: 'API-GATEWAY-01',
        toAgent: 'THREE-SPATIAL-02',
        authorityLevel: 'WORKER',
        taskRef: '.dots/spatial-3d-agent-office',
        contextToon: compressFactTelegraphic(
          'Endpoints /api/swarm/overview e /api/orbit/overview prontos para alimentar telemetria espacial 3D.'
        ),
        status: 'DELIVERED',
      },
    ],
    fleetBroadcasts: [
      {
        id: 'fb-seed-01',
        timestamp: nowIso,
        sender: 'Comandante (HUMAN_WINS)',
        priority: 'OVERRIDE_HUMAN_WINS',
        directive:
          'Manter zero dependências nativas C++ (node-gyp) e exigir Dual Verify Gates antes de qualquer merge.',
        acknowledgedBy: ['SCOUT-01', 'UI-ARCHITECT-01', 'API-GATEWAY-01', 'QA-SENTINEL-01'],
      },
    ],
    promptForge: [
      {
        id: 'pf-01',
        name: 'Ultraplan Scout & Blast Radius',
        category: 'ULTRASCAN',
        rawPrompt:
          'Por favor analisa todos os ficheiros que podem ser afetados se alterarmos o ficheiro server.ts e verifica todas as dependências e testes necessários antes de fazermos alterações.',
        toonOptimizedPrompt:
          '[SCOUT-01] swarm_impact_graph(server.ts) -> listar dependentes AST + Git Co-Change + Verify Gates exigidos.',
        tokenSavingsPercent: 48.5,
        usageCount: 14,
      },
      {
        id: 'pf-02',
        name: 'Despacho Enxame 48x Assimétrico',
        category: 'SWARM_DISPATCH',
        rawPrompt:
          'Quero que dividas esta funcionalidade em tarefas de interface, servidor, testes unitários e documentação com verificação dupla e rollback automático.',
        toonOptimizedPrompt:
          '[SWARM 48x] lanes=[UI,API,TESTS,DOCS] + CoW(zlib,SHA256) + gates=[AST,Tests+AIDefence].',
        tokenSavingsPercent: 54.2,
        usageCount: 9,
      },
      {
        id: 'pf-03',
        name: 'Investigação Bi-Temporal de Regressão',
        category: 'BUGFIX_LINEAGE',
        rawPrompt:
          'Pesquisa no histórico de memórias que decisões anteriores foram substituídas sobre portas ou configuração de rede e encontra a causa raiz.',
        toonOptimizedPrompt:
          '[RRF-4WAY] search_brain(porta rede, includeSuperseded=true) + trace(SUPERSEDES).',
        tokenSavingsPercent: 44.0,
        usageCount: 6,
      },
    ],
    selfLearnQueue: [
      {
        id: 'sl-seed-01',
        createdAt: nowIso,
        sourceTurnId: 'turn-init',
        topic: 'Preferência Arquitetural: Ponte Híbrida :8765 + Nativo',
        extractedFact:
          'Operar motores Swarm 48x, JEV-S1 e Orbit nativamente em Node/TS sincronizando em tempo real com :8765 quando online.',
        suggestedTier: 'SEMANTIC',
        suggestedCategory: 'DECISION',
        redactedSecretsCount: 0,
        supersedesMemoryId: null,
        status: 'PENDING',
      },
    ],
    quota5h: {
      windowHours: 5,
      budgetTokens5h: 250_000,
      consumedTokens5h: 14_820,
      savedByDietTokens5h: 98_460,
      promptsRouted5h: 19,
      microTicks5h: 5,
      verifyGatePassRate: 100,
      estimatedHoursSaved: 4.6,
      stageSavings: {
        deltaCacheTokens: 28_400,
        toonCompressionTokens: 16_920,
        scoutMapTokens: 24_100,
        microTickTokens: 9_840,
        toolPruningTokens: 19_200,
      },
    },
    mcpRegistryTools: buildDefaultMcpRegistryTools(nowIso),
    mcpRegistryResources: buildDefaultMcpRegistryResources(nowIso),
    mcpServers: buildSeedMcpServers(nowIso),
  };
}

function ensureV3Migration(state: JarvisStoreData, seed: JarvisStoreData): JarvisStoreData {
  const nowIso = new Date().toISOString();
  const migratedMemories: MemoryItem[] = (state.memories || seed.memories).map((m) => ({
    ...m,
    tier: m.tier || (m.pinned ? 'SEMANTIC' : 'EPISODIC'),
    bq128Hex: m.bq128Hex || computeBinaryQuantization128(`${m.topic} ${m.content}`),
    accessCount: m.accessCount ?? 2,
    lastAccessedAt: m.lastAccessedAt || m.updatedAt || nowIso,
    importance: m.importance ?? (m.pinned ? 5 : 3),
    validFrom: m.validFrom || m.createdAt || nowIso,
    validUntil: m.validUntil ?? null,
    supersededBy: m.supersededBy ?? null,
  }));

  // Ensure at least 1 superseded bi-temporal example exists so Bi-Temporal toggle immediately showcases history
  if (!migratedMemories.some((m) => Boolean(m.supersededBy))) {
    const legacyExample = seed.memories.find((m) => m.id === 'mem-superseded-09');
    if (legacyExample) migratedMemories.push(legacyExample);
  }

  return {
    ...seed,
    ...state,
    settings: { ...seed.settings, ...(state.settings ?? {}) },
    memories: migratedMemories,
    swarmRuns: state.swarmRuns && state.swarmRuns.length > 0 ? state.swarmRuns : seed.swarmRuns,
    sandboxes: state.sandboxes ?? seed.sandboxes,
    dotsTasks: state.dotsTasks && state.dotsTasks.length > 0 ? state.dotsTasks : seed.dotsTasks,
    handoffs: state.handoffs && state.handoffs.length > 0 ? state.handoffs : seed.handoffs,
    fleetBroadcasts:
      state.fleetBroadcasts && state.fleetBroadcasts.length > 0
        ? state.fleetBroadcasts
        : seed.fleetBroadcasts,
    promptForge:
      state.promptForge && state.promptForge.length > 0 ? state.promptForge : seed.promptForge,
    selfLearnQueue: state.selfLearnQueue ?? seed.selfLearnQueue,
    quota5h: state.quota5h ?? seed.quota5h,
    mcpRegistryTools:
      state.mcpRegistryTools && state.mcpRegistryTools.length > 0
        ? state.mcpRegistryTools
        : seed.mcpRegistryTools,
    mcpRegistryResources:
      state.mcpRegistryResources && state.mcpRegistryResources.length > 0
        ? state.mcpRegistryResources
        : seed.mcpRegistryResources,
    mcpServers: (state.mcpServers ?? seed.mcpServers ?? []).map((s) => ({
      ...s,
      jevEligible: s.jevEligible ?? true,
    })),
  };
}

class JarvisDatabase {
  private sqliteDb: SqliteDatabaseLike | null = null;
  private storageEngine: 'node:sqlite' | 'json-transactional' = 'json-transactional';
  private cache: JarvisStoreData;

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.initSqliteIfAvailable();
    this.cache = this.loadOrSeed();
  }

  private initSqliteIfAvailable(): void {
    try {
      const sqliteMod = require('node:sqlite') as { DatabaseSync?: new (p: string) => SqliteDatabaseLike };
      if (sqliteMod && typeof sqliteMod.DatabaseSync === 'function') {
        const dbConn = new sqliteMod.DatabaseSync(SQLITE_PATH);
        dbConn.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
          CREATE TABLE IF NOT EXISTS jarvis_kv_store (
            collection_key TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        this.sqliteDb = dbConn;
        this.storageEngine = 'node:sqlite';
      }
    } catch {
      this.sqliteDb = null;
      this.storageEngine = 'json-transactional';
    }
  }

  private loadOrSeed(): JarvisStoreData {
    const seed = buildInitialSeed();

    if (this.sqliteDb) {
      try {
        const row = this.sqliteDb
          .prepare('SELECT payload_json FROM jarvis_kv_store WHERE collection_key = ?')
          .get('root_state_v2');
        if (row && typeof row.payload_json === 'string') {
          const parsed = JSON.parse(row.payload_json) as Partial<JarvisStoreData>;
          const migrated = ensureV3Migration(parsed as JarvisStoreData, seed);
          this.persist(migrated);
          return migrated;
        }
      } catch {
        // Fall through to JSON or fresh seed
      }
    }

    if (fs.existsSync(JSON_FALLBACK_PATH)) {
      try {
        const raw = fs.readFileSync(JSON_FALLBACK_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<JarvisStoreData>;
        const migrated = ensureV3Migration(parsed as JarvisStoreData, seed);
        this.persist(migrated);
        return migrated;
      } catch {
        // Corrupted fallback -> re-seed
      }
    }

    this.persist(seed);
    return seed;
  }

  private persist(data: JarvisStoreData): void {
    const serialized = JSON.stringify(data, null, 2);
    const nowIso = new Date().toISOString();

    if (this.sqliteDb) {
      try {
        this.sqliteDb
          .prepare(
            `INSERT INTO jarvis_kv_store (collection_key, payload_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(collection_key) DO UPDATE SET
               payload_json = excluded.payload_json,
               updated_at = excluded.updated_at`
          )
          .run('root_state_v2', serialized, nowIso);
      } catch {
        // Ensure JSON mirror still writes cleanly
      }
    }

    const tmpPath = `${JSON_FALLBACK_PATH}.tmp`;
    fs.writeFileSync(tmpPath, serialized, 'utf-8');
    fs.renameSync(tmpPath, JSON_FALLBACK_PATH);
  }

  public getEngineName(): string {
    return this.storageEngine;
  }

  public getState(): JarvisStoreData {
    return this.cache;
  }

  public update(mutator: (draft: JarvisStoreData) => void): JarvisStoreData {
    mutator(this.cache);
    this.persist(this.cache);
    return this.cache;
  }

  public replaceAll(nextData: Partial<JarvisStoreData>): JarvisStoreData {
    const seed = buildInitialSeed();
    this.cache = ensureV3Migration(nextData as JarvisStoreData, seed);
    this.persist(this.cache);
    return this.cache;
  }

  public appendAudit(
    actor: string,
    category: JarvisStoreData['auditLogs'][number]['category'],
    action: string,
    detail: string,
    status: JarvisStoreData['auditLogs'][number]['status'] = 'ALLOWED'
  ): void {
    this.update((draft) => {
      draft.auditLogs.unshift({
        id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        actor,
        category,
        action,
        detail,
        status,
      });
      if (draft.auditLogs.length > 250) {
        draft.auditLogs.length = 250;
      }
    });
  }
}

export const db = new JarvisDatabase();
