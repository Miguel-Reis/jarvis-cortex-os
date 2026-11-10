import type {
  McpCustomServer,
  McpRegistryResourceItem,
  McpRegistryToolItem,
  McpStandardLibraryItem,
} from './types.ts';

export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    idempotentHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
  };
}

export const MCP_2026_TOOLS: McpToolSpec[] = [
  {
    name: 'store_fact',
    description:
      'Guarda um facto, decisão ou entidade bi-temporal no Brain Vault com superação automática de contradições e indexação BQ 128-bit.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        content: { type: 'string' },
        category: { type: 'string', enum: ['FACT', 'ENTITY', 'PREFERENCE', 'DECISION', 'COMMITMENT'] },
        tier: { type: 'string', enum: ['WORKING', 'EPISODIC', 'SEMANTIC'] },
      },
      required: ['topic', 'content'],
    },
    annotations: {
      title: 'Guardar Facto Bi-Temporal',
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'search_brain',
    description:
      'Pesquisa 4-Way Weighted RRF (k=60) combinando BM25 + Quantização Binária 128-Bit + HippoRAG 2 PPR + retenção Ebbinghaus.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        includeSuperseded: { type: 'boolean' },
      },
      required: ['query'],
    },
    annotations: {
      title: 'Pesquisa 4-Way RRF Brain',
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'forget_fact',
    description: 'Arquiva bi-temporalmente ou remove definitivamente um item de memória por ID.',
    inputSchema: {
      type: 'object',
      properties: {
        memoryId: { type: 'string' },
        hardDelete: { type: 'boolean' },
      },
      required: ['memoryId'],
    },
    annotations: {
      title: 'Arquivar / Esquecer Facto',
      readOnlyHint: false,
      idempotentHint: true,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'save_checkpoint',
    description: 'Grava um checkpoint cognitivo comprimido em formato TOON para retoma imediata de sessão.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['summary'],
    },
    annotations: {
      title: 'Gravar Checkpoint Cognitivo',
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'brain_stats',
    description:
      'Devolve estatísticas em tempo real das camadas de memória ([W]/[E]/[S]), arestas do grafo, Token Diet e ponte :8765.',
    inputSchema: { type: 'object', properties: {} },
    annotations: {
      title: 'Estatísticas do Motor Brain',
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'brain_prune_tools',
    description:
      'Poda dinâmica JEV-S1: seleciona as 4 a 6 ferramentas MCP de maior relevância para um prompt (-96% overhead de schema).',
    inputSchema: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'],
    },
    annotations: {
      title: 'Poda Dinâmica JEV-S1',
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'swarm_scout',
    description:
      'Executa SCOUT-01 uma única vez para construir o mapa partilhado de símbolos AST (:Lstart-end) e acoplamento Git Co-Change.',
    inputSchema: {
      type: 'object',
      properties: { forceRefresh: { type: 'boolean' } },
    },
    annotations: {
      title: 'Mapa Partilhado SCOUT-01',
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'swarm_start',
    description:
      'Despacha um enxame assimétrico (24x ou 48x tarefas em UI, API, TESTS, DOCS) com convergência Ruflo EMA e Dual Verify Gates.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string' },
        scale: { type: 'number', enum: [24, 48] },
      },
      required: ['objective'],
    },
    annotations: {
      title: 'Lançar Enxame Swarm 24x/48x',
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'swarm_update_task',
    description: 'Atualiza o estado ou pontuação de feromona de uma tarefa Swarm ou nó DOTS DAG.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        status: { type: 'string', enum: ['READY', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'] },
      },
      required: ['taskId', 'status'],
    },
    annotations: {
      title: 'Atualizar Tarefa Swarm / DOTS',
      readOnlyHint: false,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'swarm_status',
    description: 'Consulta a execução mais recente do Swarm 48x, convergência por lane e métricas 96/96 Verify Gates.',
    inputSchema: { type: 'object', properties: {} },
    annotations: {
      title: 'Estado da Frota Swarm',
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'swarm_sandbox',
    description:
      'Gere Sandboxes Copy-on-Write de subagentes (snapshot zlib+SHA256, merge governado ou rollback físico atómico).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'rollback', 'merge', 'list'] },
        sandboxId: { type: 'string' },
        label: { type: 'string' },
      },
      required: ['action'],
    },
    annotations: {
      title: 'Sandbox Transacional CoW',
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'swarm_symbol_lookup',
    description: 'Pesquisa símbolos AST (funções, classes, interfaces, rotas) com intervalos de linha exatos :Lstart-end.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    annotations: {
      title: 'Pesquisa de Símbolos AST',
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'swarm_impact_graph',
    description: 'Calcula o raio de impacto AST + Git Co-Change de um ficheiro alvo antes de editar.',
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: ['filePath'],
    },
    annotations: {
      title: 'Grafo de Raio de Impacto',
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'swarm_watch_audit',
    description: 'Inspeciona entradas recentes de auditoria de segurança Swarm, Sandbox, Canary e MCP.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
    annotations: {
      title: 'Auditoria de Segurança & Swarm',
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'swarm_graph_path',
    description: 'Encontra o caminho mais curto BFS multimodal entre duas entidades ou memórias no grafo associativo.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string' },
        targetId: { type: 'string' },
      },
      required: ['sourceId', 'targetId'],
    },
    annotations: {
      title: 'Caminho Curto BFS no Grafo',
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'swarm_architecture_report',
    description:
      'Gera o relatório determinístico GRAPH_REPORT.md cobrindo hubs AST, acoplamento Git Co-Change e estatísticas bi-temporais.',
    inputSchema: { type: 'object', properties: {} },
    annotations: {
      title: 'Gerar GRAPH_REPORT.md',
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'orbit_mission_control',
    description:
      'Inspeciona ou difunde diretivas no Orbit Agent OS (DOTS DAG, Fleet Broadcast e Handoffs Human-Wins).',
    inputSchema: {
      type: 'object',
      properties: {
        broadcastDirective: { type: 'string' },
      },
    },
    annotations: {
      title: 'Controlo de Missão Orbit',
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'orbit_briefing_roi',
    description:
      'Obtém o Radar de Quota 5h, poupanças por etapa do Token Diet, taxa de aprovação Verify Gates e horas de engenharia poupadas.',
    inputSchema: { type: 'object', properties: {} },
    annotations: {
      title: 'Radar de Quota 5h & ROI',
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
];

export const MCP_2026_RESOURCES = [
  {
    uri: 'brain://pinned',
    name: 'Memórias Semânticas Afixadas',
    description: 'Factos e compromissos prioritários afixados em formato TOON.',
    mimeType: 'application/json',
  },
  {
    uri: 'brain://scout/map',
    name: 'Mapa Partilhado SCOUT-01',
    description: 'Mapa em cache de símbolos AST e importações partilhado pelos subagentes.',
    mimeType: 'application/json',
  },
  {
    uri: 'brain://graph/report',
    name: 'Relatório Arquitetural do Grafo',
    description: 'GRAPH_REPORT.md determinístico com hubs AST e acoplamento Git Co-Change.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'brain://orbit/briefing',
    name: 'Briefing de Missão Orbit & ROI 5h',
    description: 'Tarefas DOTS ativas, Fleet Broadcasts e telemetria Token Diet de 5 horas.',
    mimeType: 'application/json',
  },
];

export const MCP_2026_RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'brain://workspace/{ws}/checkpoint',
    name: 'Checkpoint Cognitivo de Workspace',
    description: 'Último checkpoint comprimido de sessão para um identificador de workspace.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'brain://symbol/{symbol}',
    name: 'Definição AST & Intervalo de Linhas',
    description: 'Definição exata :Lstart-end e raio de impacto de importações para um símbolo.',
    mimeType: 'application/json',
  },
];

export const MCP_2026_PROMPTS = [
  {
    name: 'ultraplan-scout',
    description: 'Prompt de Ultraplaneamento Arquitetural & Raio de Impacto SCOUT-01',
    arguments: [{ name: 'objective', description: 'Objetivo de engenharia a planear', required: true }],
  },
  {
    name: 'bugfix-lineage',
    description: 'Investigação de Causa Raiz Bi-Temporal & Linhagem Git Co-Change',
    arguments: [{ name: 'symptom', description: 'Sintoma observado ou teste falhado', required: true }],
  },
  {
    name: 'swarm-dispatch',
    description: 'Contrato de Despacho Swarm 48x Assimétrico (UI/API/TESTS/DOCS) com Dual Verify Gates',
    arguments: [{ name: 'feature', description: 'Funcionalidade a despachar nas 4 lanes', required: true }],
  },
];

/**
 * Curated Standard MCP Server Library across the 4 confirmed categories (14 official connectors)
 */
export const MCP_STANDARD_LIBRARY: McpStandardLibraryItem[] = [
  // 1. CORE_LOCAL: Filesystem, Git, Memory, SQLite
  {
    id: 'lib-filesystem',
    name: 'Filesystem Local Governado',
    slug: 'filesystem',
    category: 'CORE_LOCAL',
    description: 'Leitura, pesquisa e escrita confinada em diretórios autorizados do workspace local.',
    transport: 'STDIO',
    defaultEndpointOrCommand: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    requiredEnvKeys: [],
    sampleTools: ['read_file', 'write_file', 'list_directory', 'search_files'],
    version: '2026.1',
    officialPackage: '@modelcontextprotocol/server-filesystem',
  },
  {
    id: 'lib-git',
    name: 'Git Repository Inspector',
    slug: 'git',
    category: 'CORE_LOCAL',
    description: 'Inspeção de branches, diffs estruturados, blame, histórico de commits e árvores Git locais.',
    transport: 'STDIO',
    defaultEndpointOrCommand: 'uvx',
    defaultArgs: ['mcp-server-git', '--repository', '.'],
    requiredEnvKeys: [],
    sampleTools: ['git_status', 'git_diff_unstaged', 'git_log', 'git_show'],
    version: '2026.1',
    officialPackage: 'mcp-server-git',
  },
  {
    id: 'lib-memory',
    name: 'Knowledge Graph Memory',
    slug: 'memory',
    category: 'CORE_LOCAL',
    description: ' Servidor standard de entidades, relações e observações persistentes em grafo JSONL local.',
    transport: 'STDIO',
    defaultEndpointOrCommand: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-memory'],
    requiredEnvKeys: [],
    sampleTools: ['create_entities', 'create_relations', 'search_nodes', 'open_nodes'],
    version: '2026.1',
    officialPackage: '@modelcontextprotocol/server-memory',
  },
  {
    id: 'lib-sqlite',
    name: 'SQLite WAL Explorer',
    slug: 'sqlite',
    category: 'CORE_LOCAL',
    description: 'Consultas analíticas SQL parametrizadas, inspeção de tabelas e esquemas SQLite locais.',
    transport: 'STDIO',
    defaultEndpointOrCommand: 'uvx',
    defaultArgs: ['mcp-server-sqlite', '--db-path', './data/jarvis-v2.sqlite'],
    requiredEnvKeys: [],
    sampleTools: ['read_query', 'list_tables', 'describe_table', 'append_insight'],
    version: '2026.1',
    officialPackage: 'mcp-server-sqlite',
  },

  // 2. WEB_SEARCH: Fetch, Brave Search, Puppeteer
  {
    id: 'lib-fetch',
    name: 'Fetch Web Markdown Reader',
    slug: 'fetch',
    category: 'WEB_SEARCH',
    description: 'Extração limpa de páginas web e documentação técnica convertida automaticamente para Markdown.',
    transport: 'STDIO',
    defaultEndpointOrCommand: 'uvx',
    defaultArgs: ['mcp-server-fetch'],
    requiredEnvKeys: [],
    sampleTools: ['fetch_url', 'fetch_markdown'],
    version: '2026.1',
    officialPackage: 'mcp-server-fetch',
  },
  {
    id: 'lib-brave-search',
    name: 'Brave Search API',
    slug: 'brave-search',
    category: 'WEB_SEARCH',
    description: 'Pesquisa web e notícias em tempo real com baixa latência e controlo de frescura temporal.',
    transport: 'STDIO',
    defaultEndpointOrCommand: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-brave-search'],
    requiredEnvKeys: ['BRAVE_API_KEY'],
    sampleTools: ['brave_web_search', 'brave_local_search'],
    version: '2026.1',
    officialPackage: '@modelcontextprotocol/server-brave-search',
  },
  {
    id: 'lib-puppeteer',
    name: 'Puppeteer Headless Browser',
    slug: 'puppeteer',
    category: 'WEB_SEARCH',
    description: 'Automação de browser headless para navegação DOM, capturas de ecrã e verificação E2E.',
    transport: 'STDIO',
    defaultEndpointOrCommand: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-puppeteer'],
    requiredEnvKeys: [],
    sampleTools: ['puppeteer_navigate', 'puppeteer_screenshot', 'puppeteer_click', 'puppeteer_evaluate'],
    version: '2026.1',
    officialPackage: '@modelcontextprotocol/server-puppeteer',
  },

  // 3. CLOUD_DEVOPS: GitHub, PostgreSQL, Docker, Sentry
  {
    id: 'lib-github',
    name: 'GitHub Official MCP',
    slug: 'github',
    category: 'CLOUD_DEVOPS',
    description: 'Gestão de Pull Requests, Issues, Actions CI/CD, revisões de código e pesquisa de repositórios.',
    transport: 'HTTP_STREAMABLE',
    defaultEndpointOrCommand: 'https://api.githubcopilot.com/mcp/',
    defaultArgs: [],
    requiredEnvKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    sampleTools: ['get_pull_request', 'list_issues', 'create_pull_request', 'search_code'],
    version: '2026.2',
    officialPackage: '@modelcontextprotocol/server-github',
  },
  {
    id: 'lib-postgres',
    name: 'PostgreSQL Read-Only Inspector',
    slug: 'postgresql',
    category: 'CLOUD_DEVOPS',
    description: 'Inspeção segura de esquemas relacionais, planos EXPLAIN e consultas read-only em PostgreSQL.',
    transport: 'STDIO',
    defaultEndpointOrCommand: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-postgres'],
    requiredEnvKeys: ['POSTGRES_CONNECTION_STRING'],
    sampleTools: ['query', 'list_schemas', 'describe_table'],
    version: '2026.1',
    officialPackage: '@modelcontextprotocol/server-postgres',
  },
  {
    id: 'lib-docker',
    name: 'Docker Engine & Compose',
    slug: 'docker',
    category: 'CLOUD_DEVOPS',
    description: 'Observabilidade de contentores, logs de serviços, volumes, redes e stacks Docker Compose.',
    transport: 'STDIO',
    defaultEndpointOrCommand: 'uvx',
    defaultArgs: ['mcp-server-docker'],
    requiredEnvKeys: [],
    sampleTools: ['list_containers', 'get_container_logs', 'inspect_container', 'compose_ps'],
    version: '2026.1',
    officialPackage: 'mcp-server-docker',
  },
  {
    id: 'lib-sentry',
    name: 'Sentry Error Telemetry',
    slug: 'sentry',
    category: 'CLOUD_DEVOPS',
    description: 'Análise de stacktraces de produção, frequência de regressões e releases afetadas no Sentry.',
    transport: 'SSE',
    defaultEndpointOrCommand: 'https://mcp.sentry.dev/sse',
    defaultArgs: [],
    requiredEnvKeys: ['SENTRY_AUTH_TOKEN'],
    sampleTools: ['get_sentry_issue', 'list_project_issues', 'analyze_stacktrace'],
    version: '2026.2',
    officialPackage: '@modelcontextprotocol/server-sentry',
  },

  // 4. PRODUCTIVITY: Slack, Google Drive, Linear
  {
    id: 'lib-slack',
    name: 'Slack Workspace Bridge',
    slug: 'slack',
    category: 'PRODUCTIVITY',
    description: 'Pesquisa de threads técnicas, resumo de canais operacionais e publicação governada no Slack.',
    transport: 'STDIO',
    defaultEndpointOrCommand: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-slack'],
    requiredEnvKeys: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    sampleTools: ['slack_list_channels', 'slack_get_channel_history', 'slack_post_message'],
    version: '2026.1',
    officialPackage: '@modelcontextprotocol/server-slack',
  },
  {
    id: 'lib-gdrive',
    name: 'Google Drive & Docs Connector',
    slug: 'google-drive',
    category: 'PRODUCTIVITY',
    description: 'Pesquisa semântica e leitura de documentos de arquitetura, folhas de cálculo e especificações.',
    transport: 'STDIO',
    defaultEndpointOrCommand: 'npx',
    defaultArgs: ['-y', '@modelcontextprotocol/server-gdrive'],
    requiredEnvKeys: ['GDRIVE_CREDENTIALS_PATH'],
    sampleTools: ['gdrive_search', 'gdrive_read_file'],
    version: '2026.1',
    officialPackage: '@modelcontextprotocol/server-gdrive',
  },
  {
    id: 'lib-linear',
    name: 'Linear Engineering Tracker',
    slug: 'linear',
    category: 'PRODUCTIVITY',
    description: 'Sincronização bidirecional de issues, ciclos de sprint, roadmaps e triagem de bugs no Linear.',
    transport: 'SSE',
    defaultEndpointOrCommand: 'https://mcp.linear.app/sse',
    defaultArgs: [],
    requiredEnvKeys: ['LINEAR_API_KEY'],
    sampleTools: ['linear_search_issues', 'linear_create_issue', 'linear_get_cycle'],
    version: '2026.2',
    officialPackage: 'mcp.linear.app',
  },
];

export function buildDefaultMcpRegistryTools(nowIso = new Date().toISOString()): McpRegistryToolItem[] {
  return MCP_2026_TOOLS.map((spec, idx) => ({
    id: `mcp-tool-${String(idx + 1).padStart(2, '0')}-${spec.name}`,
    name: spec.name,
    title: spec.annotations.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: { ...spec.annotations },
    enabled: true,
    jevEligible: true,
    origin: 'BUILT_IN',
    healthStatus: 'HEALTHY',
    lastLatencyMs: Number((0.4 + ((idx * 3) % 7) * 0.25).toFixed(2)),
    callCount: idx < 6 ? 4 - (idx % 3) : 1,
    errorCount: 0,
    lastCheckedAt: nowIso,
  }));
}

export function buildDefaultMcpRegistryResources(nowIso = new Date().toISOString()): McpRegistryResourceItem[] {
  const staticItems: McpRegistryResourceItem[] = MCP_2026_RESOURCES.map((res, idx) => ({
    id: `mcp-res-${String(idx + 1).padStart(2, '0')}`,
    uri: res.uri,
    name: res.name,
    description: res.description,
    mimeType: res.mimeType,
    isTemplate: false,
    enabled: true,
    origin: 'BUILT_IN',
    healthStatus: 'HEALTHY',
    lastLatencyMs: Number((0.5 + idx * 0.3).toFixed(2)),
    readCount: 3 - (idx % 2),
    lastCheckedAt: nowIso,
  }));

  const templateItems: McpRegistryResourceItem[] = MCP_2026_RESOURCE_TEMPLATES.map((tpl, idx) => ({
    id: `mcp-tpl-${String(idx + 1).padStart(2, '0')}`,
    uri: tpl.uriTemplate,
    name: tpl.name,
    description: tpl.description,
    mimeType: tpl.mimeType,
    isTemplate: true,
    enabled: true,
    origin: 'BUILT_IN',
    healthStatus: 'HEALTHY',
    lastLatencyMs: Number((0.7 + idx * 0.35).toFixed(2)),
    readCount: 1,
    lastCheckedAt: nowIso,
  }));

  return [...staticItems, ...templateItems];
}

export function buildSeedMcpServers(nowIso = new Date().toISOString()): McpCustomServer[] {
  return [
    {
      id: 'mcp-srv-loopback',
      name: 'Jarvis Cortex Native Loopback',
      slug: 'jarvis-loopback-http',
      category: 'CORE_LOCAL',
      description: 'Endpoint HTTP Streamable JSON-RPC 2.0 nativo do Gateway MCP 2026 (/api/mcp).',
      transport: 'HTTP_STREAMABLE',
      endpointUrl: 'http://127.0.0.1:3000/api/mcp',
      envKeys: {},
      enabled: true,
      jevEligible: true,
      authStatus: 'AUTHORIZED',
      healthStatus: 'ONLINE',
      lastLatencyMs: 1.8,
      discoveredTools: MCP_2026_TOOLS.slice(0, 6).map((t) => t.name),
      lastCheckedAt: nowIso,
    },
    {
      id: 'mcp-srv-filesystem',
      name: 'Filesystem Local Governado',
      slug: 'filesystem',
      category: 'CORE_LOCAL',
      description: 'Leitura, pesquisa e escrita confinada em diretórios autorizados do workspace local.',
      transport: 'STDIO',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
      envKeys: {},
      enabled: true,
      jevEligible: true,
      authStatus: 'AUTHORIZED',
      healthStatus: 'ONLINE',
      lastLatencyMs: 2.4,
      discoveredTools: ['read_file', 'write_file', 'list_directory', 'search_files'],
      lastCheckedAt: nowIso,
      fromLibraryId: 'lib-filesystem',
    },
  ];
}
