import { compactMemoryVault } from '../shared/cortex-math.ts';
import type { Workflow, WorkflowRun, WorkflowStepLog } from '../shared/types.ts';
import { domainMutex } from './async-mutex.ts';
import { db } from './db.ts';
import { debugLog } from './debug-logger.ts';
import { synthesizeBriefText } from './gemini-engine.ts';
import {
  collectOSTelemetry,
  enqueueApprovalRequest,
  executeGovernedCommand,
} from './os-adapter.ts';
import { runProjectProactiveScan } from './swarm-orbit-engine.ts';

type SseBroadcastFn = (event: string, data: unknown) => void;

let broadcastCallback: SseBroadcastFn = () => {};

export function registerWorkflowBroadcaster(fn: SseBroadcastFn): void {
  broadcastCallback = fn;
}

export async function runWorkflowById(
  workflowId: string,
  triggerSource: WorkflowRun['triggerSource'] = 'MANUAL',
  bypassApproval = false,
  resumedRunId?: string
): Promise<WorkflowRun | null> {
  const state = db.getState();
  const wf: Workflow | undefined = state.workflows.find((w) => w.id === workflowId);
  if (!wf) return null;

  const runId = resumedRunId || `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const startedAt = new Date().toISOString();
  const steps: WorkflowStepLog[] = [];
  let overallStatus: WorkflowRun['status'] = 'SUCCESS';
  let pendingApprovalId: string | undefined;
  let lastExitCode = 0;
  let aggregatedContext = '';

  const t0 = Date.now();
  debugLog(
    'INFO',
    'WORKFLOW',
    `Starting workflow "${wf.name}" (${wf.id}) via ${triggerSource} [${wf.nodes.length} nodes]`
  );

  for (const node of wf.nodes) {
    const stepStart = Date.now();
    const stepStartedIso = new Date().toISOString();

    if (node.type === 'trigger') {
      steps.push({
        nodeId: node.id,
        nodeLabel: node.label,
        nodeType: node.type,
        status: 'SUCCESS',
        output: `Trigger ${triggerSource} iniciado (${node.config.cronExpr || 'imediato'}).`,
        durationMs: Math.max(1, Date.now() - stepStart),
        startedAt: stepStartedIso,
      });
      continue;
    }

    if (node.type === 'condition') {
      const passed = lastExitCode === 0;
      steps.push({
        nodeId: node.id,
        nodeLabel: node.label,
        nodeType: node.type,
        status: passed ? 'SUCCESS' : 'SKIPPED',
        output: passed
          ? `Condição "${node.config.conditionExpr || 'exitCode === 0'}" verdadeira.`
          : `Condição falsa (exitCode=${lastExitCode}) — passos seguintes interrompidos.`,
        durationMs: Math.max(1, Date.now() - stepStart),
        startedAt: stepStartedIso,
      });
      if (!passed) {
        overallStatus = 'FAILED';
        break;
      }
      continue;
    }

    if (node.type === 'approval') {
      if (!bypassApproval && db.getState().settings.autonomyLevel !== 'FULL_EXECUTIVE') {
        const apprId = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        pendingApprovalId = apprId;
        enqueueApprovalRequest({
          id: apprId,
          title: `Workflow: ${wf.name} (${node.label})`,
          commandOrAction: node.config.approverNote || `Aprovar continuação de ${wf.name}`,
          source: 'WORKFLOW',
          actorName: `Workflow "${wf.name}"`,
          riskLevel: 'MEDIUM',
          requestedAt: new Date().toISOString(),
          status: 'PENDING',
          workflowRunId: runId,
        });
        steps.push({
          nodeId: node.id,
          nodeLabel: node.label,
          nodeType: node.type,
          status: 'WAITING_APPROVAL',
          output: `Pausado para aprovação humana na Inbox de Autoridade (ID: ${apprId}).`,
          durationMs: Math.max(1, Date.now() - stepStart),
          startedAt: stepStartedIso,
        });
        overallStatus = 'WAITING_APPROVAL';
        break;
      } else {
        steps.push({
          nodeId: node.id,
          nodeLabel: node.label,
          nodeType: node.type,
          status: 'SUCCESS',
          output: 'Aprovação humana validada pelo Operador.',
          durationMs: Math.max(1, Date.now() - stepStart),
          startedAt: stepStartedIso,
        });
        continue;
      }
    }

    if (node.type === 'shell') {
      const cmd = node.config.command || 'node -v';
      const execRes = await executeGovernedCommand(cmd, 'WORKFLOW', bypassApproval, runId);
      if (execRes.status === 'PENDING_APPROVAL') {
        pendingApprovalId = execRes.approvalId;
        steps.push({
          nodeId: node.id,
          nodeLabel: node.label,
          nodeType: node.type,
          status: 'WAITING_APPROVAL',
          output: execRes.output,
          durationMs: execRes.durationMs,
          startedAt: stepStartedIso,
        });
        overallStatus = 'WAITING_APPROVAL';
        break;
      }
      lastExitCode = execRes.exitCode;
      aggregatedContext += `\n[${node.label}]: ${execRes.output.slice(0, 600)}`;
      const ok = execRes.status === 'EXECUTED' && execRes.exitCode === 0;
      steps.push({
        nodeId: node.id,
        nodeLabel: node.label,
        nodeType: node.type,
        status: ok ? 'SUCCESS' : 'FAILED',
        output: execRes.output.slice(0, 1500),
        durationMs: execRes.durationMs,
        startedAt: stepStartedIso,
      });
      if (!ok) {
        overallStatus = 'FAILED';
        break;
      }
      continue;
    }

    if (node.type === 'ai') {
      const prompt = `${node.config.prompt || 'Sintetiza os resultados.'}\nContexto recolhido:${aggregatedContext || ' Execução nominal.'}`;
      const summary = await synthesizeBriefText(prompt);
      steps.push({
        nodeId: node.id,
        nodeLabel: node.label,
        nodeType: node.type,
        status: 'SUCCESS',
        output: summary,
        durationMs: Math.max(4, Date.now() - stepStart),
        startedAt: stepStartedIso,
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const runRecord: WorkflowRun = {
    id: runId,
    workflowId: wf.id,
    workflowName: wf.name,
    triggerSource,
    status: overallStatus,
    startedAt,
    finishedAt,
    totalDurationMs: Math.max(2, Date.now() - t0),
    steps,
    pendingApprovalId,
    source: 'REAL',
  };

  db.update((draft) => {
    const existingIdx = resumedRunId
      ? draft.workflowRuns.findIndex((r) => r.id === resumedRunId)
      : -1;
    if (existingIdx >= 0) {
      draft.workflowRuns[existingIdx] = runRecord;
    } else {
      draft.workflowRuns.unshift(runRecord);
      if (draft.workflowRuns.length > 60) draft.workflowRuns.length = 60;
    }
    const targetWf = draft.workflows.find((item) => item.id === wf.id);
    if (targetWf) {
      targetWf.lastRunAt = finishedAt;
      targetWf.lastStatus = overallStatus;
    }
  });

  db.appendAudit(
    triggerSource,
    'WORKFLOW',
    'WORKFLOW_RUN',
    `${wf.name} -> ${overallStatus} (${runRecord.totalDurationMs}ms)`,
    overallStatus === 'FAILED' ? 'BLOCKED' : 'VERIFIED'
  );

  debugLog(
    overallStatus === 'FAILED' ? 'WARN' : 'INFO',
    'WORKFLOW',
    `Workflow "${wf.name}" finished -> ${overallStatus} (${steps.length} steps)`,
    { durationMs: runRecord.totalDurationMs }
  );
  broadcastCallback('workflow_run', runRecord);
  return runRecord;
}

// ============================================================================
// OpenClaw Autonomous Background Heartbeat Daemon
// ============================================================================
let heartbeatTimer: NodeJS.Timeout | null = null;

export function startOrRefreshHeartbeatDaemon(activePort = 3000): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  const cfg = db.getState().heartbeat;
  if (!cfg.enabled) return;

  const intervalMs = Math.max(15, cfg.intervalSeconds) * 1000;
  heartbeatTimer = setInterval(async () => {
    try {
      const current = db.getState().heartbeat;
      if (!current.enabled) return;

      const telemetry = await collectOSTelemetry(activePort);
      const nowIso = new Date().toISOString();
      const ramHigh = telemetry.ramPercent > 88;
      const atRiskGoals = db.getState().goals.filter((g) => g.status === 'AT_RISK').length;
      const pendingApprovals = db.getState().approvals.filter((a) => a.status === 'PENDING').length;

      const severity = ramHigh ? 'WARNING' : 'NOMINAL';
      const detail = `CPU ${telemetry.cpuUsagePercent}% · RAM ${telemetry.ramPercent}% (${telemetry.ramFreeGb} GB livres) · ${pendingApprovals} aprovações pendentes${atRiskGoals > 0 ? ` · ${atRiskGoals} objetivos em risco` : ''}.`;

      db.update((draft) => {
        draft.heartbeat.lastBeatAt = nowIso;
        draft.heartbeat.totalBeats += 1;
        draft.heartbeat.recentAlerts.unshift({
          id: `hb-${Date.now()}`,
          timestamp: nowIso,
          severity,
          title: ramHigh ? 'Pressão Elevada de Memória Detetada' : 'Ciclo Heartbeat Concluído',
          detail,
        });
        if (draft.heartbeat.recentAlerts.length > 20) {
          draft.heartbeat.recentAlerts.length = 20;
        }
      });

      // §7: Periodic scheduled Memory Vault Compaction every 5 Heartbeat cycles
      if (db.getState().heartbeat.totalBeats % 5 === 0) {
        await domainMutex.withLock('memories', async () => {
          db.update((draft) => {
            const compacted = compactMemoryVault({
              memories: draft.memories,
              edges: draft.graphEdges,
            });
            if (
              compacted.duplicatesSuperseded > 0 ||
              compacted.workingPruned > 0 ||
              compacted.importanceDecayed > 0
            ) {
              draft.memories = compacted.memories;
              draft.graphEdges = compacted.edges;
              debugLog(
                'INFO',
                'HEARTBEAT',
                `Scheduled vault compaction: superseded=${compacted.duplicatesSuperseded}, pruned=${compacted.workingPruned}, decayed=${compacted.importanceDecayed}`
              );
            }
          });
        });
      }

      if (db.getState().settings.proactiveGlobalEnabled !== false) {
        await runProjectProactiveScan().catch(() => {});
      }

      debugLog(
        ramHigh ? 'WARN' : 'DEBUG',
        'HEARTBEAT',
        `Beat #${db.getState().heartbeat.totalBeats}: ${detail}`
      );
      broadcastCallback('heartbeat', {
        timestamp: nowIso,
        telemetry,
        heartbeat: db.getState().heartbeat,
      });
    } catch (err) {
      debugLog('WARN', 'HEARTBEAT', `Daemon cycle warning: ${(err as Error).message}`);
    }
  }, intervalMs);

  heartbeatTimer.unref?.();
}
