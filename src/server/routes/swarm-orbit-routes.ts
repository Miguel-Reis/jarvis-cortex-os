import express from 'express';
import { compressFactTelegraphic } from '../../shared/cortex-math.ts';
import type { SwarmLane } from '../../shared/types.ts';
import { domainMutex } from '../async-mutex.ts';
import { db } from '../db.ts';
import { audit, requireNonEmptyString, respondError, respondOk } from '../http-helpers.ts';
import { getMcpCatalogSummary } from '../mcp-server.ts';
import {
  buildScoutWorkspaceIndex,
  createSubagentSandbox,
  generateScoutArchitectureReport,
  launchAsymmetricSwarm,
  mergeSubagentSandbox,
  mutateAndTestSandbox,
  probeAndSyncBrain8765,
  rollbackSubagentSandbox,
  storeBiTemporalMemory,
} from '../swarm-orbit-engine.ts';

export interface SwarmOrbitRouterContext {
  broadcastSse: (event: string, payload: unknown) => void;
}

export function createSwarmOrbitRouter(ctx: SwarmOrbitRouterContext): express.Router {
  const router = express.Router();

  // ==========================================================================
  // Swarm 48x, SCOUT-01 AST Map & Transactional CoW Sandboxes (Serialized — A-07)
  // ==========================================================================
  router.get('/api/swarm/overview', async (_req, res) => {
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

    respondOk(res, {
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

  router.post('/api/swarm/launch', async (req, res) => {
    await domainMutex.withLock('swarm', async () => {
      const objective = String(req.body?.objective || 'Auditoria Swarm 48x Completa').trim();
      const scale: 24 | 48 = Number(req.body?.scale) === 24 ? 24 : 48;
      const run = await launchAsymmetricSwarm({ objective, scale });
      respondOk(res, { swarmRun: run, sandboxes: db.getState().sandboxes || [] });
    });
  });

  router.post('/api/swarm/sandboxes', async (req, res) => {
    await domainMutex.withLock('swarm', async () => {
      const label = String(req.body?.label || 'Sandbox CoW Manual').trim();
      const targetFiles = Array.isArray(req.body?.targetFiles)
        ? req.body.targetFiles.map(String)
        : ['server.ts'];
      const sandbox = createSubagentSandbox({
        label,
        agentCallsign: String(req.body?.agentCallsign || 'OPERATOR-SANDBOX'),
        targetFiles,
      });
      respondOk(res, { sandbox });
    });
  });

  router.post('/api/swarm/sandboxes/:id/mutate-test', async (req, res) => {
    await domainMutex.withLock('swarm', async () => {
      const injectSecret = Boolean(req.body?.injectCanarySecret);
      const out = mutateAndTestSandbox(req.params.id, injectSecret);
      if (!out.ok) {
        respondError(res, 400, out.detail);
        return;
      }
      respondOk(res, out);
    });
  });

  router.post('/api/swarm/sandboxes/:id/rollback', async (req, res) => {
    await domainMutex.withLock('swarm', async () => {
      const out = rollbackSubagentSandbox(req.params.id);
      if (!out.ok) {
        respondError(res, 404, 'Sandbox não encontrada para rollback.');
        return;
      }
      respondOk(res, out);
    });
  });

  router.post('/api/swarm/sandboxes/:id/merge', async (req, res) => {
    await domainMutex.withLock('swarm', async () => {
      const out = mergeSubagentSandbox(req.params.id);
      if (!out.ok) {
        respondError(res, 400, out.error || 'Falha no merge da sandbox.');
        return;
      }
      respondOk(res, out);
    });
  });

  router.get('/api/swarm/architecture-report', async (_req, res) => {
    const markdown = await generateScoutArchitectureReport();
    respondOk(res, { markdown });
  });

  // ==========================================================================
  // Orbit Agent OS (DOTS DAG, Self-Learn, Prompt Forge, Fleet — A-07, A-12)
  // ==========================================================================
  router.get('/api/orbit/overview', async (_req, res) => {
    const state = db.getState();
    const brain = await probeAndSyncBrain8765(false);
    respondOk(res, {
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

  router.post('/api/orbit/dots', async (req, res) => {
    await domainMutex.withLock('orbit', async () => {
      const { title, lane, priority, assignedAgent } = req.body || {};
      const cleanTitle = requireNonEmptyString(title);
      if (!cleanTitle) {
        respondError(res, 400, 'Título da tarefa DOTS obrigatório.');
        return;
      }
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
      ctx.broadcastSse('state_updated', { section: 'orbit' });
      respondOk(res, { task });
    });
  });

  router.patch('/api/orbit/dots/:id', async (req, res) => {
    await domainMutex.withLock('orbit', async () => {
      const nextStatus = req.body?.status as 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
      let updated = null;
      db.update((draft) => {
        const t = (draft.dotsTasks || []).find((x) => x.id === req.params.id);
        if (t && nextStatus) {
          t.status = nextStatus;
          if (nextStatus === 'COMPLETED') t.verifiedAt = new Date().toISOString();
          updated = { ...t };
        }
      });
      if (!updated) {
        respondError(res, 404, 'Tarefa DOTS não encontrada.');
        return;
      }
      ctx.broadcastSse('state_updated', { section: 'orbit' });
      respondOk(res, { task: updated });
    });
  });

  router.post('/api/orbit/broadcast', async (req, res) => {
    await domainMutex.withLock('orbit', async () => {
      const directive = requireNonEmptyString(req.body?.directive);
      if (!directive) {
        respondError(res, 400, 'Diretiva de broadcast vazia.');
        return;
      }
      const item = {
        id: `fb-${Date.now()}`,
        timestamp: new Date().toISOString(),
        sender: `${db.getState().settings.operatorName} (HUMAN_WINS)`,
        priority: 'OVERRIDE_HUMAN_WINS' as const,
        directive,
        acknowledgedBy: [
          'SCOUT-01',
          'UI-ARCHITECT-01',
          'API-GATEWAY-01',
          'QA-SENTINEL-01',
          'THREE-SPATIAL-02',
        ],
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
      audit('OPERATOR', 'ORBIT', 'FLEET_BROADCAST_HUMAN_WINS', directive.slice(0, 100));
      ctx.broadcastSse('state_updated', { section: 'orbit' });
      respondOk(res, { broadcast: item });
    });
  });

  router.post('/api/orbit/self-learn/:id/decide', async (req, res) => {
    await domainMutex.withLock('orbit', async () => {
      const decision: 'COMMIT' | 'DISCARD' =
        req.body?.decision === 'DISCARD' ? 'DISCARD' : 'COMMIT';
      const cand = (db.getState().selfLearnQueue || []).find((s) => s.id === req.params.id);
      if (!cand) {
        respondError(res, 404, 'Candidato Self-Learn não encontrado.');
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

      ctx.broadcastSse('state_updated', { section: 'orbit' });
      respondOk(res, { ok: true, decision, committedMemory });
    });
  });

  router.post('/api/orbit/prompt-forge/optimize', async (req, res) => {
    await domainMutex.withLock('orbit', async () => {
      const rawPrompt = requireNonEmptyString(req.body?.rawPrompt);
      const name = String(req.body?.name || '').trim();
      if (!rawPrompt) {
        respondError(res, 400, 'Prompt original vazio.');
        return;
      }
      const compressed = `[TOON_V3] ${compressFactTelegraphic(rawPrompt)}`;
      const savings = Math.max(
        12,
        Number(
          (((rawPrompt.length - compressed.length) / Math.max(1, rawPrompt.length)) * 100 + 22).toFixed(
            1
          )
        )
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

      respondOk(res, {
        rawPrompt,
        toonOptimizedPrompt: compressed,
        tokenSavingsPercent: Math.min(78, savings),
        savedTemplate,
      });
    });
  });

  return router;
}
