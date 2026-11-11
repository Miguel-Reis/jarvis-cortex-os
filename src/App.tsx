import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'framer-motion';
import {
  LayoutDashboard,
  Brain,
  MessageSquare,
  Workflow as WorkflowIcon,
  FolderGit2,
  Network,
  Blocks,
  Cpu,
  ShieldCheck,
  Command,
  Moon,
  Menu,
  X,
  Boxes,
  Radar,
  Server,
  Plus,
  Sparkles,
  Trash2,
  Clock,
  Bot,
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react';
import { apiJson } from './lib/api';
import { t, type NavSectionId } from './lib/i18n';
import { ToastProvider, useToast } from './components/ToastContext';
import { CommandPalette } from './components/CommandPalette';
import { PebbleWidget } from './components/PebbleWidget';
import { WelcomeWizardModal } from './components/WelcomeWizardModal';
import { BriefView } from './components/views/BriefView';
import { BrainView } from './components/views/BrainView';
import { ChatRoomsView } from './components/views/ChatRoomsView';
import { SwarmView } from './components/views/SwarmView';
import { OrbitView } from './components/views/OrbitView';
import { McpGatewayView } from './components/views/McpGatewayView';
import { WorkflowsView } from './components/views/WorkflowsView';
import { WorkspaceView } from './components/views/WorkspaceView';
import { MemoryGraphView } from './components/views/MemoryGraphView';
import { SkillsChannelsView } from './components/views/SkillsChannelsView';
import { DevicesSidecarView } from './components/views/DevicesSidecarView';
import { AuthoritySettingsView } from './components/views/AuthoritySettingsView';
import type {
  AppSettings,
  BrainLiveStatus,
  ChatMessage,
  GraphNodeComputed,
  JarvisStoreData,
  LanguageCode,
  OSTelemetry,
} from './shared/types';
import {
  computeProjectProactiveFrequency,
  computeProjectsPortfolioSummary,
  computeViewStepCompletion,
  getVisibleSidebarIds,
} from './shared/cortex-math';

interface BootstrapPayload {
  storageEngine: string;
  geminiAvailable: boolean;
  openRouterAvailable?: boolean;
  activePort: number;
  brain8765?: BrainLiveStatus;
  state: JarvisStoreData;
  pprNodes: GraphNodeComputed[];
  telemetry: OSTelemetry;
}

type NavGroupKey = 'nav_group_command' | 'nav_group_engineering' | 'nav_group_ecosystem';

const InnerApp: React.FC = () => {
  const { pushToast } = useToast();
  const prefersReducedMotion = useReducedMotion();
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<NavSectionId>('brief');
  const [subTargetId, setSubTargetId] = useState<string | undefined>(undefined);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [railExpanded, setRailExpanded] = useState(false);
  const [projectsModalOpen, setProjectsModalOpen] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);

  // New Project modal form state
  const [newProjName, setNewProjName] = useState('');
  const [newProjPath, setNewProjPath] = useState('src');
  const [newProjStack, setNewProjStack] = useState('TypeScript · React · Node.js');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjProactive, setNewProjProactive] = useState(true);
  const [creatingProj, setCreatingProj] = useState(false);

  const mainContentRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const rawProgress = useMotionValue(0);
  const smoothProgress = useSpring(rawProgress, {
    stiffness: 300,
    damping: 34,
    mass: 0.2,
  });

  const activeStepCompletion = useMemo(() => {
    if (!boot) return 0;
    return computeViewStepCompletion(activeSection, boot.state);
  }, [activeSection, boot]);

  const syncViewportProgress = useCallback(() => {
    if (typeof window === 'undefined') return;
    const docEl = document.documentElement;
    const maxScroll = Math.max(0, docEl.scrollHeight - window.innerHeight);
    const isScrollable = maxScroll > 96;
    const nextProgress = isScrollable
      ? Math.min(1, Math.max(0, window.scrollY / maxScroll))
      : activeStepCompletion;

    rawProgress.set(nextProgress);

    if (progressBarRef.current) {
      progressBarRef.current.setAttribute(
        'aria-valuenow',
        String(Math.round(nextProgress * 100))
      );
      progressBarRef.current.setAttribute(
        'data-progress-mode',
        isScrollable ? 'scroll' : 'step'
      );
      progressBarRef.current.setAttribute(
        'data-step-completion',
        String(Math.round(activeStepCompletion * 100))
      );
    }
  }, [activeStepCompletion, rawProgress]);

  useEffect(() => {
    syncViewportProgress();
    window.addEventListener('scroll', syncViewportProgress, { passive: true });
    window.addEventListener('resize', syncViewportProgress, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && mainContentRef.current) {
      observer = new ResizeObserver(() => {
        syncViewportProgress();
      });
      observer.observe(mainContentRef.current);
    }

    return () => {
      window.removeEventListener('scroll', syncViewportProgress);
      window.removeEventListener('resize', syncViewportProgress);
      observer?.disconnect();
    };
  }, [syncViewportProgress, loading]);

  const refreshBootstrap = useCallback(async () => {
    try {
      const data = await apiJson<BootstrapPayload>('/api/bootstrap');
      console.debug(
        `[JARVIS:BOOT] State synchronized (engine=${data.storageEngine}, port=${data.activePort}, brain=${data.brain8765?.mode || 'STANDALONE'}, projects=${data.state.projects?.length ?? 0}, memories=${data.state.memories?.length ?? 0})`
      );
      setBoot(data);
      setErrorMsg(null);
    } catch (err) {
      console.debug(`[JARVIS:BOOT] Bootstrap sync warning: ${(err as Error).message}`);
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBootstrap();
  }, [refreshBootstrap]);

  // Subscribe to Server-Sent Events (/api/events)
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('connected', (ev) => {
      console.debug('[JARVIS:SSE] Stream connected (/api/events)', (ev as MessageEvent).data || '');
      setSseConnected(true);
    });
    const onSseRefresh = (eventName: string) => (ev: Event) => {
      console.debug(`[JARVIS:SSE] Event "${eventName}"`, (ev as MessageEvent).data || '');
      refreshBootstrap();
    };
    es.addEventListener('state_updated', onSseRefresh('state_updated'));
    es.addEventListener('workflow_run', onSseRefresh('workflow_run'));
    es.addEventListener('swarm_progress', onSseRefresh('swarm_progress'));
    es.addEventListener('proactive_scan', onSseRefresh('proactive_scan'));
    es.addEventListener('sidecar_event', onSseRefresh('sidecar_event'));
    es.addEventListener('heartbeat', onSseRefresh('heartbeat'));
    es.onerror = () => {
      console.debug('[JARVIS:SSE] Stream reconnecting...');
      setSseConnected(false);
    };
    return () => {
      es.close();
    };
  }, [refreshBootstrap]);

  const focusModeEnabled = Boolean(boot?.state.settings.focusModeEnabled);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (focusModeEnabled) {
      document.documentElement.setAttribute('data-focus-mode', 'true');
    } else {
      document.documentElement.removeAttribute('data-focus-mode');
    }
  }, [focusModeEnabled]);

  const handleToggleFocusMode = useCallback(async () => {
    if (!boot) return;
    const nextVal = !boot.state.settings.focusModeEnabled;
    const currentLang = boot.state.settings.language;

    setBoot((prev) =>
      prev
        ? {
            ...prev,
            state: {
              ...prev.state,
              settings: { ...prev.state.settings, focusModeEnabled: nextVal },
            },
          }
        : prev
    );

    await apiJson('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ focusModeEnabled: nextVal }),
    });
    await refreshBootstrap();
    pushToast({
      title: t(currentLang, nextVal ? 'focus_mode_toast_on' : 'focus_mode_toast_off'),
      tone: 'info',
    });
  }, [boot, pushToast, refreshBootstrap]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        handleToggleFocusMode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleToggleFocusMode]);

  const handleNavigate = (section: NavSectionId, subId?: string) => {
    console.debug(`[JARVIS:NAV] Navigating -> section="${section}"${subId ? ` subId="${subId}"` : ''}`);
    setActiveSection(section);
    setSubTargetId(subId);
    setMobileMenuOpen(false);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0 });
    }
  };

  const handleLanguageSwitch = async (nextLang: LanguageCode) => {
    if (!boot) return;
    await apiJson('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ language: nextLang }),
    });
    await refreshBootstrap();
  };

  const handleActivateProject = async (projectId: string) => {
    if (!boot) return;
    try {
      await apiJson(`/api/projects/${projectId}/activate`, { method: 'POST' });
      await refreshBootstrap();
      const proj = (boot.state.projects || []).find((p) => p.id === projectId);
      if (proj) {
        pushToast({
          title: `Projeto ativo: ${proj.name}`,
          detail: `Diretório ${proj.rootPath} · Proatividade ${proj.proactiveEnabled ? 'ON' : 'OFF'}`,
          tone: 'info',
        });
      }
    } catch (err) {
      pushToast({
        title: 'Erro ao alternar projeto',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim()) return;
    setCreatingProj(true);
    try {
      await apiJson('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: newProjName.trim(),
          rootPath: newProjPath.trim() || '.',
          techStack: newProjStack.trim() || 'TypeScript · Node.js',
          description: newProjDesc.trim(),
          proactiveEnabled: newProjProactive,
        }),
      });
      setNewProjName('');
      setNewProjDesc('');
      await refreshBootstrap();
      pushToast({
        title: 'Novo projeto adicionado à carteira simultânea',
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao criar projeto',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setCreatingProj(false);
    }
  };

  const [bulkTogglingProactive, setBulkTogglingProactive] = useState(false);

  const handleToggleProjectProactive = async (projectId: string, nextEnabled: boolean) => {
    try {
      await apiJson(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ proactiveEnabled: nextEnabled }),
      });
      await refreshBootstrap();
      pushToast({
        title: nextEnabled ? 'Proatividade ativada no projeto' : 'Proatividade pausada no projeto',
        tone: 'info',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao atualizar proatividade',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const handleBulkToggleProjectProactive = async (nextEnabled: boolean) => {
    if (bulkTogglingProactive) return;
    setBulkTogglingProactive(true);
    try {
      const res = await apiJson<{
        ok: boolean;
        proactiveEnabled: boolean;
        updatedCount: number;
      }>('/api/projects/bulk-proactive', {
        method: 'POST',
        body: JSON.stringify({ proactiveEnabled: nextEnabled }),
      });
      await refreshBootstrap();
      pushToast({
        title: nextEnabled
          ? `Proatividade ativada em massa (${res.updatedCount} projetos)`
          : `Proatividade desativada em massa (${res.updatedCount} projetos)`,
        detail: nextEnabled
          ? 'O motor de vigilância Git, AST e contratos está agora ativo em toda a carteira.'
          : 'As sondas proativas automáticas foram pausadas em todos os projetos registados.',
        tone: nextEnabled ? 'success' : 'info',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao alternar proatividade em massa',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setBulkTogglingProactive(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      await apiJson(`/api/projects/${projectId}`, { method: 'DELETE' });
      await refreshBootstrap();
      pushToast({ title: 'Projeto removido da carteira', tone: 'info' });
    } catch (err) {
      pushToast({
        title: 'Não foi possível remover projeto',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const handleQuickDirective = async (directiveText: string): Promise<string> => {
    const res = await apiJson<{ assistantMessage: ChatMessage }>('/api/chat/send', {
      method: 'POST',
      body: JSON.stringify({
        roomId: 'room-exec',
        content: directiveText,
      }),
    });
    await refreshBootstrap();
    pushToast({
      title: 'Jarvis respondeu à diretiva',
      detail: res.assistantMessage.content.slice(0, 90),
      tone: 'success',
    });
    return res.assistantMessage.content;
  };

  const handleRunWorkflowFromPalette = async (workflowId: string) => {
    const res = await apiJson<{ run: { workflowName: string; status: string } }>(
      `/api/workflows/${workflowId}/run`,
      { method: 'POST' }
    );
    await refreshBootstrap();
    pushToast({
      title: `Workflow ${res.run.workflowName}`,
      detail: `Estado: ${res.run.status}`,
      tone: 'success',
    });
  };

  const handleWizardSave = async (updates: Partial<AppSettings>, initialGoalTitle?: string) => {
    await apiJson('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (initialGoalTitle) {
      await apiJson('/api/goals', {
        method: 'POST',
        body: JSON.stringify({
          title: initialGoalTitle,
          targetMetric: 'Definido na configuração inicial',
        }),
      });
    }
    await refreshBootstrap();
    pushToast({ title: 'Perfil do Jarvis personalizado', tone: 'success' });
  };

  if (loading) {
    return (
      <div className="min-h-screen jarvis-canvas-bg flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-3 text-center">
          <p className="text-sm font-semibold text-slate-200 font-display">
            A inicializar J.A.R.V.I.S. Cortex OS v3.0 × Antigravity Brain v7.2...
          </p>
          <div className="h-1.5 w-full bg-[#151c26] rounded-full overflow-hidden">
            <div className="h-full w-2/3 bg-cyan-500" />
          </div>
        </div>
      </div>
    );
  }

  if (errorMsg || !boot) {
    return (
      <div className="min-h-screen jarvis-canvas-bg flex items-center justify-center p-6">
        <div className="max-w-md jarvis-surface border border-rose-500/40 rounded-xl p-6 space-y-4">
          <h1 className="text-base font-semibold text-slate-100">Falha de Ligação ao Gateway</h1>
          <p className="text-xs text-slate-400">{errorMsg || 'Resposta vazia do servidor.'}</p>
          <button
            type="button"
            onClick={refreshBootstrap}
            className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg"
          >
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  const { state: store } = boot;
  const lang = store.settings.language;
  const pendingApprovalsCount = store.approvals.filter((a) => a.status === 'PENDING').length;

  const isAutostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const pendingSelfLearnCount = (store.selfLearnQueue || []).filter(
    (c) => c.status === 'PENDING'
  ).length;

  const projects = store.projects || [];
  const activeProject =
    projects.find((p) => p.id === store.activeProjectId) || projects[0];
  const openProactiveInsightsCount = projects.reduce(
    (acc, p) =>
      acc +
      (p.proactiveEnabled
        ? (p.proactiveInsights || []).filter((i) => i.status === 'OPEN').length
        : 0),
    0
  );

  const navItems: {
    id: NavSectionId;
    group: NavGroupKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    counter?: number;
  }[] = [
    {
      id: 'brief',
      group: 'nav_group_command',
      label: t(lang, 'nav_brief'),
      icon: LayoutDashboard,
      counter: openProactiveInsightsCount > 0 ? openProactiveInsightsCount : undefined,
    },
    {
      id: 'brain',
      group: 'nav_group_command',
      label: t(lang, 'nav_brain'),
      icon: Brain,
    },
    {
      id: 'memory',
      group: 'nav_group_command',
      label: t(lang, 'nav_memory'),
      icon: Network,
    },
    {
      id: 'workspace',
      group: 'nav_group_engineering',
      label: t(lang, 'nav_workspace'),
      icon: FolderGit2,
      counter: projects.length > 1 ? projects.length : undefined,
    },
    {
      id: 'chat',
      group: 'nav_group_engineering',
      label: t(lang, 'nav_chat'),
      icon: MessageSquare,
      counter: store.rooms.length,
    },
    {
      id: 'swarm',
      group: 'nav_group_engineering',
      label: t(lang, 'nav_swarm'),
      icon: Boxes,
    },
    {
      id: 'orbit',
      group: 'nav_group_engineering',
      label: t(lang, 'nav_orbit'),
      icon: Radar,
      counter: pendingSelfLearnCount > 0 ? pendingSelfLearnCount : undefined,
    },
    {
      id: 'workflows',
      group: 'nav_group_engineering',
      label: t(lang, 'nav_workflows'),
      icon: WorkflowIcon,
    },
    {
      id: 'mcp',
      group: 'nav_group_ecosystem',
      label: t(lang, 'nav_mcp'),
      icon: Server,
    },
    {
      id: 'skills',
      group: 'nav_group_ecosystem',
      label: t(lang, 'nav_skills'),
      icon: Blocks,
    },
    {
      id: 'devices',
      group: 'nav_group_ecosystem',
      label: t(lang, 'nav_devices'),
      icon: Cpu,
    },
    {
      id: 'authority',
      group: 'nav_group_ecosystem',
      label: t(lang, 'nav_authority'),
      icon: ShieldCheck,
      counter: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
    },
  ];

  const visibleNavIds = new Set(
    getVisibleSidebarIds(
      navItems.map((n) => n.id),
      focusModeEnabled,
      activeSection,
      pendingApprovalsCount
    )
  );
  const displayedNavItems = navItems.filter((item) => visibleNavIds.has(item.id));
  const navGroups: NavGroupKey[] = [
    'nav_group_command',
    'nav_group_engineering',
    'nav_group_ecosystem',
  ];

  const activeNavObj = navItems.find((n) => n.id === activeSection) || navItems[0];
  const externalBrainOnline = Boolean(
    boot.brain8765?.httpOnline || boot.brain8765?.sqliteWalDetected
  );
  const proactiveProjectsCount = projects.filter((p) => p.proactiveEnabled).length;
  const quotaPct =
    store.quota5h && store.quota5h.budgetTokens5h > 0
      ? Math.min(
          100,
          Math.round((store.quota5h.consumedTokens5h / store.quota5h.budgetTokens5h) * 100)
        )
      : 14;
  const isCompactRail = focusModeEnabled || !railExpanded;

  return (
    <div className="min-h-screen jarvis-canvas-bg text-slate-100 flex transition-colors duration-200">
      {/* Stark HUD Compact Tactical Icon Rail (68px default, expandable to 232px) */}
      <aside
        data-testid="stark-tactical-rail"
        data-focus-sidebar={isCompactRail ? 'compact' : 'full'}
        className={`hidden lg:flex lg:flex-col shrink-0 hud-rail justify-between transition-colors duration-200 z-30 ${
          isCompactRail ? 'lg:w-[68px] items-center py-3.5 px-2' : 'lg:w-[232px] py-3.5 px-3'
        }`}
      >
        <div className={`w-full ${isCompactRail ? 'space-y-3 flex flex-col items-center' : 'space-y-4'}`}>
          {/* Brand Monogram + Rail Expand Control */}
          <div
            className={`w-full flex items-center ${
              isCompactRail ? 'flex-col gap-2' : 'justify-between gap-2 px-1'
            }`}
          >
            <button
              type="button"
              onClick={() => handleNavigate('brief')}
              aria-label="J.A.R.V.I.S. Cortex OS"
              title="J.A.R.V.I.S. Cortex OS · Mark-VII"
              className={`focus:outline-none ${
                isCompactRail
                  ? 'w-10 h-10 rounded-lg bg-[#0b1322] border border-amber-400/40 hover:border-amber-400/75 flex items-center justify-center text-sm font-bold text-amber-300 font-display transition-colors'
                  : 'text-left flex items-center gap-2.5 min-w-0'
              }`}
            >
              {isCompactRail ? (
                <span>J</span>
              ) : (
                <>
                  <span className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-400/45 flex items-center justify-center text-xs font-bold text-amber-300 font-display shrink-0">
                    J
                  </span>
                  <div className="min-w-0">
                    <span className="block text-sm font-bold tracking-tight text-slate-100 font-display whitespace-nowrap">
                      J.A.R.V.I.S. HUD
                    </span>
                    <span className="block text-[11px] text-slate-400 font-mono truncate">
                      MARK-VII · v3.0
                    </span>
                  </div>
                </>
              )}
            </button>

            {!focusModeEnabled && (
              <button
                type="button"
                onClick={() => setRailExpanded((prev) => !prev)}
                aria-label={railExpanded ? 'Recolher rail lateral' : 'Expandir rail lateral'}
                title={railExpanded ? 'Recolher rail lateral' : 'Expandir rail lateral'}
                className="p-1.5 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors shrink-0"
              >
                {railExpanded ? (
                  <PanelLeftClose className="w-4 h-4" />
                ) : (
                  <PanelLeftOpen className="w-4 h-4" />
                )}
              </button>
            )}
          </div>

          {/* Grouped Tactical Navigation */}
          <nav aria-label="Navegação Principal" className="w-full space-y-2.5">
            {navGroups.map((groupKey, groupIdx) => {
              const groupItems = displayedNavItems.filter((i) => i.group === groupKey);
              if (groupItems.length === 0) return null;
              return (
                <div
                  key={groupKey}
                  className={`space-y-1 ${
                    groupIdx > 0 ? 'pt-2.5 border-t border-cyan-500/15' : ''
                  }`}
                >
                  {!isCompactRail && (
                    <p className="px-2 pb-0.5 text-[10px] font-mono tracking-wider text-slate-500 truncate">
                      {t(lang, groupKey)}
                    </p>
                  )}
                  {groupItems.map((item) => {
                    const Icon = item.icon;
                    const active = item.id === activeSection;
                    const isAlert = item.id === 'authority' && (item.counter ?? 0) > 0;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleNavigate(item.id)}
                        aria-label={item.label}
                        title={isCompactRail ? item.label : undefined}
                        aria-current={active ? 'page' : undefined}
                        className={`group relative w-full flex items-center rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          isCompactRail
                            ? 'justify-center h-10 w-10 mx-auto'
                            : 'justify-between gap-2.5 px-2.5 py-2'
                        } ${
                          active
                            ? 'text-amber-300'
                            : 'text-slate-400 hover:text-cyan-200 hover:bg-cyan-500/10'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="active-sidebar-nav"
                            transition={
                              prefersReducedMotion
                                ? { duration: 0 }
                                : { duration: 0.16, ease: [0.16, 1, 0.3, 1] }
                            }
                            className="absolute inset-0 rounded-lg bg-amber-500/12 border border-amber-400/45"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={`relative z-10 flex items-center ${
                            isCompactRail ? 'justify-center' : 'gap-2.5 min-w-0'
                          }`}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          {!isCompactRail && <span className="truncate">{item.label}</span>}
                        </span>

                        {item.counter !== undefined && !isCompactRail && (
                          <span
                            className={`relative z-10 font-mono tabular-nums text-[11px] ${
                              isAlert ? 'text-amber-300 font-semibold' : 'text-cyan-300/80'
                            }`}
                          >
                            {item.counter}
                          </span>
                        )}

                        {item.counter !== undefined && isCompactRail && (
                          <span
                            aria-hidden="true"
                            className={`absolute -top-0.5 -right-0.5 z-10 min-w-[15px] h-[15px] px-1 rounded text-[9px] font-mono tabular-nums flex items-center justify-center ${
                              isAlert
                                ? 'bg-amber-500 text-slate-950 font-bold'
                                : 'bg-[#0b1526] border border-cyan-400/45 text-cyan-200'
                            }`}
                          >
                            {item.counter}
                          </span>
                        )}

                        {/* Instant Tactical Tooltip when Rail is Compact */}
                        {isCompactRail && (
                          <span
                            role="tooltip"
                            className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-full ml-2.5 px-2.5 py-1 rounded-md bg-[#09111f] border border-cyan-400/35 text-[11px] font-medium text-slate-100 shadow-lg whitespace-nowrap z-50"
                          >
                            {item.label}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </div>

        {/* Bottom Rail Acoustic Reactor & Telemetry Anchor */}
        <div className="w-full pt-3 border-t border-cyan-500/15 space-y-2">
          <PebbleWidget
            settings={store.settings}
            compactRail={isCompactRail}
            onToggleWakeWord={async (enabled) => {
              await apiJson('/api/settings', {
                method: 'PATCH',
                body: JSON.stringify({ wakeWordEnabled: enabled }),
              });
              await refreshBootstrap();
            }}
            onVoiceDirective={handleQuickDirective}
          />

          {isCompactRail ? (
            <button
              type="button"
              onClick={() => handleNavigate('brain')}
              aria-label={`Estado do Cérebro: ${externalBrainOnline ? 'Híbrido 8765' : 'Nativo 100%'}`}
              title={`Cérebro Jarvis: ${externalBrainOnline ? 'Híbrido :8765' : 'Nativo 100%'} · ${
                sseConnected ? 'SSE Live' : 'Sync'
              }`}
              className="w-10 h-8 mx-auto rounded-lg bg-[#09111f] border border-cyan-500/25 hover:border-cyan-400/55 flex items-center justify-center text-[10px] font-mono tabular-nums text-cyan-300 transition-colors"
            >
              {externalBrainOnline ? '8765' : '100%'}
            </button>
          ) : (
            <div className="px-1.5 pt-1 space-y-1 text-[11px] text-slate-400 font-mono tabular-nums">
              <div className="flex items-center justify-between">
                <span>Stream · DB</span>
                <span className="text-slate-200">
                  {sseConnected ? 'SSE Live' : 'Sync'} · {boot.storageEngine.split(' ')[0]}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleNavigate('brain')}
                className="w-full flex items-center justify-between text-left hover:text-cyan-200 transition-colors"
              >
                <span>Cérebro</span>
                <span className={externalBrainOnline ? 'text-amber-300' : 'text-cyan-300'}>
                  {externalBrainOnline ? 'HÍBRIDO :8765' : 'NATIVO 100%'}
                </span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden bg-black/80 flex"
          onClick={() => setMobileMenuOpen(false)}
        >
          <aside
            className="w-72 hud-rail p-4 space-y-4 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-slate-100 font-display">
                J.A.R.V.I.S. HUD
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Fechar menu"
                className="p-1 text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = item.id === activeSection;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap ${
                      active
                        ? 'bg-amber-500/15 border border-amber-400/40 text-amber-300'
                        : 'text-slate-300 hover:bg-cyan-500/10'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </span>
                    {item.counter !== undefined && (
                      <span className="font-mono tabular-nums text-amber-300">{item.counter}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Wide Tactical Command Center Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 3-Zone Stark Top HUD Bar */}
        <header className="sticky top-0 z-20 h-14 px-6 bg-[#050912]/96 border-b border-cyan-500/18 flex items-center justify-between gap-6">
          {/* Zone 1: Brand Breadcrumb + Concurrent Multi-Project Context */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir navegação"
              className="lg:hidden p-1.5 text-slate-300 hover:text-white rounded-md bg-[#0b1322] border border-cyan-500/25"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 text-sm whitespace-nowrap shrink-0">
              <span className="font-mono text-xs tracking-wider text-amber-300 hidden sm:inline">
                MARK-VII
              </span>
              <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-semibold text-slate-100 font-display whitespace-nowrap">
                {activeNavObj.label}
              </span>
            </div>

            {!focusModeEnabled && projects.length > 0 && (
              <div className="hidden md:flex items-center gap-1.5 pl-3 ml-1 border-l border-cyan-500/20 min-w-0">
                <FolderGit2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <select
                  aria-label="Selecionar projeto ativo"
                  value={activeProject?.id || ''}
                  onChange={(e) => handleActivateProject(e.target.value)}
                  className="bg-[#080e1a] border border-cyan-500/25 hover:border-cyan-400/50 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-200 focus:outline-none focus:border-amber-400 max-w-48 truncate"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.rootPath})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setProjectsModalOpen(true)}
                  title="Gerir múltiplos projetos simultâneos e proatividade"
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono tabular-nums rounded-lg bg-[#080e1a] border border-cyan-500/25 text-cyan-200 hover:text-amber-300 hover:border-amber-400/50 transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3 h-3" />
                  <span>{projects.length} Proj</span>
                </button>
              </div>
            )}
          </div>

          {/* Zone 2: Unboxed Tactical HUD Telemetry Strip (Zero-Pill Discipline) */}
          {!focusModeEnabled && (
            <div
              className={`${
                railExpanded ? 'hidden 2xl:flex' : 'hidden xl:flex'
              } items-center gap-2.5 text-xs font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0`}
            >
              <button
                type="button"
                onClick={() => handleNavigate('brain')}
                className="hover:text-cyan-200 transition-colors whitespace-nowrap"
              >
                Cérebro{' '}
                <span className={externalBrainOnline ? 'text-amber-300' : 'text-cyan-300'}>
                  {externalBrainOnline ? 'Híbrido :8765' : 'Nativo 100%'}
                </span>
              </button>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                onClick={() => setProjectsModalOpen(true)}
                className="hover:text-cyan-200 transition-colors whitespace-nowrap"
              >
                Proatividade{' '}
                <span className="text-slate-200">
                  {proactiveProjectsCount}/{projects.length} ON
                </span>
              </button>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span>
                Quota 5h <span className="text-amber-300">{quotaPct}%</span>
              </span>
            </div>
          )}

          {/* Zone 3: Language Switcher + Focus Mode + Command Palette Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            {!focusModeEnabled && (
              <div className="hidden sm:flex items-center p-0.5 bg-[#080e1a] border border-cyan-500/20 rounded-lg">
                {(['pt-PT', 'en-US'] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => handleLanguageSwitch(code)}
                    className={`px-2 py-1 text-[11px] font-mono rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      lang === code
                        ? 'bg-cyan-500/18 text-cyan-200'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {code.toUpperCase()}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleToggleFocusMode}
              aria-pressed={focusModeEnabled}
              title="Alternar Modo Foco Noturno (Ctrl+Shift+F)"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                focusModeEnabled
                  ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                  : 'bg-[#080e1a] border-cyan-500/25 text-slate-300 hover:text-amber-200 hover:border-amber-400/45'
              }`}
            >
              <Moon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="hidden 2xl:inline">
                {t(lang, focusModeEnabled ? 'focus_mode_on' : 'focus_mode_btn')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold bg-amber-500/15 border border-amber-400/50 text-amber-200 rounded-lg hover:bg-amber-500/25 hover:border-amber-300 transition-colors whitespace-nowrap shrink-0"
            >
              <Command className="w-3.5 h-3.5 text-amber-300" />
              <span>{t(lang, 'cmd_palette_btn')}</span>
            </button>
          </div>
        </header>

        {/* Active View Viewport */}
        <main className="relative flex-1 flex flex-col w-full">
          <div
            ref={progressBarRef}
            role="progressbar"
            aria-label={lang === 'pt-PT' ? 'Progresso da vista ativa' : 'Active view progress'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(activeStepCompletion * 100)}
            data-progress-mode="step"
            data-step-completion={Math.round(activeStepCompletion * 100)}
            className="sticky top-14 z-20 h-[2px] w-full bg-slate-900/80 overflow-hidden pointer-events-none"
          >
            <motion.div
              className="absolute inset-y-0 left-0 w-full origin-left bg-cyan-400/20"
              initial={false}
              animate={{ scaleX: activeStepCompletion }}
              transition={
                prefersReducedMotion
                  ? { duration: 0 }
                  : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }
              }
            />
            <motion.div
              className="absolute inset-y-0 left-0 w-full origin-left bg-gradient-to-r from-amber-400 via-cyan-400 to-cyan-300"
              style={{ scaleX: prefersReducedMotion ? rawProgress : smoothProgress }}
            />
          </div>

          <div
            ref={mainContentRef}
            className="flex-1 p-6 max-w-[1440px] w-full mx-auto pb-24 overflow-x-hidden"
          >
            <AnimatePresence
              mode="wait"
              initial={false}
              onExitComplete={() => {
                if (typeof window !== 'undefined') {
                  window.scrollTo({ top: 0 });
                }
                syncViewportProgress();
              }}
            >
              <motion.div
                key={activeSection}
                data-active-view={activeSection}
                initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : { duration: 0.16, ease: [0.16, 1, 0.3, 1] }
                }
                className="w-full"
              >
                {activeSection === 'brief' && (
                  <BriefView
                    store={
                      isAutostart
                        ? { ...store, settings: { ...store.settings, onboardingCompleted: true } }
                        : store
                    }
                    onRefreshBootstrap={refreshBootstrap}
                    onOpenWizard={() => setWizardOpen(true)}
                    onSkipWizard={() => handleWizardSave({ onboardingCompleted: true })}
                    onNavigate={handleNavigate}
                    onOpenProjectsModal={() => setProjectsModalOpen(true)}
                  />
                )}

                {activeSection === 'brain' && (
                  <BrainView
                    store={store}
                    initialBrain8765={boot.brain8765}
                    onRefreshBootstrap={refreshBootstrap}
                    onNavigate={handleNavigate}
                  />
                )}

                {activeSection === 'chat' && (
                  <ChatRoomsView
                    store={store}
                    initialRoomId={subTargetId}
                    onRefreshBootstrap={refreshBootstrap}
                  />
                )}

                {activeSection === 'swarm' && (
                  <SwarmView
                    onRefreshBootstrap={refreshBootstrap}
                    onOpenWorkspaceFile={(fp) => handleNavigate('workspace', fp)}
                  />
                )}

                {activeSection === 'orbit' && (
                  <OrbitView onRefreshBootstrap={refreshBootstrap} />
                )}

                {activeSection === 'mcp' && (
                  <McpGatewayView
                    onRefreshBootstrap={refreshBootstrap}
                    onNavigate={handleNavigate}
                  />
                )}

                {activeSection === 'workflows' && (
                  <WorkflowsView store={store} onRefreshBootstrap={refreshBootstrap} />
                )}

                {activeSection === 'workspace' && (
                  <WorkspaceView
                    store={store}
                    initialFilePath={subTargetId}
                    onRefreshBootstrap={refreshBootstrap}
                    onOpenProjectsModal={() => setProjectsModalOpen(true)}
                  />
                )}

                {activeSection === 'memory' && (
                  <MemoryGraphView
                    store={store}
                    initialSeedId={subTargetId}
                    pprNodesInitial={boot.pprNodes}
                    onRefreshBootstrap={refreshBootstrap}
                  />
                )}

                {activeSection === 'skills' && (
                  <SkillsChannelsView store={store} onRefreshBootstrap={refreshBootstrap} />
                )}

                {activeSection === 'devices' && (
                  <DevicesSidecarView
                    store={store}
                    initialTelemetry={boot.telemetry}
                    onRefreshBootstrap={refreshBootstrap}
                  />
                )}

                {activeSection === 'authority' && (
                  <AuthoritySettingsView
                    store={store}
                    geminiAvailable={boot.geminiAvailable}
                    openRouterAvailable={Boolean(boot.openRouterAvailable)}
                    brain8765={boot.brain8765}
                    storageEngine={boot.storageEngine}
                    onRefreshBootstrap={refreshBootstrap}
                    onOpenWizard={() => setWizardOpen(true)}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Multi-Project Portfolio & Proactivity Manager Modal */}
      {projectsModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Gestor Multi-Projeto Simultâneo"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#02050c]/85"
          onClick={() => setProjectsModalOpen(false)}
        >
          <div
            className="w-full max-w-3xl hud-panel hud-corner-frame rounded-xl p-6 space-y-5 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-amber-400">
                  Execução Paralela · Carteira Tática Stark HUD
                </p>
                <h2 className="text-lg font-bold text-slate-100 font-display">
                  Projetos Simultâneos & Proatividade Autónoma
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Trabalha em vários repositórios ou sub-módulos em simultâneo. Quando a
                  proatividade está ativa num projeto, o Jarvis vigia alterações Git, acoplamento
                  AST e contratos, sugerindo intervenções 1-clique.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProjectsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-100"
                aria-label="Fechar gestor de projetos"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Projects Portfolio Summary Card: Total Projects, Total Active Hours & Running Autonomous Background Agents */}
            {(() => {
              const portfolioSummary = computeProjectsPortfolioSummary({
                projects,
                rooms: store.rooms,
                dotsTasks: store.dotsTasks,
                swarmRuns: store.swarmRuns,
                heartbeatTotalBeats: store.heartbeat?.totalBeats ?? 0,
              });

              return (
                <div
                  data-testid="projects-portfolio-summary-card"
                  className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-[#07090e] border border-slate-800/90"
                >
                  <div className="p-3 rounded-lg bg-[#0d1117] border border-slate-800/80 flex items-start justify-between gap-2.5">
                    <div>
                      <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                        Total de Projetos
                      </p>
                      <p
                        data-testid="summary-total-projects"
                        className="text-xl font-bold text-slate-100 font-display tabular-nums mt-1"
                      >
                        {portfolioSummary.totalProjects}
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                        {portfolioSummary.activeProjectsCount} ativos ·{' '}
                        {portfolioSummary.proactiveProjectsCount} vigiados
                      </p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-300 shrink-0">
                      <FolderGit2 className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-[#0d1117] border border-slate-800/80 flex items-start justify-between gap-2.5">
                    <div>
                      <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                        Horas Ativas Acumuladas
                      </p>
                      <p
                        data-testid="summary-active-hours"
                        className="text-xl font-bold text-cyan-300 font-display tabular-nums mt-1"
                      >
                        {portfolioSummary.totalActiveHours}h
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                        Engenharia + vigilância AST/Git
                      </p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-300 shrink-0">
                      <Clock className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-[#0d1117] border border-slate-800/80 flex items-start justify-between gap-2.5">
                    <div>
                      <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                        Agentes Autónomos Ativos
                      </p>
                      <p
                        data-testid="summary-running-agents"
                        className="text-xl font-bold text-emerald-400 font-display tabular-nums mt-1"
                      >
                        {portfolioSummary.runningBackgroundAgents}
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                        Em background ({portfolioSummary.uniqueAssignedAgentsCount} salas alocadas)
                      </p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-300 shrink-0">
                      <Bot className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Bulk Enable/Disable Proactivity Switch Bar */}
            {(() => {
              const enabledCount = projects.filter((p) => p.proactiveEnabled).length;
              const totalCount = projects.length;
              const allProactiveEnabled = totalCount > 0 && enabledCount === totalCount;
              const partiallyEnabled = enabledCount > 0 && enabledCount < totalCount;

              return (
                <div
                  data-testid="bulk-proactivity-bar"
                  className="p-3.5 rounded-xl bg-[#07090e] border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start sm:items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                        allProactiveEnabled
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : partiallyEnabled
                            ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                            : 'bg-[#0d1117] border-slate-800 text-slate-400'
                      }`}
                    >
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-xs font-semibold text-slate-100">
                          Ativar / Desativar Proatividade em Massa
                        </span>
                        <span
                          className={`text-[11px] font-mono tabular-nums ${
                            allProactiveEnabled
                              ? 'text-emerald-400'
                              : partiallyEnabled
                                ? 'text-cyan-300'
                                : 'text-slate-500'
                          }`}
                        >
                          · {enabledCount}/{totalCount} ativos
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Alterna simultaneamente o motor proativo (Git, AST e Contratos) para todos os
                        projetos registados.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
                    <span className="text-[11px] font-mono text-slate-400">
                      {bulkTogglingProactive
                        ? 'A sincronizar...'
                        : allProactiveEnabled
                          ? 'Todos ON'
                          : partiallyEnabled
                            ? 'Parcial'
                            : 'Todos OFF'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={allProactiveEnabled}
                      aria-label="Ativar ou Desativar Proatividade em Massa"
                      disabled={bulkTogglingProactive || totalCount === 0}
                      onClick={() => handleBulkToggleProjectProactive(!allProactiveEnabled)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                        allProactiveEnabled
                          ? 'bg-emerald-500 border-emerald-400'
                          : partiallyEnabled
                            ? 'bg-cyan-500/50 border-cyan-400/60'
                            : 'bg-slate-800 border-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-slate-950 shadow-xs transition duration-200 mt-0.5 ${
                          allProactiveEnabled
                            ? 'translate-x-5.5 bg-slate-950'
                            : partiallyEnabled
                              ? 'translate-x-3 bg-white'
                              : 'translate-x-0.5 bg-slate-300'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              );
            })()}

            <div className="space-y-2.5">
              {projects.map((proj) => {
                const isActive = proj.id === store.activeProjectId;
                const openCount = (proj.proactiveInsights || []).filter(
                  (i) => i.status === 'OPEN'
                ).length;
                const freqStats = computeProjectProactiveFrequency(proj, 124, 26);
                const sparkColor = proj.proactiveEnabled ? '#34d399' : '#64748b';
                const sparkFill = proj.proactiveEnabled
                  ? 'rgba(52, 211, 153, 0.14)'
                  : 'rgba(100, 116, 139, 0.1)';

                return (
                  <div
                    key={proj.id}
                    className={`p-4 rounded-xl border transition-colors ${
                      isActive
                        ? 'bg-[#131a24] border-cyan-500/50'
                        : 'bg-[#07090e] border-slate-800/90'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono">
                          <span className="font-sans text-sm font-semibold text-slate-100">
                            {proj.name}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span className="text-cyan-300">{proj.rootPath}</span>
                          <span className="text-slate-600">·</span>
                          <span className="text-slate-400">{proj.techStack}</span>
                          <span className="text-slate-600">·</span>
                          <span className="text-emerald-400 tabular-nums">
                            Saúde {proj.healthScore}%
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">{proj.description}</p>
                        <p className="text-[11px] font-mono text-slate-500">
                          Branch {proj.gitBranch} · {proj.assignedAgentIds.length} agentes alocados ·{' '}
                          {openCount} recomendação(ões) proativas abertas
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 shrink-0">
                        {/* Proactive Intervention Frequency SVG Sparkline */}
                        <div
                          data-testid={`proj-sparkline-${proj.id}`}
                          className="px-2.5 py-1.5 rounded-lg bg-[#0b0f17] border border-slate-800/80 flex items-center gap-2.5"
                          title={`Frequência de intervenção proativa: atual ${freqStats.currentPerHour}/h · média ${freqStats.avgPerHour}/h · pico ${freqStats.peakPerHour}/h`}
                        >
                          <div className="space-y-0.5">
                            <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                              Freq. Proativa
                            </p>
                            <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
                              <span
                                className={`text-xs font-semibold ${
                                  proj.proactiveEnabled ? 'text-emerald-300' : 'text-slate-500'
                                }`}
                              >
                                {freqStats.currentPerHour}/h
                              </span>
                              <span className="text-[10px] text-slate-500">
                                pico {freqStats.peakPerHour}
                              </span>
                            </div>
                          </div>

                          <svg
                            width={124}
                            height={26}
                            viewBox="0 0 124 26"
                            role="img"
                            aria-label={`Tendência de intervenção proativa de ${proj.name}: ${freqStats.currentPerHour} intervenções por hora`}
                            className="overflow-visible shrink-0"
                          >
                            <path d={freqStats.areaPath} fill={sparkFill} />
                            <polyline
                              fill="none"
                              stroke={sparkColor}
                              strokeWidth="1.75"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={freqStats.polylinePoints}
                            />
                          </svg>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleProjectProactive(proj.id, !proj.proactiveEnabled)
                            }
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                              proj.proactiveEnabled
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                : 'bg-[#0d1117] border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            {proj.proactiveEnabled ? 'Proativo ON' : 'Proativo OFF'}
                          </button>

                          {!isActive && (
                            <button
                              type="button"
                              onClick={() => handleActivateProject(proj.id)}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors"
                            >
                              Focar
                            </button>
                          )}

                          {projects.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteProject(proj.id)}
                              aria-label={`Remover ${proj.name}`}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Register New Concurrent Project */}
            <form
              onSubmit={handleCreateProject}
              className="pt-4 border-t border-slate-800 space-y-3"
            >
              <p className="text-xs font-semibold text-slate-200">
                Registar Novo Projeto em Paralelo
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  placeholder="Nome do projeto (ex: Sidecar Desktop Rust)"
                  className="px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                />
                <input
                  type="text"
                  value={newProjPath}
                  onChange={(e) => setNewProjPath(e.target.value)}
                  placeholder="Caminho raiz ou subpasta (ex: jarvis_os)"
                  className="px-3 py-2 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                />
                <input
                  type="text"
                  value={newProjStack}
                  onChange={(e) => setNewProjStack(e.target.value)}
                  placeholder="Stack (ex: Python 3.11 · SQLite)"
                  className="px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <input
                  type="text"
                  value={newProjDesc}
                  onChange={(e) => setNewProjDesc(e.target.value)}
                  placeholder="Objetivo ou descrição breve do projeto..."
                  className="flex-1 px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                />
                <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={newProjProactive}
                    onChange={(e) => setNewProjProactive(e.target.checked)}
                    className="rounded border-slate-700 bg-[#07090e] text-cyan-500"
                  />
                  Ativar Proatividade
                </label>
                <button
                  type="submit"
                  disabled={creatingProj}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors shrink-0"
                >
                  {creatingProj ? 'A criar...' : '+ Adicionar Projeto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Elements */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        store={store}
        onNavigate={handleNavigate}
        onSwitchProject={handleActivateProject}
        onRunWorkflow={handleRunWorkflowFromPalette}
        onQuickDirective={(txt) => {
          handleQuickDirective(txt);
        }}
        onToggleFocusMode={handleToggleFocusMode}
      />

      <div className="fixed bottom-4 right-4 z-40 lg:hidden">
        <PebbleWidget
          settings={store.settings}
          compactRail={true}
          onToggleWakeWord={async (enabled) => {
            await apiJson('/api/settings', {
              method: 'PATCH',
              body: JSON.stringify({ wakeWordEnabled: enabled }),
            });
            await refreshBootstrap();
          }}
          onVoiceDirective={handleQuickDirective}
        />
      </div>

      <WelcomeWizardModal
        open={wizardOpen}
        settings={store.settings}
        onClose={() => setWizardOpen(false)}
        onSave={handleWizardSave}
      />
    </div>
  );
};

export const App: React.FC = () => (
  <ToastProvider>
    <InnerApp />
  </ToastProvider>
);

export default App;
