import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Code2,
  Compass,
  GitPullRequest,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import { useToast } from '../ToastContext';
import type {
  AgentHandoff,
  BrainLiveStatus,
  DotsTask,
  FleetBroadcast,
  PromptForgeTemplate,
  QuotaTelemetry5h,
  SelfLearnCandidate,
  SwarmLane,
} from '../../shared/types';

interface McpCatalog {
  protocolVersion?: string;
  tools: {
    name: string;
    description: string;
    annotations?: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
    };
  }[];
  resources: { uri: string; name: string; description: string }[];
  resourceTemplates: { uriTemplate: string; name: string; description: string }[];
  prompts: { name: string; description: string }[];
}

interface OrbitOverviewPayload {
  dotsTasks: DotsTask[];
  handoffs: AgentHandoff[];
  fleetBroadcasts: FleetBroadcast[];
  promptForge: PromptForgeTemplate[];
  selfLearnQueue: SelfLearnCandidate[];
  quota5h: QuotaTelemetry5h;
  brain8765: BrainLiveStatus;
  mcpCatalog: McpCatalog;
}

interface OrbitViewProps {
  onRefreshBootstrap: () => Promise<void>;
}

type OrbitTabId = 'QUOTA' | 'DOTS' | 'FORGE' | 'MCP';

export const OrbitView: React.FC<OrbitViewProps> = ({ onRefreshBootstrap }) => {
  const { pushToast } = useToast();
  const [data, setData] = useState<OrbitOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<OrbitTabId>('QUOTA');

  // Hybrid bridge probe
  const [probingBridge, setProbingBridge] = useState(false);

  // DOTS & Broadcast form
  const [dotsTitle, setDotsTitle] = useState('');
  const [dotsLane, setDotsLane] = useState<SwarmLane>('API');
  const [broadcastDirective, setBroadcastDirective] = useState('');

  // Prompt Forge form
  const [forgeName, setForgeName] = useState('Diretiva TOON de Engenharia');
  const [forgeRawPrompt, setForgeRawPrompt] = useState(
    'Please make sure that you always carefully analyze the entire repository context in order to avoid breaking TypeScript imports and remember to verify tests.'
  );
  const [forging, setForging] = useState(false);

  // MCP JSON-RPC Console
  const [rpcPayload, setRpcPayload] = useState<string>(() =>
    JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'brain_prune_tools',
          arguments: { prompt: 'Auditar server.ts e verificar impacto AST' },
        },
      },
      null,
      2
    )
  );
  const [rpcResponse, setRpcResponse] = useState<string>(
    '// Clica em "Executar JSON-RPC" ou escolhe uma ferramenta MCP 2026 na lista.'
  );
  const [runningRpc, setRunningRpc] = useState(false);

  const loadOrbit = useCallback(async () => {
    try {
      const res = await apiJson<OrbitOverviewPayload>('/api/orbit/overview');
      setData(res);
    } catch (err) {
      pushToast({
        title: 'Erro ao carregar Orbit Agent OS',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    loadOrbit();
  }, [loadOrbit]);

  const handleProbeBridge = async () => {
    setProbingBridge(true);
    try {
      const res = await apiJson<{
        online: boolean;
        status: BrainLiveStatus;
        message: string;
      }>('/api/memories/sync-brain', {
        method: 'POST',
      });
      await Promise.all([loadOrbit(), onRefreshBootstrap()]);
      pushToast({
        title:
          res.status.mode === 'HYBRID_LIVE_8765'
            ? 'Ponte Híbrida :8765 Ativa'
            : 'Motor Nativo Autónomo Ativo',
        detail: res.message,
        tone: res.online ? 'success' : 'info',
      });
    } finally {
      setProbingBridge(false);
    }
  };

  const handleCreateDots = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dotsTitle.trim()) return;
    await apiJson('/api/orbit/dots', {
      method: 'POST',
      body: JSON.stringify({
        title: dotsTitle.trim(),
        lane: dotsLane,
        priority: 'P1',
      }),
    });
    setDotsTitle('');
    await Promise.all([loadOrbit(), onRefreshBootstrap()]);
    pushToast({ title: 'Tarefa DOTS (.dots/*.md) registada', tone: 'success' });
  };

  const handleCycleDotsStatus = async (task: DotsTask) => {
    const nextStatus =
      task.status === 'READY'
        ? 'IN_PROGRESS'
        : task.status === 'IN_PROGRESS'
          ? 'COMPLETED'
          : 'READY';
    await apiJson(`/api/orbit/dots/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus }),
    });
    await Promise.all([loadOrbit(), onRefreshBootstrap()]);
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastDirective.trim()) return;
    await apiJson('/api/orbit/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        directive: broadcastDirective.trim(),
      }),
    });
    setBroadcastDirective('');
    await Promise.all([loadOrbit(), onRefreshBootstrap()]);
    pushToast({
      title: 'Fleet Broadcast (HUMAN_WINS) emitido',
      detail: 'Propagado instantaneamente para as 4 lanes e especialistas.',
      tone: 'success',
    });
  };

  const handleDecideSelfLearn = async (id: string, decision: 'COMMIT' | 'DISCARD') => {
    await apiJson(`/api/orbit/self-learn/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
    await Promise.all([loadOrbit(), onRefreshBootstrap()]);
    pushToast({
      title:
        decision === 'COMMIT'
          ? 'Facto promovido ao Vault Bi-Temporal'
          : 'Candidato Self-Learn descartado',
      tone: decision === 'COMMIT' ? 'success' : 'info',
    });
  };

  const handleOptimizePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgeRawPrompt.trim() || forging) return;
    setForging(true);
    try {
      const res = await apiJson<{
        rawPrompt: string;
        toonOptimizedPrompt: string;
        tokenSavingsPercent: number;
      }>('/api/orbit/prompt-forge/optimize', {
        method: 'POST',
        body: JSON.stringify({
          name: forgeName.trim() || 'Template TOON',
          rawPrompt: forgeRawPrompt.trim(),
        }),
      });
      await Promise.all([loadOrbit(), onRefreshBootstrap()]);
      pushToast({
        title: `Prompt comprimido em -${res.tokenSavingsPercent}% tokens`,
        detail: res.toonOptimizedPrompt.slice(0, 90),
        tone: 'success',
      });
    } finally {
      setForging(false);
    }
  };

  const executeMcpRpc = async (overrideObj?: Record<string, unknown>) => {
    setRunningRpc(true);
    const bodyStr = overrideObj ? JSON.stringify(overrideObj, null, 2) : rpcPayload;
    if (overrideObj) setRpcPayload(bodyStr);
    const t0 = performance.now();
    try {
      const parsed = JSON.parse(bodyStr);
      const res = await apiJson<Record<string, unknown>>('/api/mcp', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      const elapsed = (performance.now() - t0).toFixed(1);
      setRpcResponse(`// HTTP 200 OK · ${elapsed}ms\n${JSON.stringify(res, null, 2)}`);
      await onRefreshBootstrap();
    } catch (err) {
      setRpcResponse(`// Erro JSON-RPC: ${(err as Error).message}`);
    } finally {
      setRunningRpc(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-8 text-center text-xs text-slate-400">
        A inicializar Orbit Agent OS & Servidor MCP 2026...
      </div>
    );
  }

  if (!data) return null;

  const { quota5h, brain8765, mcpCatalog } = data;
  const totalWindowTokens = Math.max(1, quota5h.consumedTokens5h + quota5h.savedByDietTokens5h);
  const savedRatioPct = Math.round((quota5h.savedByDietTokens5h / totalWindowTokens) * 100);
  const pendingSelfLearn = data.selfLearnQueue.filter((c) => c.status === 'PENDING');

  const stageItems = [
    { label: '1. Delta Memory Hash Cache', val: quota5h.stageSavings.deltaCacheTokens },
    { label: '2. Compressão Telegráfica TOON', val: quota5h.stageSavings.toonCompressionTokens },
    { label: '3. Mapa Partilhado SCOUT-01', val: quota5h.stageSavings.scoutMapTokens },
    { label: '4. Bypass MICRO_TICK (Zero-DB)', val: quota5h.stageSavings.microTickTokens },
    { label: '5. Poda Dinâmica de Tools MCP', val: quota5h.stageSavings.toolPruningTokens },
  ];
  const maxStageVal = Math.max(1, ...stageItems.map((s) => s.val));

  return (
    <div className="space-y-6">
      {/* Top Sub-Navigation & Hybrid Bridge Status */}
      <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 p-1 bg-[#07090e] border border-slate-800 rounded-lg overflow-x-auto">
          {(
            [
              ['QUOTA', 'Quota 5h & Ponte :8765', Activity],
              ['DOTS', `Grafo DOTS (${data.dotsTasks.length}) & Broadcast`, Compass],
              ['FORGE', `Self-Learn (${pendingSelfLearn.length}) & Prompt Forge`, Sparkles],
              ['MCP', `Servidor MCP 2026 (${mcpCatalog.tools.length} Tools)`, Server],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === id
                  ? 'bg-[#151c26] text-cyan-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={probingBridge}
          onClick={handleProbeBridge}
          className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-lg text-slate-200 hover:border-cyan-500/60 transition-colors whitespace-nowrap"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${probingBridge ? 'animate-spin' : ''}`} />
          <span>{brain8765.mode}</span>
        </button>
      </div>

      {/* TAB 1: QUOTA 5H, TOKEN DIET ROI & HYBRID BRIDGE :8765 */}
      {activeTab === 'QUOTA' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl bg-[#0d1117] border border-slate-800/80 space-y-1">
              <p className="text-xs text-slate-400">Tokens Poupados (5h Diet)</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-emerald-400">
                {quota5h.savedByDietTokens5h.toLocaleString('pt-PT')}
              </p>
              <p className="text-xs text-slate-500 font-mono">-{savedRatioPct}% overhead total</p>
            </div>

            <div className="p-5 rounded-xl bg-[#0d1117] border border-slate-800/80 space-y-1">
              <p className="text-xs text-slate-400">Consumo Efetivo (Janela 5h)</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-cyan-300">
                {quota5h.consumedTokens5h.toLocaleString('pt-PT')}
              </p>
              <p className="text-xs text-slate-500 font-mono">
                Orçamento {quota5h.budgetTokens5h.toLocaleString('pt-PT')}
              </p>
            </div>

            <div className="p-5 rounded-xl bg-[#0d1117] border border-slate-800/80 space-y-1">
              <p className="text-xs text-slate-400">ROI de Engenharia</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-amber-300">
                {quota5h.estimatedHoursSaved} h
              </p>
              <p className="text-xs text-slate-500 font-mono">Horas humanas poupadas</p>
            </div>

            <div className="p-5 rounded-xl bg-[#0d1117] border border-slate-800/80 space-y-1">
              <p className="text-xs text-slate-400">Taxa Verify Gates</p>
              <p className="text-2xl font-semibold font-mono tabular-nums text-slate-100">
                {quota5h.verifyGatePassRate}%
              </p>
              <p className="text-xs text-slate-500 font-mono">Zero regressões promovidas</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* 5-Stage Token Diet Breakdown */}
            <section className="lg:col-span-7 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-100">
                  Decomposição do Pipeline Token Diet (5 Estágios)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Compressão determinística pré-invocação aplicada pelo roteador reflexo{' '}
                  <code className="text-cyan-300">JEV-S1 (&lt;1ms)</code>.
                </p>
              </div>

              <div className="space-y-3.5">
                {stageItems.map((st) => {
                  const pct = Math.max(6, Math.round((st.val / maxStageVal) * 100));
                  return (
                    <div key={st.label} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-200 font-medium">{st.label}</span>
                        <span className="font-mono tabular-nums text-cyan-300">
                          -{st.val.toLocaleString('pt-PT')} tokens
                        </span>
                      </div>
                      <svg className="w-full h-2 rounded bg-[#151c26] overflow-hidden" aria-hidden="true">
                        <rect
                          x="0"
                          y="0"
                          width={`${pct}%`}
                          height="100%"
                          className="fill-cyan-500"
                        />
                      </svg>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Hybrid Bridge :8765 Live Card */}
            <section className="lg:col-span-5 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <h3 className="text-base font-semibold text-slate-100">
                  Ponte Viva Antigravity Brain v7.2 (:8765)
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {brain8765.httpOnline
                    ? `Ligação HTTP ativa com ${brain8765.endpointUrl} (${brain8765.remoteMemoryCount} memórias remotas).`
                    : 'Motores v7.2 ativos nativamente no Jarvis; liga automaticamente à porta :8765 assim que disponível.'}
                </p>

                <div className="p-3.5 rounded-lg bg-[#07090e] border border-slate-800 space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Endpoint</span>
                    <span className="text-cyan-300">{brain8765.endpointUrl}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Modo Operacional</span>
                    <span className="text-emerald-400">{brain8765.mode}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Latência Sonda</span>
                    <span className="text-slate-200">{brain8765.latencyMs} ms</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">SQLite WAL brain.db</span>
                    <span className="text-slate-200">
                      {brain8765.sqliteWalDetected ? 'Detetado (Read-Only Sync)' : 'Store Nativo Local'}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-500">
                Quando corres o Antigravity Brain localmente na porta <code className="text-slate-300">8765</code>,
                o Jarvis sincroniza automaticamente os factos semânticos mantendo 100% de autonomia Cloud Run.
              </p>
            </section>
          </div>
        </div>
      )}

      {/* TAB 2: DOTS DAG & FLEET BROADCAST + HANDOFFS */}
      {activeTab === 'DOTS' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                Grafo de Tarefas DOTS (<code className="text-cyan-300">.dots/*.md</code>)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Clica no estado de qualquer nó DOTS para avançar{' '}
                <code className="text-slate-300">READY → IN_PROGRESS → COMPLETED</code>.
              </p>
            </div>

            <form onSubmit={handleCreateDots} className="flex flex-wrap gap-2">
              <input
                type="text"
                value={dotsTitle}
                onChange={(e) => setDotsTitle(e.target.value)}
                placeholder="Nova tarefa DOTS (ex.: Validar poda de tools MCP em DevOps)..."
                className="flex-1 min-w-52 px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
              />
              <select
                value={dotsLane}
                onChange={(e) => setDotsLane(e.target.value as SwarmLane)}
                className="px-3 py-2 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-200"
              >
                <option value="UI">UI</option>
                <option value="API">API</option>
                <option value="TESTS">TESTS</option>
                <option value="DOCS">DOCS</option>
              </select>
              <button
                type="submit"
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Criar DOTS
              </button>
            </form>

            <div className="divide-y divide-slate-800/70">
              {data.dotsTasks.map((task) => (
                <div
                  key={task.id}
                  className="py-3.5 first:pt-1 last:pb-0 flex items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-cyan-300">[{task.lane}]</span>
                      <p className="text-sm font-medium text-slate-100 truncate">{task.title}</p>
                    </div>
                    <p className="text-xs font-mono text-slate-500 truncate">
                      {task.slug} · Agente {task.assignedAgent} · Prioridade {task.priority}
                      {task.dependsOn.length > 0 ? ` · Depende de ${task.dependsOn.join(', ')}` : ''}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCycleDotsStatus(task)}
                    className={`px-3 py-1 text-xs font-mono rounded-md border shrink-0 transition-colors ${
                      task.status === 'COMPLETED'
                        ? 'bg-emerald-500/12 border-emerald-500/40 text-emerald-300'
                        : task.status === 'IN_PROGRESS'
                          ? 'bg-cyan-500/12 border-cyan-500/40 text-cyan-300'
                          : 'bg-[#151c26] border-slate-700 text-slate-300 hover:border-cyan-500/50'
                    }`}
                  >
                    {task.status}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="lg:col-span-5 space-y-6">
            {/* Fleet Broadcast HUMAN_WINS */}
            <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Radio className="w-4 h-4 text-amber-400" />
                  Fleet Broadcast (<code className="text-amber-300">HUMAN_WINS</code>)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Sobrepõe diretivas humanas imediatamente em todos os agentes em execução.
                </p>
              </div>

              <form onSubmit={handleSendBroadcast} className="space-y-2.5">
                <textarea
                  rows={2}
                  value={broadcastDirective}
                  onChange={(e) => setBroadcastDirective(e.target.value)}
                  placeholder="Diretiva global para toda a frota (ex.: Congelar mutações externas e priorizar testes)..."
                  className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 text-xs font-semibold bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 whitespace-nowrap"
                  >
                    Emitir Broadcast HUMAN_WINS
                  </button>
                </div>
              </form>

              <div className="space-y-2 max-h-40 overflow-y-auto pt-2 border-t border-slate-800/80">
                {data.fleetBroadcasts.map((fb) => (
                  <div key={fb.id} className="p-2.5 rounded-lg bg-[#07090e] border border-slate-800 text-xs">
                    <div className="flex items-center justify-between font-mono text-[11px] text-amber-300">
                      <span>{fb.priority}</span>
                      <span>{fb.acknowledgedBy.length} agentes ACK</span>
                    </div>
                    <p className="text-slate-200 mt-1">{fb.directive}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Agent-to-Agent Handoffs */}
            <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-3">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <GitPullRequest className="w-4 h-4 text-cyan-400" />
                Hand-offs Estruturados entre Agentes (TOON)
              </h3>
              <div className="space-y-2.5 max-h-56 overflow-y-auto">
                {data.handoffs.map((ho) => (
                  <div key={ho.id} className="p-3 rounded-lg bg-[#07090e] border border-slate-800 space-y-1 text-xs">
                    <div className="flex items-center justify-between font-mono text-cyan-300">
                      <span>
                        {ho.fromAgent} → {ho.toAgent}
                      </span>
                      <span className="text-emerald-400">{ho.status}</span>
                    </div>
                    <p className="text-slate-200 font-medium">{ho.taskRef}</p>
                    <p className="font-mono text-[11px] text-slate-400">{ho.contextToon}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: SELF-LEARN STUDIO & PROMPT FORGE */}
      {activeTab === 'FORGE' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Self-Learn Queue */}
          <section className="lg:col-span-6 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Self-Learn Studio (Extração Pós-Turno + AI-Defence)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Factos colhidos automaticamente das conversas após filtragem de segredos/chaves API.
              </p>
            </div>

            <div className="space-y-3 max-h-[430px] overflow-y-auto pr-1">
              {data.selfLearnQueue.map((item) => (
                <div
                  key={item.id}
                  className="p-3.5 rounded-lg bg-[#07090e] border border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-100 truncate">
                      {item.topic}
                    </span>
                    <span className="text-[11px] font-mono text-cyan-300 shrink-0">
                      [{item.suggestedTier[0]}] · {item.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{item.extractedFact}</p>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] font-mono text-slate-500">
                      {item.suggestedCategory} ·{' '}
                      {item.redactedSecretsCount > 0
                        ? `${item.redactedSecretsCount} segredo(s) redigido(s) pelo AI-Defence`
                        : '0 segredos expostos'}
                    </span>
                    {item.status === 'PENDING' && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDecideSelfLearn(item.id, 'COMMIT')}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-emerald-500 text-slate-950 rounded-md hover:bg-emerald-400"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Promover
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecideSelfLearn(item.id, 'DISCARD')}
                          aria-label="Descartar candidato"
                          className="p-1.5 rounded-md bg-[#151c26] border border-slate-700 text-slate-400 hover:text-rose-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Prompt Forge TOON Optimizer */}
          <section className="lg:col-span-6 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                Prompt Forge · Compressor Telegráfico TOON
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Converte instruções verbosas em notação orientada a tokens (<code className="text-cyan-300">TOON</code>).
              </p>
            </div>

            <form onSubmit={handleOptimizePrompt} className="space-y-3">
              <input
                type="text"
                value={forgeName}
                onChange={(e) => setForgeName(e.target.value)}
                placeholder="Nome do template..."
                className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
              />
              <textarea
                rows={3}
                value={forgeRawPrompt}
                onChange={(e) => setForgeRawPrompt(e.target.value)}
                placeholder="Cola aqui um system prompt longo para comprimir..."
                className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                disabled={forging}
                className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400"
              >
                {forging ? 'A comprimir...' : 'Otimizar para TOON'}
              </button>
            </form>

            <div className="space-y-2.5 max-h-60 overflow-y-auto pt-2 border-t border-slate-800/80">
              {data.promptForge.map((tpl) => (
                <div key={tpl.id} className="p-3 rounded-lg bg-[#07090e] border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-100">{tpl.name}</span>
                    <span className="font-mono text-emerald-400">
                      -{tpl.tokenSavingsPercent}% tokens · {tpl.category}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-cyan-300">{tpl.toonOptimizedPrompt}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* TAB 4: NATIVE MCP 2026 SERVER & JSON-RPC INSPECTOR */}
      {activeTab === 'MCP' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Annotated 18 MCP Tools Catalog */}
          <section className="lg:col-span-6 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-cyan-400" />
                  Catálogo MCP 2026 ({mcpCatalog.tools.length} Tools · {mcpCatalog.resources.length} Resources)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Clica em qualquer ferramenta para executar uma chamada JSON-RPC 2.0 real.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {mcpCatalog.protocolVersion || '2026-03'}
              </span>
            </div>

            <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1">
              {mcpCatalog.tools.map((tool) => (
                <button
                  key={tool.name}
                  type="button"
                  onClick={() =>
                    executeMcpRpc({
                      jsonrpc: '2.0',
                      id: Date.now() % 10000,
                      method: 'tools/call',
                      params: { name: tool.name, arguments: {} },
                    })
                  }
                  className="w-full p-3 rounded-lg bg-[#07090e] border border-slate-800 hover:border-cyan-500/50 text-left space-y-1 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-xs">
                    <span className="text-cyan-300 font-semibold">{tool.name}</span>
                    <span className="text-[11px] text-slate-500">
                      {tool.annotations?.readOnlyHint ? 'readOnly' : 'mutating'}
                      {tool.annotations?.idempotentHint ? ' · idempotent' : ''}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{tool.description}</p>
                </button>
              ))}
            </div>
          </section>

          {/* Live JSON-RPC 2.0 Test Bench */}
          <section className="lg:col-span-6 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-100">
                Consola Interativa JSON-RPC 2.0 (<code className="text-cyan-300">POST /api/mcp</code>)
              </h3>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    executeMcpRpc({
                      jsonrpc: '2.0',
                      id: 10,
                      method: 'resources/read',
                      params: { uri: 'brain://status' },
                    })
                  }
                  className="px-2.5 py-1 text-xs font-mono bg-[#151c26] border border-slate-800 rounded-md text-slate-300 hover:border-cyan-500/50"
                >
                  brain://status
                </button>
                <button
                  type="button"
                  onClick={() =>
                    executeMcpRpc({
                      jsonrpc: '2.0',
                      id: 11,
                      method: 'tools/call',
                      params: { name: 'search_brain', arguments: { query: 'arquitetura' } },
                    })
                  }
                  className="px-2.5 py-1 text-xs font-mono bg-[#151c26] border border-slate-800 rounded-md text-slate-300 hover:border-cyan-500/50"
                >
                  search_brain
                </button>
                <button
                  type="button"
                  onClick={() =>
                    executeMcpRpc({
                      jsonrpc: '2.0',
                      id: 12,
                      method: 'prompts/get',
                      params: {
                        name: 'swarm-dispatch',
                        arguments: { feature: 'Auditar Cortex v3.0' },
                      },
                    })
                  }
                  className="px-2.5 py-1 text-xs font-mono bg-[#151c26] border border-slate-800 rounded-md text-slate-300 hover:border-cyan-500/50"
                >
                  Prompt Swarm
                </button>
              </div>
            </div>

            <textarea
              rows={7}
              value={rpcPayload}
              onChange={(e) => setRpcPayload(e.target.value)}
              className="w-full p-3 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500"
            />

            <div className="flex justify-end">
              <button
                type="button"
                disabled={runningRpc}
                onClick={() => executeMcpRpc()}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                {runningRpc ? 'A invocar MCP...' : 'Executar JSON-RPC'}
              </button>
            </div>

            <pre className="p-3.5 rounded-lg bg-[#07090e] border border-slate-800 text-xs font-mono text-emerald-300 max-h-60 overflow-auto whitespace-pre-wrap">
              {rpcResponse}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
};
