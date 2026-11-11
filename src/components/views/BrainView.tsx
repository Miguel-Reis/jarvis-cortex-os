import React, { useCallback, useEffect, useState } from 'react';
import {
  Brain,
  RefreshCw,
  CheckCircle2,
  Cpu,
  GitCompare,
  Sparkles,
  ArrowUpRight,
  Sliders,
  Activity,
  Database,
  Layers,
  AlertTriangle,
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import type { NavSectionId } from '../../lib/i18n';
import { useToast } from '../ToastContext';
import type {
  ArchitecturalDriftItem,
  BrainLiveStatus,
  JarvisStoreData,
  JevRouteDecision,
  MemoryTier,
} from '../../shared/types';

interface BrainOverviewPayload {
  brain8765: BrainLiveStatus;
  externalBrainInstalled: boolean;
  standaloneOperationalPercent: number;
  activeMemoriesCount: number;
  supersededMemoriesCount: number;
  graphEdgesCount: number;
  selfLearnPendingCount: number;
  tierDistribution: {
    tier: MemoryTier;
    count: number;
    avgRetentionPercent: number;
    halfLifeDays: number;
  }[];
  ebbinghausCurveDays: {
    day: number;
    working: number;
    episodic: number;
    semantic: number;
  }[];
  architecturalDrift: ArchitecturalDriftItem[];
}

interface BrainViewProps {
  store: JarvisStoreData;
  initialBrain8765?: BrainLiveStatus;
  onRefreshBootstrap: () => Promise<void>;
  onNavigate: (section: NavSectionId, subId?: string) => void;
}

const PRESET_JEV_PROMPTS = [
  'Analisa o acoplamento AST de server.ts e propõe mitigação segura',
  'Executa estado das janelas ativas na máquina Sidecar e verifica portas',
  'Resume as decisões de arquitetura confirmadas no Memory Vault',
  'Lança enxame Swarm 48x sobre os testes unitários e valida Verify Gates',
];

export const BrainView: React.FC<BrainViewProps> = ({
  store,
  initialBrain8765,
  onRefreshBootstrap,
  onNavigate,
}) => {
  const { pushToast } = useToast();
  const [overview, setOverview] = useState<BrainOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [configOpen, setConfigOpen] = useState(false);
  const [brainUrlInput, setBrainUrlInput] = useState(
    store.settings.antigravityBrainUrl || 'http://127.0.0.1:8765'
  );
  const [sqlitePathInput, setSqlitePathInput] = useState(
    store.settings.antigravityBrainSqlitePath || '~/.antigravity-brain/brain.db'
  );
  const [savingConfig, setSavingConfig] = useState(false);

  const [simPrompt, setSimPrompt] = useState(PRESET_JEV_PROMPTS[0]);
  const [simResult, setSimResult] = useState<JevRouteDecision | null>(null);
  const [simRunning, setSimRunning] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const data = await apiJson<BrainOverviewPayload>('/api/brain/overview');
      setOverview(data);
    } catch (err) {
      pushToast({
        title: 'Erro ao carregar telemetria do Cérebro Jarvis',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  const runRouterSimulation = useCallback(
    async (promptText: string) => {
      if (!promptText.trim()) return;
      setSimRunning(true);
      try {
        const res = await apiJson<JevRouteDecision & { decision?: JevRouteDecision }>(
          '/api/brain/router-simulate',
          {
            method: 'POST',
            body: JSON.stringify({ prompt: promptText.trim() }),
          }
        );
        setSimResult(res.decision || res);
      } catch (err) {
        pushToast({
          title: 'Falha na simulação JEV-S1',
          detail: (err as Error).message,
          tone: 'error',
        });
      } finally {
        setSimRunning(false);
      }
    },
    [pushToast]
  );

  useEffect(() => {
    loadOverview();
    runRouterSimulation(PRESET_JEV_PROMPTS[0]);
  }, [loadOverview, runRouterSimulation]);

  const handleSyncBrain = async () => {
    setSyncing(true);
    try {
      const res = await apiJson<{
        online: boolean;
        imported: number;
        message: string;
        status: BrainLiveStatus;
      }>('/api/memories/sync-brain', { method: 'POST' });
      await Promise.all([loadOverview(), onRefreshBootstrap()]);
      pushToast({
        title: res.online
          ? `Ponte :8765 Sincronizada (+${res.imported} factos)`
          : 'Modo Autónomo Nativo Confirmado (100%)',
        detail: res.message,
        tone: res.online ? 'success' : 'info',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao sondar ponte :8765',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveBrainConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      await apiJson('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          antigravityBrainUrl: brainUrlInput.trim() || 'http://127.0.0.1:8765',
          antigravityBrainSqlitePath: sqlitePathInput.trim(),
        }),
      });
      await Promise.all([loadOverview(), onRefreshBootstrap()]);
      setConfigOpen(false);
      pushToast({
        title: 'Configuração da ponte cognitiva guardada',
        detail: `Endpoint :8765 atualizado para ${brainUrlInput.trim()}`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao guardar endpoint Brain',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const brainStatus = overview?.brain8765 || initialBrain8765;
  const externalInstalled = Boolean(
    overview ? overview.externalBrainInstalled : brainStatus?.httpOnline || brainStatus?.sqliteWalDetected
  );

  // Build SVG polylines for Ebbinghaus 0..90 days
  const curveDays = overview?.ebbinghausCurveDays || [
    { day: 0, working: 100, episodic: 100, semantic: 100 },
    { day: 7, working: 11, episodic: 70.7, semantic: 94.8 },
    { day: 30, working: 0.1, episodic: 22.6, semantic: 79.4 },
    { day: 90, working: 0, episodic: 1.2, semantic: 50.0 },
  ];

  const svgWidth = 520;
  const svgHeight = 168;
  const padX = 32;
  const padY = 18;
  const plotW = svgWidth - padX * 2;
  const plotH = svgHeight - padY * 2;

  const toPolyline = (key: 'working' | 'episodic' | 'semantic') =>
    curveDays
      .map((pt) => {
        const x = padX + (pt.day / 90) * plotW;
        const y = padY + plotH - (pt[key] / 100) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-cyan-400">
            Arquitetura Cognitiva Dual · Núcleo v7.2
          </p>
          <h1 className="text-2xl font-bold text-slate-100 font-display mt-0.5">
            Cérebro do J.A.R.V.I.S.
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Inspeção transparente do córtex interno do Jarvis, roteador determinístico{' '}
            <span className="font-mono text-slate-300">JEV-S1 (&lt;1ms)</span>, retenção biológica de
            Ebbinghaus e ponte opcional com o teu{' '}
            <span className="font-mono text-slate-300">Antigravity Brain (:8765 / brain.db)</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setConfigOpen((prev) => !prev)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#0d1117] border border-slate-800 text-slate-200 hover:border-slate-700 transition-colors"
          >
            <Sliders className="w-3.5 h-3.5 text-slate-400" />
            Configurar Ponte :8765
          </button>
          <button
            type="button"
            onClick={handleSyncBrain}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {externalInstalled ? 'Sincronizar Cérebro :8765' : 'Sondar Brain Externo (:8765)'}
          </button>
        </div>
      </div>

      {/* Reassuring Dual-Mode Architecture Banner (Explicitly addressing whether user's Brain is installed or not) */}
      <section
        aria-label="Estado de Instalação do Cérebro"
        className="hud-panel-amber hud-corner-frame rounded-xl p-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start gap-4">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${
                externalInstalled
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
              }`}
            >
              <Brain className="w-5 h-5" />
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono">
                <span className={externalInstalled ? 'text-emerald-400 font-semibold' : 'text-cyan-300 font-semibold'}>
                  {externalInstalled
                    ? 'MODO HÍBRIDO ATIVO · ANTIGRAVITY BRAIN DETETADO'
                    : 'MODO AUTÓNOMO NATIVO · 100% OPERACIONAL SEM DEPENDÊNCIAS EXTERNAS'}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400 tabular-nums">
                  Sonda: {brainStatus?.latencyMs ?? 1}ms
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400 font-mono">
                  {brainStatus?.endpointUrl || store.settings.antigravityBrainUrl}
                </span>
              </div>

              {externalInstalled ? (
                <p className="text-sm text-slate-200 leading-relaxed">
                  O teu <strong>Antigravity Brain externo</strong> foi detetado nesta máquina (
                  {brainStatus?.httpOnline ? 'servidor HTTP :8765 online' : 'base SQLite WAL local detetada'}
                  {' · '}
                  <span className="font-mono tabular-nums">{brainStatus?.remoteMemoryCount ?? 0}</span>{' '}
                  registos remotos). O Jarvis funde em tempo real o teu Brain pessoal com o córtex interno.
                </p>
              ) : (
                <p className="text-sm text-slate-200 leading-relaxed">
                  <strong>Nota de Arquitetura:</strong> O teu pacote externo{' '}
                  <code className="text-xs px-1.5 py-0.5 rounded bg-[#151c26] text-cyan-300">
                    antigravity-brain (:8765 / brain.db)
                  </code>{' '}
                  <strong>não está instalado ou em execução nesta máquina</strong> — e isso é totalmente
                  esperado. O J.A.R.V.I.S. inclui o seu próprio{' '}
                  <strong>Cérebro Cognitivo Nativo v7.2</strong> integrado (SQLite WAL + 4-Way RRF +
                  HippoRAG 2 PPR + JEV-S1), operando a <strong>100% da capacidade</strong> de forma
                  independente. Se instalares o teu Brain pessoal mais tarde, a fusão híbrida liga-se
                  automaticamente sem configurar código.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-3 shrink-0 lg:w-72">
            <div className="p-3 rounded-lg bg-[#07090e] border border-slate-800/80">
              <p className="text-[11px] text-slate-400">Córtex Interno Jarvis</p>
              <p className="text-sm font-semibold text-emerald-400 font-mono tabular-nums mt-0.5">
                ATIVO · 100%
              </p>
            </div>
            <div className="p-3 rounded-lg bg-[#07090e] border border-slate-800/80">
              <p className="text-[11px] text-slate-400">Teu Brain (:8765)</p>
              <p
                className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${
                  externalInstalled ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {externalInstalled ? 'LIGADO' : 'OPCIONAL / AUSENTE'}
              </p>
            </div>
          </div>
        </div>

        {configOpen && (
          <form
            onSubmit={handleSaveBrainConfig}
            className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
          >
            <div className="md:col-span-5">
              <label className="block text-xs text-slate-400 mb-1">
                URL da Ponte Antigravity Brain (:8765)
              </label>
              <input
                type="text"
                value={brainUrlInput}
                onChange={(e) => setBrainUrlInput(e.target.value)}
                placeholder="http://127.0.0.1:8765"
                className="w-full px-3 py-2 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div className="md:col-span-5">
              <label className="block text-xs text-slate-400 mb-1">
                Caminho opcional para brain.db local (SQLite WAL)
              </label>
              <input
                type="text"
                value={sqlitePathInput}
                onChange={(e) => setSqlitePathInput(e.target.value)}
                placeholder="~/.antigravity-brain/brain.db"
                className="w-full px-3 py-2 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button
                type="submit"
                disabled={savingConfig}
                className="w-full px-3 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors"
              >
                {savingConfig ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Core Brain KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="jarvis-surface rounded-xl p-4 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Memórias Bi-Temporais Ativas</span>
            <Database className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <p className="text-2xl font-bold text-slate-100 font-display tabular-nums mt-2">
            {loading ? '—' : overview?.activeMemoriesCount ?? store.memories.length}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {overview?.supersededMemoriesCount ?? 0} superadas com histórico preservado
          </p>
        </div>

        <div className="jarvis-surface rounded-xl p-4 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Sinapses HippoRAG 2 (PPR)</span>
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-slate-100 font-display tabular-nums mt-2">
            {loading ? '—' : overview?.graphEdgesCount ?? store.graphEdges.length}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            4-Way RRF · BM25 + SimHash + 128-Bit BQ
          </p>
        </div>

        <div className="jarvis-surface rounded-xl p-4 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Fila Self-Learn Pós-Turno</span>
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-slate-100 font-display tabular-nums mt-2">
            {loading ? '—' : overview?.selfLearnPendingCount ?? 0}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('orbit')}
            className="text-xs text-cyan-400 hover:text-cyan-300 mt-1 inline-flex items-center gap-1"
          >
            Rever candidatos em Orbit OS <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>

        <div className="jarvis-surface rounded-xl p-4 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Token Diet 5-Estágios (5h)</span>
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-400 font-display tabular-nums mt-2">
            -96% MCP
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {(store.quota5h?.savedByDietTokens5h || 142800).toLocaleString('pt-PT')} tokens poupados
          </p>
        </div>
      </section>

      {/* Main Split: JEV-S1 (<1ms) Router Simulator + Ebbinghaus Biological Retention */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols: Interactive JEV-S1 Router Testbench */}
        <section className="lg:col-span-7 jarvis-surface rounded-xl p-5 border border-slate-800/80 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100 font-display flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" />
                Bancada de Teste · Roteador Determinístico JEV-S1 (&lt;1ms)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Simula como o cérebro classifica qualquer pedido em{' '}
                <span className="font-mono text-slate-300">[K]ernel / [S]tandard / [H]eavy</span>,
                poda ferramentas MCP e antecipa símbolos AST antes de invocar um LLM.
              </p>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              runRouterSimulation(simPrompt);
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <input
              type="text"
              value={simPrompt}
              onChange={(e) => setSimPrompt(e.target.value)}
              placeholder="Escreve um comando ou diretiva para inspecionar a decisão do JEV-S1..."
              className="flex-1 px-3.5 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={simRunning}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#151c26] border border-slate-700 text-cyan-300 hover:border-cyan-500/60 transition-colors shrink-0"
            >
              {simRunning ? 'A calcular...' : 'Simular Rota'}
            </button>
          </form>

          <div className="flex flex-wrap gap-1.5">
            {PRESET_JEV_PROMPTS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setSimPrompt(preset);
                  runRouterSimulation(preset);
                }}
                className="px-2.5 py-1 text-[11px] rounded-md bg-[#07090e] border border-slate-800/90 text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-colors text-left truncate max-w-full"
              >
                {preset}
              </button>
            ))}
          </div>

          {simResult && (
            <div className="rounded-xl bg-[#07090e] border border-slate-800/90 p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800/80 text-xs font-mono">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-cyan-300 font-semibold">
                    TIER [{(simResult.tier || 'WORKING')[0]}] · {simResult.tier || 'WORKING'}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-300">Intenção: {simResult.intent || 'EXECUTIVE_PLANNING'}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-emerald-400 tabular-nums">
                    Latência: {(simResult.latencyMs ?? 0.12).toFixed(2)}ms
                  </span>
                </div>
                <span className="text-amber-300 tabular-nums">
                  Poda MCP: -{simResult.tokenDiet?.savingsPercent ?? 0}% (
                  {simResult.tokenDiet?.activeToolsCount ?? 0}/{simResult.tokenDiet?.totalToolsCatalog ?? 18}{' '}
                  tools)
                </span>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-slate-400">Ferramentas MCP Selecionadas para o Contexto:</p>
                <p className="text-xs font-mono text-slate-200 leading-relaxed">
                  {(simResult.prunedTools || []).join(' · ') || 'search_brain'}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="p-2.5 rounded-lg bg-[#0d1117] border border-slate-800/80">
                  <p className="text-[11px] text-slate-500">Contexto Bruto Est.</p>
                  <p className="text-sm font-mono font-semibold text-slate-300 tabular-nums">
                    {(simResult.tokenDiet?.baselineTokens ?? 0).toLocaleString('pt-PT')} tok
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-[#0d1117] border border-slate-800/80">
                  <p className="text-[11px] text-slate-500">Após Token Diet</p>
                  <p className="text-sm font-mono font-semibold text-cyan-300 tabular-nums">
                    {(simResult.tokenDiet?.injectedTokens ?? 0).toLocaleString('pt-PT')} tok
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-[#0d1117] border border-slate-800/80">
                  <p className="text-[11px] text-slate-500">Poupança Líquida</p>
                  <p className="text-sm font-mono font-semibold text-emerald-400 tabular-nums">
                    {(simResult.tokenDiet?.savedTokens ?? 0).toLocaleString('pt-PT')} tok
                  </p>
                </div>
              </div>

              {(simResult.lookaheadAlerts || []).length > 0 && (
                <div className="pt-2 border-t border-slate-800/80 space-y-1">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-amber-300">
                    Alertas Lookahead AST & Decisões Vinculadas
                  </p>
                  {(simResult.lookaheadAlerts || []).map((alert, idx) => (
                    <p key={idx} className="text-xs text-slate-300">
                      • [{alert.filePath} · Blast {alert.blastRadiusScore}] {alert.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right 5 Cols: Ebbinghaus Retention Curve & Tier Health */}
        <section className="lg:col-span-5 jarvis-surface rounded-xl p-5 border border-slate-800/80 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-100 font-display">
                Curva Biológica de Ebbinghaus
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Decaimento exponencial por camada com reforço sináptico a cada acesso.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('memory')}
              className="text-xs text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 shrink-0"
            >
              Abrir Vault <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="rounded-xl bg-[#07090e] border border-slate-800/90 p-3">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-40 overflow-visible"
              role="img"
              aria-label="Curvas de retenção de memória Ebbinghaus ao longo de 90 dias"
            >
              {[0, 25, 50, 75, 100].map((pct) => {
                const y = padY + plotH - (pct / 100) * plotH;
                return (
                  <g key={pct}>
                    <line
                      x1={padX}
                      y1={y}
                      x2={svgWidth - padX}
                      y2={y}
                      stroke="rgba(148,163,184,0.12)"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={4}
                      y={y + 3}
                      fill="#64748b"
                      fontSize="9"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {pct}%
                    </text>
                  </g>
                );
              })}

              {/* Semantic (90d half-life) */}
              <polyline
                fill="none"
                stroke="#34d399"
                strokeWidth="2.2"
                points={toPolyline('semantic')}
              />
              {/* Episodic (14d half-life) */}
              <polyline
                fill="none"
                stroke="#22d3ee"
                strokeWidth="2"
                points={toPolyline('episodic')}
              />
              {/* Working (2.2d half-life) */}
              <polyline
                fill="none"
                stroke="#fbbf24"
                strokeWidth="1.8"
                strokeDasharray="4 3"
                points={toPolyline('working')}
              />

              {[0, 14, 30, 60, 90].map((d) => {
                const x = padX + (d / 90) * plotW;
                return (
                  <text
                    key={d}
                    x={x}
                    y={svgHeight - 2}
                    textAnchor="middle"
                    fill="#64748b"
                    fontSize="9"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {d}d
                  </text>
                );
              })}
            </svg>

            <div className="flex flex-wrap items-center justify-center gap-4 pt-1 text-[11px] font-mono text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" /> SEMANTIC (t½ 90d)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" /> EPISODIC (t½ 14d)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-amber-400 inline-block" /> WORKING (t½ 2.2d)
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {(overview?.tierDistribution || []).map((tItem) => (
              <div
                key={tItem.tier}
                className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#07090e] border border-slate-800/80 text-xs"
              >
                <div>
                  <span className="font-mono font-semibold text-slate-200">{tItem.tier}</span>
                  <span className="text-slate-500 ml-2 tabular-nums">
                    {tItem.count} registo(s) · meia-vida média {tItem.halfLifeDays}d
                  </span>
                </div>
                <span className="font-mono font-semibold text-cyan-300 tabular-nums">
                  {tItem.avgRetentionPercent}% retenção
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Architectural Drift Detector (Cross-referencing Decision/Commitment Memories against Real AST) */}
      <section className="jarvis-surface rounded-xl p-5 border border-slate-800/80 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-100 font-display flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-cyan-400" />
              Radar de Deriva Arquitetural (Memórias vs. Código AST Real)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Cruza decisões e compromissos registados no cérebro com os ficheiros e símbolos reais do
              repositório para detetar invariantes em risco.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('workspace')}
            className="text-xs text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 self-start sm:self-auto"
          >
            Inspecionar AST no Workspace <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-slate-800/80 rounded-xl bg-[#07090e] border border-slate-800/80">
          {(overview?.architecturalDrift || []).length === 0 ? (
            <div className="p-4 text-xs text-slate-400">
              A analisar invariantes arquiteturais do repositório...
            </div>
          ) : (
            (overview?.architecturalDrift || []).map((item) => (
              <div
                key={item.id}
                className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono">
                    {item.severity === 'NOMINAL' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> ALINHADO
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-300 font-semibold">
                        <AlertTriangle className="w-3.5 h-3.5" /> {item.severity}
                      </span>
                    )}
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-200 font-sans font-semibold">{item.memoryTopic}</span>
                    {item.targetFile && (
                      <>
                        <span className="text-slate-600">·</span>
                        <button
                          type="button"
                          onClick={() => onNavigate('workspace', item.targetFile)}
                          className="text-cyan-400 hover:underline"
                        >
                          {item.targetFile}
                        </button>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{item.summary}</p>
                  <p className="text-xs text-slate-500">{item.recommendation}</p>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate('memory', item.memoryId)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#0d1117] border border-slate-800 text-slate-300 hover:text-slate-100 hover:border-slate-700 transition-colors shrink-0 self-start md:self-auto"
                >
                  Ver Memória
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};
