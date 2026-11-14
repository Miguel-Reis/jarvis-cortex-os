import type http from 'node:http';
import { type LiveServerMessage, Modality } from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';
import {
  GEMINI_VOICE_CATALOG,
  isGeneralUnlinkedChat,
  normalizeGeminiVoiceName,
  rankQ18Actions,
  resolveProjectAgentsList,
} from '../shared/cortex-math.ts';
import {
  GENERAL_CHAT_PROJECT_ID,
  type GeminiVoiceName,
  type LanguageCode,
  type StudioInlineEvent,
  type ToolCallRecord,
} from '../shared/types.ts';
import { db } from './db.ts';
import { debugLog } from './debug-logger.ts';
import {
  AGENT_TOOL_DECLARATIONS,
  emitStudioActivity,
  executeAgentTool,
  getGeminiClient,
  getPersonalityDirective,
  resolveUsableGeminiModel,
  type StudioExecutionContext,
} from './gemini-engine.ts';

/**
 * Exposes all J.A.R.V.I.S. Cortex OS agent tools to the Live Voice Principal Agent,
 * granting omniscient control over projects, chats, operations, governed files, Swarm, MCP, and Python CLI.
 */
export const LIVE_VOICE_TOOL_DECLARATIONS = AGENT_TOOL_DECLARATIONS;

const LIVE_IDLE_TIMEOUT_MS = 180_000; // 3 min auto-idle disconnect to protect audio quota

export interface AudioTranscriptionParams {
  audioBase64: string;
  mimeType?: string;
  language?: LanguageCode;
  projectId?: string;
  chatId?: string;
}

export interface AudioTranscriptionResult {
  ok: boolean;
  transcript: string;
  modelUsed: string;
  latencyMs: number;
  error?: string;
}

/**
 * High-accuracy server-side audio transcription using `gemini-3.5-transcribe`.
 * Preserves European Portuguese (PT-PT) mixed with English technical software vocabulary.
 */
export async function transcribeAudioServerSide(
  params: AudioTranscriptionParams
): Promise<AudioTranscriptionResult> {
  const t0 = performance.now();
  const cleanBase64 = (params.audioBase64 || '').trim();
  if (!cleanBase64) {
    return {
      ok: false,
      transcript: '',
      modelUsed: 'gemini-3.5-transcribe',
      latencyMs: 1,
      error: 'Áudio vazio.',
    };
  }

  const ai = getGeminiClient();
  if (!ai) {
    return {
      ok: false,
      transcript: '',
      modelUsed: 'gemini-3.5-transcribe',
      latencyMs: Math.max(1, Math.round(performance.now() - t0)),
      error:
        'GEMINI_API_KEY não configurada no servidor. Configura a chave em Motores LLM > Chaves API (GEMINI_API_KEY) ou utiliza o ditado local do navegador.',
    };
  }

  const state = db.getState();
  const lang: LanguageCode = params.language || state.settings.language || 'pt-PT';
  const rawMime = (params.mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';

  const instructionPrompt =
    lang === 'pt-PT'
      ? 'Transcreve fielmente este áudio falado em Português de Portugal (PT-PT), preservando termos técnicos em inglês (como React, TypeScript, MCP, HippoRAG, Sidecar, SQLite, Goals, API, Stripe, Tailwind). Devolve APENAS o texto transcrito limpo e pontuado, sem aspas nem comentários adicionais. Se o áudio contiver apenas silêncio ou ruído sem fala, devolve uma string vazia.'
      : 'Accurately transcribe this spoken audio in English, preserving software engineering terminology. Return ONLY the clean punctuated transcript with no extra commentary. If there is only silence or background noise, return an empty string.';

  const resolvedStt = await resolveUsableGeminiModel(state.settings.preferredGeminiModel);
  const sttModelIds = Array.from(
    new Set([
      resolvedStt.model,
      ...resolvedStt.discovered.filter((m) => /flash/i.test(m.id)).map((m) => m.id),
    ])
  ).slice(0, 3);
  const candidateModels: { id: string; prompt: string; raceMs: number }[] = sttModelIds.map(
    (id) => ({
      id,
      prompt: instructionPrompt,
      raceMs: 11000,
    })
  );

  let lastErrMsg = '';

  for (const candidate of candidateModels) {
    let attemptTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const sttPromise = ai.models.generateContent({
        model: candidate.id,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: rawMime,
                data: cleanBase64,
              },
            },
            {
              text: candidate.prompt,
            },
          ],
        },
        config: {
          httpOptions: { timeout: 12000 },
        },
      });

      const timeoutGuard = new Promise<never>((_, reject) => {
        attemptTimer = setTimeout(
          () => reject(new Error('STT_ATTEMPT_TIMEOUT')),
          candidate.raceMs
        );
      });

      const response = await Promise.race([sttPromise, timeoutGuard]).finally(() => {
        if (attemptTimer) clearTimeout(attemptTimer);
      });

      const transcript = (response.text ?? '').trim();
      if (!transcript && cleanBase64.length > 4000 && candidate.id === 'gemini-3.5-transcribe') {
        continue;
      }

      const latencyMs = Math.max(1, Math.round(performance.now() - t0));

      if (params.projectId && transcript) {
        emitStudioActivity({
          projectId: params.projectId,
          chatId: params.chatId || state.activeChatId || 'chat-web-main',
          actor: state.settings.operatorName || 'Operador',
          kind: 'AUDIO_TRANSCRIBE',
          status: 'SUCCESS',
          summary: `Áudio transcrito (${candidate.id} · ${latencyMs}ms)`,
          detail: transcript.slice(0, 180),
          durationMs: latencyMs,
        });
      }

      return {
        ok: true,
        transcript,
        modelUsed: candidate.id,
        latencyMs,
      };
    } catch (err) {
      lastErrMsg = (err as Error).message || 'Falha ao transcrever áudio.';
      debugLog(
        'WARN',
        'VOICE-STT',
        `${candidate.id} transcription attempt warning: ${lastErrMsg.slice(0, 140)}`
      );
    }
  }

  const latencyMs = Math.max(1, Math.round(performance.now() - t0));
  return {
    ok: false,
    transcript: '',
    modelUsed: 'gemini-3.5-transcribe',
    latencyMs,
    error: lastErrMsg || 'Falha ao transcrever áudio.',
  };
}

export interface VoicePreviewParams {
  voiceName?: string;
  language?: LanguageCode;
  customText?: string;
}

export interface VoicePreviewResult {
  ok: boolean;
  voiceName: GeminiVoiceName;
  sampleText: string;
  audioBase64?: string;
  mimeType?: string;
  modelUsed: string;
  latencyMs: number;
  fallbackLocal?: boolean;
  detail?: string;
}

/**
 * Generates a real voice preview clip using `gemini-3.8-flash-lite-tts` with the selected
 * `prebuiltVoiceConfig.voiceName` (`Charon`, `Zephyr`, `Kore`, `Fenrir`, `Puck`),
 * returning unary 24kHz WAV base64 audio (with graceful local fallback if offline).
 */
export async function synthesizeVoicePreviewServerSide(
  params: VoicePreviewParams
): Promise<VoicePreviewResult> {
  const t0 = performance.now();
  const state = db.getState();
  const voiceName = normalizeGeminiVoiceName(
    params.voiceName || state.settings.preferredVoiceName
  );
  const lang: LanguageCode = params.language || state.settings.language || 'pt-PT';
  const voiceMeta =
    GEMINI_VOICE_CATALOG.find((v) => v.id === voiceName) || GEMINI_VOICE_CATALOG[0];

  const defaultSamplePt: Record<GeminiVoiceName, string> = {
    Charon:
      'Sistemas acústicos calibrados, Comandante. Sou a voz Charon do Estúdio Jarvis, pronta para planear os teus projetos em tempo real.',
    Zephyr:
      'Olá! Aqui fala a voz Zephyr no Estúdio Jarvis. Vamos estruturar ideias, objetivos e agentes de forma fluida.',
    Kore: 'Ligação estabelecida. Voz Kore ativa com clareza analítica para rever arquitetura, código e métricas do projeto.',
    Fenrir:
      'Canal tático Fenrir operacional. Pronto para executar objetivos, inspecionar o ecrã e coordenar sub-agentes.',
    Puck: 'Tudo a postos! Voz Puck ligada para explorarmos novas ideias criativas, interfaces e funcionalidades em direto.',
  };

  const defaultSampleEn: Record<GeminiVoiceName, string> = {
    Charon:
      'Acoustic systems calibrated, Commander. Charon voice online and ready to plan your projects in real time.',
    Zephyr:
      'Hello! Zephyr voice active in Jarvis Studio. Ready for natural brainstorming and project planning.',
    Kore: 'Connection established. Kore voice active for crisp architecture and code review.',
    Fenrir: 'Fenrir tactical voice online. Ready to execute project goals and inspect your live screen.',
    Puck: 'All set! Puck voice connected and ready to explore creative product ideas together.',
  };

  const sampleText =
    (params.customText || '').trim() ||
    (lang === 'pt-PT' ? defaultSamplePt[voiceName] : defaultSampleEn[voiceName]);

  const ai = getGeminiClient();
  if (!ai) {
    return {
      ok: false,
      voiceName,
      sampleText,
      modelUsed: 'local-mark-vii-fallback',
      latencyMs: Math.max(1, Math.round(performance.now() - t0)),
      fallbackLocal: true,
      detail: `GEMINI_API_KEY ausente — a reproduzir amostra local para ${voiceMeta.label}.`,
    };
  }

  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ttsPromise = ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: sampleText,
              speechMetadata: {
                style:
                  lang === 'pt-PT'
                    ? 'Natural, articulate European Portuguese studio co-pilot'
                    : 'Natural, articulate executive studio co-pilot',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('TTS_PREVIEW_TIMEOUT')), 7500);
    });

    const response = await Promise.race([ttsPromise, timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
    });

    const base64Audio =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || '';
    const latencyMs = Math.max(1, Math.round(performance.now() - t0));

    if (!base64Audio) {
      return {
        ok: false,
        voiceName,
        sampleText,
        modelUsed: 'gemini-3.8-flash-lite-tts',
        latencyMs,
        fallbackLocal: true,
        detail: 'Resposta sem stream de áudio — a usar síntese local.',
      };
    }

    return {
      ok: true,
      voiceName,
      sampleText,
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
      modelUsed: 'gemini-3.8-flash-lite-tts',
      latencyMs,
      detail: `Voz ${voiceMeta.label} (${voiceMeta.badgePt}) gerada em ${latencyMs}ms.`,
    };
  } catch (err) {
    const rawMsg = (err as Error).message || 'Erro TTS';
    debugLog('WARN', 'VOICE-TTS', `Voice preview fallback (${voiceName}): ${rawMsg}`);
    return {
      ok: false,
      voiceName,
      sampleText,
      modelUsed: 'local-mark-vii-fallback',
      latencyMs: Math.max(1, Math.round(performance.now() - t0)),
      fallbackLocal: true,
      detail: `Serviço TTS ocupado (${rawMsg.slice(0, 50)}) — amostra reproduzida localmente.`,
    };
  }
}

interface ClientWsIncomingMessage {
  type?: 'audio' | 'video' | 'text' | 'ping';
  audio?: string; // 16kHz 16-bit LE PCM base64
  videoFrame?: string; // JPEG base64 (max 1 FPS)
  mimeType?: string;
  text?: string;
}

function safeWsSend(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Ignore closed socket race
    }
  }
}

/**
 * Attaches the bidirectional Gemini Live API (`gemini-3.8-live`) WebSocket bridge on `/ws/live`.
 * Streams 16kHz PCM mic + 1 FPS live screen frames -> Gemini Live -> 24kHz PCM voice + live transcripts + Studio tools.
 */
export function attachGeminiLiveWebSocketServer(params: {
  httpServer: http.Server;
  activePort: number;
  broadcastSse: (event: string, payload: unknown) => void;
}): WebSocketServer {
  const { httpServer, activePort, broadcastSse } = params;
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const host = request.headers.host || `localhost:${activePort}`;
      const parsedUrl = new URL(request.url || '/', `http://${host}`);
      if (parsedUrl.pathname !== '/ws/live') {
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (clientWs: WebSocket, request: http.IncomingMessage) => {
    const host = request.headers.host || `localhost:${activePort}`;
    const parsedUrl = new URL(request.url || '/ws/live', `http://${host}`);

    const stateSnapshot = db.getState();
    const voiceName: GeminiVoiceName = normalizeGeminiVoiceName(
      parsedUrl.searchParams.get('voice') || stateSnapshot.settings.preferredVoiceName
    );
    const rawProjectId =
      parsedUrl.searchParams.get('projectId') ||
      stateSnapshot.activeProjectId ||
      'proj-website-studio';
    const chatId =
      parsedUrl.searchParams.get('chatId') ||
      stateSnapshot.activeChatId ||
      'chat-web-main';
    const lang: LanguageCode =
      (parsedUrl.searchParams.get('lang') as LanguageCode) ||
      stateSnapshot.settings.language ||
      'pt-PT';

    const ai = getGeminiClient();
    if (!ai) {
      safeWsSend(clientWs, {
        type: 'error',
        code: 'NO_GEMINI_KEY',
        message:
          'GEMINI_API_KEY não detetada no servidor. Configura a chave em Motores LLM > Chaves API (GEMINI_API_KEY) para ativar conversas em tempo real com gemini-3.8-live.',
      });
      clientWs.close(1008, 'Missing GEMINI_API_KEY');
      return;
    }

    const activeChatObj = (stateSnapshot.chatThreads || []).find((c) => c.id === chatId);
    const isGeneralSession =
      rawProjectId === GENERAL_CHAT_PROJECT_ID ||
      (activeChatObj ? isGeneralUnlinkedChat(activeChatObj) : false);
    const projectId = isGeneralSession ? GENERAL_CHAT_PROJECT_ID : rawProjectId;

    const activeProject = isGeneralSession
      ? null
      : (stateSnapshot.projects || []).find((p) => p.id === projectId) ||
        (stateSnapshot.projects || [])[0] ||
        null;

    const projectGoals = isGeneralSession
      ? []
      : stateSnapshot.goals
          .filter((g) => (g.projectId || projectId) === projectId)
          .slice(0, 6);

    const projectAgents = resolveProjectAgentsList(stateSnapshot.rooms, activeProject);
    const portfolioSummary = (stateSnapshot.projects || [])
      .map((p) => `${p.name} [${p.id}]`)
      .join(', ');
    const pendingApprovals = stateSnapshot.approvals.filter((a) => a.status === 'PENDING');
    const topQ18 = rankQ18Actions(stateSnapshot.candidates || [])[0];
    const activeMcpServersCount = (stateSnapshot.mcpServers || []).filter((s) => s.enabled).length;

    const personality = getPersonalityDirective(
      stateSnapshot.settings.personalityMode,
      lang
    );

    const liveSystemInstruction = [
      personality,
      `Estás em modo de CONVERSA DE VOZ EM TEMPO REAL (gemini-3.8-live) como AGENTE PRINCIPAL do J.A.R.V.I.S. Cortex OS com ${
        stateSnapshot.settings.operatorName || 'o Operador'
      }.`,
      isGeneralSession
        ? 'Contexto atual: Conversa Geral Livre (Sem Projeto Associado). Tens acesso omnisciente a todo o sistema J.A.R.V.I.S. OS, todos os projetos, sub-agentes, memórias e operações.'
        : activeProject
          ? `Projeto ativo: "${activeProject.name}" [${activeProject.id}] (${activeProject.ideaCategory || 'CUSTOM'} · Stack: ${activeProject.techStack}). Resumo: ${activeProject.ideaBrief || activeProject.description}`
          : '',
      portfolioSummary ? `Projetos no portefólio: ${portfolioSummary}.` : '',
      projectAgents.length > 0
        ? `Agentes & Sub-Agentes disponíveis: ${projectAgents.map((a) => `${a.name} (${a.callsign})`).join(', ')}.`
        : '',
      !isGeneralSession && projectGoals.length > 0
        ? `Goals atuais do projeto: ${projectGoals
            .map((g) => `"${g.title}" (${g.progress}%, ${g.status})`)
            .join(' | ')}.`
        : !isGeneralSession
          ? 'Ainda sem Goals criados neste projeto.'
          : '',
      `Snapshot operacional J.A.R.V.I.S. OS: ${pendingApprovals.length} autorização(ões) pendente(s) | ${(stateSnapshot.contracts || []).length} Today Contract(s) | Workflows: ${(stateSnapshot.workflows || []).length} | MCP Servers ativos: ${activeMcpServersCount} | Dispositivos Sidecar: ${(stateSnapshot.devices || []).length}${
        topQ18 ? ` | Prioridade Q-18: "${topQ18.title}"` : ''
      }.`,
      'Tens acesso TOTAL a todas as 22 ferramentas do J.A.R.V.I.S. OS, incluindo get_jarvis_os_full_state, manage_jarvis_projects_and_chats, manage_jarvis_operations, write_workspace_file_governed, query_python_jarvis_cortex, request_shell_approval, sidecar_host_control, dispatch_swarm_48x, lookup_ast_symbol, call_mcp_gateway_tool, upsert_project_goal, spawn_project_subagent, search_memories e save_memory.',
      'REGRA DE AUTORIZAÇÃO HUMANA: Nunca tentes contornar o Security Gate. Sempre que uma ferramenta devolver PENDING_APPROVAL ou colocar uma ação na fila de autorização, avisa imediatamente o operador por voz de que surgiu um alerta de autorização no ecrã a aguardar confirmação.',
      'Regras para conversa por voz: Fala de forma natural, calorosa, concisa e fluida (2 a 4 frases por turno, sem ler listas longas de markdown nem símbolos como asteriscos). Se o utilizador partilhar o ecrã em direto, usa e descreve o que estás realmente a ver.',
    ]
      .filter(Boolean)
      .join('\n');

    const liveTools = LIVE_VOICE_TOOL_DECLARATIONS;

    let closed = false;
    let currentInputTranscript = '';
    let currentOutputTranscript = '';
    let turnToolCalls: ToolCallRecord[] = [];
    let turnStudioEvents: StudioInlineEvent[] = [];
    let receivedVideoFrames = 0;
    let lastVideoSentAt = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (closed) return;
        safeWsSend(clientWs, {
          type: 'idle_closed',
          message:
            'Sessão Live pausada automaticamente após 3 minutos sem atividade para poupar quota.',
        });
        clientWs.close(1000, 'Idle timeout');
      }, LIVE_IDLE_TIMEOUT_MS);
    };

    resetIdleTimer();

    debugLog(
      'INFO',
      'LIVE-WS',
      `Opening gemini-3.8-live session (voice=${voiceName}, project=${projectId}, chat=${chatId})`
    );

    emitStudioActivity({
      projectId,
      chatId,
      actor: `Jarvis Live (${voiceName})`,
      kind: 'VOICE_LIVE',
      status: 'RUNNING',
      summary: `Sessão de voz em direto iniciada · Voz ${voiceName} (gemini-3.8-live)`,
      detail: activeProject
        ? `Projeto: ${activeProject.name}`
        : 'Conversa Geral · Acesso Total Cortex OS',
      durationMs: 1,
    });

    const sessionPromise = ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: liveTools }],
        systemInstruction: liveSystemInstruction,
      },
      callbacks: {
        onopen: () => {
          safeWsSend(clientWs, {
            type: 'session_ready',
            model: 'gemini-3.8-live',
            voiceName,
            projectId,
            chatId,
          });
        },
        onmessage: async (message: LiveServerMessage) => {
          if (closed) return;
          resetIdleTimer();

          const content = message.serverContent;

          // 1. Stream 24kHz 16-bit LE PCM audio chunks back to browser
          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              safeWsSend(clientWs, {
                type: 'audio',
                audio: part.inlineData.data,
              });
            }
          }

          // 2. Barge-in interruption handling
          if (content?.interrupted) {
            safeWsSend(clientWs, { type: 'interrupted' });
          }

          // 3. Real-time user & model audio transcriptions
          if (content?.inputTranscription?.text) {
            currentInputTranscript += content.inputTranscription.text;
            safeWsSend(clientWs, {
              type: 'input_transcript',
              delta: content.inputTranscription.text,
              transcript: currentInputTranscript.trim(),
            });
          }

          if (content?.outputTranscription?.text) {
            currentOutputTranscript += content.outputTranscription.text;
            safeWsSend(clientWs, {
              type: 'output_transcript',
              delta: content.outputTranscription.text,
              transcript: currentOutputTranscript.trim(),
            });
          }

          // 4. Live Function Calling (Goals, Sub-Agents, Antigravity Skills, MCP, Sidecar Vision)
          const functionCalls = message.toolCall?.functionCalls ?? [];
          if (functionCalls.length > 0) {
            const studioCtx: StudioExecutionContext = {
              projectId,
              chatId,
              actor: `Jarvis Live (${voiceName})`,
              agentId: 'room-exec',
              agentCallsign: 'CORE-EXEC',
              isSubagent: false,
              isLiveVoice: true,
              studioEventsOut: [],
            };

            const functionResponses: {
              id?: string;
              name?: string;
              response: Record<string, unknown>;
            }[] = [];

            for (const call of functionCalls) {
              const fnName = call.name || '';
              const fnArgs = (call.args as Record<string, unknown>) || {};
              const execRes = await executeAgentTool(
                fnName,
                fnArgs,
                activePort,
                studioCtx
              );
              turnToolCalls.push(execRes.record);
              functionResponses.push({
                id: call.id,
                name: fnName,
                response: { result: execRes.rawResult },
              });

              safeWsSend(clientWs, {
                type: 'tool_executed',
                toolCall: execRes.record,
                studioEvents: studioCtx.studioEventsOut,
              });
            }

            turnStudioEvents.push(...studioCtx.studioEventsOut);
            broadcastSse('state_updated', { section: 'live_voice_tools' });

            sessionPromise
              .then((session) => {
                if (!closed) {
                  session.sendToolResponse({ functionResponses });
                }
              })
              .catch((err) => {
                debugLog(
                  'WARN',
                  'LIVE-WS',
                  `sendToolResponse warning: ${(err as Error).message}`
                );
              });
          }

          // 5. Turn complete -> persist spoken exchange into active Studio chat & Logs
          if (content?.turnComplete) {
            const cleanUser = currentInputTranscript.trim();
            const cleanJarvis = currentOutputTranscript.trim();

            if (cleanUser || cleanJarvis || turnStudioEvents.length > 0) {
              const nowIso = new Date().toISOString();
              const capturedEvents = [...turnStudioEvents];
              const capturedTools = [...turnToolCalls];
              const hadScreen = receivedVideoFrames > 0;

              db.update((draft) => {
                if (cleanUser) {
                  draft.messages.push({
                    id: `msg-live-u-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                    roomId: 'room-exec',
                    chatId,
                    projectId,
                    role: 'user',
                    content: cleanUser,
                    createdAt: nowIso,
                    screenIncluded: hadScreen,
                  });
                }
                if (cleanJarvis || capturedEvents.length > 0) {
                  draft.messages.push({
                    id: `msg-live-a-${Date.now() + 1}-${Math.random().toString(36).slice(2, 5)}`,
                    roomId: 'room-exec',
                    chatId,
                    projectId,
                    agentName: `Jarvis (${voiceName})`,
                    role: 'assistant',
                    content:
                      cleanJarvis ||
                      'Ações do projeto atualizadas durante a conversa de voz em direto.',
                    createdAt: nowIso,
                    engineUsed: `gemini-3.8-live (${voiceName})`,
                    screenIncluded: hadScreen,
                    toolCalls: capturedTools.length > 0 ? capturedTools : undefined,
                    studioEvents: capturedEvents.length > 0 ? capturedEvents : undefined,
                  });
                }
              });

              emitStudioActivity({
                projectId,
                chatId,
                actor: `Jarvis Live (${voiceName})`,
                kind: 'VOICE_LIVE',
                status: 'SUCCESS',
                summary: cleanJarvis
                  ? `Turno de voz concluído: "${cleanJarvis.slice(0, 95)}${
                      cleanJarvis.length > 95 ? '…' : ''
                    }"`
                  : 'Turno de voz com execução de ferramentas concluído',
                detail: cleanUser ? `Ouvido: "${cleanUser.slice(0, 120)}"` : undefined,
              });

              broadcastSse('state_updated', { section: 'live_voice_turn' });
            }

            safeWsSend(clientWs, {
              type: 'turn_complete',
              userTranscript: cleanUser,
              assistantTranscript: cleanJarvis,
            });

            currentInputTranscript = '';
            currentOutputTranscript = '';
            turnToolCalls = [];
            turnStudioEvents = [];
          }
        },
        onerror: (err: unknown) => {
          const msg =
            err instanceof Error
              ? err.message
              : typeof err === 'object' && err !== null && 'message' in err
                ? String((err as { message: unknown }).message)
                : 'Erro na ligação Gemini Live';
          debugLog('WARN', 'LIVE-WS', `Gemini Live session error: ${msg}`);
          safeWsSend(clientWs, {
            type: 'error',
            code: 'LIVE_SESSION_ERROR',
            message: msg,
          });
        },
        onclose: () => {
          if (!closed) {
            safeWsSend(clientWs, { type: 'session_closed' });
            clientWs.close(1000, 'Gemini Live session closed');
          }
        },
      },
    });

    sessionPromise.catch((err) => {
      const msg = (err as Error).message || 'Não foi possível abrir sessão gemini-3.8-live.';
      debugLog('WARN', 'LIVE-WS', `ai.live.connect failed: ${msg}`);
      safeWsSend(clientWs, {
        type: 'error',
        code: 'LIVE_CONNECT_FAILED',
        message: msg,
      });
      clientWs.close(1011, 'Upstream connect failed');
    });

    clientWs.on('message', (rawData) => {
      if (closed) return;
      resetIdleTimer();

      let parsed: ClientWsIncomingMessage;
      try {
        parsed = JSON.parse(rawData.toString()) as ClientWsIncomingMessage;
      } catch {
        return;
      }

      if (parsed.type === 'ping') {
        safeWsSend(clientWs, { type: 'pong', ts: Date.now() });
        return;
      }

      sessionPromise
        .then((session) => {
          if (closed) return;

          // 16kHz 16-bit LE PCM audio chunk
          if (parsed.audio) {
            session.sendRealtimeInput({
              audio: {
                data: parsed.audio,
                mimeType: 'audio/pcm;rate=16000',
              },
            });
          }

          // Synchronized Live Screen JPEG frame (enforced <= 1 FPS per Gemini Live rules)
          if (parsed.videoFrame) {
            const now = Date.now();
            if (now - lastVideoSentAt >= 950) {
              lastVideoSentAt = now;
              receivedVideoFrames += 1;
              session.sendRealtimeInput({
                video: {
                  data: parsed.videoFrame,
                  mimeType: parsed.mimeType || 'image/jpeg',
                },
              });
            }
          }

          // Optional inline text prompt during a Live voice session
          if (parsed.text && parsed.text.trim()) {
            session.sendRealtimeInput({
              text: parsed.text.trim(),
            });
          }
        })
        .catch(() => {});
    });

    const cleanupSession = () => {
      if (closed) return;
      closed = true;
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      sessionPromise
        .then((session) => {
          try {
            session.close();
          } catch {
            // Ignore close race
          }
        })
        .catch(() => {});
      debugLog('INFO', 'LIVE-WS', `Closed gemini-3.8-live session (voice=${voiceName})`);
    };

    clientWs.on('close', cleanupSession);
    clientWs.on('error', cleanupSession);
  });

  return wss;
}
