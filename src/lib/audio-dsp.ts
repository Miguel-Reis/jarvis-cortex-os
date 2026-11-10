import type { LanguageCode } from '../shared/types';

/**
 * Skywalker Sound Mark-VII Helmet Acoustic DSP & Wake-Word Engine
 * - 320Hz–3800Hz Bandpass + 18.5ms Titanium Visor Comb Delay + Soft Saturation
 * - Real-time 60 FPS FFT / envelope energy sampler for Pebble Mark-VII Orb
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
  private freqBins: Uint8Array<ArrayBuffer> | null = null;
  private speaking = false;
  private speechStartAt = 0;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.78;
      this.freqBins = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Synthesizes the signature Skywalker Sound Mark-VII helmet telemetry chime
   * routed through a 320–3800Hz bandpass + 18.5ms comb resonance filter.
   */
  public playMarkViiChime(dspEnabled = true): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.analyser) return;

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
    envGain.gain.exponentialRampToValueAtTime(0.11, now + 0.025);
    envGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    oscA.connect(envGain);
    oscB.connect(envGain);

    if (dspEnabled) {
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 320;

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 3800;

      // 18.5ms metallic faceplate comb delay
      const combDelay = ctx.createDelay(0.1);
      combDelay.delayTime.value = 0.0185;
      const combFeedback = ctx.createGain();
      combFeedback.gain.value = 0.34;

      envGain.connect(highpass);
      highpass.connect(lowpass);

      lowpass.connect(this.analyser);
      lowpass.connect(combDelay);
      combDelay.connect(combFeedback);
      combFeedback.connect(combDelay);
      combFeedback.connect(this.analyser);
    } else {
      envGain.connect(this.analyser);
    }

    this.analyser.connect(ctx.destination);

    oscA.start(now);
    oscB.start(now);
    oscA.stop(now + 0.3);
    oscB.stop(now + 0.3);
  }

  /**
   * Speaks text via Web Speech API accompanied by Mark-VII DSP helmet acoustics
   * and drives the 60 FPS energy envelope while speaking.
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
   * Samples live FFT bins + synthetic speech cadence at 60 FPS for the Pebble Orb.
   */
  public sampleEnergy(now = performance.now()): { average: number; isSpeaking: boolean } {
    let fftAvg = 0;
    if (this.analyser && this.freqBins) {
      this.analyser.getByteFrequencyData(this.freqBins);
      let sum = 0;
      for (let i = 0; i < this.freqBins.length; i++) {
        sum += this.freqBins[i];
      }
      fftAvg = sum / (this.freqBins.length * 255);
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
      };
    }

    // Subtle idle breathing pulse + any residual chime FFT energy
    const idlePulse = 0.05 + 0.035 * (0.5 + 0.5 * Math.sin(now * 0.0024));
    return {
      average: Math.min(1, Math.max(idlePulse, fftAvg)),
      isSpeaking: fftAvg > 0.08,
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
          ? 'Web Speech API indisponível neste navegador — utilize o campo rápido.'
          : 'Web Speech API unavailable in this browser — use quick input.'
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
