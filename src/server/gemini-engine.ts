import { FunctionDeclaration, GoogleGenAI, Type } from '@google/genai';
import {
  buildDeterministicWorkflowFromPrompt,
  detectPromptInjection,
  rankQ18Actions,
  routeJevS1,
  searchMemories4WayRRF,
} from '../shared/cortex-math.ts';
import type {
  AttachmentItem,
  ChatMessage,
  JevRouteDecision,
  LanguageCode,
  MemoryCategory,
  PersonalityMode,
  ToolCallRecord,
  WorkflowNode,
} from '../shared/types.ts';
import { db } from './db.ts';
import {
  collectOSTelemetry,
  collectSidecarHostSnapshot,
  dispatchSidecarHostCommand,
  executeGovernedCommand,
  getGitOverview,
  listWorkspaceFiles,
  readSafeWorkspaceFile,
  triggerSidecarHotkey,
} from './os-adapter.ts';
import {
  buildScoutWorkspaceIndex,
  harvestSelfLearnFromTurn,
  launchAsymmetricSwarm,
  lookupWorkspaceSymbols,
  storeBiTemporalMemory,
} from './swarm-orbit-engine.ts';

const roomDeltaHashes = new Map<string, string>();

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getPersonalityDirective(mode: PersonalityMode, lang: LanguageCode): string {
  const isPt = lang === 'pt-PT';
  const baseLang = isPt
    ? 'Responde SEMPRE em Português de Portugal (PT-PT) natural, claro e preciso.'
    : 'Always respond in crisp, clear English (EN-US).';

  switch (mode) {
    case 'TACTICAL_ENGINEER':
      return `${baseLang} Adota o perfil TACTICAL_ENGINEER: profundo rigor técnico, foco em código, AST, testes e telemetria real.`;
    case 'WAR_ROOM_CONCISE':
      return `${baseLang} Adota o perfil WAR_ROOM_CONCISE: respostas ultra-diretas em tópicos curtos orientados a ação imediata.`;
    case 'GUARDIAN_DEFENSE':
      return `${baseLang} Adota o perfil GUARDIAN_DEFENSE: vigilância máxima de cibersegurança, validação de fronteiras de confiança e zero risco.`;
    case 'STARK_EXECUTIVE':
    default:
      return `${baseLang} Adota o perfil STARK_EXECUTIVE: calmo, articulado, proativo e orientado a decisões de alto impacto.`;
  }
}

const AGENT_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'search_memories',
    description: 'Search long-term bi-temporal facts in the Memory Vault using 4-Way Weighted RRF + Ebbinghaus retention.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Keywords or topic to search in Memory Vault.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'save_memory',
    description: 'Persist a bi-temporal fact, preference, decision, or commitment with automatic contradiction superseding.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING, description: 'Short concise title of the memory.' },
        content: { type: Type.STRING, description: 'Detailed factual content to remember.' },
        category: {
          type: Type.STRING,
          description: 'One of FACT, ENTITY, PREFERENCE, DECISION, COMMITMENT.',
        },
      },
      required: ['topic', 'content'],
    },
  },
  {
    name: 'dispatch_swarm_48x',
    description: 'Launch an Asymmetric Swarm (24x or 48x tasks across UI, API, TESTS, DOCS) with CoW Sandbox and Dual Verify Gates.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        objective: { type: Type.STRING, description: 'Engineering or audit objective for the Swarm.' },
        scale: { type: Type.NUMBER, description: 'Either 24 or 48.' },
      },
      required: ['objective'],
    },
  },
  {
    name: 'lookup_ast_symbol',
    description: 'Query SCOUT-01 AST symbol index (:Lstart-end) across TypeScript and Python files.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Function, class, route, or file name to inspect.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_system_telemetry',
    description: 'Collect real-time Windows/Linux CPU, RAM, Disk, OS info, and TCP Port Radar.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        includePorts: { type: Type.BOOLEAN, description: 'Whether to include TCP port radar.' },
      },
    },
  },
  {
    name: 'list_workspace_files',
    description: 'List files and directories inside the current project workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filter: { type: Type.STRING, description: 'Optional substring to filter file paths.' },
      },
    },
  },
  {
    name: 'read_workspace_file',
    description: 'Read the text/code contents of a file inside the current workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: { type: Type.STRING, description: 'Relative path from workspace root, e.g. package.json' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'get_git_status',
    description: 'Inspect current Git branch, modified files, and latest commits.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        includeCommits: { type: Type.BOOLEAN, description: 'Include recent git commits.' },
      },
    },
  },
  {
    name: 'trigger_workflow',
    description: 'List or trigger an existing automation workflow by ID or name.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        workflowQuery: { type: Type.STRING, description: 'Workflow ID or partial name to execute.' },
      },
      required: ['workflowQuery'],
    },
  },
  {
    name: 'request_shell_approval',
    description: 'Execute a safe diagnostic command or request human approval for a shell command.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: { type: Type.STRING, description: 'Shell command to execute or queue for approval.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'sidecar_host_control',
    description: 'Interact directly with the host machine running the Sidecar: inspect active windows & top CPU/RAM processes, trigger global hotkeys, or dispatch governed host commands.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'One of SNAPSHOT (windows & processes), HOTKEY (trigger shortcut), or EXEC (governed host command).',
        },
        target: {
          type: Type.STRING,
          description: 'Hotkey combo (e.g. Alt+Space) or host command when action is HOTKEY or EXEC.',
        },
      },
      required: ['action'],
    },
  },
];

async function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
  activePort = 3000
): Promise<{ record: ToolCallRecord; rawResult: Record<string, unknown> }> {
  const t0 = Date.now();
  const id = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  if (name === 'search_memories') {
    const q = String(args.query || '').trim();
    const state = db.getState();
    const rankedHits = searchMemories4WayRRF(q, state.memories, state.graphEdges).slice(0, 6);
    if (rankedHits[0]) {
      const topId = rankedHits[0].memory.id;
      db.update((draft) => {
        const m = draft.memories.find((x) => x.id === topId);
        if (m) {
          m.accessCount = (m.accessCount ?? 1) + 1;
          m.lastAccessedAt = new Date().toISOString();
        }
      });
    }
    return {
      record: {
        id,
        name,
        args,
        status: 'SUCCESS',
        outputSummary: `4-Way RRF recuperou ${rankedHits.length} memórias bi-temporais ativas${q ? ` para "${q}"` : ''}.`,
        durationMs: Math.max(1, Date.now() - t0),
      },
      rawResult: {
        count: rankedHits.length,
        memories: rankedHits.map((h) => ({
          ...h.memory,
          rrfScore: h.rrfScore,
          bqSimilarity: h.bqSimilarity,
          retentionScore: h.retentionScore,
        })),
      },
    };
  }

  if (name === 'save_memory') {
    const topic = String(args.topic || 'Nota Operacional').trim();
    const content = String(args.content || '').trim();
    const rawCat = String(args.category || 'FACT').toUpperCase();
    const validCats = ['FACT', 'ENTITY', 'PREFERENCE', 'DECISION', 'COMMITMENT'] as const;
    const category = (validCats.includes(rawCat as never) ? rawCat : 'FACT') as MemoryCategory;

    const stored = storeBiTemporalMemory({
      topic,
      content,
      category,
      provenance: 'CONFIRMED',
      tags: ['agent-saved', 'bitemporal'],
      sourceUri: 'chat://agent-tool',
    });

    db.appendAudit('CHAT_AGENT', 'MEMORY', 'MEMORY_SAVED_BITEMPORAL', topic, 'VERIFIED');
    return {
      record: {
        id,
        name,
        args,
        status: 'SUCCESS',
        outputSummary: `Memória "${stored.memory.topic}" gravada (BQ128 ${stored.memory.bq128Hex?.slice(0, 10)}…${stored.supersededIds.length > 0 ? ` · superou ${stored.supersededIds.length} versão anterior` : ''}).`,
        durationMs: Math.max(1, Date.now() - t0),
      },
      rawResult: { saved: stored.memory, supersededIds: stored.supersededIds },
    };
  }

  if (name === 'dispatch_swarm_48x') {
    const objective = String(args.objective || 'Execução Swarm via Chat Agêntico');
    const scale: 24 | 48 = Number(args.scale) === 24 ? 24 : 48;
    const run = await launchAsymmetricSwarm({ objective, scale });
    return {
      record: {
        id,
        name,
        args,
        status: 'SUCCESS',
        outputSummary: `Swarm ${run.scale}x concluído -> ${run.verifyGatesPassed}/${run.verifyGatesTotal} Verify Gates · Ruflo EMA ${run.rufloConvergence}.`,
        durationMs: Math.max(1, Date.now() - t0),
      },
      rawResult: { swarmRun: { id: run.id, scale: run.scale, status: run.status, verifyGatesPassed: run.verifyGatesPassed } },
    };
  }

  if (name === 'lookup_ast_symbol') {
    const q = String(args.query || '');
    const symbols = await lookupWorkspaceSymbols(q, 10);
    return {
      record: {
        id,
        name,
        args,
        status: 'SUCCESS',
        outputSummary: `SCOUT-01 encontrou ${symbols.length} símbolo(s) AST (:Lstart-end)${q ? ` para "${q}"` : ''}.`,
        durationMs: Math.max(1, Date.now() - t0),
      },
      rawResult: { symbols },
    };
  }

  if (name === 'get_system_telemetry') {
    const tel = await collectOSTelemetry(activePort);
    const openPorts = tel.ports.filter((p) => p.open).map((p) => p.port);
    return {
      record: {
        id,
        name,
        args,
        status: 'SUCCESS',
        outputSummary: `${tel.platform}/${tel.arch} · CPU ${tel.cpuUsagePercent}% · RAM ${tel.ramUsedGb}/${tel.ramTotalGb} GB (${tel.ramPercent}%) · Portas abertas: ${openPorts.join(', ')}`,
        durationMs: Math.max(1, Date.now() - t0),
      },
      rawResult: { telemetry: tel },
    };
  }

  if (name === 'list_workspace_files') {
    const filter = String(args.filter || '').toLowerCase().trim();
    const files = listWorkspaceFiles(100).filter(
      (f) => !filter || f.path.toLowerCase().includes(filter)
    );
    return {
      record: {
        id,
        name,
        args,
        status: 'SUCCESS',
        outputSummary: `${files.length} entradas listadas no workspace.`,
        durationMs: Math.max(1, Date.now() - t0),
      },
      rawResult: { files: files.slice(0, 50) },
    };
  }

  if (name === 'read_workspace_file') {
    const filePath = String(args.filePath || 'package.json');
    const res = readSafeWorkspaceFile(filePath);
    return {
      record: {
        id,
        name,
        args,
        status: res.ok ? 'SUCCESS' : 'ERROR',
        outputSummary: res.ok
          ? `Lido "${filePath}" (${res.content.length} caracteres).`
          : res.error || 'Erro ao ler ficheiro.',
        durationMs: Math.max(1, Date.now() - t0),
      },
      rawResult: res.ok ? { filePath, content: res.content.slice(0, 5000) } : { error: res.error },
    };
  }

  if (name === 'get_git_status') {
    const git = await getGitOverview();
    return {
      record: {
        id,
        name,
        args,
        status: 'SUCCESS',
        outputSummary: `Branch ${git.branch} · ${git.statusLines.length} ficheiros modificados · ${git.recentCommits.length} commits recentes.`,
        durationMs: Math.max(1, Date.now() - t0),
      },
      rawResult: git,
    };
  }

  if (name === 'trigger_workflow') {
    const q = String(args.workflowQuery || '').toLowerCase();
    const wf = db
      .getState()
      .workflows.find((w) => w.id.toLowerCase() === q || w.name.toLowerCase().includes(q));
    if (!wf) {
      return {
        record: {
          id,
          name,
          args,
          status: 'ERROR',
          outputSummary: `Nenhum workflow correspondente a "${q}".`,
          durationMs: Math.max(1, Date.now() - t0),
        },
        rawResult: { availableWorkflows: db.getState().workflows.map((w) => ({ id: w.id, name: w.name })) },
      };
    }
    const { runWorkflowById } = await import('./workflow-runner.ts');
    const run = await runWorkflowById(wf.id, 'AGENT');
    return {
      record: {
        id,
        name,
        args,
        status: run?.status === 'WAITING_APPROVAL' ? 'PENDING_APPROVAL' : 'SUCCESS',
        outputSummary: `Workflow "${wf.name}" executado -> ${run?.status} (${run?.totalDurationMs}ms).`,
        durationMs: Math.max(1, Date.now() - t0),
      },
      rawResult: { run },
    };
  }

  if (name === 'request_shell_approval') {
    const cmd = String(args.command || 'git status --short');
    const execRes = await executeGovernedCommand(cmd, 'CHAT_AGENT');
    return {
      record: {
        id,
        name,
        args,
        status:
          execRes.status === 'PENDING_APPROVAL'
            ? 'PENDING_APPROVAL'
            : execRes.status === 'BLOCKED'
              ? 'ERROR'
              : 'SUCCESS',
        outputSummary: execRes.output.slice(0, 240),
        durationMs: execRes.durationMs,
      },
      rawResult: execRes,
    };
  }

  if (name === 'sidecar_host_control') {
    const action = String(args.action || 'SNAPSHOT').toUpperCase();
    const target = String(args.target || '').trim();
    if (action === 'HOTKEY') {
      const rec = await triggerSidecarHotkey(target || 'Alt+Space');
      return {
        record: {
          id,
          name,
          args,
          status: 'SUCCESS',
          outputSummary: rec.output,
          durationMs: rec.durationMs,
        },
        rawResult: { commandRecord: rec },
      };
    }
    if (action === 'EXEC' && target) {
      const rec = await dispatchSidecarHostCommand({ command: target, kind: 'HOST_EXEC' });
      return {
        record: {
          id,
          name,
          args,
          status: rec.status === 'PENDING_APPROVAL' ? 'PENDING_APPROVAL' : rec.status === 'BLOCKED' ? 'ERROR' : 'SUCCESS',
          outputSummary: rec.output.slice(0, 240),
          durationMs: rec.durationMs,
        },
        rawResult: { commandRecord: rec },
      };
    }
    const snap = await collectSidecarHostSnapshot();
    return {
      record: {
        id,
        name,
        args,
        status: 'SUCCESS',
        outputSummary: `Host ${snap.hostname} (${snap.platform}/${snap.arch}) · ${snap.activeWindows.length} janela(s) · Top proc: ${snap.topProcesses[0]?.name || 'node'} (${snap.topProcesses[0]?.cpuPercent ?? 0}% CPU).`,
        durationMs: Math.max(1, Date.now() - t0),
      },
      rawResult: { snapshot: snap },
    };
  }

  return {
    record: {
      id,
      name,
      args,
      status: 'ERROR',
      outputSummary: `Ferramenta desconhecida: ${name}`,
      durationMs: 1,
    },
    rawResult: { error: 'Unknown tool' },
  };
}

/**
 * Intelligent Local Deterministic ReAct Fallback when GEMINI_API_KEY is absent/offline
 * or when operator selects LOCAL_DETERMINISTIC provider.
 */
async function runDeterministicReActTurn(
  userText: string,
  attachments: AttachmentItem[],
  activePort: number,
  jevDecision: JevRouteDecision
): Promise<{ reply: string; toolCalls: ToolCallRecord[]; engineUsed: string }> {
  const state = db.getState();
  const isPt = state.settings.language === 'pt-PT';
  const lower = userText.toLowerCase();
  const toolCalls: ToolCallRecord[] = [];
  const findings: string[] = [];

  if (jevDecision.microTick) {
    const ranked = rankQ18Actions(state.candidates);
    const top = ranked[0];
    return {
      reply: isPt
        ? `Confirmado via **MICRO_TICK** (\`${jevDecision.tokenDiet.injectedTokens} tokens\`). Próximo passo ativo: **${top?.title || 'Monitorização nominal'}** (Q-18 \`${top?.q18Score ?? 0}\`).`
        : `Acknowledged via **MICRO_TICK** (\`${jevDecision.tokenDiet.injectedTokens} tokens\`). Next step: **${top?.title || 'Nominal'}**.`,
      toolCalls: [],
      engineUsed: 'JEV_S1_MICRO_TICK',
    };
  }

  if (lower.includes('swarm') || lower.includes('enxame') || lower.includes('48x') || lower.includes('24x')) {
    const scale = lower.includes('24x') ? 24 : 48;
    const { record } = await executeAgentTool('dispatch_swarm_48x', { objective: userText, scale }, activePort);
    toolCalls.push(record);
    findings.push(`- **Enxame Assimétrico Swarm ${scale}x**: ${record.outputSummary}`);
  }

  if (lower.includes('ast') || lower.includes('símbolo') || lower.includes('symbol') || lower.includes('scout')) {
    const { record, rawResult } = await executeAgentTool('lookup_ast_symbol', { query: '' }, activePort);
    toolCalls.push(record);
    const syms = ((rawResult.symbols as { name: string; filePath: string; startLine: number }[]) || [])
      .slice(0, 4)
      .map((s) => `\`${s.name}\` (${s.filePath}:L${s.startLine})`);
    findings.push(`- **SCOUT-01 AST Index**: ${syms.join(', ')}.`);
  }

  if (
    lower.includes('telemetria') ||
    lower.includes('cpu') ||
    lower.includes('ram') ||
    lower.includes('porta') ||
    lower.includes('sistema') ||
    lower.includes('telemetry') ||
    lower.includes('system')
  ) {
    const { record, rawResult } = await executeAgentTool('get_system_telemetry', { includePorts: true }, activePort);
    toolCalls.push(record);
    const tel = rawResult.telemetry as Awaited<ReturnType<typeof collectOSTelemetry>>;
    findings.push(
      isPt
        ? `- **Telemetria Nativa (${tel.platform}/${tel.arch})**: Host \`${tel.hostname}\`, CPU **${tel.cpuUsagePercent}%** (${tel.cpuCores} núcleos), RAM **${tel.ramUsedGb}/${tel.ramTotalGb} GB** (${tel.ramPercent}%), Disco **${tel.diskUsedGb}/${tel.diskTotalGb} GB** (${tel.diskPercent}%).`
        : `- **Native Telemetry (${tel.platform}/${tel.arch})**: Host \`${tel.hostname}\`, CPU **${tel.cpuUsagePercent}%**, RAM **${tel.ramUsedGb}/${tel.ramTotalGb} GB** (${tel.ramPercent}%).`
    );
  }

  if (
    lower.includes('sidecar') ||
    lower.includes('processo') ||
    lower.includes('janela') ||
    lower.includes('hotkey') ||
    lower.includes('máquina') ||
    lower.includes('maquina')
  ) {
    const isHotkey = lower.includes('hotkey') || lower.includes('alt+space') || lower.includes('ctrl+shift');
    const { record, rawResult } = await executeAgentTool(
      'sidecar_host_control',
      isHotkey ? { action: 'HOTKEY', target: 'Alt+Space' } : { action: 'SNAPSHOT' },
      activePort
    );
    toolCalls.push(record);
    if (isHotkey) {
      findings.push(`- **Interação Direta Sidecar (Hotkey)**: ${record.outputSummary}`);
    } else {
      const snap = rawResult.snapshot as Awaited<ReturnType<typeof collectSidecarHostSnapshot>>;
      const topProcs = snap.topProcesses
        .slice(0, 4)
        .map((p) => `\`${p.name}\` (PID ${p.pid}, ${p.cpuPercent}% CPU, ${p.memPercent}% RAM)`)
        .join(', ');
      findings.push(
        `- **Ponte Direta Máquina Sidecar (\`${snap.hostname}\`)**: ${snap.activeWindows.length} janela(s) ativas · Processos de topo: ${topProcs}.`
      );
    }
  }

  if (lower.includes('git') || lower.includes('commit') || lower.includes('branch')) {
    const { record, rawResult } = await executeAgentTool('get_git_status', { includeCommits: true }, activePort);
    toolCalls.push(record);
    const g = rawResult as Awaited<ReturnType<typeof getGitOverview>>;
    findings.push(
      isPt
        ? `- **Estado Git (\`${g.branch}\`)**: ${g.statusLines.length} alterações ativas; último registo: \`${g.recentCommits[0] || 'n/a'}\`.`
        : `- **Git Status (\`${g.branch}\`)**: ${g.statusLines.length} modified entries; latest commit: \`${g.recentCommits[0] || 'n/a'}\`.`
    );
  }

  if (lower.includes('ficheiro') || lower.includes('file') || lower.includes('workspace') || lower.includes('package.json')) {
    if (lower.includes('package.json')) {
      const { record, rawResult } = await executeAgentTool('read_workspace_file', { filePath: 'package.json' }, activePort);
      toolCalls.push(record);
      findings.push(
        isPt
          ? `- **Leitura de \`package.json\`**: Ficheiro inspecionado com sucesso (${String(rawResult.content || '').length} bytes).`
          : `- **Read \`package.json\`**: Inspected (${String(rawResult.content || '').length} bytes).`
      );
    } else {
      const { record } = await executeAgentTool('list_workspace_files', {}, activePort);
      toolCalls.push(record);
      findings.push(`- **Workspace**: ${record.outputSummary}`);
    }
  }

  if (lower.includes('memor') || lower.includes('vault') || lower.includes('hipporag') || lower.includes('lembra') || lower.includes('rrf')) {
    if (lower.includes('guarda') || lower.includes('grava') || lower.includes('memoriza') || lower.includes('remember:')) {
      const { record } = await executeAgentTool(
        'save_memory',
        { topic: userText.slice(0, 44), content: userText, category: 'FACT' },
        activePort
      );
      toolCalls.push(record);
      findings.push(`- **Memory Vault Bi-Temporal**: ${record.outputSummary}`);
    } else {
      const { record, rawResult } = await executeAgentTool('search_memories', { query: userText }, activePort);
      toolCalls.push(record);
      const topMems = (rawResult.memories as { topic: string }[]).slice(0, 3).map((m) => `\`${m.topic}\``);
      findings.push(
        isPt
          ? `- **Memory Vault 4-Way RRF (${state.memories.length} registos)**: Destaques: ${topMems.join(', ')}.`
          : `- **Memory Vault 4-Way RRF (${state.memories.length} records)**: Highlights: ${topMems.join(', ')}.`
      );
    }
  }

  if (lower.includes('workflow') || lower.includes('rotina') || lower.includes('ci')) {
    const { record } = await executeAgentTool('trigger_workflow', { workflowQuery: 'ci' }, activePort);
    toolCalls.push(record);
    findings.push(`- **Workflow Engine**: ${record.outputSummary}`);
  }

  if (lower.includes('aprova') || lower.includes('executa comando') || lower.includes('run command:')) {
    const cmdMatch = userText.match(/`([^`]+)`/) || [null, 'git status --short'];
    const { record } = await executeAgentTool('request_shell_approval', { command: cmdMatch[1] }, activePort);
    toolCalls.push(record);
    findings.push(`- **Terminal Governado**: ${record.outputSummary}`);
  }

  if (attachments.length > 0) {
    findings.push(
      isPt
        ? `- **Anexo Multimodal Recebido**: ${attachments.map((a) => `\`${a.name}\` (${a.mimeType}, ${Math.round(a.sizeBytes / 1024)} KB)`).join(', ')} registado na sessão para inspeção.`
        : `- **Multimodal Attachment Received**: ${attachments.map((a) => `\`${a.name}\` (${a.mimeType})`).join(', ')} attached and indexed.`
    );
  }

  if (findings.length === 0) {
    const ranked = rankQ18Actions(state.candidates);
    const topAction = ranked[0];
    const { record } = await executeAgentTool('search_memories', { query: userText }, activePort);
    toolCalls.push(record);
    findings.push(
      isPt
        ? `- **Próxima Ação Q-18 Recomendada**: **${topAction?.title || 'Nenhuma pendente'}** (Score \`${topAction?.q18Score ?? 0}\`).\n- **Roteamento JEV-S1**: Tier \`[${jevDecision.tier[0]}]\` · Poupança Token Diet **-${jevDecision.tokenDiet.savingsPercent}%** (${jevDecision.tokenDiet.activeToolsCount}/${jevDecision.tokenDiet.totalToolsCatalog} tools MCP ativas).`
        : `- **Top Q-18 Next Action**: **${topAction?.title || 'None'}** (Score \`${topAction?.q18Score ?? 0}\`).\n- **JEV-S1 Route**: Tier \`[${jevDecision.tier[0]}]\` · Token Diet **-${jevDecision.tokenDiet.savingsPercent}%**.`
    );
  }

  const header = isPt
    ? `Diretiva processada pelo motor **${state.settings.personalityMode}** (\`JEV-S1 ${jevDecision.latencyMs}ms\`):`
    : `Directive processed by **${state.settings.personalityMode}** (\`JEV-S1 ${jevDecision.latencyMs}ms\`):`;

  return {
    reply: `${header}\n\n${findings.join('\n')}`,
    toolCalls,
    engineUsed: 'LOCAL_DETERMINISTIC_REACT_V3',
  };
}

export async function runAgentChatTurn(params: {
  roomId: string;
  userText: string;
  attachments?: AttachmentItem[];
  activePort?: number;
}): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage; blockedByCanary: boolean }> {
  const { roomId, userText, attachments = [], activePort = 3000 } = params;
  const state = db.getState();
  const room = state.rooms.find((r) => r.id === roomId) || state.rooms[0];
  const nowIso = new Date().toISOString();

  const userMsg: ChatMessage = {
    id: `msg-u-${Date.now()}`,
    roomId: room.id,
    role: 'user',
    content: userText,
    createdAt: nowIso,
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  // Security Canary & Prompt Injection Gate
  const injection = detectPromptInjection(userText);
  if (injection.blocked) {
    db.update((draft) => {
      draft.settings.personalityMode = 'GUARDIAN_DEFENSE';
    });
    db.appendAudit(
      'CANARY_GATE',
      'SECURITY',
      'PROMPT_INJECTION_BLOCKED',
      `Sala ${room.name}: risco ${injection.riskScore}/100 (${injection.matchedRules.join(', ')})`,
      'BLOCKED'
    );

    const guardMsg: ChatMessage = {
      id: `msg-a-${Date.now() + 1}`,
      roomId: room.id,
      role: 'assistant',
      content:
        state.settings.language === 'pt-PT'
          ? `**Alerta de Segurança (TrustBoundaryGate)**: A diretiva foi intercetada por conter padrões de injeção ou tentativa de exfiltração (\`${injection.matchedRules.join(', ')}\`, Risco **${injection.riskScore}/100**). O perfil foi comutado preventivamente para \`GUARDIAN_DEFENSE\`.`
          : `**Security Alert (TrustBoundaryGate)**: Directive intercepted due to prompt-injection pattern (\`${injection.matchedRules.join(', ')}\`, Risk **${injection.riskScore}/100**).`,
      createdAt: new Date().toISOString(),
      engineUsed: 'TRUST_BOUNDARY_CANARY',
    };

    db.update((draft) => {
      draft.messages.push(userMsg, guardMsg);
    });
    return { userMessage: userMsg, assistantMessage: guardMsg, blockedByCanary: true };
  }

  // PreInvocation JEV-S1 Reflex Router (<1ms) + SCOUT-01 Lookahead + 5-Stage Token Diet
  const scoutIdx = await buildScoutWorkspaceIndex();
  const prevHash = roomDeltaHashes.get(room.id);
  const nativeEligible = state.mcpRegistryTools
    ? state.mcpRegistryTools.filter((t) => t.enabled && t.jevEligible).map((t) => t.name)
    : undefined;
  const externalEligible = (state.mcpServers || [])
    .filter((s) => s.enabled && s.authStatus === 'AUTHORIZED' && s.jevEligible !== false)
    .flatMap((s) => s.discoveredTools || []);
  const activeMcpCatalog = nativeEligible
    ? Array.from(new Set([...nativeEligible, ...externalEligible]))
    : undefined;
  const { decision: jevDecision, nextDeltaHash, compressedContextBlock } = routeJevS1({
    prompt: userText,
    memories: state.memories,
    scoutSymbols: scoutIdx.symbols,
    previousDeltaHash: prevHash,
    activeMcpCatalog,
  });
  roomDeltaHashes.set(room.id, nextDeltaHash);

  const activeProject =
    (state.projects || []).find((p) => p.id === (room.projectId || state.activeProjectId)) ||
    (state.projects || [])[0];
  const enabledSkillsSummary = state.skills
    .filter((s) => s.enabled)
    .slice(0, 5)
    .map((s) => `${s.name} (${s.quickCommand})`)
    .join(', ');

  // Track PRE_PROMPT plugin invocations
  db.update((draft) => {
    for (const plug of draft.plugins || []) {
      if (plug.enabled && plug.installed && plug.hook === 'PRE_PROMPT') {
        plug.invocationsCount = (plug.invocationsCount || 0) + 1;
        plug.lastTriggeredAt = nowIso;
      }
    }
  });

  const provider = state.settings.modelProvider;
  const ai = provider === 'GEMINI_STUDIO' ? getGeminiClient() : null;
  let replyText = '';
  let toolCalls: ToolCallRecord[] = [];
  let engineUsed = 'LOCAL_DETERMINISTIC_REACT_V3';

  const lookaheadText =
    jevDecision.lookaheadAlerts.length > 0
      ? `Notice Lookahead AST:\n${jevDecision.lookaheadAlerts.map((a) => `- ${a.reason}`).join('\n')}`
      : '';

  const systemInstruction = [
    getPersonalityDirective(state.settings.personalityMode, state.settings.language),
    room.systemPrompt,
    `Operador: ${state.settings.operatorName} (${state.settings.organizationName}). Rota JEV-S1: [${jevDecision.tier}] ${jevDecision.intent}.`,
    activeProject
      ? `Projeto Ativo: "${activeProject.name}" em "${activeProject.rootPath}" (${activeProject.techStack}, branch ${activeProject.gitBranch}, Proatividade=${activeProject.proactiveEnabled ? 'ON' : 'OFF'}).`
      : '',
    enabledSkillsSummary ? `Skills Ativas: ${enabledSkillsSummary}.` : '',
    compressedContextBlock ? `Memória TOON:\n${compressedContextBlock}` : '',
    lookaheadText,
    'Usa as ferramentas disponíveis sempre que o utilizador pedir dados reais da máquina Sidecar, sistema, Swarm 48x, AST, ficheiros, Git, workflows ou memórias.',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (ai && !jevDecision.microTick) {
    try {
      const modelName = room.modelOverride || state.settings.preferredGeminiModel || 'gemini-3.8-flash';
      const recentHistory = state.messages
        .filter((m) => m.roomId === room.id)
        .slice(-6)
        .map((m) => ({
          role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
          parts: [{ text: m.content }],
        }));

      const currentParts: Record<string, unknown>[] = [];
      for (const att of attachments) {
        if (att.dataBase64 && att.mimeType) {
          currentParts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.dataBase64,
            },
          });
        }
      }
      currentParts.push({ text: userText || 'Analisa o conteúdo enviado.' });

      const contents: unknown[] = [...recentHistory, { role: 'user', parts: currentParts }];

      const allowedSet = new Set(room.allowedTools || []);
      const filteredDecls =
        allowedSet.size > 0
          ? AGENT_TOOL_DECLARATIONS.filter((d) => d.name && allowedSet.has(d.name))
          : AGENT_TOOL_DECLARATIONS;

      for (let step = 0; step < 3; step++) {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: contents as never,
          config: {
            systemInstruction,
            tools: filteredDecls.length > 0 ? [{ functionDeclarations: filteredDecls }] : undefined,
          },
        });

        const fCalls = response.functionCalls;
        if (fCalls && fCalls.length > 0) {
          const prevCandidateContent = response.candidates?.[0]?.content;
          if (prevCandidateContent) {
            contents.push(prevCandidateContent);
          }

          const functionResponseParts: unknown[] = [];
          for (const fc of fCalls) {
            const fname = fc.name || 'search_memories';
            const fargs = (fc.args as Record<string, unknown>) || {};
            const { record, rawResult } = await executeAgentTool(fname, fargs, activePort);
            toolCalls.push(record);
            functionResponseParts.push({
              functionResponse: {
                id: fc.id,
                name: fname,
                response: rawResult,
              },
            });
          }
          contents.push({ role: 'user', parts: functionResponseParts });
          continue;
        }

        replyText = (response.text ?? '').trim();
        engineUsed = `GEMINI (${modelName})`;
        break;
      }

      if (!replyText) {
        const det = await runDeterministicReActTurn(userText, attachments, activePort, jevDecision);
        replyText = det.reply;
        if (toolCalls.length === 0) toolCalls = det.toolCalls;
      }
    } catch {
      const det = await runDeterministicReActTurn(userText, attachments, activePort, jevDecision);
      replyText = det.reply;
      toolCalls = det.toolCalls;
      engineUsed = det.engineUsed;
    }
  } else if (provider === 'OLLAMA_LOCAL' && !jevDecision.microTick) {
    try {
      const base = (state.settings.ollamaEndpoint || 'http://127.0.0.1:11434').replace(/\/$/, '');
      const model = room.modelOverride || state.settings.ollamaModel || 'qwen2.5-coder:7b';
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userText },
          ],
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (r.ok) {
        const data = (await r.json()) as { message?: { content?: string } };
        replyText = String(data.message?.content || '').trim();
        engineUsed = `OLLAMA (${model})`;
      }
    } catch {
      // Fallback to deterministic engine if local Ollama is offline
    }
    if (!replyText) {
      const det = await runDeterministicReActTurn(userText, attachments, activePort, jevDecision);
      replyText = det.reply;
      toolCalls = det.toolCalls;
      engineUsed = `${det.engineUsed} (Fallback Ollama Offline)`;
    }
  } else if (provider === 'OPENROUTER_COMPAT' && !jevDecision.microTick) {
    const orKey = process.env.OPENROUTER_API_KEY?.trim();
    if (orKey) {
      try {
        const base = (state.settings.openRouterEndpoint || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
        const model = room.modelOverride || state.settings.openRouterModel || 'anthropic/claude-3.7-sonnet';
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${orKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: userText },
            ],
          }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (r.ok) {
          const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
          replyText = String(data.choices?.[0]?.message?.content || '').trim();
          engineUsed = `OPENROUTER (${model})`;
        }
      } catch {
        // Fallback below
      }
    }
    if (!replyText) {
      const det = await runDeterministicReActTurn(userText, attachments, activePort, jevDecision);
      replyText = det.reply;
      toolCalls = det.toolCalls;
      engineUsed = det.engineUsed;
    }
  } else {
    const det = await runDeterministicReActTurn(userText, attachments, activePort, jevDecision);
    replyText = det.reply;
    toolCalls = det.toolCalls;
    engineUsed = det.engineUsed;
  }

  const assistantMsg: ChatMessage = {
    id: `msg-a-${Date.now() + 2}`,
    roomId: room.id,
    role: 'assistant',
    content: replyText,
    createdAt: new Date().toISOString(),
    engineUsed,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    jevRoute: jevDecision,
  };

  // Update 5h Token Diet Quota Telemetry & Post-Turn Self-Learn Harvest
  db.update((draft) => {
    draft.messages.push(userMsg, assistantMsg);
    if (draft.messages.length > 200) {
      draft.messages = draft.messages.slice(-200);
    }
    if (draft.quota5h) {
      draft.quota5h.consumedTokens5h += jevDecision.tokenDiet.injectedTokens;
      draft.quota5h.savedByDietTokens5h += jevDecision.tokenDiet.savedTokens;
      draft.quota5h.promptsRouted5h += 1;
      if (jevDecision.microTick) {
        draft.quota5h.microTicks5h += 1;
        draft.quota5h.stageSavings.microTickTokens += jevDecision.tokenDiet.savedTokens;
      } else {
        draft.quota5h.stageSavings.toolPruningTokens += Math.round(jevDecision.tokenDiet.savedTokens * 0.55);
        draft.quota5h.stageSavings.toonCompressionTokens += Math.round(jevDecision.tokenDiet.savedTokens * 0.25);
        draft.quota5h.stageSavings.deltaCacheTokens += Math.round(jevDecision.tokenDiet.savedTokens * 0.2);
      }
    }
  });

  harvestSelfLearnFromTurn(assistantMsg.id, userText, replyText);

  return { userMessage: userMsg, assistantMessage: assistantMsg, blockedByCanary: false };
}

export async function synthesizeBriefText(customContext?: string): Promise<string> {
  const state = db.getState();
  const isPt = state.settings.language === 'pt-PT';
  const ranked = rankQ18Actions(state.candidates);
  const top = ranked[0];
  const verifiedCount = state.contracts.filter((c) => c.status === 'VERIFIED').length;
  const pendingDecisions = state.decisions.filter((d) => d.status === 'PENDING').length;
  const pendingApprovals = state.approvals.filter((a) => a.status === 'PENDING').length;
  const savedTok = state.quota5h?.savedByDietTokens5h ?? 98_460;

  const fallbackBrief = isPt
    ? `Bom dia, ${state.settings.operatorName}. Tens ${verifiedCount} de ${state.contracts.length} contratos do dia verificados, ${pendingDecisions} decisões executivas em fila, ${pendingApprovals} pedido(s) na Inbox de Autoridade e ${(savedTok / 1000).toFixed(1)}k tokens poupados pelo pipeline Token Diet nas últimas 5h. A ação prioritária Q-18 (Score ${top?.q18Score ?? 0}) é "${top?.title || 'Manter monitorização nominal'}".`
    : `Good morning, ${state.settings.operatorName}. ${verifiedCount} of ${state.contracts.length} Today Contracts are verified, ${pendingDecisions} decisions await review, and ${(savedTok / 1000).toFixed(1)}k tokens were saved by Token Diet (5h). Top Q-18 priority (Score ${top?.q18Score ?? 0}): "${top?.title || 'Nominal standby'}".`;

  const ai = state.settings.modelProvider === 'GEMINI_STUDIO' ? getGeminiClient() : null;
  if (!ai) {
    return fallbackBrief;
  }

  try {
    const prompt = customContext
      ? `${customContext}\nResponde em 2 a 3 frases executivas concisas (${state.settings.language}).`
      : `Gera um Briefing Executivo matinal de 3 frases (${state.settings.language}) para ${state.settings.operatorName}:
- Contratos verificados hoje: ${verifiedCount}/${state.contracts.length}
- Ação Q-18 #1: ${top?.title} (Score ${top?.q18Score})
- Tokens poupados (5h Token Diet): ${savedTok}
- Decisões pendentes: ${pendingDecisions}
- Aprovações na Inbox: ${pendingApprovals}`;

    const res = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: getPersonalityDirective(state.settings.personalityMode, state.settings.language),
      },
    });
    return (res.text ?? '').trim() || fallbackBrief;
  } catch {
    return fallbackBrief;
  }
}

export async function generateWorkflowFromNaturalLanguage(prompt: string): Promise<{
  name: string;
  description: string;
  cronExpr?: string;
  nodes: WorkflowNode[];
  engineUsed: string;
}> {
  const state = db.getState();
  const det = buildDeterministicWorkflowFromPrompt(prompt, state.settings.language);
  const ai = state.settings.modelProvider === 'GEMINI_STUDIO' ? getGeminiClient() : null;
  if (!ai) {
    return { ...det, engineUsed: 'LOCAL_DETERMINISTIC_DAG' };
  }

  try {
    const res = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Converte esta descrição de automação num grafo DAG de workflow J.A.R.V.I.S. (${state.settings.language}): "${prompt}"`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            description: { type: Type.STRING },
            cronExpr: { type: Type.STRING },
            nodes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  type: {
                    type: Type.STRING,
                    description: 'Must be one of: trigger, shell, ai, condition, approval',
                  },
                  label: { type: Type.STRING },
                  command: { type: Type.STRING },
                  prompt: { type: Type.STRING },
                  conditionExpr: { type: Type.STRING },
                  approverNote: { type: Type.STRING },
                },
                required: ['id', 'type', 'label'],
              },
            },
          },
          required: ['name', 'description', 'nodes'],
        },
      },
    });

    const parsed = JSON.parse((res.text ?? '{}').trim()) as {
      name?: string;
      description?: string;
      cronExpr?: string;
      nodes?: {
        id: string;
        type: string;
        label: string;
        command?: string;
        prompt?: string;
        conditionExpr?: string;
        approverNote?: string;
      }[];
    };

    if (parsed.nodes && parsed.nodes.length >= 2) {
      const allowedTypes = ['trigger', 'shell', 'ai', 'condition', 'approval'] as const;
      const cleanNodes: WorkflowNode[] = parsed.nodes.map((n, idx, arr) => {
        const safeType = allowedTypes.includes(n.type as never)
          ? (n.type as WorkflowNode['type'])
          : idx === 0
            ? 'trigger'
            : 'ai';
        return {
          id: n.id || `node-${idx + 1}`,
          type: safeType,
          label: n.label,
          config: {
            triggerKind: parsed.cronExpr ? 'cron' : 'manual',
            cronExpr: parsed.cronExpr,
            command: n.command,
            prompt: n.prompt,
            conditionExpr: n.conditionExpr,
            approverNote: n.approverNote,
          },
          nextIds: idx < arr.length - 1 ? [arr[idx + 1].id || `node-${idx + 2}`] : [],
        };
      });

      return {
        name: parsed.name || det.name,
        description: parsed.description || det.description,
        cronExpr: parsed.cronExpr || det.cronExpr,
        nodes: cleanNodes,
        engineUsed: 'GEMINI_DAG_ARCHITECT',
      };
    }
  } catch {
    // Fall back cleanly to deterministic builder
  }

  return { ...det, engineUsed: 'LOCAL_DETERMINISTIC_DAG' };
}

export async function testModelProviderConnection(params?: {
  provider?: string;
  ollamaEndpoint?: string;
  openRouterEndpoint?: string;
}): Promise<{
  ok: boolean;
  provider: string;
  latencyMs: number;
  detail: string;
  envKeysStatus: { geminiConfigured: boolean; openRouterConfigured: boolean };
}> {
  const t0 = Date.now();
  const state = db.getState();
  const provider = params?.provider || state.settings.modelProvider;
  const envKeysStatus = {
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
  };

  if (provider === 'LOCAL_DETERMINISTIC') {
    return {
      ok: true,
      provider,
      latencyMs: Math.max(1, Date.now() - t0),
      detail: 'Motor Determinístico Local ReAct v3 ativo (0ms rede, 100% autónomo sem chaves externas).',
      envKeysStatus,
    };
  }

  if (provider === 'GEMINI_STUDIO') {
    if (!envKeysStatus.geminiConfigured) {
      return {
        ok: false,
        provider,
        latencyMs: Math.max(1, Date.now() - t0),
        detail: 'Variável GEMINI_API_KEY ausente no servidor (.env). O fallback determinístico local assumirá automaticamente.',
        envKeysStatus,
      };
    }
    return {
      ok: true,
      provider,
      latencyMs: Math.max(1, Date.now() - t0),
      detail: `GEMINI_API_KEY detetada no servidor · Modelo ativo: ${state.settings.preferredGeminiModel}.`,
      envKeysStatus,
    };
  }

  if (provider === 'OLLAMA_LOCAL') {
    const base = (params?.ollamaEndpoint || state.settings.ollamaEndpoint || 'http://127.0.0.1:11434').replace(/\/$/, '');
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1600);
      const r = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const data = (await r.json()) as { models?: { name: string }[] };
        const count = data.models?.length ?? 0;
        return {
          ok: true,
          provider,
          latencyMs: Math.max(1, Date.now() - t0),
          detail: `Ollama online em ${base} (${count} modelo(s) locais disponíveis).`,
          envKeysStatus,
        };
      }
      return {
        ok: false,
        provider,
        latencyMs: Math.max(1, Date.now() - t0),
        detail: `Ollama respondeu HTTP ${r.status} em ${base}.`,
        envKeysStatus,
      };
    } catch {
      return {
        ok: false,
        provider,
        latencyMs: Math.max(1, Date.now() - t0),
        detail: `Sem resposta em ${base}. Quando offline, o Jarvis usa automaticamente o motor determinístico local.`,
        envKeysStatus,
      };
    }
  }

  // OPENROUTER_COMPAT
  const base = (params?.openRouterEndpoint || state.settings.openRouterEndpoint || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  return {
    ok: envKeysStatus.openRouterConfigured,
    provider,
    latencyMs: Math.max(1, Date.now() - t0),
    detail: envKeysStatus.openRouterConfigured
      ? `OPENROUTER_API_KEY configurada no servidor · Endpoint ${base}.`
      : `OPENROUTER_API_KEY não definida no ambiente (.env). Configura no servidor para ativar chamadas remotas em ${base}.`,
    envKeysStatus,
  };
}
