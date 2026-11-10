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
  searchMemories4WayRRF,
  validateChannelSender,
} from './src/shared/cortex-math.ts';
import {
  buildDefaultMcpRegistryResources,
  buildDefaultMcpRegistryTools,
  MCP_STANDARD_LIBRARY,
} from './src/shared/mcp-catalog.ts';
import type {
  ChannelPlatform,
  McpCustomServer,
  McpLibraryCategory,
  McpRegistryResourceItem,
  McpRegistryToolItem,
  McpTransportType,
  MemoryCategory,
  MemoryTier,
  SwarmLane,
  TodayContractItem,
} from './src/shared/types.ts';
import { db } from './src/server/db.ts';
import {
  collectOSTelemetry,
  executeGovernedCommand,
  getGitOverview,
  listWorkspaceFiles,
  readSafeWorkspaceFile,
  verifyTodayContractItem,
} from './src/server/os-adapter.ts';
import {
  generateWorkflowFromNaturalLanguage,
  runAgentChatTurn,
  synthesizeBriefText,
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
  launchAsymmetricSwarm,
  lookupWorkspaceSymbols,
  mergeSubagentSandbox,
  mutateAndTestSandbox,
  probeAndSyncBrain8765,
  registerSwarmOrbitBroadcaster,
  rollbackSubagentSandbox,
  storeBiTemporalMemory,
} from './src/server/swarm-orbit-engine.ts';
import {
  getMcpCatalogSummary,
  getMcpGatewayOverview,
  handleMcpJsonRpc,
  probeAllMcpGatewayItems,
  probeExternalMcpServer,
} from './src/server/mcp-server.ts';

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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Real-time SSE Clients Registry
  const sseClients = new Set<express.Response>();
  const broadcastSse = (event: string, payload: unknown) => {
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
  buildScoutWorkspaceIndex().catch(() => {});

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

  app.get('/api/events', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);
    const initialSnap = {
      connectedAt: new Date().toISOString(),
      pendingApprovals: db.getState().approvals.filter((a) => a.status === 'PENDING').length,
      storageEngine: db.getEngineName(),
    };
    res.write(`event: connected\ndata: ${JSON.stringify(initialSnap)}\n\n`);

    req.on('close', () => {
      sseClients.delete(res);
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
    }

    db.update((draft) => {
      const target = draft.candidates.find((c) => c.id === cand.id);
      if (target) target.completed = true;
    });

    broadcastSse('state_updated', { section: 'q18' });
    res.json({
      ok: true,
      detail,
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
  app.get('/api/workspace/overview', async (_req, res) => {
    const [files, git, scout] = await Promise.all([
      Promise.resolve(listWorkspaceFiles(160)),
      getGitOverview(),
      buildScoutWorkspaceIndex(),
    ]);
    res.json({
      files,
      git,
      astSummary: {
        symbolsCount: scout.symbols.length,
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
    const rpcResponse = await handleMcpJsonRpc(req.body || {});
    broadcastSse('state_updated', { section: 'mcp' });
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

    if (transport !== 'STDIO' && !endpointUrl) {
      res.status(400).json({ error: 'Endpoint URL é obrigatório para servidores HTTP Streamable ou SSE.' });
      return;
    }

    if (transport === 'STDIO' && !command) {
      res.status(400).json({ error: 'Comando executável é obrigatório para servidores stdio.' });
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
    const state = db.getState();
    const stdioPreApproved =
      transport !== 'STDIO' ||
      state.settings.autonomyLevel === 'FULL_EXECUTIVE' ||
      state.settings.alwaysApprovedCommands.includes(fullStdioCmd);

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
      authStatus: stdioPreApproved ? 'AUTHORIZED' : 'PENDING_APPROVAL',
      healthStatus: stdioPreApproved ? 'ONLINE' : 'PENDING_AUTH',
      lastLatencyMs: 0,
      discoveredTools: libItem?.sampleTools ? [...libItem.sampleTools] : [],
      lastCheckedAt: nowIso,
      lastError: stdioPreApproved
        ? undefined
        : 'Aguarda autorização do comando stdio pelo Operador (Fronteira de Confiança).',
      fromLibraryId: libItem?.id,
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
          riskLevel: 'MEDIUM',
          requestedAt: nowIso,
          status: 'PENDING',
          mcpServerId: serverId,
        });
      }
    });

    const auditSummary = redactAiDefenceSecrets(
      `${name} [${transport}] ${endpointUrl || fullStdioCmd}`
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
    let exists = false;

    db.update((draft) => {
      const target = (draft.mcpServers || []).find((s) => s.id === req.params.id);
      if (!target) return;
      exists = true;
      if (typeof body.enabled === 'boolean') {
        target.enabled = body.enabled;
        if (!body.enabled) target.healthStatus = 'OFFLINE';
      }
      if (typeof body.endpointUrl === 'string' && body.endpointUrl.trim()) {
        target.endpointUrl = body.endpointUrl.trim();
      }
      if (typeof body.description === 'string') {
        target.description = body.description.trim();
      }
    });

    if (!exists) {
      res.status(404).json({ error: 'Servidor MCP não encontrado.' });
      return;
    }

    const updated = await probeExternalMcpServer(req.params.id, PORT);
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
  // 6. Modular OpenClaw Skills & Multi-Channel Gateway
  // ==========================================================================
  app.post('/api/skills', (req, res) => {
    const { name, description, systemInstruction, quickCommand, allowedTools } = req.body || {};
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
    res.json({ skill });
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
          const resumed = await runWorkflowById(pausedRun.workflowId, 'MANUAL', true);
          executionOutput = `Workflow retomado e concluído (${resumed?.status}).`;
        }
      } else if (appr.source !== 'WORKFLOW') {
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
    db.appendAudit('OPERATOR', 'SYSTEM', 'SETTINGS_UPDATED', 'Preferências do sistema atualizadas.', 'VERIFIED');
    res.json({ settings: db.getState().settings });
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
    console.log(
      `[J.A.R.V.I.S. Cortex OS v3.0] Listening on http://${HOST}:${PORT} (${db.getEngineName()} + MCP 2026)`
    );
  });
}

startServer();
