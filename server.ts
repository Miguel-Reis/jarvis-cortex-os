import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';

dns.setDefaultResultOrder('ipv4first');
import {
  buildAntigravityProjectBlueprint,
  buildDeterministicArtifactFromPrompt,
  computeGoalProgressFromSubtasks,
  computeHippoRagPPR,
  detectPromptInjection,
  filterProjectActivityLogs,
  GEMINI_VOICE_CATALOG,
  isGeneralUnlinkedChat,
  normalizeGeminiModelId,
  normalizeGeminiVoiceName,
  rankQ18Actions,
  validateChannelSender,
} from './src/shared/cortex-math.ts';
import {
  CORTEX_PLUGINS_CATALOG,
  SPECIALIST_AGENT_TEMPLATES,
  STANDARD_SKILLS_LIBRARY,
} from './src/shared/skills-plugins-catalog.ts';
import {
  GENERAL_CHAT_PROJECT_ID,
  type ArtifactKind,
  type ChannelPlatform,
  type ChatThread,
  type GoalItem,
  type GoalSubtask,
  type PluginItem,
  type PluginLifecycleHook,
  type ProjectArtifact,
  type ProjectIdeaCategory,
  type ProjectWorkspace,
  type Room,
  type TodayContractItem,
} from './src/shared/types.ts';
import { loadDotEnvIntoProcess } from './src/server/api-keys-manager.ts';
import { domainMutex } from './src/server/async-mutex.ts';
import { db } from './src/server/db.ts';
import { enforceMinimumNodeRuntime, runSystemDoctor } from './src/server/doctor.ts';
import {
  createSecurityGateMiddleware,
  evaluateBindAuthPolicy,
  resolveSafeBindHost,
} from './src/server/security-gate.ts';
import {
  captureSidecarDesktopScreen,
  collectOSTelemetry,
  collectSidecarHostSnapshot,
  dispatchSidecarHostCommand,
  executeGovernedCommand,
  getGitOverview,
  listWorkspaceFiles,
  readSafeWorkspaceFile,
  registerApprovalBroadcaster,
  triggerSidecarHotkey,
  verifyTodayContractItem,
} from './src/server/os-adapter.ts';
import {
  analyzeLiveScreenFrame,
  generateWorkflowFromNaturalLanguage,
  registerStudioActivityBroadcaster,
  runAgentChatTurn,
  synthesizeBriefText,
} from './src/server/gemini-engine.ts';
import {
  attachGeminiLiveWebSocketServer,
  synthesizeVoicePreviewServerSide,
  transcribeAudioServerSide,
} from './src/server/voice-live-bridge.ts';
import {
  registerWorkflowBroadcaster,
  runWorkflowById,
  startOrRefreshHeartbeatDaemon,
} from './src/server/workflow-runner.ts';
import {
  analyzeFileBlastRadius,
  buildScoutWorkspaceIndex,
  lookupWorkspaceSymbols,
  probeAndSyncBrain8765,
  registerSwarmOrbitBroadcaster,
  runProjectProactiveScan,
  storeBiTemporalMemory,
} from './src/server/swarm-orbit-engine.ts';
import {
  createHttpDebugMiddleware,
  debugLog,
  getDebugLogFilePath,
  getRecentDebugLogs,
  isDebugLoggingEnabled,
  printStartupDebugBanner,
} from './src/server/debug-logger.ts';
import { createMcpRouter } from './src/server/routes/mcp-routes.ts';
import { createMemoryRouter } from './src/server/routes/memory-routes.ts';
import { createSwarmOrbitRouter } from './src/server/routes/swarm-orbit-routes.ts';
import { createSystemRouter } from './src/server/routes/system-routes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDotEnvIfPresent(): void {
  loadDotEnvIntoProcess(path.join(__dirname, '.env'));
}

loadDotEnvIfPresent();
enforceMinimumNodeRuntime();

function resolvePort(): number {
  const portFlagIdx = process.argv.indexOf('--port');
  if (portFlagIdx >= 0 && process.argv[portFlagIdx + 1]) {
    const parsed = Number(process.argv[portFlagIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const envPort = Number(process.env.PORT || process.env.npm_config_port);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  return 3000;
}

const PORT = resolvePort();
// A-01: Default bind host is 127.0.0.1 unless explicitly overridden via --host or HOST
const HOST = resolveSafeBindHost(process.argv, process.env);

process.on('uncaughtException', (err) => {
  debugLog('ERROR', 'FATAL', `Uncaught Exception: ${err.message}`, {
    payload: err.stack || String(err),
    maxPreviewLen: 500,
  });
});

process.on('unhandledRejection', (reason) => {
  debugLog('ERROR', 'FATAL', 'Unhandled Promise Rejection', {
    payload: reason instanceof Error ? `${reason.message} | ${reason.stack || ''}` : reason,
    maxPreviewLen: 500,
  });
});

export function createJarvisExpressApp(options: { port?: number; host?: string } = {}): {
  app: express.Express;
  broadcastSse: (event: string, payload: unknown) => void;
} {
  const activePort = options.port ?? PORT;
  const activeHost = options.host ?? HOST;

  const app = express();

  // A-01: CORS single-origin allowlist, Cross-Site CSRF guard, Bearer/Cookie Auth & IP Rate Limiter
  app.use(createSecurityGateMiddleware({ port: activePort, host: activeHost }));

  // A-14: Binary screen frame upload route (mounted before global JSON parser to avoid base64 +33% overhead)
  app.post(
    '/api/screen/analyze-binary',
    express.raw({
      type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
      limit: '10mb',
    }),
    async (req, res) => {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length === 0) {
        res.status(400).json({ error: 'Frame binário vazio.' });
        return;
      }
      const mimeType = String(req.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
      const width = Number(req.query.width || req.headers['x-frame-width']) || 1280;
      const height = Number(req.query.height || req.headers['x-frame-height']) || 720;
      const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
      const chatId = req.query.chatId ? String(req.query.chatId) : undefined;
      const prompt = req.query.prompt ? String(req.query.prompt) : undefined;
      const regionLabel = req.query.regionLabel ? String(req.query.regionLabel) : undefined;

      const result = await analyzeLiveScreenFrame({
        projectId,
        chatId,
        prompt,
        regionLabel,
        screenFrame: {
          mimeType,
          dataBase64: buf.toString('base64'),
          width,
          height,
          source: 'BROWSER_STREAM',
        },
        activePort,
      });
      res.json({ ...result, transport: 'BINARY_RAW', byteLength: buf.length });
    }
  );

  app.use(express.json({ limit: '6mb' }));
  app.use(createHttpDebugMiddleware());

  // Real-time SSE Clients Registry
  const sseClients = new Set<express.Response>();
  const broadcastSse = (event: string, payload: unknown) => {
    debugLog('DEBUG', 'SSE', `Broadcast event="${event}" to ${sseClients.size} client(s)`, {
      payload,
      maxPreviewLen: 180,
    });
    const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(msg);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  registerWorkflowBroadcaster(broadcastSse);
  registerSwarmOrbitBroadcaster(broadcastSse);
  registerStudioActivityBroadcaster(broadcastSse);
  registerApprovalBroadcaster((approval) => broadcastSse('approval_requested', approval));

  // ==========================================================================
  // Health & Unified Bootstrap State
  // ==========================================================================
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '4.0.0',
      schemaVersion: db.getState().schemaVersion ?? 4,
      seedMode: db.getState().seedMode ?? 'demo',
      storageEngine: db.getEngineName(),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      mcpProtocol: '2025-06-18',
      port: activePort,
      bindHost: activeHost,
      platform: process.platform,
    });
  });

  app.get('/api/debug/logs', (req, res) => {
    const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 150));
    const logs = getRecentDebugLogs(limit);
    res.json({
      enabled: isDebugLoggingEnabled(),
      logFilePath: getDebugLogFilePath(),
      count: logs.length,
      logs,
    });
  });

  app.get('/api/events', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);
    debugLog('DEBUG', 'SSE', `Client connected to /api/events (active=${sseClients.size})`);
    const initialSnap = {
      connectedAt: new Date().toISOString(),
      pendingApprovals: db.getState().approvals.filter((a) => a.status === 'PENDING').length,
      storageEngine: db.getEngineName(),
    };
    res.write(`event: connected\ndata: ${JSON.stringify(initialSnap)}\n\n`);

    req.on('close', () => {
      sseClients.delete(res);
      debugLog('DEBUG', 'SSE', `Client disconnected from /api/events (active=${sseClients.size})`);
    });
  });

  app.get('/api/bootstrap', async (_req, res) => {
    loadDotEnvIfPresent();
    const state = db.getState();
    const rankedCandidates = rankQ18Actions(state.candidates);
    const activeMemories = state.memories.filter((m) => !m.supersededBy && !m.validUntil);
    const pprNodes = computeHippoRagPPR(activeMemories, state.graphEdges);
    const [telemetry, brainProbe] = await Promise.all([
      collectOSTelemetry(PORT),
      probeAndSyncBrain8765(false),
    ]);

    res.json({
      storageEngine: db.getEngineName(),
      geminiAvailable: Boolean(process.env.GEMINI_API_KEY?.trim()),
      openRouterAvailable: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      activePort: PORT,
      brain8765: brainProbe.status,
      state: {
        ...state,
        candidates: rankedCandidates,
      },
      pprNodes,
      telemetry,
    });
  });

  // ==========================================================================
  // 0B. Multi-Project Workspaces & Proactive Project Engine
  // ==========================================================================
  app.get('/api/projects', (_req, res) => {
    const state = db.getState();
    res.json({
      projects: state.projects || [],
      activeProjectId: state.activeProjectId || 'proj-jarvis-core',
    });
  });

  app.post('/api/projects', async (req, res) => {
    const {
      name,
      rootPath,
      techStack,
      gitBranch,
      description,
      ideaCategory,
      ideaBrief,
      activeSkillIds,
      proactiveEnabled,
      proactiveIntervalSec,
      assignedAgentIds,
    } = req.body || {};

    const cleanName = String(name || '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'Nome do projeto é obrigatório.' });
      return;
    }

    const validCategories: ProjectIdeaCategory[] = [
      'WEBSITE',
      'APP',
      'AUTOMATION',
      'RESEARCH',
      'SYSTEM',
      'CUSTOM',
    ];
    const resolvedCategory: ProjectIdeaCategory = validCategories.includes(ideaCategory)
      ? ideaCategory
      : 'CUSTOM';

    const defaultStackByCat: Record<ProjectIdeaCategory, string> = {
      WEBSITE: 'React · TypeScript · Tailwind CSS',
      APP: 'React Native / Mobile · TypeScript · Offline-First',
      AUTOMATION: 'Node.js · Python · Workflows & MCP',
      RESEARCH: 'HippoRAG · Análise & Documentação',
      SYSTEM: 'TypeScript · SQLite WAL · Sidecar',
      CUSTOM: 'TypeScript · Node.js',
    };

    const slug = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const nowIso = new Date().toISOString();
    const id = `proj-${Date.now()}`;
    const defaultChatId = `chat-${Date.now() + 1}`;
    const cleanDesc = String(
      ideaBrief || description || 'Nova ideia criada no Estúdio J.A.R.V.I.S.'
    ).trim();

    const newProj: ProjectWorkspace = {
      id,
      name: cleanName,
      slug: slug || id,
      rootPath: String(rootPath || '.').trim() || '.',
      techStack: String(techStack || defaultStackByCat[resolvedCategory]).trim(),
      gitBranch: String(gitBranch || 'main').trim() || 'main',
      description: cleanDesc,
      ideaCategory: resolvedCategory,
      ideaBrief: cleanDesc,
      activeSkillIds: Array.isArray(activeSkillIds)
        ? activeSkillIds.map(String)
        : ['skill-ast-refactor', 'skill-hippo-curator'],
      defaultChatId,
      status: 'ACTIVE',
      proactiveEnabled: proactiveEnabled !== false,
      proactiveIntervalSec: Math.max(30, Number(proactiveIntervalSec) || 90),
      healthScore: 96,
      openTasksCount: 1,
      assignedAgentIds: Array.isArray(assignedAgentIds)
        ? assignedAgentIds.map(String)
        : ['room-exec', 'room-eng'],
      lastProactiveAt: nowIso,
      proactiveInsights: [],
    };

    const initialChat: ChatThread = {
      id: defaultChatId,
      projectId: id,
      title: 'Planeamento Principal',
      createdAt: nowIso,
      updatedAt: nowIso,
      primaryAgentId: 'room-exec',
      participatingAgentIds: newProj.assignedAgentIds,
      screenAutoSendEnabled: true,
    };

    db.update((draft) => {
      if (!draft.projects) draft.projects = [];
      if (!draft.chatThreads) draft.chatThreads = [];
      draft.projects.unshift(newProj);
      draft.chatThreads.unshift(initialChat);
      draft.activeProjectId = newProj.id;
      draft.activeChatId = initialChat.id;
      draft.messages.push({
        id: `msg-welcome-${id}`,
        roomId: 'room-exec',
        chatId: initialChat.id,
        projectId: id,
        agentName: 'Jarvis',
        role: 'assistant',
        content: `Projeto **${newProj.name}** criado! Descreve o que queres construir ou alcançar nesta ideia — vou definir automaticamente os **Goals**, recrutar **Sub-Agentes** especialistas e ativar as **Skills** necessárias enquanto conversamos.`,
        createdAt: nowIso,
        engineUsed: 'JARVIS_STUDIO_ORCHESTRATOR',
      });
    });

    db.appendActivityLog({
      projectId: id,
      chatId: defaultChatId,
      actor: 'Jarvis',
      kind: 'THOUGHT',
      status: 'SUCCESS',
      summary: `Espaço de projeto "${newProj.name}" inicializado (${resolvedCategory})`,
      detail: cleanDesc,
      durationMs: 2,
    });

    if (newProj.proactiveEnabled) {
      await runProjectProactiveScan(newProj.id).catch(() => {});
    }

    db.appendAudit('OPERATOR', 'PROJECT', 'PROJECT_CREATED', `${newProj.name} (${newProj.rootPath})`, 'VERIFIED');
    broadcastSse('state_updated', { section: 'projects' });
    res.json({
      project: (db.getState().projects || []).find((p) => p.id === id) || newProj,
      chatThread: initialChat,
      projects: db.getState().projects,
      activeProjectId: db.getState().activeProjectId,
      activeChatId: db.getState().activeChatId,
    });
  });

  app.post('/api/projects/bulk-proactive', async (req, res) => {
    const proactiveEnabled = Boolean(req.body?.proactiveEnabled);
    let updatedCount = 0;

    db.update((draft) => {
      const list = draft.projects || [];
      for (const proj of list) {
        proj.proactiveEnabled = proactiveEnabled;
        if (!proactiveEnabled) {
          const hist = Array.isArray(proj.proactiveFrequencyHistory)
            ? proj.proactiveFrequencyHistory
            : [];
          proj.proactiveFrequencyHistory = [...hist, 0].slice(-12);
        }
        updatedCount += 1;
      }
    });

    if (proactiveEnabled) {
      await runProjectProactiveScan().catch(() => {});
    }

    db.appendAudit(
      'OPERATOR',
      'PROJECT',
      'PROJECTS_BULK_PROACTIVE',
      `Proatividade em massa definida para ${proactiveEnabled ? 'ON' : 'OFF'} (${updatedCount} projetos)`,
      'VERIFIED'
    );
    broadcastSse('state_updated', { section: 'projects' });
    res.json({
      ok: true,
      proactiveEnabled,
      updatedCount,
      projects: db.getState().projects || [],
    });
  });

  app.post('/api/projects/:id/activate', (req, res) => {
    let found: ProjectWorkspace | undefined;
    let resolvedChatId: string | undefined;
    db.update((draft) => {
      const target = (draft.projects || []).find((p) => p.id === req.params.id);
      if (target) {
        draft.activeProjectId = target.id;
        if (target.status === 'STANDBY') target.status = 'ACTIVE';
        const projChats = (draft.chatThreads || []).filter((c) => c.projectId === target.id);
        if (projChats.length > 0) {
          const preferred =
            projChats.find((c) => c.id === target.defaultChatId) || projChats[0];
          draft.activeChatId = preferred.id;
          resolvedChatId = preferred.id;
        } else {
          const fallbackChat: ChatThread = {
            id: `chat-${target.id}-main`,
            projectId: target.id,
            title: 'Planeamento Principal',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            primaryAgentId: 'room-exec',
            participatingAgentIds: target.assignedAgentIds || ['room-exec'],
            screenAutoSendEnabled: true,
          };
          if (!draft.chatThreads) draft.chatThreads = [];
          draft.chatThreads.push(fallbackChat);
          target.defaultChatId = fallbackChat.id;
          draft.activeChatId = fallbackChat.id;
          resolvedChatId = fallbackChat.id;
        }
        found = { ...target };
      }
    });
    if (!found) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    broadcastSse('state_updated', { section: 'projects' });
    res.json({ project: found, activeProjectId: found.id, activeChatId: resolvedChatId });
  });

  app.patch('/api/projects/:id', async (req, res) => {
    const body = req.body || {};
    let updated: ProjectWorkspace | null = null;
    let scanNeeded = false;

    db.update((draft) => {
      const target = (draft.projects || []).find((p) => p.id === req.params.id);
      if (!target) return;
      if (typeof body.name === 'string' && body.name.trim()) target.name = body.name.trim();
      if (typeof body.rootPath === 'string' && body.rootPath.trim()) target.rootPath = body.rootPath.trim();
      if (typeof body.techStack === 'string') target.techStack = body.techStack.trim();
      if (typeof body.description === 'string') target.description = body.description.trim();
      if (typeof body.ideaBrief === 'string') target.ideaBrief = body.ideaBrief.trim();
      if (body.ideaCategory) target.ideaCategory = body.ideaCategory;
      if (Array.isArray(body.activeSkillIds)) {
        target.activeSkillIds = body.activeSkillIds.map(String);
      }
      if (body.status && ['ACTIVE', 'STANDBY', 'AUDITING'].includes(body.status)) {
        target.status = body.status;
      }
      if (typeof body.proactiveEnabled === 'boolean') {
        target.proactiveEnabled = body.proactiveEnabled;
        if (body.proactiveEnabled) {
          scanNeeded = true;
        } else {
          const hist = Array.isArray(target.proactiveFrequencyHistory)
            ? target.proactiveFrequencyHistory
            : [];
          target.proactiveFrequencyHistory = [...hist, 0].slice(-12);
        }
      }
      if (typeof body.proactiveIntervalSec === 'number') {
        target.proactiveIntervalSec = Math.max(30, Math.min(3600, body.proactiveIntervalSec));
      }
      if (Array.isArray(body.assignedAgentIds)) {
        target.assignedAgentIds = body.assignedAgentIds.map(String);
      }
      updated = { ...target };
    });

    if (!updated) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }

    if (scanNeeded) {
      await runProjectProactiveScan(req.params.id).catch(() => {});
      updated = (db.getState().projects || []).find((p) => p.id === req.params.id) || updated;
    }

    db.appendAudit('OPERATOR', 'PROJECT', 'PROJECT_UPDATED', `${updated.name} (Proatividade=${updated.proactiveEnabled ? 'ON' : 'OFF'})`, 'VERIFIED');
    broadcastSse('state_updated', { section: 'projects' });
    res.json({ project: updated, projects: db.getState().projects });
  });

  app.delete('/api/projects/:id', (req, res) => {
    const current = db.getState().projects || [];
    if (current.length <= 1) {
      res.status(400).json({ error: 'Deve existir pelo menos 1 projeto ativo no Jarvis.' });
      return;
    }
    let removed = '';
    db.update((draft) => {
      const target = (draft.projects || []).find((p) => p.id === req.params.id);
      if (target) removed = target.name;
      draft.projects = (draft.projects || []).filter((p) => p.id !== req.params.id);
      draft.chatThreads = (draft.chatThreads || []).filter((c) => c.projectId !== req.params.id);
      draft.projectActivityLogs = (draft.projectActivityLogs || []).filter(
        (l) => l.projectId !== req.params.id
      );
      if (draft.activeProjectId === req.params.id && draft.projects[0]) {
        draft.activeProjectId = draft.projects[0].id;
        const nextChat = (draft.chatThreads || []).find(
          (c) => c.projectId === draft.activeProjectId
        );
        if (nextChat) draft.activeChatId = nextChat.id;
      }
    });
    if (!removed) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    broadcastSse('state_updated', { section: 'projects' });
    res.json({
      ok: true,
      projects: db.getState().projects,
      activeProjectId: db.getState().activeProjectId,
      activeChatId: db.getState().activeChatId,
    });
  });

  // Chat Threads inside Idea Projects OR Unlinked General Conversations
  app.post('/api/chats', (req, res) => {
    const state = db.getState();
    const wantsGeneral =
      req.body?.isGeneral === true || req.body?.projectId === GENERAL_CHAT_PROJECT_ID;
    const rawTitle = String(req.body?.title || '').trim();
    const primaryAgentId = String(req.body?.primaryAgentId || 'room-exec');
    const nowIso = new Date().toISOString();
    const agentRoom = state.rooms.find((r) => r.id === primaryAgentId) || state.rooms[0];

    if (wantsGeneral) {
      const cleanTitle = rawTitle || 'Nova Conversa Livre';
      const chat: ChatThread = {
        id: `chat-gen-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        projectId: GENERAL_CHAT_PROJECT_ID,
        isGeneral: true,
        title: cleanTitle,
        createdAt: nowIso,
        updatedAt: nowIso,
        primaryAgentId,
        participatingAgentIds: Array.from(new Set([primaryAgentId, 'room-exec'])),
        screenAutoSendEnabled: true,
      };

      db.update((draft) => {
        if (!draft.chatThreads) draft.chatThreads = [];
        draft.chatThreads.unshift(chat);
        draft.activeProjectId = GENERAL_CHAT_PROJECT_ID;
        draft.activeChatId = chat.id;
        draft.messages.push({
          id: `msg-welcome-${chat.id}`,
          roomId: agentRoom.id,
          chatId: chat.id,
          projectId: GENERAL_CHAT_PROJECT_ID,
          agentName: agentRoom.name,
          role: 'assistant',
          content: `**${cleanTitle}** iniciada em modo **Conversa Geral (Sem Projeto)**. Podes conversar normalmente ou pedir ações em todo o ecossistema J.A.R.V.I.S. Cortex OS.`,
          createdAt: nowIso,
          engineUsed: 'JARVIS_STUDIO_ORCHESTRATOR',
        });
      });

      broadcastSse('state_updated', { section: 'chats' });
      res.json({
        chat,
        chatThreads: db.getState().chatThreads,
        activeChatId: chat.id,
        activeProjectId: GENERAL_CHAT_PROJECT_ID,
      });
      return;
    }

    const projectId = String(req.body?.projectId || state.activeProjectId || 'proj-website-studio');
    const proj = (state.projects || []).find((p) => p.id === projectId) || (state.projects || [])[0];
    if (!proj) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }

    const cleanTitle = rawTitle || 'Nova Conversa';
    const chat: ChatThread = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      projectId: proj.id,
      title: cleanTitle,
      createdAt: nowIso,
      updatedAt: nowIso,
      primaryAgentId,
      participatingAgentIds: Array.from(
        new Set([primaryAgentId, ...(proj.assignedAgentIds || ['room-exec'])])
      ),
      screenAutoSendEnabled: true,
    };

    db.update((draft) => {
      if (!draft.chatThreads) draft.chatThreads = [];
      draft.chatThreads.unshift(chat);
      draft.activeProjectId = proj.id;
      draft.activeChatId = chat.id;
      draft.messages.push({
        id: `msg-welcome-${chat.id}`,
        roomId: agentRoom.id,
        chatId: chat.id,
        projectId: proj.id,
        agentName: agentRoom.name,
        role: 'assistant',
        content: `Nova conversa iniciada em **${proj.name}**. Os Goals e Sub-Agentes deste projeto estão disponíveis, e os logs de execução à direita ficam isolados para esta conversa.`,
        createdAt: nowIso,
        engineUsed: 'JARVIS_STUDIO_ORCHESTRATOR',
      });
    });

    db.appendActivityLog({
      projectId: proj.id,
      chatId: chat.id,
      actor: agentRoom.name,
      kind: 'THOUGHT',
      status: 'SUCCESS',
      summary: `Conversa "${chat.title}" iniciada em ${proj.name}`,
      durationMs: 1,
    });

    broadcastSse('state_updated', { section: 'chats' });
    res.json({
      chat,
      chatThreads: db.getState().chatThreads,
      activeChatId: chat.id,
      activeProjectId: proj.id,
    });
  });

  app.post('/api/chats/:id/activate', (req, res) => {
    let found: ChatThread | null = null;
    db.update((draft) => {
      const target = (draft.chatThreads || []).find((c) => c.id === req.params.id);
      if (target) {
        draft.activeChatId = target.id;
        draft.activeProjectId = isGeneralUnlinkedChat(target)
          ? GENERAL_CHAT_PROJECT_ID
          : target.projectId;
        found = { ...target };
      }
    });
    if (!found) {
      res.status(404).json({ error: 'Conversa não encontrada.' });
      return;
    }
    broadcastSse('state_updated', { section: 'chats' });
    res.json({
      chat: found,
      activeChatId: (found as ChatThread).id,
      activeProjectId: db.getState().activeProjectId,
    });
  });

  app.patch('/api/chats/:id', (req, res) => {
    const body = req.body || {};
    let updated: ChatThread | null = null;
    db.update((draft) => {
      const target = (draft.chatThreads || []).find((c) => c.id === req.params.id);
      if (!target) return;
      if (typeof body.title === 'string' && body.title.trim()) {
        target.title = body.title.trim();
      }
      if (typeof body.primaryAgentId === 'string' && body.primaryAgentId.trim()) {
        target.primaryAgentId = body.primaryAgentId.trim();
      }
      if (typeof body.screenAutoSendEnabled === 'boolean') {
        target.screenAutoSendEnabled = body.screenAutoSendEnabled;
      }
      target.updatedAt = new Date().toISOString();
      updated = { ...target };
    });
    if (!updated) {
      res.status(404).json({ error: 'Conversa não encontrada.' });
      return;
    }
    broadcastSse('state_updated', { section: 'chats' });
    res.json({ chat: updated, chatThreads: db.getState().chatThreads });
  });

  app.delete('/api/chats/:id', (req, res) => {
    const state = db.getState();
    const target = (state.chatThreads || []).find((c) => c.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Conversa não encontrada.' });
      return;
    }
    const targetIsGeneral = isGeneralUnlinkedChat(target);
    const siblingCount = (state.chatThreads || []).filter((c) =>
      targetIsGeneral ? isGeneralUnlinkedChat(c) : !isGeneralUnlinkedChat(c) && c.projectId === target.projectId
    ).length;
    if (siblingCount <= 1) {
      res.status(400).json({
        error: targetIsGeneral
          ? 'Mantém pelo menos uma conversa geral ativa.'
          : 'Mantém pelo menos uma conversa ativa no projeto.',
      });
      return;
    }

    db.update((draft) => {
      draft.chatThreads = (draft.chatThreads || []).filter((c) => c.id !== req.params.id);
      draft.messages = draft.messages.filter((m) => m.chatId !== req.params.id);
      draft.projectActivityLogs = (draft.projectActivityLogs || []).filter(
        (l) => l.chatId !== req.params.id
      );
      if (draft.activeChatId === req.params.id) {
        const next = (draft.chatThreads || []).find((c) =>
          targetIsGeneral ? isGeneralUnlinkedChat(c) : !isGeneralUnlinkedChat(c) && c.projectId === target.projectId
        );
        if (next) draft.activeChatId = next.id;
      }
    });
    broadcastSse('state_updated', { section: 'chats' });
    res.json({
      ok: true,
      chatThreads: db.getState().chatThreads,
      activeChatId: db.getState().activeChatId,
    });
  });

  app.post('/api/projects/proactive-scan', async (req, res) => {
    const projectId = req.body?.projectId ? String(req.body.projectId) : undefined;
    const scanned = await runProjectProactiveScan(projectId);
    res.json({ scanned, projects: db.getState().projects });
  });

  app.post('/api/projects/:id/insights/:insightId/resolve', async (req, res) => {
    await domainMutex.withLock('projects', async () => {
      const mode: 'EXECUTE' | 'DISMISS' = req.body?.mode === 'DISMISS' ? 'DISMISS' : 'EXECUTE';
      const state = db.getState();
      const proj = (state.projects || []).find((p) => p.id === req.params.id);
      const insight = proj?.proactiveInsights.find((i) => i.id === req.params.insightId);
      if (!proj || !insight) {
        res.status(404).json({ error: 'Insight proativo não encontrado.' });
        return;
      }

      let executionSummary = 'Insight dispensado pelo Operador.';
      if (mode === 'EXECUTE') {
        if (insight.actionKind === 'VERIFY_CONTRACTS') {
          for (const c of state.contracts) {
            const vRes = await verifyTodayContractItem(c, activePort);
            db.update((draft) => {
              const target = draft.contracts.find((x) => x.id === c.id);
              if (target) {
                target.status = vRes.verified ? 'VERIFIED' : 'FAILED';
                target.evidenceHash = vRes.evidenceHash;
                target.lastCheckedAt = new Date().toISOString();
                target.outputSummary = vRes.summary;
                target.source = 'REAL';
              }
            });
          }
          executionSummary = 'Todos os contratos Today Contract Gate foram verificados com SHA-256.';
        } else if (insight.actionKind === 'EXEC_COMMAND') {
          const execRes = await executeGovernedCommand(
            insight.suggestedCommandOrPrompt,
            'WORKSPACE_TERMINAL'
          );
          executionSummary = execRes.output.slice(0, 260);
        } else if (insight.actionKind === 'OPEN_CHAT') {
          const turn = await runAgentChatTurn({
            roomId: proj.assignedAgentIds[0] || 'room-exec',
            userText: insight.suggestedCommandOrPrompt,
            activePort,
          });
          executionSummary = turn.assistantMessage.content.slice(0, 260);
        }
      }

      db.update((draft) => {
        const p = (draft.projects || []).find((x) => x.id === req.params.id);
        const ins = p?.proactiveInsights.find((x) => x.id === req.params.insightId);
        if (ins) {
          ins.status = mode === 'EXECUTE' ? 'EXECUTED' : 'DISMISSED';
        }
      });

      broadcastSse('state_updated', { section: 'projects' });
      res.json({ ok: true, executionSummary, projects: db.getState().projects });
    });
  });

  // ==========================================================================
  // 1. Brief, Q-18, Goals, Today Contract Gate, Decisions & Routine Cues
  // ==========================================================================
  app.post('/api/brief/synthesize', async (_req, res) => {
    const text = await synthesizeBriefText();
    res.json({ text, generatedAt: new Date().toISOString() });
  });

  app.post('/api/goals', (req, res) => {
    const {
      title,
      category,
      targetMetric,
      deadline,
      projectId,
      chatId,
      assignedAgentId,
      subtasks,
    } = req.body || {};
    if (!title || !String(title).trim()) {
      res.status(400).json({ error: 'Título do objetivo é obrigatório.' });
      return;
    }
    const state = db.getState();
    const resolvedProjId = String(projectId || state.activeProjectId || 'proj-website-studio');
    const resolvedChatId = String(chatId || state.activeChatId || 'chat-web-main');
    const parsedSubtasks: GoalSubtask[] | undefined = Array.isArray(subtasks)
      ? subtasks
          .map((s: unknown, idx: number) => {
            if (typeof s === 'string') {
              return { id: `st-${Date.now()}-${idx}`, title: s.trim(), done: false };
            }
            const obj = s as Partial<GoalSubtask>;
            return {
              id: obj.id || `st-${Date.now()}-${idx}`,
              title: String(obj.title || '').trim(),
              done: Boolean(obj.done),
            };
          })
          .filter((st) => st.title.length > 0)
      : undefined;

    const initialProg =
      parsedSubtasks && parsedSubtasks.length > 0
        ? computeGoalProgressFromSubtasks(parsedSubtasks, 0).progress
        : 10;

    const goal: GoalItem = {
      id: `goal-${Date.now()}`,
      title: String(title).trim(),
      category: String(category || 'Planeamento').trim(),
      progress: initialProg,
      targetMetric: String(targetMetric || 'Meta verificável').trim(),
      deadline: String(deadline || '2026-12-31'),
      status: initialProg >= 100 ? 'COMPLETED' : 'ACTIVE',
      projectId: resolvedProjId,
      chatId: resolvedChatId,
      assignedAgentId: assignedAgentId ? String(assignedAgentId) : undefined,
      subtasks: parsedSubtasks,
      createdBy: 'OPERATOR',
      updatedAt: new Date().toISOString(),
    };
    db.update((draft) => {
      draft.goals.unshift(goal);
    });
    db.appendActivityLog({
      projectId: resolvedProjId,
      chatId: resolvedChatId,
      actor: state.settings.operatorName || 'Operador',
      kind: 'GOAL_CREATED',
      status: 'SUCCESS',
      summary: `Goal adicionado: "${goal.title}"`,
      detail: goal.targetMetric,
      durationMs: 1,
      relatedGoalId: goal.id,
    });
    broadcastSse('state_updated', { section: 'goals' });
    res.json({ goal });
  });

  app.patch('/api/goals/:id', (req, res) => {
    const { title, progress, status, subtasks, assignedAgentId } = req.body || {};
    let updated: GoalItem | null = null;
    db.update((draft) => {
      const g = draft.goals.find((x) => x.id === req.params.id);
      if (g) {
        if (typeof title === 'string' && title.trim()) {
          g.title = title.trim();
        }
        if (Array.isArray(subtasks)) {
          g.subtasks = subtasks.map((st: GoalSubtask, idx: number) => ({
            id: st.id || `st-${Date.now()}-${idx}`,
            title: String(st.title || '').trim(),
            done: Boolean(st.done),
          }));
          g.progress = computeGoalProgressFromSubtasks(g.subtasks, g.progress).progress;
          g.status = g.progress >= 100 ? 'COMPLETED' : g.status === 'COMPLETED' ? 'ACTIVE' : g.status;
        } else if (typeof progress === 'number') {
          g.progress = Math.max(0, Math.min(100, progress));
          if (g.progress === 100) g.status = 'COMPLETED';
        }
        if (status && ['ACTIVE', 'COMPLETED', 'AT_RISK'].includes(status)) {
          g.status = status;
        }
        if (assignedAgentId !== undefined) {
          g.assignedAgentId = assignedAgentId ? String(assignedAgentId) : undefined;
        }
        g.updatedAt = new Date().toISOString();
        updated = { ...g };
      }
    });
    if (!updated) {
      res.status(404).json({ error: 'Objetivo não encontrado.' });
      return;
    }
    const gObj = updated as GoalItem;
    db.appendActivityLog({
      projectId: gObj.projectId || db.getState().activeProjectId || 'proj-website-studio',
      chatId: gObj.chatId || db.getState().activeChatId || 'chat-web-main',
      actor: db.getState().settings.operatorName || 'Operador',
      kind: 'GOAL_UPDATED',
      status: 'SUCCESS',
      summary: `Goal atualizado: "${gObj.title}" (${gObj.progress}%)`,
      durationMs: 1,
      relatedGoalId: gObj.id,
    });
    broadcastSse('state_updated', { section: 'goals' });
    res.json({ goal: updated });
  });

  app.delete('/api/goals/:id', (req, res) => {
    const existed = db.getState().goals.some((g) => g.id === req.params.id);
    if (!existed) {
      res.status(404).json({ error: 'Goal não encontrado.' });
      return;
    }
    db.update((draft) => {
      draft.goals = draft.goals.filter((g) => g.id !== req.params.id);
    });
    broadcastSse('state_updated', { section: 'goals' });
    res.json({ ok: true, goals: db.getState().goals });
  });

  app.post('/api/contracts', (req, res) => {
    const { title, verificationRule, verificationTarget } = req.body || {};
    if (!title || !String(title).trim()) {
      res.status(400).json({ error: 'Título do contrato é obrigatório.' });
      return;
    }
    const item: TodayContractItem = {
      id: `contract-${Date.now()}`,
      title: String(title).trim(),
      verificationRule: verificationRule || 'FILE_EXISTS',
      verificationTarget: String(verificationTarget || 'package.json').trim(),
      status: 'PENDING',
      source: 'REAL',
    };
    db.update((draft) => {
      draft.contracts.push(item);
    });
    res.json({ contract: item });
  });

  app.post('/api/contracts/:id/verify', async (req, res) => {
    await domainMutex.withLock('contracts', async () => {
      const contract = db.getState().contracts.find((c) => c.id === req.params.id);
      if (!contract) {
        res.status(404).json({ error: 'Contrato não encontrado.' });
        return;
      }
      const result = await verifyTodayContractItem(contract, activePort);
      let updated: TodayContractItem | undefined;
      db.update((draft) => {
        const target = draft.contracts.find((c) => c.id === req.params.id);
        if (target) {
          target.status = result.verified ? 'VERIFIED' : 'FAILED';
          target.evidenceHash = result.evidenceHash;
          target.lastCheckedAt = new Date().toISOString();
          target.outputSummary = result.summary;
          target.source = 'REAL';
          updated = { ...target };
        }
      });
      db.appendAudit(
        'TODAY_CONTRACT_GATE',
        'SYSTEM',
        `VERIFY_${contract.verificationRule}`,
        `${contract.title} -> ${result.verified ? 'VERIFIED' : 'FAILED'} (${result.evidenceHash})`,
        result.verified ? 'VERIFIED' : 'BLOCKED'
      );
      broadcastSse('state_updated', { section: 'contracts' });
      res.json({ contract: updated, result });
    });
  });

  app.post('/api/q18/:id/execute', async (req, res) => {
    const cand = db.getState().candidates.find((c) => c.id === req.params.id);
    if (!cand) {
      res.status(404).json({ error: 'Ação Q-18 não encontrada.' });
      return;
    }

    let detail = `Ação Q-18 "${cand.title}" concluída.`;
    let navigateTo: string | undefined;

    if (cand.actionPayload.kind === 'VERIFY_CONTRACT') {
      const targetContract = db.getState().contracts.find((c) => c.id === cand.actionPayload.refId);
      if (targetContract) {
        const vRes = await verifyTodayContractItem(targetContract, PORT);
        db.update((draft) => {
          const c = draft.contracts.find((x) => x.id === targetContract.id);
          if (c) {
            c.status = vRes.verified ? 'VERIFIED' : 'FAILED';
            c.evidenceHash = vRes.evidenceHash;
            c.lastCheckedAt = new Date().toISOString();
            c.outputSummary = vRes.summary;
          }
        });
        detail = vRes.summary;
      }
    } else if (cand.actionPayload.kind === 'RUN_WORKFLOW') {
      const run = await runWorkflowById(cand.actionPayload.refId, 'MANUAL');
      detail = `Workflow executado (${run?.status || 'OK'}).`;
    } else if (cand.actionPayload.kind === 'RUN_DIAGNOSTIC') {
      const telemetry = await collectOSTelemetry(PORT);
      const pendingCount = db.getState().approvals.filter((a) => a.status === 'PENDING').length;
      detail = `Diagnóstico concluído: CPU ${telemetry.cpuUsagePercent}% · RAM ${telemetry.ramPercent}% · ${pendingCount} pedido(s) pendentes na Inbox de Autoridade.`;
      navigateTo = cand.actionPayload.refId || 'authority';
    } else if (cand.actionPayload.kind === 'OPEN_ROOM') {
      detail = `Sala tática "${cand.actionPayload.refId}" pronta para sessão multi-agente.`;
      navigateTo = 'chat';
    }

    db.update((draft) => {
      const target = draft.candidates.find((c) => c.id === cand.id);
      if (target) target.completed = true;
    });

    broadcastSse('state_updated', { section: 'q18' });
    res.json({
      ok: true,
      detail,
      navigateTo,
      candidates: rankQ18Actions(db.getState().candidates),
      contracts: db.getState().contracts,
    });
  });

  app.post('/api/decisions/:id/resolve', (req, res) => {
    const choice: 'A' | 'B' = req.body?.choice === 'B' ? 'B' : 'A';
    const dec = db.getState().decisions.find((d) => d.id === req.params.id);
    if (!dec) {
      res.status(404).json({ error: 'Decisão não encontrada.' });
      return;
    }
    const chosen = choice === 'A' ? dec.optionA : dec.optionB;
    db.update((draft) => {
      const d = draft.decisions.find((x) => x.id === dec.id);
      if (d) {
        d.status = choice === 'A' ? 'RESOLVED_A' : 'RESOLVED_B';
        d.resolvedAt = new Date().toISOString();
      }
    });
    storeBiTemporalMemory({
      topic: `Decisão: ${dec.title}`,
      content: `Escolhida Opção ${choice} (${chosen.label}): ${chosen.summary}`,
      category: 'DECISION',
      provenance: 'CONFIRMED',
      tier: 'SEMANTIC',
      tags: ['decisao', 'brief'],
      sourceUri: `decision://${dec.id}`,
    });
    db.appendAudit('OPERATOR', 'MEMORY', 'DECISION_RESOLVED', `${req.params.id} -> Opção ${choice}`, 'VERIFIED');
    res.json({ decision: db.getState().decisions.find((d) => d.id === dec.id) });
  });

  app.post('/api/routines/:id/convert', async (req, res) => {
    const cue = db.getState().routineCues.find((r) => r.id === req.params.id);
    if (!cue) {
      res.status(404).json({ error: 'Rotina não encontrada.' });
      return;
    }
    const generated = await generateWorkflowFromNaturalLanguage(cue.promptTemplate);
    const wfId = `wf-cue-${Date.now()}`;
    const newWf = {
      id: wfId,
      name: cue.title,
      description: generated.description,
      enabled: true,
      cronExpr: cue.suggestedCron || generated.cronExpr,
      nodes: generated.nodes,
      createdAt: new Date().toISOString(),
    };
    db.update((draft) => {
      draft.workflows.unshift(newWf);
      const targetCue = draft.routineCues.find((r) => r.id === cue.id);
      if (targetCue) targetCue.convertedWorkflowId = wfId;
    });
    db.appendAudit('ROUTINE_DISCOVERY', 'WORKFLOW', 'CUE_CONVERTED', cue.title, 'VERIFIED');
    res.json({ workflow: newWf });
  });

  // ==========================================================================
  // 2. Multimodal Agentic Chat, Activity Logs, Screen Vision & Specialist Rooms
  // ==========================================================================
  app.post('/api/chat/send', async (req, res) => {
    const { roomId, chatId, projectId, content, attachments, screenFrame, enableWebGrounding } =
      req.body || {};
    if (
      !content?.trim() &&
      (!Array.isArray(attachments) || attachments.length === 0) &&
      !screenFrame?.dataBase64
    ) {
      res.status(400).json({ error: 'Mensagem vazia.' });
      return;
    }
    const result = await runAgentChatTurn({
      roomId: roomId ? String(roomId) : undefined,
      chatId: chatId ? String(chatId) : undefined,
      projectId: projectId ? String(projectId) : undefined,
      userText: String(content || ''),
      attachments: Array.isArray(attachments) ? attachments : [],
      enableWebGrounding: Boolean(enableWebGrounding),
      screenFrame:
        screenFrame && typeof screenFrame === 'object' && screenFrame.dataBase64
          ? {
              mimeType: String(screenFrame.mimeType || 'image/jpeg'),
              dataBase64: String(screenFrame.dataBase64),
              width: Number(screenFrame.width) || 1280,
              height: Number(screenFrame.height) || 720,
              source:
                screenFrame.source === 'SIDECAR_NATIVE' ? 'SIDECAR_NATIVE' : 'BROWSER_STREAM',
              activeWindowTitle: screenFrame.activeWindowTitle
                ? String(screenFrame.activeWindowTitle)
                : undefined,
            }
          : undefined,
      activePort: PORT,
    });
    broadcastSse('chat_message', {
      roomId: result.assistantMessage.roomId,
      chatId: result.assistantMessage.chatId,
      projectId: result.assistantMessage.projectId,
      assistantMessage: result.assistantMessage,
    });
    broadcastSse('state_updated', { section: 'studio_turn' });
    res.json(result);
  });

  app.delete('/api/chat/:roomId/clear', (req, res) => {
    const chatId = req.query.chatId ? String(req.query.chatId) : undefined;
    db.update((draft) => {
      if (chatId) {
        draft.messages = draft.messages.filter((m) => m.chatId !== chatId);
      } else {
        draft.messages = draft.messages.filter((m) => m.roomId !== req.params.roomId);
      }
    });
    broadcastSse('state_updated', { section: 'chats' });
    res.json({ ok: true });
  });

  app.get('/api/activity-logs', (req, res) => {
    const state = db.getState();
    const projectId = req.query.projectId
      ? String(req.query.projectId)
      : state.activeProjectId;
    const chatId = req.query.chatId ? String(req.query.chatId) : state.activeChatId;
    const scope: 'CHAT' | 'PROJECT' = req.query.scope === 'PROJECT' ? 'PROJECT' : 'CHAT';
    const logs = filterProjectActivityLogs(state.projectActivityLogs || [], {
      projectId,
      chatId,
      scope,
    });
    res.json({ logs, count: logs.length });
  });

  app.delete('/api/activity-logs', (req, res) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
    const chatId = req.query.chatId ? String(req.query.chatId) : undefined;
    const scope: 'CHAT' | 'PROJECT' = req.query.scope === 'PROJECT' ? 'PROJECT' : 'CHAT';

    db.update((draft) => {
      const current = draft.projectActivityLogs || [];
      if (scope === 'CHAT' && chatId) {
        draft.projectActivityLogs = current.filter((l) => l.chatId !== chatId);
      } else if (projectId) {
        draft.projectActivityLogs = current.filter((l) => l.projectId !== projectId);
      } else {
        draft.projectActivityLogs = [];
      }
    });
    broadcastSse('state_updated', { section: 'activity_logs' });
    res.json({ ok: true, logs: db.getState().projectActivityLogs || [] });
  });

  app.post('/api/screen/sidecar-capture', async (req, res) => {
    const deviceId = String(req.body?.deviceId || 'dev-local-host');
    const projectId = String(
      req.body?.projectId || db.getState().activeProjectId || 'proj-website-studio'
    );
    const chatId = String(
      req.body?.chatId || db.getState().activeChatId || 'chat-web-main'
    );

    const snapshot = await captureSidecarDesktopScreen(deviceId, PORT);
    db.update((draft) => {
      draft.latestScreenSnapshot = snapshot;
    });

    const logEntry = db.appendActivityLog({
      projectId,
      chatId,
      actor: 'Sidecar Desktop',
      kind: 'SCREEN_VISION',
      status: 'SUCCESS',
      summary: `Captura nativa Sidecar (${snapshot.width}×${snapshot.height})`,
      detail: `Janela ativa: ${snapshot.activeWindowTitle || snapshot.hostname}`,
      durationMs: 12,
    });

    broadcastSse('activity_log', logEntry);
    broadcastSse('state_updated', { section: 'screen' });
    res.json({ snapshot });
  });

  app.post('/api/screen/analyze', async (req, res) => {
    const { projectId, chatId, prompt, regionLabel, screenFrame, postToChat } = req.body || {};
    const result = await analyzeLiveScreenFrame({
      projectId: projectId ? String(projectId) : undefined,
      chatId: chatId ? String(chatId) : undefined,
      prompt: prompt ? String(prompt) : undefined,
      regionLabel: regionLabel ? String(regionLabel) : undefined,
      screenFrame:
        screenFrame && typeof screenFrame === 'object' && screenFrame.dataBase64
          ? {
              mimeType: String(screenFrame.mimeType || 'image/jpeg'),
              dataBase64: String(screenFrame.dataBase64),
              width: Number(screenFrame.width) || 1280,
              height: Number(screenFrame.height) || 720,
              source:
                screenFrame.source === 'SIDECAR_NATIVE' ? 'SIDECAR_NATIVE' : 'BROWSER_STREAM',
              activeWindowTitle: screenFrame.activeWindowTitle
                ? String(screenFrame.activeWindowTitle)
                : undefined,
            }
          : undefined,
      activePort: PORT,
    });

    if (postToChat) {
      const state = db.getState();
      const targetProjId = String(projectId || state.activeProjectId || 'proj-website-studio');
      const targetChatId = String(chatId || state.activeChatId || 'chat-web-main');
      db.update((draft) => {
        draft.messages.push({
          id: `msg-screen-${Date.now()}`,
          roomId: 'room-exec',
          chatId: targetChatId,
          projectId: targetProjId,
          agentName: 'Visão Jarvis',
          role: 'assistant',
          content: `**${
            regionLabel
              ? `Observação da Zona Selecionada (${String(regionLabel)})`
              : 'Observação em Tempo Real do Teu Ecrã'
          }**:\n\n${result.analysis}`,
          createdAt: new Date().toISOString(),
          engineUsed: result.engineUsed,
          screenIncluded: true,
          studioEvents: [
            {
              type: 'SCREEN',
              id: result.snapshot.id,
              title: regionLabel
                ? `Zona Recortada (${String(regionLabel)})`
                : result.snapshot.source === 'BROWSER_STREAM'
                  ? 'Análise de Ecrã em Direto'
                  : 'Análise de Ecrã via Sidecar',
              subtitle: `${result.snapshot.width}×${result.snapshot.height}`,
            },
          ],
        });
      });
    }

    broadcastSse('state_updated', { section: 'screen' });
    res.json(result);
  });

  // Studio Interactive Artifacts & Antigravity Blueprint Export
  app.get('/api/artifacts', (req, res) => {
    const state = db.getState();
    const projectId = req.query.projectId ? String(req.query.projectId) : state.activeProjectId;
    const artifacts = (state.projectArtifacts || []).filter(
      (a) => !projectId || a.projectId === projectId
    );
    res.json({ artifacts, count: artifacts.length });
  });

  app.post('/api/artifacts', async (req, res) => {
    const t0 = performance.now();
    const body = req.body || {};
    const state = db.getState();
    const projectId = String(body.projectId || state.activeProjectId || 'proj-website-studio');
    const chatId = String(body.chatId || state.activeChatId || 'chat-web-main');
    const project = (state.projects || []).find((p) => p.id === projectId);

    const validKinds: ArtifactKind[] = ['HTML_PREVIEW', 'SVG_DIAGRAM', 'MARKDOWN_DOC', 'CODE_MODULE'];
    const preferredKind = validKinds.includes(body.kind) ? (body.kind as ArtifactKind) : undefined;
    const promptText = String(body.prompt || '').trim();

    let title = String(body.title || '').trim();
    let kind: ArtifactKind = preferredKind || 'HTML_PREVIEW';
    let content = String(body.content || '').trim();
    let summary = String(body.summary || '').trim();
    let language = String(body.language || '').trim();
    let engineUsed = 'STUDIO_ARTIFACT_DIRECT';

    if (!content && promptText) {
      const detFallback = buildDeterministicArtifactFromPrompt({
        prompt: promptText,
        project,
        preferredKind,
      });

      const { getGeminiClient } = await import('./src/server/gemini-engine.ts');
      const ai = state.settings.modelProvider === 'GEMINI_STUDIO' ? getGeminiClient() : null;
      if (ai) {
        try {
          const mdl = normalizeGeminiModelId(state.settings.preferredGeminiModel);
          const kindInstruction =
            (preferredKind || detFallback.kind) === 'SVG_DIAGRAM'
              ? 'Devolve APENAS markup <svg ...>...</svg> vetorial limpo em tema escuro (#0b0d11 / #141821).'
              : (preferredKind || detFallback.kind) === 'MARKDOWN_DOC'
                ? 'Devolve Markdown técnico estruturado em PT-PT.'
                : (preferredKind || detFallback.kind) === 'CODE_MODULE'
                  ? 'Devolve código TypeScript limpo, modular e tipado sem blocos ```.'
                  : 'Devolve um documento HTML5 completo autónomo com <script src="https://cdn.tailwindcss.com"></script>, tema escuro elegante (#0b0d11) e interatividade JavaScript real sem blocos ```.';

          const genRes = await ai.models.generateContent({
            model: mdl,
            contents: `Projeto: "${project?.name || 'Studio'}". Pedido de Artefacto: "${promptText}".\n${kindInstruction}`,
          });
          const rawOut = (genRes.text ?? '')
            .replace(/^```[a-zA-Z]*\n?/i, '')
            .replace(/\n?```$/i, '')
            .trim();
          if (rawOut.length > 32) {
            content = rawOut;
            kind = preferredKind || detFallback.kind;
            title = title || detFallback.title;
            summary = summary || `Gerado com ${mdl} para "${promptText.slice(0, 60)}"`;
            language = language || detFallback.language;
            engineUsed = `GEMINI (${mdl})`;
          }
        } catch {
          // Use deterministic fallback below
        }
      }

      if (!content) {
        title = title || detFallback.title;
        kind = preferredKind || detFallback.kind;
        content = detFallback.content;
        summary = summary || detFallback.summary;
        language = language || detFallback.language;
        engineUsed = 'STUDIO_DETERMINISTIC_GENERATOR';
      }
    }

    if (!content) {
      res.status(400).json({ error: 'Conteúdo ou descrição do artefacto em falta.' });
      return;
    }

    const finalTitle = title || 'Artefacto do Projeto';
    const nowIso = new Date().toISOString();
    let savedArtifact: ProjectArtifact | null = null;

    db.update((draft) => {
      if (!draft.projectArtifacts) draft.projectArtifacts = [];
      const existing = draft.projectArtifacts.find(
        (a) =>
          a.id === body.artifactId ||
          (a.projectId === projectId && a.title.toLowerCase() === finalTitle.toLowerCase())
      );

      if (existing) {
        const nextVer = existing.versions.length + 1;
        existing.kind = kind;
        existing.language = language || existing.language;
        existing.currentVersion = nextVer;
        existing.updatedAt = nowIso;
        existing.versions.push({
          version: nextVer,
          content,
          summary: summary || `Versão v${nextVer} atualizada no Estúdio.`,
          createdAt: nowIso,
          author: 'JARVIS',
        });
        savedArtifact = { ...existing, versions: [...existing.versions] };
      } else {
        const created: ProjectArtifact = {
          id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          projectId,
          chatId,
          title: finalTitle,
          kind,
          language: language || 'html',
          currentVersion: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
          versions: [
            {
              version: 1,
              content,
              summary: summary || 'Versão inicial v1 gerada no Estúdio.',
              createdAt: nowIso,
              author: 'JARVIS',
            },
          ],
        };
        draft.projectArtifacts.unshift(created);
        savedArtifact = { ...created };
      }
    });

    const artObj = savedArtifact!;
    const logEntry = db.appendActivityLog({
      projectId,
      chatId,
      actor: 'JARVIS Artefactos',
      kind: 'ARTIFACT_GENERATED',
      status: 'SUCCESS',
      summary: `Artefacto "${artObj.title}" (v${artObj.currentVersion} · ${artObj.kind})`,
      detail: `${engineUsed} · ${artObj.versions[artObj.versions.length - 1]?.summary || ''}`,
      durationMs: Math.max(1, Math.round(performance.now() - t0)),
    });

    broadcastSse('activity_log', logEntry);
    broadcastSse('state_updated', { section: 'artifacts' });
    res.json({ artifact: artObj, engineUsed });
  });

  app.delete('/api/artifacts/:id', (req, res) => {
    db.update((draft) => {
      draft.projectArtifacts = (draft.projectArtifacts || []).filter((a) => a.id !== req.params.id);
    });
    broadcastSse('state_updated', { section: 'artifacts' });
    res.json({ ok: true });
  });

  app.post('/api/projects/:id/blueprint', (req, res) => {
    const state = db.getState();
    const project = (state.projects || []).find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }

    const assignedSet = new Set(project.assignedAgentIds || []);
    const projectAgents = state.rooms.filter(
      (r) => r.id === 'room-exec' || r.projectId === project.id || assignedSet.has(r.id)
    );

    const blueprint = buildAntigravityProjectBlueprint({
      project,
      goals: state.goals,
      agents: projectAgents,
      skills: state.skills,
      artifacts: state.projectArtifacts || [],
      memories: state.memories,
    });

    const chatId = String(req.body?.chatId || state.activeChatId || project.defaultChatId || 'chat-web-main');
    const logEntry = db.appendActivityLog({
      projectId: project.id,
      chatId,
      actor: state.settings.operatorName || 'Operador',
      kind: 'BLUEPRINT_EXPORTED',
      status: 'SUCCESS',
      summary: `Blueprint Antigravity/IDE gerado para "${project.name}"`,
      detail: 'Ficheiros prontos: PRD.md, ARCHITECTURE.md, TASKS.md, AGENTS.md',
      durationMs: 2,
    });

    broadcastSse('activity_log', logEntry);
    broadcastSse('state_updated', { section: 'blueprint' });
    res.json({ blueprint });
  });

  app.post('/api/rooms', (req, res) => {
    const body = req.body || {};
    const tpl = body.templateId
      ? SPECIALIST_AGENT_TEMPLATES.find((t) => t.id === String(body.templateId))
      : undefined;

    const name = String(body.name || tpl?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Nome do agente/sala é obrigatório.' });
      return;
    }

    const validColors = ['cyan', 'amber', 'emerald', 'rose', 'violet'] as const;
    const accentColor = validColors.includes(body.accentColor)
      ? body.accentColor
      : tpl?.accentColor || 'amber';

    const rawProjectId = body.projectId ? String(body.projectId).trim() : undefined;
    const normalizedProjectId =
      rawProjectId && rawProjectId !== GENERAL_CHAT_PROJECT_ID ? rawProjectId : undefined;

    const room: Room = {
      id: `room-custom-${Date.now()}`,
      name,
      callsign: String(body.callsign || tpl?.callsign || `AGENT-${Math.floor(10 + Math.random() * 89)}`).trim(),
      roleTitle: String(body.roleTitle || tpl?.roleTitle || 'Sub-Agente Especialista').trim(),
      description: String(body.description || tpl?.description || 'Sub-agente recrutado para o projeto.').trim(),
      systemPrompt: String(
        body.systemPrompt ||
          tpl?.systemPrompt ||
          `Atua como ${name} no J.A.R.V.I.S. Studio em Português de Portugal (PT-PT).`
      ).trim(),
      accentColor,
      allowedTools: Array.isArray(body.allowedTools)
        ? body.allowedTools.map(String)
        : tpl?.allowedTools || ['upsert_project_goal', 'search_memories', 'lookup_ast_symbol'],
      projectId: normalizedProjectId,
      modelOverride: body.modelOverride ? String(body.modelOverride).trim() : undefined,
      isCustom: true,
    };

    const nowIso = new Date().toISOString();
    db.update((draft) => {
      draft.rooms.push(room);
      if (room.projectId) {
        const proj = (draft.projects || []).find((p) => p.id === room.projectId);
        if (proj && !proj.assignedAgentIds.includes(room.id)) {
          proj.assignedAgentIds.push(room.id);
        }
      }
      draft.messages.push({
        id: `msg-welcome-${room.id}`,
        roomId: room.id,
        projectId: room.projectId,
        agentName: room.name,
        role: 'assistant',
        content: `Sub-agente **${room.name}** (\`${room.callsign}\`) operacional e integrado no projeto. Ferramentas autorizadas: \`${room.allowedTools.join(', ')}\`.`,
        createdAt: nowIso,
        engineUsed: 'AGENT_RECRUITMENT_GATE',
      });
    });

    if (room.projectId) {
      db.appendActivityLog({
        projectId: room.projectId,
        chatId: body.chatId ? String(body.chatId) : db.getState().activeChatId || 'chat-web-main',
        actor: db.getState().settings.operatorName || 'Operador',
        kind: 'AGENT_SPAWNED',
        status: 'SUCCESS',
        summary: `Sub-agente adicionado: "${room.name}" (${room.callsign})`,
        detail: room.roleTitle,
        durationMs: 2,
        relatedAgentId: room.id,
      });
    }

    db.appendAudit('OPERATOR', 'ORBIT', 'AGENT_RECRUITED', `${room.name} (${room.callsign})`, 'VERIFIED');
    broadcastSse('state_updated', { section: 'rooms' });
    res.json({ room, rooms: db.getState().rooms });
  });

  app.patch('/api/rooms/:id', (req, res) => {
    const body = req.body || {};
    let updated: Room | null = null;
    db.update((draft) => {
      const target = draft.rooms.find((r) => r.id === req.params.id);
      if (!target) return;
      if (typeof body.name === 'string' && body.name.trim()) target.name = body.name.trim();
      if (typeof body.roleTitle === 'string' && body.roleTitle.trim()) target.roleTitle = body.roleTitle.trim();
      if (typeof body.systemPrompt === 'string' && body.systemPrompt.trim()) {
        target.systemPrompt = body.systemPrompt.trim();
      }
      if (Array.isArray(body.allowedTools)) {
        target.allowedTools = body.allowedTools.map(String);
      }
      if (body.projectId !== undefined) {
        target.projectId = body.projectId ? String(body.projectId) : undefined;
      }
      updated = { ...target };
    });
    if (!updated) {
      res.status(404).json({ error: 'Agente/sala não encontrado.' });
      return;
    }
    res.json({ room: updated, rooms: db.getState().rooms });
  });

  app.delete('/api/rooms/:id', (req, res) => {
    const room = db.getState().rooms.find((r) => r.id === req.params.id);
    if (!room) {
      res.status(404).json({ error: 'Agente não encontrado.' });
      return;
    }
    if (!room.isCustom && db.getState().rooms.length <= 2) {
      res.status(400).json({ error: 'Mantém pelo menos as salas nucleares de comando.' });
      return;
    }
    db.update((draft) => {
      draft.rooms = draft.rooms.filter((r) => r.id !== req.params.id);
      draft.messages = draft.messages.filter((m) => m.roomId !== req.params.id);
    });
    broadcastSse('state_updated', { section: 'rooms' });
    res.json({ ok: true, rooms: db.getState().rooms });
  });

  // ==========================================================================
  // 3. Visual DAG Workflows, Cron & OpenClaw Heartbeat
  // ==========================================================================
  app.post('/api/workflows/generate', async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      res.status(400).json({ error: 'Descreve a rotina em linguagem natural.' });
      return;
    }
    const generated = await generateWorkflowFromNaturalLanguage(prompt);
    const newWf = {
      id: `wf-${Date.now()}`,
      name: generated.name,
      description: generated.description,
      enabled: true,
      cronExpr: generated.cronExpr,
      nodes: generated.nodes,
      createdAt: new Date().toISOString(),
    };
    db.update((draft) => {
      draft.workflows.unshift(newWf);
    });
    db.appendAudit('WORKFLOW_BUILDER', 'WORKFLOW', 'WORKFLOW_CREATED', newWf.name, 'VERIFIED');
    res.json({ workflow: newWf, engineUsed: generated.engineUsed });
  });

  app.post('/api/workflows/:id/run', async (req, res) => {
    const run = await runWorkflowById(req.params.id, 'MANUAL');
    if (!run) {
      res.status(404).json({ error: 'Workflow não encontrado.' });
      return;
    }
    res.json({ run, workflows: db.getState().workflows, approvals: db.getState().approvals });
  });

  app.patch('/api/workflows/:id/toggle', (req, res) => {
    let wf = null;
    db.update((draft) => {
      const target = draft.workflows.find((w) => w.id === req.params.id);
      if (target) {
        target.enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !target.enabled;
        wf = target;
      }
    });
    if (!wf) {
      res.status(404).json({ error: 'Workflow não encontrado.' });
      return;
    }
    res.json({ workflow: wf });
  });

  app.delete('/api/workflows/:id', (req, res) => {
    db.update((draft) => {
      draft.workflows = draft.workflows.filter((w) => w.id !== req.params.id);
    });
    res.json({ ok: true });
  });

  app.patch('/api/heartbeat', async (req, res) => {
    const { enabled, intervalSeconds, checkPorts, checkDiskAndRam, checkGoals, triggerNow } = req.body || {};
    db.update((draft) => {
      if (typeof enabled === 'boolean') draft.heartbeat.enabled = enabled;
      if (typeof intervalSeconds === 'number') {
        draft.heartbeat.intervalSeconds = Math.max(15, Math.min(3600, intervalSeconds));
      }
      if (typeof checkPorts === 'boolean') draft.heartbeat.checkPorts = checkPorts;
      if (typeof checkDiskAndRam === 'boolean') draft.heartbeat.checkDiskAndRam = checkDiskAndRam;
      if (typeof checkGoals === 'boolean') draft.heartbeat.checkGoals = checkGoals;
    });

    if (triggerNow) {
      const tel = await collectOSTelemetry(PORT);
      const nowIso = new Date().toISOString();
      db.update((draft) => {
        draft.heartbeat.lastBeatAt = nowIso;
        draft.heartbeat.totalBeats += 1;
        draft.heartbeat.recentAlerts.unshift({
          id: `hb-manual-${Date.now()}`,
          timestamp: nowIso,
          severity: tel.ramPercent > 88 ? 'WARNING' : 'NOMINAL',
          title: 'Pulso Manual Heartbeat Executado',
          detail: `CPU ${tel.cpuUsagePercent}% · RAM ${tel.ramPercent}% (${tel.ramFreeGb} GB livres) · ${tel.ports.filter((p) => p.open).length} portas ativas.`,
        });
      });
    }

    startOrRefreshHeartbeatDaemon(PORT);
    res.json({ heartbeat: db.getState().heartbeat });
  });

  // ==========================================================================
  // 4. Workspace Files, Git, AST Symbol Lookup & Governed Terminal
  // ==========================================================================
  app.get('/api/workspace/overview', async (req, res) => {
    const state = db.getState();
    const projectId = String(req.query.projectId || state.activeProjectId || '');
    const activeProject =
      (state.projects || []).find((p) => p.id === projectId) || (state.projects || [])[0];
    const subPath = activeProject?.rootPath || '.';

    const [files, git, scout] = await Promise.all([
      Promise.resolve(listWorkspaceFiles(160, subPath)),
      getGitOverview(),
      buildScoutWorkspaceIndex(),
    ]);

    const cleanPrefix = subPath === '.' ? '' : subPath.replace(/^\.\//, '');
    const scopedSymbols = cleanPrefix
      ? scout.symbols.filter((s) => s.filePath.startsWith(cleanPrefix))
      : scout.symbols;

    res.json({
      activeProject,
      files,
      git,
      astSummary: {
        symbolsCount: scopedSymbols.length,
        coChangesCount: scout.coChanges.length,
        topCoChanges: scout.coChanges.slice(0, 8),
      },
    });
  });

  app.get('/api/workspace/symbols', async (req, res) => {
    const q = String(req.query.q || '');
    const symbols = await lookupWorkspaceSymbols(q, 40);
    res.json({ symbols });
  });

  app.get('/api/workspace/blast-radius', async (req, res) => {
    const filePath = String(req.query.path || 'server.ts');
    const impact = await analyzeFileBlastRadius(filePath);
    res.json(impact);
  });

  app.get('/api/workspace/file', (req, res) => {
    const filePath = String(req.query.path || '');
    if (!filePath) {
      res.status(400).json({ error: 'Parâmetro path em falta.' });
      return;
    }
    const result = readSafeWorkspaceFile(filePath);
    if (!result.ok) {
      res.status(403).json({ error: result.error });
      return;
    }
    res.json({ path: filePath, content: result.content });
  });

  app.post('/api/workspace/exec', async (req, res) => {
    const command = String(req.body?.command || '').trim();
    if (!command) {
      res.status(400).json({ error: 'Comando vazio.' });
      return;
    }
    const result = await executeGovernedCommand(command, 'WORKSPACE_TERMINAL');
    broadcastSse('state_updated', { section: 'approvals' });
    res.json({ result, approvals: db.getState().approvals });
  });

  // ==========================================================================
  // 5. Modular Routers: Memory Vault, Swarm 48x, Orbit OS & MCP 2026 (A-12)
  // ==========================================================================
  app.use(createMemoryRouter({ broadcastSse }));
  app.use(createSwarmOrbitRouter({ broadcastSse }));
  app.use(createMcpRouter({ port: activePort, broadcastSse }));


  // ==========================================================================
  // 6. Modular OpenClaw Skills, Standard Library, Plugins & Multi-Channel Gateway
  // ==========================================================================
  app.get('/api/skills/catalog', (_req, res) => {
    const state = db.getState();
    res.json({
      installedSkills: state.skills,
      skillsLibrary: STANDARD_SKILLS_LIBRARY,
      plugins: state.plugins || [],
      pluginsCatalog: CORTEX_PLUGINS_CATALOG,
      agentTemplates: SPECIALIST_AGENT_TEMPLATES,
    });
  });

  app.post('/api/skills/install-template', (req, res) => {
    const templateId = String(req.body?.templateId || '');
    const tpl = STANDARD_SKILLS_LIBRARY.find((t) => t.id === templateId);
    if (!tpl) {
      res.status(404).json({ error: 'Template de skill não encontrado na biblioteca.' });
      return;
    }
    const already = db.getState().skills.find((s) => s.slug === tpl.slug);
    if (already) {
      res.json({ skill: already, skills: db.getState().skills, alreadyInstalled: true });
      return;
    }
    const newSkill = {
      id: `skill-lib-${Date.now()}`,
      name: tpl.name,
      slug: tpl.slug,
      category: tpl.category,
      origin: 'LIBRARY' as const,
      description: tpl.description,
      enabled: true,
      systemInstruction: tpl.systemInstruction,
      allowedTools: [...tpl.allowedTools],
      quickCommand: tpl.quickCommand,
      version: tpl.version,
    };
    db.update((draft) => {
      draft.skills.unshift(newSkill);
    });
    db.appendAudit('OPERATOR', 'SYSTEM', 'SKILL_INSTALLED_LIBRARY', newSkill.name, 'VERIFIED');
    broadcastSse('state_updated', { section: 'skills' });
    res.json({ skill: newSkill, skills: db.getState().skills });
  });

  app.post('/api/skills', (req, res) => {
    const { name, category, description, systemInstruction, quickCommand, allowedTools } = req.body || {};
    if (!name?.trim() || !systemInstruction?.trim()) {
      res.status(400).json({ error: 'Nome e instruções de sistema são obrigatórios.' });
      return;
    }
    const slug = String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const skill = {
      id: `skill-${Date.now()}`,
      name: String(name).trim(),
      slug: slug || `skill-${Date.now()}`,
      category: (category || 'CUSTOM') as 'CUSTOM',
      origin: 'CUSTOM' as const,
      description: String(description || 'Skill personalizada OpenClaw').trim(),
      enabled: true,
      systemInstruction: String(systemInstruction).trim(),
      allowedTools: Array.isArray(allowedTools) ? allowedTools : ['search_memories'],
      quickCommand: String(quickCommand || `/${slug}`).trim(),
      version: '1.0.0',
    };
    db.update((draft) => {
      draft.skills.unshift(skill);
    });
    db.appendAudit('OPERATOR', 'SYSTEM', 'SKILL_CREATED', skill.name, 'VERIFIED');
    res.json({ skill, skills: db.getState().skills });
  });

  app.patch('/api/skills/:id', (req, res) => {
    let updated = null;
    db.update((draft) => {
      const s = draft.skills.find((x) => x.id === req.params.id);
      if (s) {
        if (typeof req.body?.enabled === 'boolean') s.enabled = req.body.enabled;
        if (req.body?.systemInstruction) s.systemInstruction = String(req.body.systemInstruction);
        updated = s;
      }
    });
    if (!updated) {
      res.status(404).json({ error: 'Skill não encontrada.' });
      return;
    }
    res.json({ skill: updated });
  });

  app.delete('/api/skills/:id', (req, res) => {
    db.update((draft) => {
      draft.skills = draft.skills.filter((s) => s.id !== req.params.id);
    });
    res.json({ ok: true, skills: db.getState().skills });
  });

  app.post('/api/plugins', (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Nome do plugin é obrigatório.' });
      return;
    }
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const plugin: PluginItem = {
      id: `plug-custom-${Date.now()}`,
      name,
      slug: slug || `plug-${Date.now()}`,
      category: body.category || 'WORKFLOW',
      description: String(body.description || 'Plugin personalizado registado no Cortex OS.').trim(),
      version: String(body.version || '1.0.0').trim(),
      author: String(body.author || db.getState().settings.operatorName).trim(),
      hook: (body.hook || 'POST_TURN') as PluginLifecycleHook,
      enabled: true,
      installed: true,
      config: body.config && typeof body.config === 'object' ? body.config : {},
      invocationsCount: 0,
    };
    db.update((draft) => {
      if (!draft.plugins) draft.plugins = [];
      draft.plugins.unshift(plugin);
    });
    db.appendAudit('OPERATOR', 'SYSTEM', 'PLUGIN_INSTALLED', plugin.name, 'VERIFIED');
    res.json({ plugin, plugins: db.getState().plugins });
  });

  app.patch('/api/plugins/:id', (req, res) => {
    const body = req.body || {};
    let updated: PluginItem | null = null;
    db.update((draft) => {
      const target = (draft.plugins || []).find((p) => p.id === req.params.id);
      if (!target) return;
      if (typeof body.installed === 'boolean') {
        target.installed = body.installed;
        if (!body.installed) target.enabled = false;
      }
      if (typeof body.enabled === 'boolean') {
        target.enabled = body.enabled;
        if (body.enabled) target.installed = true;
      }
      if (body.config && typeof body.config === 'object') {
        target.config = { ...target.config, ...body.config };
      }
      updated = { ...target };
    });
    if (!updated) {
      res.status(404).json({ error: 'Plugin não encontrado.' });
      return;
    }
    res.json({ plugin: updated, plugins: db.getState().plugins });
  });

  app.delete('/api/plugins/:id', (req, res) => {
    db.update((draft) => {
      draft.plugins = (draft.plugins || []).filter((p) => p.id !== req.params.id);
    });
    res.json({ ok: true, plugins: db.getState().plugins });
  });

  app.post('/api/channels', (req, res) => {
    const { platform, name, endpointOrBotTag, ownerAllowList } = req.body || {};
    if (!name?.trim()) {
      res.status(400).json({ error: 'Nome do canal é obrigatório.' });
      return;
    }
    const list = Array.isArray(ownerAllowList)
      ? ownerAllowList.map((s) => String(s).trim()).filter(Boolean)
      : String(ownerAllowList || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

    const ch = {
      id: `chan-${Date.now()}`,
      platform: (platform || 'WEBHOOK') as ChannelPlatform,
      name: String(name).trim(),
      enabled: true,
      endpointOrBotTag: String(endpointOrBotTag || '/api/channels/webhook/custom').trim(),
      ownerAllowList: list,
    };
    db.update((draft) => {
      draft.channels.push(ch);
    });
    res.json({ channel: ch });
  });

  app.patch('/api/channels/:id', (req, res) => {
    let updated = null;
    db.update((draft) => {
      const ch = draft.channels.find((c) => c.id === req.params.id);
      if (ch) {
        if (typeof req.body?.enabled === 'boolean') ch.enabled = req.body.enabled;
        if (req.body?.ownerAllowList !== undefined) {
          ch.ownerAllowList = Array.isArray(req.body.ownerAllowList)
            ? req.body.ownerAllowList.map((s: unknown) => String(s).trim()).filter(Boolean)
            : String(req.body.ownerAllowList)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        }
        updated = ch;
      }
    });
    if (!updated) {
      res.status(404).json({ error: 'Canal não encontrado.' });
      return;
    }
    res.json({ channel: updated });
  });

  app.post('/api/channels/:id/simulate-webhook', async (req, res) => {
    const ch = db.getState().channels.find((c) => c.id === req.params.id);
    if (!ch) {
      res.status(404).json({ error: 'Canal não encontrado.' });
      return;
    }
    const senderId = String(req.body?.senderId || '').trim();
    const message = String(req.body?.message || 'Status executivo').trim();
    const verdict = validateChannelSender(ch, senderId);

    if (!verdict.allowed) {
      db.appendAudit(
        `CHANNEL:${ch.platform}`,
        'CHANNEL',
        'INBOUND_BLOCKED',
        `${ch.name} rejeitou remetente "${senderId || 'anónimo'}" (${verdict.reason})`,
        'BLOCKED'
      );
      res.json({ verdict, reply: null });
      return;
    }

    const threshold = db.getState().settings.trustThreshold ?? 70;
    const scan = detectPromptInjection(message, threshold);
    if (scan.blocked) {
      db.appendAudit(
        `CHANNEL:${ch.platform}`,
        'SECURITY',
        'CHANNEL_INJECTION_BLOCKED',
        `Remetente ${senderId} (risco=${scan.riskScore}/100): ${scan.matchedRules.join(', ')}`,
        'BLOCKED'
      );
      res.json({
        verdict: { allowed: false, isOwner: verdict.isOwner, reason: 'PROMPT_INJECTION_BLOCKED' },
        reply: null,
      });
      return;
    }

    db.update((draft) => {
      const target = draft.channels.find((c) => c.id === ch.id);
      if (target) target.lastEventAt = new Date().toISOString();
    });

    const turn = await runAgentChatTurn({
      roomId: 'room-exec',
      userText: `[${ch.platform} · ${senderId}${verdict.isOwner ? ' (OWNER)' : ''}]: ${message}`,
      activePort,
    });

    db.appendAudit(
      `CHANNEL:${ch.platform}`,
      'CHANNEL',
      'INBOUND_PROCESSED',
      `${senderId} (${verdict.reason}) -> processado com sucesso`,
      'VERIFIED'
    );
    res.json({ verdict, reply: turn.assistantMessage.content });
  });

  // ==========================================================================
  // 7. Devices, Live Telemetry & Desktop Sidecar Enrollment / Clipboard Guard
  // ==========================================================================
  app.get('/api/telemetry', async (_req, res) => {
    const telemetry = await collectOSTelemetry(activePort);
    res.json({ telemetry });
  });

  app.post('/api/devices/tokens', (req, res) => {
    const label = String(req.body?.label || 'Nó Remoto Sidecar').trim();
    const targetOs: 'WINDOWS' | 'LINUX' = req.body?.targetOs === 'LINUX' ? 'LINUX' : 'WINDOWS';
    const rand = crypto.randomBytes(6).toString('hex').toUpperCase();
    const tokenObj = {
      id: `tok-${Date.now()}`,
      token: `JRV3-${targetOs.slice(0, 3)}-${rand.slice(0, 4)}-${rand.slice(4, 8)}-${rand.slice(8, 12)}`,
      label,
      targetOs,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    };
    db.update((draft) => {
      draft.enrollmentTokens.unshift(tokenObj);
    });
    db.appendAudit('OPERATOR', 'SYSTEM', 'ENROLLMENT_TOKEN_ISSUED', `${label} (${targetOs})`, 'VERIFIED');
    res.json({ enrollmentToken: tokenObj });
  });

  app.post('/api/sidecar/clipboard-scan', (req, res) => {
    const text = String(req.body?.text || '');
    const threshold = db.getState().settings.trustThreshold ?? 70;
    const scan = detectPromptInjection(text, threshold);
    const hasSecretPattern = /(sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{30,}|ghp_[a-zA-Z0-9]{30,})/.test(text);
    if (scan.blocked || hasSecretPattern) {
      db.appendAudit(
        'CLIPBOARD_GUARD',
        'SECURITY',
        'CLIPBOARD_ALERT',
        hasSecretPattern ? 'Chave de API detetada na área de transferência' : `Injeção detetada (risco=${scan.riskScore}/100 · ${scan.matchedRules.join(', ')})`,
        'BLOCKED'
      );
    }
    res.json({
      ...scan,
      hasSecretPattern,
      safe: !scan.blocked && !hasSecretPattern,
    });
  });

  app.get('/api/sidecar/host-snapshot', async (req, res) => {
    const deviceId = req.query.deviceId ? String(req.query.deviceId) : 'dev-local-host';
    const snapshot = await collectSidecarHostSnapshot(deviceId);
    res.json({ snapshot });
  });

  app.post('/api/sidecar/hotkey', async (req, res) => {
    const combo = String(req.body?.combo || 'Alt+Space').trim();
    const deviceId = String(req.body?.deviceId || 'dev-local-host');
    const record = await triggerSidecarHotkey(combo, deviceId);
    broadcastSse('sidecar_event', { record });
    res.json({ record, snapshot: await collectSidecarHostSnapshot(deviceId) });
  });

  app.post('/api/sidecar/host-exec', async (req, res) => {
    const command = String(req.body?.command || '').trim();
    const deviceId = String(req.body?.deviceId || 'dev-local-host');
    const kind = req.body?.kind || 'HOST_EXEC';
    if (!command) {
      res.status(400).json({ error: 'Comando para a máquina Sidecar é obrigatório.' });
      return;
    }
    const record = await dispatchSidecarHostCommand({ command, deviceId, kind });
    broadcastSse('sidecar_event', { record });
    broadcastSse('state_updated', { section: 'approvals' });
    res.json({
      record,
      approvals: db.getState().approvals,
      snapshot: await collectSidecarHostSnapshot(deviceId),
    });
  });

  app.post('/api/sidecar/enroll', (req, res) => {
    const { token, hostname, osType, ipAddress } = req.body || {};
    const cleanTok = String(token || '').trim();
    const state = db.getState();
    const matchedTok = state.enrollmentTokens.find((t) => t.token === cleanTok);
    if (!matchedTok && cleanTok) {
      res.status(403).json({ error: 'Token de emparelhamento Sidecar inválido ou expirado.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const devId = `dev-sidecar-${Date.now()}`;
    const cleanHost = String(hostname || matchedTok?.label || 'sidecar-workstation').trim();
    const node = {
      id: devId,
      name: cleanHost,
      osType: (['WINDOWS', 'LINUX', 'MACOS'].includes(osType) ? osType : matchedTok?.targetOs || 'WINDOWS') as
        | 'WINDOWS'
        | 'LINUX'
        | 'MACOS',
      hostname: cleanHost,
      ipAddress: String(ipAddress || '192.168.1.48').trim(),
      status: 'ONLINE' as const,
      isCurrentHost: false,
      lastSeenAt: nowIso,
      capabilities: ['SidecarRPC', 'Hotkeys', 'ClipboardGuard', 'ProcessRadar'],
    };

    db.update((draft) => {
      draft.devices.push(node);
      if (matchedTok) {
        const tRef = draft.enrollmentTokens.find((x) => x.id === matchedTok.id);
        if (tRef) tRef.usedByDeviceId = devId;
      }
    });
    db.appendAudit('SIDECAR_ENROLL', 'SIDECAR', 'DEVICE_PAIRED', `${node.name} (${node.ipAddress})`, 'VERIFIED');
    broadcastSse('state_updated', { section: 'devices' });
    res.json({ device: node, devices: db.getState().devices });
  });

  app.get('/api/sidecar/queue/:deviceId', (req, res) => {
    const queued = (db.getState().sidecarCommandQueue || []).filter(
      (c) => c.deviceId === req.params.deviceId && c.status === 'QUEUED_REMOTE'
    );
    res.json({ queue: queued });
  });

  app.post('/api/sidecar/queue/:commandId/result', (req, res) => {
    const output = String(req.body?.output || 'Concluído no Sidecar remoto.');
    let updated = null;
    db.update((draft) => {
      const target = (draft.sidecarCommandQueue || []).find((c) => c.id === req.params.commandId);
      if (target) {
        target.status = 'EXECUTED';
        target.output = output;
        updated = { ...target };
      }
    });
    if (!updated) {
      res.status(404).json({ error: 'Comando Sidecar não encontrado.' });
      return;
    }
    broadcastSse('sidecar_event', { record: updated });
    res.json({ record: updated });
  });

  // ==========================================================================
  // 8. System, Auth, Doctor, Approvals, Settings, Voice & Backup Router (A-12)
  // ==========================================================================
  app.use(
    createSystemRouter({
      port: activePort,
      host: activeHost,
      broadcastSse,
      reloadDotEnv: loadDotEnvIfPresent,
    })
  );

  app.get('/api/voice/catalog', (_req, res) => {
    loadDotEnvIfPresent();
    const state = db.getState();
    res.json({
      voices: GEMINI_VOICE_CATALOG,
      preferredVoiceName: normalizeGeminiVoiceName(state.settings.preferredVoiceName),
      voiceDspEnabled: Boolean(state.settings.voiceDspEnabled),
      liveVoiceScreenSync: state.settings.liveVoiceScreenSync !== false,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      models: {
        liveConversation: 'gemini-3.8-live',
        audioTranscribe: 'gemini-3.5-transcribe',
        voicePreview: 'gemini-3.8-flash-lite-tts',
      },
    });
  });

  app.post('/api/voice/preview', async (req, res) => {
    loadDotEnvIfPresent();
    const result = await synthesizeVoicePreviewServerSide({
      voiceName: req.body?.voiceName ? String(req.body.voiceName) : undefined,
      language: req.body?.language,
      customText: req.body?.customText ? String(req.body.customText) : undefined,
    });
    res.json(result);
  });

  app.post('/api/audio/transcribe', async (req, res) => {
    loadDotEnvIfPresent();
    const audioBase64 = String(req.body?.audioBase64 || '');
    if (!audioBase64.trim()) {
      res.status(400).json({ ok: false, transcript: '', error: 'Áudio em falta.' });
      return;
    }
    const result = await transcribeAudioServerSide({
      audioBase64,
      mimeType: req.body?.mimeType ? String(req.body.mimeType) : 'audio/webm',
      language: req.body?.language,
      projectId: req.body?.projectId ? String(req.body.projectId) : undefined,
      chatId: req.body?.chatId ? String(req.body.chatId) : undefined,
    });
    if (result.ok && result.transcript) {
      broadcastSse('state_updated', { section: 'audio_transcribe' });
    }
    res.json(result);
  });

  return { app, broadcastSse };
}

async function startServer() {
  // §7: CLI Health & Dependency Doctor (`tsx server.ts --doctor` or `node server.ts --doctor`)
  if (process.argv.includes('--doctor')) {
    const report = await runSystemDoctor({ port: PORT, host: HOST });
    console.log(JSON.stringify(report, null, 2));
    db.flushSync({ writeJsonMirror: true });
    process.exit(report.healthy ? 0 : 1);
  }

  // A-01: Refuse unauthenticated non-loopback bind on unmanaged networks
  const bindPolicy = evaluateBindAuthPolicy(HOST, process.env);
  if (!bindPolicy.canBoot) {
    console.error(bindPolicy.fatalReason);
    process.exit(1);
  }

  const { app, broadcastSse } = createJarvisExpressApp({ port: PORT, host: HOST });

  // ==========================================================================
  // Vite Middleware (Dev) or Static Bundle (Production) + Fast Port 3000 Bind
  // ==========================================================================
  const httpServer = http.createServer(app);
  attachGeminiLiveWebSocketServer({
    httpServer,
    activePort: PORT,
    broadcastSse,
  });
  const isProd =
    process.env.NODE_ENV === 'production' &&
    fs.existsSync(path.join(__dirname, 'dist', 'index.html'));

  if (!isProd) {
    const vitePromise = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          allowedHosts: true,
          hmr: false,
        },
        appType: 'spa',
      })
    );

    app.use((req, res, next) => {
      vitePromise
        .then((vite) => vite.middlewares(req, res, next))
        .catch((err) => next(err));
    });
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, HOST, () => {
    printStartupDebugBanner({
      port: PORT,
      host: HOST,
      storageEngine: db.getEngineName(),
      isProd,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    });
    console.log(
      `[J.A.R.V.I.S. Cortex OS v4.0] Listening on http://${HOST}:${PORT} (${db.getEngineName()} WAL v4 + MCP 2026)`
    );

    setTimeout(() => {
      startOrRefreshHeartbeatDaemon(PORT);
      buildScoutWorkspaceIndex().catch((err) => {
        debugLog('WARN', 'SCOUT-AST', `Initial AST pre-warm warning: ${(err as Error).message}`);
      });
    }, 1500);
  });
}

const isDoctorCliInvocation = process.argv.includes('--doctor');
const shouldSkipAutoStart =
  !isDoctorCliInvocation &&
  (Boolean(process.env.NODE_TEST_CONTEXT) || process.env.JARVIS_SKIP_AUTO_LISTEN === '1');

if (!shouldSkipAutoStart) {
  startServer().catch((err) => {
    console.error('[FATAL] Failed to start server:', err);
    process.exit(1);
  });
}

