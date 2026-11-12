import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Minimize2,
  PhoneCall,
  PhoneOff,
  Send,
  Sliders,
  Volume2,
} from 'lucide-react';
import { createWakeWordController, markViiAudio } from '../lib/audio-dsp';
import {
  GeminiLiveVoiceClient,
  type LiveVoiceStatus,
} from '../lib/live-voice-client';
import {
  GEMINI_VOICE_CATALOG,
  normalizeGeminiVoiceName,
} from '../shared/cortex-math';
import type { AppSettings, GeminiVoiceName } from '../shared/types';

interface PebbleWidgetProps {
  settings: AppSettings;
  compactRail?: boolean;
  activeProjectId?: string;
  activeChatId?: string;
  onToggleWakeWord: (enabled: boolean) => void;
  onUpdateVoiceSettings?: (updates: Partial<AppSettings>) => Promise<void>;
  onVoiceDirective: (directiveText: string) => Promise<string>;
  onLiveTurnCompleted?: () => Promise<void>;
}

export const PebbleWidget: React.FC<PebbleWidgetProps> = ({
  settings,
  compactRail = true,
  activeProjectId = 'proj-website-studio',
  activeChatId = 'chat-web-main',
  onToggleWakeWord,
  onUpdateVoiceSettings,
  onVoiceDirective,
  onLiveTurnCompleted,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [inputText, setInputText] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [heardPreview, setHeardPreview] = useState('');
  const [liveStatus, setLiveStatus] = useState<LiveVoiceStatus>('IDLE');
  const [liveStatusNote, setLiveStatusNote] = useState('');
  const [liveMuted, setLiveMuted] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveClientRef = useRef<GeminiLiveVoiceClient | null>(null);
  const wakeActiveRef = useRef(settings.wakeWordEnabled);
  const focusModeRef = useRef(settings.focusModeEnabled);
  const liveStatusRef = useRef<LiveVoiceStatus>('IDLE');

  wakeActiveRef.current = settings.wakeWordEnabled;
  focusModeRef.current = settings.focusModeEnabled;
  liveStatusRef.current = liveStatus;

  const selectedVoice: GeminiVoiceName = normalizeGeminiVoiceName(
    settings.preferredVoiceName
  );
  const selectedVoiceMeta =
    GEMINI_VOICE_CATALOG.find((v) => v.id === selectedVoice) ||
    GEMINI_VOICE_CATALOG[0];

  useEffect(() => {
    liveClientRef.current?.setDspEnabled(settings.voiceDspEnabled);
  }, [settings.voiceDspEnabled]);

  useEffect(() => {
    return () => {
      liveClientRef.current?.stop();
      liveClientRef.current = null;
    };
  }, []);

  // On-demand Stark HUD Acoustic Core: static crisp frame when idle, 60 FPS rAF when active/expanded/live
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const drawFrame = (now: number) => {
      const size = canvas.width;
      const cx = size / 2;
      const cy = size / 2;
      ctx.clearRect(0, 0, size, size);

      const sample = markViiAudio.sampleEnergy(now);
      const baseRadius = size * 0.24;
      const pulseRadius = baseRadius + sample.average * (size * 0.16);
      const isFocus = focusModeRef.current;
      const isLive = liveStatusRef.current === 'LIVE';

      // Outer Stark calibrated cyan/amber/emerald ring
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.44, 0, Math.PI * 2);
      ctx.strokeStyle =
        isLive || wakeActiveRef.current
          ? 'rgba(16, 185, 129, 0.65)'
          : isFocus
            ? 'rgba(245, 158, 11, 0.4)'
            : 'rgba(34, 211, 238, 0.4)';
      ctx.lineWidth = 1.25;
      ctx.stroke();

      // Counter-rotating amber & cyan tactical arcs
      const animActive = expanded || wakeActiveRef.current || isLive;
      const angleA = animActive ? (now * 0.0018) % (Math.PI * 2) : 0.45;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.37, angleA, angleA + Math.PI * 0.85);
      ctx.strokeStyle = sample.isSpeaking
        ? '#fbbf24'
        : isLive
          ? '#34d399'
          : '#22d3ee';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      const angleB = animActive ? (-now * 0.0013) % (Math.PI * 2) : 2.35;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.31, angleB, angleB + Math.PI * 0.65);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Core Mark-VII Reactor Glow
      const grad = ctx.createRadialGradient(cx, cy, 1.5, cx, cy, pulseRadius);
      if (sample.isSpeaking || isFocus) {
        grad.addColorStop(0, '#fef3c7');
        grad.addColorStop(0.55, '#f59e0b');
        grad.addColorStop(1, 'rgba(245, 158, 11, 0.05)');
      } else if (isLive) {
        grad.addColorStop(0, '#ecfdf5');
        grad.addColorStop(0.55, '#10b981');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0.06)');
      } else {
        grad.addColorStop(0, '#ecfeff');
        grad.addColorStop(0.55, '#06b6d4');
        grad.addColorStop(1, 'rgba(34, 211, 238, 0.05)');
      }

      ctx.beginPath();
      ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      if (animActive || sample.isSpeaking) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };

    drawFrame(performance.now());
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [expanded, settings.wakeWordEnabled, settings.focusModeEnabled, liveStatus]);

  // Wake-Word ("Hey Jarvis" / "Ó Jarvis") listener (paused automatically while Live session holds mic)
  useEffect(() => {
    if (!settings.wakeWordEnabled || liveStatus === 'LIVE' || liveStatus === 'CONNECTING') {
      return;
    }
    const controller = createWakeWordController(
      settings.language,
      async (command) => {
        setExpanded(true);
        setBusy(true);
        try {
          const reply = await onVoiceDirective(command);
          setLastReply(reply);
          await markViiAudio.previewGeminiOrLocalVoice({
            voiceName: selectedVoice,
            lang: settings.language,
            dspEnabled: settings.voiceDspEnabled,
            customText: reply.slice(0, 320),
          });
        } finally {
          setBusy(false);
        }
      },
      (raw) => setHeardPreview(raw)
    );
    controller.start();
    return () => controller.stop();
  }, [
    settings.wakeWordEnabled,
    settings.language,
    settings.voiceDspEnabled,
    selectedVoice,
    liveStatus,
    onVoiceDirective,
  ]);

  const handleSelectVoice = async (nextVoice: GeminiVoiceName) => {
    await onUpdateVoiceSettings?.({ preferredVoiceName: nextVoice });
    if (liveStatus === 'LIVE') {
      setLiveStatusNote(`Nova voz ${nextVoice} guardada (reinicia a chamada Live para aplicar).`);
    }
  };

  const handleToggleDsp = async () => {
    await onUpdateVoiceSettings?.({ voiceDspEnabled: !settings.voiceDspEnabled });
  };

  const handlePreviewVoice = async () => {
    if (previewingVoice) return;
    setPreviewingVoice(true);
    try {
      const res = await markViiAudio.previewGeminiOrLocalVoice({
        voiceName: selectedVoice,
        lang: settings.language,
        dspEnabled: settings.voiceDspEnabled,
      });
      setLiveStatusNote(res.detail);
    } finally {
      setPreviewingVoice(false);
    }
  };

  const handleToggleLiveSession = async () => {
    if (liveStatus === 'LIVE' || liveStatus === 'CONNECTING') {
      liveClientRef.current?.stop();
      setLiveStatus('IDLE');
      setLiveMuted(false);
      setLiveStatusNote('Sessão de voz em direto terminada.');
      return;
    }

    if (!liveClientRef.current) {
      liveClientRef.current = new GeminiLiveVoiceClient();
    }

    await liveClientRef.current.start({
      voiceName: selectedVoice,
      projectId: activeProjectId,
      chatId: activeChatId,
      language: settings.language,
      dspEnabled: settings.voiceDspEnabled,
      callbacks: {
        onStatusChange: (st, detail) => {
          setLiveStatus(st);
          if (detail) setLiveStatusNote(detail);
        },
        onInputTranscript: (txt) => setHeardPreview(txt),
        onOutputTranscript: (txt) => setLastReply(txt),
        onTurnComplete: () => {
          onLiveTurnCompleted?.().catch(() => {});
        },
        onToolExecuted: () => {
          onLiveTurnCompleted?.().catch(() => {});
        },
      },
    });
  };

  const handleToggleLiveMute = () => {
    const next = !liveMuted;
    setLiveMuted(next);
    liveClientRef.current?.setMuted(next);
  };

  const handleQuickSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || busy) return;
    const text = inputText.trim();
    setInputText('');

    if (liveStatus === 'LIVE' && liveClientRef.current) {
      liveClientRef.current.sendTextTurn(text);
      return;
    }

    setBusy(true);
    try {
      const reply = await onVoiceDirective(text);
      setLastReply(reply);
      await markViiAudio.previewGeminiOrLocalVoice({
        voiceName: selectedVoice,
        lang: settings.language,
        dspEnabled: settings.voiceDspEnabled,
        customText: reply.slice(0, 320),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compactRail ? 'flex justify-center' : 'w-full'}>
      {/* Docked Trigger inside the Left Studio Rail */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-label="Abrir consola acústica e seletor de vozes"
        title="Consola de Voz · Escolher Voz, Mark-VII DSP e Conversa Live"
        data-testid="pebble-orb-trigger"
        className={`group relative flex items-center rounded-lg border transition-colors ${
          compactRail
            ? 'w-10 h-10 mx-auto justify-center bg-[#09111f] border-amber-400/35 hover:border-amber-400/75'
            : 'w-full gap-2.5 px-2.5 py-1.5 bg-[#09111f] border-amber-400/35 hover:border-amber-400/75'
        }`}
      >
        <canvas ref={canvasRef} width={30} height={30} className="w-7.5 h-7.5 shrink-0" />
        {!compactRail && (
          <div className="text-left min-w-0 flex-1">
            <span className="block text-[11px] font-mono font-semibold text-slate-100 truncate leading-tight">
              VOZ · {selectedVoice.toUpperCase()}
            </span>
            <span
              className={`block text-[10px] font-mono truncate leading-tight ${
                liveStatus === 'LIVE'
                  ? 'text-emerald-300'
                  : 'text-amber-300'
              }`}
            >
              {liveStatus === 'LIVE'
                ? 'Em Direto (Live API)'
                : settings.wakeWordEnabled
                  ? 'Escuta "Hey Jarvis"'
                  : selectedVoiceMeta.badgePt}
            </span>
          </div>
        )}
        {compactRail && (
          <span
            role="tooltip"
            className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-full ml-2.5 px-2.5 py-1 rounded-md bg-[#09111f] border border-amber-400/40 text-[11px] font-medium text-slate-100 shadow-lg whitespace-nowrap z-50"
          >
            Voz · {selectedVoice}
          </span>
        )}
      </button>

      {/* Popout Mark-VII Voice & Gemini Live Console */}
      {expanded && (
        <div
          data-testid="pebble-expanded-panel"
          className={`fixed bottom-4 left-4 z-50 w-92 max-w-[calc(100vw-2rem)] bg-[#10141d] border border-white/12 rounded-2xl p-4 shadow-2xl ${
            compactRail ? 'lg:left-[72px]' : 'lg:left-[268px]'
          }`}
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800/90">
            <div>
              <p className="text-sm font-semibold text-slate-100 font-display">
                Consola de Voz &amp; Gemini Live
              </p>
              <p className="text-[11px] font-mono text-slate-400 tabular-nums">
                Voz {selectedVoice} ·{' '}
                {settings.voiceDspEnabled ? 'Mark-VII DSP 18.5ms' : 'Voz Natural Limpa'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Minimizar consola de voz"
              className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md hover:bg-slate-800/60"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          </div>

          <div className="pt-3 space-y-3">
            {/* Voice Type Selector + DSP Toggle */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <label htmlFor="pebble-voice-select" className="font-medium text-slate-300">
                  Tipo de Voz do Jarvis
                </label>
                <button
                  type="button"
                  data-testid="pebble-dsp-toggle"
                  onClick={handleToggleDsp}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono transition-colors ${
                    settings.voiceDspEnabled
                      ? 'bg-amber-500/15 border-amber-400/45 text-amber-300'
                      : 'bg-[#050810] border-slate-700 text-slate-300 hover:text-slate-100'
                  }`}
                >
                  <Sliders className="w-3 h-3" />
                  <span>{settings.voiceDspEnabled ? 'Mark-VII DSP ON' : 'Voz Natural'}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <select
                  id="pebble-voice-select"
                  data-testid="pebble-voice-select"
                  value={selectedVoice}
                  onChange={(e) => handleSelectVoice(e.target.value as GeminiVoiceName)}
                  className="flex-1 bg-[#050810] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-400"
                >
                  {GEMINI_VOICE_CATALOG.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} — {v.badgePt}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  data-testid="pebble-preview-voice-btn"
                  disabled={previewingVoice}
                  onClick={handlePreviewVoice}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#050810] border border-cyan-500/35 text-cyan-300 hover:border-cyan-400 transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>{previewingVoice ? 'A gerar...' : 'Ouvir'}</span>
                </button>
              </div>

              <p className="text-[11px] text-slate-400 leading-snug">
                {settings.language === 'en-US'
                  ? selectedVoiceMeta.timbreEn
                  : selectedVoiceMeta.timbrePt}
              </p>
            </div>

            {/* Real-time Gemini 3.8 Live Conversation + Wake-Word Controls */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="pebble-live-session-btn"
                onClick={handleToggleLiveSession}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                  liveStatus === 'LIVE'
                    ? 'bg-rose-500/20 border-rose-400/50 text-rose-200 hover:bg-rose-500/30'
                    : liveStatus === 'CONNECTING'
                      ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                      : 'bg-emerald-500/18 border-emerald-400/45 text-emerald-200 hover:bg-emerald-500/25'
                }`}
              >
                {liveStatus === 'LIVE' ? (
                  <>
                    <PhoneOff className="w-3.5 h-3.5" />
                    <span>Terminar Live</span>
                  </>
                ) : (
                  <>
                    <PhoneCall className="w-3.5 h-3.5" />
                    <span>
                      {liveStatus === 'CONNECTING' ? 'A ligar Live...' : 'Conversa Live'}
                    </span>
                  </>
                )}
              </button>

              {liveStatus === 'LIVE' ? (
                <button
                  type="button"
                  onClick={handleToggleLiveMute}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    liveMuted
                      ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                      : 'bg-[#050810] border-slate-700 text-slate-200'
                  }`}
                >
                  {liveMuted ? (
                    <>
                      <MicOff className="w-3.5 h-3.5" />
                      <span>Silenciado</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Micro Ativo</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onToggleWakeWord(!settings.wakeWordEnabled)}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    settings.wakeWordEnabled
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                      : 'bg-[#050810] border-slate-800 text-slate-300 hover:text-slate-100 hover:border-slate-700'
                  }`}
                >
                  {settings.wakeWordEnabled ? (
                    <Mic className="w-3.5 h-3.5" />
                  ) : (
                    <MicOff className="w-3.5 h-3.5" />
                  )}
                  <span>{settings.wakeWordEnabled ? 'Hey Jarvis ON' : 'Hey Jarvis'}</span>
                </button>
              )}
            </div>

            {liveStatusNote && (
              <p className="text-[11px] text-amber-300/90 leading-snug">{liveStatusNote}</p>
            )}

            {heardPreview && (
              <p className="text-xs text-slate-400 truncate">
                Tu: &ldquo;{heardPreview}&rdquo;
              </p>
            )}

            {lastReply && (
              <div className="p-2.5 rounded-lg bg-[#050810] border border-slate-800 text-xs text-slate-200 max-h-28 overflow-y-auto">
                {lastReply}
              </div>
            )}

            <form onSubmit={handleQuickSend} className="flex items-center gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  liveStatus === 'LIVE'
                    ? 'Enviar nota rápida na sessão Live...'
                    : 'Diretiva rápida por voz/texto...'
                }
                className="flex-1 px-3 py-2 text-xs bg-[#050810] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                disabled={busy || !inputText.trim()}
                aria-label="Enviar comando rápido"
                className="p-2 rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40 transition-colors shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
