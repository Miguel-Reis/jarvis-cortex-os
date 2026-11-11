import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, Minimize2, Send } from 'lucide-react';
import { createWakeWordController, markViiAudio } from '../lib/audio-dsp';
import type { AppSettings } from '../shared/types';

interface PebbleWidgetProps {
  settings: AppSettings;
  compactRail?: boolean;
  onToggleWakeWord: (enabled: boolean) => void;
  onVoiceDirective: (directiveText: string) => Promise<string>;
}

export const PebbleWidget: React.FC<PebbleWidgetProps> = ({
  settings,
  compactRail = true,
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

  // On-demand Stark HUD Acoustic Core: static crisp frame when idle, 60 FPS rAF when active/expanded
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
      const pulseRadius = baseRadius + sample.average * (size * 0.15);
      const isFocus = focusModeRef.current;

      // Outer Stark calibrated cyan/amber ring
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.44, 0, Math.PI * 2);
      ctx.strokeStyle = wakeActiveRef.current
        ? 'rgba(16, 185, 129, 0.55)'
        : isFocus
          ? 'rgba(245, 158, 11, 0.4)'
          : 'rgba(34, 211, 238, 0.4)';
      ctx.lineWidth = 1.25;
      ctx.stroke();

      // Counter-rotating amber & cyan tactical arcs
      const angleA = expanded || wakeActiveRef.current ? (now * 0.0016) % (Math.PI * 2) : 0.45;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.37, angleA, angleA + Math.PI * 0.85);
      ctx.strokeStyle = sample.isSpeaking ? '#fbbf24' : '#22d3ee';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      const angleB = expanded || wakeActiveRef.current ? (-now * 0.0012) % (Math.PI * 2) : 2.35;
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
      } else {
        grad.addColorStop(0, '#ecfeff');
        grad.addColorStop(0.55, '#06b6d4');
        grad.addColorStop(1, 'rgba(34, 211, 238, 0.05)');
      }

      ctx.beginPath();
      ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      if (expanded || wakeActiveRef.current || sample.isSpeaking) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };

    drawFrame(performance.now());
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [expanded, settings.wakeWordEnabled, settings.focusModeEnabled]);

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

  return (
    <>
      {/* Docked Trigger inside the Stark Tactical Rail (zero overlap over main content) */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-label="Abrir consola acústica Mark-VII"
        title="Consola Acústica Mark-VII · Voz & Diretiva Rápida"
        data-testid="pebble-orb-trigger"
        className={`group relative flex items-center rounded-lg border transition-colors ${
          compactRail
            ? 'w-10 h-10 mx-auto justify-center bg-[#09111f] border-amber-400/35 hover:border-amber-400/75'
            : 'w-full gap-2.5 px-2.5 py-1.5 bg-[#09111f] border-amber-400/35 hover:border-amber-400/75'
        }`}
      >
        <canvas ref={canvasRef} width={30} height={30} className="w-7.5 h-7.5 shrink-0" />
        {!compactRail && (
          <div className="text-left min-w-0">
            <span className="block text-[11px] font-mono font-semibold text-slate-100 truncate leading-tight">
              MARK-VII VOZ
            </span>
            <span className="block text-[10px] font-mono text-amber-300 truncate leading-tight">
              {settings.wakeWordEnabled ? 'Escuta Ativa' : 'Consola Pronta'}
            </span>
          </div>
        )}
        {compactRail && (
          <span
            role="tooltip"
            className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-full ml-2.5 px-2.5 py-1 rounded-md bg-[#09111f] border border-amber-400/40 text-[11px] font-medium text-slate-100 shadow-lg whitespace-nowrap z-50"
          >
            MARK-VII Voz
          </span>
        )}
      </button>

      {/* Popout Mark-VII Acoustic Console anchored cleanly next to the Rail */}
      {expanded && (
        <div
          data-testid="pebble-expanded-panel"
          className={`fixed bottom-4 left-4 z-50 w-86 max-w-[calc(100vw-2rem)] hud-panel hud-corner-frame rounded-xl p-4 shadow-2xl ${
            compactRail ? 'lg:left-[80px]' : 'lg:left-[244px]'
          }`}
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800/90">
            <div>
              <p className="text-sm font-semibold text-slate-100 font-display">
                Núcleo Acústico Mark-VII
              </p>
              <p className="text-[11px] font-mono text-slate-400 tabular-nums">
                DSP 18.5ms {settings.voiceDspEnabled ? 'Ativo' : 'Off'} · FFT Calibrado
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Minimizar consola Mark-VII"
              className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md hover:bg-slate-800/60"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          </div>

          <div className="pt-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleWakeWord(!settings.wakeWordEnabled)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
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
                {settings.wakeWordEnabled ? 'Escuta Ativa' : 'Ativar "Hey Jarvis"'}
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#050810] border border-cyan-500/35 text-cyan-300 hover:border-cyan-400 transition-colors whitespace-nowrap"
              >
                <Volume2 className="w-3.5 h-3.5" />
                Testar Voz
              </button>
            </div>

            {heardPreview && (
              <p className="text-xs text-slate-400 truncate">Ouvido: &ldquo;{heardPreview}&rdquo;</p>
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
                placeholder='Diretiva rápida ou "Ó Jarvis..."'
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
    </>
  );
};
