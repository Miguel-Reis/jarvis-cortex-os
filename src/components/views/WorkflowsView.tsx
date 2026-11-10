import React, { useState } from 'react';
import {
  Play,
  Pause,
  Plus,
  Activity,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  Trash2,
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import { useToast } from '../ToastContext';
import type { JarvisStoreData, WorkflowRun } from '../../shared/types';

interface WorkflowsViewProps {
  store: JarvisStoreData;
  onRefreshBootstrap: () => Promise<void>;
}

export const WorkflowsView: React.FC<WorkflowsViewProps> = ({ store, onRefreshBootstrap }) => {
  const { pushToast } = useToast();
  const [selectedId, setSelectedId] = useState<string>(store.workflows[0]?.id || '');
  const [nlPrompt, setNlPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(store.workflowRuns[0] || null);
  const [pulsingHeartbeat, setPulsingHeartbeat] = useState(false);

  const selectedWorkflow =
    store.workflows.find((w) => w.id === selectedId) || store.workflows[0] || null;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nlPrompt.trim() || generating) return;
    setGenerating(true);
    try {
      const res = await apiJson<{ workflow: { id: string; name: string }; engineUsed: string }>(
        '/api/workflows/generate',
        {
          method: 'POST',
          body: JSON.stringify({ prompt: nlPrompt.trim() }),
        }
      );
      setNlPrompt('');
      await onRefreshBootstrap();
      setSelectedId(res.workflow.id);
      pushToast({
        title: 'Workflow DAG criado',
        detail: `${res.workflow.name} (${res.engineUsed})`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Erro ao gerar workflow', detail: (err as Error).message, tone: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const handleRunNow = async (workflowId: string) => {
    setRunningId(workflowId);
    try {
      const res = await apiJson<{ run: WorkflowRun }>(`/api/workflows/${workflowId}/run`, {
        method: 'POST',
      });
      await onRefreshBootstrap();
      setSelectedRun(res.run);
      pushToast({
        title:
          res.run.status === 'WAITING_APPROVAL'
            ? 'Workflow aguarda Aprovação Humana'
            : `Workflow concluído (${res.run.status})`,
        detail: `Duração total: ${res.run.totalDurationMs}ms`,
        tone: res.run.status === 'FAILED' ? 'error' : res.run.status === 'WAITING_APPROVAL' ? 'warning' : 'success',
      });
    } catch (err) {
      pushToast({ title: 'Erro na execução', detail: (err as Error).message, tone: 'error' });
    } finally {
      setRunningId(null);
    }
  };

  const handleToggleWorkflow = async (id: string, enabled: boolean) => {
    await apiJson(`/api/workflows/${id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    await onRefreshBootstrap();
  };

  const handleDeleteWorkflow = async (id: string) => {
    await apiJson(`/api/workflows/${id}`, { method: 'DELETE' });
    await onRefreshBootstrap();
    pushToast({ title: 'Workflow removido', tone: 'info' });
  };

  const handleUpdateHeartbeat = async (updates: Record<string, unknown>) => {
    if (updates.triggerNow) setPulsingHeartbeat(true);
    try {
      await apiJson('/api/heartbeat', {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      await onRefreshBootstrap();
      if (updates.triggerNow) {
        pushToast({ title: 'Pulso OpenClaw Heartbeat executado', tone: 'success' });
      }
    } finally {
      setPulsingHeartbeat(false);
    }
  };

  const nodeTypeLabel: Record<string, string> = {
    trigger: 'TRIGGER',
    shell: 'SHELL / CÓDIGO',
    ai: 'PASSO IA',
    condition: 'IF / ELSE',
    approval: 'APROVAÇÃO HUMANA',
  };

  return (
    <div className="space-y-6">
      {/* Natural Language Workflow Builder */}
      <section className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            Construtor de Workflows por Linguagem Natural
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Descreve a rotina em português e o Jarvis gera automaticamente os nós do DAG (Trigger, Shell, Condição, Aprovação Humana e Passo IA).
          </p>
        </div>

        <form onSubmit={handleGenerate} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={nlPrompt}
            onChange={(e) => setNlPrompt(e.target.value)}
            placeholder='Ex.: "Todos os dias às 9h verifica os testes Python, lê o Git status e gera um resumo"'
            className="flex-1 px-3.5 py-2 text-sm bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            disabled={generating || !nlPrompt.trim()}
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            {generating ? 'A construir DAG...' : 'Gerar Workflow'}
          </button>
        </form>
      </section>

      {/* Main Split: Workflows List + Visual DAG Canvas & Step Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-[#0d1117] border border-slate-800/80 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">
            Catálogo de Workflows ({store.workflows.length})
          </h3>
          <div className="space-y-2">
            {store.workflows.map((wf) => {
              const active = wf.id === selectedWorkflow?.id;
              return (
                <div
                  key={wf.id}
                  onClick={() => setSelectedId(wf.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedId(wf.id)}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-colors space-y-2 ${
                    active
                      ? 'bg-[#151c26] border-cyan-500/60'
                      : 'bg-transparent border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-100">{wf.name}</p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleWorkflow(wf.id, !wf.enabled);
                      }}
                      aria-label={wf.enabled ? `Pausar ${wf.name}` : `Ativar ${wf.name}`}
                      className={`px-2 py-0.5 text-xs rounded border font-mono ${
                        wf.enabled
                          ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                          : 'border-slate-700 text-slate-400 bg-[#07090e]'
                      }`}
                    >
                      {wf.enabled ? 'Ativo' : 'Pausado'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2">{wf.description}</p>
                  <p className="text-xs font-mono tabular-nums text-slate-500">
                    {wf.cronExpr ? `Cron ${wf.cronExpr}` : 'Trigger Manual'} · {wf.nodes.length} nós
                    {wf.lastStatus ? ` · Último: ${wf.lastStatus}` : ''}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Visual DAG + Execution History */}
        <div className="lg:col-span-8 space-y-6">
          {selectedWorkflow && (
            <section className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-100">{selectedWorkflow.name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{selectedWorkflow.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleWorkflow(selectedWorkflow.id, !selectedWorkflow.enabled)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#151c26] border border-slate-700 text-slate-200 rounded-lg hover:border-slate-600 whitespace-nowrap"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    {selectedWorkflow.enabled ? 'Pausar Cron' : 'Ativar Cron'}
                  </button>
                  <button
                    type="button"
                    disabled={runningId === selectedWorkflow.id}
                    onClick={() => handleRunNow(selectedWorkflow.id)}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 disabled:opacity-50 whitespace-nowrap"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {runningId === selectedWorkflow.id ? 'A executar...' : 'Executar Agora'}
                  </button>
                  {store.workflows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteWorkflow(selectedWorkflow.id)}
                      aria-label={`Eliminar workflow ${selectedWorkflow.name}`}
                      className="p-1.5 text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Visual DAG Pipeline */}
              <div className="p-4 rounded-xl bg-[#07090e] border border-slate-800/90">
                <div className="flex flex-wrap items-center gap-2.5">
                  {selectedWorkflow.nodes.map((node, idx) => {
                    const accent =
                      node.type === 'trigger'
                        ? 'border-cyan-500/50 text-cyan-300'
                        : node.type === 'approval'
                          ? 'border-amber-500/50 text-amber-300'
                          : node.type === 'condition'
                            ? 'border-emerald-500/50 text-emerald-300'
                            : 'border-slate-700 text-slate-200';
                    return (
                      <React.Fragment key={node.id}>
                        <div className={`w-44 p-3 rounded-lg bg-[#0d1117] border ${accent} space-y-1`}>
                          <p className="text-[11px] font-mono text-slate-400">
                            {idx + 1}. {nodeTypeLabel[node.type] || node.type}
                          </p>
                          <p className="text-xs font-semibold text-slate-100 truncate">{node.label}</p>
                          <p className="text-[11px] font-mono text-slate-500 truncate">
                            {node.config.command ||
                              node.config.cronExpr ||
                              node.config.conditionExpr ||
                              node.config.approverNote ||
                              node.config.prompt ||
                              'Pronto'}
                          </p>
                        </div>
                        {idx < selectedWorkflow.nodes.length - 1 && (
                          <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* Step-by-Step Execution Runs */}
          <section className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">
                Histórico de Execuções (Runs Passo-a-Passo)
              </h3>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                {store.workflowRuns.length} registos
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {store.workflowRuns.slice(0, 6).map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRun(run)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-mono tabular-nums transition-colors ${
                    selectedRun?.id === run.id
                      ? 'bg-[#151c26] border-cyan-500 text-cyan-200'
                      : 'bg-[#07090e] border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {run.workflowName.slice(0, 22)} · {run.status} ({run.totalDurationMs}ms)
                </button>
              ))}
            </div>

            {selectedRun && (
              <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-lg bg-[#07090e] p-4">
                {selectedRun.steps.map((step) => (
                  <div key={step.nodeId} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 font-medium text-slate-200">
                        {step.status === 'SUCCESS' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : step.status === 'WAITING_APPROVAL' ? (
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                        )}
                        {step.nodeLabel}
                      </span>
                      <span className="font-mono tabular-nums text-slate-500">
                        {step.nodeType} · {step.durationMs}ms
                      </span>
                    </div>
                    <pre className="text-xs text-slate-400 whitespace-pre-wrap break-words pl-5">
                      {step.output}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* OpenClaw Autonomous Heartbeat Daemon Panel */}
      <section className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-cyan-400 shrink-0" />
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                Daemon Autónomo OpenClaw Heartbeat
              </h3>
              <p className="text-xs text-slate-400">
                Verifica periodicamente portas TCP, pressão de RAM/Disco e objetivos em background.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <select
              aria-label="Intervalo do Heartbeat"
              value={store.heartbeat.intervalSeconds}
              onChange={(e) => handleUpdateHeartbeat({ intervalSeconds: Number(e.target.value) })}
              className="px-3 py-1.5 text-xs bg-[#151c26] border border-slate-700 rounded-lg text-slate-200 font-mono"
            >
              <option value={15}>A cada 15s</option>
              <option value={30}>A cada 30s</option>
              <option value={60}>A cada 60s</option>
              <option value={300}>A cada 5 min</option>
            </select>
            <button
              type="button"
              onClick={() => handleUpdateHeartbeat({ enabled: !store.heartbeat.enabled })}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap ${
                store.heartbeat.enabled
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                  : 'bg-[#151c26] border-slate-700 text-slate-400'
              }`}
            >
              {store.heartbeat.enabled ? 'Daemon Ativo' : 'Daemon Pausado'}
            </button>
            <button
              type="button"
              disabled={pulsingHeartbeat}
              onClick={() => handleUpdateHeartbeat({ triggerNow: true })}
              className="px-3.5 py-1.5 text-xs font-medium bg-[#151c26] border border-slate-700 text-cyan-300 rounded-lg hover:border-cyan-500/50 whitespace-nowrap"
            >
              {pulsingHeartbeat ? 'A verificar...' : 'Pulsar Agora'}
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-800/70">
          {store.heartbeat.recentAlerts.slice(0, 4).map((alert) => (
            <div key={alert.id} className="py-2.5 flex items-center justify-between gap-4 text-xs">
              <span className="text-slate-300">
                <strong className="font-medium text-slate-100">{alert.title}:</strong> {alert.detail}
              </span>
              <span className="font-mono tabular-nums text-slate-500 shrink-0">
                {new Date(alert.timestamp).toLocaleTimeString(store.settings.language)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
