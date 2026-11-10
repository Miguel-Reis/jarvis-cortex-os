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
} from 'lucide-react';
import { apiJson } from './lib/api';
import { t, type NavSectionId } from './lib/i18n';
import { ToastProvider, useToast } from './components/ToastContext';
import { CommandPalette } from './components/CommandPalette';
import { PebbleWidget } from './components/PebbleWidget';
import { WelcomeWizardModal } from './components/WelcomeWizardModal';
import { BriefView } from './components/views/BriefView';
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
import { computeViewStepCompletion, getVisibleSidebarIds } from './shared/cortex-math';

interface BootstrapPayload {
  storageEngine: string;
  geminiAvailable: boolean;
  activePort: number;
  brain8765?: BrainLiveStatus;
  state: JarvisStoreData;
  pprNodes: GraphNodeComputed[];
  telemetry: OSTelemetry;
}

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
  const [sseConnected, setSseConnected] = useState(false);

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
    // Ignore minor overflow caused solely by the pb-24 (96px) floating Pebble clearance
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
      setBoot(data);
      setErrorMsg(null);
    } catch (err) {
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
    es.addEventListener('connected', () => setSseConnected(true));
    es.addEventListener('state_updated', () => {
      refreshBootstrap();
    });
    es.addEventListener('workflow_run', () => {
      refreshBootstrap();
    });
    es.addEventListener('swarm_progress', () => {
      refreshBootstrap();
    });
    es.addEventListener('heartbeat', () => {
      refreshBootstrap();
    });
    es.onerror = () => {
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

    // Optimistic UI update for zero-latency visual response
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

  // Global Ctrl+K / Cmd+K (Command Palette) & Ctrl+Shift+F (Focus Mode) shortcuts
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
      <div className="min-h-screen bg-[#07090e] flex items-center justify-center p-6">
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
      <div className="min-h-screen bg-[#07090e] flex items-center justify-center p-6">
        <div className="max-w-md bg-[#0d1117] border border-rose-500/40 rounded-xl p-6 space-y-4">
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

  // Check `?autostart=1` so automated tests or direct links can suppress setup banner if desired
  const isAutostart =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('autostart') === '1';

  const pendingSelfLearnCount = (store.selfLearnQueue || []).filter(
    (c) => c.status === 'PENDING'
  ).length;

  const navItems: {
    id: NavSectionId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    counter?: number;
  }[] = [
    { id: 'brief', label: t(lang, 'nav_brief'), icon: LayoutDashboard },
    { id: 'chat', label: t(lang, 'nav_chat'), icon: MessageSquare },
    { id: 'swarm', label: t(lang, 'nav_swarm'), icon: Boxes },
    {
      id: 'orbit',
      label: t(lang, 'nav_orbit'),
      icon: Radar,
      counter: pendingSelfLearnCount > 0 ? pendingSelfLearnCount : undefined,
    },
    {
      id: 'mcp',
      label: t(lang, 'nav_mcp'),
      icon: Server,
    },
    { id: 'workflows', label: t(lang, 'nav_workflows'), icon: WorkflowIcon },
    { id: 'workspace', label: t(lang, 'nav_workspace'), icon: FolderGit2 },
    { id: 'memory', label: t(lang, 'nav_memory'), icon: Network },
    { id: 'skills', label: t(lang, 'nav_skills'), icon: Blocks },
    { id: 'devices', label: t(lang, 'nav_devices'), icon: Cpu },
    {
      id: 'authority',
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

  const activeNavObj = navItems.find((n) => n.id === activeSection) || navItems[0];

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex transition-colors duration-200">
      {/* Desktop Sidebar: Full 264px in Standard Mode, Minimal 64px Icon Rail in Modo Foco */}
      <aside
        data-focus-sidebar={focusModeEnabled ? 'compact' : 'full'}
        className={`hidden lg:flex lg:flex-col shrink-0 bg-[#0d1117] border-r border-slate-800/80 justify-between transition-colors duration-200 ${
          focusModeEnabled ? 'lg:w-16 items-center py-4 px-2' : 'lg:w-66 p-4'
        }`}
      >
        <div className={`w-full ${focusModeEnabled ? 'space-y-5 flex flex-col items-center' : 'space-y-6'}`}>
          <div className={focusModeEnabled ? 'pt-0.5' : 'px-2 pt-1'}>
            <button
              type="button"
              onClick={() => handleNavigate('brief')}
              aria-label="J.A.R.V.I.S. Cortex OS"
              title="J.A.R.V.I.S. Cortex OS"
              className={`focus:outline-none ${
                focusModeEnabled
                  ? 'w-10 h-10 rounded-lg bg-[#151c26] border border-slate-800 flex items-center justify-center text-sm font-bold text-cyan-300 font-display'
                  : 'text-left'
              }`}
            >
              {focusModeEnabled ? (
                <span>J.</span>
              ) : (
                <span className="text-base font-bold tracking-tight text-slate-100 font-display whitespace-nowrap">
                  J.A.R.V.I.S. Cortex OS
                </span>
              )}
            </button>
            {!focusModeEnabled && (
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {store.settings.organizationName} · v3.0 × Brain v7.2
              </p>
            )}
          </div>

          <nav aria-label="Navegação Principal" className="w-full space-y-1">
            {displayedNavItems.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeSection;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  aria-label={item.label}
                  title={focusModeEnabled ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={`relative w-full flex items-center rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    focusModeEnabled
                      ? 'justify-center p-2.5'
                      : 'justify-between gap-2.5 px-3 py-2.5'
                  } ${
                    active
                      ? 'text-cyan-300'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-[#151c26]/50'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="active-sidebar-nav"
                      transition={
                        prefersReducedMotion
                          ? { duration: 0 }
                          : { duration: 0.18, ease: [0.16, 1, 0.3, 1] }
                      }
                      className="absolute inset-0 rounded-lg bg-[#151c26] border border-slate-700/80"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={`relative z-10 flex items-center min-w-0 ${
                      focusModeEnabled ? 'justify-center' : 'gap-2.5'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {!focusModeEnabled && <span className="truncate">{item.label}</span>}
                  </span>
                  {!focusModeEnabled && item.counter !== undefined && (
                    <span className="relative z-10 font-mono tabular-nums text-amber-400 text-xs">
                      {item.counter}
                    </span>
                  )}
                  {focusModeEnabled && item.counter !== undefined && (
                    <span className="relative z-10 ml-1 font-mono tabular-nums text-amber-400 text-[10px]">
                      {item.counter}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Hide non-critical footer connection metadata in Modo Foco */}
        {!focusModeEnabled && (
          <div className="pt-4 border-t border-slate-800/80 px-2 space-y-2 text-xs text-slate-500">
            <div className="flex items-center justify-between font-mono tabular-nums">
              <span>SSE Stream</span>
              <span className={sseConnected ? 'text-emerald-400' : 'text-slate-500'}>
                {sseConnected ? 'Conectado' : 'Reconectando'}
              </span>
            </div>
            <div className="flex items-center justify-between font-mono tabular-nums">
              <span>Motor DB</span>
              <span className="text-slate-300">{boot.storageEngine}</span>
            </div>
            <div className="flex items-center justify-between font-mono tabular-nums">
              <span>Brain :8765</span>
              <span
                className={
                  boot.brain8765?.httpOnline || boot.brain8765?.sqliteWalDetected
                    ? 'text-emerald-400'
                    : 'text-cyan-400'
                }
              >
                {boot.brain8765?.httpOnline || boot.brain8765?.sqliteWalDetected
                  ? 'HYBRID LIVE'
                  : 'NATIVO v7.2'}
              </span>
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden bg-black/75 flex"
          onClick={() => setMobileMenuOpen(false)}
        >
          <aside
            className="w-68 bg-[#0d1117] border-r border-slate-800 p-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-slate-100 font-display">
                J.A.R.V.I.S. Cortex OS
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
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium ${
                      active ? 'bg-[#151c26] text-cyan-300' : 'text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </span>
                    {item.counter !== undefined && (
                      <span className="font-mono text-amber-400">{item.counter}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean SaaS Top Header Contract: Contextual Breadcrumb Left + Primary Controls Right */}
        <header className="sticky top-0 z-30 h-14 px-6 bg-[#07090e]/90 backdrop-blur border-b border-slate-800/80 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir navegação"
              className="lg:hidden p-1.5 text-slate-300 hover:text-white rounded-md bg-[#151c26]"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-sm text-slate-400 truncate whitespace-nowrap">
              {!focusModeEnabled && (
                <>
                  <span className="text-slate-500">{store.settings.operatorName}</span>
                  <span aria-hidden="true"> / </span>
                </>
              )}
              <span className="font-semibold text-slate-100">{activeNavObj.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Hide secondary language switcher during Focus Mode */}
            {!focusModeEnabled && (
              <div className="hidden sm:flex items-center p-0.5 bg-[#0d1117] border border-slate-800 rounded-lg">
                {(['pt-PT', 'en-US'] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => handleLanguageSwitch(code)}
                    className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors whitespace-nowrap ${
                      lang === code ? 'bg-[#151c26] text-cyan-300' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {code.toUpperCase()}
                  </button>
                ))}
              </div>
            )}

            {/* Modo Foco Noturno Toggle (Ctrl+Shift+F) */}
            <button
              type="button"
              onClick={handleToggleFocusMode}
              aria-pressed={focusModeEnabled}
              title="Alternar Modo Foco Noturno (Ctrl+Shift+F)"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                focusModeEnabled
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                  : 'bg-[#0d1117] border-slate-800 text-slate-300 hover:text-slate-100 hover:border-slate-700'
              }`}
            >
              <Moon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{t(lang, focusModeEnabled ? 'focus_mode_on' : 'focus_mode_btn')}</span>
            </button>

            {/* Primary Action: Ctrl+K Command Palette */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium bg-[#151c26] border border-slate-700/90 text-slate-100 rounded-lg hover:border-cyan-500/60 transition-colors whitespace-nowrap shrink-0"
            >
              <Command className="w-3.5 h-3.5 text-cyan-400" />
              {t(lang, 'cmd_palette_btn')}
            </button>
          </div>
        </header>

        {/* Active View Viewport with Top Progress Bar & Smooth Framer Motion Transitions */}
        <main className="relative flex-1 flex flex-col w-full">
          {/* Subtle Top Progress Bar (tracks live scroll progress or active view step completion) */}
          <div
            ref={progressBarRef}
            role="progressbar"
            aria-label={lang === 'pt-PT' ? 'Progresso da vista ativa' : 'Active view progress'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(activeStepCompletion * 100)}
            data-progress-mode="step"
            data-step-completion={Math.round(activeStepCompletion * 100)}
            className="sticky top-14 z-20 h-[2px] w-full bg-slate-900/75 overflow-hidden pointer-events-none"
          >
            {/* Ambient baseline indicating module step completion */}
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
            {/* Primary indicator tracking scroll progress (when scrollable) or step completion */}
            <motion.div
              className="absolute inset-y-0 left-0 w-full origin-left bg-gradient-to-r from-cyan-500 via-cyan-400 to-emerald-400"
              style={{ scaleX: prefersReducedMotion ? rawProgress : smoothProgress }}
            />
          </div>

          <div
            ref={mainContentRef}
            className="flex-1 p-6 max-w-[1380px] w-full mx-auto pb-24 overflow-x-hidden"
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
                initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : { duration: 0.18, ease: [0.16, 1, 0.3, 1] }
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
                    initialFilePath={subTargetId}
                    onRefreshBootstrap={refreshBootstrap}
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
                    storageEngine={boot.storageEngine}
                    onRefreshBootstrap={refreshBootstrap}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Global Elements: Ctrl+K Command Palette, Floating 60 FPS Pebble Orb, and 3-Step Wizard */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        store={store}
        onNavigate={handleNavigate}
        onRunWorkflow={handleRunWorkflowFromPalette}
        onQuickDirective={(txt) => {
          handleQuickDirective(txt);
        }}
        onToggleFocusMode={handleToggleFocusMode}
      />

      <PebbleWidget
        settings={store.settings}
        onToggleWakeWord={async (enabled) => {
          await apiJson('/api/settings', {
            method: 'PATCH',
            body: JSON.stringify({ wakeWordEnabled: enabled }),
          });
          await refreshBootstrap();
        }}
        onVoiceDirective={handleQuickDirective}
      />

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
