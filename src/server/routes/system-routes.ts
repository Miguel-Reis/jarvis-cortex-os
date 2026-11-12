import express from 'express';
import {
  detectPromptInjection,
  normalizeGeminiModelId,
  normalizeGeminiVoiceName,
} from '../../shared/cortex-math.ts';
import { domainMutex } from '../async-mutex.ts';
import { db } from '../db.ts';
import { runSystemDoctor } from '../doctor.ts';
import { testModelProviderConnection } from '../gemini-engine.ts';
import { audit, respondError, respondOk } from '../http-helpers.ts';
import { probeExternalMcpServer } from '../mcp-server.ts';
import { executeGovernedCommand } from '../os-adapter.ts';
import {
  buildClearSessionCookieHeader,
  buildSessionSetCookieHeader,
  constantTimeTokenEquals,
  evaluateBindAuthPolicy,
} from '../security-gate.ts';
import { runWorkflowById, startOrRefreshHeartbeatDaemon } from '../workflow-runner.ts';

export interface SystemRouterContext {
  port: number;
  host: string;
  broadcastSse: (event: string, payload: unknown) => void;
  reloadDotEnv: () => void;
}

export function createSystemRouter(ctx: SystemRouterContext): express.Router {
  const router = express.Router();

  // ==========================================================================
  // Auth Status, Session Login & Logout (A-01)
  // ==========================================================================
  router.get('/api/auth/status', (_req, res) => {
    const policy = evaluateBindAuthPolicy(ctx.host, process.env);
    respondOk(res, {
      authRequired: policy.tokenRequired,
      tokenConfigured: policy.tokenConfigured,
      bindHost: ctx.host,
      isLoopback: policy.isLoopback,
      isManagedPlatform: policy.isManagedPlatform,
    });
  });

  router.post('/api/auth/login', (req, res) => {
    const expectedToken = (process.env.JARVIS_API_TOKEN || '').trim();
    if (!expectedToken) {
      respondOk(res, { ok: true, authRequired: false });
      return;
    }

    const candidate = String(req.body?.token || '').trim();
    if (!constantTimeTokenEquals(candidate, expectedToken)) {
      audit(
        'SECURITY_GATE',
        'SECURITY',
        'LOGIN_REJECTED',
        `Tentativa de login falhada de ${req.ip || 'unknown'}`,
        'BLOCKED'
      );
      respondError(res, 401, 'Token de operador inválido.', { code: 'INVALID_TOKEN' });
      return;
    }

    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', buildSessionSetCookieHeader(expectedToken, Boolean(isSecure)));
    audit('OPERATOR', 'SECURITY', 'LOGIN_VERIFIED', 'Sessão autenticada via token.', 'VERIFIED');
    respondOk(res, { ok: true, authRequired: true });
  });

  router.post('/api/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', buildClearSessionCookieHeader());
    respondOk(res, { ok: true });
  });

  // ==========================================================================
  // System Doctor & Seed Purge / Real Mode (A-06, A-09, §7)
  // ==========================================================================
  router.get('/api/system/doctor', async (_req, res) => {
    ctx.reloadDotEnv();
    const report = await runSystemDoctor({ port: ctx.port, host: ctx.host });
    respondOk(res, report);
  });

  router.post('/api/system/purge-seeds', async (_req, res) => {
    const summary = await domainMutex.withLock('system', async () => db.purgeDemoSeeds());
    audit(
      'OPERATOR',
      'SYSTEM',
      'DEMO_SEEDS_PURGED',
      `Removidos ${summary.removedSwarmRuns} swarmRuns, ${summary.removedWorkflowRuns} workflowRuns e ${summary.removedMemories} memórias demo (SEED_MODE=real).`
    );
    ctx.broadcastSse('state_updated', { section: 'system_purge' });
    respondOk(res, {
      ok: true,
      ...summary,
      seedMode: db.getState().seedMode,
      state: db.getState(),
    });
  });

  // ==========================================================================
  // Authority Approvals Inbox (Serialized via Mutex — A-07)
  // ==========================================================================
  router.post('/api/approvals/:id/decide', async (req, res) => {
    await domainMutex.withLock('approvals', async () => {
      const decision: 'APPROVED_ONCE' | 'APPROVED_ALWAYS' | 'BLOCKED' =
        req.body?.decision || 'BLOCKED';
      const appr = db.getState().approvals.find((a) => a.id === req.params.id);
      if (!appr) {
        respondError(res, 404, 'Pedido de aprovação não encontrado.');
        return;
      }

      db.update((draft) => {
        const target = draft.approvals.find((a) => a.id === appr.id);
        if (target) {
          target.status = decision;
          target.decidedAt = new Date().toISOString();
        }
        if (
          decision === 'APPROVED_ALWAYS' &&
          !draft.settings.alwaysApprovedCommands.includes(appr.commandOrAction)
        ) {
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
          const probed = await probeExternalMcpServer(appr.mcpServerId, ctx.port);
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

      audit(
        'OPERATOR',
        'SECURITY',
        `APPROVAL_${decision}`,
        `${appr.title} (${appr.commandOrAction})`,
        decision === 'BLOCKED' ? 'BLOCKED' : 'VERIFIED'
      );

      ctx.broadcastSse('state_updated', { section: 'approvals' });
      respondOk(res, {
        approvals: db.getState().approvals,
        settings: db.getState().settings,
        workflowRuns: db.getState().workflowRuns,
        executionOutput,
      });
    });
  });

  // ==========================================================================
  // Canary Tester, Settings & Backup JSON (A-04, A-10)
  // ==========================================================================
  router.post('/api/security/canary-test', (req, res) => {
    const sample = String(req.body?.payload || '');
    const threshold = db.getState().settings.trustThreshold ?? 70;
    const scan = detectPromptInjection(sample, threshold);
    audit(
      'CANARY_TESTER',
      'SECURITY',
      scan.blocked ? 'CANARY_INTERCEPTED' : 'CANARY_CLEAN',
      `Risco ${scan.riskScore}/100 (limiar=${threshold}) — "${sample.slice(0, 70)}"`,
      scan.blocked ? 'BLOCKED' : 'ALLOWED'
    );
    respondOk(res, { scan, threshold, auditLogs: db.getState().auditLogs.slice(0, 40) });
  });

  router.patch('/api/settings', async (req, res) => {
    await domainMutex.withLock('system', async () => {
      const updates = { ...(req.body || {}) };
      if (typeof updates.preferredGeminiModel === 'string') {
        updates.preferredGeminiModel = normalizeGeminiModelId(updates.preferredGeminiModel);
      }
      if (typeof updates.preferredVoiceName === 'string') {
        updates.preferredVoiceName = normalizeGeminiVoiceName(updates.preferredVoiceName);
      }
      if (typeof updates.trustThreshold === 'number') {
        updates.trustThreshold = Math.max(20, Math.min(100, Math.round(updates.trustThreshold)));
      }
      db.update((draft) => {
        draft.settings = {
          ...draft.settings,
          ...updates,
        };
        if (updates.seedMode === 'real' || updates.seedMode === 'demo') {
          draft.seedMode = updates.seedMode;
        }
      });
      startOrRefreshHeartbeatDaemon(ctx.port);
      audit('OPERATOR', 'SYSTEM', 'SETTINGS_UPDATED', 'Preferências do sistema atualizadas.');
      ctx.broadcastSse('state_updated', { section: 'settings' });
      respondOk(res, { settings: db.getState().settings });
    });
  });

  router.post('/api/settings/test-provider', async (req, res) => {
    ctx.reloadDotEnv();
    const result = await testModelProviderConnection(req.body || {});
    respondOk(res, result);
  });

  router.get('/api/backup/export', (_req, res) => {
    db.flushSync({ writeJsonMirror: true });
    respondOk(res, {
      exportedAt: new Date().toISOString(),
      version: '4.0.0',
      schemaVersion: db.getState().schemaVersion ?? 4,
      data: db.getState(),
    });
  });

  router.post('/api/backup/import', async (req, res) => {
    await domainMutex.withLock('system', async () => {
      const incoming = req.body?.data || req.body;
      if (!incoming || typeof incoming !== 'object') {
        respondError(res, 400, 'Payload JSON inválido.');
        return;
      }
      const nextState = db.replaceAll(incoming);
      audit(
        'OPERATOR',
        'SYSTEM',
        'BACKUP_IMPORTED',
        `Estado restaurado via ficheiro JSON (${nextState.memories.length} memórias preservadas sem injeção demo).`
      );
      ctx.broadcastSse('state_updated', { section: 'backup_import' });
      respondOk(res, { ok: true, state: nextState });
    });
  });

  return router;
}
