import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, Minimize2, Send } from 'lucide-react';
import { createWakeWordController, markViiAudio } from '../lib/audio-dsp';
import type { AppSettings } from '../shared/types';

interface PebbleWidgetProps {
  settings: AppSettings;
  onToggleWakeWord: (enabled: boolean) => void;
  onVoiceDirective: (directiveText: string) => Promise<string>;
}

export const PebbleWidget: React.FC<PebbleWidgetProps> = ({
  settings,
  onToggleWakeWord,
  onVoiceDirective,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [inputText, setInputText] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [heardPreview, setHeardPreview] = useState('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wakeActiveRef = useRef(settings.wakeWordEnabled);
  const focusModeRef = useRef(settings.focusModeEnabled);
  wakeActiveRef.current = settings.wakeWordEnabled;
  focusModeRef.current = settings.focusModeEnabled;

  // 60 FPS Canvas Acoustic Orb — zero React setState inside rAF loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const render = (now: number) => {
      const size = canvas.width;
      const cx = size / 2;
      const cy = size / 2;
      ctx.clearRect(0, 0, size, size);

      const sample = markViiAudio.sampleEnergy(now);
      const baseRadius = size * 0.27;
      const pulseRadius = baseRadius + sample.average * (size * 0.14);

      const isFocus = focusModeRef.current;

      // Outer tactical ring
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2);
      ctx.strokeStyle = wakeActiveRef.current
        ? 'rgba(116, 198, 157, 0.42)'
        : isFocus
          ? 'rgba(212, 148, 58, 0.28)'
          : 'rgba(6, 182, 212, 0.32)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Rotating segmented arc
      const angle = (now * 0.0018) % (Math.PI * 2);
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.36, angle, angle + Math.PI * 1.15);
      ctx.strokeStyle = sample.isSpeaking
        ? '#f59e0b'
        : isFocus
          ? '#d4943a'
          : '#06b6d4';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Core acoustic orb
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, pulseRadius);
      if (sample.isSpeaking || isFocus) {
        grad.addColorStop(0, isFocus && !sample.isSpeaking ? '#f3c98b' : '#fef3c7');
        grad.addColorStop(0.55, isFocus && !sample.isSpeaking ? '#c6862e' : '#f59e0b');
        grad.addColorStop(1, 'rgba(212, 148, 58, 0.04)');
      } else {
        grad.addColorStop(0, '#cffafe');
        grad.addColorStop(0.55, '#06b6d4');
        grad.addColorStop(1, 'rgba(6, 182, 212, 0.05)');
      }

      ctx.beginPath();
      ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [expanded]);

  // Wake-Word ("Hey Jarvis" / "Ó Jarvis") listener
  useEffect(() => {
    if (!settings.wakeWordEnabled) return;
    const controller = createWakeWordController(
      settings.language,
      async (command) => {
        setExpanded(true);
        setBusy(true);
        try {
          const reply = await onVoiceDirective(command);
          setLastReply(reply);
          markViiAudio.speakWithMarkVII(reply, settings.language, settings.voiceDspEnabled);
        } finally {
          setBusy(false);
        }
      },
      (raw) => setHeardPreview(raw)
    );
    controller.start();
    return () => controller.stop();
  }, [settings.wakeWordEnabled, settings.language, settings.voiceDspEnabled, onVoiceDirective]);

  const handleQuickSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || busy) return;
    const text = inputText.trim();
    setInputText('');
    setBusy(true);
    try {
      const reply = await onVoiceDirective(text);
      setLastReply(reply);
      markViiAudio.speakWithMarkVII(reply, settings.language, settings.voiceDspEnabled);
    } finally {
      setBusy(false);
    }
  };

  if (!expanded) {
    return (
      <div className="fixed bottom-5 right-5 z-40">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Abrir modo flutuante Pebble Voz"
          data-testid="pebble-orb-trigger"
          className={`group flex items-center rounded-full bg-[#0d1117]/95 border border-slate-700/80 hover:border-cyan-500/60 shadow-xl transition-all ${
            settings.focusModeEnabled
              ? 'p-1.5 opacity-75 hover:opacity-100'
              : 'gap-2.5 pl-2 pr-3.5 py-1.5'
          }`}
        >
          <canvas ref={canvasRef} width={36} height={36} className="w-9 h-9 shrink-0" />
          {!settings.focusModeEnabled && (
            <span className="text-xs font-medium text-slate-200 whitespace-nowrap">
              Pebble {settings.wakeWordEnabled ? '· Escuta Ativa' : '· Mark-VII'}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="pebble-expanded-panel"
      className="fixed bottom-5 right-5 z-40 w-84 max-w-[calc(100vw-2.5rem)] bg-[#0d1117] border border-slate-700/90 rounded-xl shadow-2xl p-4"
    >
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <canvas ref={canvasRef} width={48} height={48} className="w-12 h-12 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-100 font-display">Pebble Mark-VII</p>
            <p className="text-xs text-slate-400">
              DSP 18.5ms {settings.voiceDspEnabled ? 'Ativo' : 'Off'} · 60 FPS FFT
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Minimizar Pebble"
          className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md hover:bg-[#151c26]"
        >
          <Minimize2 className="w-4 h-4" />
        </button>
      </div>

      <div className="py-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleWakeWord(!settings.wakeWordEnabled)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
              settings.wakeWordEnabled
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                : 'bg-[#151c26] border-slate-700 text-slate-300 hover:text-slate-100'
            }`}
          >
            {settings.wakeWordEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            {settings.wakeWordEnabled ? 'Wake-Word: Ativa' : 'Ativar "Hey Jarvis"'}
          </button>
          <button
            type="button"
            onClick={() =>
              markViiAudio.speakWithMarkVII(
                settings.language === 'pt-PT'
                  ? 'Sistemas acústicos Mark Sete calibrados, Comandante.'
                  : 'Mark Seven acoustic systems calibrated, Commander.',
                settings.language,
                settings.voiceDspEnabled
              )
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#151c26] border border-slate-700 text-cyan-300 hover:border-cyan-500/50 transition-colors whitespace-nowrap"
          >
            <Volume2 className="w-3.5 h-3.5" />
            Testar Voz
          </button>
        </div>

        {heardPreview && (
          <p className="text-xs text-slate-400 truncate"> Ouvido: &ldquo;{heardPreview}&rdquo; </p>
        )}

        {lastReply && (
          <div className="p-2.5 rounded-lg bg-[#151c26] border border-slate-800 text-xs text-slate-200 max-h-28 overflow-y-auto">
            {lastReply}
          </div>
        )}

        <form onSubmit={handleQuickSend} className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder='Comando rápido ou "Ó Jarvis..."'
            className="flex-1 px-3 py-1.5 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            disabled={busy || !inputText.trim()}
            aria-label="Enviar comando de voz rápido"
            className="p-2 rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-40 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
