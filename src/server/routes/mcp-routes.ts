import express from 'express';
import {
  redactAiDefenceSecrets,
  validateMcpServerAuthorityGate,
} from '../../shared/cortex-math.ts';
import {
  buildDefaultMcpRegistryResources,
  buildDefaultMcpRegistryTools,
  MCP_STANDARD_LIBRARY,
} from '../../shared/mcp-catalog.ts';
import type {
  ApprovalRequest,
  McpCustomServer,
  McpLibraryCategory,
  McpRegistryResourceItem,
  McpRegistryToolItem,
  McpTransportType,
} from '../../shared/types.ts';
import { domainMutex } from '../async-mutex.ts';
import { db } from '../db.ts';
import { audit, respondError, respondOk } from '../http-helpers.ts';
import {
  getMcpCatalogSummary,
  getMcpGatewayOverview,
  handleMcpJsonRpc,
  probeAllMcpGatewayItems,
  probeExternalMcpServer,
} from '../mcp-server.ts';

export interface McpRouterContext {
  port: number;
  broadcastSse: (event: string, payload: unknown) => void;
}

export function createMcpRouter(ctx: McpRouterContext): express.Router {
  const router = express.Router();

  router.get('/api/mcp/catalog', (_req, res) => {
    respondOk(res, getMcpCatalogSummary());
  });

  router.post('/api/mcp', async (req, res) => {
    const method = String(req.body?.method || '');
    const rpcResponse = await handleMcpJsonRpc(req.body || {}, ctx.port);
    if (method === 'gateway/heartbeat' || method === 'ping') {
      ctx.broadcastSse('mcp_heartbeat', { method, timestamp: new Date().toISOString() });
    } else {
      ctx.broadcastSse('state_updated', { section: 'mcp' });
    }
    respondOk(res, rpcResponse);
  });

  router.get('/api/mcp/gateway', (_req, res) => {
    respondOk(res, getMcpGatewayOverview());
  });

  router.post('/api/mcp/gateway/probe-all', async (_req, res) => {
    const overview = await domainMutex.withLock('mcp', async () =>
      probeAllMcpGatewayItems(ctx.port)
    );
    ctx.broadcastSse('state_updated', { section: 'mcp' });
    respondOk(res, overview);
  });

  router.post('/api/mcp/gateway/reset-defaults', async (_req, res) => {
    await domainMutex.withLock('mcp', async () => {
      const nowIso = new Date().toISOString();
      db.update((draft) => {
        draft.mcpRegistryTools = buildDefaultMcpRegistryTools(nowIso);
        draft.mcpRegistryResources = buildDefaultMcpRegistryResources(nowIso);
      });
      audit(
        'OPERATOR',
        'MCP',
        'GATEWAY_RESET_DEFAULTS',
        'Catálogo nativo reposto para as 18 ferramentas e 6 recursos brain:// de fábrica.'
      );
      ctx.broadcastSse('state_updated', { section: 'mcp' });
      respondOk(res, getMcpGatewayOverview());
    });
  });

  router.post('/api/mcp/gateway/tools', async (req, res) => {
    await domainMutex.withLock('mcp', async () => {
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
        respondError(res, 400, 'Nome técnico da ferramenta MCP é obrigatório.');
        return;
      }

      const existing = (db.getState().mcpRegistryTools || []).some((t) => t.name === cleanName);
      if (existing) {
        respondError(res, 400, `Já existe uma ferramenta registada com o nome '${cleanName}'.`);
        return;
      }

      let parsedSchema: Record<string, unknown> = { type: 'object', properties: {} };
      if (typeof inputSchema === 'string' && inputSchema.trim()) {
        try {
          parsedSchema = JSON.parse(inputSchema);
        } catch {
          respondError(res, 400, 'inputSchema JSON inválido.');
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
        description: String(
          description || 'Ferramenta MCP personalizada registada pelo Operador.'
        ).trim(),
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

      audit('OPERATOR', 'MCP', 'TOOL_ADDED', cleanName);
      ctx.broadcastSse('state_updated', { section: 'mcp' });
      respondOk(res, { tool: newTool, overview: getMcpGatewayOverview() });
    });
  });

  router.patch('/api/mcp/gateway/tools/:id', async (req, res) => {
    await domainMutex.withLock('mcp', async () => {
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
        respondError(res, 404, 'Ferramenta MCP não encontrada.');
        return;
      }

      ctx.broadcastSse('state_updated', { section: 'mcp' });
      respondOk(res, { tool: updated, overview: getMcpGatewayOverview() });
    });
  });

  router.delete('/api/mcp/gateway/tools/:id', async (req, res) => {
    await domainMutex.withLock('mcp', async () => {
      let removedName = '';
      db.update((draft) => {
        const target = (draft.mcpRegistryTools || []).find((t) => t.id === req.params.id);
        if (target) removedName = target.name;
        draft.mcpRegistryTools = (draft.mcpRegistryTools || []).filter(
          (t) => t.id !== req.params.id
        );
      });
      if (!removedName) {
        respondError(res, 404, 'Ferramenta MCP não encontrada.');
        return;
      }
      audit('OPERATOR', 'MCP', 'TOOL_REMOVED', removedName);
      ctx.broadcastSse('state_updated', { section: 'mcp' });
      respondOk(res, { ok: true, overview: getMcpGatewayOverview() });
    });
  });

  router.post('/api/mcp/gateway/resources', async (req, res) => {
    await domainMutex.withLock('mcp', async () => {
      const { uri, name, description, mimeType, isTemplate, staticPayload } = req.body || {};
      const cleanUri = String(uri || '').trim();
      const cleanName = String(name || '').trim();
      if (!cleanUri || !cleanName) {
        respondError(res, 400, 'URI e nome do recurso são obrigatórios.');
        return;
      }
      const duplicate = (db.getState().mcpRegistryResources || []).some(
        (r) => r.uri === cleanUri
      );
      if (duplicate) {
        respondError(res, 400, `Já existe um recurso com o URI '${cleanUri}'.`);
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

      audit('OPERATOR', 'MCP', 'RESOURCE_ADDED', cleanUri);
      ctx.broadcastSse('state_updated', { section: 'mcp' });
      respondOk(res, { resource: newRes, overview: getMcpGatewayOverview() });
    });
  });

  router.patch('/api/mcp/gateway/resources/:id', async (req, res) => {
    await domainMutex.withLock('mcp', async () => {
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
        respondError(res, 404, 'Recurso MCP não encontrado.');
        return;
      }

      ctx.broadcastSse('state_updated', { section: 'mcp' });
      respondOk(res, { resource: updated, overview: getMcpGatewayOverview() });
    });
  });

  router.delete('/api/mcp/gateway/resources/:id', async (req, res) => {
    await domainMutex.withLock('mcp', async () => {
      let removedUri = '';
      db.update((draft) => {
        const target = (draft.mcpRegistryResources || []).find((r) => r.id === req.params.id);
        if (target) removedUri = target.uri;
        draft.mcpRegistryResources = (draft.mcpRegistryResources || []).filter(
          (r) => r.id !== req.params.id
        );
      });
      if (!removedUri) {
        respondError(res, 404, 'Recurso MCP não encontrado.');
        return;
      }
      audit('OPERATOR', 'MCP', 'RESOURCE_REMOVED', removedUri);
      ctx.broadcastSse('state_updated', { section: 'mcp' });
      respondOk(res, { ok: true, overview: getMcpGatewayOverview() });
    });
  });

  router.post('/api/mcp/gateway/validate-server', (req, res) => {
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
      audit(
        'AUTHORITY_GATE',
        'SECURITY',
        'MCP_VALIDATION_BLOCKED',
        `${name} [${transport}] Risco ${gate.riskScore}/100`,
        'BLOCKED'
      );
    }

    respondOk(res, { gate });
  });

  router.post('/api/mcp/gateway/servers', async (req, res) => {
    await domainMutex.withLock('mcp', async () => {
      const body = req.body || {};
      const libItem = body.libraryId
        ? MCP_STANDARD_LIBRARY.find((item) => item.id === String(body.libraryId))
        : undefined;

      const name = String(body.name || libItem?.name || '').trim();
      if (!name) {
        respondError(res, 400, 'Nome do servidor MCP é obrigatório.');
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
        audit(
          'AUTHORITY_GATE',
          'SECURITY',
          'MCP_SERVER_BLOCKED',
          `${name} [${transport}]: ${failDetail}`,
          'BLOCKED'
        );
        respondError(
          res,
          403,
          `Bloqueado pelo Authority Gate (Risco ${gate.riskScore}/100): ${failDetail}`,
          { gate }
        );
        return;
      }

      const rawEnv = (
        body.envKeys && typeof body.envKeys === 'object' ? body.envKeys : {}
      ) as Record<string, string>;
      const maskedEnvKeys: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawEnv)) {
        const cleanKey = k.trim();
        if (!cleanKey) continue;
        const valStr = String(v || '').trim();
        maskedEnvKeys[cleanKey] =
          valStr.length > 8
            ? `${valStr.slice(0, 4)}••••${valStr.slice(-3)}`
            : valStr
              ? '••••••••'
              : 'CONFIGURED';
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

      let pendingMcpApproval: ApprovalRequest | null = null;
      db.update((draft) => {
        if (!draft.mcpServers) draft.mcpServers = [];
        draft.mcpServers.unshift(newServer);

        if (!stdioPreApproved) {
          pendingMcpApproval = {
            id: `appr-mcp-${Date.now()}`,
            title: `Autorizar Servidor MCP stdio (${name})`,
            commandOrAction: fullStdioCmd,
            source: 'MCP_GATEWAY',
            actorName: `MCP Gateway · ${name}`,
            riskLevel: gate.riskLevel === 'LOW' ? 'MEDIUM' : gate.riskLevel,
            requestedAt: nowIso,
            status: 'PENDING',
            mcpServerId: serverId,
          };
          draft.approvals.unshift(pendingMcpApproval);
        }
      });

      if (pendingMcpApproval) {
        ctx.broadcastSse('approval_requested', pendingMcpApproval);
      }

      const auditSummary = redactAiDefenceSecrets(
        `${name} [${transport}] JEV-S1=${jevEligible ? 'ON' : 'OFF'} · Risco=${gate.riskScore}/100`
      ).sanitized;
      audit(
        'OPERATOR',
        'MCP',
        stdioPreApproved ? 'MCP_SERVER_REGISTERED' : 'MCP_STDIO_PENDING_AUTH',
        auditSummary
      );

      if (stdioPreApproved) {
        await probeExternalMcpServer(serverId, ctx.port);
      }

      ctx.broadcastSse('state_updated', { section: 'mcp' });
      respondOk(res, {
        server: (db.getState().mcpServers || []).find((s) => s.id === serverId),
        gate,
        overview: getMcpGatewayOverview(),
        approvals: db.getState().approvals,
      });
    });
  });

  router.post('/api/mcp/gateway/servers/:id/authorize', async (req, res) => {
    await domainMutex.withLock('mcp', async () => {
      const serverId = req.params.id;
      const srv = (db.getState().mcpServers || []).find((s) => s.id === serverId);
      if (!srv) {
        respondError(res, 404, 'Servidor MCP não encontrado.');
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

      await probeExternalMcpServer(serverId, ctx.port);
      audit('OPERATOR', 'SECURITY', 'MCP_STDIO_AUTHORIZED', `${srv.name} (${cmdLine})`);
      ctx.broadcastSse('state_updated', { section: 'mcp' });
      respondOk(res, {
        server: (db.getState().mcpServers || []).find((s) => s.id === serverId),
        overview: getMcpGatewayOverview(),
        approvals: db.getState().approvals,
      });
    });
  });

  router.post('/api/mcp/gateway/servers/:id/probe', async (req, res) => {
    const probed = await domainMutex.withLock('mcp', async () =>
      probeExternalMcpServer(req.params.id, ctx.port)
    );
    if (!probed) {
      respondError(res, 404, 'Servidor MCP não encontrado.');
      return;
    }
    ctx.broadcastSse('state_updated', { section: 'mcp' });
    respondOk(res, { server: probed, overview: getMcpGatewayOverview() });
  });

  router.patch('/api/mcp/gateway/servers/:id', async (req, res) => {
    await domainMutex.withLock('mcp', async () => {
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
        respondError(res, 404, 'Servidor MCP não encontrado.');
        return;
      }

      const updated = shouldReprobe
        ? await probeExternalMcpServer(req.params.id, ctx.port)
        : updatedRef;
      ctx.broadcastSse('state_updated', { section: 'mcp' });
      respondOk(res, { server: updated, overview: getMcpGatewayOverview() });
    });
  });

  router.delete('/api/mcp/gateway/servers/:id', async (req, res) => {
    await domainMutex.withLock('mcp', async () => {
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
        respondError(res, 404, 'Servidor MCP não encontrado.');
        return;
      }
      audit('OPERATOR', 'MCP', 'MCP_SERVER_REMOVED', removedName);
      ctx.broadcastSse('state_updated', { section: 'mcp' });
      respondOk(res, { ok: true, overview: getMcpGatewayOverview() });
    });
  });

  return router;
}
