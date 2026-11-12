import React, { useState } from 'react';
import {
  Check,
  Eye,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Sliders,
  Volume2,
  X,
} from 'lucide-react';
import { markViiAudio } from '../../lib/audio-dsp';
import type { LiveVoiceStatus } from '../../lib/live-voice-client';
import {
  GEMINI_VOICE_CATALOG,
  normalizeGeminiVoiceName,
} from '../../shared/cortex-math';
import type { AppSettings, GeminiVoiceName } from '../../shared/types';

interface StudioLiveVoicePanelProps {
  settings: AppSettings;
  liveStatus: LiveVoiceStatus;
  liveMuted: boolean;
  liveStatusDetail: string;
  liveUserTranscript: string;
  liveAssistantTranscript: string;
  screenStreamActive: boolean;
  onClose: () => void;
  onUpdateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  onToggleLiveSession: () => Promise<void>;
  onToggleMute: () => void;
}

export const StudioLiveVoicePanel: React.FC<StudioLiveVoicePanelProps> = ({
  settings,
  liveStatus,
  liveMuted,
  liveStatusDetail,
  liveUserTranscript,
  liveAssistantTranscript,
  screenStreamActive,
  onClose,
  onUpdateSettings,
  onToggleLiveSession,
  onToggleMute,
}) => {
  const [previewing, setPreviewing] = useState(false);
  const [previewMessage, setPreviewMessage] = useState('');

  const selectedVoice: GeminiVoiceName = normalizeGeminiVoiceName(
    settings.preferredVoiceName
  );
  const selectedMeta =
    GEMINI_VOICE_CATALOG.find((v) => v.id === selectedVoice) ||
    GEMINI_VOICE_CATALOG[0];
  const syncScreen = settings.liveVoiceScreenSync !== false;

  const handlePickVoice = async (voiceId: GeminiVoiceName) => {
    setPreviewMessage('');
    await onUpdateSettings({ preferredVoiceName: voiceId });
  };

  const handlePreviewSelectedVoice = async () => {
    if (previewing) return;
    setPreviewing(true);
    setPreviewMessage('');
    try {
      const res = await markViiAudio.previewGeminiOrLocalVoice({
        voiceName: selectedVoice,
        lang: settings.language,
        dspEnabled: settings.voiceDspEnabled,
      });
      setPreviewMessage(res.detail);
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div
      data-testid="studio-live-voice-panel"
      className="border-b border-white/8 bg-[#10141d] px-5 py-3.5 shrink-0"
    >
      <div className="max-w-3xl mx-auto space-y-3">
        {/* Header Row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                liveStatus === 'LIVE'
                  ? 'bg-emerald-400 animate-pulse'
                  : liveStatus === 'CONNECTING'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-[#e59a54]'
              }`}
            />
            <h2 className="text-xs font-semibold text-slate-100 font-display truncate">
              Voz em Direto &amp; Perfis de Voz
            </h2>
            <span className="hidden sm:inline-block px-2 py-0.5 rounded-md bg-[#0b0d11] border border-white/8 text-[10px] font-mono text-slate-400 shrink-0">
              {liveStatus === 'LIVE'
                ? `LIVE · ${selectedVoice}`
                : `gemini-3.8-live · ${selectedVoice}`}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="studio-toggle-voice-dsp"
              onClick={() =>
                onUpdateSettings({ voiceDspEnabled: !settings.voiceDspEnabled })
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap ${
                settings.voiceDspEnabled
                  ? 'bg-[#e59a54]/14 border-[#e59a54]/45 text-[#f3c394]'
                  : 'bg-[#0b0d11] border-white/10 text-slate-300 hover:text-slate-100'
              }`}
            >
              <Sliders className="w-3 h-3" />
              <span>
                {settings.voiceDspEnabled ? 'Mark-VII DSP (18.5ms)' : 'Voz Natural'}
              </span>
            </button>

            <button
              type="button"
              data-testid="studio-preview-voice-btn"
              disabled={previewing}
              onClick={handlePreviewSelectedVoice}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#0b0d11] border border-white/10 text-slate-200 hover:border-[#e59a54]/50 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <Volume2 className="w-3.5 h-3.5 text-[#e59a54]" />
              <span>{previewing ? 'A gerar voz...' : `Ouvir ${selectedVoice}`}</span>
            </button>

            {liveStatus !== 'LIVE' && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar painel de voz"
                className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/6 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 5 Prebuilt Voice Personas Selector */}
        <div
          role="radiogroup"
          aria-label="Escolher tipo de voz do Jarvis"
          className="grid grid-cols-2 sm:grid-cols-5 gap-1.5"
        >
          {GEMINI_VOICE_CATALOG.map((voice) => {
            const active = voice.id === selectedVoice;
            return (
              <button
                key={voice.id}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`studio-voice-option-${voice.id.toLowerCase()}`}
                onClick={() => handlePickVoice(voice.id)}
                className={`p-2 rounded-lg border text-left transition-colors ${
                  active
                    ? 'bg-[#e59a54]/14 border-[#e59a54]/55 text-slate-100'
                    : 'bg-[#0b0d11] border-white/7 text-slate-300 hover:border-white/18 hover:text-slate-100'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold truncate">{voice.label}</span>
                  {active && <Check className="w-3 h-3 text-[#e59a54] shrink-0" />}
                </div>
                <span className="block text-[10px] text-slate-400 truncate mt-0.5">
                  {voice.badgePt}
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected Voice Description + Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-0.5">
          <div className="space-y-0.5 min-w-0">
            <p className="text-xs text-slate-300">
              <strong className="text-slate-100">{selectedMeta.label}:</strong>{' '}
              {settings.language === 'en-US'
                ? selectedMeta.timbreEn
                : selectedMeta.timbrePt}
            </p>
            {(previewMessage || liveStatusDetail) && (
              <p className="text-[11px] text-[#f3c394] truncate">
                {previewMessage || liveStatusDetail}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={syncScreen}
              data-testid="studio-live-screen-sync-switch"
              onClick={() =>
                onUpdateSettings({ liveVoiceScreenSync: !syncScreen })
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap ${
                syncScreen
                  ? 'bg-sky-500/12 border-sky-400/35 text-sky-200'
                  : 'bg-[#0b0d11] border-white/10 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-sky-300" />
              <span>
                {screenStreamActive
                  ? 'Ecrã 1 FPS em direto'
                  : syncScreen
                    ? 'Ecrã 1 FPS: Ligado'
                    : 'Ecrã 1 FPS: Desligado'}
              </span>
            </button>

            {liveStatus === 'LIVE' && (
              <button
                type="button"
                data-testid="studio-live-mute-btn"
                onClick={onToggleMute}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                  liveMuted
                    ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                    : 'bg-[#0b0d11] border-white/12 text-slate-200 hover:border-white/25'
                }`}
              >
                {liveMuted ? (
                  <>
                    <MicOff className="w-3.5 h-3.5" />
                    <span>Micro Silenciado</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Micro Ativo</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              data-testid="studio-start-live-session-btn"
              onClick={onToggleLiveSession}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                liveStatus === 'LIVE'
                  ? 'bg-rose-500/20 border border-rose-400/50 text-rose-200 hover:bg-rose-500/30'
                  : liveStatus === 'CONNECTING'
                    ? 'bg-amber-500/20 border border-amber-400/50 text-amber-200'
                    : 'bg-[#e59a54] text-[#0b0d11] hover:bg-[#f0ac6b]'
              }`}
            >
              {liveStatus === 'LIVE' ? (
                <>
                  <PhoneOff className="w-3.5 h-3.5" />
                  <span>Terminar Conversa Live</span>
                </>
              ) : (
                <>
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>
                    {liveStatus === 'CONNECTING'
                      ? 'A abrir canal Live...'
                      : 'Iniciar Conversa Live'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Real-time Transcripts during active Live Conversation */}
        {liveStatus === 'LIVE' && (liveUserTranscript || liveAssistantTranscript) && (
          <div className="p-2.5 rounded-xl bg-[#0b0d11] border border-white/8 space-y-1.5 text-xs">
            {liveUserTranscript && (
              <p className="text-slate-400">
                <span className="font-semibold text-slate-200">Tu (em direto): </span>
                {liveUserTranscript}
              </p>
            )}
            {liveAssistantTranscript && (
              <p className="text-slate-200">
                <span className="font-semibold text-[#e59a54]">
                  Jarvis ({selectedVoice}):{' '}
                </span>
                {liveAssistantTranscript}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
