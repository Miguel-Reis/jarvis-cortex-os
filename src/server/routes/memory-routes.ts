import express from 'express';
import {
  compactMemoryVault,
  computeBinaryQuantization128,
  computeHippoRagPPR,
  computeSimHash128,
  extractEntitiesAndInferEdges,
  findShortestGraphPath,
  routeJevS1,
  searchMemories4WayRRF,
} from '../../shared/cortex-math.ts';
import type { MemoryCategory, MemoryTier } from '../../shared/types.ts';
import { domainMutex } from '../async-mutex.ts';
import { db } from '../db.ts';
import { audit, parseStringList, requireNonEmptyString, respondError, respondOk } from '../http-helpers.ts';
import {
  buildScoutWorkspaceIndex,
  getBrainCognitiveOverview,
  probeAndSyncBrain8765,
  storeBiTemporalMemory,
} from '../swarm-orbit-engine.ts';

export interface MemoryRouterContext {
  broadcastSse: (event: string, payload: unknown) => void;
}

export function createMemoryRouter(ctx: MemoryRouterContext): express.Router {
  const router = express.Router();

  router.get('/api/memories/graph', (req, res) => {
    const seedId = req.query.seedId ? String(req.query.seedId) : undefined;
    const includeSuperseded = req.query.includeSuperseded === 'true';
    const state = db.getState();
    const pool = includeSuperseded
      ? state.memories
      : state.memories.filter((m) => !m.supersededBy && !m.validUntil);
    const nodes = computeHippoRagPPR(pool, state.graphEdges, seedId);
    respondOk(res, { nodes, edges: state.graphEdges, memories: state.memories });
  });

  router.get('/api/memories/search-rrf', (req, res) => {
    const q = String(req.query.q || '');
    const includeSuperseded = req.query.includeSuperseded === 'true';
    const seedId = req.query.seedId ? String(req.query.seedId) : undefined;
    const state = db.getState();
    const hits = searchMemories4WayRRF(q, state.memories, state.graphEdges, {
      includeSuperseded,
      seedId,
    });
    respondOk(res, { hits });
  });

  router.get('/api/memories/path', (req, res) => {
    const fromId = String(req.query.from || '');
    const toId = String(req.query.to || '');
    const state = db.getState();
    const pathResult = findShortestGraphPath(fromId, toId, state.graphEdges);
    respondOk(res, pathResult);
  });

  router.post('/api/memories', async (req, res) => {
    await domainMutex.withLock('memories', async () => {
      const { topic, content, category, provenance, tier, importance, tags, pinned, linkedMemoryId } =
        req.body || {};
      const cleanTopic = requireNonEmptyString(topic);
      const cleanContent = requireNonEmptyString(content);
      if (!cleanTopic || !cleanContent) {
        respondError(res, 400, 'Tópico e conteúdo são obrigatórios.');
        return;
      }

      const parsedTags = parseStringList(tags);
      const stored = storeBiTemporalMemory({
        topic: cleanTopic,
        content: cleanContent,
        category: (category || 'FACT') as MemoryCategory,
        provenance: provenance === 'INFERRED' ? 'INFERRED' : 'CONFIRMED',
        tier: (tier as MemoryTier) || undefined,
        importance: typeof importance === 'number' ? importance : undefined,
        tags: parsedTags,
        pinned: Boolean(pinned),
        sourceUri: 'operator://vault-ui',
        linkedMemoryId: linkedMemoryId ? String(linkedMemoryId) : undefined,
      });

      // Mark manually created operator memory with REAL origin
      db.update((draft) => {
        const target = draft.memories.find((m) => m.id === stored.memory.id);
        if (target) target.source = 'REAL';
      });

      audit(
        'OPERATOR',
        'MEMORY',
        'MEMORY_CREATED_BITEMPORAL',
        `${stored.memory.topic}${stored.supersededIds.length ? ` (superou ${stored.supersededIds.length})` : ''}`
      );
      const activePool = db.getState().memories.filter((m) => !m.supersededBy && !m.validUntil);
      const nodes = computeHippoRagPPR(activePool, db.getState().graphEdges, stored.memory.id);
      ctx.broadcastSse('state_updated', { section: 'memories' });
      respondOk(res, {
        memory: db.getState().memories.find((m) => m.id === stored.memory.id) || stored.memory,
        supersededIds: stored.supersededIds,
        nodes,
        edges: db.getState().graphEdges,
      });
    });
  });

  router.patch('/api/memories/:id', async (req, res) => {
    await domainMutex.withLock('memories', async () => {
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
            const inferred = extractEntitiesAndInferEdges({
              newMemory: m,
              existingMemories: draft.memories,
              existingEdges: draft.graphEdges,
            });
            for (const tag of inferred.enrichedTags) {
              if (!m.tags.includes(tag) && m.tags.length < 12) {
                m.tags.push(tag);
              }
            }
            if (inferred.inferredEdges.length > 0) {
              draft.graphEdges.push(...inferred.inferredEdges);
            }
          }
          m.accessCount = (m.accessCount ?? 1) + 1;
          m.lastAccessedAt = new Date().toISOString();
          m.updatedAt = new Date().toISOString();
          updated = { ...m };
        }
      });
      if (!updated) {
        respondError(res, 404, 'Memória não encontrada.');
        return;
      }
      ctx.broadcastSse('state_updated', { section: 'memories' });
      respondOk(res, { memory: updated, edges: db.getState().graphEdges });
    });
  });

  router.delete('/api/memories/:id', async (req, res) => {
    await domainMutex.withLock('memories', async () => {
      db.update((draft) => {
        draft.memories = draft.memories.filter((m) => m.id !== req.params.id);
        draft.graphEdges = draft.graphEdges.filter(
          (e) => e.source !== req.params.id && e.target !== req.params.id
        );
      });
      ctx.broadcastSse('state_updated', { section: 'memories' });
      respondOk(res, { ok: true });
    });
  });

  // §7: Scheduled & On-Demand Memory Vault Compaction (Near-Duplicate Merge + WORKING TTL + Decay)
  router.post('/api/memories/compact', async (req, res) => {
    await domainMutex.withLock('memories', async () => {
      const workingTtlHours =
        typeof req.body?.workingTtlHours === 'number'
          ? Math.max(1, Math.min(720, req.body.workingTtlHours))
          : 48;
      const duplicateThreshold =
        typeof req.body?.duplicateThreshold === 'number'
          ? Math.max(0.75, Math.min(0.99, req.body.duplicateThreshold))
          : 0.92;

      let resultStats = {
        duplicatesSuperseded: 0,
        workingPruned: 0,
        importanceDecayed: 0,
      };

      db.update((draft) => {
        const compacted = compactMemoryVault({
          memories: draft.memories,
          edges: draft.graphEdges,
          workingMaxAgeDays: Math.max(1, Math.round(workingTtlHours / 24)),
          duplicateBqThreshold: duplicateThreshold,
        });
        draft.memories = compacted.memories;
        draft.graphEdges = compacted.edges;
        resultStats = {
          duplicatesSuperseded: compacted.duplicatesSuperseded,
          workingPruned: compacted.workingPruned,
          importanceDecayed: compacted.importanceDecayed,
        };
      });

      audit(
        'HIPPORAG_COMPACTOR',
        'MEMORY',
        'VAULT_COMPACTED',
        `Duplicados superados=${resultStats.duplicatesSuperseded} · WORKING expirados=${resultStats.workingPruned} · Decaídos=${resultStats.importanceDecayed}`
      );
      ctx.broadcastSse('state_updated', { section: 'memories' });

      const state = db.getState();
      const activePool = state.memories.filter((m) => !m.supersededBy && !m.validUntil);
      const nodes = computeHippoRagPPR(activePool, state.graphEdges);
      respondOk(res, {
        ok: true,
        ...resultStats,
        memories: state.memories,
        edges: state.graphEdges,
        nodes,
      });
    });
  });

  router.post('/api/memories/sync-brain', async (_req, res) => {
    const syncRes = await domainMutex.withLock('memories', async () =>
      probeAndSyncBrain8765(true)
    );
    audit(
      'BRAIN_BRIDGE',
      'MEMORY',
      syncRes.status.httpOnline ? 'SYNC_8765_LIVE' : 'SYNC_NATIVE_STANDALONE',
      syncRes.message
    );
    respondOk(res, {
      online: syncRes.status.httpOnline || syncRes.status.sqliteWalDetected,
      imported: syncRes.importedCount,
      brainUrl: syncRes.status.endpointUrl,
      status: syncRes.status,
      message: syncRes.message,
    });
  });

  router.get('/api/brain/overview', async (_req, res) => {
    const overview = await getBrainCognitiveOverview();
    respondOk(res, overview);
  });

  router.post('/api/brain/router-simulate', async (req, res) => {
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
    respondOk(res, {
      ...routed.decision,
      decision: routed.decision,
      nextDeltaHash: routed.nextDeltaHash,
      compressedContextBlock: routed.compressedContextBlock,
    });
  });

  return router;
}
