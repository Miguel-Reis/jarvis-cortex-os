import {
  downsampleFloat32Buffer,
  encodeFloat32ToPcm16Base64,
  normalizeGeminiVoiceName,
} from '../shared/cortex-math';
import type {
  GeminiVoiceName,
  LanguageCode,
  StudioInlineEvent,
  ToolCallRecord,
} from '../shared/types';
import { markViiAudio } from './audio-dsp';

export type LiveVoiceStatus = 'IDLE' | 'CONNECTING' | 'LIVE' | 'ERROR';

export interface LiveVoiceCallbacks {
  onStatusChange?: (status: LiveVoiceStatus, detail?: string) => void;
  onInputTranscript?: (transcript: string) => void;
  onOutputTranscript?: (transcript: string) => void;
  onToolExecuted?: (toolCall: ToolCallRecord, studioEvents: StudioInlineEvent[]) => void;
  onTurnComplete?: (userTranscript: string, assistantTranscript: string) => void;
  onMicLevel?: (rms: number) => void;
}

export interface StartLiveSessionParams {
  voiceName: GeminiVoiceName;
  projectId: string;
  chatId: string;
  language: LanguageCode;
  dspEnabled: boolean;
  callbacks?: LiveVoiceCallbacks;
}

/**
 * Client-side WebSocket & WebAudio controller for `gemini-3.8-live`.
 * - Captures microphone audio -> downsamples to 16kHz 16-bit LE PCM -> streams over `/ws/live`
 * - Plays back 24kHz PCM audio gaplessly through `markViiAudio` (Clean or Mark-VII DSP)
 * - Supports instant barge-in interruption, Mute / Push-to-Talk, and 1 FPS live screen frame sync
 */
export class GeminiLiveVoiceClient {
  private ws: WebSocket | null = null;
  private micStream: MediaStream | null = null;
  private inputCtx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private silentSinkNode: GainNode | null = null;

  private status: LiveVoiceStatus = 'IDLE';
  private muted = false;
  private dspEnabled = true;
  private lastVideoSentAt = 0;
  private callbacks: LiveVoiceCallbacks = {};

  public getStatus(): LiveVoiceStatus {
    return this.status;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(nextMuted: boolean): void {
    this.muted = nextMuted;
    if (nextMuted) {
      markViiAudio.setMicInputLevel(0);
      this.callbacks.onMicLevel?.(0);
    }
  }

  public setDspEnabled(enabled: boolean): void {
    this.dspEnabled = enabled;
  }

  private updateStatus(next: LiveVoiceStatus, detail?: string): void {
    this.status = next;
    this.callbacks.onStatusChange?.(next, detail);
  }

  public async start(params: StartLiveSessionParams): Promise<boolean> {
    this.stop();
    this.callbacks = params.callbacks || {};
    this.dspEnabled = params.dspEnabled;
    this.muted = false;

    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.updateStatus(
        'ERROR',
        'Captura de microfone não disponível neste navegador ou contexto.'
      );
      return false;
    }

    this.updateStatus('CONNECTING', 'A ligar ao canal de voz em direto (gemini-3.8-live)...');

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });
      this.micStream = micStream;
    } catch (err) {
      const msg = (err as Error).message || 'Permissão de microfone recusada.';
      this.updateStatus(
        'ERROR',
        `Não foi possível aceder ao microfone (${msg}). Verifica as permissões do navegador.`
      );
      return false;
    }

    const voice = normalizeGeminiVoiceName(params.voiceName);
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = new URLSearchParams({
      voice,
      projectId: params.projectId,
      chatId: params.chatId,
      lang: params.language,
    });
    const wsUrl = `${wsProto}//${window.location.host}/ws/live?${qs.toString()}`;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        this.setupMicAudioPipeline();
      };

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data || '{}')) as Record<string, unknown>;
        } catch {
          return;
        }

        const type = String(msg.type || '');
        if (type === 'session_ready') {
          if (this.dspEnabled) {
            markViiAudio.playMarkViiChime(true);
          }
          this.updateStatus('LIVE', `Conversa em direto ativa · Voz ${voice}`);
          if (!settled) {
            settled = true;
            resolve(true);
          }
          return;
        }

        if (type === 'audio' && typeof msg.audio === 'string') {
          markViiAudio.enqueuePcmChunk(msg.audio, 24000, this.dspEnabled);
          return;
        }

        if (type === 'interrupted') {
          markViiAudio.interruptPlayback();
          return;
        }

        if (type === 'input_transcript' && typeof msg.transcript === 'string') {
          this.callbacks.onInputTranscript?.(msg.transcript);
          return;
        }

        if (type === 'output_transcript' && typeof msg.transcript === 'string') {
          this.callbacks.onOutputTranscript?.(msg.transcript);
          return;
        }

        if (type === 'tool_executed' && msg.toolCall) {
          this.callbacks.onToolExecuted?.(
            msg.toolCall as ToolCallRecord,
            (msg.studioEvents as StudioInlineEvent[]) || []
          );
          return;
        }

        if (type === 'turn_complete') {
          this.callbacks.onTurnComplete?.(
            String(msg.userTranscript || ''),
            String(msg.assistantTranscript || '')
          );
          return;
        }

        if (type === 'idle_closed') {
          const reason = String(msg.message || 'Sessão pausada por inatividade.');
          this.stop();
          this.updateStatus('IDLE', reason);
          return;
        }

        if (type === 'error') {
          const errMsg = String(msg.message || 'Erro na sessão Gemini Live.');
          this.cleanupResources();
          this.updateStatus('ERROR', errMsg);
          if (!settled) {
            settled = true;
            resolve(false);
          }
        }
      };

      ws.onerror = () => {
        this.cleanupResources();
        this.updateStatus('ERROR', 'Falha na ligação WebSocket de voz em direto.');
        if (!settled) {
          settled = true;
          resolve(false);
        }
      };

      ws.onclose = () => {
        const wasLive = this.status === 'LIVE' || this.status === 'CONNECTING';
        this.cleanupResources();
        if (wasLive) {
          this.updateStatus('IDLE');
        }
        if (!settled) {
          settled = true;
          resolve(false);
        }
      };
    });
  }

  private setupMicAudioPipeline(): void {
    if (!this.micStream) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    let ctx: AudioContext;
    try {
      ctx = new AudioCtx({ sampleRate: 16000 });
    } catch {
      ctx = new AudioCtx();
    }
    this.inputCtx = ctx;

    const source = ctx.createMediaStreamSource(this.micStream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0; // Zero feedback to speakers while keeping ScriptProcessor ticking

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);

    this.sourceNode = source;
    this.processorNode = processor;
    this.silentSinkNode = silentGain;

    processor.onaudioprocess = (ev) => {
      if (this.muted || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const inputChannel = ev.inputBuffer.getChannelData(0);
      let sumSq = 0;
      for (let i = 0; i < inputChannel.length; i++) {
        sumSq += inputChannel[i] * inputChannel[i];
      }
      const rms = Math.min(1, Math.sqrt(sumSq / Math.max(1, inputChannel.length)) * 4.2);
      markViiAudio.setMicInputLevel(rms);
      this.callbacks.onMicLevel?.(rms);

      const pcm16kFloat = downsampleFloat32Buffer(inputChannel, ctx.sampleRate, 16000);
      const base64 = encodeFloat32ToPcm16Base64(pcm16kFloat);
      if (base64 && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'audio', audio: base64 }));
      }
    };
  }

  /**
   * Streams a live screen JPEG frame (throttled <= 1 FPS) into the active `gemini-3.8-live` session
   * so Jarvis sees the user's screen while conversing by voice.
   */
  public sendVideoFrame(jpegBase64: string, mimeType = 'image/jpeg'): void {
    if (!jpegBase64 || this.status !== 'LIVE' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const now = Date.now();
    if (now - this.lastVideoSentAt < 1000) {
      return;
    }
    this.lastVideoSentAt = now;
    this.ws.send(
      JSON.stringify({
        type: 'video',
        videoFrame: jpegBase64,
        mimeType,
      })
    );
  }

  public sendTextTurn(text: string): void {
    if (!text.trim() || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'text', text: text.trim() }));
  }

  private cleanupResources(): void {
    markViiAudio.interruptPlayback();
    markViiAudio.setMicInputLevel(0);

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      try {
        this.processorNode.disconnect();
      } catch {
        // Ignore
      }
      this.processorNode = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // Ignore
      }
      this.sourceNode = null;
    }

    if (this.silentSinkNode) {
      try {
        this.silentSinkNode.disconnect();
      } catch {
        // Ignore
      }
      this.silentSinkNode = null;
    }

    if (this.inputCtx) {
      this.inputCtx.close().catch(() => {});
      this.inputCtx = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }

    if (this.ws) {
      const ref = this.ws;
      this.ws = null;
      if (ref.readyState === WebSocket.OPEN || ref.readyState === WebSocket.CONNECTING) {
        try {
          ref.close(1000, 'Client stopped session');
        } catch {
          // Ignore
        }
      }
    }
  }

  public stop(): void {
    this.cleanupResources();
    if (this.status !== 'IDLE') {
      this.updateStatus('IDLE');
    }
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Sends a recorded microphone Blob (`audio/webm`, `audio/mp4`, `audio/ogg`, or `audio/wav`)
 * to the server's `POST /api/audio/transcribe` (`gemini-3.5-transcribe`) endpoint.
 */
export async function transcribeAudioBlobWithGemini(params: {
  blob: Blob;
  language: LanguageCode;
  projectId?: string;
  chatId?: string;
}): Promise<{ ok: boolean; transcript: string; latencyMs: number; error?: string }> {
  const arrayBuffer = await params.blob.arrayBuffer();
  const audioBase64 = arrayBufferToBase64(arrayBuffer);
  const resp = await fetch('/api/audio/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64,
      mimeType: params.blob.type || 'audio/webm',
      language: params.language,
      projectId: params.projectId,
      chatId: params.chatId,
    }),
  });
  const data = (await resp.json()) as {
    ok?: boolean;
    transcript?: string;
    latencyMs?: number;
    error?: string;
  };
  return {
    ok: Boolean(data.ok),
    transcript: (data.transcript || '').trim(),
    latencyMs: Number(data.latencyMs) || 0,
    error: data.error,
  };
}
