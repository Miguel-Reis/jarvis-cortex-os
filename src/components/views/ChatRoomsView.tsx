import React, { useEffect, useRef, useState } from 'react';
import {
  Send,
  Paperclip,
  Mic,
  Trash2,
  Wrench,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Volume2,
  X,
  UserPlus,
  FolderGit2,
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import { markViiAudio } from '../../lib/audio-dsp';
import { useToast } from '../ToastContext';
import { SPECIALIST_AGENT_TEMPLATES } from '../../shared/skills-plugins-catalog';
import type { AttachmentItem, ChatMessage, JarvisStoreData, Room } from '../../shared/types';

interface ChatRoomsViewProps {
  store: JarvisStoreData;
  initialRoomId?: string;
  onRefreshBootstrap: () => Promise<void>;
}

const ALL_AGENT_TOOLS = [
  'search_memories',
  'store_memory',
  'get_system_telemetry',
  'lookup_ast_symbol',
  'inspect_git_status',
  'run_governed_shell',
  'trigger_workflow',
  'sidecar_host_control',
];

export const ChatRoomsView: React.FC<ChatRoomsViewProps> = ({
  store,
  initialRoomId,
  onRefreshBootstrap,
}) => {
  const { pushToast } = useToast();
  const [activeRoomId, setActiveRoomId] = useState(
    initialRoomId || store.rooms[0]?.id || 'room-exec'
  );
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [sending, setSending] = useState(false);
  const [pendingUserText, setPendingUserText] = useState('');
  const [recordingMic, setRecordingMic] = useState(false);

  // Recruit Agent Modal state
  const [recruitOpen, setRecruitOpen] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [agentCallsign, setAgentCallsign] = useState('SPEC-09');
  const [agentRole, setAgentRole] = useState('');
  const [agentDesc, setAgentDesc] = useState('');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentAccent, setAgentAccent] = useState<'cyan' | 'amber' | 'emerald' | 'rose' | 'violet'>(
    'cyan'
  );
  const [agentProjectId, setAgentProjectId] = useState<string>(store.activeProjectId || '');
  const [agentTools, setAgentTools] = useState<string[]>([
    'search_memories',
    'lookup_ast_symbol',
    'inspect_git_status',
  ]);
  const [recruiting, setRecruiting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const renderFormattedText = (raw: string) => {
    const parts = raw.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={idx} className="font-semibold text-slate-50">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={idx}
            className="px-1.5 py-0.5 rounded bg-[#07090e] border border-slate-800 font-mono text-xs text-cyan-300"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  useEffect(() => {
    if (initialRoomId && store.rooms.some((r) => r.id === initialRoomId)) {
      setActiveRoomId(initialRoomId);
    }
  }, [initialRoomId, store.rooms]);

  const activeRoom = store.rooms.find((r) => r.id === activeRoomId) || store.rooms[0];
  const roomMessages = store.messages.filter((m) => m.roomId === activeRoom?.id);
  const projects = store.projects || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [roomMessages.length, activeRoomId, sending]);

  const readFileAsAttachment = (file: File): Promise<AttachmentItem> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: file.name || 'clipboard-image.png',
          mimeType: file.type || 'application/octet-stream',
          dataBase64: base64,
          sizeBytes: file.size,
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          const att = await readFileAsAttachment(file);
          setAttachments((prev) => [...prev, att]);
          pushToast({ title: 'Imagem colada na conversa', detail: att.name, tone: 'info' });
        }
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const added: AttachmentItem[] = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].size > 6 * 1024 * 1024) {
        pushToast({ title: 'Ficheiro excede 6 MB', detail: files[i].name, tone: 'warning' });
        continue;
      }
      added.push(await readFileAsAttachment(files[i]));
    }
    setAttachments((prev) => [...prev, ...added]);
    e.target.value = '';
  };

  const handleMicDictation = () => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SpeechRec) {
      pushToast({
        title: 'Reconhecimento de voz indisponível neste navegador',
        detail: 'Usa a caixa de texto ou um navegador Chromium com microfone ativo.',
        tone: 'warning',
      });
      return;
    }

    try {
      const rec = new SpeechRec() as {
        lang: string;
        interimResults: boolean;
        onresult: ((ev: unknown) => void) | null;
        onend: (() => void) | null;
        onerror: (() => void) | null;
        start: () => void;
      };
      rec.lang = store.settings.language;
      rec.interimResults = false;
      setRecordingMic(true);
      rec.onresult = (event: unknown) => {
        const ev = event as {
          results: { [idx: number]: { [alt: number]: { transcript: string } } };
        };
        const txt = ev.results[0]?.[0]?.transcript || '';
        if (txt) setInput((prev) => (prev ? `${prev} ${txt}` : txt));
      };
      rec.onend = () => setRecordingMic(false);
      rec.onerror = () => setRecordingMic(false);
      rec.start();
    } catch {
      setRecordingMic(false);
    }
  };

  const handleSend = async (e?: React.FormEvent, presetPrompt?: string) => {
    e?.preventDefault();
    const content = (presetPrompt ?? input).trim();
    if (!content && attachments.length === 0) return;
    if (sending) return;

    setSending(true);
    setPendingUserText(content);
    if (!presetPrompt) setInput('');
    const currentAttachments = presetPrompt ? [] : attachments;
    if (!presetPrompt) setAttachments([]);

    try {
      const res = await apiJson<{
        assistantMessage: ChatMessage;
        blockedByCanary: boolean;
      }>('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({
          roomId: activeRoom.id,
          content,
          attachments: currentAttachments,
        }),
      });
      await onRefreshBootstrap();
      if (res.blockedByCanary) {
        pushToast({
          title: 'Diretiva bloqueada pelo Canary Gate',
          detail: 'Tentativa de injeção registada no Audit Trail.',
          tone: 'error',
        });
      }
    } catch (err) {
      pushToast({
        title: 'Erro na comunicação com o agente',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setPendingUserText('');
      setSending(false);
    }
  };

  const handleClearRoom = async () => {
    await apiJson(`/api/chat/${activeRoom.id}/clear`, { method: 'DELETE' });
    await onRefreshBootstrap();
    pushToast({ title: 'Histórico da sala limpo', tone: 'info' });
  };

  const handleRecruitFromTemplate = async (templateId: string) => {
    setRecruiting(true);
    try {
      const res = await apiJson<{ room: Room }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          templateId,
          projectId: agentProjectId || store.activeProjectId,
        }),
      });
      await onRefreshBootstrap();
      setActiveRoomId(res.room.id);
      setRecruitOpen(false);
      pushToast({
        title: `Agente ${res.room.name} recrutado`,
        detail: `Callsign ${res.room.callsign} pronto para operação.`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao recrutar agente',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setRecruiting(false);
    }
  };

  const handleRecruitCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim()) return;
    setRecruiting(true);
    try {
      const res = await apiJson<{ room: Room }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: agentName.trim(),
          callsign: agentCallsign.trim() || 'AGENT-X',
          roleTitle: agentRole.trim() || 'Agente Especialista',
          description: agentDesc.trim() || 'Agente dedicado recrutado pelo Operador.',
          systemPrompt:
            agentPrompt.trim() ||
            `Atua como ${agentName.trim()} no J.A.R.V.I.S. Cortex OS em Português de Portugal (PT-PT).`,
          accentColor: agentAccent,
          projectId: agentProjectId || undefined,
          allowedTools: agentTools,
        }),
      });
      setAgentName('');
      setAgentRole('');
      setAgentDesc('');
      setAgentPrompt('');
      setRecruitOpen(false);
      await onRefreshBootstrap();
      setActiveRoomId(res.room.id);
      pushToast({
        title: `Novo agente criado: ${res.room.name}`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao criar agente',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setRecruiting(false);
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    try {
      await apiJson(`/api/rooms/${roomId}`, { method: 'DELETE' });
      await onRefreshBootstrap();
      if (activeRoomId === roomId) {
        setActiveRoomId(store.rooms[0]?.id || 'room-exec');
      }
      pushToast({ title: 'Agente removido da frota', tone: 'info' });
    } catch (err) {
      pushToast({
        title: 'Não foi possível remover agente',
        detail: (err as Error).message,
        tone: 'error',
      });
    }
  };

  const handleAssignRoomProject = async (projectId: string) => {
    if (!activeRoom) return;
    await apiJson(`/api/rooms/${activeRoom.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ projectId }),
    });
    await onRefreshBootstrap();
    pushToast({ title: 'Projeto do agente atualizado', tone: 'info' });
  };

  const toggleToolInForm = (tool: string) => {
    setAgentTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  };

  const quickSuggestions = [
    'Mostra as janelas e processos ativos na máquina onde corre o Sidecar',
    'Analisar impacto AST de server.ts e verificar acoplamento Co-Change',
    'Mostra a telemetria real de CPU, RAM e portas do sistema',
    'Lista as memórias principais guardadas no Memory Vault',
    'Inspeciona o estado Git do projeto ativo',
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-10rem)]">
        {/* Specialist Agents & Rooms Sidebar */}
        <aside className="lg:col-span-3 jarvis-surface border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-100 font-display">
                  Frota de Agentes ({store.rooms.length})
                </h2>
                <p className="text-xs text-slate-400">Salas isoladas com ferramentas próprias.</p>
              </div>
              <button
                type="button"
                onClick={() => setRecruitOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                + Agente
              </button>
            </div>

            <div className="space-y-1.5 max-h-[54vh] overflow-y-auto pr-0.5">
              {store.rooms.map((room) => {
                const isSelected = room.id === activeRoom?.id;
                const count = store.messages.filter((m) => m.roomId === room.id).length;
                const assignedProj = projects.find((p) => p.id === room.projectId);
                return (
                  <div
                    key={room.id}
                    className={`group rounded-lg border transition-colors ${
                      isSelected
                        ? 'bg-[#141b25] border-cyan-500/60 text-slate-100'
                        : 'bg-[#07090e]/60 border-slate-800/70 text-slate-300 hover:bg-[#141b25]/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveRoomId(room.id)}
                      className="w-full p-3 text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{room.name}</span>
                        <span className="text-[11px] font-mono tabular-nums text-slate-500">
                          {room.callsign ? `${room.callsign} · ` : ''}
                          {count}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{room.roleTitle}</p>
                      {assignedProj && (
                        <p className="text-[11px] font-mono text-cyan-400/90 mt-1 truncate">
                          Projeto: {assignedProj.name}
                        </p>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 space-y-1.5">
            <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
              Ferramentas Autorizadas ({activeRoom?.allowedTools.length || 0})
            </p>
            <p className="text-xs text-slate-500 font-mono leading-relaxed">
              {activeRoom?.allowedTools.join(' · ')}
            </p>
          </div>
        </aside>

        {/* Main Conversation Stream + Multimodal Composer */}
        <section className="lg:col-span-9 jarvis-surface border border-slate-800/80 rounded-xl flex flex-col overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-slate-100 font-display truncate">
                  {activeRoom?.name}
                </h3>
                {activeRoom?.callsign && (
                  <span className="text-xs font-mono text-cyan-400">{activeRoom.callsign}</span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate">
                {activeRoom?.roleTitle} · {activeRoom?.description}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {projects.length > 0 && activeRoom && (
                <div className="hidden sm:flex items-center gap-1.5">
                  <FolderGit2 className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    aria-label="Projeto associado ao agente"
                    value={activeRoom.projectId || ''}
                    onChange={(e) => handleAssignRoomProject(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-300 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">Contexto Global (Todos os Projetos)</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {activeRoom?.isCustom && (
                <button
                  type="button"
                  onClick={() => handleDeleteRoom(activeRoom.id)}
                  className="px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 border border-rose-500/30 rounded-lg transition-colors"
                >
                  Remover Agente
                </button>
              )}

              <button
                type="button"
                onClick={handleClearRoom}
                aria-label="Limpar conversa desta sala"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-rose-300 bg-[#141b25] border border-slate-800 rounded-lg transition-colors whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpar
              </button>
            </div>
          </div>

          {/* Messages Viewport */}
          <div className="flex-1 p-5 overflow-y-auto space-y-4 max-h-[55vh]">
            {roomMessages.length === 0 && !sending ? (
              <div className="py-10 text-center space-y-3">
                <p className="text-sm text-slate-300">Nenhum registo nesta sala.</p>
                <p className="text-xs text-slate-500">
                  Escolhe uma diretiva rápida abaixo ou cola um screenshot (Ctrl+V).
                </p>
              </div>
            ) : (
              roomMessages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-2`}
                  >
                    <div
                      className={`max-w-3xl rounded-xl px-4 py-3 text-sm leading-relaxed border ${
                        isUser
                          ? 'bg-cyan-500/12 border-cyan-500/35 text-slate-100'
                          : 'bg-[#121822] border-slate-800 text-slate-200'
                      }`}
                    >
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2.5">
                          {msg.attachments.map((att) =>
                            att.mimeType.startsWith('image/') ? (
                              <img
                                key={att.id}
                                src={`data:${att.mimeType};base64,${att.dataBase64}`}
                                alt={att.name}
                                className="max-h-40 rounded-lg border border-slate-700 object-contain"
                              />
                            ) : (
                              <span
                                key={att.id}
                                className="text-xs font-mono text-cyan-300 underline"
                              >
                                {att.name}
                              </span>
                            )
                          )}
                        </div>
                      )}

                      {!isUser && msg.jevRoute && (
                        <div className="mb-3 p-2.5 rounded-lg bg-[#07090e] border border-slate-800 space-y-1.5 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums">
                            <span className="text-cyan-300">
                              JEV-S1 {msg.jevRoute.latencyMs}ms · [{msg.jevRoute.tier[0]}]{' '}
                              {msg.jevRoute.intent}
                            </span>
                            <span className="text-emerald-400">
                              -{msg.jevRoute.tokenDiet.savingsPercent}% tokens ·{' '}
                              {msg.jevRoute.tokenDiet.activeToolsCount}/
                              {msg.jevRoute.tokenDiet.totalToolsCatalog} MCP tools
                            </span>
                          </div>
                          {msg.jevRoute.lookaheadAlerts.map((alert, idx) => (
                            <div
                              key={`${alert.filePath}-${idx}`}
                              className="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/35 text-amber-200 font-mono text-[11px]"
                            >
                              Lookahead AST [Blast {alert.blastRadiusScore}] {alert.filePath}:{' '}
                              {alert.reason}
                            </div>
                          ))}
                        </div>
                      )}

                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div className="space-y-1.5 mb-3">
                          {msg.toolCalls.map((tc) => (
                            <div
                              key={tc.id}
                              className="p-2.5 rounded-lg bg-[#07090e] border border-slate-800 text-xs space-y-1"
                            >
                              <div className="flex items-center justify-between gap-3 font-mono tabular-nums">
                                <span className="flex items-center gap-1.5 text-cyan-300 font-medium">
                                  <Wrench className="w-3.5 h-3.5" />
                                  {tc.name}()
                                </span>
                                <span className="flex items-center gap-1 text-slate-400">
                                  {tc.status === 'SUCCESS' ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : tc.status === 'PENDING_APPROVAL' ? (
                                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                                  ) : (
                                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                                  )}
                                  {tc.durationMs}ms
                                </span>
                              </div>
                              <p className="text-slate-400">{tc.outputSummary}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="whitespace-pre-wrap">{renderFormattedText(msg.content)}</div>

                      <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between gap-4 text-xs text-slate-500">
                        <span className="font-mono tabular-nums">
                          {new Date(msg.createdAt).toLocaleTimeString(store.settings.language, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {msg.engineUsed ? ` · ${msg.engineUsed}` : ''}
                        </span>
                        {!isUser && (
                          <button
                            type="button"
                            onClick={() =>
                              markViiAudio.speakWithMarkVII(
                                msg.content,
                                store.settings.language,
                                store.settings.voiceDspEnabled
                              )
                            }
                            aria-label="Ouvir resposta do Jarvis"
                            className="text-slate-400 hover:text-cyan-300 flex items-center gap-1"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                            Ouvir
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            {sending && (
              <div className="space-y-3">
                {pendingUserText && (
                  <div className="flex flex-col items-end">
                    <div className="max-w-3xl rounded-xl px-4 py-3 text-sm bg-cyan-500/12 border border-cyan-500/35 text-slate-100">
                      {pendingUserText}
                    </div>
                  </div>
                )}
                <div className="flex flex-col items-start">
                  <div className="rounded-xl px-4 py-3 text-xs bg-[#141b25] border border-slate-800 text-cyan-300 font-mono">
                    Loop ReAct ativo: a invocar ferramentas do servidor e a sintetizar resposta...
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts Strip */}
          <div className="px-5 py-2 border-t border-slate-800/70 flex items-center gap-2 overflow-x-auto">
            {quickSuggestions.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={sending}
                onClick={() => handleSend(undefined, prompt)}
                className="px-2.5 py-1 text-xs text-slate-300 bg-[#141b25] border border-slate-800 rounded-md hover:border-cyan-500/50 whitespace-nowrap shrink-0 transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>

          {attachments.length > 0 && (
            <div className="px-5 py-2 bg-[#07090e] border-t border-slate-800 flex flex-wrap gap-2">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#141b25] border border-slate-700 text-xs text-slate-200"
                >
                  <span className="truncate max-w-44">{att.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== att.id))}
                    aria-label={`Remover anexo ${att.name}`}
                    className="text-slate-400 hover:text-rose-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Composer */}
          <form
            onSubmit={(e) => handleSend(e)}
            onPaste={handlePaste}
            className="p-4 border-t border-slate-800 flex items-end gap-2.5"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.txt,.md,.json,.py,.ts,.tsx"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Anexar imagem ou ficheiro"
              className="p-2.5 rounded-lg bg-[#141b25] border border-slate-800 text-slate-300 hover:text-cyan-300 hover:border-slate-700 transition-colors shrink-0"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleMicDictation}
              aria-label="Ditar por microfone"
              className={`p-2.5 rounded-lg border transition-colors shrink-0 ${
                recordingMic
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                  : 'bg-[#141b25] border-slate-800 text-slate-300 hover:text-cyan-300'
              }`}
            >
              <Mic className="w-4 h-4" />
            </button>
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Escreve uma diretiva, controla a máquina Sidecar ou cola uma imagem (Ctrl+V)..."
              className="flex-1 px-3.5 py-2 text-sm bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
            />
            <button
              type="submit"
              disabled={sending || (!input.trim() && attachments.length === 0)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
            >
              <Send className="w-4 h-4" />
              {sending ? 'A processar...' : 'Enviar'}
            </button>
          </form>
        </section>
      </div>

      {/* Recruit Specialist Agent Modal */}
      {recruitOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Recrutar Novo Agente Especialista"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
          onClick={() => setRecruitOpen(false)}
        >
          <div
            className="w-full max-w-3xl jarvis-surface border border-slate-800 rounded-xl p-6 space-y-5 max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-cyan-400">
                  Expansão da Frota · Agentes Dedicados
                </p>
                <h3 className="text-lg font-bold text-slate-100 font-display">
                  Recrutar Novo Agente Especialista
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Instala um especialista pré-configurado em 1 clique ou desenha o teu próprio
                  agente com ferramentas governadas e projeto atribuído.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRecruitOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-100"
                aria-label="Fechar modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 1-Click Specialist Templates */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-slate-200">
                Modelos de Especialistas Prontos (1-Clique)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {SPECIALIST_AGENT_TEMPLATES.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="p-3.5 rounded-xl bg-[#07090e] border border-slate-800/90 flex flex-col justify-between gap-2.5"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-100">{tpl.name}</span>
                        <span className="text-[11px] font-mono text-cyan-400">{tpl.callsign}</span>
                      </div>
                      <p className="text-xs text-slate-400">{tpl.description}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                      <span className="text-[11px] font-mono text-slate-500 truncate">
                        {tpl.allowedTools.slice(0, 3).join(', ')}
                      </span>
                      <button
                        type="button"
                        disabled={recruiting}
                        onClick={() => handleRecruitFromTemplate(tpl.id)}
                        className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#141b25] border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500 hover:text-slate-950 transition-colors shrink-0"
                      >
                        Recrutar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom Agent Builder */}
            <form
              onSubmit={handleRecruitCustom}
              className="pt-4 border-t border-slate-800 space-y-3"
            >
              <p className="text-xs font-semibold text-slate-200">
                Ou Configurar Agente Personalizado
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="Nome do Agente (ex: Engenheiro Rust)"
                  className="px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
                />
                <input
                  type="text"
                  value={agentCallsign}
                  onChange={(e) => setAgentCallsign(e.target.value)}
                  placeholder="Callsign (ex: RUST-01)"
                  className="px-3 py-2 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
                />
                <select
                  value={agentProjectId}
                  onChange={(e) => setAgentProjectId(e.target.value)}
                  className="px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-200"
                >
                  <option value="">Todos os Projetos</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      Projeto: {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  value={agentRole}
                  onChange={(e) => setAgentRole(e.target.value)}
                  placeholder="Título da função..."
                  className="sm:col-span-2 px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
                />
                <select
                  value={agentAccent}
                  onChange={(e) =>
                    setAgentAccent(
                      e.target.value as 'cyan' | 'amber' | 'emerald' | 'rose' | 'violet'
                    )
                  }
                  className="px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-200"
                >
                  <option value="cyan">Cor: Ciano</option>
                  <option value="emerald">Cor: Esmeralda</option>
                  <option value="amber">Cor: Âmbar</option>
                  <option value="violet">Cor: Violeta</option>
                  <option value="rose">Cor: Rosa</option>
                </select>
              </div>

              <input
                type="text"
                value={agentDesc}
                onChange={(e) => setAgentDesc(e.target.value)}
                placeholder="Breve descrição operacional..."
                className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
              />

              <textarea
                rows={2}
                value={agentPrompt}
                onChange={(e) => setAgentPrompt(e.target.value)}
                placeholder="Instruções de sistema / persona do agente..."
                className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
              />

              <div className="space-y-1.5">
                <p className="text-xs text-slate-400">Ferramentas Autorizadas para este Agente:</p>
                <div className="flex flex-wrap gap-2">
                  {ALL_AGENT_TOOLS.map((tool) => {
                    const checked = agentTools.includes(tool);
                    return (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => toggleToolInForm(tool)}
                        className={`px-2.5 py-1 text-[11px] font-mono rounded-md border transition-colors ${
                          checked
                            ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                            : 'bg-[#07090e] border-slate-800 text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {tool}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRecruitOpen(false)}
                  className="px-4 py-2 text-xs text-slate-300 bg-[#141b25] rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={recruiting}
                  className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400"
                >
                  {recruiting ? 'A registar...' : 'Criar Agente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
