import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  FileUp,
  Layers,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PanelRightClose,
  PanelRightOpen,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Sparkles,
  Target,
  Trash2,
  UserPlus,
  Users,
  Volume2,
  Wrench,
  X,
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import type { NavSectionId } from '../../lib/i18n';
import {
  GeminiLiveVoiceClient,
  transcribeAudioBlobWithGemini,
  type LiveVoiceStatus,
} from '../../lib/live-voice-client';
import {
  filterProjectActivityLogs,
  normalizeGeminiVoiceName,
  resolveProjectAgentsList,
} from '../../shared/cortex-math';
import { STANDARD_SKILLS_LIBRARY } from '../../shared/skills-plugins-catalog';
import {
  GENERAL_CHAT_PROJECT_ID,
  type AppSettings,
  type AttachmentItem,
  type ChatMessage,
  type ChatThread,
  type GoalItem,
  type JarvisStoreData,
  type ProjectActivityLogEntry,
  type ProjectWorkspace,
  type Room,
  type ScreenCaptureSnapshot,
  type StudioInlineEvent,
} from '../../shared/types';
import { useToast } from '../ToastContext';
import { StudioLiveVoicePanel } from './StudioLiveVoicePanel';

export type StudioInspectorTab = 'logs' | 'goals' | 'agents' | 'screen';

interface BrowserSpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface StudioWorkspaceViewProps {
  store: JarvisStoreData;
  activeProject: ProjectWorkspace | null;
  activeChat: ChatThread;
  preferredResponderId?: string;
  onSelectResponder?: (roomId: string) => void;
  onToggleProjectAgent?: (roomId: string) => Promise<void>;
  onRefreshBootstrap: () => Promise<void>;
  onNavigateModule: (section: NavSectionId) => void;
  onCreateNewChat: () => Promise<void>;
}

function renderFormattedContent(content: string): React.ReactNode {
  const lines = content.split('\n');
  return lines.map((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      return <div key={`sp-${idx}`} className="h-2" />;
    }

    const formatInline = (text: string): React.ReactNode[] => {
      const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
      return parts.map((part, pIdx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={pIdx} className="font-semibold text-slate-100">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={pIdx}
              className="px-1.5 py-0.5 rounded bg-[#0d1017] border border-white/8 text-[12px] font-mono text-[#e59a54]"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <React.Fragment key={pIdx}>{part}</React.Fragment>;
      });
    };

    if (trimmed.startsWith('- [ ] ') || trimmed.startsWith('- [x] ')) {
      const checked = trimmed.startsWith('- [x] ');
      return (
        <div key={`chk-${idx}`} className="flex items-start gap-2 pl-2 py-0.5 text-sm text-slate-300">
          {checked ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <Circle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          )}
          <span>{formatInline(trimmed.slice(6))}</span>
        </div>
      );
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      return (
        <div key={`li-${idx}`} className="flex items-start gap-2.5 py-0.5 text-[14px] leading-relaxed text-slate-200">
          <span className="text-[#e59a54] mt-1 text-xs select-none" aria-hidden="true">
            •
          </span>
          <div className="min-w-0 flex-1">{formatInline(trimmed.slice(2))}</div>
        </div>
      );
    }

    return (
      <p key={`p-${idx}`} className="text-[14px] leading-relaxed text-slate-200">
        {formatInline(rawLine)}
      </p>
    );
  });
}

function getKindLabel(kind: ProjectActivityLogEntry['kind']): string {
  switch (kind) {
    case 'THOUGHT':
      return 'Raciocínio';
    case 'GOAL_CREATED':
      return 'Novo Goal';
    case 'GOAL_UPDATED':
      return 'Goal Atualizado';
    case 'AGENT_SPAWNED':
      return 'Sub-Agente';
    case 'AGENT_DELEGATED':
      return 'Delegação';
    case 'SKILL_ACTIVATED':
      return 'Skill';
    case 'MCP_TOOL':
      return 'MCP Tool';
    case 'SCREEN_VISION':
      return 'Visão Ecrã';
    case 'VOICE_LIVE':
      return 'Voz Live';
    case 'AUDIO_TRANSCRIBE':
      return 'Transcrição';
    case 'SYSTEM_STEP':
    default:
      return 'Execução';
  }
}

function getKindAccentClass(kind: ProjectActivityLogEntry['kind']): string {
  switch (kind) {
    case 'GOAL_CREATED':
    case 'GOAL_UPDATED':
      return 'text-[#e59a54]';
    case 'AGENT_SPAWNED':
    case 'AGENT_DELEGATED':
      return 'text-[#8ea6ff]';
    case 'SKILL_ACTIVATED':
    case 'MCP_TOOL':
      return 'text-emerald-400';
    case 'VOICE_LIVE':
    case 'AUDIO_TRANSCRIBE':
      return 'text-amber-300';
    case 'SCREEN_VISION':
      return 'text-sky-300';
    default:
      return 'text-slate-400';
  }
}

export const StudioWorkspaceView: React.FC<StudioWorkspaceViewProps> = ({
  store,
  activeProject,
  activeChat,
  preferredResponderId,
  onSelectResponder,
  onToggleProjectAgent,
  onRefreshBootstrap,
  onNavigateModule,
  onCreateNewChat,
}) => {
  const { pushToast } = useToast();
  const isGeneralMode = !activeProject;
  const effectiveProjectId = activeProject?.id || GENERAL_CHAT_PROJECT_ID;

  // Inspector state
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<StudioInspectorTab>('logs');
  const [agentsQuickPanelOpen, setAgentsQuickPanelOpen] = useState(true);
  const [manageProjectAgentsOpen, setManageProjectAgentsOpen] = useState(false);
  const [togglingAgentId, setTogglingAgentId] = useState<string | null>(null);
  const [logScope, setLogScope] = useState<'CHAT' | 'PROJECT'>('CHAT');
  const [logSearch, setLogSearch] = useState('');

  // Chat composer state
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    preferredResponderId || activeChat.primaryAgentId || 'room-exec'
  );
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [listeningVoice, setListeningVoice] = useState(false);
  const [transcribingVoice, setTranscribingVoice] = useState(false);

  // Gemini 3.8 Live Voice & Persona Selector state
  const [liveVoicePanelOpen, setLiveVoicePanelOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveVoiceStatus>('IDLE');
  const [liveMuted, setLiveMuted] = useState(false);
  const [liveStatusDetail, setLiveStatusDetail] = useState('');
  const [liveUserTranscript, setLiveUserTranscript] = useState('');
  const [liveAssistantTranscript, setLiveAssistantTranscript] = useState('');

  // Goal creation state
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalSubtasksText, setNewGoalSubtasksText] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);

  // Sub-agent quick creation state
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('');
  const [savingAgent, setSavingAgent] = useState(false);

  // Live Screen Vision state (Browser getDisplayMedia + Sidecar Native Capture)
  const [screenStreamActive, setScreenStreamActive] = useState(false);
  const [screenAutoSend, setScreenAutoSend] = useState<boolean>(
    activeChat.screenAutoSendEnabled !== false
  );
  const [continuousWatch, setContinuousWatch] = useState(false);
  const [capturingSidecar, setCapturingSidecar] = useState(false);
  const [analyzingScreen, setAnalyzingScreen] = useState(false);
  const [localSnapshot, setLocalSnapshot] = useState<ScreenCaptureSnapshot | null>(
    store.latestScreenSnapshot || null
  );

  const streamRef = useRef<MediaStream | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const speechRecRef = useRef<BrowserSpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamDictateRef = useRef<MediaStream | null>(null);
  const liveVoiceClientRef = useRef<GeminiLiveVoiceClient | null>(null);

  useEffect(() => {
    setSelectedAgentId(preferredResponderId || activeChat.primaryAgentId || 'room-exec');
    setScreenAutoSend(activeChat.screenAutoSendEnabled !== false);
  }, [activeChat.id, activeChat.primaryAgentId, activeChat.screenAutoSendEnabled, preferredResponderId]);

  useEffect(() => {
    if (isGeneralMode && activeTab === 'goals') {
      setActiveTab('logs');
    }
  }, [isGeneralMode, activeTab]);

  const handleSelectResponder = useCallback(
    (roomId: string) => {
      setSelectedAgentId(roomId);
      onSelectResponder?.(roomId);
    },
    [onSelectResponder]
  );

  const handleQuickToggleAgent = useCallback(
    async (roomId: string) => {
      if (!onToggleProjectAgent || togglingAgentId) return;
      setTogglingAgentId(roomId);
      try {
        await onToggleProjectAgent(roomId);
      } finally {
        setTogglingAgentId(null);
      }
    },
    [onToggleProjectAgent, togglingAgentId]
  );

  useEffect(() => {
    if (store.latestScreenSnapshot) {
      setLocalSnapshot(store.latestScreenSnapshot);
    }
  }, [store.latestScreenSnapshot]);

  // Attach MediaStream to visible preview video whenever tab changes or stream activates
  useEffect(() => {
    const stream = streamRef.current;
    if (hiddenVideoRef.current && stream) {
      hiddenVideoRef.current.srcObject = stream;
      hiddenVideoRef.current.play().catch(() => {});
    }
    if (videoPreviewRef.current && stream) {
      videoPreviewRef.current.srcObject = stream;
      videoPreviewRef.current.play().catch(() => {});
    }
  }, [screenStreamActive, activeTab, inspectorOpen]);

  // Cleanup MediaStream & Live Voice session on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (mediaStreamDictateRef.current) {
        mediaStreamDictateRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamDictateRef.current = null;
      }
      liveVoiceClientRef.current?.stop();
      liveVoiceClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    liveVoiceClientRef.current?.setDspEnabled(store.settings.voiceDspEnabled);
  }, [store.settings.voiceDspEnabled]);

  // Grab a compressed JPEG frame from the live WebRTC screen stream
  const grabBrowserStreamFrame = useCallback((): {
    mimeType: string;
    dataBase64: string;
    width: number;
    height: number;
    source: 'BROWSER_STREAM';
    activeWindowTitle: string;
  } | null => {
    const vid = hiddenVideoRef.current || videoPreviewRef.current;
    if (!screenStreamActive || !streamRef.current || !vid || vid.videoWidth === 0) {
      return null;
    }
    const maxW = 1280;
    const scale = Math.min(1, maxW / vid.videoWidth);
    const width = Math.max(320, Math.round(vid.videoWidth * scale));
    const height = Math.max(180, Math.round(vid.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(vid, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    const base64 = dataUrl.split(',')[1] || '';
    if (!base64) return null;
    const trackLabel = streamRef.current.getVideoTracks()[0]?.label || 'Ecrã em Direto';
    return {
      mimeType: 'image/jpeg',
      dataBase64: base64,
      width,
      height,
      source: 'BROWSER_STREAM',
      activeWindowTitle: trackLabel,
    };
  }, [screenStreamActive]);

  const handleStartBrowserScreenShare = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      pushToast({
        title: 'Partilha de ecrã não suportada neste navegador',
        detail: 'Usa o botão "Capturar Sidecar" para capturar o ecrã diretamente da máquina.',
        tone: 'info',
      });
      setActiveTab('screen');
      setInspectorOpen(true);
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 10 } },
        audio: false,
      });
      streamRef.current = mediaStream;
      setScreenStreamActive(true);
      setInspectorOpen(true);
      setActiveTab('screen');

      const [videoTrack] = mediaStream.getVideoTracks();
      if (videoTrack) {
        videoTrack.onended = () => {
          streamRef.current = null;
          setScreenStreamActive(false);
          setContinuousWatch(false);
        };
      }

      pushToast({
        title: 'Acesso ao ecrã em tempo real ativo',
        detail: 'O Jarvis já consegue ver o teu ecrã em direto enquanto conversam.',
        tone: 'success',
      });
    } catch (err) {
      const msg = (err as Error).message || '';
      if (!msg.toLowerCase().includes('permission') && !msg.toLowerCase().includes('cancel')) {
        pushToast({
          title: 'Não foi possível iniciar o stream do navegador',
          detail: 'Podes usar a Captura Sidecar em alternativa.',
          tone: 'info',
        });
      }
    }
  };

  const handleStopBrowserScreenShare = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScreenStreamActive(false);
    setContinuousWatch(false);
  };

  const handleCaptureSidecarScreen = async () => {
    setCapturingSidecar(true);
    try {
      const res = await apiJson<{ snapshot: ScreenCaptureSnapshot }>('/api/screen/sidecar-capture', {
        method: 'POST',
        body: JSON.stringify({
          projectId: effectiveProjectId,
          chatId: activeChat.id,
        }),
      });
      setLocalSnapshot(res.snapshot);
      setInspectorOpen(true);
      setActiveTab('screen');
      await onRefreshBootstrap();
      pushToast({
        title: 'Ecrã capturado via Sidecar',
        detail: `${res.snapshot.activeWindowTitle || res.snapshot.hostname} (${res.snapshot.width}×${res.snapshot.height})`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao capturar ecrã no Sidecar',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setCapturingSidecar(false);
    }
  };

  const handleAnalyzeScreenNow = useCallback(
    async (postToChat = true) => {
      setAnalyzingScreen(true);
      try {
        const liveFrame = grabBrowserStreamFrame();
        const payloadFrame =
          liveFrame ||
          (localSnapshot
            ? {
                mimeType: localSnapshot.mimeType,
                dataBase64: localSnapshot.dataBase64,
                width: localSnapshot.width,
                height: localSnapshot.height,
                source: localSnapshot.source,
                activeWindowTitle: localSnapshot.activeWindowTitle,
              }
            : undefined);

        const res = await apiJson<{
          analysis: string;
          snapshot: ScreenCaptureSnapshot;
          engineUsed: string;
        }>('/api/screen/analyze', {
          method: 'POST',
          body: JSON.stringify({
            projectId: effectiveProjectId,
            chatId: activeChat.id,
            screenFrame: payloadFrame,
            postToChat,
          }),
        });
        setLocalSnapshot(res.snapshot);
        await onRefreshBootstrap();
        if (postToChat) {
          pushToast({
            title: 'Jarvis analisou o teu ecrã',
            detail: res.analysis.slice(0, 95),
            tone: 'success',
          });
        }
      } catch (err) {
        pushToast({
          title: 'Erro ao analisar ecrã',
          detail: (err as Error).message,
          tone: 'error',
        });
      } finally {
        setAnalyzingScreen(false);
      }
    },
    [activeChat.id, effectiveProjectId, grabBrowserStreamFrame, localSnapshot, onRefreshBootstrap, pushToast]
  );

  // Continuous 20s screen observation timer when enabled
  useEffect(() => {
    if (!continuousWatch) return;
    const timer = window.setInterval(() => {
      handleAnalyzeScreenNow(false);
    }, 20000);
    return () => window.clearInterval(timer);
  }, [continuousWatch, handleAnalyzeScreenNow]);

  // Real-time 1 FPS Screen Stream -> Gemini 3.8 Live Voice Session Sync
  useEffect(() => {
    if (
      liveStatus !== 'LIVE' ||
      !screenStreamActive ||
      store.settings.liveVoiceScreenSync === false
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      const frame = grabBrowserStreamFrame();
      if (frame && liveVoiceClientRef.current) {
        liveVoiceClientRef.current.sendVideoFrame(frame.dataBase64, frame.mimeType);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [
    liveStatus,
    screenStreamActive,
    store.settings.liveVoiceScreenSync,
    grabBrowserStreamFrame,
  ]);

  const handleUpdateVoiceSettings = async (updates: Partial<AppSettings>) => {
    await apiJson('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    await onRefreshBootstrap();
  };

  const handleToggleLiveVoiceSession = async () => {
    if (liveStatus === 'LIVE' || liveStatus === 'CONNECTING') {
      liveVoiceClientRef.current?.stop();
      setLiveStatus('IDLE');
      setLiveMuted(false);
      setLiveUserTranscript('');
      setLiveAssistantTranscript('');
      setLiveStatusDetail('Sessão de voz em direto concluída.');
      return;
    }

    if (!liveVoiceClientRef.current) {
      liveVoiceClientRef.current = new GeminiLiveVoiceClient();
    }

    const activeVoice = normalizeGeminiVoiceName(store.settings.preferredVoiceName);
    setLiveVoicePanelOpen(true);
    setLiveUserTranscript('');
    setLiveAssistantTranscript('');

    await liveVoiceClientRef.current.start({
      voiceName: activeVoice,
      projectId: effectiveProjectId,
      chatId: activeChat.id,
      language: store.settings.language,
      dspEnabled: store.settings.voiceDspEnabled,
      callbacks: {
        onStatusChange: (st, detail) => {
          setLiveStatus(st);
          if (detail) setLiveStatusDetail(detail);
        },
        onInputTranscript: (txt) => setLiveUserTranscript(txt),
        onOutputTranscript: (txt) => setLiveAssistantTranscript(txt),
        onToolExecuted: () => {
          onRefreshBootstrap().catch(() => {});
        },
        onTurnComplete: () => {
          setLiveUserTranscript('');
          setLiveAssistantTranscript('');
          onRefreshBootstrap().catch(() => {});
        },
      },
    });
  };

  const handleToggleLiveMute = () => {
    const next = !liveMuted;
    setLiveMuted(next);
    liveVoiceClientRef.current?.setMuted(next);
  };

  // Scoped data for active project or General Chat mode
  const chatMessages = useMemo(() => {
    return store.messages.filter((m) => {
      if (m.chatId) return m.chatId === activeChat.id;
      if (isGeneralMode) return m.projectId === GENERAL_CHAT_PROJECT_ID;
      return effectiveProjectId === 'proj-jarvis-core' && m.roomId === 'room-exec';
    });
  }, [store.messages, activeChat.id, isGeneralMode, effectiveProjectId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages.length]);

  const projectGoals = useMemo(() => {
    if (isGeneralMode) return [];
    return store.goals.filter((g) => {
      if (g.projectId) return g.projectId === effectiveProjectId;
      return effectiveProjectId === 'proj-jarvis-core';
    });
  }, [store.goals, isGeneralMode, effectiveProjectId]);

  const projectAgents = useMemo(
    () => resolveProjectAgentsList(store.rooms, activeProject),
    [store.rooms, activeProject]
  );

  const availableExtraFleetAgents = useMemo(
    () =>
      store.rooms.filter(
        (r) => r.id !== 'room-exec' && !projectAgents.some((pa) => pa.id === r.id)
      ),
    [store.rooms, projectAgents]
  );

  const scopedLogs = useMemo(() => {
    const base = filterProjectActivityLogs(store.projectActivityLogs || [], {
      projectId: effectiveProjectId,
      chatId: activeChat.id,
      scope: isGeneralMode ? 'CHAT' : logScope,
    });
    const q = logSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (l) =>
        l.summary.toLowerCase().includes(q) ||
        l.actor.toLowerCase().includes(q) ||
        (l.detail || '').toLowerCase().includes(q)
    );
  }, [store.projectActivityLogs, effectiveProjectId, activeChat.id, isGeneralMode, logScope, logSearch]);

  const completedGoalsCount = projectGoals.filter((g) => g.status === 'COMPLETED').length;
  const avgGoalProgress =
    projectGoals.length > 0
      ? Math.round(projectGoals.reduce((acc, g) => acc + g.progress, 0) / projectGoals.length)
      : 0;

  const starterSuggestions = useMemo(() => {
    if (!activeProject) {
      return [
        'Faz-me um ponto de situação rápido de todos os meus projetos, aprovações pendentes e contratos de hoje',
        'Ajuda-me a pensar numa arquitetura ou resolver uma dúvida rápida fora dos projetos atuais',
        'Mostra o estado da memória sináptica, Sidecar e motores LLM do J.A.R.V.I.S. OS',
      ];
    }
    if (activeProject.ideaCategory === 'WEBSITE') {
      return [
        'Quero criar uma landing page SaaS moderna com autenticação OAuth e pagamentos Stripe — define os Goals e cria um sub-agente UI',
        'Vamos estruturar o SEO, blog técnico e painel de cliente para o website',
        'Vê o que está no meu ecrã agora e sugere melhorias de estrutura e UX',
      ];
    }
    if (activeProject.ideaCategory === 'APP') {
      return [
        'Vamos planear os ecrãs principais da app mobile, onboarding e sincronização offline — define os Goals e sub-agentes',
        'Quero adicionar notificações push e autenticação biométrica à aplicação',
        'Analisa o meu ecrã atual e ajuda-me no próximo passo da app',
      ];
    }
    return [
      `Vamos estruturar os próximos Goals e recrutar um sub-agente especialista para ${activeProject.name}`,
      'Usa o Gateway MCP para pesquisar decisões na memória do projeto e alinhar prioridades',
      'Captura o meu ecrã pelo Sidecar e diz-me o que estás a ver em tempo real',
    ];
  }, [activeProject]);

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = (customPrompt ?? input).trim();
    if (!textToSend && attachments.length === 0) return;
    if (sending) return;

    setSending(true);
    if (!customPrompt) setInput('');

    try {
      let screenFramePayload:
        | {
            mimeType: string;
            dataBase64: string;
            width: number;
            height: number;
            source: 'BROWSER_STREAM' | 'SIDECAR_NATIVE';
            activeWindowTitle?: string;
          }
        | undefined;

      if (screenAutoSend) {
        const liveBrowserFrame = grabBrowserStreamFrame();
        if (liveBrowserFrame) {
          screenFramePayload = liveBrowserFrame;
        } else if (
          localSnapshot &&
          Date.now() - Date.parse(localSnapshot.capturedAt) < 120_000
        ) {
          screenFramePayload = {
            mimeType: localSnapshot.mimeType,
            dataBase64: localSnapshot.dataBase64,
            width: localSnapshot.width,
            height: localSnapshot.height,
            source: localSnapshot.source,
            activeWindowTitle: localSnapshot.activeWindowTitle,
          };
        }
      }

      await apiJson<{ assistantMessage: ChatMessage }>('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({
          roomId: selectedAgentId,
          chatId: activeChat.id,
          projectId: effectiveProjectId,
          content: textToSend,
          attachments,
          screenFrame: screenFramePayload,
        }),
      });

      setAttachments([]);
      await onRefreshBootstrap();
    } catch (err) {
      pushToast({
        title: 'Erro ao enviar mensagem',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setSending(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const resStr = String(reader.result || '');
        const b64 = resStr.includes(',') ? resStr.split(',')[1] : resStr;
        setAttachments((prev) => [
          ...prev,
          {
            id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            dataBase64: b64,
            sizeBytes: file.size,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const startLocalSpeechRecognitionFallback = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => BrowserSpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognitionInstance;
    };
    const RecCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!RecCtor) {
      pushToast({
        title: 'Ditado por voz indisponível neste navegador',
        tone: 'info',
      });
      return;
    }

    const rec = new RecCtor();
    rec.lang = store.settings.language === 'en-US' ? 'en-US' : 'pt-PT';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      const transcript = ev.results?.[0]?.[0]?.transcript || '';
      if (transcript) {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };
    rec.onerror = () => setListeningVoice(false);
    rec.onend = () => setListeningVoice(false);
    speechRecRef.current = rec;
    setListeningVoice(true);
    rec.start();
  };

  const handleToggleVoiceDictation = async () => {
    if (transcribingVoice) return;

    // Stop active MediaRecorder clip -> send to gemini-3.5-transcribe
    if (listeningVoice && mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setListeningVoice(false);
      return;
    }

    // Stop active browser SpeechRecognition fallback
    if (listeningVoice && speechRecRef.current) {
      speechRecRef.current.stop();
      setListeningVoice(false);
      return;
    }

    // High-accuracy server-side transcription (`gemini-3.5-transcribe`) when Gemini Studio provider is active
    const useGeminiTranscribe =
      store.settings.modelProvider === 'GEMINI_STUDIO' &&
      typeof window !== 'undefined' &&
      typeof MediaRecorder !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia);

    if (useGeminiTranscribe) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamDictateRef.current = stream;
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : MediaRecorder.isTypeSupported('audio/mp4')
              ? 'audio/mp4'
              : '';
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            chunks.push(ev.data);
          }
        };

        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          mediaStreamDictateRef.current = null;
          mediaRecorderRef.current = null;

          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          if (blob.size < 256) return;

          setTranscribingVoice(true);
          try {
            const res = await transcribeAudioBlobWithGemini({
              blob,
              language: store.settings.language,
              projectId: effectiveProjectId,
              chatId: activeChat.id,
            });
            if (res.ok && res.transcript) {
              setInput((prev) => (prev ? `${prev} ${res.transcript}` : res.transcript));
              await onRefreshBootstrap();
            } else if (!res.ok) {
              pushToast({
                title: 'Transcrição Gemini indisponível',
                detail: res.error || 'Podes usar o ditado local ou verificar GEMINI_API_KEY.',
                tone: 'info',
              });
            }
          } catch (err) {
            pushToast({
              title: 'Erro ao transcrever áudio',
              detail: (err as Error).message,
              tone: 'error',
            });
          } finally {
            setTranscribingVoice(false);
          }
        };

        mediaRecorderRef.current = recorder;
        setListeningVoice(true);
        recorder.start();
        return;
      } catch {
        // Fallback to local SpeechRecognition if MediaRecorder/mic fails
      }
    }

    startLocalSpeechRecognitionFallback();
  };

  const handleToggleGoalSubtask = async (goal: GoalItem, subtaskId: string) => {
    const nextSubtasks = (goal.subtasks || []).map((st) =>
      st.id === subtaskId ? { ...st, done: !st.done } : st
    );
    await apiJson(`/api/goals/${goal.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ subtasks: nextSubtasks }),
    });
    await onRefreshBootstrap();
  };

  const handleChangeGoalStatus = async (goalId: string, status: GoalItem['status']) => {
    await apiJson(`/api/goals/${goalId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        progress: status === 'COMPLETED' ? 100 : undefined,
      }),
    });
    await onRefreshBootstrap();
  };

  const handleDeleteGoal = async (goalId: string) => {
    await apiJson(`/api/goals/${goalId}`, { method: 'DELETE' });
    await onRefreshBootstrap();
  };

  const handleCreateGoalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isGeneralMode || !newGoalTitle.trim() || savingGoal) return;
    setSavingGoal(true);
    try {
      const subtasks = newGoalSubtasksText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await apiJson('/api/goals', {
        method: 'POST',
        body: JSON.stringify({
          title: newGoalTitle.trim(),
          projectId: effectiveProjectId,
          chatId: activeChat.id,
          subtasks: subtasks.length > 0 ? subtasks : undefined,
        }),
      });
      setNewGoalTitle('');
      setNewGoalSubtasksText('');
      setShowGoalForm(false);
      await onRefreshBootstrap();
      pushToast({ title: 'Goal adicionado ao projeto', tone: 'success' });
    } finally {
      setSavingGoal(false);
    }
  };

  const handleCreateSubagentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim() || savingAgent) return;
    setSavingAgent(true);
    try {
      const res = await apiJson<{ room: Room }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: newAgentName.trim(),
          roleTitle: newAgentRole.trim() || 'Sub-Agente Especialista do Projeto',
          projectId: activeProject ? activeProject.id : undefined,
          chatId: activeChat.id,
        }),
      });
      setNewAgentName('');
      setNewAgentRole('');
      setShowAgentForm(false);
      setManageProjectAgentsOpen(false);
      handleSelectResponder(res.room.id);
      await onRefreshBootstrap();
      pushToast({
        title: `Sub-agente ${res.room.name} criado`,
        detail: 'Já podes delegar tarefas diretamente na conversa.',
        tone: 'success',
      });
    } finally {
      setSavingAgent(false);
    }
  };

  const handleToggleProjectSkill = async (skillIdOrTemplateId: string, isInstalled: boolean) => {
    if (!activeProject) return;
    let resolvedSkillId = skillIdOrTemplateId;
    if (!isInstalled) {
      const res = await apiJson<{ skill: { id: string } }>('/api/skills/install-template', {
        method: 'POST',
        body: JSON.stringify({ templateId: skillIdOrTemplateId }),
      });
      resolvedSkillId = res.skill.id;
    }

    const currentIds = new Set(activeProject.activeSkillIds || []);
    if (currentIds.has(resolvedSkillId)) {
      currentIds.delete(resolvedSkillId);
    } else {
      currentIds.add(resolvedSkillId);
    }

    await apiJson(`/api/projects/${activeProject.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activeSkillIds: Array.from(currentIds) }),
    });
    await onRefreshBootstrap();
  };

  const handleClearLogs = async () => {
    const qs = new URLSearchParams({
      projectId: effectiveProjectId,
      chatId: activeChat.id,
      scope: isGeneralMode ? 'CHAT' : logScope,
    });
    await apiJson(`/api/activity-logs?${qs.toString()}`, { method: 'DELETE' });
    await onRefreshBootstrap();
  };

  const handleInlineEventClick = (ev: StudioInlineEvent) => {
    setInspectorOpen(true);
    if (ev.type === 'GOAL') setActiveTab('goals');
    else if (ev.type === 'AGENT' || ev.type === 'SKILL') setActiveTab('agents');
    else if (ev.type === 'SCREEN') setActiveTab('screen');
    else setActiveTab('logs');
  };

  const selectedAgentObj =
    projectAgents.find((a) => a.id === selectedAgentId) || store.rooms[0];

  return (
    <div
      data-testid="studio-workspace-root"
      className="flex-1 flex min-h-0 h-full overflow-hidden"
    >
      {/* Hidden video element keeping WebRTC screen stream warm even when Inspector is on another tab */}
      <video ref={hiddenVideoRef} className="hidden" autoPlay playsInline muted />

      {/* ====================================================================
          CENTER STAGE: Conversational Idea Workspace (Claude Projects Style)
         ==================================================================== */}
      <section className="flex-1 flex flex-col min-w-0 h-full studio-canvas">
        {/* Top Studio Context Bar */}
        <header className="h-13 px-5 border-b border-white/7 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="text-sm font-semibold text-slate-100 font-display truncate">
              {activeProject ? activeProject.name : 'Conversa Geral · J.A.R.V.I.S. Livre'}
            </h1>
            <span className="text-slate-600 shrink-0" aria-hidden="true">
              /
            </span>
            <span className="text-xs text-slate-400 truncate">{activeChat.title}</span>
            <button
              type="button"
              onClick={onCreateNewChat}
              title={activeProject ? 'Nova conversa neste projeto' : 'Nova conversa geral'}
              className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/6 transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Active Responder Selector */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
              <Bot className="w-3.5 h-3.5 text-[#e59a54] shrink-0" />
              <select
                aria-label="Selecionar agente ativo na conversa"
                value={selectedAgentObj?.id || 'room-exec'}
                onChange={(e) => handleSelectResponder(e.target.value)}
                className="bg-[#141821] border border-white/8 hover:border-white/16 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-[#e59a54] max-w-48 truncate"
              >
                {projectAgents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.id === 'room-exec'
                      ? 'Jarvis Principal (Coordenador)'
                      : `${ag.name} (Sub-Agente)`}
                  </option>
                ))}
              </select>
            </div>

            {/* Quick Unified LLM Engines & Cost Button */}
            <button
              type="button"
              data-testid="open-llm-settings-btn"
              onClick={() => onNavigateModule('llm')}
              title="Configurar Motores LLM, Modos Locais e Custos"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-[#141821] border border-white/8 text-slate-300 hover:text-slate-100 hover:border-[#e59a54]/45 transition-colors whitespace-nowrap shrink-0"
            >
              <Layers className="w-3.5 h-3.5 text-[#e59a54]" />
              <span className="hidden md:inline">Motores LLM</span>
            </button>

            {/* Quick Voice Persona & Gemini 3.8 Live Button */}
            <button
              type="button"
              data-testid="studio-live-voice-toggle"
              onClick={() => setLiveVoicePanelOpen((prev) => !prev)}
              title="Escolher Tipo de Voz e Conversar em Direto (gemini-3.8-live)"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                liveStatus === 'LIVE'
                  ? 'bg-emerald-500/16 border-emerald-400/45 text-emerald-300'
                  : liveVoicePanelOpen
                    ? 'bg-[#e59a54]/16 border-[#e59a54]/45 text-[#f3c394]'
                    : 'bg-[#141821] border-white/8 text-slate-300 hover:text-slate-100 hover:border-[#e59a54]/45'
              }`}
            >
              {liveStatus === 'LIVE' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              ) : (
                <PhoneCall className="w-3.5 h-3.5 text-[#e59a54]" />
              )}
              <span>
                {liveStatus === 'LIVE'
                  ? `Live · ${normalizeGeminiVoiceName(store.settings.preferredVoiceName)}`
                  : `Voz · ${normalizeGeminiVoiceName(store.settings.preferredVoiceName)}`}
              </span>
            </button>

            {/* Quick Screen Vision Button */}
            <button
              type="button"
              onClick={() => {
                setInspectorOpen(true);
                setActiveTab('screen');
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                screenStreamActive
                  ? 'bg-emerald-500/14 border-emerald-400/40 text-emerald-300'
                  : 'bg-[#141821] border-white/8 text-slate-300 hover:text-slate-100 hover:border-white/16'
              }`}
            >
              {screenStreamActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
              <Monitor className="w-3.5 h-3.5" />
              <span className="hidden md:inline">
                {screenStreamActive ? 'Ecrã em Direto' : 'Ecrã'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setInspectorOpen((prev) => !prev)}
              aria-label={inspectorOpen ? 'Ocultar painel direito' : 'Mostrar painel direito'}
              title={inspectorOpen ? 'Ocultar painel do projeto' : 'Mostrar painel do projeto'}
              className="p-1.5 rounded-lg bg-[#141821] border border-white/8 text-slate-300 hover:text-slate-100 hover:border-white/16 transition-colors"
            >
              {inspectorOpen ? (
                <PanelRightClose className="w-4 h-4" />
              ) : (
                <PanelRightOpen className="w-4 h-4" />
              )}
            </button>
          </div>
        </header>

        {/* Docked Voice Personas & Gemini 3.8 Live Conversation Bar */}
        {(liveVoicePanelOpen || liveStatus === 'LIVE' || liveStatus === 'CONNECTING') && (
          <StudioLiveVoicePanel
            settings={store.settings}
            liveStatus={liveStatus}
            liveMuted={liveMuted}
            liveStatusDetail={liveStatusDetail}
            liveUserTranscript={liveUserTranscript}
            liveAssistantTranscript={liveAssistantTranscript}
            screenStreamActive={screenStreamActive}
            onClose={() => setLiveVoicePanelOpen(false)}
            onUpdateSettings={handleUpdateVoiceSettings}
            onToggleLiveSession={handleToggleLiveVoiceSession}
            onToggleMute={handleToggleLiveMute}
          />
        )}

        {/* Scrollable Conversation Feed */}
        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Project Brief or General Chat Header inside Thread */}
            <div className="pb-4 border-b border-white/6 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              {activeProject ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>{activeProject.ideaCategory || 'PROJETO'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeProject.techStack}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {projectGoals.length} Goals ({avgGoalProgress}%)
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{projectAgents.length} Agentes</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {activeProject.ideaBrief || activeProject.description}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="font-mono text-[#e59a54]">CONVERSA LIVRE</span>
                    <span aria-hidden="true">·</span>
                    <span>SEM PROJETO ASSOCIADO</span>
                    <span aria-hidden="true">·</span>
                    <span>ACESSO TOTAL AO CORTEX OS</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Conversa aberta não vinculada a nenhum projeto específico. Podes falar
                    livremente, consultar qualquer projeto ou coordenar todo o sistema J.A.R.V.I.S.
                  </p>
                </div>
              )}
            </div>

            {/* Message Thread */}
            <div className="space-y-5" data-testid="studio-chat-messages">
              {chatMessages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <article
                    key={msg.id}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-2 mb-1.5 text-[11px] text-slate-500">
                      <span className="font-medium text-slate-300">
                        {isUser
                          ? store.settings.operatorName || 'Tu'
                          : msg.agentName || 'Jarvis'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {msg.createdAt.slice(11, 16)}
                      </span>
                      {msg.screenIncluded && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-sky-300">Ecrã em tempo real incluído</span>
                        </>
                      )}
                    </div>

                    <div
                      className={
                        isUser
                          ? 'max-w-[85%] rounded-2xl px-4 py-3 bg-[#191f2b] border border-white/8 text-[14px] leading-relaxed text-slate-100'
                          : 'w-full rounded-2xl px-5 py-4 bg-[#12161f] border border-white/6 space-y-2'
                      }
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <div className="space-y-1.5">{renderFormattedContent(msg.content)}</div>
                      )}

                      {/* Inline Interactive Studio Artifacts (Goals, Sub-Agents, Skills, MCP, Screen) */}
                      {!isUser && msg.studioEvents && msg.studioEvents.length > 0 && (
                        <div className="pt-3 mt-3 border-t border-white/6 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {msg.studioEvents.map((ev, eIdx) => (
                            <button
                              key={`${ev.id}-${eIdx}`}
                              type="button"
                              onClick={() => handleInlineEventClick(ev)}
                              className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#0d1017] border border-white/7 hover:border-[#e59a54]/45 text-left transition-colors"
                            >
                              <div className="mt-0.5 shrink-0">
                                {ev.type === 'GOAL' && (
                                  <Target className="w-4 h-4 text-[#e59a54]" />
                                )}
                                {ev.type === 'AGENT' && (
                                  <Bot className="w-4 h-4 text-[#8ea6ff]" />
                                )}
                                {ev.type === 'SKILL' && (
                                  <Sparkles className="w-4 h-4 text-emerald-400" />
                                )}
                                {ev.type === 'MCP' && (
                                  <Server className="w-4 h-4 text-emerald-400" />
                                )}
                                {ev.type === 'SCREEN' && (
                                  <Eye className="w-4 h-4 text-sky-300" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-slate-100 truncate">
                                  {ev.title}
                                </p>
                                {ev.subtitle && (
                                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                    {ev.subtitle}
                                  </p>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}

              {sending && (
                <div className="rounded-2xl px-5 py-4 bg-[#12161f] border border-white/6 flex items-center gap-3 text-xs text-slate-400">
                  <RefreshCw className="w-3.5 h-3.5 text-[#e59a54] animate-spin shrink-0" />
                  <span>
                    O Jarvis está a estruturar a resposta, atualizar Goals e registar os passos no
                    painel à direita...
                  </span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Starter Prompts when thread is fresh */}
            {chatMessages.length <= 2 && !sending && (
              <div className="pt-2 space-y-2">
                <p className="text-xs text-slate-500">Sugestões rápidas para esta ideia:</p>
                <div className="grid grid-cols-1 gap-2">
                  {starterSuggestions.map((sug, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSendMessage(sug)}
                      className="px-3.5 py-2.5 rounded-xl bg-[#12161f] border border-white/6 hover:border-[#e59a54]/40 text-left text-xs text-slate-300 hover:text-slate-100 transition-colors"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Multimodal Studio Composer */}
        <div className="px-5 pb-4 pt-2 shrink-0">
          <div className="max-w-3xl mx-auto rounded-2xl bg-[#141821] border border-white/10 focus-within:border-[#e59a54]/55 transition-colors p-3 space-y-2.5">
            {/* Active Screen Stream / Attachments Indicator Bar */}
            {(screenStreamActive || attachments.length > 0) && (
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/7 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {screenStreamActive && (
                    <div className="flex items-center gap-2 text-emerald-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Jarvis a ver o teu ecrã em direto</span>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={screenAutoSend}
                          onChange={(e) => setScreenAutoSend(e.target.checked)}
                          className="rounded border-slate-700 bg-[#0b0d11]"
                        />
                        <span>Enviar frame com a mensagem</span>
                      </label>
                    </div>
                  )}

                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#0d1017] border border-white/8 text-slate-300"
                    >
                      <span className="truncate max-w-36">{att.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setAttachments((prev) => prev.filter((x) => x.id !== att.id))
                        }
                        aria-label={`Remover anexo ${att.name}`}
                        className="text-slate-500 hover:text-slate-200"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                {screenStreamActive && (
                  <button
                    type="button"
                    onClick={handleStopBrowserScreenShare}
                    className="text-xs text-slate-400 hover:text-rose-300 transition-colors"
                  >
                    Parar partilha
                  </button>
                )}
              </div>
            )}

            <textarea
              rows={2}
              data-testid="studio-composer-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={
                activeProject
                  ? `Conversa com ${
                      selectedAgentObj?.id === 'room-exec'
                        ? 'o Jarvis Principal'
                        : selectedAgentObj?.name
                    } sobre "${activeProject.name}" — planeia funcionalidades, define Goals ou partilha o ecrã...`
                  : `Conversa livre com ${
                      selectedAgentObj?.id === 'room-exec'
                        ? 'o Jarvis Principal'
                        : selectedAgentObj?.name
                    } (sem projeto associado) — acesso total ao J.A.R.V.I.S. OS...`
              }
              className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 resize-none focus:outline-none"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.txt,.md,.json,.ts,.tsx,.py,.pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={
                    screenStreamActive
                      ? handleStopBrowserScreenShare
                      : handleStartBrowserScreenShare
                  }
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                    screenStreamActive
                      ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                      : 'bg-[#0e1117] border-white/7 text-slate-300 hover:text-slate-100 hover:border-white/15'
                  }`}
                >
                  {screenStreamActive ? (
                    <MonitorOff className="w-3.5 h-3.5" />
                  ) : (
                    <Monitor className="w-3.5 h-3.5" />
                  )}
                  <span>{screenStreamActive ? 'Parar Stream' : 'Partilhar Ecrã'}</span>
                </button>

                <button
                  type="button"
                  data-testid="composer-sidecar-capture-btn"
                  disabled={capturingSidecar}
                  onClick={handleCaptureSidecarScreen}
                  title="Capturar o ecrã real da máquina anfitriã via Sidecar"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#0e1117] border border-white/7 text-slate-300 hover:text-slate-100 hover:border-white/15 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <Eye className="w-3.5 h-3.5 text-sky-300" />
                  <span>{capturingSidecar ? 'A capturar...' : 'Capturar Sidecar'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Anexar imagem ou ficheiro"
                  className="p-1.5 rounded-lg bg-[#0e1117] border border-white/7 text-slate-400 hover:text-slate-100 hover:border-white/15 transition-colors"
                  aria-label="Anexar ficheiro"
                >
                  <FileUp className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  data-testid="studio-dictate-btn"
                  disabled={transcribingVoice}
                  onClick={handleToggleVoiceDictation}
                  title={
                    listeningVoice
                      ? 'Parar gravação e transcrever (gemini-3.5-transcribe)'
                      : 'Ditar ideia por voz (gemini-3.5-transcribe)'
                  }
                  aria-label={
                    listeningVoice
                      ? 'Parar gravação e transcrever com Gemini'
                      : 'Ditar ideia por voz'
                  }
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                    listeningVoice
                      ? 'bg-rose-500/20 border-rose-400/50 text-rose-200'
                      : transcribingVoice
                        ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                        : 'bg-[#0e1117] border-white/7 text-slate-300 hover:text-slate-100 hover:border-white/15'
                  }`}
                >
                  {transcribingVoice ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-300" />
                      <span>A transcrever...</span>
                    </>
                  ) : listeningVoice ? (
                    <>
                      <MicOff className="w-3.5 h-3.5 text-rose-300" />
                      <span>Concluir Ditado</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5 text-[#e59a54]" />
                      <span>Ditar</span>
                    </>
                  )}
                </button>
              </div>

              <button
                type="button"
                data-testid="studio-send-btn"
                disabled={sending || (!input.trim() && attachments.length === 0)}
                onClick={() => handleSendMessage()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#e59a54] text-[#0b0d11] hover:bg-[#f0ac6b] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{sending ? 'A enviar...' : 'Enviar'}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          RIGHT INSPECTOR PANEL: Antigravity-Style Per-Chat/Project Logs,
          Goals, Sub-Agents & Skills, and Live Screen Vision
         ==================================================================== */}
      {inspectorOpen && (
        <aside
          data-testid="studio-right-inspector"
          className="w-full sm:w-[372px] shrink-0 studio-inspector flex flex-col h-full overflow-hidden"
        >
          {/* Always-Visible Direct Access to Project Agents & Sub-Agents */}
          <div
            data-testid="studio-project-agents-panel"
            className="border-b border-white/8 bg-[#10141d] shrink-0"
          >
            <div className="px-3 py-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setAgentsQuickPanelOpen((prev) => !prev)}
                className="flex items-center gap-1.5 text-left text-xs font-semibold text-slate-200 hover:text-slate-100 min-w-0"
              >
                {agentsQuickPanelOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                <Users className="w-3.5 h-3.5 text-[#8ea6ff] shrink-0" />
                <span className="truncate">
                  {activeProject ? 'Agentes & Sub-Agentes do Projeto' : 'Agentes Cortex OS'}
                </span>
                <span className="font-mono tabular-nums text-[11px] text-[#e59a54] shrink-0">
                  {projectAgents.length}
                </span>
              </button>

              <button
                type="button"
                data-testid="toggle-manage-project-agents-btn"
                onClick={() => {
                  setAgentsQuickPanelOpen(true);
                  setManageProjectAgentsOpen((prev) => !prev);
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#181d28] border border-white/10 text-[11px] font-medium text-[#e59a54] hover:border-[#e59a54]/50 transition-colors whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-3 h-3" />
                <span>{manageProjectAgentsOpen ? 'Fechar' : 'Gerir'}</span>
              </button>
            </div>

            {agentsQuickPanelOpen && (
              <div className="px-2.5 pb-2.5 space-y-2">
                <div className="max-h-44 overflow-y-auto space-y-1 pr-0.5">
                  {projectAgents.map((ag) => {
                    const isSelected = ag.id === selectedAgentObj?.id;
                    const isPrincipal = ag.id === 'room-exec';
                    return (
                      <div
                        key={ag.id}
                        className={`rounded-lg border transition-colors flex items-center justify-between gap-1.5 px-2.5 py-1.5 ${
                          isSelected
                            ? 'bg-[#181f2c] border-[#e59a54]/55'
                            : 'bg-[#141821] border-white/7 hover:border-white/15'
                        }`}
                      >
                        <button
                          type="button"
                          data-testid={`conversation-agent-chip-${ag.id}`}
                          onClick={() => handleSelectResponder(ag.id)}
                          className="flex-1 min-w-0 text-left flex items-center gap-2"
                        >
                          <Bot
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isPrincipal
                                ? 'text-[#e59a54]'
                                : isSelected
                                  ? 'text-[#8ea6ff]'
                                  : 'text-slate-400'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-slate-100 truncate">
                                {ag.name}
                              </span>
                              <span
                                className={`px-1 py-0.2 rounded text-[9px] font-mono shrink-0 ${
                                  isPrincipal
                                    ? 'bg-[#e59a54]/15 text-[#e59a54]'
                                    : 'bg-[#8ea6ff]/15 text-[#9fb3ff]'
                                }`}
                              >
                                {isPrincipal ? 'PRINCIPAL' : ag.callsign || 'SUB'}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 truncate">{ag.roleTitle}</p>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {isSelected && (
                            <span className="text-[10px] font-mono text-emerald-400 px-1">
                              Ativo
                            </span>
                          )}
                          {activeProject && !isPrincipal && onToggleProjectAgent && (
                            <button
                              type="button"
                              disabled={togglingAgentId === ag.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQuickToggleAgent(ag.id);
                              }}
                              title={`Desassociar ${ag.name} deste projeto`}
                              aria-label={`Remover ${ag.name} do projeto`}
                              className="p-1 rounded text-slate-500 hover:text-rose-400 transition-colors disabled:opacity-40"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {manageProjectAgentsOpen && (
                  <div className="p-2.5 rounded-xl bg-[#0b0d11] border border-white/10 space-y-2.5">
                    {activeProject && onToggleProjectAgent && availableExtraFleetAgents.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                          Atribuir Especialista da Frota
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {availableExtraFleetAgents.map((ag) => (
                            <button
                              key={ag.id}
                              type="button"
                              disabled={togglingAgentId === ag.id}
                              onClick={() => handleQuickToggleAgent(ag.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#141821] border border-white/8 hover:border-[#8ea6ff]/50 text-[11px] text-slate-200 transition-colors disabled:opacity-40"
                            >
                              <Plus className="w-3 h-3 text-[#8ea6ff]" />
                              <span>{ag.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <form onSubmit={handleCreateSubagentSubmit} className="space-y-1.5">
                      <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                        Recrutar Novo Sub-Agente
                      </p>
                      <input
                        type="text"
                        required
                        value={newAgentName}
                        onChange={(e) => setNewAgentName(e.target.value)}
                        placeholder="Nome (ex: Especialista QA)"
                        className="w-full px-2 py-1 text-xs bg-[#141821] border border-white/8 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#e59a54]"
                      />
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={newAgentRole}
                          onChange={(e) => setNewAgentRole(e.target.value)}
                          placeholder="Especialidade / Papel"
                          className="flex-1 min-w-0 px-2 py-1 text-xs bg-[#141821] border border-white/8 rounded-md text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-[#e59a54]"
                        />
                        <button
                          type="submit"
                          disabled={savingAgent}
                          className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#e59a54] text-[#0b0d11] hover:bg-[#f0ac6b] shrink-0 disabled:opacity-50"
                        >
                          {savingAgent ? '...' : 'Criar'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Segmented Inspector Tabs */}
          <div className="p-2.5 border-b border-white/7 shrink-0">
            <div
              className={`grid ${isGeneralMode ? 'grid-cols-3' : 'grid-cols-4'} gap-1 p-1 rounded-xl bg-[#0b0d11] border border-white/6`}
            >
              <button
                type="button"
                data-testid="studio-tab-logs"
                onClick={() => setActiveTab('logs')}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'logs'
                    ? 'bg-[#1a202c] text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Activity className="w-3.5 h-3.5 text-[#e59a54] shrink-0" />
                <span>Logs</span>
              </button>

              {!isGeneralMode && (
                <button
                  type="button"
                  data-testid="studio-tab-goals"
                  onClick={() => setActiveTab('goals')}
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    activeTab === 'goals'
                      ? 'bg-[#1a202c] text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Target className="w-3.5 h-3.5 text-[#e59a54] shrink-0" />
                  <span>Goals</span>
                  <span className="font-mono tabular-nums text-[11px] text-slate-400">
                    {projectGoals.length}
                  </span>
                </button>
              )}

              <button
                type="button"
                data-testid="studio-tab-agents"
                onClick={() => setActiveTab('agents')}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'agents'
                    ? 'bg-[#1a202c] text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-[#8ea6ff] shrink-0" />
                <span>Agentes</span>
              </button>

              <button
                type="button"
                data-testid="studio-tab-screen"
                onClick={() => setActiveTab('screen')}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'screen'
                    ? 'bg-[#1a202c] text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Monitor className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                <span>Ecrã</span>
              </button>
            </div>
          </div>

          {/* TAB 1: ANTIGRAVITY-STYLE SCOPED EXECUTION LOGS */}
          {activeTab === 'logs' && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-3.5 py-2.5 border-b border-white/6 space-y-2 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#0b0d11] border border-white/7">
                    <button
                      type="button"
                      data-testid="logs-scope-chat"
                      onClick={() => setLogScope('CHAT')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                        logScope === 'CHAT'
                          ? 'bg-[#1a202c] text-slate-100'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Este Chat
                    </button>
                    {!isGeneralMode && (
                      <button
                        type="button"
                        data-testid="logs-scope-project"
                        onClick={() => setLogScope('PROJECT')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                          logScope === 'PROJECT'
                            ? 'bg-[#1a202c] text-slate-100'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Todo o Projeto
                      </button>
                    )}
                  </div>

                  {scopedLogs.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearLogs}
                      className="text-[11px] text-slate-500 hover:text-slate-200 transition-colors"
                    >
                      Limpar
                    </button>
                  )}
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    placeholder={
                      logScope === 'CHAT'
                        ? `Filtrar logs de "${activeChat.title}"...`
                        : activeProject
                          ? `Filtrar logs de "${activeProject.name}"...`
                          : 'Filtrar logs do Sistema Geral...'
                    }
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-[#0b0d11] border border-white/7 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-[#e59a54]/50"
                  />
                </div>
              </div>

              <div
                data-testid="studio-activity-log-list"
                className="flex-1 overflow-y-auto p-3 space-y-2"
              >
                {scopedLogs.length === 0 ? (
                  <div className="py-10 px-4 text-center space-y-2">
                    <p className="text-xs font-medium text-slate-300">
                      Sem registos neste filtro
                    </p>
                    <p className="text-xs text-slate-500">
                      À medida que conversas com o Jarvis neste chat, os pensamentos, Goals criados,
                      sub-agentes, skills, chamadas MCP e capturas de ecrã aparecem aqui em tempo
                      real.
                    </p>
                  </div>
                ) : (
                  scopedLogs.map((entry) => (
                    <div
                      key={entry.id}
                      data-testid={`activity-log-${entry.kind.toLowerCase()}`}
                      className="p-2.5 rounded-xl bg-[#141821] border border-white/7 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`font-medium shrink-0 ${getKindAccentClass(entry.kind)}`}>
                            {getKindLabel(entry.kind)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate text-slate-300">{entry.actor}</span>
                        </div>
                        <span className="font-mono tabular-nums text-[10px] text-slate-500 shrink-0">
                          {entry.timestamp.slice(11, 19)}
                          {entry.durationMs !== undefined ? ` · ${entry.durationMs}ms` : ''}
                        </span>
                      </div>

                      <p className="text-xs text-slate-200 leading-snug">{entry.summary}</p>
                      {entry.detail && (
                        <p className="text-[11px] text-slate-400 font-mono break-words">
                          {entry.detail}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 2: PROJECT GOALS & INTERACTIVE SUBTASKS */}
          {activeTab === 'goals' && activeProject && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-3.5 py-2.5 border-b border-white/6 flex items-center justify-between gap-2 shrink-0">
                <div className="text-xs text-slate-400 tabular-nums">
                  <span className="text-slate-200 font-medium">
                    {completedGoalsCount}/{projectGoals.length}
                  </span>{' '}
                  concluídos · <span className="text-[#e59a54]">{avgGoalProgress}%</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGoalForm((prev) => !prev)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#181d28] border border-white/8 text-slate-200 hover:border-[#e59a54]/50 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-[#e59a54]" />
                  <span>Novo Goal</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3" data-testid="studio-goals-list">
                {showGoalForm && (
                  <form
                    onSubmit={handleCreateGoalSubmit}
                    className="p-3 rounded-xl bg-[#141821] border border-[#e59a54]/35 space-y-2.5"
                  >
                    <input
                      type="text"
                      required
                      value={newGoalTitle}
                      onChange={(e) => setNewGoalTitle(e.target.value)}
                      placeholder="Título do Goal (ex: Integrar Checkout Stripe)"
                      className="w-full px-2.5 py-1.5 text-xs bg-[#0b0d11] border border-white/8 rounded-lg text-slate-100 focus:outline-none focus:border-[#e59a54]"
                    />
                    <textarea
                      rows={3}
                      value={newGoalSubtasksText}
                      onChange={(e) => setNewGoalSubtasksText(e.target.value)}
                      placeholder="Sub-tarefas (opcional, uma por linha)"
                      className="w-full px-2.5 py-1.5 text-xs bg-[#0b0d11] border border-white/8 rounded-lg text-slate-200 focus:outline-none focus:border-[#e59a54] resize-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowGoalForm(false)}
                        className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={savingGoal}
                        className="px-3 py-1 rounded-lg text-xs font-semibold bg-[#e59a54] text-[#0b0d11]"
                      >
                        {savingGoal ? 'A guardar...' : 'Guardar Goal'}
                      </button>
                    </div>
                  </form>
                )}

                {projectGoals.length === 0 ? (
                  <div className="py-10 px-4 text-center space-y-2">
                    <p className="text-xs font-medium text-slate-300">
                      Ainda sem Goals definidos para esta ideia
                    </p>
                    <p className="text-xs text-slate-500">
                      Descreve o que queres construir na conversa ao lado — o Jarvis cria os Goals e
                      etapas automaticamente à medida que planeiam.
                    </p>
                  </div>
                ) : (
                  projectGoals.map((goal) => {
                    const assignedAgent = goal.assignedAgentId
                      ? store.rooms.find((r) => r.id === goal.assignedAgentId)
                      : undefined;
                    const clampedProg = Math.max(0, Math.min(100, goal.progress));

                    return (
                      <div
                        key={goal.id}
                        className="p-3 rounded-xl bg-[#141821] border border-white/7 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5 min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-100 leading-snug">
                              {goal.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                              <span>{goal.category}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums text-[#e59a54]">
                                {clampedProg}%
                              </span>
                              {assignedAgent && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-[#8ea6ff] truncate">
                                    {assignedAgent.name}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <select
                              aria-label={`Estado de ${goal.title}`}
                              value={goal.status}
                              onChange={(e) =>
                                handleChangeGoalStatus(
                                  goal.id,
                                  e.target.value as GoalItem['status']
                                )
                              }
                              className="bg-[#0b0d11] border border-white/8 rounded-md px-1.5 py-0.5 text-[10px] text-slate-300 focus:outline-none"
                            >
                              <option value="ACTIVE">Ativo</option>
                              <option value="COMPLETED">Concluído</option>
                              <option value="AT_RISK">Em Risco</option>
                            </select>

                            <button
                              type="button"
                              onClick={() => handleDeleteGoal(goal.id)}
                              aria-label={`Apagar Goal ${goal.title}`}
                              className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Pure SVG Progress Bar (0 inline styles) */}
                        <svg
                          viewBox="0 0 100 3"
                          preserveAspectRatio="none"
                          className="w-full h-1.5 rounded-full overflow-hidden bg-[#0b0d11]"
                          aria-hidden="true"
                        >
                          <rect
                            x="0"
                            y="0"
                            width={clampedProg}
                            height="3"
                            fill={goal.status === 'COMPLETED' ? '#34d399' : '#e59a54'}
                          />
                        </svg>

                        {/* Interactive Subtasks Checklist */}
                        {goal.subtasks && goal.subtasks.length > 0 && (
                          <div className="pt-1 space-y-1.5">
                            {goal.subtasks.map((st) => (
                              <button
                                key={st.id}
                                type="button"
                                onClick={() => handleToggleGoalSubtask(goal, st.id)}
                                className="w-full flex items-start gap-2 text-left text-xs group"
                              >
                                {st.done ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                ) : (
                                  <Circle className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 shrink-0 mt-0.5" />
                                )}
                                <span
                                  className={
                                    st.done
                                      ? 'line-through text-slate-500'
                                      : 'text-slate-300 group-hover:text-slate-100'
                                  }
                                >
                                  {st.title}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SUB-AGENTS, ANTIGRAVITY SKILLS & MCP GATEWAY */}
          {activeTab === 'agents' && (
            <div className="flex-1 overflow-y-auto p-3.5 space-y-5">
              {/* Sub-Agents Section */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-200">
                    Sub-Agentes do Projeto ({projectAgents.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowAgentForm((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-xs text-[#e59a54] hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Criar Sub-Agente</span>
                  </button>
                </div>

                {showAgentForm && (
                  <form
                    onSubmit={handleCreateSubagentSubmit}
                    className="p-3 rounded-xl bg-[#141821] border border-[#8ea6ff]/35 space-y-2"
                  >
                    <input
                      type="text"
                      required
                      value={newAgentName}
                      onChange={(e) => setNewAgentName(e.target.value)}
                      placeholder="Nome (ex: Especialista SEO & Copy)"
                      className="w-full px-2.5 py-1.5 text-xs bg-[#0b0d11] border border-white/8 rounded-lg text-slate-100 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newAgentRole}
                      onChange={(e) => setNewAgentRole(e.target.value)}
                      placeholder="Papel / especialidade no projeto"
                      className="w-full px-2.5 py-1.5 text-xs bg-[#0b0d11] border border-white/8 rounded-lg text-slate-200 focus:outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAgentForm(false)}
                        className="px-2 py-1 text-xs text-slate-400"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={savingAgent}
                        className="px-3 py-1 rounded-lg text-xs font-semibold bg-[#e59a54] text-[#0b0d11]"
                      >
                        Recrutar
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-2">
                  {projectAgents.map((ag) => {
                    const isSelected = ag.id === selectedAgentObj?.id;
                    return (
                      <div
                        key={ag.id}
                        className={`p-2.5 rounded-xl border transition-colors ${
                          isSelected
                            ? 'bg-[#181e2b] border-[#8ea6ff]/45'
                            : 'bg-[#141821] border-white/7'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-100 truncate">
                              {ag.name}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate">{ag.roleTitle}</p>
                            {ag.createdByJarvis && (
                              <p className="text-[10px] text-[#8ea6ff] mt-0.5">
                                Criado pelo Jarvis para este projeto
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSelectResponder(ag.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0 transition-colors ${
                              isSelected
                                ? 'bg-[#8ea6ff]/20 text-[#b4c4ff]'
                                : 'bg-[#0b0d11] text-slate-300 hover:text-slate-100'
                            }`}
                          >
                            {isSelected ? 'Ativo' : 'Falar'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Antigravity Skills Section */}
              {activeProject && (
              <div className="pt-3 border-t border-white/7 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-200">
                    Skills Estilo Antigravity
                  </h3>
                  <button
                    type="button"
                    onClick={() => onNavigateModule('skills')}
                    className="text-[11px] text-slate-400 hover:text-slate-200"
                  >
                    Biblioteca completa
                  </button>
                </div>

                <div className="space-y-1.5">
                  {store.skills.map((sk) => {
                    const activeInProj = (activeProject.activeSkillIds || []).includes(sk.id);
                    return (
                      <div
                        key={sk.id}
                        className="p-2.5 rounded-xl bg-[#141821] border border-white/7 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-200 truncate">{sk.name}</p>
                          <p className="text-[11px] text-slate-500 font-mono truncate">
                            {sk.quickCommand}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleProjectSkill(sk.id, true)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0 transition-colors ${
                            activeInProj
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/35'
                              : 'bg-[#0b0d11] text-slate-400 hover:text-slate-200 border border-white/6'
                          }`}
                        >
                          {activeInProj ? 'Ativa' : 'Ativar'}
                        </button>
                      </div>
                    );
                  })}

                  {STANDARD_SKILLS_LIBRARY.filter(
                    (tpl) => !store.skills.some((s) => s.slug === tpl.slug)
                  )
                    .slice(0, 3)
                    .map((tpl) => (
                      <div
                        key={tpl.id}
                        className="p-2.5 rounded-xl bg-[#11151d] border border-white/5 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs text-slate-300 truncate">{tpl.name}</p>
                          <p className="text-[11px] text-slate-500 truncate">{tpl.category}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleProjectSkill(tpl.id, false)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#0b0d11] border border-white/8 text-slate-300 hover:text-[#e59a54] shrink-0"
                        >
                          + Instalar
                        </button>
                      </div>
                    ))}
                </div>
              </div>
              )}

              {/* MCP Gateway Bridge Section */}
              <div className="pt-3 border-t border-white/7 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-200">Gateway MCP Integrado</h3>
                  <button
                    type="button"
                    onClick={() => onNavigateModule('mcp')}
                    className="inline-flex items-center gap-1 text-[11px] text-[#e59a54] hover:underline"
                  >
                    <Wrench className="w-3 h-3" />
                    <span>Gerir MCPs</span>
                  </button>
                </div>
                <div className="p-3 rounded-xl bg-[#141821] border border-white/7 text-xs text-slate-400 space-y-1">
                  <p className="text-slate-200 font-medium">
                    {(store.mcpRegistryTools || []).filter((t) => t.enabled).length} ferramentas MCP
                    ativas · {(store.mcpServers || []).filter((s) => s.enabled).length} servidores
                  </p>
                  <p className="text-[11px]">
                    O Jarvis e os sub-agentes invocam automaticamente os teus MCPs e registam cada
                    chamada no separador Logs deste projeto.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: REAL-TIME SCREEN VISION (WEBRTC STREAM + SIDECAR DESKTOP) */}
          {activeTab === 'screen' && (
            <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-slate-100">
                  Acesso ao Teu Ecrã em Tempo Real
                </h3>
                <p className="text-xs text-slate-400">
                  Partilha o ecrã em direto pelo navegador ou captura o ambiente de trabalho via
                  Sidecar para o Jarvis ver tudo em tempo real.
                </p>
              </div>

              {/* Live Viewport */}
              <div
                data-testid="studio-screen-preview"
                className="rounded-xl overflow-hidden bg-[#080a0e] border border-white/8 aspect-video flex items-center justify-center relative"
              >
                {screenStreamActive ? (
                  <video
                    ref={videoPreviewRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                  />
                ) : localSnapshot ? (
                  <img
                    src={`data:${localSnapshot.mimeType};base64,${localSnapshot.dataBase64}`}
                    alt={`Captura de ecrã: ${localSnapshot.activeWindowTitle || 'Ambiente de trabalho'}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="p-5 text-center space-y-2">
                    <Monitor className="w-6 h-6 text-slate-500 mx-auto" />
                    <p className="text-xs text-slate-400">
                      Nenhum stream ativo de momento. Inicia a partilha em direto ou faz uma captura
                      Sidecar.
                    </p>
                  </div>
                )}
              </div>

              {/* Capture & Stream Action Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={
                    screenStreamActive
                      ? handleStopBrowserScreenShare
                      : handleStartBrowserScreenShare
                  }
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                    screenStreamActive
                      ? 'bg-rose-500/18 border border-rose-400/40 text-rose-200'
                      : 'bg-[#e59a54] text-[#0b0d11] hover:bg-[#f0ac6b]'
                  }`}
                >
                  {screenStreamActive ? (
                    <MonitorOff className="w-3.5 h-3.5" />
                  ) : (
                    <Monitor className="w-3.5 h-3.5" />
                  )}
                  <span>{screenStreamActive ? 'Parar Stream' : 'Stream em Direto'}</span>
                </button>

                <button
                  type="button"
                  data-testid="inspector-sidecar-capture-btn"
                  disabled={capturingSidecar}
                  onClick={handleCaptureSidecarScreen}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#141821] border border-white/10 text-slate-200 hover:border-white/20 transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <Eye className="w-3.5 h-3.5 text-sky-300" />
                  <span>{capturingSidecar ? 'A capturar...' : 'Capturar Sidecar'}</span>
                </button>
              </div>

              {/* Vision Preferences */}
              <div className="p-3 rounded-xl bg-[#141821] border border-white/7 space-y-2.5 text-xs">
                <label className="flex items-start gap-2.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={screenAutoSend}
                    onChange={(e) => setScreenAutoSend(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-[#0b0d11]"
                  />
                  <span>Incluir automaticamente o ecrã atual em cada mensagem enviada</span>
                </label>

                <label className="flex items-start gap-2.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={continuousWatch}
                    onChange={(e) => setContinuousWatch(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-[#0b0d11]"
                  />
                  <span>Observação contínua automática (inspecionar a cada 20s)</span>
                </label>

                <button
                  type="button"
                  data-testid="analyze-screen-now-btn"
                  disabled={analyzingScreen}
                  onClick={() => handleAnalyzeScreenNow(true)}
                  className="w-full py-2 px-3 rounded-lg bg-[#1c2230] hover:bg-[#232b3d] border border-white/8 text-xs font-medium text-slate-100 transition-colors disabled:opacity-50"
                >
                  {analyzingScreen
                    ? 'A analisar o que está no teu ecrã...'
                    : 'Analisar Ecrã Agora e Enviar para o Chat'}
                </button>
              </div>

              {localSnapshot && (
                <div className="p-3 rounded-xl bg-[#141821] border border-white/7 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                    <span>
                      {localSnapshot.source === 'BROWSER_STREAM' ? 'WEBRTC LIVE' : 'SIDECAR OS'}
                    </span>
                    <span>
                      {localSnapshot.width}×{localSnapshot.height} ·{' '}
                      {localSnapshot.capturedAt.slice(11, 19)}
                    </span>
                  </div>
                  {localSnapshot.activeWindowTitle && (
                    <p className="text-slate-200 font-medium truncate">
                      {localSnapshot.activeWindowTitle}
                    </p>
                  )}
                  {localSnapshot.visionSummary && (
                    <p className="text-slate-400 leading-relaxed">{localSnapshot.visionSummary}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      )}
    </div>
  );
};
