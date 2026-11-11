import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  compressFactTelegraphic,
  findShortestGraphPath,
  pruneMcpToolsForIntent,
  searchMemories4WayRRF,
} from '../shared/cortex-math.ts';
import {
  buildDefaultMcpRegistryResources,
  buildDefaultMcpRegistryTools,
  MCP_2026_PROMPTS,
  MCP_2026_RESOURCES,
  MCP_2026_RESOURCE_TEMPLATES,
  MCP_2026_TOOLS,
  MCP_STANDARD_LIBRARY,
  type McpToolSpec,
} from '../shared/mcp-catalog.ts';
import type {
  McpCustomServer,
  McpRegistryResourceItem,
  McpRegistryToolItem,
  MemoryCategory,
  MemoryTier,
} from '../shared/types.ts';
import { db } from './db.ts';
import {
  analyzeFileBlastRadius,
  buildScoutWorkspaceIndex,
  createSubagentSandbox,
  generateScoutArchitectureReport,
  launchAsymmetricSwarm,
  lookupWorkspaceSymbols,
  mergeSubagentSandbox,
  probeAndSyncBrain8765,
  rollbackSubagentSandbox,
  storeBiTemporalMemory,
} from './swarm-orbit-engine.ts';

const execFileAsync = promisify(execFile);

export {
  MCP_2026_PROMPTS,
  MCP_2026_RESOURCES,
  MCP_2026_RESOURCE_TEMPLATES,
  MCP_2026_TOOLS,
  MCP_STANDARD_LIBRARY,
  type McpToolSpec,
};

function getRegistryTools(): McpRegistryToolItem[] {
  const state = db.getState();
  if (!state.mcpRegistryTools || state.mcpRegistryTools.length === 0) {
    const seeded = buildDefaultMcpRegistryTools();
    db.update((draft) => {
      draft.mcpRegistryTools = seeded;
    });
    return seeded;
  }
  return state.mcpRegistryTools;
}

function getRegistryResources(): McpRegistryResourceItem[] {
  const state = db.getState();
  if (!state.mcpRegistryResources || state.mcpRegistryResources.length === 0) {
    const seeded = buildDefaultMcpRegistryResources();
    db.update((draft) => {
      draft.mcpRegistryResources = seeded;
    });
    return seeded;
  }
  return state.mcpRegistryResources;
}

export function getMcpCatalogSummary() {
  const tools = getRegistryTools().filter((t) => t.enabled);
  const resources = getRegistryResources().filter((r) => r.enabled && !r.isTemplate);
  const templates = getRegistryResources().filter((r) => r.enabled && r.isTemplate);

  return {
    protocolVersion: '2025-06-18',
    serverName: 'jarvis-cortex-antigravity-mcp',
    version: '3.0.0',
    toolsCount: tools.length,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    })),
    resources: resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
    resourceTemplates: templates.map((r) => ({
      uriTemplate: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
    prompts: MCP_2026_PROMPTS,
  };
}

export function getMcpGatewayOverview() {
  const tools = getRegistryTools();
  const resources = getRegistryResources();
  const servers = db.getState().mcpServers || [];

  const activeTools = tools.filter((t) => t.enabled);
  const jevEligibleTools = activeTools.filter((t) => t.jevEligible);
  const activeResources = resources.filter((r) => r.enabled);
  const onlineServers = servers.filter((s) => s.enabled && s.healthStatus === 'ONLINE');
  const jevEligibleServers = servers.filter((s) => s.enabled && s.jevEligible !== false);

  const latencySamples = [
    ...activeTools.map((t) => t.lastLatencyMs),
    ...activeResources.map((r) => r.lastLatencyMs),
    ...onlineServers.map((s) => s.lastLatencyMs),
  ].filter((v) => Number.isFinite(v) && v > 0);

  const avgLatencyMs =
    latencySamples.length > 0
      ? Number(
          (latencySamples.reduce((acc, v) => acc + v, 0) / latencySamples.length).toFixed(2)
        )
      : 0.85;

  return {
    protocolVersion: '2025-06-18',
    tools,
    resources,
    servers,
    standardLibrary: MCP_STANDARD_LIBRARY,
    summary: {
      totalTools: tools.length,
      activeTools: activeTools.length,
      healthyTools: activeTools.filter((t) => t.healthStatus === 'HEALTHY').length,
      jevEligibleCount: jevEligibleTools.length,
      totalResources: resources.length,
      activeResources: activeResources.length,
      healthyResources: activeResources.filter((r) => r.healthStatus === 'HEALTHY').length,
      totalServers: servers.length,
      onlineServers: onlineServers.length,
      jevEligibleServers: jevEligibleServers.length,
      pendingAuthServers: servers.filter((s) => s.authStatus === 'PENDING_APPROVAL').length,
      avgLatencyMs,
    },
  };
}

export async function executeMcpToolCall(
  name: string,
  args: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const t0 = performance.now();
  const tools = getRegistryTools();
  const regItem = tools.find((t) => t.name === name);

  if (regItem && !regItem.enabled) {
    return { error: `Ferramenta MCP '${name}' encontra-se desativada no Gateway.` };
  }

  let result: Record<string, unknown>;
  let failed = false;

  try {
    const state = db.getState();

    switch (name) {
      case 'store_fact': {
        const res = storeBiTemporalMemory({
          topic: String(args.topic || 'Facto MCP'),
          content: String(args.content || ''),
          category: (args.category as MemoryCategory) || 'FACT',
          tier: (args.tier as MemoryTier) || 'SEMANTIC',
          sourceUri: 'mcp://store_fact',
        });
        result = { ok: true, memory: res.memory, supersededIds: res.supersededIds };
        break;
      }
      case 'search_brain': {
        const hits = searchMemories4WayRRF(
          String(args.query || ''),
          state.memories,
          state.graphEdges,
          { includeSuperseded: Boolean(args.includeSuperseded) }
        ).slice(0, 8);
        if (hits[0]) {
          const topId = hits[0].memory.id;
          db.update((draft) => {
            const m = draft.memories.find((x) => x.id === topId);
            if (m) {
              m.accessCount = (m.accessCount ?? 1) + 1;
              m.lastAccessedAt = new Date().toISOString();
            }
          });
        }
        result = { count: hits.length, hits };
        break;
      }
      case 'forget_fact': {
        const memId = String(args.memoryId || '');
        const hard = Boolean(args.hardDelete);
        let found = false;
        db.update((draft) => {
          if (hard) {
            const before = draft.memories.length;
            draft.memories = draft.memories.filter((m) => m.id !== memId);
            found = draft.memories.length < before;
          } else {
            const m = draft.memories.find((x) => x.id === memId);
            if (m) {
              m.validUntil = new Date().toISOString();
              m.supersededBy = 'RETIRED_BY_MCP';
              found = true;
            }
          }
        });
        result = { ok: found, memoryId: memId, mode: hard ? 'HARD_DELETE' : 'BITEMPORAL_RETIRE' };
        break;
      }
      case 'save_checkpoint': {
        const ws = String(args.workspace || 'default');
        const summary = String(args.summary || 'Checkpoint cognitivo ativo');
        const res = storeBiTemporalMemory({
          topic: `Checkpoint Workspace [${ws}]`,
          content: compressFactTelegraphic(summary),
          category: 'COMMITMENT',
          tier: 'WORKING',
          tags: ['checkpoint', ws],
          sourceUri: `brain://workspace/${ws}/checkpoint`,
        });
        result = { ok: true, checkpointMemory: res.memory };
        break;
      }
      case 'brain_stats': {
        const bridge = await probeAndSyncBrain8765(false);
        const active = state.memories.filter((m) => !m.supersededBy && !m.validUntil);
        result = {
          totalMemories: state.memories.length,
          activeBiTemporal: active.length,
          supersededHistory: state.memories.length - active.length,
          tiers: {
            WORKING: active.filter((m) => m.tier === 'WORKING').length,
            EPISODIC: active.filter((m) => (m.tier || 'EPISODIC') === 'EPISODIC').length,
            SEMANTIC: active.filter((m) => m.tier === 'SEMANTIC' || m.pinned).length,
          },
          graphEdges: state.graphEdges.length,
          quota5h: state.quota5h,
          bridge8765: bridge.status,
        };
        break;
      }
      case 'brain_prune_tools': {
        const prompt = String(args.prompt || '');
        const nativeNames = getRegistryTools()
          .filter((t) => t.enabled && t.jevEligible)
          .map((t) => t.name);
        const serverToolNames = (state.mcpServers || [])
          .filter((s) => s.enabled && s.authStatus === 'AUTHORIZED' && s.jevEligible !== false)
          .flatMap((s) => s.discoveredTools || []);
        const eligibleNames = Array.from(new Set([...nativeNames, ...serverToolNames]));
        const pruned = pruneMcpToolsForIntent(prompt, eligibleNames);
        const denom = Math.max(1, eligibleNames.length);
        result = {
          prompt,
          prunedTools: pruned,
          activeCount: pruned.length,
          catalogTotal: eligibleNames.length,
          overheadReductionPercent: Number(
            (((denom - pruned.length) / denom) * 100).toFixed(1)
          ),
        };
        break;
      }
      case 'swarm_scout': {
        const idx = await buildScoutWorkspaceIndex(Boolean(args.forceRefresh));
        result = {
          indexedFiles: idx.fileImports.size,
          symbolsCount: idx.symbols.length,
          topCoChanges: idx.coChanges.slice(0, 8),
          sampleSymbols: idx.symbols.slice(0, 12),
        };
        break;
      }
      case 'swarm_start': {
        const run = await launchAsymmetricSwarm({
          objective: String(args.objective || 'Execução MCP Swarm 48x'),
          scale: Number(args.scale) === 24 ? 24 : 48,
        });
        result = {
          runId: run.id,
          scale: run.scale,
          status: run.status,
          verifyGatesPassed: run.verifyGatesPassed,
          verifyGatesTotal: run.verifyGatesTotal,
          rufloConvergence: run.rufloConvergence,
          sandboxId: run.sandboxId,
        };
        break;
      }
      case 'swarm_update_task': {
        const taskId = String(args.taskId || '');
        const nextStatus = String(args.status || 'COMPLETED') as
          | 'READY'
          | 'IN_PROGRESS'
          | 'COMPLETED'
          | 'BLOCKED';
        let updated = null;
        db.update((draft) => {
          const dt = (draft.dotsTasks || []).find((t) => t.id === taskId || t.slug === taskId);
          if (dt) {
            dt.status = nextStatus;
            if (nextStatus === 'COMPLETED') dt.verifiedAt = new Date().toISOString();
            updated = dt;
          }
        });
        result = { ok: Boolean(updated), task: updated };
        break;
      }
      case 'swarm_status': {
        const latest = state.swarmRuns?.[0] || null;
        result = {
          totalRuns: state.swarmRuns?.length || 0,
          latestRun: latest
            ? {
                id: latest.id,
                objective: latest.objective,
                scale: latest.scale,
                status: latest.status,
                verifyGates: `${latest.verifyGatesPassed}/${latest.verifyGatesTotal}`,
                rufloConvergence: latest.rufloConvergence,
              }
            : null,
        };
        break;
      }
      case 'swarm_sandbox': {
        const action = String(args.action || 'list');
        if (action === 'create') {
          const sbx = createSubagentSandbox({ label: String(args.label || 'MCP CoW Sandbox') });
          result = { ok: true, sandbox: sbx };
          break;
        }
        if (action === 'rollback' && args.sandboxId) {
          result = rollbackSubagentSandbox(String(args.sandboxId));
          break;
        }
        if (action === 'merge' && args.sandboxId) {
          result = mergeSubagentSandbox(String(args.sandboxId));
          break;
        }
        result = { sandboxes: state.sandboxes || [] };
        break;
      }
      case 'swarm_symbol_lookup': {
        const symbols = await lookupWorkspaceSymbols(String(args.query || ''));
        result = { count: symbols.length, symbols };
        break;
      }
      case 'swarm_impact_graph': {
        result = await analyzeFileBlastRadius(String(args.filePath || 'server.ts'));
        break;
      }
      case 'swarm_watch_audit': {
        const limit = Math.min(50, Math.max(1, Number(args.limit) || 15));
        result = { auditLogs: state.auditLogs.slice(0, limit) };
        break;
      }
      case 'swarm_graph_path': {
        result = findShortestGraphPath(
          String(args.sourceId || 'mem-core-01'),
          String(args.targetId || 'mem-bridge-06'),
          state.graphEdges
        );
        break;
      }
      case 'swarm_architecture_report': {
        const report = await generateScoutArchitectureReport();
        result = { markdown: report };
        break;
      }
      case 'orbit_mission_control': {
        if (args.broadcastDirective) {
          const directive = String(args.broadcastDirective).trim();
          db.update((draft) => {
            if (!draft.fleetBroadcasts) draft.fleetBroadcasts = [];
            draft.fleetBroadcasts.unshift({
              id: `fb-${Date.now()}`,
              timestamp: new Date().toISOString(),
              sender: `${draft.settings.operatorName} (HUMAN_WINS)`,
              priority: 'OVERRIDE_HUMAN_WINS',
              directive,
              acknowledgedBy: ['SCOUT-01', 'UI-ARCHITECT-01', 'API-GATEWAY-01', 'QA-SENTINEL-01'],
            });
          });
        }
        result = {
          dotsTasks: state.dotsTasks || [],
          handoffs: (state.handoffs || []).slice(0, 8),
          fleetBroadcasts: (state.fleetBroadcasts || []).slice(0, 6),
        };
        break;
      }
      case 'orbit_briefing_roi': {
        result = {
          quota5h: state.quota5h,
          pendingSelfLearn: (state.selfLearnQueue || []).filter((s) => s.status === 'PENDING')
            .length,
        };
        break;
      }
      default: {
        // Check if this is a user-defined CUSTOM MCP tool
        if (regItem && regItem.origin === 'CUSTOM') {
          let parsedPayload: unknown = { status: 'OK', echoedArgs: args };
          if (regItem.mockResponseJson) {
            try {
              parsedPayload = JSON.parse(regItem.mockResponseJson);
            } catch {
              parsedPayload = { response: regItem.mockResponseJson, echoedArgs: args };
            }
          }
          result = {
            ok: true,
            customTool: regItem.name,
            executedAt: new Date().toISOString(),
            output: parsedPayload,
          };
        } else {
          failed = true;
          result = { error: `Unknown MCP tool: ${name}` };
        }
      }
    }
  } catch (err) {
    failed = true;
    result = { error: (err as Error).message };
  }

  const latencyMs = Number(Math.max(0.08, performance.now() - t0).toFixed(2));
  if (regItem) {
    db.update((draft) => {
      const target = (draft.mcpRegistryTools || []).find((x) => x.id === regItem.id);
      if (target) {
        target.callCount = (target.callCount || 0) + 1;
        if (failed || result.error) {
          target.errorCount = (target.errorCount || 0) + 1;
          target.healthStatus = 'DEGRADED';
        } else {
          target.healthStatus = target.enabled ? 'HEALTHY' : 'DISABLED';
        }
        target.lastLatencyMs = latencyMs;
        target.lastCheckedAt = new Date().toISOString();
      }
    });
  }

  return result;
}

export async function readMcpResourceUri(
  uri: string
): Promise<{ ok: boolean; mimeType: string; text: string; error?: string }> {
  const t0 = performance.now();
  const resources = getRegistryResources();
  const matched = resources.find((r) =>
    r.isTemplate ? uri.startsWith(r.uri.split('{')[0]) : r.uri === uri
  );

  if (matched && !matched.enabled) {
    return {
      ok: false,
      mimeType: 'text/plain',
      text: '',
      error: `Recurso MCP '${uri}' desativado no Gateway.`,
    };
  }

  const state = db.getState();
  let outMime = matched?.mimeType || 'application/json';
  let outText = '';
  let ok = true;
  let errMsg: string | undefined;

  try {
    if (uri === 'brain://pinned') {
      const pinned = state.memories.filter((m) => m.pinned && !m.supersededBy);
      outText = JSON.stringify(pinned, null, 2);
    } else if (uri === 'brain://scout/map') {
      const idx = await buildScoutWorkspaceIndex();
      outText = JSON.stringify(
        {
          files: idx.fileImports.size,
          symbols: idx.symbols.slice(0, 40),
          coChanges: idx.coChanges.slice(0, 12),
        },
        null,
        2
      );
    } else if (uri === 'brain://graph/report') {
      outMime = 'text/markdown';
      outText = await generateScoutArchitectureReport();
    } else if (uri === 'brain://orbit/briefing') {
      outText = JSON.stringify(
        {
          quota5h: state.quota5h,
          dotsTasks: state.dotsTasks,
          fleetBroadcasts: state.fleetBroadcasts,
        },
        null,
        2
      );
    } else if (uri.startsWith('brain://workspace/')) {
      const checkpoints = state.memories.filter((m) => m.tags.includes('checkpoint'));
      outText = JSON.stringify(checkpoints, null, 2);
    } else if (uri.startsWith('brain://symbol/')) {
      const symName = decodeURIComponent(uri.replace('brain://symbol/', ''));
      const matches = await lookupWorkspaceSymbols(symName, 10);
      outText = JSON.stringify(matches, null, 2);
    } else if (matched && matched.origin === 'CUSTOM') {
      outText =
        matched.staticPayload ||
        JSON.stringify({ uri, name: matched.name, status: 'ACTIVE', readAt: new Date().toISOString() }, null, 2);
    } else {
      ok = false;
      errMsg = `Unknown resource URI: ${uri}`;
    }
  } catch (err) {
    ok = false;
    errMsg = (err as Error).message;
  }

  const latencyMs = Number(Math.max(0.08, performance.now() - t0).toFixed(2));
  if (matched) {
    db.update((draft) => {
      const target = (draft.mcpRegistryResources || []).find((r) => r.id === matched.id);
      if (target) {
        target.readCount = (target.readCount || 0) + 1;
        target.lastLatencyMs = latencyMs;
        target.lastCheckedAt = new Date().toISOString();
        target.healthStatus = !target.enabled ? 'DISABLED' : ok ? 'HEALTHY' : 'DEGRADED';
      }
    });
  }

  return { ok, mimeType: outMime, text: outText, error: errMsg };
}

export async function handleMcpJsonRpc(
  body: {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  },
  activePort = 3000
): Promise<Record<string, unknown>> {
  const rpcId = body?.id ?? 1;
  const method = String(body?.method || 'initialize');
  const params = body?.params || {};

  try {
    if (method === 'ping') {
      return {
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          pong: true,
          protocolVersion: '2025-06-18',
          timestamp: new Date().toISOString(),
        },
      };
    }

    if (method === 'gateway/heartbeat') {
      const targetId =
        typeof params.serverId === 'string' && params.serverId.trim()
          ? params.serverId.trim()
          : undefined;
      const hb = await runMcpServersHeartbeat(activePort, targetId);
      return {
        jsonrpc: '2.0',
        id: rpcId,
        result: hb,
      };
    }

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          protocolVersion: '2025-06-18',
          serverInfo: {
            name: 'jarvis-cortex-antigravity-mcp',
            version: '3.0.0',
          },
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: false, listChanged: true },
            prompts: { listChanged: false },
          },
        },
      };
    }

    if (method === 'tools/list') {
      const activeSpecs = getRegistryTools()
        .filter((t) => t.enabled)
        .map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        }));
      return {
        jsonrpc: '2.0',
        id: rpcId,
        result: { tools: activeSpecs },
      };
    }

    if (method === 'tools/call') {
      const toolName = String(params.name || '');
      const toolArgs = (params.arguments as Record<string, unknown>) || {};
      const output = await executeMcpToolCall(toolName, toolArgs);
      db.appendAudit(
        'MCP_2026_CLIENT',
        'MCP',
        `TOOL_CALL:${toolName}`,
        JSON.stringify(toolArgs).slice(0, 90),
        output.error ? 'BLOCKED' : 'VERIFIED'
      );
      return {
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
          isError: Boolean(output.error),
        },
      };
    }

    if (method === 'resources/list') {
      const resources = getRegistryResources()
        .filter((r) => r.enabled && !r.isTemplate)
        .map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }));
      return {
        jsonrpc: '2.0',
        id: rpcId,
        result: { resources },
      };
    }

    if (method === 'resources/templates/list') {
      const resourceTemplates = getRegistryResources()
        .filter((r) => r.enabled && r.isTemplate)
        .map((r) => ({
          uriTemplate: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }));
      return {
        jsonrpc: '2.0',
        id: rpcId,
        result: { resourceTemplates },
      };
    }

    if (method === 'resources/read') {
      const uri = String(params.uri || 'brain://pinned');
      const readRes = await readMcpResourceUri(uri);
      if (!readRes.ok) {
        return {
          jsonrpc: '2.0',
          id: rpcId,
          error: { code: -32602, message: readRes.error || `Unknown resource URI: ${uri}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          contents: [{ uri, mimeType: readRes.mimeType, text: readRes.text }],
        },
      };
    }

    if (method === 'prompts/list') {
      return {
        jsonrpc: '2.0',
        id: rpcId,
        result: { prompts: MCP_2026_PROMPTS },
      };
    }

    if (method === 'prompts/get') {
      const pName = String(params.name || 'ultraplan-scout');
      const pArgs = (params.arguments as Record<string, string>) || {};
      const templates: Record<string, string> = {
        'ultraplan-scout': `[ULTRAPLAN SCOUT-01] Executa swarm_scout -> swarm_impact_graph antes de alterar ficheiros para: "${pArgs.objective || 'Objetivo ativo'}". Garante CoW Sandbox ativa e 0 regressões.`,
        'bugfix-lineage': `[BUGFIX LINEAGE] Investiga sintoma "${pArgs.symptom || 'Falha detetada'}" cruzando search_brain (4-Way RRF Bi-Temporal) + Git Co-Change Coupling.`,
        'swarm-dispatch': `[SWARM 48x DISPATCH] Decompõe "${pArgs.feature || 'Feature'}" em 4 lanes assimétricas (UI, API, TESTS, DOCS) exigindo Dual Verify Gates (AST + Testes/AI-Defence).`,
      };
      return {
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          description: `Prompt estruturado MCP 2026 (${pName})`,
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: templates[pName] || templates['ultraplan-scout'] },
            },
          ],
        },
      };
    }

    return {
      jsonrpc: '2.0',
      id: rpcId,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id: rpcId,
      error: { code: -32603, message: (err as Error).message },
    };
  }
}

function isBlockedSsrfUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return true;
    const host = parsed.hostname.toLowerCase();
    if (
      host === '169.254.169.254' ||
      host === 'metadata.google.internal' ||
      host.startsWith('169.254.')
    ) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export async function probeExternalMcpServer(
  serverId: string,
  activePort = 3000
): Promise<McpCustomServer | null> {
  const srv = (db.getState().mcpServers || []).find((s) => s.id === serverId);
  if (!srv) return null;

  const t0 = performance.now();
  const nowIso = new Date().toISOString();

  if (!srv.enabled) {
    let disabledSrv: McpCustomServer | null = null;
    db.update((draft) => {
      const target = (draft.mcpServers || []).find((s) => s.id === serverId);
      if (target) {
        target.healthStatus = 'OFFLINE';
        target.lastCheckedAt = nowIso;
        disabledSrv = { ...target };
      }
    });
    return disabledSrv;
  }

  if (srv.authStatus === 'PENDING_APPROVAL') {
    let pendingSrv: McpCustomServer | null = null;
    db.update((draft) => {
      const target = (draft.mcpServers || []).find((s) => s.id === serverId);
      if (target) {
        target.healthStatus = 'PENDING_AUTH';
        target.lastCheckedAt = nowIso;
        target.lastError = 'Aguarda autorização do comando stdio na Inbox de Autoridade.';
        pendingSrv = { ...target };
      }
    });
    return pendingSrv;
  }

  let healthStatus: McpCustomServer['healthStatus'] = 'OFFLINE';
  let discoveredTools = [...srv.discoveredTools];
  let lastError: string | undefined;
  let lastRpcMethod = srv.lastRpcMethod || 'JSON-RPC 2.0 ping';

  if (srv.transport === 'HTTP_STREAMABLE') {
    lastRpcMethod = 'JSON-RPC 2.0 ping + tools/list';
    let targetUrl = (srv.endpointUrl || '').trim();
    if (targetUrl.includes(':3000/api/mcp') && activePort !== 3000) {
      targetUrl = targetUrl.replace(':3000/api/mcp', `:${activePort}/api/mcp`);
    }

    if (isBlockedSsrfUrl(targetUrl)) {
      healthStatus = 'OFFLINE';
      lastError = 'URL bloqueado pelo filtro de segurança SSRF.';
    } else {
      try {
        // Send JSON-RPC 2.0 ping heartbeat followed by tools/list discovery
        const pingRes = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'ping',
            params: {},
          }),
          signal: AbortSignal.timeout(1800),
        });

        const initRes = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now() + 1,
            method: 'tools/list',
            params: {},
          }),
          signal: AbortSignal.timeout(2500),
        });

        if (initRes.ok || pingRes.ok) {
          const data = (await initRes.json().catch(() => ({}))) as {
            result?: { tools?: { name?: string }[] };
          };
          const toolsArr = data?.result?.tools;
          if (Array.isArray(toolsArr) && toolsArr.length > 0) {
            discoveredTools = toolsArr
              .map((t) => String(t.name || ''))
              .filter(Boolean)
              .slice(0, 18);
          }
          healthStatus = 'ONLINE';
        } else if (initRes.status === 401 || initRes.status === 403) {
          healthStatus = 'DEGRADED';
          lastError = `Endpoint ativo (HTTP ${initRes.status}) — requer credencial/token válido.`;
        } else {
          healthStatus = 'DEGRADED';
          lastError = `Resposta HTTP ${initRes.status}`;
        }
      } catch (err) {
        healthStatus = 'OFFLINE';
        lastError = `Falha de ligação HTTP: ${(err as Error).message}`;
      }
    }
  } else if (srv.transport === 'SSE') {
    lastRpcMethod = 'SSE Handshake GET';
    const targetUrl = (srv.endpointUrl || '').trim();
    if (isBlockedSsrfUrl(targetUrl)) {
      healthStatus = 'OFFLINE';
      lastError = 'URL SSE bloqueado pelo filtro de segurança SSRF.';
    } else {
      try {
        const sseRes = await fetch(targetUrl, {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
          signal: AbortSignal.timeout(2500),
        });
        if (sseRes.ok) {
          healthStatus = 'ONLINE';
        } else if (sseRes.status === 401 || sseRes.status === 403) {
          healthStatus = 'DEGRADED';
          lastError = `Stream SSE alcançável (HTTP ${sseRes.status}) — requer token de autenticação.`;
        } else {
          healthStatus = 'DEGRADED';
          lastError = `Handshake SSE devolveu HTTP ${sseRes.status}`;
        }
        try {
          await sseRes.body?.cancel();
        } catch {
          // ignore stream cancel error
        }
      } catch (err) {
        healthStatus = 'OFFLINE';
        lastError = `Stream SSE inacessível: ${(err as Error).message}`;
      }
    }
  } else {
    // STDIO transport (already AUTHORIZED by Authority Gate)
    lastRpcMethod = 'stdio execFile Probe';
    const rawBin = (srv.command || '').trim().split(/\s+/)[0] || '';
    const safeBinMatch = /^[a-zA-Z0-9._-]+$/.test(rawBin);
    if (!safeBinMatch) {
      healthStatus = 'DEGRADED';
      lastError = 'Executável stdio inválido.';
    } else {
      const locator = process.platform === 'win32' ? 'where' : 'which';
      try {
        await execFileAsync(locator, [rawBin], { timeout: 1800 });
        healthStatus = 'ONLINE';
        lastError = undefined;
      } catch {
        healthStatus = 'DEGRADED';
        lastError = `Binário '${rawBin}' não detetado no PATH local deste anfitrião.`;
      }
    }
  }

  const latencyMs = Number(Math.max(0.18, performance.now() - t0).toFixed(2));
  let updatedSrv: McpCustomServer | null = null;

  db.update((draft) => {
    const target = (draft.mcpServers || []).find((s) => s.id === serverId);
    if (target) {
      const prevHist = Array.isArray(target.latencyHistory)
        ? target.latencyHistory.filter((v) => Number.isFinite(v) && v >= 0)
        : target.lastLatencyMs > 0
          ? [target.lastLatencyMs]
          : [];
      target.healthStatus = healthStatus;
      target.lastLatencyMs = latencyMs;
      target.latencyHistory = [...prevHist, latencyMs].slice(-18);
      target.probeCount = (target.probeCount || prevHist.length || 0) + 1;
      target.errorCount = (target.errorCount || 0) + (healthStatus === 'ONLINE' ? 0 : 1);
      target.lastRpcMethod = lastRpcMethod;
      target.discoveredTools = discoveredTools;
      target.lastCheckedAt = nowIso;
      target.lastError = lastError;
      updatedSrv = { ...target };
    }
  });

  return updatedSrv;
}

export async function runMcpServersHeartbeat(activePort = 3000, serverId?: string) {
  const t0 = performance.now();
  const allServers = db.getState().mcpServers || [];
  const targets = serverId
    ? allServers.filter((s) => s.id === serverId)
    : allServers.filter((s) => s.enabled);

  const probed = await Promise.all(
    targets.map((srv) => probeExternalMcpServer(srv.id, activePort))
  );
  const overview = getMcpGatewayOverview();

  return {
    heartbeatAt: new Date().toISOString(),
    roundTripMs: Number((performance.now() - t0).toFixed(2)),
    probedCount: probed.filter(Boolean).length,
    overview,
  };
}

export async function probeAllMcpGatewayItems(activePort = 3000) {
  const tools = getRegistryTools();
  const resources = getRegistryResources();
  const servers = db.getState().mcpServers || [];

  // Probe non-destructive read-only native tools with real execution, and validate schema on mutating tools
  for (const tool of tools) {
    if (!tool.enabled) {
      db.update((draft) => {
        const t = (draft.mcpRegistryTools || []).find((x) => x.id === tool.id);
        if (t) t.healthStatus = 'DISABLED';
      });
      continue;
    }

    if (tool.annotations.readOnlyHint) {
      const sampleArgs: Record<string, unknown> =
        tool.name === 'search_brain'
          ? { query: 'gateway' }
          : tool.name === 'brain_prune_tools'
            ? { prompt: 'verificar mcp gateway' }
            : tool.name === 'swarm_symbol_lookup'
              ? { query: 'startServer' }
              : tool.name === 'swarm_impact_graph'
                ? { filePath: 'server.ts' }
                : tool.name === 'swarm_graph_path'
                  ? { sourceId: 'mem-core-01', targetId: 'mem-bridge-06' }
                  : {};
      await executeMcpToolCall(tool.name, sampleArgs);
    } else {
      const t0 = performance.now();
      const validSchema =
        Boolean(tool.name.trim()) &&
        typeof tool.inputSchema === 'object' &&
        tool.inputSchema !== null;
      const lat = Number(Math.max(0.12, performance.now() - t0).toFixed(2));
      db.update((draft) => {
        const t = (draft.mcpRegistryTools || []).find((x) => x.id === tool.id);
        if (t) {
          t.healthStatus = validSchema ? 'HEALTHY' : 'DEGRADED';
          t.lastLatencyMs = lat;
          t.lastCheckedAt = new Date().toISOString();
        }
      });
    }
  }

  for (const resItem of resources) {
    if (!resItem.enabled) {
      db.update((draft) => {
        const r = (draft.mcpRegistryResources || []).find((x) => x.id === resItem.id);
        if (r) r.healthStatus = 'DISABLED';
      });
      continue;
    }
    const probeUri = resItem.isTemplate
      ? resItem.uri.replace('{ws}', 'default').replace('{symbol}', 'startServer')
      : resItem.uri;
    await readMcpResourceUri(probeUri);
  }

  await Promise.all(servers.map((s) => probeExternalMcpServer(s.id, activePort)));

  db.appendAudit(
    'MCP_HEALTH_MONITOR',
    'MCP',
    'GATEWAY_PROBE_ALL',
    `Sonda global concluída (${tools.length} tools, ${resources.length} recursos, ${servers.length} servidores).`,
    'VERIFIED'
  );

  return getMcpGatewayOverview();
}
