import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Bell,
  Blocks,
  Bot,
  Boxes,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Command,
  Cpu,
  FolderGit2,
  Globe,
  KeyRound,
  Layers,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Radar,
  Server,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import { apiJson, loginOperatorToken } from './lib/api';
import { markViiAudio } from './lib/audio-dsp';
import { t, type NavSectionId } from './lib/i18n';
import { ToastProvider, useToast } from './components/ToastContext';
import { CommandPalette } from './components/CommandPalette';
import { PebbleWidget } from './components/PebbleWidget';
import { WelcomeWizardModal } from './components/WelcomeWizardModal';
import { StudioWorkspaceView } from './components/studio/StudioWorkspaceView';
import { BriefView } from './components/views/BriefView';
import { BrainView } from './components/views/BrainView';
import { ChatRoomsView } from './components/views/ChatRoomsView';
import { OrbitView } from './components/views/OrbitView';

const SwarmView = React.lazy(() =>
  import('./components/views/SwarmView').then((m) => ({ default: m.SwarmView }))
);
import { McpGatewayView } from './components/views/McpGatewayView';
import { WorkflowsView } from './components/views/WorkflowsView';
import { WorkspaceView } from './components/views/WorkspaceView';
import { MemoryGraphView } from './components/views/MemoryGraphView';
import { SkillsChannelsView } from './components/views/SkillsChannelsView';
import { DevicesSidecarView } from './components/views/DevicesSidecarView';
import { AuthoritySettingsView } from './components/views/AuthoritySettingsView';
import { LLMSettingsView } from './components/views/LLMSettingsView';
import {
  GENERAL_CHAT_PROJECT_ID,
  type AppSettings,
  type ApprovalRequest,
  type BrainLiveStatus,
  type ChatMessage,
  type ChatThread,
  type GraphNodeComputed,
  type JarvisStoreData,
  type LanguageCode,
  type OSTelemetry,
  type ProjectIdeaCategory,
  type ProjectWorkspace,
} from './shared/types';
import {
  computeProjectProactiveFrequency,
  computeProjectsPortfolioSummary,
  formatApprovalRequesterBadge,
  getVisibleSidebarIds,
  isGeneralUnlinkedChat,
  resolveProjectAgentsList,
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

const IDEA_CATEGORIES: { id: ProjectIdeaCategory; label: string; defaultStack: string }[] = [
  { id: 'WEBSITE', label: 'Website / SaaS', defaultStack: 'React · TypeScript · Tailwind · Node.js' },
  { id: 'APP', label: 'Aplicação / Mobile', defaultStack: 'React Native · Expo · TypeScript · Offline-First' },
  { id: 'AUTOMATION', label: 'Automação & IA', defaultStack: 'Python 3.11 · TypeScript · MCP · Sidecar' },
  { id: 'RESEARCH', label: 'Pesquisa & Produto', defaultStack: 'Markdown · HippoRAG · Dados & Prototipagem' },
  { id: 'CUSTOM', label: 'Outro Projeto', defaultStack: 'TypeScript · Node.js' },
];

function getCategoryShortLabel(cat?: ProjectIdeaCategory): string {
  switch (cat) {
    case 'WEBSITE':
      return 'Website';
    case 'APP':
      return 'App';
    case 'AUTOMATION':
      return 'Automação';
    case 'RESEARCH':
      return 'Pesquisa';
    default:
      return 'Projeto';
  }
}

function getProjectCategoryIcon(cat?: ProjectIdeaCategory) {
  switch (cat) {
    case 'WEBSITE':
      return Globe;
    case 'APP':
      return Smartphone;
    case 'AUTOMATION':
      return Cpu;
    default:
      return Layers;
  }
}

const InnerApp: React.FC = () => {
  const { pushToast } = useToast();
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<NavSectionId>('studio');
  const [subTargetId, setSubTargetId] = useState<string | undefined>(undefined);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [projectsModalOpen, setProjectsModalOpen] = useState(false);

  // Quick Idea Creator state (Left Sidebar / Modal)
  const [newIdeaOpen, setNewIdeaOpen] = useState(false);
  const [ideaName, setIdeaName] = useState('');
  const [ideaCategory, setIdeaCategory] = useState<ProjectIdeaCategory>('WEBSITE');
  const [ideaBrief, setIdeaBrief] = useState('');
  const [creatingIdea, setCreatingIdea] = useState(false);

  // Portfolio Modal parallel project form state
  const [newProjName, setNewProjName] = useState('');
  const [newProjPath, setNewProjPath] = useState('src');
  const [newProjStack, setNewProjStack] = useState('TypeScript · React · Node.js');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjProactive, setNewProjProactive] = useState(true);
  const [creatingProj, setCreatingProj] = useState(false);
  const [bulkTogglingProactive, setBulkTogglingProactive] = useState(false);

  // Operator Token Authentication Modal (A-01)
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [operatorTokenInput, setOperatorTokenInput] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Direct Project Agent responder selection & Real-Time Authorization Notification state
  const [preferredResponderId, setPreferredResponderId] = useState<string | undefined>(undefined);
  const [decidingApprovalId, setDecidingApprovalId] = useState<string | null>(null);
  const seenApprovalIdsRef = useRef<Set<string>>(new Set());
  const initialApprovalsSeededRef = useRef<boolean>(false);
  const [desktopNotifPermission, setDesktopNotifPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? window.Notification.permission
      : 'unsupported'
  );

  const refreshBootstrap = useCallback(async () => {
    try {
      const data = await apiJson<BootstrapPayload>('/api/bootstrap');
      console.debug(
        `[JARVIS:BOOT] Studio synchronized (engine=${data.storageEngine}, port=${data.activePort}, projects=${data.state.projects?.length ?? 0}, chats=${data.state.chatThreads?.length ?? 0})`
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
    const onAuthRequired = () => {
      setAuthDialogOpen(true);
    };
    window.addEventListener('jarvis:auth-required', onAuthRequired);
    return () => window.removeEventListener('jarvis:auth-required', onAuthRequired);
  }, []);

  const handleOperatorTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorTokenInput.trim() || authSubmitting) return;
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      await loginOperatorToken(operatorTokenInput);
      setOperatorTokenInput('');
      setAuthDialogOpen(false);
      await refreshBootstrap();
      pushToast({
        title: 'Sessão de operador autenticada',
        detail: 'Credencial validada pelo Security Gate.',
        tone: 'success',
      });
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const voiceDspEnabled = boot?.state.settings.voiceDspEnabled ?? true;

  const triggerAuthorizationAlert = useCallback(
    (appr: ApprovalRequest) => {
      if (!appr?.id || seenApprovalIdsRef.current.has(appr.id)) return;
      seenApprovalIdsRef.current.add(appr.id);

      const badge = formatApprovalRequesterBadge(appr);
      pushToast({
        title: `Autorização Necessária · ${badge.roleLabel}`,
        detail: `${badge.actorDisplay}: ${appr.title}`,
        tone: 'warning',
      });

      markViiAudio.playAuthorityAlertChime(voiceDspEnabled);

      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        window.Notification.permission === 'granted'
      ) {
        try {
          new window.Notification(`J.A.R.V.I.S. · ${badge.roleLabel}`, {
            body: `${badge.actorDisplay}: ${appr.title} — ${appr.commandOrAction.slice(0, 120)}`,
          });
        } catch {
          // Ignore browser desktop notification restriction
        }
      }
    },
    [pushToast, voiceDspEnabled]
  );

  const triggerAlertRef = useRef(triggerAuthorizationAlert);
  useEffect(() => {
    triggerAlertRef.current = triggerAuthorizationAlert;
  }, [triggerAuthorizationAlert]);

  useEffect(() => {
    const approvals = boot?.state.approvals;
    if (!approvals) return;
    const pending = approvals.filter((a) => a.status === 'PENDING');
    if (!initialApprovalsSeededRef.current) {
      pending.forEach((a) => seenApprovalIdsRef.current.add(a.id));
      initialApprovalsSeededRef.current = true;
      return;
    }
    for (const appr of pending) {
      if (!seenApprovalIdsRef.current.has(appr.id)) {
        triggerAuthorizationAlert(appr);
      }
    }
  }, [boot?.state.approvals, triggerAuthorizationAlert]);

  useEffect(() => {
    refreshBootstrap();
  }, [refreshBootstrap]);

  // Subscribe to Server-Sent Events (/api/events) including Studio activity_log, chat_message & approval_requested
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('connected', (ev) => {
      console.debug('[JARVIS:SSE] Stream connected (/api/events)', (ev as MessageEvent).data || '');
    });
    const onSseRefresh = (eventName: string) => (ev: Event) => {
      console.debug(`[JARVIS:SSE] Event "${eventName}"`, (ev as MessageEvent).data || '');
      refreshBootstrap();
    };
    es.addEventListener('state_updated', onSseRefresh('state_updated'));
    es.addEventListener('activity_log', onSseRefresh('activity_log'));
    es.addEventListener('chat_message', onSseRefresh('chat_message'));
    es.addEventListener('workflow_run', onSseRefresh('workflow_run'));
    es.addEventListener('swarm_progress', onSseRefresh('swarm_progress'));
    es.addEventListener('proactive_scan', onSseRefresh('proactive_scan'));
    es.addEventListener('sidecar_event', onSseRefresh('sidecar_event'));
    es.addEventListener('approval_requested', (ev: Event) => {
      try {
        const raw = (ev as MessageEvent).data;
        if (raw) {
          const approval = JSON.parse(String(raw)) as ApprovalRequest;
          triggerAlertRef.current(approval);
        }
      } catch {
        // Fallback: bootstrap diff handles newly inserted pending approvals
      }
      refreshBootstrap();
    });
    es.addEventListener('approval_decided', onSseRefresh('approval_decided'));
    es.addEventListener('heartbeat', onSseRefresh('heartbeat'));
    es.onerror = () => {
      console.debug('[JARVIS:SSE] Stream reconnecting...');
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
      setPreferredResponderId(undefined);
      setActiveSection('studio');
      setMobileMenuOpen(false);
      await refreshBootstrap();
      const proj = (boot.state.projects || []).find((p) => p.id === projectId);
      if (proj) {
        pushToast({
          title: `Ideia ativa: ${proj.name}`,
          detail: proj.ideaBrief || proj.description,
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

  const handleCreateIdeaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ideaName.trim() || creatingIdea) return;
    setCreatingIdea(true);
    try {
      const catMeta = IDEA_CATEGORIES.find((c) => c.id === ideaCategory) || IDEA_CATEGORIES[0];
      const res = await apiJson<{ project: ProjectWorkspace }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: ideaName.trim(),
          ideaCategory,
          techStack: catMeta.defaultStack,
          ideaBrief: ideaBrief.trim() || `Espaço de planeamento e execução para ${ideaName.trim()}.`,
          description: ideaBrief.trim() || `Ideia de ${catMeta.label}: ${ideaName.trim()}.`,
          proactiveEnabled: true,
        }),
      });
      setIdeaName('');
      setIdeaBrief('');
      setNewIdeaOpen(false);
      setActiveSection('studio');
      setMobileMenuOpen(false);
      await refreshBootstrap();
      pushToast({
        title: `Nova ideia criada: ${res.project.name}`,
        detail: 'Já podes conversar com o Jarvis para definir os primeiros Goals e sub-agentes.',
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao criar nova ideia',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setCreatingIdea(false);
    }
  };

  const handleCreateNewChat = async (projectOverrideId?: string) => {
    if (!boot) return;
    const targetProjectId =
      projectOverrideId || boot.state.activeProjectId || boot.state.projects?.[0]?.id;
    if (!targetProjectId) return;

    const existingCount = (boot.state.chatThreads || []).filter(
      (c) => c.projectId === targetProjectId
    ).length;

    try {
      await apiJson<{ chat: ChatThread }>('/api/chats', {
        method: 'POST',
        body: JSON.stringify({
          projectId: targetProjectId,
          title: `Conversa #${existingCount + 1}`,
        }),
      });
      setActiveSection('studio');
      setMobileMenuOpen(false);
      await refreshBootstrap();
    } catch (err) {
      pushToast({
        title: 'Erro ao criar nova conversa',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const handleActivateChat = async (chatId: string) => {
    try {
      await apiJson(`/api/chats/${chatId}/activate`, { method: 'POST' });
      setActiveSection('studio');
      setMobileMenuOpen(false);
      await refreshBootstrap();
    } catch (err) {
      pushToast({
        title: 'Erro ao abrir conversa',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const handleCreateGeneralChat = async () => {
    if (!boot) return;
    const generalCount = (boot.state.chatThreads || []).filter((c) =>
      isGeneralUnlinkedChat(c)
    ).length;

    try {
      await apiJson<{ chat: ChatThread }>('/api/chats', {
        method: 'POST',
        body: JSON.stringify({
          projectId: GENERAL_CHAT_PROJECT_ID,
          isGeneral: true,
          title: generalCount === 0 ? 'Conversa Geral' : `Conversa Geral #${generalCount + 1}`,
        }),
      });
      setPreferredResponderId(undefined);
      setActiveSection('studio');
      setMobileMenuOpen(false);
      await refreshBootstrap();
    } catch (err) {
      pushToast({
        title: 'Erro ao criar conversa geral',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const handleOpenGeneralChat = async () => {
    const firstGeneral = (boot?.state.chatThreads || []).find((c) => isGeneralUnlinkedChat(c));
    if (firstGeneral) {
      await handleActivateChat(firstGeneral.id);
    } else {
      await handleCreateGeneralChat();
    }
  };

  const handleQuickApprovalDecision = async (
    approvalId: string,
    decision: 'APPROVED_ONCE' | 'APPROVED_ALWAYS' | 'BLOCKED'
  ) => {
    if (decidingApprovalId) return;
    setDecidingApprovalId(approvalId);
    try {
      await apiJson(`/api/approvals/${approvalId}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      await refreshBootstrap();
      pushToast({
        title:
          decision === 'BLOCKED'
            ? 'Ação bloqueada pelo Operador'
            : decision === 'APPROVED_ALWAYS'
              ? 'Ação autorizada sempre'
              : 'Ação autorizada (1x) e executada',
        tone: decision === 'BLOCKED' ? 'info' : 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao decidir autorização',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setDecidingApprovalId(null);
    }
  };

  const handleDeleteChat = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    try {
      await apiJson(`/api/chats/${chatId}`, { method: 'DELETE' });
      await refreshBootstrap();
    } catch (err) {
      pushToast({
        title: 'Não foi possível eliminar conversa',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const handleCreateProjectInPortfolio = async (e: React.FormEvent) => {
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
          ideaBrief: newProjDesc.trim(),
          proactiveEnabled: newProjProactive,
        }),
      });
      setNewProjName('');
      setNewProjDesc('');
      await refreshBootstrap();
      pushToast({
        title: 'Novo projeto adicionado ao portefólio',
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
      pushToast({ title: 'Projeto removido do portefólio', tone: 'info' });
    } catch (err) {
      pushToast({
        title: 'Não foi possível remover projeto',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const handleQuickDirective = async (directiveText: string): Promise<string> => {
    const activeProjId = boot?.state.activeProjectId || boot?.state.projects?.[0]?.id;
    const activeChatId = boot?.state.activeChatId;
    const res = await apiJson<{ assistantMessage: ChatMessage }>('/api/chat/send', {
      method: 'POST',
      body: JSON.stringify({
        roomId: 'room-exec',
        projectId: activeProjId,
        chatId: activeChatId,
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
          projectId: boot?.state.activeProjectId,
          targetMetric: 'Definido na configuração inicial',
        }),
      });
    }
    await refreshBootstrap();
    pushToast({ title: 'Perfil do Jarvis personalizado', tone: 'success' });
  };

  if (loading) {
    return (
      <div className="min-h-screen studio-canvas flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-3 text-center">
          <p className="text-sm font-semibold text-slate-200 font-display">
            A abrir o Estúdio J.A.R.V.I.S....
          </p>
          <div className="h-1 w-full bg-[#191f2b] rounded-full overflow-hidden">
            <div className="h-full w-2/3 bg-[#e59a54]" />
          </div>
        </div>
      </div>
    );
  }

  if (errorMsg || !boot) {
    return (
      <div className="min-h-screen studio-canvas flex items-center justify-center p-6">
        <div className="max-w-md w-full studio-card rounded-xl p-6 space-y-4">
          <h1 className="text-base font-semibold text-slate-100">
            {authDialogOpen ? 'Autenticação de Operador Necessária' : 'Falha de Ligação ao Servidor'}
          </h1>
          <p className="text-xs text-slate-400">{errorMsg || 'Resposta vazia do servidor.'}</p>

          {authDialogOpen ? (
            <form onSubmit={handleOperatorTokenSubmit} className="space-y-3 pt-1">
              <label htmlFor="boot-operator-token" className="block text-xs text-slate-300">
                Token de Operador (`JARVIS_API_TOKEN`)
              </label>
              <input
                id="boot-operator-token"
                type="password"
                required
                value={operatorTokenInput}
                onChange={(e) => setOperatorTokenInput(e.target.value)}
                placeholder="Introduz o token configurado no servidor..."
                className="w-full px-3 py-2 text-xs font-mono bg-[#0b0d11] border border-white/12 rounded-lg text-slate-100 focus:outline-none focus:border-[#e59a54]"
              />
              {authError && <p className="text-xs text-rose-400">{authError}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={authSubmitting}
                  className="px-4 py-2 text-xs font-semibold bg-[#e59a54] text-slate-950 rounded-lg hover:bg-[#eba868] disabled:opacity-50"
                >
                  {authSubmitting ? 'A validar...' : 'Autenticar Sessão'}
                </button>
                <button
                  type="button"
                  onClick={refreshBootstrap}
                  className="px-3 py-2 text-xs text-slate-300 bg-[#141821] border border-white/10 rounded-lg"
                >
                  Tentar Novamente
                </button>
              </div>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={refreshBootstrap}
                className="px-4 py-2 text-xs font-semibold bg-[#e59a54] text-slate-950 rounded-lg"
              >
                Tentar Novamente
              </button>
              <button
                type="button"
                onClick={() => setAuthDialogOpen(true)}
                className="px-3 py-2 text-xs text-slate-300 bg-[#141821] border border-white/10 rounded-lg inline-flex items-center gap-1.5"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#e59a54]" />
                Inserir Token
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const { state: store } = boot;
  const lang = store.settings.language;
  const pendingApprovals = store.approvals.filter((a) => a.status === 'PENDING');
  const pendingApprovalsCount = pendingApprovals.length;
  const topPendingApproval = pendingApprovals[0] || null;
  const topApprovalBadge = topPendingApproval
    ? formatApprovalRequesterBadge(topPendingApproval)
    : null;

  const isAutostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const projects = store.projects || [];
  const allChatThreads = store.chatThreads || [];
  const generalChatThreads = allChatThreads.filter((c) => isGeneralUnlinkedChat(c));
  const activeChatFromStore = allChatThreads.find((c) => c.id === store.activeChatId);
  const isGeneralChatActive =
    store.activeProjectId === GENERAL_CHAT_PROJECT_ID ||
    (activeChatFromStore ? isGeneralUnlinkedChat(activeChatFromStore) : false);

  const activeProject: ProjectWorkspace | null = isGeneralChatActive
    ? null
    : projects.find((p) => p.id === store.activeProjectId) || projects[0] || null;

  const projectChatThreads = activeProject
    ? allChatThreads.filter((c) => c.projectId === activeProject.id && !isGeneralUnlinkedChat(c))
    : [];

  const activeChat: ChatThread = isGeneralChatActive
    ? generalChatThreads.find((c) => c.id === store.activeChatId) ||
      generalChatThreads[0] || {
        id: 'chat-general-main',
        projectId: GENERAL_CHAT_PROJECT_ID,
        isGeneral: true,
        title: 'Conversa Geral (Livre)',
        primaryAgentId: 'room-exec',
        screenAutoSendEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    : projectChatThreads.find((c) => c.id === store.activeChatId) ||
      projectChatThreads[0] || {
        id: `chat-default-${activeProject?.id || 'main'}`,
        projectId: activeProject?.id || 'proj-jarvis-core',
        title: 'Planeamento Principal',
        primaryAgentId: 'room-exec',
        screenAutoSendEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

  const activeProjectAgents = resolveProjectAgentsList(store.rooms, activeProject);

  const handleToggleProjectAgent = async (roomId: string) => {
    if (!activeProject || roomId === 'room-exec') return;
    const targetRoom = store.rooms.find((r) => r.id === roomId);
    const currentSet = new Set(activeProject.assignedAgentIds || []);
    const isCurrentlyAssigned =
      currentSet.has(roomId) || targetRoom?.projectId === activeProject.id;

    try {
      if (isCurrentlyAssigned) {
        currentSet.delete(roomId);
        await apiJson(`/api/projects/${activeProject.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ assignedAgentIds: Array.from(currentSet) }),
        });
        if (targetRoom?.projectId === activeProject.id) {
          await apiJson(`/api/rooms/${roomId}`, {
            method: 'PATCH',
            body: JSON.stringify({ projectId: null }),
          });
        }
        if (preferredResponderId === roomId) {
          setPreferredResponderId('room-exec');
        }
        pushToast({
          title: `${targetRoom?.name || 'Agente'} desassociado de ${activeProject.name}`,
          tone: 'info',
        });
      } else {
        currentSet.add(roomId);
        await apiJson(`/api/projects/${activeProject.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ assignedAgentIds: Array.from(currentSet) }),
        });
        pushToast({
          title: `${targetRoom?.name || 'Agente'} atribuído a ${activeProject.name}`,
          tone: 'success',
        });
      }
      await refreshBootstrap();
    } catch (err) {
      pushToast({
        title: 'Erro ao atualizar agentes do projeto',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const advancedModules: {
    id: NavSectionId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    counter?: number;
  }[] = [
    { id: 'llm', label: t(lang, 'nav_llm'), icon: Sparkles },
    { id: 'mcp', label: t(lang, 'nav_mcp'), icon: Server },
    { id: 'skills', label: t(lang, 'nav_skills'), icon: Blocks },
    { id: 'devices', label: t(lang, 'nav_devices'), icon: Cpu },
    { id: 'brain', label: t(lang, 'nav_brain'), icon: Brain },
    { id: 'memory', label: t(lang, 'nav_memory'), icon: Network },
    { id: 'workflows', label: t(lang, 'nav_workflows'), icon: WorkflowIcon },
    { id: 'swarm', label: t(lang, 'nav_swarm'), icon: Boxes },
    { id: 'orbit', label: t(lang, 'nav_orbit'), icon: Radar },
    { id: 'brief', label: t(lang, 'nav_brief'), icon: LayoutDashboard },
    { id: 'workspace', label: t(lang, 'nav_workspace'), icon: FolderGit2 },
    { id: 'chat', label: t(lang, 'nav_chat'), icon: MessageSquare },
    {
      id: 'authority',
      label: t(lang, 'nav_authority'),
      icon: ShieldCheck,
      counter: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
    },
  ];

  const visibleModuleIds = new Set(
    getVisibleSidebarIds(
      advancedModules.map((m) => m.id),
      focusModeEnabled,
      activeSection,
      pendingApprovalsCount
    )
  );
  const displayedModules = advancedModules.filter((m) => visibleModuleIds.has(m.id));
  const activeModuleObj = advancedModules.find((m) => m.id === activeSection);
  const isCompactSidebar = sidebarCollapsed;

  // Shared sidebar body renderer for Desktop & Mobile Drawer
  const renderSidebarContent = (inMobileDrawer = false) => {
    const collapsed = !inMobileDrawer && isCompactSidebar;

    if (collapsed) {
      return (
        <div className="flex flex-col items-center justify-between h-full py-3.5 px-2">
          <div className="flex flex-col items-center gap-3 w-full">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expandir painel lateral"
              title="Expandir painel de Ideias e Projetos"
              className="w-9 h-9 rounded-lg bg-[#161b26] border border-white/8 hover:border-[#e59a54]/50 flex items-center justify-center text-slate-200 transition-colors"
            >
              <PanelLeftOpen className="w-4 h-4 text-[#e59a54]" />
            </button>

            <button
              type="button"
              onClick={() => {
                setSidebarCollapsed(false);
                setNewIdeaOpen(true);
              }}
              aria-label="Nova Ideia"
              title="Nova Ideia / Projeto"
              className="w-9 h-9 rounded-lg bg-[#e59a54] text-slate-950 hover:bg-[#eba868] flex items-center justify-center transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>

            <div className="w-full border-t border-white/7 pt-2.5 flex flex-col items-center gap-1.5">
              <button
                type="button"
                data-testid="compact-general-chat-btn"
                onClick={handleOpenGeneralChat}
                title="Conversa Geral (Sem Projeto)"
                aria-label="Conversa Geral"
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                  isGeneralChatActive && activeSection === 'studio'
                    ? 'bg-[#e59a54]/16 border border-[#e59a54]/45 text-[#e59a54]'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-white/6'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
              </button>

              {projects.map((proj) => {
                const ProjIcon = getProjectCategoryIcon(proj.ideaCategory);
                const selected = proj.id === activeProject?.id && activeSection === 'studio';
                return (
                  <button
                    key={proj.id}
                    type="button"
                    onClick={() => handleActivateProject(proj.id)}
                    title={proj.name}
                    aria-label={proj.name}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                      selected
                        ? 'bg-[#e59a54]/16 border border-[#e59a54]/45 text-[#e59a54]'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-white/6'
                    }`}
                  >
                    <ProjIcon className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 pt-3 border-t border-white/7 w-full">
            <PebbleWidget
              settings={store.settings}
              compactRail={true}
              activeProjectId={activeProject?.id || (isGeneralChatActive ? GENERAL_CHAT_PROJECT_ID : undefined)}
              activeChatId={activeChat.id}
              onToggleWakeWord={async (enabled) => {
                await apiJson('/api/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ wakeWordEnabled: enabled }),
                });
                await refreshBootstrap();
              }}
              onUpdateVoiceSettings={async (updates) => {
                await apiJson('/api/settings', {
                  method: 'PATCH',
                  body: JSON.stringify(updates),
                });
                await refreshBootstrap();
              }}
              onVoiceDirective={handleQuickDirective}
              onLiveTurnCompleted={refreshBootstrap}
            />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Comandos"
              title="Comandos (Ctrl+K)"
              className="w-9 h-9 rounded-lg bg-[#141821] border border-white/8 text-slate-300 hover:text-slate-100 flex items-center justify-center"
            >
              <Command className="w-4 h-4" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full min-h-0">
        {/* Top Brand + Collapse Control */}
        <div className="h-13 px-4 border-b border-white/7 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleNavigate('studio')}
            className="flex items-center gap-2.5 min-w-0 text-left focus:outline-none"
          >
            <span className="w-7 h-7 rounded-lg bg-[#e59a54]/16 border border-[#e59a54]/40 flex items-center justify-center text-xs font-bold text-[#e59a54] font-display shrink-0">
              J
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-100 font-display whitespace-nowrap">
              J.A.R.V.I.S. Studio
            </span>
          </button>

          {inMobileDrawer ? (
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fechar menu"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-100"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Recolher barra lateral"
              title="Recolher barra lateral"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/6 transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Primary Idea Actions */}
        <div className="p-3 space-y-2 border-b border-white/6 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="new-idea-btn"
              onClick={() => setNewIdeaOpen((prev) => !prev)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#e59a54] text-slate-950 hover:bg-[#eba868] transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nova Ideia</span>
            </button>

            <button
              type="button"
              data-testid="open-portfolio-btn"
              onClick={() => setProjectsModalOpen(true)}
              title="Abrir visão global do portefólio e proatividade"
              className="px-2.5 py-2 rounded-lg text-xs font-medium bg-[#141821] border border-white/8 text-slate-300 hover:text-slate-100 hover:border-white/16 transition-colors whitespace-nowrap shrink-0"
            >
              Portefólio
            </button>
          </div>

          {/* Inline New Idea Creator */}
          {newIdeaOpen && (
            <form
              onSubmit={handleCreateIdeaSubmit}
              data-testid="new-idea-form"
              className="p-3 rounded-xl bg-[#141821] border border-white/10 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">Criar Projeto de Ideia</span>
                <button
                  type="button"
                  onClick={() => setNewIdeaOpen(false)}
                  className="text-slate-500 hover:text-slate-200"
                  aria-label="Cancelar nova ideia"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <input
                type="text"
                required
                data-testid="new-idea-name-input"
                value={ideaName}
                onChange={(e) => setIdeaName(e.target.value)}
                placeholder="Ex: Fazer um Website SaaS, App Fitness..."
                className="w-full px-2.5 py-1.5 rounded-lg bg-[#0b0d11] border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#e59a54]"
              />

              <select
                aria-label="Categoria da ideia"
                value={ideaCategory}
                onChange={(e) => setIdeaCategory(e.target.value as ProjectIdeaCategory)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-[#0b0d11] border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-[#e59a54]"
              >
                {IDEA_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>

              <textarea
                rows={2}
                value={ideaBrief}
                onChange={(e) => setIdeaBrief(e.target.value)}
                placeholder="Resumo rápido do que pretendes construir..."
                className="w-full px-2.5 py-1.5 rounded-lg bg-[#0b0d11] border border-white/10 text-xs text-slate-200 placeholder:text-slate-500 resize-none focus:outline-none focus:border-[#e59a54]"
              />

              <button
                type="submit"
                disabled={creatingIdea}
                className="w-full py-1.5 rounded-lg text-xs font-semibold bg-[#e59a54] text-slate-950 hover:bg-[#eba868] transition-colors disabled:opacity-50"
              >
                {creatingIdea ? 'A preparar projeto...' : 'Criar e Planear com Jarvis'}
              </button>
            </form>
          )}
        </div>

        {/* Scrollable General Chats + Projects + Active Project Chats & Agents + Advanced Modules */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5 min-h-0">
          {/* 0. Chat Geral (Sem Projeto Associado) */}
          <div className="space-y-1.5" data-testid="sidebar-general-chats-section">
            <div className="px-2 flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-400 truncate">
                Chat Geral (Sem Projeto)
              </span>
              <button
                type="button"
                data-testid="new-general-chat-btn"
                onClick={handleCreateGeneralChat}
                title="Nova conversa geral livre (não associada a projetos)"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#e59a54] hover:text-[#eba868] transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3 h-3" />
                <span>Nova</span>
              </button>
            </div>

            <div className="space-y-0.5" data-testid="sidebar-general-chats-list">
              {generalChatThreads.length === 0 ? (
                <button
                  type="button"
                  onClick={handleCreateGeneralChat}
                  className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-slate-400 hover:text-slate-200 hover:bg-white/4 flex items-center gap-2 transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-80" />
                  <span className="truncate">Abrir Conversa Geral</span>
                </button>
              ) : (
                generalChatThreads.map((chat) => {
                  const isChatActive =
                    isGeneralChatActive &&
                    chat.id === activeChat.id &&
                    activeSection === 'studio';
                  return (
                    <div
                      key={chat.id}
                      onClick={() => handleActivateChat(chat.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleActivateChat(chat.id);
                        }
                      }}
                      data-testid={`sidebar-chat-${chat.id}`}
                      className={`group w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                        isChatActive
                          ? 'bg-[#e59a54]/14 text-[#f3c394] border border-[#e59a54]/30'
                          : 'text-slate-300 hover:text-slate-100 hover:bg-white/4'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <MessageSquare className="w-3.5 h-3.5 shrink-0 text-[#e59a54]/85" />
                        <span className="text-xs truncate">{chat.title}</span>
                      </div>
                      {generalChatThreads.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteChat(e, chat.id)}
                          aria-label={`Eliminar conversa ${chat.title}`}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-rose-400 transition-opacity shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 1. Ideias & Projetos */}
          <div className="space-y-1.5 pt-3 border-t border-white/6">
            <div className="px-2 flex items-center justify-between text-[11px] font-medium text-slate-400">
              <span>Ideias & Projetos</span>
              <span className="font-mono tabular-nums text-slate-500">{projects.length}</span>
            </div>

            <div className="space-y-1" data-testid="sidebar-projects-list">
              {projects.map((proj) => {
                const isSelected = proj.id === activeProject?.id;
                const ProjIcon = getProjectCategoryIcon(proj.ideaCategory);
                const goalCount = store.goals.filter((g) =>
                  g.projectId ? g.projectId === proj.id : proj.id === 'proj-jarvis-core'
                ).length;

                return (
                  <button
                    key={proj.id}
                    type="button"
                    data-testid={`sidebar-project-${proj.id}`}
                    onClick={() => handleActivateProject(proj.id)}
                    className={`w-full px-2.5 py-2 rounded-lg text-left transition-colors flex items-start gap-2.5 ${
                      isSelected && activeSection === 'studio'
                        ? 'bg-[#171c27] border border-white/10 text-slate-100'
                        : isSelected
                          ? 'bg-white/4 text-slate-200'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/4'
                    }`}
                  >
                    <ProjIcon
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        isSelected ? 'text-[#e59a54]' : 'text-slate-500'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{proj.name}</p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5 tabular-nums">
                        {getCategoryShortLabel(proj.ideaCategory)} · {goalCount} Goals
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Conversas do Projeto Ativo */}
          {activeProject && (
            <div className="space-y-1.5 pt-3 border-t border-white/6">
              <div className="px-2 flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400 truncate">
                  Conversas do Projeto
                </span>
                <button
                  type="button"
                  data-testid="new-chat-thread-btn"
                  onClick={() => handleCreateNewChat(activeProject.id)}
                  title="Nova conversa neste projeto"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#e59a54] hover:text-[#eba868] transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3 h-3" />
                  <span>Nova</span>
                </button>
              </div>

              <div className="space-y-0.5" data-testid="sidebar-chats-list">
                {projectChatThreads.map((chat) => {
                  const isChatActive =
                    chat.id === activeChat.id && activeSection === 'studio';
                  return (
                    <div
                      key={chat.id}
                      onClick={() => handleActivateChat(chat.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleActivateChat(chat.id);
                        }
                      }}
                      data-testid={`sidebar-chat-${chat.id}`}
                      className={`group w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                        isChatActive
                          ? 'bg-[#e59a54]/12 text-[#f3c394]'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/4'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-80" />
                        <span className="text-xs truncate">{chat.title}</span>
                      </div>
                      {projectChatThreads.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteChat(e, chat.id)}
                          aria-label={`Eliminar conversa ${chat.title}`}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-rose-400 transition-opacity shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Acesso Direto aos Agentes & Sub-Agentes do Projeto na Barra Lateral */}
              <div className="pt-2.5 space-y-1" data-testid="sidebar-project-agents-section">
                <div className="px-2 flex items-center justify-between text-[11px] font-medium text-slate-400">
                  <span>Agentes do Projeto</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {activeProjectAgents.length}
                  </span>
                </div>
                <div className="space-y-0.5" data-testid="sidebar-project-agents-list">
                  {activeProjectAgents.map((ag) => {
                    const isActiveAgent =
                      activeSection === 'studio' &&
                      (preferredResponderId
                        ? preferredResponderId === ag.id
                        : (activeChat.primaryAgentId || 'room-exec') === ag.id);
                    const isPrincipal = ag.id === 'room-exec';
                    return (
                      <button
                        key={ag.id}
                        type="button"
                        data-testid={`sidebar-project-agent-${ag.id}`}
                        onClick={() => {
                          setPreferredResponderId(ag.id);
                          setActiveSection('studio');
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-left transition-colors ${
                          isActiveAgent
                            ? 'bg-[#171c27] border border-[#e59a54]/35 text-slate-100'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-white/4'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Bot
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isPrincipal ? 'text-[#e59a54]' : 'text-[#8ea6ff]'
                            }`}
                          />
                          <span className="text-xs truncate">{ag.name}</span>
                        </div>
                        <span className="font-mono text-[9px] text-slate-500 shrink-0">
                          {isPrincipal ? 'CORE' : ag.callsign || 'SUB'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 3. Módulos & Ecossistema Antigravity / MCP */}
          <div className="space-y-1.5 pt-3 border-t border-white/6">
            <button
              type="button"
              onClick={() => setToolsExpanded((prev) => !prev)}
              className="w-full px-2 py-1 flex items-center justify-between text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              <span>Ecossistema, MCP & Sistema</span>
              {toolsExpanded || activeSection !== 'studio' ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>

            {(toolsExpanded || activeSection !== 'studio') && (
              <nav aria-label="Módulos do Sistema" className="space-y-0.5">
                {displayedModules.map((mod) => {
                  const Icon = mod.icon;
                  const active = mod.id === activeSection;
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => handleNavigate(mod.id)}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-[#171c27] border border-white/10 text-[#e59a54] font-medium'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/4'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{mod.label}</span>
                      </span>
                      {mod.counter !== undefined && (
                        <span className="font-mono tabular-nums text-[11px] text-[#e59a54]">
                          {mod.counter}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            )}
          </div>
        </div>

        {/* Bottom Studio Controls: Voice Assistant + Commands + Focus + Lang */}
        <div className="p-3 border-t border-white/7 space-y-2.5 shrink-0">
          <PebbleWidget
            settings={store.settings}
            compactRail={false}
            activeProjectId={activeProject?.id || (isGeneralChatActive ? GENERAL_CHAT_PROJECT_ID : undefined)}
            activeChatId={activeChat.id}
            onToggleWakeWord={async (enabled) => {
              await apiJson('/api/settings', {
                method: 'PATCH',
                body: JSON.stringify({ wakeWordEnabled: enabled }),
              });
              await refreshBootstrap();
            }}
            onUpdateVoiceSettings={async (updates) => {
              await apiJson('/api/settings', {
                method: 'PATCH',
                body: JSON.stringify(updates),
              });
              await refreshBootstrap();
            }}
            onVoiceDirective={handleQuickDirective}
            onLiveTurnCompleted={refreshBootstrap}
          />

          <div className="flex items-center justify-between gap-1.5">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#141821] border border-white/8 text-slate-300 hover:text-slate-100 hover:border-white/16 transition-colors whitespace-nowrap"
            >
              <Command className="w-3.5 h-3.5 text-[#e59a54]" />
              <span>{t(lang, 'cmd_palette_btn')}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleFocusMode}
              aria-pressed={focusModeEnabled}
              title="Modo Foco Noturno (Ctrl+Shift+F)"
              className={`p-1.5 rounded-lg border transition-colors ${
                focusModeEnabled
                  ? 'bg-[#e59a54]/18 border-[#e59a54]/45 text-[#e59a54]'
                  : 'bg-[#141821] border-white/8 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => handleLanguageSwitch(lang === 'pt-PT' ? 'en-US' : 'pt-PT')}
              title="Alternar Idioma (PT / EN)"
              className="px-2 py-1.5 rounded-lg bg-[#141821] border border-white/8 text-[11px] font-mono text-slate-300 hover:text-slate-100 transition-colors"
            >
              {lang === 'pt-PT' ? 'PT' : 'EN'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen overflow-hidden studio-canvas text-slate-100 flex flex-col lg:flex-row">
      {/* Mobile Header (< lg) */}
      <header className="lg:hidden h-12 px-4 studio-sidebar border-b border-white/8 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir navegação"
            className="p-1.5 rounded-lg bg-[#141821] border border-white/8 text-slate-200"
          >
            <Menu className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-slate-100 font-display truncate">
            {activeSection === 'studio'
              ? activeProject?.name || 'Conversa Geral · J.A.R.V.I.S.'
              : activeModuleObj?.label || 'J.A.R.V.I.S.'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Abrir Comandos"
          className="px-2.5 py-1 rounded-lg bg-[#141821] border border-white/8 text-xs text-slate-200 inline-flex items-center gap-1.5 shrink-0"
        >
          <Command className="w-3.5 h-3.5 text-[#e59a54]" />
          <span>{t(lang, 'cmd_palette_btn')}</span>
        </button>
      </header>

      {/* Desktop Left Studio Sidebar */}
      <aside
        data-testid="studio-left-sidebar"
        className={`hidden lg:flex lg:flex-col shrink-0 studio-sidebar h-full transition-colors ${
          isCompactSidebar ? 'lg:w-[60px]' : 'lg:w-[272px]'
        }`}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden bg-black/75 flex"
          onClick={() => setMobileMenuOpen(false)}
        >
          <aside
            className="w-72 studio-sidebar h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main Content Stage */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full">
        {/* Global Real-Time Authorization Notification Banner (Agents & Sub-Agents) */}
        {topPendingApproval && topApprovalBadge && (
          <div
            data-testid="global-approval-alert-banner"
            role="alert"
            className="px-4 py-2.5 bg-[#1b1411] border-b border-[#e59a54]/50 flex flex-wrap items-center justify-between gap-3 shrink-0"
          >
            <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
              <div className="w-7 h-7 rounded-lg bg-[#e59a54]/18 border border-[#e59a54]/45 flex items-center justify-center text-[#e59a54] shrink-0">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold ${
                      topApprovalBadge.isSubagent
                        ? 'bg-[#8ea6ff]/18 text-[#a9bcff] border border-[#8ea6ff]/35'
                        : 'bg-[#e59a54]/18 text-[#f3c394] border border-[#e59a54]/35'
                    }`}
                  >
                    {topApprovalBadge.roleLabel}
                  </span>
                  <span className="font-medium text-slate-200 truncate">
                    {topApprovalBadge.actorDisplay}
                  </span>
                  <span className="text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-semibold text-slate-100 truncate">
                    {topPendingApproval.title}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                      topPendingApproval.riskLevel === 'CRITICAL' ||
                      topPendingApproval.riskLevel === 'HIGH'
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    {topPendingApproval.riskLevel}
                  </span>
                </div>
                <p className="text-[11px] font-mono text-slate-400 truncate">
                  {topPendingApproval.commandOrAction}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <button
                type="button"
                data-testid="banner-approve-once-btn"
                disabled={decidingApprovalId === topPendingApproval.id}
                onClick={() =>
                  handleQuickApprovalDecision(topPendingApproval.id, 'APPROVED_ONCE')
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#e59a54] text-[#0b0d11] hover:bg-[#f0ac6b] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Autorizar 1x</span>
              </button>

              <button
                type="button"
                data-testid="banner-approve-always-btn"
                disabled={decidingApprovalId === topPendingApproval.id}
                onClick={() =>
                  handleQuickApprovalDecision(topPendingApproval.id, 'APPROVED_ALWAYS')
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/16 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <span>Sempre</span>
              </button>

              <button
                type="button"
                data-testid="banner-block-btn"
                disabled={decidingApprovalId === topPendingApproval.id}
                onClick={() => handleQuickApprovalDecision(topPendingApproval.id, 'BLOCKED')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-500/15 border border-rose-400/35 text-rose-300 hover:bg-rose-500/25 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>Bloquear</span>
              </button>

              <button
                type="button"
                onClick={() => handleNavigate('authority')}
                className="px-2 py-1 rounded-lg text-[11px] font-mono bg-[#141821] border border-white/10 text-slate-300 hover:text-slate-100 whitespace-nowrap"
              >
                Inbox ({pendingApprovalsCount})
              </button>

              {desktopNotifPermission === 'default' && (
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined' && 'Notification' in window) {
                      window.Notification.requestPermission()
                        .then(setDesktopNotifPermission)
                        .catch(() => {});
                    }
                  }}
                  title="Ativar notificações desktop do navegador"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-[#141821] border border-white/10 text-[#e59a54] hover:border-[#e59a54]/45 whitespace-nowrap"
                >
                  <Bell className="w-3 h-3" />
                  <span className="hidden xl:inline">Alertas OS</span>
                </button>
              )}
            </div>
          </div>
        )}

        {activeSection === 'studio' && (activeProject || isGeneralChatActive) ? (
          <StudioWorkspaceView
            store={store}
            activeProject={activeProject}
            activeChat={activeChat}
            preferredResponderId={preferredResponderId}
            onSelectResponder={setPreferredResponderId}
            onToggleProjectAgent={activeProject ? handleToggleProjectAgent : undefined}
            onRefreshBootstrap={refreshBootstrap}
            onNavigateModule={handleNavigate}
            onCreateNewChat={() =>
              isGeneralChatActive
                ? handleCreateGeneralChat()
                : activeProject
                  ? handleCreateNewChat(activeProject.id)
                  : handleCreateGeneralChat()
            }
          />
        ) : (
          /* Secondary System Module Container (MCP, Skills, Sidecar, Brain, Swarm, etc.) */
          <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden">
            <header className="h-13 px-6 border-b border-white/7 bg-[#10131a] flex items-center justify-between gap-6 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => handleNavigate('studio')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141821] border border-white/8 text-xs font-medium text-slate-200 hover:border-[#e59a54]/45 hover:text-[#e59a54] transition-colors whitespace-nowrap shrink-0"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Voltar ao Estúdio</span>
                </button>
                <span className="text-slate-600" aria-hidden="true">
                  /
                </span>
                <h1 className="text-sm font-semibold text-slate-100 font-display truncate">
                  {activeModuleObj?.label || t(lang, 'nav_studio')}
                </h1>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                {activeProject && (
                  <span className="hidden md:inline text-xs text-slate-400 truncate max-w-56">
                    Projeto ativo: <strong className="text-slate-200 font-medium">{activeProject.name}</strong>
                  </span>
                )}
              </div>
            </header>

            <main className="flex-1 overflow-y-auto p-6">
              <div className="max-w-[1360px] mx-auto pb-20" data-active-view={activeSection}>
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
                  <Suspense
                    fallback={
                      <div className="p-8 rounded-xl bg-[#0d1117] border border-slate-800 text-center space-y-2">
                        <p className="text-sm font-semibold text-slate-200 font-display">
                          A carregar motor espacial 3D do Enxame 48x...
                        </p>
                        <p className="text-xs text-slate-400">
                          Módulo WebGL / Three.js carregado sob pedido para arranque leve.
                        </p>
                      </div>
                    }
                  >
                    <SwarmView
                      onRefreshBootstrap={refreshBootstrap}
                      onOpenWorkspaceFile={(fp) => handleNavigate('workspace', fp)}
                    />
                  </Suspense>
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

                {activeSection === 'llm' && (
                  <LLMSettingsView
                    store={store}
                    geminiAvailable={boot.geminiAvailable}
                    openRouterAvailable={Boolean(boot.openRouterAvailable)}
                    brain8765={boot.brain8765}
                    storageEngine={boot.storageEngine}
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
              </div>
            </main>
          </div>
        )}
      </div>

      {/* Multi-Project Portfolio & Proactivity Manager Modal */}
      {projectsModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Gestor Multi-Projeto Simultâneo"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
          onClick={() => setProjectsModalOpen(false)}
        >
          <div
            className="w-full max-w-3xl studio-card rounded-xl p-6 space-y-5 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[#e59a54]">
                  Portefólio de Ideias & Execução Paralela
                </p>
                <h2 className="text-lg font-bold text-slate-100 font-display">
                  Projetos Simultâneos & Proatividade Autónoma
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Gere todas as tuas ideias e repositórios em paralelo. Quando a proatividade está
                  ativa num projeto, o Jarvis acompanha Goals, Git e acoplamento AST.
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

            {/* Projects Portfolio Summary Card */}
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
                  className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-[#0e1117] border border-white/8"
                >
                  <div className="p-3 rounded-lg bg-[#141821] border border-white/6 flex items-start justify-between gap-2.5">
                    <div>
                      <p className="text-[11px] font-medium text-slate-400">
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
                    <div className="w-8 h-8 rounded-lg bg-[#8ea6ff]/12 border border-[#8ea6ff]/30 flex items-center justify-center text-[#8ea6ff] shrink-0">
                      <FolderGit2 className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-[#141821] border border-white/6 flex items-start justify-between gap-2.5">
                    <div>
                      <p className="text-[11px] font-medium text-slate-400">
                        Horas Ativas Acumuladas
                      </p>
                      <p
                        data-testid="summary-active-hours"
                        className="text-xl font-bold text-[#e59a54] font-display tabular-nums mt-1"
                      >
                        {portfolioSummary.totalActiveHours}h
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                        Planeamento + execução
                      </p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-[#e59a54]/12 border border-[#e59a54]/30 flex items-center justify-center text-[#e59a54] shrink-0">
                      <Clock className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-[#141821] border border-white/6 flex items-start justify-between gap-2.5">
                    <div>
                      <p className="text-[11px] font-medium text-slate-400">
                        Agentes Autónomos Ativos
                      </p>
                      <p
                        data-testid="summary-running-agents"
                        className="text-xl font-bold text-emerald-400 font-display tabular-nums mt-1"
                      >
                        {portfolioSummary.runningBackgroundAgents}
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                        Em background ({portfolioSummary.uniqueAssignedAgentsCount} alocados)
                      </p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/12 border border-emerald-500/30 flex items-center justify-center text-emerald-300 shrink-0">
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
                  className="p-3.5 rounded-xl bg-[#0e1117] border border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start sm:items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                        allProactiveEnabled
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : partiallyEnabled
                            ? 'bg-[#e59a54]/15 border-[#e59a54]/40 text-[#e59a54]'
                            : 'bg-[#141821] border-white/8 text-slate-400'
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
                                ? 'text-[#e59a54]'
                                : 'text-slate-500'
                          }`}
                        >
                          · {enabledCount}/{totalCount} ativos
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Alterna simultaneamente o acompanhamento proativo para todos os projetos
                        registados.
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
                            ? 'bg-[#e59a54]/50 border-[#e59a54]/60'
                            : 'bg-slate-800 border-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full shadow-xs transition duration-200 mt-0.5 ${
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
                        ? 'bg-[#171c27] border-[#e59a54]/45'
                        : 'bg-[#0e1117] border-white/8'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span className="text-sm font-semibold text-slate-100">
                            {proj.name}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span className="font-mono text-[#e59a54]">{proj.rootPath}</span>
                          <span className="text-slate-600">·</span>
                          <span className="text-slate-400">{proj.techStack}</span>
                          <span className="text-slate-600">·</span>
                          <span className="text-emerald-400 font-mono tabular-nums">
                            Saúde {proj.healthScore}%
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">
                          {proj.ideaBrief || proj.description}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                          Branch {proj.gitBranch} · {proj.assignedAgentIds.length} agentes alocados ·{' '}
                          {openCount} recomendação(ões) abertas
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 shrink-0">
                        {/* Proactive Intervention Frequency SVG Sparkline */}
                        <div
                          data-testid={`proj-sparkline-${proj.id}`}
                          className="px-2.5 py-1.5 rounded-lg bg-[#141821] border border-white/7 flex items-center gap-2.5"
                          title={`Frequência de intervenção proativa: atual ${freqStats.currentPerHour}/h · média ${freqStats.avgPerHour}/h · pico ${freqStats.peakPerHour}/h`}
                        >
                          <div className="space-y-0.5">
                            <p className="text-[10px] text-slate-400">Freq. Proativa</p>
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
                                : 'bg-[#141821] border-white/8 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            {proj.proactiveEnabled ? 'Proativo ON' : 'Proativo OFF'}
                          </button>

                          {!isActive && (
                            <button
                              type="button"
                              onClick={() => {
                                handleActivateProject(proj.id);
                                setProjectsModalOpen(false);
                              }}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#e59a54] text-slate-950 hover:bg-[#eba868] transition-colors"
                            >
                              Abrir no Estúdio
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
              onSubmit={handleCreateProjectInPortfolio}
              className="pt-4 border-t border-white/8 space-y-3"
            >
              <p className="text-xs font-semibold text-slate-200">
                Registar Novo Projeto ou Repositório
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  placeholder="Nome do projeto (ex: Website SaaS)"
                  className="px-3 py-2 text-xs bg-[#0b0d11] border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:border-[#e59a54]"
                />
                <input
                  type="text"
                  value={newProjPath}
                  onChange={(e) => setNewProjPath(e.target.value)}
                  placeholder="Caminho raiz (ex: web-saas)"
                  className="px-3 py-2 text-xs font-mono bg-[#0b0d11] border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:border-[#e59a54]"
                />
                <input
                  type="text"
                  value={newProjStack}
                  onChange={(e) => setNewProjStack(e.target.value)}
                  placeholder="Stack (ex: React · TypeScript)"
                  className="px-3 py-2 text-xs bg-[#0b0d11] border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:border-[#e59a54]"
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <input
                  type="text"
                  value={newProjDesc}
                  onChange={(e) => setNewProjDesc(e.target.value)}
                  placeholder="Objetivo ou resumo da ideia..."
                  className="flex-1 px-3 py-2 text-xs bg-[#0b0d11] border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:border-[#e59a54]"
                />
                <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={newProjProactive}
                    onChange={(e) => setNewProjProactive(e.target.checked)}
                    className="rounded border-slate-700 bg-[#0b0d11]"
                  />
                  Ativar Proatividade
                </label>
                <button
                  type="submit"
                  disabled={creatingProj}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#e59a54] text-slate-950 hover:bg-[#eba868] transition-colors shrink-0"
                >
                  {creatingProj ? 'A criar...' : '+ Adicionar Projeto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Command Palette */}
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

      <WelcomeWizardModal
        open={wizardOpen}
        settings={store.settings}
        onClose={() => setWizardOpen(false)}
        onSave={handleWizardSave}
      />

      {authDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Autenticação de Operador"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
          onClick={() => setAuthDialogOpen(false)}
        >
          <form
            onSubmit={handleOperatorTokenSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md studio-card rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#e59a54]" />
                <h2 className="text-base font-semibold text-slate-100 font-display">
                  Autenticação de Operador
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setAuthDialogOpen(false)}
                aria-label="Fechar janela de autenticação"
                className="text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              O Security Gate exige `JARVIS_API_TOKEN` para autorizar mutações e exportações neste
              endereço.
            </p>
            <div>
              <label htmlFor="modal-operator-token" className="block text-xs text-slate-300 mb-1">
                Token Bearer (`JARVIS_API_TOKEN`)
              </label>
              <input
                id="modal-operator-token"
                type="password"
                required
                value={operatorTokenInput}
                onChange={(e) => setOperatorTokenInput(e.target.value)}
                placeholder="Introduz o token secreto..."
                className="w-full px-3 py-2 text-xs font-mono bg-[#0b0d11] border border-white/12 rounded-lg text-slate-100 focus:outline-none focus:border-[#e59a54]"
              />
            </div>
            {authError && <p className="text-xs text-rose-400">{authError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAuthDialogOpen(false)}
                className="px-3.5 py-2 text-xs text-slate-300 bg-[#141821] rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={authSubmitting}
                className="px-4 py-2 text-xs font-semibold bg-[#e59a54] text-slate-950 rounded-lg hover:bg-[#eba868] disabled:opacity-50"
              >
                {authSubmitting ? 'A validar...' : 'Validar Token'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export const App: React.FC = () => (
  <ToastProvider>
    <InnerApp />
  </ToastProvider>
);

export default App;
