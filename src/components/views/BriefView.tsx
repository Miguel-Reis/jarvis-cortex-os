import React, { useState } from 'react';
import {
  Volume2,
  RefreshCw,
  Play,
  CheckCircle2,
  Clock,
  AlertCircle,
  Plus,
  ArrowUpRight,
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import { markViiAudio } from '../../lib/audio-dsp';
import { t, type NavSectionId } from '../../lib/i18n';
import { useToast } from '../ToastContext';
import type { JarvisStoreData } from '../../shared/types';

interface BriefViewProps {
  store: JarvisStoreData;
  onRefreshBootstrap: () => Promise<void>;
  onOpenWizard: () => void;
  onSkipWizard: () => Promise<void>;
  onNavigate: (section: NavSectionId) => void;
}

export const BriefView: React.FC<BriefViewProps> = ({
  store,
  onRefreshBootstrap,
  onOpenWizard,
  onSkipWizard,
  onNavigate,
}) => {
  const { pushToast } = useToast();
  const lang = store.settings.language;

  const [briefText, setBriefText] = useState<string>(() => {
    const verified = store.contracts.filter((c) => c.status === 'VERIFIED').length;
    const pendingDec = store.decisions.filter((d) => d.status === 'PENDING').length;
    const top = store.candidates.find((c) => !c.completed) || store.candidates[0];
    return lang === 'pt-PT'
      ? `Bom dia, ${store.settings.operatorName}. Tens ${verified} de ${store.contracts.length} contratos do dia verificados e ${pendingDec} decisões estratégicas na fila. A ação prioritária calculada pelo protocolo determinístico Q-18 (Score ${top?.q18Score ?? 0}) é "${top?.title || 'Manter monitorização nominal'}".`
      : `Good morning, ${store.settings.operatorName}. ${verified} of ${store.contracts.length} Today Contracts are verified and ${pendingDec} decisions await review. Top Q-18 priority (Score ${top?.q18Score ?? 0}) is "${top?.title || 'Nominal standby'}".`;
  });

  const [synthesizing, setSynthesizing] = useState(false);
  const [executingQ18, setExecutingQ18] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalMetric, setGoalMetric] = useState('');

  const topCandidate = store.candidates.find((c) => !c.completed) || store.candidates[0];
  const pendingDecisions = store.decisions.filter((d) => d.status === 'PENDING');

  const handleSynthesizeBrief = async () => {
    setSynthesizing(true);
    try {
      const res = await apiJson<{ text: string }>('/api/brief/synthesize', { method: 'POST' });
      setBriefText(res.text);
      pushToast({ title: 'Briefing atualizado', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Erro ao sintetizar briefing', detail: (err as Error).message, tone: 'error' });
    } finally {
      setSynthesizing(false);
    }
  };

  const handleExecuteQ18 = async (id: string) => {
    setExecutingQ18(id);
    try {
      const res = await apiJson<{ detail: string }>(`/api/q18/${id}/execute`, { method: 'POST' });
      await onRefreshBootstrap();
      pushToast({ title: 'Ação Q-18 executada', detail: res.detail, tone: 'success' });
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
      pushToast({ title: 'Erro ao resolver decisão', detail: (err as Error).message, tone: 'error' });
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
      pushToast({ title: 'Erro ao converter rotina', detail: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Optional Non-Blocking 3-Step Customization Strip */}
      {!store.settings.onboardingCompleted && (
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 bg-[#0d1117] border border-cyan-500/35 rounded-xl">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-slate-100">{t(lang, 'setup_banner_title')}</p>
            <p className="text-xs text-slate-400">
              Ajusta o teu nome, objetivos e nível de autonomia — ou mantém o perfil executivo pré-configurado.
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
              className="px-3.5 py-1.5 text-xs font-medium bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 transition-colors whitespace-nowrap"
            >
              {t(lang, 'setup_banner_open')}
            </button>
          </div>
        </div>
      )}

      {/* Top Row: Executive Brief + Dominant Q-18 Next Action */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section className="lg:col-span-7 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 flex flex-col justify-between gap-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="text-xs text-slate-400">
                <span>Briefing Executivo</span>
                <span aria-hidden="true"> · </span>
                <span>Modo {store.settings.personalityMode}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    markViiAudio.speakWithMarkVII(briefText, lang, store.settings.voiceDspEnabled)
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-cyan-300 bg-[#151c26] border border-slate-700/80 rounded-lg hover:border-cyan-500/50 transition-colors whitespace-nowrap"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  {t(lang, 'speak_brief')}
                </button>
                <button
                  type="button"
                  disabled={synthesizing}
                  onClick={handleSynthesizeBrief}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#151c26] border border-slate-700/80 rounded-lg hover:border-slate-600 transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${synthesizing ? 'animate-spin' : ''}`} />
                  {t(lang, 'refresh_brief')}
                </button>
              </div>
            </div>

            <h2 className="text-xl font-semibold text-slate-100 leading-snug">
              Síntese Operacional do Dia
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">{briefText}</p>
          </div>

          {/* Latest Heartbeat Summary Line */}
          {store.heartbeat.recentAlerts[0] && (
            <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between gap-4 text-xs text-slate-400">
              <span className="truncate">
                Heartbeat OpenClaw: {store.heartbeat.recentAlerts[0].detail}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('workflows')}
                className="text-cyan-400 hover:text-cyan-300 whitespace-nowrap shrink-0 flex items-center gap-1"
              >
                Gerir Daemon
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </section>

        {/* Dominant Focal Anchor: Q-18 Highest Leverage Next-Action */}
        <section className="lg:col-span-5 bg-[#0d1117] border border-cyan-500/40 rounded-xl p-6 flex flex-col justify-between gap-5">
          {topCandidate ? (
            <>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs text-cyan-400 font-mono tabular-nums">
                  <span>Protocolo Q-18 · Prioridade #1</span>
                  <span>Score {topCandidate.q18Score?.toFixed(2) ?? '0.00'}</span>
                </div>
                <h3 className="text-lg font-semibold text-slate-100">{topCandidate.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{topCandidate.description}</p>
                <p className="text-xs text-slate-500 font-mono tabular-nums pt-1">
                  Alvo: {topCandidate.targetComponent} · Impacto {topCandidate.impact} · Urgência{' '}
                  {topCandidate.urgency} · Risco {topCandidate.risk}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
                <span className="text-xs text-slate-400">
                  {topCandidate.completed ? 'Concluída nesta sessão' : 'Pronta para execução imediata'}
                </span>
                <button
                  type="button"
                  disabled={executingQ18 === topCandidate.id}
                  onClick={() => handleExecuteQ18(topCandidate.id)}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  {executingQ18 === topCandidate.id ? 'A executar...' : t(lang, 'execute_now')}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">Todas as ações Q-18 encontram-se concluídas.</p>
          )}
        </section>
      </div>

      {/* Antigravity Brain v7.2 · Swarm 48x & Orbit Token Diet Executive Strip */}
      <section className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
        <div className="flex items-center justify-between sm:justify-start gap-3">
          <div>
            <p className="text-xs text-slate-400">Enxame Assimétrico Swarm</p>
            <p className="text-sm font-semibold font-mono tabular-nums text-cyan-300">
              {store.swarmRuns?.[0]
                ? `${store.swarmRuns[0].scale}x · ${store.swarmRuns[0].verifyGatesPassed}/${store.swarmRuns[0].verifyGatesTotal} Gates`
                : '48x · 96/96 Gates'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('swarm')}
            className="px-2.5 py-1 text-xs font-medium bg-[#151c26] border border-slate-700 text-cyan-300 rounded-md hover:border-cyan-500/60 whitespace-nowrap"
          >
            Abrir 3D & CoW
          </button>
        </div>

        <div className="flex items-center justify-between sm:justify-start gap-3 sm:border-l sm:border-slate-800 sm:pl-4">
          <div>
            <p className="text-xs text-slate-400">Token Diet (Janela 5h)</p>
            <p className="text-sm font-semibold font-mono tabular-nums text-emerald-400">
              -{(store.quota5h?.savedByDietTokens5h ?? 98460).toLocaleString('pt-PT')} tokens
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('orbit')}
            className="px-2.5 py-1 text-xs font-medium bg-[#151c26] border border-slate-700 text-slate-200 rounded-md hover:border-cyan-500/60 whitespace-nowrap"
          >
            Quota & MCP
          </button>
        </div>

        <div className="flex items-center justify-between sm:justify-start gap-3 sm:border-l sm:border-slate-800 sm:pl-4">
          <div>
            <p className="text-xs text-slate-400">ROI Acumulado & Self-Learn</p>
            <p className="text-sm font-semibold font-mono tabular-nums text-amber-300">
              {store.quota5h?.estimatedHoursSaved ?? 14.5}h poupadas ·{' '}
              {(store.selfLearnQueue || []).filter((s) => s.status === 'PENDING').length} factos
            </p>
          </div>
        </div>
      </section>

      {/* Second Row: Today Contract Gate + Macro Goals */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-100">Today Contract Gate</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Tarefas que exigem evidência empírica real (testes, ficheiros, sonda HTTP ou assinatura SHA-256).
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {store.contracts.filter((c) => c.status === 'VERIFIED').length}/{store.contracts.length}{' '}
              verificados
            </span>
          </div>

          <div className="divide-y divide-slate-800/70">
            {store.contracts.map((contract) => (
              <div
                key={contract.id}
                className="py-3.5 first:pt-1 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {contract.status === 'VERIFIED' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : contract.status === 'FAILED' ? (
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <p className="text-sm font-medium text-slate-100 truncate">{contract.title}</p>
                  </div>
                  <p className="text-xs text-slate-400 font-mono tabular-nums truncate">
                    {contract.verificationRule} · {contract.verificationTarget}
                    {contract.evidenceHash ? ` · SHA ${contract.evidenceHash}` : ''}
                  </p>
                  {contract.outputSummary && (
                    <p className="text-xs text-slate-500 truncate">{contract.outputSummary}</p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={verifyingId === contract.id}
                  onClick={() => handleVerifyContract(contract.id)}
                  className="px-3.5 py-1.5 text-xs font-medium bg-[#151c26] border border-slate-700 text-slate-200 rounded-lg hover:border-cyan-500/60 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 self-start sm:self-center disabled:opacity-50"
                >
                  {verifyingId === contract.id ? 'A validar...' : t(lang, 'verify_now')}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="lg:col-span-5 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-100">Objetivos Macro (Goals)</h3>
              <p className="text-xs text-slate-400 mt-0.5">Progresso quantitativo acumulado.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddGoal((v) => !v)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-[#151c26] border border-slate-700 rounded-lg text-slate-200 hover:border-slate-600 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Objetivo
            </button>
          </div>

          {showAddGoal && (
            <form onSubmit={handleAddGoal} className="space-y-2.5 pb-3 border-b border-slate-800">
              <input
                type="text"
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.target.value)}
                placeholder="Título do objetivo..."
                required
                className="w-full px-3 py-1.5 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
              />
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={goalMetric}
                  onChange={(e) => setGoalMetric(e.target.value)}
                  placeholder="Métrica alvo..."
                  className="flex-1 px-3 py-1.5 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-medium bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 whitespace-nowrap"
                >
                  Guardar
                </button>
              </div>
            </form>
          )}

          <div className="space-y-4">
            {store.goals.map((goal) => (
              <div key={goal.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-slate-200 truncate">{goal.title}</span>
                  <div className="flex items-center gap-1.5 shrink-0 font-mono tabular-nums">
                    <button
                      type="button"
                      onClick={() => handleGoalProgress(goal.id, 5, goal.progress)}
                      aria-label={`Aumentar progresso de ${goal.title}`}
                      className="px-1.5 py-0.5 bg-[#151c26] hover:bg-slate-700 rounded text-slate-300"
                    >
                      +5%
                    </button>
                    <span className="text-cyan-400">{goal.progress}%</span>
                  </div>
                </div>
                <svg className="w-full h-1.5 rounded bg-[#151c26] overflow-hidden" aria-hidden="true">
                  <rect
                    x="0"
                    y="0"
                    width={`${goal.progress}%`}
                    height="100%"
                    className="fill-cyan-500"
                  />
                </svg>
                <p className="text-xs text-slate-500 truncate">
                  {goal.category} · {goal.targetMetric} · Meta {goal.deadline}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Third Row: Decision Queue (Option A vs B) + Proactive Routine Cues */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Fila de Decisões Executivas</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Trade-offs avaliados pelo Jarvis prontos para confirmação em 1 clique.
            </p>
          </div>

          {pendingDecisions.length === 0 ? (
            <p className="text-xs text-slate-400 py-4">
              Todas as decisões pendentes foram resolvidas e arquivadas no Memory Vault.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {pendingDecisions.map((dec) => (
                <div key={dec.id} className="py-4 first:pt-1 last:pb-0 space-y-3">
                  <div>
                    <h4 className="text-sm font-medium text-slate-100">{dec.title}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">{dec.context}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => handleResolveDecision(dec.id, 'A')}
                      className="p-3 rounded-lg bg-[#151c26] border border-slate-800 hover:border-cyan-500/60 text-left transition-colors space-y-1"
                    >
                      <p className="text-xs font-semibold text-cyan-300">
                        Opção A: {dec.optionA.label}
                      </p>
                      <p className="text-xs text-slate-400">{dec.optionA.summary}</p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums">
                        Impacto {dec.optionA.impactScore} · Risco {dec.optionA.riskLevel}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveDecision(dec.id, 'B')}
                      className="p-3 rounded-lg bg-[#151c26] border border-slate-800 hover:border-amber-500/60 text-left transition-colors space-y-1"
                    >
                      <p className="text-xs font-semibold text-amber-300">
                        Opção B: {dec.optionB.label}
                      </p>
                      <p className="text-xs text-slate-400">{dec.optionB.summary}</p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums">
                        Impacto {dec.optionB.impactScore} · Risco {dec.optionB.riskLevel}
                      </p>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="lg:col-span-5 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Oportunidades & Routine Cues</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Padrões recorrentes detetados prontos a converter em Workflow autónomo.
            </p>
          </div>

          <div className="divide-y divide-slate-800/70">
            {store.routineCues.map((cue) => (
              <div key={cue.id} className="py-3.5 first:pt-1 last:pb-0 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-200">{cue.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{cue.patternDescription}</p>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-emerald-400 shrink-0">
                    {Math.round(cue.confidence * 100)}% conf.
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-mono text-slate-500">Cron sugerido: {cue.suggestedCron}</span>
                  {cue.convertedWorkflowId ? (
                    <span className="text-xs text-emerald-400 font-medium">Convertido em Workflow</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleConvertRoutine(cue.id)}
                      className="px-3 py-1 text-xs font-medium bg-[#151c26] border border-slate-700 text-cyan-300 rounded-lg hover:border-cyan-500/60 transition-colors whitespace-nowrap"
                    >
                      Converter em Workflow
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
