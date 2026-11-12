import React, { useEffect, useState } from 'react';
import {
  Volume2,
  RefreshCw,
  Play,
  CheckCircle2,
  Clock,
  AlertCircle,
  Plus,
  ArrowUpRight,
  Sparkles,
  FolderGit2,
  Brain,
  Check,
  X,
  ShieldCheck,
  GitBranch,
  ChevronRight,
  Target,
  Workflow,
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import { markViiAudio } from '../../lib/audio-dsp';
import { t, type NavSectionId } from '../../lib/i18n';
import { useToast } from '../ToastContext';
import type { JarvisStoreData, ProactiveInsight, ProjectWorkspace } from '../../shared/types';

type TacticalDrawerId = 'contracts' | 'decisions' | 'routines' | null;

interface BriefViewProps {
  store: JarvisStoreData;
  onRefreshBootstrap: () => Promise<void>;
  onOpenWizard: () => void;
  onSkipWizard: () => Promise<void>;
  onNavigate: (section: NavSectionId, subId?: string) => void;
  onOpenProjectsModal?: () => void;
}

export const BriefView: React.FC<BriefViewProps> = ({
  store,
  onRefreshBootstrap,
  onOpenWizard,
  onSkipWizard,
  onNavigate,
  onOpenProjectsModal,
}) => {
  const { pushToast } = useToast();
  const lang = store.settings.language;

  const [briefText, setBriefText] = useState<string>(() => {
    const verified = store.contracts.filter((c) => c.status === 'VERIFIED').length;
    const pendingDec = store.decisions.filter((d) => d.status === 'PENDING').length;
    const top = store.candidates.find((c) => !c.completed) || store.candidates[0];
    const projCount = (store.projects || []).length;
    return lang === 'pt-PT'
      ? `Operador ${store.settings.operatorName}, sistemas táticos calibrados. ${projCount} projetos em execução paralela, ${verified}/${store.contracts.length} contratos SHA-256 verificados e ${pendingDec} decisões estratégicas prontas para deliberação. A diretiva prioritária Q-18 (Score ${top?.q18Score?.toFixed(2) ?? '0.00'}) aguarda autorização.`
      : `Commander ${store.settings.operatorName}, tactical systems calibrated. ${projCount} concurrent projects active, ${verified}/${store.contracts.length} SHA-256 contracts verified, and ${pendingDec} strategic decisions queued. Top Q-18 directive (Score ${top?.q18Score?.toFixed(2) ?? '0.00'}) ready for execution.`;
  });

  const [synthesizing, setSynthesizing] = useState(false);
  const [executingQ18, setExecutingQ18] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [scanningProactive, setScanningProactive] = useState(false);
  const [resolvingInsightId, setResolvingInsightId] = useState<string | null>(null);
  const [activeDrawer, setActiveDrawer] = useState<TacticalDrawerId>(null);

  const [showAddGoal, setShowAddGoal] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalMetric, setGoalMetric] = useState('');

  useEffect(() => {
    if (!activeDrawer) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveDrawer(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDrawer]);

  const activeCandidates = store.candidates.filter((c) => !c.completed);
  const topCandidate = activeCandidates[0] || store.candidates[0];
  const runnerUpCandidates = activeCandidates.slice(1, 3);

  const pendingDecisions = store.decisions.filter((d) => d.status === 'PENDING');
  const verifiedContractsCount = store.contracts.filter((c) => c.status === 'VERIFIED').length;
  const projects = store.projects || [];

  const openInsights: { project: ProjectWorkspace; insight: ProactiveInsight }[] = [];
  for (const proj of projects) {
    if (!proj.proactiveEnabled) continue;
    for (const ins of proj.proactiveInsights || []) {
      if (ins.status === 'OPEN') {
        openInsights.push({ project: proj, insight: ins });
      }
    }
  }

  const handleSynthesizeBrief = async () => {
    setSynthesizing(true);
    try {
      const res = await apiJson<{ text: string }>('/api/brief/synthesize', { method: 'POST' });
      setBriefText(res.text);
      pushToast({ title: 'Briefing tático sintetizado', tone: 'success' });
    } catch (err) {
      pushToast({
        title: 'Erro ao sintetizar briefing',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setSynthesizing(false);
    }
  };

  const handleProactiveScanNow = async () => {
    setScanningProactive(true);
    try {
      const res = await apiJson<{ scanned: ProjectWorkspace[] }>('/api/projects/proactive-scan', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await onRefreshBootstrap();
      pushToast({
        title: `Sonda proativa concluída (${res.scanned.length} projeto(s))`,
        detail: 'Recomendações atualizadas com base no Git, AST e Today Contracts.',
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Falha na sonda proativa',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setScanningProactive(false);
    }
  };

  const handleResolveInsight = async (
    projectId: string,
    insightId: string,
    mode: 'EXECUTE' | 'DISMISS'
  ) => {
    setResolvingInsightId(insightId);
    try {
      const res = await apiJson<{ executionSummary: string }>(
        `/api/projects/${projectId}/insights/${insightId}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify({ mode }),
        }
      );
      await onRefreshBootstrap();
      pushToast({
        title: mode === 'EXECUTE' ? 'Intervenção proativa executada' : 'Recomendação dispensada',
        detail: res.executionSummary,
        tone: mode === 'EXECUTE' ? 'success' : 'info',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao processar recomendação proativa',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setResolvingInsightId(null);
    }
  };

  const handleToggleProjectProactive = async (proj: ProjectWorkspace) => {
    try {
      await apiJson(`/api/projects/${proj.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ proactiveEnabled: !proj.proactiveEnabled }),
      });
      await onRefreshBootstrap();
      pushToast({
        title: !proj.proactiveEnabled
          ? `Proatividade ativada em ${proj.name}`
          : `Proatividade pausada em ${proj.name}`,
        tone: 'info',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao alternar proatividade',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const handleExecuteQ18 = async (id: string) => {
    setExecutingQ18(id);
    try {
      const res = await apiJson<{ detail: string; navigateTo?: NavSectionId }>(
        `/api/q18/${id}/execute`,
        { method: 'POST' }
      );
      await onRefreshBootstrap();
      pushToast({ title: 'Diretiva Q-18 executada', detail: res.detail, tone: 'success' });
      if (res.navigateTo) {
        onNavigate(res.navigateTo);
      }
    } catch (err) {
      pushToast({ title: 'Falha na ação Q-18', detail: (err as Error).message, tone: 'error' });
    } finally {
      setExecutingQ18(null);
    }
  };

  const handleVerifyContract = async (id: string) => {
    setVerifyingId(id);
    try {
      const res = await apiJson<{ result: { verified: boolean; summary: string } }>(
        `/api/contracts/${id}/verify`,
        { method: 'POST' }
      );
      await onRefreshBootstrap();
      pushToast({
        title: res.result.verified ? 'Contrato Verificado (Gate Pass)' : 'Verificação Falhou',
        detail: res.result.summary,
        tone: res.result.verified ? 'success' : 'warning',
      });
    } catch (err) {
      pushToast({ title: 'Erro na verificação', detail: (err as Error).message, tone: 'error' });
    } finally {
      setVerifyingId(null);
    }
  };

  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalTitle.trim()) return;
    try {
      await apiJson('/api/goals', {
        method: 'POST',
        body: JSON.stringify({
          title: goalTitle.trim(),
          targetMetric: goalMetric.trim() || 'Meta verificável',
        }),
      });
      setGoalTitle('');
      setGoalMetric('');
      setShowAddGoal(false);
      await onRefreshBootstrap();
      pushToast({ title: 'Objetivo macro adicionado', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Erro ao criar objetivo', detail: (err as Error).message, tone: 'error' });
    }
  };

  const handleGoalProgress = async (id: string, delta: number, current: number) => {
    const next = Math.max(0, Math.min(100, current + delta));
    await apiJson(`/api/goals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ progress: next }),
    });
    await onRefreshBootstrap();
  };

  const handleResolveDecision = async (id: string, choice: 'A' | 'B') => {
    try {
      await apiJson(`/api/decisions/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ choice }),
      });
      await onRefreshBootstrap();
      pushToast({
        title: `Decisão registada (Opção ${choice})`,
        detail: 'Guardada automaticamente no Memory Vault com proveniência confirmada.',
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao resolver decisão',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const handleConvertRoutine = async (cueId: string) => {
    try {
      await apiJson(`/api/routines/${cueId}/convert`, { method: 'POST' });
      await onRefreshBootstrap();
      pushToast({
        title: 'Rotina convertida em Workflow DAG',
        detail: 'Disponível no separador Workflows & Cron.',
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao converter rotina',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Optional Non-Blocking 3-Step Customization Strip */}
      {!store.settings.onboardingCompleted && (
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 hud-panel rounded-xl">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-slate-100">{t(lang, 'setup_banner_title')}</p>
            <p className="text-xs text-slate-400">
              Ajusta o teu nome, objetivos e nível de autonomia — ou mantém o perfil tático pré-configurado.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onSkipWizard}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap"
            >
              {t(lang, 'setup_banner_skip')}
            </button>
            <button
              type="button"
              onClick={onOpenWizard}
              className="px-4 py-2 text-xs font-semibold bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap"
            >
              {t(lang, 'setup_banner_open')}
            </button>
          </div>
        </div>
      )}

      {/* Primary Stark Tactical Stage: Dominant Q-18 Directive (7 cols) + Mark-VII Briefing & Telemetry (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Dominant Visual Anchor: Protocol Q-18 Priority #1 */}
        <section
          aria-label="Diretiva Prioritária Protocolo Q-18"
          className="lg:col-span-7 hud-panel-amber hud-corner-frame rounded-xl p-6 flex flex-col justify-between gap-5"
        >
          {topCandidate ? (
            <>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                  <div className="flex items-center gap-2 text-amber-400">
                    <span className="font-semibold">PROTOCOLO Q-18 · AÇÃO PRIMÁRIA</span>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-cyan-300">{topCandidate.targetComponent}</span>
                  </div>
                  <span className="text-amber-300 font-semibold">
                    Score {topCandidate.q18Score?.toFixed(2) ?? '0.00'}
                  </span>
                </div>

                <h1 className="text-2xl sm:text-[26px] font-bold text-slate-50 font-display leading-tight">
                  {topCandidate.title}
                </h1>

                <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
                  {topCandidate.description}
                </p>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs font-mono text-slate-400 tabular-nums">
                  <span>Impacto {topCandidate.impact}/10</span>
                  <span aria-hidden="true">·</span>
                  <span>Urgência {topCandidate.urgency}/10</span>
                  <span aria-hidden="true">·</span>
                  <span>Esforço {topCandidate.effort}</span>
                  <span aria-hidden="true">·</span>
                  <span>Risco {topCandidate.risk}/5</span>
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-amber-500/20">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-mono text-slate-400">
                    {topCandidate.completed
                      ? 'Concluída com sucesso nesta sessão'
                      : 'Vetor determinístico validado e pronto a disparar'}
                  </span>
                  <button
                    type="button"
                    disabled={executingQ18 === topCandidate.id}
                    onClick={() => handleExecuteQ18(topCandidate.id)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    {executingQ18 === topCandidate.id ? 'A executar...' : t(lang, 'execute_now')}
                  </button>
                </div>

                {runnerUpCandidates.length > 0 && (
                  <div className="pt-2.5 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-slate-500 shrink-0">Próximas na fila Q-18:</span>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                      {runnerUpCandidates.map((cand) => (
                        <button
                          key={cand.id}
                          type="button"
                          onClick={() => handleExecuteQ18(cand.id)}
                          className="text-left text-slate-300 hover:text-amber-300 transition-colors truncate max-w-64 font-mono tabular-nums"
                          title={`Executar ${cand.title}`}
                        >
                          [{cand.q18Score?.toFixed(1)}] {cand.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">Todas as ações Q-18 encontram-se concluídas.</p>
          )}
        </section>

        {/* Secondary Focal Column: Mark-VII Briefing & Cognitive Bridge */}
        <section
          aria-label="Briefing Tático Mark-VII"
          className="lg:col-span-5 hud-panel hud-corner-frame rounded-xl p-6 flex flex-col justify-between gap-5"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-mono text-cyan-400">
                <span>SÍNTESE TÁTICA MARK-VII</span>
                <span className="text-slate-600" aria-hidden="true">
                  {' '}
                  ·{' '}
                </span>
                <span className="text-slate-400">{store.settings.personalityMode}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    markViiAudio.speakWithMarkVII(briefText, lang, store.settings.voiceDspEnabled)
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-cyan-300 bg-[#050810] border border-cyan-500/30 rounded-lg hover:border-cyan-400 transition-colors whitespace-nowrap"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  {t(lang, 'speak_brief')}
                </button>
                <button
                  type="button"
                  disabled={synthesizing}
                  onClick={handleSynthesizeBrief}
                  aria-label={t(lang, 'refresh_brief')}
                  title={t(lang, 'refresh_brief')}
                  className="p-1.5 text-slate-300 bg-[#050810] border border-slate-800 rounded-lg hover:border-slate-600 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${synthesizing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <p className="text-sm text-slate-200 leading-relaxed">{briefText}</p>
          </div>

          <div className="space-y-2.5 pt-3 border-t border-slate-800/80 text-xs">
            <div className="flex items-center justify-between gap-2 font-mono tabular-nums">
              <span className="text-slate-400">Córtex v7.2 · Token Diet 5h</span>
              <button
                type="button"
                onClick={() => onNavigate('brain')}
                className="text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1 whitespace-nowrap"
              >
                <Brain className="w-3.5 h-3.5" />
                Nativo 100% · {(store.quota5h?.savedByDietTokens5h ?? 0).toLocaleString('pt-PT')} tok poupados
                <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>

            {store.heartbeat.recentAlerts[0] && (
              <div className="flex items-center justify-between gap-3 font-mono text-slate-400">
                <span className="truncate">{store.heartbeat.recentAlerts[0].detail}</span>
                <button
                  type="button"
                  onClick={() => onNavigate('devices')}
                  className="text-amber-300 hover:text-amber-200 whitespace-nowrap shrink-0 inline-flex items-center gap-1"
                >
                  Host Sidecar
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Balanced Inspector Trigger Strip -> Opens Slide-Over Tactical Drawers on Demand */}
      <section
        aria-label="Gavetas de Inspeção Tática"
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        <button
          type="button"
          data-testid="open-drawer-contracts"
          onClick={() => setActiveDrawer('contracts')}
          className="hud-panel rounded-xl p-4 text-left hover:border-cyan-400/50 transition-colors group flex items-center justify-between gap-3"
        >
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 text-xs font-mono text-cyan-400">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>TODAY CONTRACT GATE</span>
            </div>
            <p className="text-base font-semibold text-slate-100 font-display tabular-nums">
              {verifiedContractsCount}/{store.contracts.length} Contratos Verificados
            </p>
            <p className="text-xs text-slate-400 truncate">
              Provas criptográficas SHA-256 e validação de testes em 1 clique
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-cyan-300 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>

        <button
          type="button"
          data-testid="open-drawer-decisions"
          onClick={() => setActiveDrawer('decisions')}
          className="hud-panel rounded-xl p-4 text-left hover:border-amber-400/50 transition-colors group flex items-center justify-between gap-3"
        >
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 text-xs font-mono text-amber-400">
              <Target className="w-4 h-4 shrink-0" />
              <span>DECISÕES & OBJETIVOS MACRO</span>
            </div>
            <p className="text-base font-semibold text-slate-100 font-display tabular-nums">
              {pendingDecisions.length} Dilemas · {store.goals.length} Objetivos
            </p>
            <p className="text-xs text-slate-400 truncate">
              Deliberação executiva A/B e acompanhamento de metas quantitativas
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-amber-300 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>

        <button
          type="button"
          data-testid="open-drawer-routines"
          onClick={() => setActiveDrawer('routines')}
          className="hud-panel rounded-xl p-4 text-left hover:border-emerald-400/50 transition-colors group flex items-center justify-between gap-3"
        >
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 text-xs font-mono text-emerald-400">
              <Workflow className="w-4 h-4 shrink-0" />
              <span>ROTINAS & ENXAME SWARM</span>
            </div>
            <p className="text-base font-semibold text-slate-100 font-display tabular-nums">
              {store.routineCues.length} Padrões ·{' '}
              {store.swarmRuns?.[0]
                ? `${store.swarmRuns[0].scale}x ${store.swarmRuns[0].source === 'SEED' ? 'Demo' : 'Verificado'}`
                : '48x Pronto'}
            </p>
            <p className="text-xs text-slate-400 truncate">
              Conversão em Workflows Cron DAG e atalhos para Swarm 3D / Orbit
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-300 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
      </section>

      {/* Concurrent Multi-Project Matrix & Live Proactive Interventions */}
      <section className="hud-panel rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100 font-display flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-cyan-400" />
              Matriz Multi-Projeto & Intervenções Proativas
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Vigilância autónoma de repositórios simultâneos (Git, acoplamento AST e Today Contracts).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={scanningProactive}
              onClick={handleProactiveScanNow}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#050810] border border-cyan-500/30 text-cyan-300 hover:border-cyan-400 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${scanningProactive ? 'animate-spin' : ''}`} />
              {scanningProactive ? 'A sondar...' : 'Scan Proativo Agora'}
            </button>
            {onOpenProjectsModal && (
              <button
                type="button"
                onClick={onOpenProjectsModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Gerir / + Projeto
              </button>
            )}
          </div>
        </div>

        {/* Projects Tactical Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {projects.map((proj) => {
            const isActive = proj.id === store.activeProjectId;
            const openCues = (proj.proactiveInsights || []).filter((i) => i.status === 'OPEN').length;
            return (
              <div
                key={proj.id}
                className={`p-4 rounded-lg border flex flex-col justify-between gap-3 transition-colors ${
                  isActive
                    ? 'bg-[#0c1422] border-cyan-400/50'
                    : 'bg-[#050810] border-slate-800/90 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onNavigate('workspace')}
                      className="text-sm font-semibold text-slate-100 hover:text-cyan-300 truncate text-left"
                    >
                      {proj.name}
                    </button>
                    <span className="text-xs font-mono tabular-nums text-emerald-400 shrink-0">
                      {proj.healthScore}%
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-slate-400 truncate">
                    <GitBranch className="w-3 h-3 inline mr-1 text-cyan-400" />
                    {proj.gitBranch} · {proj.rootPath} · {proj.techStack}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-800/80 text-xs">
                  <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                    {proj.assignedAgentIds.length} agentes · {openCues} cues
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleProjectProactive(proj)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono border transition-colors whitespace-nowrap ${
                      proj.proactiveEnabled
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-slate-800 bg-[#090e17] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {proj.proactiveEnabled ? 'Proativo ON' : 'Proativo OFF'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Actionable Proactive Insights Feed (Compact & Direct) */}
        {openInsights.length > 0 && (
          <div className="divide-y divide-slate-800/80 rounded-lg bg-[#050810] border border-slate-800/90">
            {openInsights.slice(0, 4).map(({ project, insight }) => (
              <div
                key={insight.id}
                className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono">
                    <span
                      className={
                        insight.severity === 'WARNING'
                          ? 'text-amber-400 font-semibold'
                          : 'text-cyan-300 font-semibold'
                      }
                    >
                      {project.name}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-sans font-medium text-slate-100">{insight.title}</span>
                  </div>
                  <p className="text-xs text-slate-400 truncate">{insight.detail}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={resolvingInsightId === insight.id}
                    onClick={() => handleResolveInsight(project.id, insight.id, 'EXECUTE')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {insight.suggestedActionLabel || 'Executar'}
                  </button>
                  <button
                    type="button"
                    disabled={resolvingInsightId === insight.id}
                    onClick={() => handleResolveInsight(project.id, insight.id, 'DISMISS')}
                    aria-label="Dispensar recomendação"
                    className="p-1.5 rounded-lg bg-[#090e17] border border-slate-800 text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Slide-Over Tactical Inspector Drawer (480px) */}
      {activeDrawer && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Gaveta de Inspeção Tática"
          data-testid="tactical-slideover-drawer"
          className="fixed inset-0 z-50 flex justify-end bg-[#02050c]/82"
          onClick={() => setActiveDrawer(null)}
        >
          <div
            className="w-full max-w-lg h-full bg-[#060a12] border-l border-cyan-500/30 p-6 overflow-y-auto flex flex-col justify-between gap-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-5">
              {/* Drawer Header & Quick Drawer Switcher */}
              <div className="space-y-3 pb-4 border-b border-slate-800">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-wider text-amber-400">
                      Inspeção Tática · Stark HUD
                    </p>
                    <h2 className="text-lg font-bold text-slate-100 font-display">
                      {activeDrawer === 'contracts' && 'Today Contract Gate (SHA-256)'}
                      {activeDrawer === 'decisions' && 'Decisões Executivas & Objetivos'}
                      {activeDrawer === 'routines' && 'Rotinas Descobertas & Atalhos'}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveDrawer(null)}
                    aria-label="Fechar gaveta tática"
                    className="p-2 rounded-lg bg-[#0b111d] border border-slate-800 text-slate-400 hover:text-slate-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Segmented Drawer Switcher */}
                <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#04070d] border border-slate-800/90">
                  <button
                    type="button"
                    onClick={() => setActiveDrawer('contracts')}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      activeDrawer === 'contracts'
                        ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/35'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Contratos ({verifiedContractsCount}/{store.contracts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDrawer('decisions')}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      activeDrawer === 'decisions'
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/35'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Decisões ({pendingDecisions.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDrawer('routines')}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      activeDrawer === 'routines'
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Rotinas ({store.routineCues.length})
                  </button>
                </div>
              </div>

              {/* Drawer Content 1: Contracts */}
              {activeDrawer === 'contracts' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    Validação empírica de entregas através de testes unitários reais, existência de ficheiros e sondas HTTP com assinatura SHA-256.
                  </p>
                  <div className="divide-y divide-slate-800/80 rounded-xl bg-[#04070d] border border-slate-800">
                    {store.contracts.map((contract) => (
                      <div key={contract.id} className="p-4 space-y-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {contract.status === 'VERIFIED' ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : contract.status === 'FAILED' ? (
                              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                            ) : (
                              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                            )}
                            <span className="text-sm font-medium text-slate-100">
                              {contract.title}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={verifyingId === contract.id}
                            onClick={() => handleVerifyContract(contract.id)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                          >
                            {verifyingId === contract.id ? 'A validar...' : t(lang, 'verify_now')}
                          </button>
                        </div>
                        <p className="text-xs font-mono text-slate-400 tabular-nums break-all">
                          {contract.verificationRule} · {contract.verificationTarget} ·{' '}
                          {contract.source === 'REAL' ? 'Real' : 'Demo'}
                          {contract.evidenceHash ? ` · SHA ${contract.evidenceHash}` : ''}
                        </p>
                        {contract.outputSummary && (
                          <p className="text-xs text-slate-500">{contract.outputSummary}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Drawer Content 2: Decisions & Macro Goals */}
              {activeDrawer === 'decisions' && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-200 font-display">
                      Fila de Decisões Estratégicas ({pendingDecisions.length})
                    </h3>
                    {pendingDecisions.length === 0 ? (
                      <p className="text-xs text-slate-400 p-4 rounded-xl bg-[#04070d] border border-slate-800">
                        Todas as decisões pendentes foram resolvidas e arquivadas no Memory Vault.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {pendingDecisions.map((dec) => (
                          <div
                            key={dec.id}
                            className="p-4 rounded-xl bg-[#04070d] border border-slate-800 space-y-3"
                          >
                            <div>
                              <h4 className="text-sm font-semibold text-slate-100">{dec.title}</h4>
                              <p className="text-xs text-slate-400 mt-0.5">{dec.context}</p>
                            </div>
                            <div className="grid grid-cols-1 gap-2.5">
                              <button
                                type="button"
                                onClick={() => handleResolveDecision(dec.id, 'A')}
                                className="p-3 rounded-lg bg-[#090e17] border border-slate-800 hover:border-cyan-400/60 text-left transition-colors space-y-1"
                              >
                                <p className="text-xs font-semibold text-cyan-300">
                                  Opção A · {dec.optionA.label}
                                </p>
                                <p className="text-xs text-slate-400">{dec.optionA.summary}</p>
                                <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                                  Impacto {dec.optionA.impactScore} · Risco {dec.optionA.riskLevel}
                                </p>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResolveDecision(dec.id, 'B')}
                                className="p-3 rounded-lg bg-[#090e17] border border-slate-800 hover:border-amber-400/60 text-left transition-colors space-y-1"
                              >
                                <p className="text-xs font-semibold text-amber-300">
                                  Opção B · {dec.optionB.label}
                                </p>
                                <p className="text-xs text-slate-400">{dec.optionB.summary}</p>
                                <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                                  Impacto {dec.optionB.impactScore} · Risco {dec.optionB.riskLevel}
                                </p>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 pt-4 border-t border-slate-800">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-200 font-display">
                        Objetivos Macro ({store.goals.length})
                      </h3>
                      <button
                        type="button"
                        onClick={() => setShowAddGoal((v) => !v)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-[#0b111d] border border-slate-700 text-slate-200 hover:border-cyan-400/50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Novo Objetivo
                      </button>
                    </div>

                    {showAddGoal && (
                      <form
                        onSubmit={handleAddGoal}
                        className="p-3 rounded-xl bg-[#04070d] border border-slate-800 space-y-2.5"
                      >
                        <input
                          type="text"
                          value={goalTitle}
                          onChange={(e) => setGoalTitle(e.target.value)}
                          placeholder="Título do objetivo..."
                          required
                          className="w-full px-3 py-1.5 text-xs bg-[#090e17] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                        />
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={goalMetric}
                            onChange={(e) => setGoalMetric(e.target.value)}
                            placeholder="Métrica alvo..."
                            className="flex-1 px-3 py-1.5 text-xs bg-[#090e17] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                          />
                          <button
                            type="submit"
                            className="px-3 py-1.5 text-xs font-semibold bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400"
                          >
                            Guardar
                          </button>
                        </div>
                      </form>
                    )}

                    <div className="space-y-3">
                      {store.goals.map((goal) => (
                        <div
                          key={goal.id}
                          className="p-3.5 rounded-xl bg-[#04070d] border border-slate-800 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-medium text-slate-200">{goal.title}</span>
                            <div className="flex items-center gap-1.5 font-mono tabular-nums shrink-0">
                              <button
                                type="button"
                                onClick={() => handleGoalProgress(goal.id, 5, goal.progress)}
                                className="px-1.5 py-0.5 bg-[#0b111d] border border-slate-800 hover:border-cyan-500/40 rounded text-slate-300"
                              >
                                +5%
                              </button>
                              <span className="text-cyan-300 font-semibold">{goal.progress}%</span>
                            </div>
                          </div>
                          <div className="w-full h-1.5 rounded bg-[#0b111d] overflow-hidden">
                            <div
                              className="h-full bg-cyan-400 transition-all"
                              style={{ width: `${goal.progress}%` }}
                            />
                          </div>
                          <p className="text-[11px] font-mono text-slate-500">
                            {goal.category} · {goal.targetMetric} · Meta {goal.deadline}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Drawer Content 3: Routine Cues & Swarm Shortcuts */}
              {activeDrawer === 'routines' && (
                <div className="space-y-5">
                  <div className="space-y-3">
                    <p className="text-xs text-slate-400">
                      Padrões operacionais recorrentes identificados pelo motor{' '}
                      <span className="font-mono text-slate-300">routine-cues-v2</span> prontos a
                      converter em Workflows Cron DAG autónomos.
                    </p>
                    <div className="divide-y divide-slate-800/80 rounded-xl bg-[#04070d] border border-slate-800">
                      {store.routineCues.map((cue) => (
                        <div key={cue.id} className="p-4 space-y-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-slate-100">{cue.title}</p>
                              <p className="text-xs text-slate-400 mt-0.5">
                                {cue.patternDescription}
                              </p>
                            </div>
                            <span className="text-xs font-mono tabular-nums text-emerald-400 shrink-0">
                              {Math.round(cue.confidence * 100)}% conf.
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 pt-1">
                            <span className="text-xs font-mono text-slate-500">
                              Cron: {cue.suggestedCron}
                            </span>
                            {cue.convertedWorkflowId ? (
                              <span className="text-xs font-mono text-emerald-400">
                                Workflow Ativo
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleConvertRoutine(cue.id)}
                                className="px-3 py-1.5 text-xs font-semibold bg-emerald-500 text-slate-950 rounded-lg hover:bg-emerald-400 transition-colors whitespace-nowrap"
                              >
                                Converter em Workflow
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveDrawer(null);
                        onNavigate('swarm');
                      }}
                      className="p-3 rounded-xl bg-[#04070d] border border-slate-800 hover:border-cyan-400/50 text-left"
                    >
                      <p className="text-xs font-mono text-cyan-400">SWARM 48X · 3D</p>
                      <p className="text-sm font-semibold text-slate-100 mt-0.5">
                        Abrir Palco 3D & CoW
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveDrawer(null);
                        onNavigate('orbit');
                      }}
                      className="p-3 rounded-xl bg-[#04070d] border border-slate-800 hover:border-amber-400/50 text-left"
                    >
                      <p className="text-xs font-mono text-amber-400">ORBIT AGENT OS</p>
                      <p className="text-sm font-semibold text-slate-100 mt-0.5">
                        DOTS DAG & Quota 5h
                      </p>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs font-mono text-slate-500">
              <span>ESC para fechar gaveta</span>
              <button
                type="button"
                onClick={() => setActiveDrawer(null)}
                className="text-slate-300 hover:text-white"
              >
                Fechar Painel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
