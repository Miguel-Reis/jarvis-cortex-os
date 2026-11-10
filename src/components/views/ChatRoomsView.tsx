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
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import { markViiAudio } from '../../lib/audio-dsp';
import { useToast } from '../ToastContext';
import type { AttachmentItem, ChatMessage, JarvisStoreData } from '../../shared/types';

interface ChatRoomsViewProps {
  store: JarvisStoreData;
  initialRoomId?: string;
  onRefreshBootstrap: () => Promise<void>;
}

export const ChatRoomsView: React.FC<ChatRoomsViewProps> = ({
  store,
  initialRoomId,
  onRefreshBootstrap,
}) => {
  const { pushToast } = useToast();
  const [activeRoomId, setActiveRoomId] = useState(initialRoomId || store.rooms[0]?.id || 'room-exec');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [sending, setSending] = useState(false);
  const [pendingUserText, setPendingUserText] = useState('');
  const [recordingMic, setRecordingMic] = useState(false);

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
        const ev = event as { results: { [idx: number]: { [alt: number]: { transcript: string } } } };
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
      pushToast({ title: 'Erro na comunicação com o agente', detail: (err as Error).message, tone: 'error' });
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

  const quickSuggestions = [
    'Analisar impacto AST de server.ts e verificar acoplamento Co-Change',
    'Mostra a telemetria real de CPU, RAM e portas do sistema',
    'Lista as memórias principais guardadas no Memory Vault',
    'Inspeciona o estado Git e últimos commits do repositório',
    'Dispara o workflow de auditoria CI',
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-9.5rem)]">
      {/* Specialist Rooms Sidebar */}
      <aside className="lg:col-span-3 bg-[#0d1117] border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between gap-4">
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Salas Especialistas</h2>
            <p className="text-xs text-slate-400 mt-0.5">Sessões isoladas com ferramentas dedicadas.</p>
          </div>

          <div className="space-y-1.5">
            {store.rooms.map((room) => {
              const isSelected = room.id === activeRoom?.id;
              const count = store.messages.filter((m) => m.roomId === room.id).length;
              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setActiveRoomId(room.id)}
                  className={`w-full p-3 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'bg-[#151c26] border-cyan-500/60 text-slate-100'
                      : 'bg-transparent border-slate-800/60 text-slate-300 hover:bg-[#151c26]/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{room.name}</span>
                    <span className="text-xs font-mono tabular-nums text-slate-500">{count}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{room.roleTitle}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-800 space-y-2">
          <p className="text-xs font-medium text-slate-400">Ferramentas Ativas na Sala</p>
          <p className="text-xs text-slate-500 font-mono leading-relaxed">
            {activeRoom?.allowedTools.join(' · ')}
          </p>
        </div>
      </aside>

      {/* Main Conversation Stream + Multimodal Composer */}
      <section className="lg:col-span-9 bg-[#0d1117] border border-slate-800/80 rounded-xl flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-100 truncate">{activeRoom?.name}</h3>
            <p className="text-xs text-slate-400 truncate">
              {activeRoom?.roleTitle} · {activeRoom?.description}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClearRoom}
            aria-label="Limpar conversa desta sala"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-rose-300 bg-[#151c26] border border-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Limpar Sala
          </button>
        </div>

        {/* Messages Viewport */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4 max-h-[56vh]">
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
                        : 'bg-[#151c26] border-slate-800 text-slate-200'
                    }`}
                  >
                    {/* Multimodal Attachments */}
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

                    {/* JEV-S1 Reflex Router + 5-Stage Token Diet + Notice Lookahead AST */}
                    {!isUser && msg.jevRoute && (
                      <div className="mb-3 p-2.5 rounded-lg bg-[#07090e] border border-slate-800 space-y-1.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums">
                          <span className="text-cyan-300">
                            JEV-S1 {msg.jevRoute.latencyMs}ms · [{msg.jevRoute.tier[0]}]{' '}
                            {msg.jevRoute.intent}
                            {msg.jevRoute.microTick ? ' · MICRO_TICK' : ''}
                          </span>
                          <span className="text-emerald-400">
                            -{msg.jevRoute.tokenDiet.savingsPercent}% tokens (
                            {msg.jevRoute.tokenDiet.baselineTokens}t →{' '}
                            {msg.jevRoute.tokenDiet.injectedTokens}t) ·{' '}
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

                    {/* Interactive Tool Execution Cards */}
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
                <div className="rounded-xl px-4 py-3 text-xs bg-[#151c26] border border-slate-800 text-cyan-300 font-mono">
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
              className="px-2.5 py-1 text-xs text-slate-300 bg-[#151c26] border border-slate-800 rounded-md hover:border-cyan-500/50 whitespace-nowrap shrink-0 transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Pending Attachments Preview */}
        {attachments.length > 0 && (
          <div className="px-5 py-2 bg-[#07090e] border-t border-slate-800 flex flex-wrap gap-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#151c26] border border-slate-700 text-xs text-slate-200"
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
            className="p-2.5 rounded-lg bg-[#151c26] border border-slate-800 text-slate-300 hover:text-cyan-300 hover:border-slate-700 transition-colors shrink-0"
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
                : 'bg-[#151c26] border-slate-800 text-slate-300 hover:text-cyan-300'
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
            placeholder="Escreve uma diretiva, pede ferramentas reais ou cola uma imagem (Ctrl+V)..."
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
  );
};
