import {
  decodePcm16Base64ToFloat32,
  extractPcm16FromWavOrRawBase64,
} from '../shared/cortex-math';
import type { GeminiVoiceName, LanguageCode } from '../shared/types';

/**
 * Skywalker Sound Mark-VII Helmet Acoustic DSP, 24kHz Gemini Live Stream Player & Wake-Word Engine
 * - Gapless 24kHz 16-bit LE PCM playback (`nextStartTime` scheduling) + instant barge-in interruption
 * - Optional 320Hz–3800Hz Bandpass + 18.5ms Titanium Visor Comb Delay on real Gemini voices
 * - Real-time 60 FPS FFT / envelope energy sampler for Mark-VII Orb & Studio Live Co-Pilot
 * - Web Speech API continuous Wake-Word listener ("Hey Jarvis", "Ó Jarvis", "Jarvis")
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

class MarkViiAudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private cleanInputGain: GainNode | null = null;
  private dspInputNode: BiquadFilterNode | null = null;
  private freqBins: Uint8Array<ArrayBuffer> | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private micLevel = 0;
  private speaking = false;
  private speechStartAt = 0;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx({ sampleRate: 24000 });
      } catch {
        this.ctx = new AudioCtx();
      }

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.76;
      this.freqBins = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

      // Clean natural voice bus -> Analyser -> Destination
      this.cleanInputGain = this.ctx.createGain();
      this.cleanInputGain.gain.value = 1.0;
      this.cleanInputGain.connect(this.analyser);

      // Skywalker Sound Mark-VII Helmet DSP bus (320-3800Hz bandpass + 18.5ms titanium comb delay)
      const highpass = this.ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 300;

      const lowpass = this.ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 4100;

      const combDelay = this.ctx.createDelay(0.1);
      combDelay.delayTime.value = 0.0185;
      const combFeedback = this.ctx.createGain();
      combFeedback.gain.value = 0.24;
      const combWet = this.ctx.createGain();
      combWet.gain.value = 0.28;

      highpass.connect(lowpass);
      lowpass.connect(this.analyser);
      lowpass.connect(combDelay);
      combDelay.connect(combFeedback);
      combFeedback.connect(combDelay);
      combDelay.connect(combWet);
      combWet.connect(this.analyser);

      this.dspInputNode = highpass;
      this.analyser.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMicInputLevel(rms: number): void {
    this.micLevel = Math.max(0, Math.min(1, rms));
  }

  /**
   * Immediately stops all scheduled PCM/WAV playback buffers (used on Live barge-in interruption or disconnect).
   */
  public interruptPlayback(): void {
    for (const src of this.activeSources) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already stopped source
      }
    }
    this.activeSources.clear();
    this.nextStartTime = 0;
    this.speaking = false;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore cancel error
      }
    }
  }

  /**
   * Schedules Float32 mono audio samples gaplessly on the WebAudio graph (`nextStartTime`),
   * routing either cleanly or through the Mark-VII helmet DSP bus while driving real 60 FPS FFT.
   */
  public scheduleFloat32Samples(
    samples: Float32Array,
    sampleRate = 24000,
    dspEnabled = false
  ): number {
    if (!samples.length) return 0;
    const ctx = this.ensureContext();
    if (!ctx || !this.cleanInputGain || !this.dspInputNode) return 0;

    const audioBuffer = ctx.createBuffer(1, samples.length, sampleRate);
    audioBuffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(dspEnabled ? this.dspInputNode : this.cleanInputGain);

    const now = ctx.currentTime;
    if (this.nextStartTime < now + 0.015) {
      this.nextStartTime = now + 0.02;
    }

    const startAt = this.nextStartTime;
    this.nextStartTime += audioBuffer.duration;

    this.activeSources.add(source);
    this.speaking = true;
    this.speechStartAt = performance.now();

    source.onended = () => {
      this.activeSources.delete(source);
      if (this.activeSources.size === 0) {
        this.speaking = false;
      }
    };

    source.start(startAt);
    return audioBuffer.duration;
  }

  /**
   * Enqueues a raw 16-bit LE PCM base64 chunk (24kHz from `gemini-3.8-live`) for gapless playback.
   */
  public enqueuePcmChunk(
    base64Pcm: string,
    sampleRate = 24000,
    dspEnabled = false
  ): number {
    const samples = decodePcm16Base64ToFloat32(base64Pcm);
    return this.scheduleFloat32Samples(samples, sampleRate, dspEnabled);
  }

  /**
   * Plays a complete unary WAV or raw PCM base64 clip (e.g. `gemini-3.8-flash-lite-tts` voice preview).
   */
  public playWavOrPcmBase64(base64Audio: string, dspEnabled = false): number {
    this.interruptPlayback();
    if (dspEnabled) {
      this.playMarkViiChime(true);
    }
    const { samples, sampleRate } = extractPcm16FromWavOrRawBase64(base64Audio, 24000);
    return this.scheduleFloat32Samples(samples, sampleRate, dspEnabled);
  }

  /**
   * Synthesizes the signature Skywalker Sound Mark-VII helmet telemetry chime.
   */
  public playMarkViiChime(dspEnabled = true): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.cleanInputGain || !this.dspInputNode) return;

    const now = ctx.currentTime;
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const envGain = ctx.createGain();

    oscA.type = 'triangle';
    oscB.type = 'sine';
    oscA.frequency.setValueAtTime(520, now);
    oscA.frequency.exponentialRampToValueAtTime(780, now + 0.14);
    oscB.frequency.setValueAtTime(1040, now);
    oscB.frequency.exponentialRampToValueAtTime(1560, now + 0.18);

    envGain.gain.setValueAtTime(0.0001, now);
    envGain.gain.exponentialRampToValueAtTime(0.1, now + 0.025);
    envGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);

    oscA.connect(envGain);
    oscB.connect(envGain);
    envGain.connect(dspEnabled ? this.dspInputNode : this.cleanInputGain);

    oscA.start(now);
    oscB.start(now);
    oscA.stop(now + 0.28);
    oscB.stop(now + 0.28);
  }

  /**
   * Subtle two-tone tactical alert chime emitted when an Agent or Sub-Agent requests human authorization.
   */
  public playAuthorityAlertChime(dspEnabled = true): void {
    try {
      const ctx = this.ensureContext();
      if (!ctx || !this.cleanInputGain || !this.dspInputNode) return;

      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(587.33, now);
      osc1.frequency.setValueAtTime(880, now + 0.11);
      osc2.frequency.setValueAtTime(293.66, now);
      osc2.frequency.setValueAtTime(440, now + 0.11);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.085, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(dspEnabled ? this.dspInputNode : this.cleanInputGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.3);
      osc2.stop(now + 0.3);
    } catch {
      // Safe no-op if browser autoplay policy blocks AudioContext before user gesture
    }
  }

  /**
   * Local zero-dependency Web Speech API fallback when offline or in LOCAL_DETERMINISTIC mode.
   */
  public speakWithMarkVII(text: string, lang: LanguageCode = 'pt-PT', dspEnabled = true): void {
    if (typeof window === 'undefined') return;
    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*#_`~>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanText) return;

    if (dspEnabled) {
      this.playMarkViiChime(true);
    }

    if (!('speechSynthesis' in window) || !window.speechSynthesis) {
      this.speaking = true;
      this.speechStartAt = performance.now();
      globalThis.setTimeout(() => {
        this.speaking = false;
      }, Math.min(5000, Math.max(1200, cleanText.length * 45)));
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = lang;
      utterance.rate = dspEnabled ? 1.04 : 1.0;
      utterance.pitch = dspEnabled ? 0.92 : 1.0;

      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ||
        voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
      if (preferred) {
        utterance.voice = preferred;
      }

      utterance.onstart = () => {
        this.speaking = true;
        this.speechStartAt = performance.now();
      };
      utterance.onend = () => {
        this.speaking = false;
      };
      utterance.onerror = () => {
        this.speaking = false;
      };

      this.speaking = true;
      this.speechStartAt = performance.now();
      window.speechSynthesis.speak(utterance);
    } catch {
      this.speaking = false;
    }
  }

  /**
   * Requests a real server-side voice preview (`gemini-3.8-flash-lite-tts`) for the chosen
   * `GeminiVoiceName` (`Charon`, `Zephyr`, `Kore`, `Fenrir`, `Puck`), falling back gracefully
   * to local Web Speech synthesis if `GEMINI_API_KEY` is absent or offline.
   */
  public async previewGeminiOrLocalVoice(params: {
    voiceName: GeminiVoiceName;
    lang: LanguageCode;
    dspEnabled: boolean;
    customText?: string;
  }): Promise<{ ok: boolean; detail: string; usedCloudVoice: boolean }> {
    try {
      const resp = await fetch('/api/voice/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceName: params.voiceName,
          language: params.lang,
          customText: params.customText,
        }),
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        audioBase64?: string;
        sampleText?: string;
        detail?: string;
      };

      if (data.ok && data.audioBase64) {
        this.playWavOrPcmBase64(data.audioBase64, params.dspEnabled);
        return {
          ok: true,
          detail: data.detail || `Voz ${params.voiceName} reproduzida.`,
          usedCloudVoice: true,
        };
      }

      const fallbackSample =
        data.sampleText ||
        (params.lang === 'pt-PT'
          ? `Amostra local da voz ${params.voiceName} calibrada.`
          : `Local preview for ${params.voiceName} calibrated.`);
      this.speakWithMarkVII(fallbackSample, params.lang, params.dspEnabled);
      return {
        ok: true,
        detail: data.detail || 'Reproduzido com síntese local (modo offline).',
        usedCloudVoice: false,
      };
    } catch {
      this.speakWithMarkVII(
        params.lang === 'pt-PT'
          ? 'Sistemas acústicos Mark Sete calibrados, Comandante.'
          : 'Mark Seven acoustic systems calibrated, Commander.',
        params.lang,
        params.dspEnabled
      );
      return {
        ok: false,
        detail: 'Sem ligação TTS — a usar síntese local.',
        usedCloudVoice: false,
      };
    }
  }

  /**
   * Samples live FFT bins (real Gemini 24kHz voice + mic RMS) + synthetic speech fallback at 60 FPS.
   */
  public sampleEnergy(now = performance.now()): {
    average: number;
    isSpeaking: boolean;
    micEnergy: number;
  } {
    let fftAvg = 0;
    if (this.analyser && this.freqBins) {
      this.analyser.getByteFrequencyData(this.freqBins);
      let sum = 0;
      for (let i = 0; i < this.freqBins.length; i++) {
        sum += this.freqBins[i];
      }
      fftAvg = sum / (this.freqBins.length * 255);
    }

    const activePcmPlayback = this.activeSources.size > 0;
    if (activePcmPlayback) {
      return {
        average: Math.min(1, Math.max(0.18, fftAvg * 2.1)),
        isSpeaking: true,
        micEnergy: this.micLevel,
      };
    }

    const synthSpeaking =
      typeof window !== 'undefined' && 'speechSynthesis' in window
        ? window.speechSynthesis.speaking || this.speaking
        : this.speaking;

    if (synthSpeaking) {
      const elapsed = (now - this.speechStartAt) * 0.012;
      const cadence =
        0.38 +
        0.24 * Math.abs(Math.sin(elapsed)) +
        0.16 * Math.abs(Math.cos(elapsed * 2.3)) +
        fftAvg * 0.4;
      return {
        average: Math.min(1, cadence),
        isSpeaking: true,
        micEnergy: this.micLevel,
      };
    }

    const idlePulse = 0.05 + 0.035 * (0.5 + 0.5 * Math.sin(now * 0.0024));
    const combined = Math.max(idlePulse, fftAvg * 1.6, this.micLevel * 1.4);
    return {
      average: Math.min(1, combined),
      isSpeaking: fftAvg > 0.06,
      micEnergy: this.micLevel,
    };
  }
}

export const markViiAudio = new MarkViiAudioEngine();

const WAKE_WORD_REGEX = /\b(?:hey\s+jarvis|oi\s+jarvis|[oó]\s+jarvis|ok\s+jarvis|jarvis)\b[,:\s-]*(.*)/i;

export function createWakeWordController(
  lang: LanguageCode,
  onCommand: (command: string) => void | Promise<void>,
  onHeardPreview?: (rawTranscript: string) => void
): { start: () => void; stop: () => void } {
  let active = false;
  let recognition: SpeechRecognitionLike | null = null;
  let restartTimer: number | null = null;

  const getRecognitionCtor = (): SpeechRecognitionConstructor | null => {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  };

  const start = () => {
    if (active) return;
    active = true;
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      onHeardPreview?.(
        lang === 'pt-PT'
          ? 'Web Speech API indisponível neste navegador — utiliza o Modo Conversa Live ou o campo rápido.'
          : 'Web Speech API unavailable in this browser — use Live Voice Mode or quick input.'
      );
      return;
    }

    try {
      recognition = new Ctor();
      recognition.lang = lang;
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const transcript = res?.[0]?.transcript?.trim() || '';
          if (!transcript) continue;
          onHeardPreview?.(transcript);

          if (res.isFinal) {
            const match = WAKE_WORD_REGEX.exec(transcript);
            if (match) {
              const extracted = match[1]?.trim();
              const directive =
                extracted ||
                (lang === 'pt-PT'
                  ? 'Apresenta o estado executivo atual e a próxima ação Q-18.'
                  : 'Present current executive status and top Q-18 next action.');
              Promise.resolve(onCommand(directive)).catch(() => {});
            }
          }
        }
      };

      recognition.onerror = () => {
        // Ignore transient no-speech / network blips; onend handles auto-restart
      };

      recognition.onend = () => {
        if (!active) return;
        restartTimer = window.setTimeout(() => {
          if (!active || !recognition) return;
          try {
            recognition.start();
          } catch {
            // Already started
          }
        }, 450);
      };

      recognition.start();
    } catch {
      // Microphone permission not yet granted
    }
  };

  const stop = () => {
    active = false;
    if (restartTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (recognition) {
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // Ignore stop error
      }
      recognition = null;
    }
  };

  return { start, stop };
}
