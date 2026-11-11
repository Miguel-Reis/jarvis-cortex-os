import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  compressFactTelegraphic,
  computeBinaryQuantization128,
  computeHippoRagPPR,
  computeSimHash128,
  detectPromptInjection,
  findShortestGraphPath,
  rankQ18Actions,
  redactAiDefenceSecrets,
  routeJevS1,
  searchMemories4WayRRF,
  validateChannelSender,
  validateMcpServerAuthorityGate,
} from './src/shared/cortex-math.ts';
import {
  buildDefaultMcpRegistryResources,
  buildDefaultMcpRegistryTools,
  MCP_STANDARD_LIBRARY,
} from './src/shared/mcp-catalog.ts';
import {
  CORTEX_PLUGINS_CATALOG,
  SPECIALIST_AGENT_TEMPLATES,
  STANDARD_SKILLS_LIBRARY,
} from './src/shared/skills-plugins-catalog.ts';
import type {
  ChannelPlatform,
  McpCustomServer,
  McpLibraryCategory,
  McpRegistryResourceItem,
  McpRegistryToolItem,
  McpTransportType,
  MemoryCategory,
  MemoryTier,
  PluginItem,
  PluginLifecycleHook,
  ProjectWorkspace,
  Room,
  SwarmLane,
  TodayContractItem,
} from './src/shared/types.ts';
import { db } from './src/server/db.ts';
import {
  collectOSTelemetry,
  collectSidecarHostSnapshot,
  dispatchSidecarHostCommand,
  executeGovernedCommand,
  getGitOverview,
  listWorkspaceFiles,
  readSafeWorkspaceFile,
  triggerSidecarHotkey,
  verifyTodayContractItem,
} from './src/server/os-adapter.ts';
import {
  generateWorkflowFromNaturalLanguage,
  runAgentChatTurn,
  synthesizeBriefText,
  testModelProviderConnection,
} from './src/server/gemini-engine.ts';
import {
  registerWorkflowBroadcaster,
  runWorkflowById,
  startOrRefreshHeartbeatDaemon,
} from './src/server/workflow-runner.ts';
import {
  analyzeFileBlastRadius,
  buildScoutWorkspaceIndex,
  createSubagentSandbox,
  generateScoutArchitectureReport,
  getBrainCognitiveOverview,
  launchAsymmetricSwarm,
  lookupWorkspaceSymbols,
  mergeSubagentSandbox,
  mutateAndTestSandbox,
  probeAndSyncBrain8765,
  registerSwarmOrbitBroadcaster,
  rollbackSubagentSandbox,
  runProjectProactiveScan,
  storeBiTemporalMemory,
} from './src/server/swarm-orbit-engine.ts';
import {
  getMcpCatalogSummary,
  getMcpGatewayOverview,
  handleMcpJsonRpc,
  probeAllMcpGatewayItems,
  probeExternalMcpServer,
} from './src/server/mcp-server.ts';
import {
  createHttpDebugMiddleware,
  debugLog,
  getDebugLogFilePath,
  getRecentDebugLogs,
  isDebugLoggingEnabled,
  printStartupDebugBanner,
} from './src/server/debug-logger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const portFlagIdx = process.argv.indexOf('--port');
  if (portFlagIdx >= 0 && process.argv[portFlagIdx + 1]) {
    const parsed = Number(process.argv[portFlagIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Number(process.env.PORT) || 3000;
}

const PORT = resolvePort();
const HOST = process.env.HOST || '0.0.0.0';

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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
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
  startOrRefreshHeartbeatDaemon(PORT);

  // Pre-warm SCOUT-01 AST index asynchronously
  buildScoutWorkspaceIndex().catch((err) => {
    debugLog('WARN', 'SCOUT-AST', `Initial AST pre-warm warning: ${(err as Error).message}`);
  });

  // ==========================================================================
  // Health & Unified Bootstrap State
  // ==========================================================================
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '3.0.0',
      storageEngine: db.getEngineName(),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      mcpProtocol: '2025-06-18',
      port: PORT,
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
      proactiveEnabled,
      proactiveIntervalSec,
      assignedAgentIds,
    } = req.body || {};

    const cleanName = String(name || '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'Nome do projeto é obrigatório.' });
      return;
    }

    const slug = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const nowIso = new Date().toISOString();
    const id = `proj-${Date.now()}`;
    const newProj: ProjectWorkspace = {
      id,
      name: cleanName,
      slug: slug || id,
      rootPath: String(rootPath || '.').trim() || '.',
      techStack: String(techStack || 'TypeScript · Node.js').trim(),
      gitBranch: String(gitBranch || 'main').trim() || 'main',
      description: String(description || 'Projeto registado na carteira multi-projeto do Jarvis.').trim(),
      status: 'ACTIVE',
      proactiveEnabled: proactiveEnabled !== false,
      proactiveIntervalSec: Math.max(30, Number(proactiveIntervalSec) || 90),
      healthScore: 95,
      openTasksCount: 1,
      assignedAgentIds: Array.isArray(assignedAgentIds)
        ? assignedAgentIds.map(String)
        : ['room-exec', 'room-eng'],
      lastProactiveAt: nowIso,
      proactiveInsights: [],
    };

    db.update((draft) => {
      if (!draft.projects) draft.projects = [];
      draft.projects.unshift(newProj);
      draft.activeProjectId = newProj.id;
    });

    if (newProj.proactiveEnabled) {
      await runProjectProactiveScan(newProj.id).catch(() => {});
    }

    db.appendAudit('OPERATOR', 'PROJECT', 'PROJECT_CREATED', `${newProj.name} (${newProj.rootPath})`, 'VERIFIED');
    broadcastSse('state_updated', { section: 'projects' });
    res.json({
      project: (db.getState().projects || []).find((p) => p.id === id) || newProj,
      projects: db.getState().projects,
      activeProjectId: db.getState().activeProjectId,
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
    db.update((draft) => {
      const target = (draft.projects || []).find((p) => p.id === req.params.id);
      if (target) {
        draft.activeProjectId = target.id;
        if (target.status === 'STANDBY') target.status = 'ACTIVE';
        found = { ...target };
      }
    });
    if (!found) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    broadcastSse('state_updated', { section: 'projects' });
    res.json({ project: found, activeProjectId: found.id });
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
      if (draft.activeProjectId === req.params.id && draft.projects[0]) {
        draft.activeProjectId = draft.projects[0].id;
      }
    });
    if (!removed) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    broadcastSse('state_updated', { section: 'projects' });
    res.json({ ok: true, projects: db.getState().projects, activeProjectId: db.getState().activeProjectId });
  });

  app.post('/api/projects/proactive-scan', async (req, res) => {
    const projectId = req.body?.projectId ? String(req.body.projectId) : undefined;
    const scanned = await runProjectProactiveScan(projectId);
    res.json({ scanned, projects: db.getState().projects });
  });

  app.post('/api/projects/:id/insights/:insightId/resolve', async (req, res) => {
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
          const vRes = await verifyTodayContractItem(c, PORT);
          db.update((draft) => {
            const target = draft.contracts.find((x) => x.id === c.id);
            if (target) {
              target.status = vRes.verified ? 'VERIFIED' : 'FAILED';
              target.evidenceHash = vRes.evidenceHash;
              target.lastCheckedAt = new Date().toISOString();
              target.outputSummary = vRes.summary;
            }
          });
        }
        executionSummary = 'Todos os contratos Today Contract Gate foram verificados com SHA-256.';
      } else if (insight.actionKind === 'EXEC_COMMAND') {
        const execRes = await executeGovernedCommand(insight.suggestedCommandOrPrompt, 'WORKSPACE_TERMINAL');
        executionSummary = execRes.output.slice(0, 260);
      } else if (insight.actionKind === 'OPEN_CHAT') {
        const turn = await runAgentChatTurn({
          roomId: proj.assignedAgentIds[0] || 'room-exec',
          userText: insight.suggestedCommandOrPrompt,
          activePort: PORT,
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

  // ==========================================================================
  // 1. Brief, Q-18, Goals, Today Contract Gate, Decisions & Routine Cues
  // ==========================================================================
  app.post('/api/brief/synthesize', async (_req, res) => {
    const text = await synthesizeBriefText();
    res.json({ text, generatedAt: new Date().toISOString() });
  });

  app.post('/api/goals', (req, res) => {
    const { title, category, targetMetric, deadline } = req.body || {};
    if (!title || !String(title).trim()) {
      res.status(400).json({ error: 'Título do objetivo é obrigatório.' });
      return;
    }
    const goal = {
      id: `goal-${Date.now()}`,
      title: String(title).trim(),
      category: String(category || 'Estratégia').trim(),
      progress: 10,
      targetMetric: String(targetMetric || 'Meta verificável').trim(),
      deadline: String(deadline || '2026-12-31'),
      status: 'ACTIVE' as const,
    };
    db.update((draft) => {
      draft.goals.unshift(goal);
    });
    res.json({ goal });
  });

  app.patch('/api/goals/:id', (req, res) => {
    const { progress, status } = req.body || {};
    let updated = null;
    db.update((draft) => {
      const g = draft.goals.find((x) => x.id === req.params.id);
      if (g) {
        if (typeof progress === 'number') {
          g.progress = Math.max(0, Math.min(100, progress));
          if (g.progress === 100) g.status = 'COMPLETED';
        }
        if (status) g.status = status;
        updated = g;
      }
    });
    if (!updated) {
      res.status(404).json({ error: 'Objetivo não encontrado.' });
      return;
    }
    res.json({ goal: updated });
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
    };
    db.update((draft) => {
      draft.contracts.push(item);
    });
    res.json({ contract: item });
  });

  app.post('/api/contracts/:id/verify', async (req, res) => {
    const contract = db.getState().contracts.find((c) => c.id === req.params.id);
    if (!contract) {
      res.status(404).json({ error: 'Contrato não encontrado.' });
      return;
    }
    const result = await verifyTodayContractItem(contract, PORT);
    let updated: TodayContractItem | undefined;
    db.update((draft) => {
      const target = draft.contracts.find((c) => c.id === req.params.id);
      if (target) {
        target.status = result.verified ? 'VERIFIED' : 'FAILED';
        target.evidenceHash = result.evidenceHash;
        target.lastCheckedAt = new Date().toISOString();
        target.outputSummary = result.summary;
        updated = target;
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
  // 2. Multimodal Agentic Chat & Specialist Rooms
  // ==========================================================================
  app.post('/api/chat/send', async (req, res) => {
    const { roomId, content, attachments } = req.body || {};
    if (!content?.trim() && (!Array.isArray(attachments) || attachments.length === 0)) {
      res.status(400).json({ error: 'Mensagem vazia.' });
      return;
    }
    const result = await runAgentChatTurn({
      roomId: String(roomId || 'room-exec'),
      userText: String(content || ''),
      attachments: Array.isArray(attachments) ? attachments : [],
      activePort: PORT,
    });
    broadcastSse('chat_message', { roomId, assistantMessage: result.assistantMessage });
    res.json(result);
  });

  app.delete('/api/chat/:roomId/clear', (req, res) => {
    db.update((draft) => {
      draft.messages = draft.messages.filter((m) => m.roomId !== req.params.roomId);
    });
    res.json({ ok: true });
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
      : tpl?.accentColor || 'cyan';

    const room: Room = {
      id: `room-custom-${Date.now()}`,
      name,
      callsign: String(body.callsign || tpl?.callsign || `AGENT-${Math.floor(10 + Math.random() * 89)}`).trim(),
      roleTitle: String(body.roleTitle || tpl?.roleTitle || 'Agente Especialista Personalizado').trim(),
      description: String(body.description || tpl?.description || 'Agente recrutado pelo Operador.').trim(),
      systemPrompt: String(
        body.systemPrompt ||
          tpl?.systemPrompt ||
          `Atua como ${name} no J.A.R.V.I.S. Cortex OS em Português de Portugal (PT-PT).`
      ).trim(),
      accentColor,
      allowedTools: Array.isArray(body.allowedTools)
        ? body.allowedTools.map(String)
        : tpl?.allowedTools || ['search_memories', 'lookup_ast_symbol'],
      projectId: body.projectId ? String(body.projectId) : undefined,
      modelOverride: body.modelOverride ? String(body.modelOverride).trim() : undefined,
      isCustom: true,
    };

    const nowIso = new Date().toISOString();
    db.update((draft) => {
      draft.rooms.push(room);
      draft.messages.push({
        id: `msg-welcome-${room.id}`,
        roomId: room.id,
        role: 'assistant',
        content: `Agente **${room.name}** (\`${room.callsign}\`) operacional e integrado na frota. Ferramentas autorizadas: \`${room.allowedTools.join(', ')}\`.`,
        createdAt: nowIso,
        engineUsed: 'AGENT_RECRUITMENT_GATE',
      });
    });

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
  // 5. Memory Vault, 4-Way Weighted RRF, Bi-Temporal & HippoRAG 2 PPR
  // ==========================================================================
  app.get('/api/memories/graph', (req, res) => {
    const seedId = req.query.seedId ? String(req.query.seedId) : undefined;
    const includeSuperseded = req.query.includeSuperseded === 'true';
    const state = db.getState();
    const pool = includeSuperseded
      ? state.memories
      : state.memories.filter((m) => !m.supersededBy && !m.validUntil);
    const nodes = computeHippoRagPPR(pool, state.graphEdges, seedId);
    res.json({ nodes, edges: state.graphEdges, memories: state.memories });
  });

  app.get('/api/memories/search-rrf', (req, res) => {
    const q = String(req.query.q || '');
    const includeSuperseded = req.query.includeSuperseded === 'true';
    const seedId = req.query.seedId ? String(req.query.seedId) : undefined;
    const state = db.getState();
    const hits = searchMemories4WayRRF(q, state.memories, state.graphEdges, {
      includeSuperseded,
      seedId,
    });
    res.json({ hits });
  });

  app.get('/api/memories/path', (req, res) => {
    const fromId = String(req.query.from || '');
    const toId = String(req.query.to || '');
    const state = db.getState();
    const pathResult = findShortestGraphPath(fromId, toId, state.graphEdges);
    res.json(pathResult);
  });

  app.post('/api/memories', (req, res) => {
    const { topic, content, category, provenance, tier, importance, tags, pinned, linkedMemoryId } =
      req.body || {};
    if (!topic?.trim() || !content?.trim()) {
      res.status(400).json({ error: 'Tópico e conteúdo são obrigatórios.' });
      return;
    }

    const parsedTags = Array.isArray(tags)
      ? tags.map((t) => String(t).trim()).filter(Boolean)
      : String(tags || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);

    const stored = storeBiTemporalMemory({
      topic: String(topic),
      content: String(content),
      category: (category || 'FACT') as MemoryCategory,
      provenance: provenance === 'INFERRED' ? 'INFERRED' : 'CONFIRMED',
      tier: (tier as MemoryTier) || undefined,
      importance: typeof importance === 'number' ? importance : undefined,
      tags: parsedTags,
      pinned: Boolean(pinned),
      sourceUri: 'operator://vault-ui',
      linkedMemoryId: linkedMemoryId ? String(linkedMemoryId) : undefined,
    });

    db.appendAudit(
      'OPERATOR',
      'MEMORY',
      'MEMORY_CREATED_BITEMPORAL',
      `${stored.memory.topic}${stored.supersededIds.length ? ` (superou ${stored.supersededIds.length})` : ''}`,
      'VERIFIED'
    );
    const activePool = db.getState().memories.filter((m) => !m.supersededBy && !m.validUntil);
    const nodes = computeHippoRagPPR(activePool, db.getState().graphEdges, stored.memory.id);
    res.json({
      memory: stored.memory,
      supersededIds: stored.supersededIds,
      nodes,
      edges: db.getState().graphEdges,
    });
  });

  app.patch('/api/memories/:id', (req, res) => {
    let updated = null;
    db.update((draft) => {
      const m = draft.memories.find((x) => x.id === req.params.id);
      if (m) {
        if (typeof req.body?.pinned === 'boolean') m.pinned = req.body.pinned;
        if (req.body?.provenance) m.provenance = req.body.provenance;
        if (req.body?.tier) m.tier = req.body.tier;
        if (req.body?.topic) m.topic = String(req.body.topic).trim();
        if (req.body?.content) {
          m.content = String(req.body.content).trim();
          m.simHash = computeSimHash128(`${m.topic} ${m.content}`);
          m.bq128Hex = computeBinaryQuantization128(`${m.topic} ${m.content}`);
        }
        m.accessCount = (m.accessCount ?? 1) + 1;
        m.lastAccessedAt = new Date().toISOString();
        m.updatedAt = new Date().toISOString();
        updated = m;
      }
    });
    if (!updated) {
      res.status(404).json({ error: 'Memória não encontrada.' });
      return;
    }
    res.json({ memory: updated });
  });

  app.delete('/api/memories/:id', (req, res) => {
    db.update((draft) => {
      draft.memories = draft.memories.filter((m) => m.id !== req.params.id);
      draft.graphEdges = draft.graphEdges.filter(
        (e) => e.source !== req.params.id && e.target !== req.params.id
      );
    });
    res.json({ ok: true });
  });

  app.post('/api/memories/sync-brain', async (_req, res) => {
    const syncRes = await probeAndSyncBrain8765(true);
    db.appendAudit(
      'BRAIN_BRIDGE',
      'MEMORY',
      syncRes.status.httpOnline ? 'SYNC_8765_LIVE' : 'SYNC_NATIVE_STANDALONE',
      syncRes.message,
      'VERIFIED'
    );
    res.json({
      online: syncRes.status.httpOnline || syncRes.status.sqliteWalDetected,
      imported: syncRes.importedCount,
      brainUrl: syncRes.status.endpointUrl,
      status: syncRes.status,
      message: syncRes.message,
    });
  });

  app.get('/api/brain/overview', async (_req, res) => {
    const overview = await getBrainCognitiveOverview();
    res.json(overview);
  });

  app.post('/api/brain/router-simulate', async (req, res) => {
    const prompt = String(req.body?.prompt || 'Analisa o acoplamento AST de server.ts').trim();
    const scoutIdx = await buildScoutWorkspaceIndex();
    const state = db.getState();
    const nativeEligible = state.mcpRegistryTools
      ? state.mcpRegistryTools.filter((t) => t.enabled && t.jevEligible).map((t) => t.name)
      : undefined;
    const routed = routeJevS1({
      prompt,
      memories: state.memories,
      scoutSymbols: scoutIdx.symbols,
      activeMcpCatalog: nativeEligible,
    });
    res.json({
      ...routed.decision,
      decision: routed.decision,
      nextDeltaHash: routed.nextDeltaHash,
      compressedContextBlock: routed.compressedContextBlock,
    });
  });

  // ==========================================================================
  // 5B. Swarm 48x, SCOUT-01 AST Map & Transactional CoW Sandboxes
  // ==========================================================================
  app.get('/api/swarm/overview', async (_req, res) => {
    const idx = await buildScoutWorkspaceIndex();
    const state = db.getState();
    const byFile = new Map<string, number>();
    for (const sym of idx.symbols) {
      byFile.set(sym.filePath, (byFile.get(sym.filePath) || 0) + 1);
    }
    const fileHeatmap = Array.from(byFile.entries())
      .map(([filePath, symbolCount]) => ({ filePath, symbolCount }))
      .sort((a, b) => b.symbolCount - a.symbolCount)
      .slice(0, 36);

    res.json({
      swarmRuns: state.swarmRuns || [],
      sandboxes: state.sandboxes || [],
      scout: {
        indexedFiles: idx.fileImports.size,
        symbolsCount: idx.symbols.length,
        coChanges: idx.coChanges.slice(0, 15),
        fileHeatmap,
      },
    });
  });

  app.post('/api/swarm/launch', async (req, res) => {
    const objective = String(req.body?.objective || 'Auditoria Swarm 48x Completa').trim();
    const scale: 24 | 48 = Number(req.body?.scale) === 24 ? 24 : 48;
    const run = await launchAsymmetricSwarm({ objective, scale });
    res.json({ swarmRun: run, sandboxes: db.getState().sandboxes || [] });
  });

  app.post('/api/swarm/sandboxes', (req, res) => {
    const label = String(req.body?.label || 'Sandbox CoW Manual').trim();
    const targetFiles = Array.isArray(req.body?.targetFiles)
      ? req.body.targetFiles.map(String)
      : ['server.ts'];
    const sandbox = createSubagentSandbox({
      label,
      agentCallsign: String(req.body?.agentCallsign || 'OPERATOR-SANDBOX'),
      targetFiles,
    });
    res.json({ sandbox });
  });

  app.post('/api/swarm/sandboxes/:id/mutate-test', (req, res) => {
    const injectSecret = Boolean(req.body?.injectCanarySecret);
    const out = mutateAndTestSandbox(req.params.id, injectSecret);
    if (!out.ok) {
      res.status(400).json({ error: out.detail });
      return;
    }
    res.json(out);
  });

  app.post('/api/swarm/sandboxes/:id/rollback', (req, res) => {
    const out = rollbackSubagentSandbox(req.params.id);
    if (!out.ok) {
      res.status(404).json({ error: 'Sandbox não encontrada para rollback.' });
      return;
    }
    res.json(out);
  });

  app.post('/api/swarm/sandboxes/:id/merge', (req, res) => {
    const out = mergeSubagentSandbox(req.params.id);
    if (!out.ok) {
      res.status(400).json({ error: out.error });
      return;
    }
    res.json(out);
  });

  app.get('/api/swarm/architecture-report', async (_req, res) => {
    const markdown = await generateScoutArchitectureReport();
    res.json({ markdown });
  });

  // ==========================================================================
  // 5C. Orbit Agent OS (DOTS DAG, Self-Learn, Prompt Forge, Fleet & MCP 2026)
  // ==========================================================================
  app.get('/api/orbit/overview', async (_req, res) => {
    const state = db.getState();
    const brain = await probeAndSyncBrain8765(false);
    res.json({
      dotsTasks: state.dotsTasks || [],
      handoffs: state.handoffs || [],
      fleetBroadcasts: state.fleetBroadcasts || [],
      promptForge: state.promptForge || [],
      selfLearnQueue: state.selfLearnQueue || [],
      quota5h: state.quota5h,
      brain8765: brain.status,
      mcpCatalog: getMcpCatalogSummary(),
    });
  });

  app.post('/api/orbit/dots', (req, res) => {
    const { title, lane, priority, assignedAgent } = req.body || {};
    if (!title?.trim()) {
      res.status(400).json({ error: 'Título da tarefa DOTS obrigatório.' });
      return;
    }
    const cleanTitle = String(title).trim();
    const slug = `.dots/${cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 28)}`;
    const task = {
      id: `dots-${Date.now()}`,
      slug,
      title: cleanTitle,
      lane: (['UI', 'API', 'TESTS', 'DOCS'].includes(lane) ? lane : 'API') as SwarmLane,
      priority: (['P0', 'P1', 'P2'].includes(priority) ? priority : 'P1') as 'P0' | 'P1' | 'P2',
      status: 'READY' as const,
      dependsOn: [],
      assignedAgent: String(assignedAgent || 'SCOUT-01'),
      tokenEstimate: 145,
    };
    db.update((draft) => {
      if (!draft.dotsTasks) draft.dotsTasks = [];
      draft.dotsTasks.unshift(task);
    });
    broadcastSse('state_updated', { section: 'orbit' });
    res.json({ task });
  });

  app.patch('/api/orbit/dots/:id', (req, res) => {
    const nextStatus = req.body?.status as 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
    let updated = null;
    db.update((draft) => {
      const t = (draft.dotsTasks || []).find((x) => x.id === req.params.id);
      if (t && nextStatus) {
        t.status = nextStatus;
        if (nextStatus === 'COMPLETED') t.verifiedAt = new Date().toISOString();
        updated = t;
      }
    });
    if (!updated) {
      res.status(404).json({ error: 'Tarefa DOTS não encontrada.' });
      return;
    }
    broadcastSse('state_updated', { section: 'orbit' });
    res.json({ task: updated });
  });

  app.post('/api/orbit/broadcast', (req, res) => {
    const directive = String(req.body?.directive || '').trim();
    if (!directive) {
      res.status(400).json({ error: 'Diretiva de broadcast vazia.' });
      return;
    }
    const item = {
      id: `fb-${Date.now()}`,
      timestamp: new Date().toISOString(),
      sender: `${db.getState().settings.operatorName} (HUMAN_WINS)`,
      priority: 'OVERRIDE_HUMAN_WINS' as const,
      directive,
      acknowledgedBy: ['SCOUT-01', 'UI-ARCHITECT-01', 'API-GATEWAY-01', 'QA-SENTINEL-01', 'THREE-SPATIAL-02'],
    };
    db.update((draft) => {
      if (!draft.fleetBroadcasts) draft.fleetBroadcasts = [];
      draft.fleetBroadcasts.unshift(item);
      if (!draft.handoffs) draft.handoffs = [];
      draft.handoffs.unshift({
        id: `ho-${Date.now()}`,
        timestamp: item.timestamp,
        fromAgent: 'OPERATOR_HUMAN_WINS',
        toAgent: 'ALL_SWARM_LANES',
        authorityLevel: 'HUMAN_WINS',
        taskRef: 'FLEET_BROADCAST',
        contextToon: compressFactTelegraphic(directive),
        status: 'ACCEPTED',
      });
    });
    db.appendAudit('OPERATOR', 'ORBIT', 'FLEET_BROADCAST_HUMAN_WINS', directive.slice(0, 100), 'VERIFIED');
    broadcastSse('state_updated', { section: 'orbit' });
    res.json({ broadcast: item });
  });

  app.post('/api/orbit/self-learn/:id/decide', (req, res) => {
    const decision: 'COMMIT' | 'DISCARD' = req.body?.decision === 'DISCARD' ? 'DISCARD' : 'COMMIT';
    const cand = (db.getState().selfLearnQueue || []).find((s) => s.id === req.params.id);
    if (!cand) {
      res.status(404).json({ error: 'Candidato Self-Learn não encontrado.' });
      return;
    }

    let committedMemory = null;
    if (decision === 'COMMIT') {
      const stored = storeBiTemporalMemory({
        topic: cand.topic.replace(/^Self-Learn:\s*/i, ''),
        content: cand.extractedFact,
        category: cand.suggestedCategory,
        tier: cand.suggestedTier,
        provenance: 'CONFIRMED',
        tags: ['self-learn', 'orbit-verified'],
        sourceUri: `orbit://self-learn/${cand.id}`,
      });
      committedMemory = stored.memory;
    }

    db.update((draft) => {
      const target = (draft.selfLearnQueue || []).find((s) => s.id === cand.id);
      if (target) {
        target.status = decision === 'COMMIT' ? 'COMMITTED' : 'DISCARDED';
      }
    });

    broadcastSse('state_updated', { section: 'orbit' });
    res.json({ ok: true, decision, committedMemory });
  });

  app.post('/api/orbit/prompt-forge/optimize', (req, res) => {
    const rawPrompt = String(req.body?.rawPrompt || '').trim();
    const name = String(req.body?.name || '').trim();
    if (!rawPrompt) {
      res.status(400).json({ error: 'Prompt original vazio.' });
      return;
    }
    const compressed = `[TOON_V3] ${compressFactTelegraphic(rawPrompt)}`;
    const savings = Math.max(
      12,
      Number((((rawPrompt.length - compressed.length) / Math.max(1, rawPrompt.length)) * 100 + 22).toFixed(1))
    );

    let savedTemplate = null;
    if (name) {
      savedTemplate = {
        id: `pf-${Date.now()}`,
        name,
        category: 'CUSTOM' as const,
        rawPrompt,
        toonOptimizedPrompt: compressed,
        tokenSavingsPercent: Math.min(78, savings),
        usageCount: 1,
      };
      db.update((draft) => {
        if (!draft.promptForge) draft.promptForge = [];
        draft.promptForge.unshift(savedTemplate!);
      });
    }

    res.json({
      rawPrompt,
      toonOptimizedPrompt: compressed,
      tokenSavingsPercent: Math.min(78, savings),
      savedTemplate,
    });
  });

  // Native MCP 2026 JSON-RPC 2.0 Endpoint, Catalog & Full Gateway Management
  app.get('/api/mcp/catalog', (_req, res) => {
    res.json(getMcpCatalogSummary());
  });

  app.post('/api/mcp', async (req, res) => {
    const method = String(req.body?.method || '');
    const rpcResponse = await handleMcpJsonRpc(req.body || {}, PORT);
    if (method === 'gateway/heartbeat' || method === 'ping') {
      broadcastSse('mcp_heartbeat', { method, timestamp: new Date().toISOString() });
    } else {
      broadcastSse('state_updated', { section: 'mcp' });
    }
    res.json(rpcResponse);
  });

  app.get('/api/mcp/gateway', (_req, res) => {
    res.json(getMcpGatewayOverview());
  });

  app.post('/api/mcp/gateway/probe-all', async (_req, res) => {
    const overview = await probeAllMcpGatewayItems(PORT);
    broadcastSse('state_updated', { section: 'mcp' });
    res.json(overview);
  });

  app.post('/api/mcp/gateway/reset-defaults', (_req, res) => {
    const nowIso = new Date().toISOString();
    db.update((draft) => {
      draft.mcpRegistryTools = buildDefaultMcpRegistryTools(nowIso);
      draft.mcpRegistryResources = buildDefaultMcpRegistryResources(nowIso);
    });
    db.appendAudit(
      'OPERATOR',
      'MCP',
      'GATEWAY_RESET_DEFAULTS',
      'Catálogo nativo reposto para as 18 ferramentas e 6 recursos brain:// de fábrica.',
      'VERIFIED'
    );
    broadcastSse('state_updated', { section: 'mcp' });
    res.json(getMcpGatewayOverview());
  });

  app.post('/api/mcp/gateway/tools', (req, res) => {
    const {
      name,
      title,
      description,
      inputSchema,
      readOnlyHint,
      idempotentHint,
      destructiveHint,
      openWorldHint,
      jevEligible,
      mockResponseJson,
    } = req.body || {};

    const cleanName = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_');
    if (!cleanName) {
      res.status(400).json({ error: 'Nome técnico da ferramenta MCP é obrigatório.' });
      return;
    }

    const existing = (db.getState().mcpRegistryTools || []).some((t) => t.name === cleanName);
    if (existing) {
      res.status(400).json({ error: `Já existe uma ferramenta registada com o nome '${cleanName}'.` });
      return;
    }

    let parsedSchema: Record<string, unknown> = { type: 'object', properties: {} };
    if (typeof inputSchema === 'string' && inputSchema.trim()) {
      try {
        parsedSchema = JSON.parse(inputSchema);
      } catch {
        res.status(400).json({ error: 'inputSchema JSON inválido.' });
        return;
      }
    } else if (inputSchema && typeof inputSchema === 'object') {
      parsedSchema = inputSchema as Record<string, unknown>;
    }

    const nowIso = new Date().toISOString();
    const cleanTitle = String(title || cleanName).trim();
    const newTool: McpRegistryToolItem = {
      id: `mcp-tool-custom-${Date.now()}`,
      name: cleanName,
      title: cleanTitle,
      description: String(description || 'Ferramenta MCP personalizada registada pelo Operador.').trim(),
      inputSchema: parsedSchema,
      annotations: {
        title: cleanTitle,
        readOnlyHint: Boolean(readOnlyHint),
        idempotentHint: Boolean(idempotentHint),
        destructiveHint: Boolean(destructiveHint),
        openWorldHint: Boolean(openWorldHint),
      },
      enabled: true,
      jevEligible: jevEligible !== false,
      origin: 'CUSTOM',
      healthStatus: 'HEALTHY',
      lastLatencyMs: 0.35,
      callCount: 0,
      errorCount: 0,
      lastCheckedAt: nowIso,
      mockResponseJson: mockResponseJson ? String(mockResponseJson).trim() : undefined,
    };

    db.update((draft) => {
      if (!draft.mcpRegistryTools) draft.mcpRegistryTools = buildDefaultMcpRegistryTools(nowIso);
      draft.mcpRegistryTools.unshift(newTool);
    });

    db.appendAudit('OPERATOR', 'MCP', 'TOOL_ADDED', cleanName, 'VERIFIED');
    broadcastSse('state_updated', { section: 'mcp' });
    res.json({ tool: newTool, overview: getMcpGatewayOverview() });
  });

  app.patch('/api/mcp/gateway/tools/:id', (req, res) => {
    let updated: McpRegistryToolItem | null = null;
    const body = req.body || {};

    db.update((draft) => {
      const target = (draft.mcpRegistryTools || []).find((t) => t.id === req.params.id);
      if (!target) return;

      if (typeof body.enabled === 'boolean') {
        target.enabled = body.enabled;
        target.healthStatus = body.enabled ? 'HEALTHY' : 'DISABLED';
      }
      if (typeof body.jevEligible === 'boolean') {
        target.jevEligible = body.jevEligible;
      }
      if (typeof body.title === 'string' && body.title.trim()) {
        target.title = body.title.trim();
        target.annotations.title = body.title.trim();
      }
      if (typeof body.description === 'string' && body.description.trim()) {
        target.description = body.description.trim();
      }
      if (body.annotations && typeof body.annotations === 'object') {
        target.annotations = {
          ...target.annotations,
          ...body.annotations,
        };
      }
      if (body.inputSchema && typeof body.inputSchema === 'object') {
        target.inputSchema = body.inputSchema;
      }
      if (typeof body.mockResponseJson === 'string') {
        target.mockResponseJson = body.mockResponseJson;
      }
      target.lastCheckedAt = new Date().toISOString();
      updated = { ...target };
    });

    if (!updated) {
      res.status(404).json({ error: 'Ferramenta MCP não encontrada.' });
      return;
    }

    broadcastSse('state_updated', { section: 'mcp' });
    res.json({ tool: updated, overview: getMcpGatewayOverview() });
  });

  app.delete('/api/mcp/gateway/tools/:id', (req, res) => {
    let removedName = '';
    db.update((draft) => {
      const target = (draft.mcpRegistryTools || []).find((t) => t.id === req.params.id);
      if (target) removedName = target.name;
      draft.mcpRegistryTools = (draft.mcpRegistryTools || []).filter((t) => t.id !== req.params.id);
    });
    if (!removedName) {
      res.status(404).json({ error: 'Ferramenta MCP não encontrada.' });
      return;
    }
    db.appendAudit('OPERATOR', 'MCP', 'TOOL_REMOVED', removedName, 'VERIFIED');
    broadcastSse('state_updated', { section: 'mcp' });
    res.json({ ok: true, overview: getMcpGatewayOverview() });
  });

  app.post('/api/mcp/gateway/resources', (req, res) => {
    const { uri, name, description, mimeType, isTemplate, staticPayload } = req.body || {};
    const cleanUri = String(uri || '').trim();
    const cleanName = String(name || '').trim();
    if (!cleanUri || !cleanName) {
      res.status(400).json({ error: 'URI e nome do recurso são obrigatórios.' });
      return;
    }
    const duplicate = (db.getState().mcpRegistryResources || []).some((r) => r.uri === cleanUri);
    if (duplicate) {
      res.status(400).json({ error: `Já existe um recurso com o URI '${cleanUri}'.` });
      return;
    }

    const nowIso = new Date().toISOString();
    const newRes: McpRegistryResourceItem = {
      id: `mcp-res-custom-${Date.now()}`,
      uri: cleanUri,
      name: cleanName,
      description: String(description || 'Recurso MCP personalizado.').trim(),
      mimeType: String(mimeType || 'application/json').trim(),
      isTemplate: Boolean(isTemplate) || cleanUri.includes('{'),
      enabled: true,
      origin: 'CUSTOM',
      healthStatus: 'HEALTHY',
      lastLatencyMs: 0.3,
      readCount: 0,
      lastCheckedAt: nowIso,
      staticPayload: staticPayload ? String(staticPayload) : undefined,
    };

    db.update((draft) => {
      if (!draft.mcpRegistryResources) {
        draft.mcpRegistryResources = buildDefaultMcpRegistryResources(nowIso);
      }
      draft.mcpRegistryResources.unshift(newRes);
    });

    db.appendAudit('OPERATOR', 'MCP', 'RESOURCE_ADDED', cleanUri, 'VERIFIED');
    broadcastSse('state_updated', { section: 'mcp' });
    res.json({ resource: newRes, overview: getMcpGatewayOverview() });
  });

  app.patch('/api/mcp/gateway/resources/:id', (req, res) => {
    let updated: McpRegistryResourceItem | null = null;
    const body = req.body || {};

    db.update((draft) => {
      const target = (draft.mcpRegistryResources || []).find((r) => r.id === req.params.id);
      if (!target) return;

      if (typeof body.enabled === 'boolean') {
        target.enabled = body.enabled;
        target.healthStatus = body.enabled ? 'HEALTHY' : 'DISABLED';
      }
      if (typeof body.name === 'string' && body.name.trim()) target.name = body.name.trim();
      if (typeof body.description === 'string' && body.description.trim()) {
        target.description = body.description.trim();
      }
      if (typeof body.mimeType === 'string' && body.mimeType.trim()) {
        target.mimeType = body.mimeType.trim();
      }
      if (typeof body.staticPayload === 'string') {
        target.staticPayload = body.staticPayload;
      }
      target.lastCheckedAt = new Date().toISOString();
      updated = { ...target };
    });

    if (!updated) {
      res.status(404).json({ error: 'Recurso MCP não encontrado.' });
      return;
    }

    broadcastSse('state_updated', { section: 'mcp' });
    res.json({ resource: updated, overview: getMcpGatewayOverview() });
  });

  app.delete('/api/mcp/gateway/resources/:id', (req, res) => {
    let removedUri = '';
    db.update((draft) => {
      const target = (draft.mcpRegistryResources || []).find((r) => r.id === req.params.id);
      if (target) removedUri = target.uri;
      draft.mcpRegistryResources = (draft.mcpRegistryResources || []).filter(
        (r) => r.id !== req.params.id
      );
    });
    if (!removedUri) {
      res.status(404).json({ error: 'Recurso MCP não encontrado.' });
      return;
    }
    db.appendAudit('OPERATOR', 'MCP', 'RESOURCE_REMOVED', removedUri, 'VERIFIED');
    broadcastSse('state_updated', { section: 'mcp' });
    res.json({ ok: true, overview: getMcpGatewayOverview() });
  });

  app.post('/api/mcp/gateway/validate-server', (req, res) => {
    const body = req.body || {};
    const libItem = body.libraryId
      ? MCP_STANDARD_LIBRARY.find((item) => item.id === String(body.libraryId))
      : undefined;

    const name = String(body.name || libItem?.name || 'Servidor MCP').trim();
    const transport = (
      ['HTTP_STREAMABLE', 'SSE', 'STDIO'].includes(body.transport)
        ? body.transport
        : libItem?.transport || 'HTTP_STREAMABLE'
    ) as McpTransportType;

    const endpointUrl =
      transport !== 'STDIO'
        ? String(body.endpointUrl || libItem?.defaultEndpointOrCommand || '').trim()
        : undefined;

    const command =
      transport === 'STDIO'
        ? String(body.command || libItem?.defaultEndpointOrCommand || '').trim()
        : undefined;

    const args: string[] =
      transport === 'STDIO'
        ? Array.isArray(body.args)
          ? body.args.map(String).filter(Boolean)
          : typeof body.args === 'string' && body.args.trim()
            ? body.args.trim().split(/\s+/)
            : libItem?.defaultArgs || []
        : [];

    const state = db.getState();
    const gate = validateMcpServerAuthorityGate({
      name,
      transport,
      endpointUrl,
      command,
      args,
      autonomyLevel: state.settings.autonomyLevel,
      alwaysApprovedCommands: state.settings.alwaysApprovedCommands,
    });

    if (!gate.allowed) {
      db.appendAudit(
        'AUTHORITY_GATE',
        'SECURITY',
        'MCP_VALIDATION_BLOCKED',
        redactAiDefenceSecrets(`${name} [${transport}] Risco ${gate.riskScore}/100`).sanitized,
        'BLOCKED'
      );
    }

    res.json({ gate });
  });

  app.post('/api/mcp/gateway/servers', async (req, res) => {
    const body = req.body || {};
    const libItem = body.libraryId
      ? MCP_STANDARD_LIBRARY.find((item) => item.id === String(body.libraryId))
      : undefined;

    const name = String(body.name || libItem?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Nome do servidor MCP é obrigatório.' });
      return;
    }

    const transport = (
      ['HTTP_STREAMABLE', 'SSE', 'STDIO'].includes(body.transport)
        ? body.transport
        : libItem?.transport || 'HTTP_STREAMABLE'
    ) as McpTransportType;

    const category = (libItem?.category || body.category || 'CUSTOM') as
      | McpLibraryCategory
      | 'CUSTOM';

    const endpointUrl =
      transport !== 'STDIO'
        ? String(body.endpointUrl || libItem?.defaultEndpointOrCommand || '').trim()
        : undefined;

    const command =
      transport === 'STDIO'
        ? String(body.command || libItem?.defaultEndpointOrCommand || 'npx').trim()
        : undefined;

    const args: string[] =
      transport === 'STDIO'
        ? Array.isArray(body.args)
          ? body.args.map(String).filter(Boolean)
          : typeof body.args === 'string' && body.args.trim()
            ? body.args.trim().split(/\s+/)
            : libItem?.defaultArgs || []
        : [];

    const state = db.getState();
    const gate = validateMcpServerAuthorityGate({
      name,
      transport,
      endpointUrl,
      command,
      args,
      autonomyLevel: state.settings.autonomyLevel,
      alwaysApprovedCommands: state.settings.alwaysApprovedCommands,
    });

    if (!gate.allowed) {
      const failDetail =
        gate.checks.find((c) => c.status === 'FAIL')?.detail ||
        'Configuração bloqueada pelo Authority Gate.';
      db.appendAudit(
        'AUTHORITY_GATE',
        'SECURITY',
        'MCP_SERVER_BLOCKED',
        redactAiDefenceSecrets(`${name} [${transport}]: ${failDetail}`).sanitized,
        'BLOCKED'
      );
      res.status(403).json({
        error: `Bloqueado pelo Authority Gate (Risco ${gate.riskScore}/100): ${failDetail}`,
        gate,
      });
      return;
    }

    const rawEnv = (body.envKeys && typeof body.envKeys === 'object' ? body.envKeys : {}) as Record<
      string,
      string
    >;
    const maskedEnvKeys: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawEnv)) {
      const cleanKey = k.trim();
      if (!cleanKey) continue;
      const valStr = String(v || '').trim();
      maskedEnvKeys[cleanKey] =
        valStr.length > 8 ? `${valStr.slice(0, 4)}••••${valStr.slice(-3)}` : valStr ? '••••••••' : 'CONFIGURED';
    }

    const nowIso = new Date().toISOString();
    const serverId = `mcp-srv-${Date.now()}`;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const fullStdioCmd = transport === 'STDIO' ? [command, ...args].join(' ').trim() : '';
    const stdioPreApproved = !gate.requiresHumanApproval;
    const jevEligible = body.jevEligible !== false;

    const newServer: McpCustomServer = {
      id: serverId,
      name,
      slug: slug || serverId,
      category,
      description: String(
        body.description || libItem?.description || 'Servidor MCP externo ligado ao Gateway 2026.'
      ).trim(),
      transport,
      endpointUrl,
      command,
      args: transport === 'STDIO' ? args : undefined,
      envKeys: maskedEnvKeys,
      enabled: true,
      jevEligible,
      authStatus: stdioPreApproved ? 'AUTHORIZED' : 'PENDING_APPROVAL',
      healthStatus: stdioPreApproved ? 'ONLINE' : 'PENDING_AUTH',
      lastLatencyMs: 0,
      latencyHistory: [],
      probeCount: 0,
      errorCount: 0,
      lastRpcMethod:
        transport === 'HTTP_STREAMABLE'
          ? 'JSON-RPC 2.0 ping + tools/list'
          : transport === 'SSE'
            ? 'SSE Handshake GET'
            : 'stdio execFile Probe',
      discoveredTools: libItem?.sampleTools ? [...libItem.sampleTools] : [],
      lastCheckedAt: nowIso,
      lastError: stdioPreApproved
        ? undefined
        : 'Aguarda autorização do comando stdio pelo Operador (Authority Gate).',
      fromLibraryId: libItem?.id,
      authorityGate: gate,
    };

    db.update((draft) => {
      if (!draft.mcpServers) draft.mcpServers = [];
      draft.mcpServers.unshift(newServer);

      if (!stdioPreApproved) {
        draft.approvals.unshift({
          id: `appr-mcp-${Date.now()}`,
          title: `Autorizar Servidor MCP stdio (${name})`,
          commandOrAction: fullStdioCmd,
          source: 'MCP_GATEWAY',
          riskLevel: gate.riskLevel === 'LOW' ? 'MEDIUM' : gate.riskLevel,
          requestedAt: nowIso,
          status: 'PENDING',
          mcpServerId: serverId,
        });
      }
    });

    const auditSummary = redactAiDefenceSecrets(
      `${name} [${transport}] JEV-S1=${jevEligible ? 'ON' : 'OFF'} · Risco=${gate.riskScore}/100`
    ).sanitized;
    db.appendAudit(
      'OPERATOR',
      'MCP',
      stdioPreApproved ? 'MCP_SERVER_REGISTERED' : 'MCP_STDIO_PENDING_AUTH',
      auditSummary,
      'VERIFIED'
    );

    if (stdioPreApproved) {
      await probeExternalMcpServer(serverId, PORT);
    }

    broadcastSse('state_updated', { section: 'mcp' });
    res.json({
      server: (db.getState().mcpServers || []).find((s) => s.id === serverId),
      gate,
      overview: getMcpGatewayOverview(),
      approvals: db.getState().approvals,
    });
  });

  app.post('/api/mcp/gateway/servers/:id/authorize', async (req, res) => {
    const serverId = req.params.id;
    const srv = (db.getState().mcpServers || []).find((s) => s.id === serverId);
    if (!srv) {
      res.status(404).json({ error: 'Servidor MCP não encontrado.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const cmdLine = [srv.command, ...(srv.args || [])].filter(Boolean).join(' ').trim();

    db.update((draft) => {
      const target = (draft.mcpServers || []).find((s) => s.id === serverId);
      if (target) {
        target.authStatus = 'AUTHORIZED';
        target.lastError = undefined;
      }
      for (const appr of draft.approvals) {
        if (appr.mcpServerId === serverId && appr.status === 'PENDING') {
          appr.status = 'APPROVED_ALWAYS';
          appr.decidedAt = nowIso;
        }
      }
      if (cmdLine && !draft.settings.alwaysApprovedCommands.includes(cmdLine)) {
        draft.settings.alwaysApprovedCommands.push(cmdLine);
      }
    });

    await probeExternalMcpServer(serverId, PORT);
    db.appendAudit('OPERATOR', 'SECURITY', 'MCP_STDIO_AUTHORIZED', `${srv.name} (${cmdLine})`, 'VERIFIED');
    broadcastSse('state_updated', { section: 'mcp' });
    res.json({
      server: (db.getState().mcpServers || []).find((s) => s.id === serverId),
      overview: getMcpGatewayOverview(),
      approvals: db.getState().approvals,
    });
  });

  app.post('/api/mcp/gateway/servers/:id/probe', async (req, res) => {
    const probed = await probeExternalMcpServer(req.params.id, PORT);
    if (!probed) {
      res.status(404).json({ error: 'Servidor MCP não encontrado.' });
      return;
    }
    broadcastSse('state_updated', { section: 'mcp' });
    res.json({ server: probed, overview: getMcpGatewayOverview() });
  });

  app.patch('/api/mcp/gateway/servers/:id', async (req, res) => {
    const body = req.body || {};
    let updatedRef: McpCustomServer | null = null;
    let shouldReprobe = false;

    db.update((draft) => {
      const target = (draft.mcpServers || []).find((s) => s.id === req.params.id);
      if (!target) return;
      if (typeof body.enabled === 'boolean') {
        target.enabled = body.enabled;
        if (!body.enabled) target.healthStatus = 'OFFLINE';
        else shouldReprobe = true;
      }
      if (typeof body.jevEligible === 'boolean') {
        target.jevEligible = body.jevEligible;
      }
      if (typeof body.endpointUrl === 'string' && body.endpointUrl.trim()) {
        target.endpointUrl = body.endpointUrl.trim();
        shouldReprobe = true;
      }
      if (typeof body.description === 'string') {
        target.description = body.description.trim();
      }
      updatedRef = { ...target };
    });

    if (!updatedRef) {
      res.status(404).json({ error: 'Servidor MCP não encontrado.' });
      return;
    }

    const updated = shouldReprobe
      ? await probeExternalMcpServer(req.params.id, PORT)
      : updatedRef;
    broadcastSse('state_updated', { section: 'mcp' });
    res.json({ server: updated, overview: getMcpGatewayOverview() });
  });

  app.delete('/api/mcp/gateway/servers/:id', (req, res) => {
    let removedName = '';
    db.update((draft) => {
      const target = (draft.mcpServers || []).find((s) => s.id === req.params.id);
      if (target) removedName = target.name;
      draft.mcpServers = (draft.mcpServers || []).filter((s) => s.id !== req.params.id);
      draft.approvals = draft.approvals.filter(
        (a) => !(a.mcpServerId === req.params.id && a.status === 'PENDING')
      );
    });
    if (!removedName) {
      res.status(404).json({ error: 'Servidor MCP não encontrado.' });
      return;
    }
    db.appendAudit('OPERATOR', 'MCP', 'MCP_SERVER_REMOVED', removedName, 'VERIFIED');
    broadcastSse('state_updated', { section: 'mcp' });
    res.json({ ok: true, overview: getMcpGatewayOverview() });
  });

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

    const scan = detectPromptInjection(message);
    if (scan.blocked) {
      db.appendAudit(
        `CHANNEL:${ch.platform}`,
        'SECURITY',
        'CHANNEL_INJECTION_BLOCKED',
        `Remetente ${senderId}: ${scan.matchedRules.join(', ')}`,
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
      activePort: PORT,
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
    const telemetry = await collectOSTelemetry(PORT);
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
    const scan = detectPromptInjection(text);
    const hasSecretPattern = /(sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{30,}|ghp_[a-zA-Z0-9]{30,})/.test(text);
    if (scan.blocked || hasSecretPattern) {
      db.appendAudit(
        'CLIPBOARD_GUARD',
        'SECURITY',
        'CLIPBOARD_ALERT',
        hasSecretPattern ? 'Chave de API detetada na área de transferência' : `Injeção detetada (${scan.matchedRules.join(', ')})`,
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
  // 8. Authority Approvals Inbox, Canary Tester, Settings & Backup JSON
  // ==========================================================================
  app.post('/api/approvals/:id/decide', async (req, res) => {
    const decision: 'APPROVED_ONCE' | 'APPROVED_ALWAYS' | 'BLOCKED' = req.body?.decision || 'BLOCKED';
    const appr = db.getState().approvals.find((a) => a.id === req.params.id);
    if (!appr) {
      res.status(404).json({ error: 'Pedido de aprovação não encontrado.' });
      return;
    }

    db.update((draft) => {
      const target = draft.approvals.find((a) => a.id === appr.id);
      if (target) {
        target.status = decision;
        target.decidedAt = new Date().toISOString();
      }
      if (decision === 'APPROVED_ALWAYS' && !draft.settings.alwaysApprovedCommands.includes(appr.commandOrAction)) {
        draft.settings.alwaysApprovedCommands.push(appr.commandOrAction);
      }
    });

    let executionOutput = '';
    if (decision === 'APPROVED_ONCE' || decision === 'APPROVED_ALWAYS') {
      if (appr.mcpServerId) {
        db.update((draft) => {
          const srv = (draft.mcpServers || []).find((s) => s.id === appr.mcpServerId);
          if (srv) {
            srv.authStatus = 'AUTHORIZED';
            srv.lastError = undefined;
          }
        });
        const probed = await probeExternalMcpServer(appr.mcpServerId, PORT);
        executionOutput = `Servidor MCP stdio autorizado (${probed?.healthStatus || 'ONLINE'}).`;
      } else if (appr.workflowRunId) {
        const pausedRun = db.getState().workflowRuns.find((r) => r.id === appr.workflowRunId);
        if (pausedRun) {
          const resumed = await runWorkflowById(
            pausedRun.workflowId,
            'MANUAL',
            true,
            pausedRun.id
          );
          executionOutput = `Workflow retomado e concluído (${resumed?.status}).`;
        } else if (appr.commandOrAction) {
          const execRes = await executeGovernedCommand(appr.commandOrAction, appr.source, true);
          executionOutput = execRes.output;
        }
      } else if (appr.commandOrAction) {
        const execRes = await executeGovernedCommand(appr.commandOrAction, appr.source, true);
        executionOutput = execRes.output;
      }
    } else if (decision === 'BLOCKED' && appr.mcpServerId) {
      db.update((draft) => {
        const srv = (draft.mcpServers || []).find((s) => s.id === appr.mcpServerId);
        if (srv) {
          srv.enabled = false;
          srv.healthStatus = 'OFFLINE';
          srv.lastError = 'Execução stdio bloqueada pelo Operador na Inbox de Autoridade.';
        }
      });
    }

    db.appendAudit(
      'OPERATOR',
      'SECURITY',
      `APPROVAL_${decision}`,
      `${appr.title} (${appr.commandOrAction})`,
      decision === 'BLOCKED' ? 'BLOCKED' : 'VERIFIED'
    );

    broadcastSse('state_updated', { section: 'approvals' });
    res.json({
      approvals: db.getState().approvals,
      settings: db.getState().settings,
      workflowRuns: db.getState().workflowRuns,
      executionOutput,
    });
  });

  app.post('/api/security/canary-test', (req, res) => {
    const sample = String(req.body?.payload || '');
    const scan = detectPromptInjection(sample);
    db.appendAudit(
      'CANARY_TESTER',
      'SECURITY',
      scan.blocked ? 'CANARY_INTERCEPTED' : 'CANARY_CLEAN',
      `Risco ${scan.riskScore}/100 — "${sample.slice(0, 70)}"`,
      scan.blocked ? 'BLOCKED' : 'ALLOWED'
    );
    res.json({ scan, auditLogs: db.getState().auditLogs.slice(0, 40) });
  });

  app.patch('/api/settings', (req, res) => {
    const updates = req.body || {};
    db.update((draft) => {
      draft.settings = {
        ...draft.settings,
        ...updates,
      };
    });
    startOrRefreshHeartbeatDaemon(PORT);
    db.appendAudit('OPERATOR', 'SYSTEM', 'SETTINGS_UPDATED', 'Preferências do sistema atualizadas.', 'VERIFIED');
    res.json({ settings: db.getState().settings });
  });

  app.post('/api/settings/test-provider', async (req, res) => {
    const result = await testModelProviderConnection(req.body || {});
    res.json(result);
  });

  app.get('/api/backup/export', (_req, res) => {
    res.json({
      exportedAt: new Date().toISOString(),
      version: '3.0.0',
      data: db.getState(),
    });
  });

  app.post('/api/backup/import', (req, res) => {
    const incoming = req.body?.data || req.body;
    if (!incoming || typeof incoming !== 'object') {
      res.status(400).json({ error: 'Payload JSON inválido.' });
      return;
    }
    const nextState = db.replaceAll(incoming);
    db.appendAudit('OPERATOR', 'SYSTEM', 'BACKUP_IMPORTED', 'Estado restaurado via ficheiro JSON.', 'VERIFIED');
    res.json({ ok: true, state: nextState });
  });

  // ==========================================================================
  // Vite Middleware (Dev) or Static Bundle (Production)
  // ==========================================================================
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(__dirname, 'dist', 'index.html'));
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    printStartupDebugBanner({
      port: PORT,
      host: HOST,
      storageEngine: db.getEngineName(),
      isProd,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    });
    console.log(
      `[J.A.R.V.I.S. Cortex OS v3.0] Listening on http://${HOST}:${PORT} (${db.getEngineName()} + MCP 2026)`
    );
  });
}

startServer();
