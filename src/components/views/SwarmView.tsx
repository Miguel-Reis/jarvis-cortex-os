import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  FileCode2,
  GitMerge,
  Layers,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import { useToast } from '../ToastContext';
import { SwarmOffice3D } from '../SwarmOffice3D';
import type {
  CoChangeEdge,
  SubagentSandbox,
  SwarmLane,
  SwarmRun,
} from '../../shared/types';

interface SwarmOverviewPayload {
  swarmRuns: SwarmRun[];
  sandboxes: SubagentSandbox[];
  scout: {
    indexedFiles: number;
    symbolsCount: number;
    coChanges: CoChangeEdge[];
    fileHeatmap: { filePath: string; symbolCount: number }[];
  };
}

interface SwarmViewProps {
  onRefreshBootstrap: () => Promise<void>;
  onOpenWorkspaceFile?: (filePath: string) => void;
}

export const SwarmView: React.FC<SwarmViewProps> = ({
  onRefreshBootstrap,
  onOpenWorkspaceFile,
}) => {
  const { pushToast } = useToast();
  const [overview, setOverview] = useState<SwarmOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);

  const [objective, setObjective] = useState(
    'Auditar arquitetura Cortex v3.0, validar contratos AST e executar Verify Gates 96/96'
  );
  const [workerScale, setWorkerScale] = useState<24 | 48>(48);
  const [selectedLane, setSelectedLane] = useState<SwarmLane | null>(null);

  // Sandbox creation & actions
  const [sandboxLabel, setSandboxLabel] = useState('Patch Subagente QA-SENTINEL');
  const [creatingSandbox, setCreatingSandbox] = useState(false);
  const [busySandboxId, setBusySandboxId] = useState<string | null>(null);

  // GRAPH_REPORT.md modal
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState('');

  const loadOverview = useCallback(async () => {
    try {
      const data = await apiJson<SwarmOverviewPayload>('/api/swarm/overview');
      setOverview(data);
    } catch (err) {
      pushToast({
        title: 'Erro ao carregar Enxame Swarm',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleLaunchSwarm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!objective.trim() || launching) return;
    setLaunching(true);
    try {
      const res = await apiJson<{ swarmRun: SwarmRun; sandboxes: SubagentSandbox[] }>(
        '/api/swarm/launch',
        {
          method: 'POST',
          body: JSON.stringify({
            objective: objective.trim(),
            scale: workerScale,
          }),
        }
      );
      await Promise.all([loadOverview(), onRefreshBootstrap()]);
      pushToast({
        title: `Enxame Swarm ${res.swarmRun.scale}x Concluído`,
        detail: `${res.swarmRun.verifyGatesPassed}/${res.swarmRun.verifyGatesTotal} Verify Gates aprovados · Feromona ${(
          res.swarmRun.rufloConvergence * 100
        ).toFixed(1)}%`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Falha no lançamento do enxame',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setLaunching(false);
    }
  };

  const handleOpenGraphReport = async () => {
    try {
      const res = await apiJson<{ markdown: string }>('/api/swarm/architecture-report');
      setReportMarkdown(res.markdown);
      setReportOpen(true);
    } catch (err) {
      pushToast({
        title: 'Erro ao gerar GRAPH_REPORT.md',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const handleCreateSandbox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingSandbox) return;
    setCreatingSandbox(true);
    try {
      await apiJson('/api/swarm/sandboxes', {
        method: 'POST',
        body: JSON.stringify({
          label: sandboxLabel.trim() || 'Subagent CoW Sandbox',
          agentCallsign: selectedLane ? `${selectedLane}-SANDBOX-01` : 'QA-SENTINEL-01',
        }),
      });
      await Promise.all([loadOverview(), onRefreshBootstrap()]);
      pushToast({
        title: 'Sandbox Copy-on-Write criada',
        detail: 'Snapshots comprimidos com zlib + assinatura SHA-256.',
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Erro ao criar sandbox', detail: (err as Error).message, tone: 'error' });
    } finally {
      setCreatingSandbox(false);
    }
  };

  const handleMutateTest = async (id: string, injectCanarySecret: boolean) => {
    setBusySandboxId(id);
    try {
      const res = await apiJson<{
        ok: boolean;
        sandbox: SubagentSandbox;
        verify1Passed: boolean;
        verify2Passed: boolean;
        detail: string;
      }>(`/api/swarm/sandboxes/${id}/mutate-test`, {
        method: 'POST',
        body: JSON.stringify({ injectCanarySecret }),
      });
      await Promise.all([loadOverview(), onRefreshBootstrap()]);
      const passedAll = res.verify1Passed && res.verify2Passed;
      pushToast({
        title: passedAll
          ? 'Dual Verify Gates Aprovados'
          : 'Bloqueado pelo AI-Defence / Verify Gate',
        detail: res.detail,
        tone: passedAll ? 'success' : 'warning',
      });
    } catch (err) {
      pushToast({ title: 'Erro no teste da sandbox', detail: (err as Error).message, tone: 'error' });
    } finally {
      setBusySandboxId(null);
    }
  };

  const handleRollback = async (id: string) => {
    setBusySandboxId(id);
    try {
      const res = await apiJson<{ restoredCount: number; shaVerified: boolean }>(
        `/api/swarm/sandboxes/${id}/rollback`,
        { method: 'POST' }
      );
      await Promise.all([loadOverview(), onRefreshBootstrap()]);
      pushToast({
        title: 'Rollback Atómico Concluído',
        detail: `${res.restoredCount} ficheiro(s) restaurados bit-a-bit (${
          res.shaVerified ? 'SHA-256 íntegro' : 'parcial'
        }).`,
        tone: 'info',
      });
    } catch (err) {
      pushToast({ title: 'Erro no rollback', detail: (err as Error).message, tone: 'error' });
    } finally {
      setBusySandboxId(null);
    }
  };

  const handleMerge = async (id: string) => {
    setBusySandboxId(id);
    try {
      await apiJson(`/api/swarm/sandboxes/${id}/merge`, { method: 'POST' });
      await Promise.all([loadOverview(), onRefreshBootstrap()]);
      pushToast({
        title: 'Sandbox promovida (MERGED)',
        detail: 'Todos os Verify Gates validados antes da promoção.',
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Promoção recusada pelo Verify Gate',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setBusySandboxId(null);
    }
  };

  const latestRun = overview?.swarmRuns[0];
  const visibleTasks = useMemo(() => {
    if (!latestRun) return [];
    if (!selectedLane) return latestRun.tasks;
    return latestRun.tasks.filter((t) => t.lane === selectedLane);
  }, [latestRun, selectedLane]);

  if (loading && !overview) {
    return (
      <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-8 text-center text-xs text-slate-400">
        A carregar motor assimétrico Swarm 48x e índice AST SCOUT-01...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Spatial 3D Agent Office + AST Heatmap */}
      <SwarmOffice3D
        latestRun={latestRun}
        fileHeatmap={overview?.scout.fileHeatmap || []}
        sandboxesCount={overview?.sandboxes.length || 0}
        selectedLane={selectedLane}
        onSelectLane={setSelectedLane}
        onSelectFile={(filePath) => {
          onOpenWorkspaceFile?.(filePath);
          pushToast({
            title: `Ficheiro AST aberto: ${filePath}`,
            detail: 'A inspecionar símbolos :Lstart-end e raio de explosão no Workspace.',
            tone: 'info',
          });
        }}
      />

      {/* Asymmetric Swarm Launcher + Live Metrics */}
      <section className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Orquestrador de Enxame Assimétrico (Swarm 24x / 48x)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              O <code className="text-cyan-300">SCOUT-01</code> constrói um mapa AST único em memória
              e distribui fatias isoladas por <code className="text-slate-300">UI · API · TESTS · DOCS</code>{' '}
              com 2 Verify Gates por tarefa.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenGraphReport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#151c26] border border-slate-700 text-cyan-300 rounded-lg hover:border-cyan-500/60 transition-colors whitespace-nowrap"
            >
              <FileCode2 className="w-3.5 h-3.5" />
              Ver GRAPH_REPORT.md
            </button>
            <button
              type="button"
              onClick={loadOverview}
              aria-label="Atualizar enxame"
              className="p-2 bg-[#151c26] border border-slate-800 text-slate-300 hover:text-white rounded-lg"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleLaunchSwarm} className="flex flex-col md:flex-row gap-3">
          <input
            type="text"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="Descreve a missão do enxame (ex.: Auditar rotas MCP, cobertura de testes e contratos UI)..."
            className="flex-1 px-3.5 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center p-0.5 bg-[#07090e] border border-slate-800 rounded-lg">
              {([24, 48] as const).map((scale) => (
                <button
                  key={scale}
                  type="button"
                  onClick={() => setWorkerScale(scale)}
                  className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${
                    workerScale === scale
                      ? 'bg-[#151c26] text-cyan-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {scale}x Workers
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={launching || !objective.trim()}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              {launching ? 'A executar enxame...' : `Disparar Swarm ${workerScale}x`}
            </button>
          </div>
        </form>

        {/* 4 Key Telemetry KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          <div className="p-3.5 rounded-lg bg-[#07090e] border border-slate-800/90 space-y-1">
            <p className="text-xs text-slate-400">Índice AST SCOUT-01</p>
            <p className="text-lg font-semibold font-mono tabular-nums text-cyan-300">
              {overview?.scout.symbolsCount ?? 0} símbolos
            </p>
            <p className="text-xs text-slate-500 font-mono tabular-nums">
              {overview?.scout.indexedFiles ?? 0} ficheiros · -85% leituras
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-[#07090e] border border-slate-800/90 space-y-1">
            <p className="text-xs text-slate-400">Dual Verify Gates</p>
            <p className="text-lg font-semibold font-mono tabular-nums text-emerald-400">
              {latestRun ? `${latestRun.verifyGatesPassed}/${latestRun.verifyGatesTotal}` : '96/96'}
            </p>
            <p className="text-xs text-slate-500 font-mono">AST Check + Unit/Canary Gate</p>
          </div>

          <div className="p-3.5 rounded-lg bg-[#07090e] border border-slate-800/90 space-y-1">
            <p className="text-xs text-slate-400">Convergência Ruflo EMA</p>
            <p className="text-lg font-semibold font-mono tabular-nums text-amber-300">
              {latestRun ? `${(latestRun.rufloConvergence * 100).toFixed(1)}%` : '96.4%'}
            </p>
            <p className="text-xs text-slate-500 font-mono">Feromonas anti-deriva ativas</p>
          </div>

          <div className="p-3.5 rounded-lg bg-[#07090e] border border-slate-800/90 space-y-1">
            <p className="text-xs text-slate-400">Sandboxes Transacionais CoW</p>
            <p className="text-lg font-semibold font-mono tabular-nums text-slate-100">
              {overview?.sandboxes.length ?? 0} isoladas
            </p>
            <p className="text-xs text-slate-500 font-mono">Snapshots zlib + SHA-256</p>
          </div>
        </div>
      </section>

      {/* Main Split: 48x Worker Lanes Matrix + Transactional CoW Sandboxes */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols: Asymmetric Lane Tasks */}
        <section className="lg:col-span-7 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                Matriz de Execução de Subagentes ({visibleTasks.length})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {latestRun?.scoutSummary || 'Mapa AST partilhado pronto.'}
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#07090e] border border-slate-800 rounded-lg">
              {(['ALL', 'UI', 'API', 'TESTS', 'DOCS'] as const).map((laneOpt) => {
                const active = (selectedLane ?? 'ALL') === laneOpt;
                return (
                  <button
                    key={laneOpt}
                    type="button"
                    onClick={() => setSelectedLane(laneOpt === 'ALL' ? null : laneOpt)}
                    className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors ${
                      active
                        ? 'bg-[#151c26] text-cyan-300 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {laneOpt}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="max-h-[430px] overflow-y-auto divide-y divide-slate-800/70 pr-1">
            {visibleTasks.map((task) => (
              <div
                key={task.id}
                className="py-3 first:pt-1 last:pb-0 flex items-start justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-xs font-mono text-cyan-300">{task.lane}</span>
                    <span className="text-xs font-medium text-slate-100 truncate">{task.title}</span>
                  </div>
                  <p className="text-xs text-slate-400 truncate">
                    {task.verify1?.summary} · {task.verify2?.summary}
                  </p>
                  <p className="text-[11px] font-mono tabular-nums text-slate-500 truncate">
                    {task.agentCallsign} · Alvo {task.targetFile} · Feromona{' '}
                    {(task.pheromoneScore * 100).toFixed(0)}% · {task.durationMs}ms
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px]">
                  <span className="px-2 py-0.5 rounded bg-[#151c26] border border-emerald-500/35 text-emerald-300">
                    V1:{task.verify1?.passed ? 'PASS' : 'FAIL'}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#151c26] border border-emerald-500/35 text-emerald-300">
                    V2:{task.verify2?.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Right 5 Cols: Copy-on-Write Subagent Sandboxes */}
        <section className="lg:col-span-5 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Sandboxes Copy-on-Write (CoW) & Rollback
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Cada sandbox guarda snapshots reais em <code className="text-cyan-300">zlib</code> e
              exige Verify Gates + AI-Defence antes de permitir Merge.
            </p>
          </div>

          <form onSubmit={handleCreateSandbox} className="flex gap-2">
            <input
              type="text"
              value={sandboxLabel}
              onChange={(e) => setSandboxLabel(e.target.value)}
              placeholder="Etiqueta da sandbox CoW..."
              className="flex-1 px-3 py-1.5 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={creatingSandbox}
              className="px-3 py-1.5 text-xs font-semibold bg-[#151c26] border border-cyan-500/50 text-cyan-300 rounded-lg hover:bg-cyan-500/15 whitespace-nowrap"
            >
              {creatingSandbox ? 'A criar...' : '+ Nova CoW'}
            </button>
          </form>

          <div className="space-y-3 max-h-[375px] overflow-y-auto pr-1">
            {(overview?.sandboxes || []).map((sb) => {
              const busy = busySandboxId === sb.id;
              const gatesOk = sb.verify1Passed && sb.verify2Passed;
              return (
                <div
                  key={sb.id}
                  className="p-3.5 rounded-lg bg-[#07090e] border border-slate-800 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-100 truncate">{sb.label}</p>
                      <p className="text-[11px] font-mono text-slate-500">
                        {sb.agentCallsign} · {sb.snapshots.length} snapshots SHA-256
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-[11px] font-mono rounded border shrink-0 ${
                        sb.status === 'MERGED' || (sb.status === 'ACTIVE' && gatesOk)
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                          : !gatesOk || sb.status === 'ROLLED_BACK'
                            ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                            : 'bg-[#151c26] border-slate-700 text-cyan-300'
                      }`}
                    >
                      {!gatesOk && sb.status === 'ACTIVE' ? 'GATE_ALERT' : sb.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">{sb.notes}</p>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      disabled={busy || sb.status === 'MERGED'}
                      onClick={() => handleMutateTest(sb.id, false)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#151c26] border border-slate-700 text-slate-200 rounded-md hover:border-cyan-500/50 disabled:opacity-40"
                    >
                      <Sparkles className="w-3 h-3 text-cyan-400" />
                      Validar Gates
                    </button>
                    <button
                      type="button"
                      disabled={busy || sb.status === 'MERGED'}
                      onClick={() => handleMutateTest(sb.id, true)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#151c26] border border-slate-700 text-amber-300 rounded-md hover:border-amber-500/50 disabled:opacity-40"
                    >
                      <ShieldAlert className="w-3 h-3" />
                      Simular Canary
                    </button>
                    <button
                      type="button"
                      disabled={busy || sb.status === 'MERGED'}
                      onClick={() => handleRollback(sb.id)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#151c26] border border-slate-700 text-rose-300 rounded-md hover:border-rose-500/50 disabled:opacity-40"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Rollback
                    </button>
                    {sb.status === 'ACTIVE' && gatesOk && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleMerge(sb.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-emerald-500 text-slate-950 rounded-md hover:bg-emerald-400 disabled:opacity-40"
                      >
                        <GitMerge className="w-3 h-3" />
                        Merge
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* GRAPH_REPORT.md Modal */}
      {reportOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Relatório Arquitetural GRAPH_REPORT.md"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
          onClick={() => setReportOpen(false)}
        >
          <div
            className="w-full max-w-3xl bg-[#0d1117] border border-slate-800 rounded-xl p-6 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-100 font-mono">
                  GRAPH_REPORT.md · SCOUT-01 AST & Git Co-Change
                </h3>
                <p className="text-xs text-slate-400">
                  Gerado deterministicamente a partir do código-fonte e histórico Git do workspace.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                aria-label="Fechar relatório"
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="p-4 rounded-lg bg-[#07090e] border border-slate-800 text-xs font-mono text-slate-300 max-h-[62vh] overflow-auto whitespace-pre-wrap leading-relaxed">
              {reportMarkdown}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
