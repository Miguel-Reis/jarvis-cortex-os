import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Layers,
  Play,
  RefreshCw,
  Server,
  Sliders,
  Trash2,
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import {
  estimateMonthlyLlmCostEur,
  isLocalOpenAiCompatibleEndpoint,
  normalizeGeminiModelId,
} from '../../shared/cortex-math';
import type {
  AppSettings,
  BrainLiveStatus,
  JarvisStoreData,
  ModelProviderType,
  ServerApiKeysStatus,
  UpdateServerApiKeysPayload,
} from '../../shared/types';
import { useToast } from '../ToastContext';

export interface ProviderLiveProbeResult {
  ok: boolean;
  provider: ModelProviderType | string;
  latencyMs: number;
  detail: string;
  modelUsed?: string;
  endpointUsed?: string;
  sampleOutput?: string;
  discoveredModels?: string[];
  fallbackReady?: boolean;
  envKeysStatus?: {
    geminiConfigured: boolean;
    openRouterConfigured: boolean;
  };
}

interface LLMSettingsViewProps {
  store: JarvisStoreData;
  geminiAvailable: boolean;
  openRouterAvailable?: boolean;
  brain8765?: BrainLiveStatus;
  storageEngine?: string;
  onRefreshBootstrap: () => Promise<void>;
  embedded?: boolean;
}

const OPENAI_COMPAT_PRESETS: {
  label: string;
  endpoint: string;
  model: string;
  note: string;
}[] = [
  {
    label: 'OpenRouter Cloud',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct',
    note: 'Multi-modelo cloud (usa OPENROUTER_API_KEY no servidor)',
  },
  {
    label: 'LM Studio Local (:1234)',
    endpoint: 'http://127.0.0.1:1234/v1',
    model: 'qwen2.5-coder-7b-instruct',
    note: '100% local na tua máquina, sem necessidade de chave remota',
  },
  {
    label: 'vLLM / LiteLLM Local (:8000)',
    endpoint: 'http://127.0.0.1:8000/v1',
    model: 'Qwen/Qwen2.5-Coder-7B-Instruct',
    note: 'Servidor OpenAI-compatível local de alto débito',
  },
];

const OLLAMA_MODEL_PRESETS = [
  'qwen2.5-coder:7b',
  'llama3.3:latest',
  'deepseek-r1:8b',
  'gemma3:12b',
];

function formatEur(value: number): string {
  return `${value.toLocaleString('pt-PT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function getProviderDisplayName(provider: ModelProviderType | string): string {
  switch (provider) {
    case 'GEMINI_STUDIO':
      return 'Gemini Server SDK';
    case 'OPENROUTER_COMPAT':
      return 'OpenRouter / OpenAI Compatível';
    case 'OLLAMA_LOCAL':
      return 'Ollama Local HTTP';
    case 'LOCAL_DETERMINISTIC':
      return 'Motor Determinístico Nativo';
    default:
      return String(provider);
  }
}

export const LLMSettingsView: React.FC<LLMSettingsViewProps> = ({
  store,
  geminiAvailable,
  openRouterAvailable = false,
  brain8765,
  storageEngine = 'node:sqlite',
  onRefreshBootstrap,
  embedded = false,
}) => {
  const { pushToast } = useToast();

  // Draft states for non-secret model & endpoint parameters
  const [geminiModelDraft, setGeminiModelDraft] = useState<string>(() =>
    normalizeGeminiModelId(store.settings.preferredGeminiModel)
  );
  const [ollamaUrlDraft, setOllamaUrlDraft] = useState<string>(
    store.settings.ollamaEndpoint || 'http://127.0.0.1:11434'
  );
  const [ollamaModelDraft, setOllamaModelDraft] = useState<string>(
    store.settings.ollamaModel || 'qwen2.5-coder:7b'
  );
  const [openRouterUrlDraft, setOpenRouterUrlDraft] = useState<string>(
    store.settings.openRouterEndpoint || 'https://openrouter.ai/api/v1'
  );
  const [openRouterModelDraft, setOpenRouterModelDraft] = useState<string>(
    store.settings.openRouterModel || 'meta-llama/llama-3.3-70b-instruct'
  );

  // Live connectivity tester states
  const [testingSingle, setTestingSingle] = useState<ModelProviderType | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [probeMap, setProbeMap] = useState<Partial<Record<ModelProviderType, ProviderLiveProbeResult>>>({});
  const [geminiDiscovered, setGeminiDiscovered] = useState<
    { id: string; displayName: string; description?: string }[]
  >([]);
  const [loadingGeminiModels, setLoadingGeminiModels] = useState(false);
  const [geminiDiscoveryNote, setGeminiDiscoveryNote] = useState<string | null>(null);
  const [liveEnvStatus, setLiveEnvStatus] = useState<{
    geminiConfigured: boolean;
    openRouterConfigured: boolean;
  }>({
    geminiConfigured: geminiAvailable,
    openRouterConfigured: openRouterAvailable,
  });

  // Direct Server API Key Manager states (GEMINI_API_KEY & OPENROUTER_API_KEY)
  const [apiKeysStatus, setApiKeysStatus] = useState<ServerApiKeysStatus | null>(null);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [openRouterKeyInput, setOpenRouterKeyInput] = useState('');
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);
  const [persistToDotEnv, setPersistToDotEnv] = useState(true);
  const [savingApiKeys, setSavingApiKeys] = useState(false);
  const [apiKeySaveFeedback, setApiKeySaveFeedback] = useState<{
    ok: boolean;
    detail: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    apiJson<ServerApiKeysStatus>('/api/settings/api-keys')
      .then((status) => {
        if (!active) return;
        setApiKeysStatus(status);
        setLiveEnvStatus({
          geminiConfigured: status.geminiConfigured,
          openRouterConfigured: status.openRouterConfigured,
        });
      })
      .catch(() => {
        // Keep bootstrap props fallback
      });
    return () => {
      active = false;
    };
  }, []);

  // Antigravity MCP & Bridge helper states
  const [copiedMcpSnippet, setCopiedMcpSnippet] = useState(false);
  const [probingBridge, setProbingBridge] = useState(false);

  // Interactive Cost/Benefit estimator state
  const [promptsPerDay, setPromptsPerDay] = useState<number>(50);
  const [tokenDietSimEnabled, setTokenDietSimEnabled] = useState<boolean>(true);

  const activeProvider = store.settings.modelProvider;
  const isLocalOpenAi = isLocalOpenAiCompatibleEndpoint(openRouterUrlDraft);
  const externalBrainOnline = Boolean(brain8765?.httpOnline || brain8765?.sqliteWalDetected);

  const apiGeminiOptions = useMemo(
    () =>
      geminiDiscovered.map((apiModel) => ({
        id: apiModel.id,
        label:
          apiModel.displayName && apiModel.displayName !== apiModel.id
            ? `${apiModel.id} — ${apiModel.displayName}`
            : apiModel.id,
        summary:
          apiModel.description ||
          'Modelo ativo e verificado diretamente na tua GEMINI_API_KEY.',
      })),
    [geminiDiscovered]
  );

  const costEstimate = useMemo(
    () =>
      estimateMonthlyLlmCostEur({
        promptsPerDay,
        tokenDietEnabled: tokenDietSimEnabled,
      }),
    [promptsPerDay, tokenDietSimEnabled]
  );

  const mcpOrigin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'http://127.0.0.1:3000';

  const antigravityMcpSnippet = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            'jarvis-studio': {
              transport: 'streamable-http',
              url: `${mcpOrigin}/api/mcp`,
            },
          },
        },
        null,
        2
      ),
    [mcpOrigin]
  );

  const persistSettings = async (updates: Partial<AppSettings>, toastTitle?: string) => {
    await apiJson('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    await onRefreshBootstrap();
    if (toastTitle) {
      pushToast({ title: toastTitle, tone: 'success' });
    }
  };

  const handleSaveApiKeys = async (payload: UpdateServerApiKeysPayload) => {
    if (savingApiKeys) return;
    setSavingApiKeys(true);
    setApiKeySaveFeedback(null);
    try {
      const res = await apiJson<{
        ok: boolean;
        status: ServerApiKeysStatus;
        validation?: { ok: boolean; detail: string; latencyMs?: number } | null;
      }>('/api/settings/api-keys', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      setApiKeysStatus(res.status);
      setLiveEnvStatus({
        geminiConfigured: res.status.geminiConfigured,
        openRouterConfigured: res.status.openRouterConfigured,
      });

      if (payload.geminiApiKey !== undefined || payload.clearGeminiKey) {
        setGeminiKeyInput('');
        setShowGeminiKey(false);
      }
      if (payload.openRouterApiKey !== undefined || payload.clearOpenRouterKey) {
        setOpenRouterKeyInput('');
        setShowOpenRouterKey(false);
      }

      const persisted = payload.persistToDotEnv !== false;
      const validationDetail = res.validation
        ? `${res.validation.detail}${res.validation.latencyMs ? ` (${res.validation.latencyMs}ms)` : ''}`
        : payload.clearGeminiKey || payload.clearOpenRouterKey
          ? 'Chave removida da memória do servidor.'
          : `Chave atualizada${persisted ? ' e persistida no ficheiro .env local' : ' em memória runtime'}.`;

      const isOk = res.validation ? res.validation.ok : true;
      setApiKeySaveFeedback({ ok: isOk, detail: validationDetail });

      await onRefreshBootstrap();
      if (payload.geminiApiKey !== undefined || payload.clearGeminiKey) {
        await discoverGeminiModels(true, true);
      }

      pushToast({
        title: isOk ? 'Chave API atualizada no servidor' : 'Chave API guardada com aviso de validação',
        detail: validationDetail,
        tone: isOk ? 'success' : 'warning',
      });
    } catch (err) {
      const msg = (err as Error).message;
      setApiKeySaveFeedback({ ok: false, detail: msg });
      pushToast({
        title: 'Erro ao atualizar chave API',
        detail: msg,
        tone: 'error',
      });
    } finally {
      setSavingApiKeys(false);
    }
  };

  const discoverGeminiModels = async (silentToast = false, forceRefresh = true) => {
    setLoadingGeminiModels(true);
    try {
      const endpoint = forceRefresh
        ? '/api/settings/gemini-models?refresh=1'
        : '/api/settings/gemini-models';
      const res = await apiJson<{
        ok: boolean;
        models: { id: string; displayName: string; description?: string }[];
        detail: string;
        activeModel?: string;
      }>(endpoint);
      setGeminiDiscoveryNote(res.detail);
      setLiveEnvStatus((prev) => ({ ...prev, geminiConfigured: res.ok }));
      if (res.ok && res.models.length > 0) {
        setGeminiDiscovered(res.models);
        setGeminiModelDraft((prev) => {
          if (res.models.some((m) => m.id === prev)) return prev;
          return res.activeModel && res.models.some((m) => m.id === res.activeModel)
            ? res.activeModel
            : res.models[0].id;
        });
        if (!silentToast) {
          pushToast({
            title: `${res.models.length} modelos disponíveis na tua API`,
            detail: res.detail,
            tone: 'success',
          });
        }
      } else {
        setGeminiDiscovered([]);
        if (!silentToast) {
          pushToast({
            title: 'Descoberta de modelos Gemini',
            detail: res.detail,
            tone: res.ok ? 'info' : 'error',
          });
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      setGeminiDiscoveryNote(msg);
      if (!silentToast) {
        pushToast({
          title: 'Erro ao listar modelos Gemini',
          detail: msg,
          tone: 'error',
        });
      }
    } finally {
      setLoadingGeminiModels(false);
    }
  };

  useEffect(() => {
    void discoverGeminiModels(true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runProviderProbe = async (
    targetProvider: ModelProviderType,
    silentToast = false
  ): Promise<ProviderLiveProbeResult | null> => {
    setTestingSingle(targetProvider);
    try {
      const res = await apiJson<ProviderLiveProbeResult>('/api/settings/test-provider', {
        method: 'POST',
        body: JSON.stringify({
          provider: targetProvider,
          preferredGeminiModel: geminiModelDraft,
          ollamaEndpoint: ollamaUrlDraft,
          ollamaModel: ollamaModelDraft,
          openRouterEndpoint: openRouterUrlDraft,
          openRouterModel: openRouterModelDraft,
        }),
      });

      setProbeMap((prev) => ({ ...prev, [targetProvider]: res }));
      if (res.envKeysStatus) {
        setLiveEnvStatus(res.envKeysStatus);
      }
      if (targetProvider === 'GEMINI_STUDIO' && res.discoveredModels?.length) {
        setGeminiDiscovered((prev) =>
          prev.length > 0
            ? prev
            : res.discoveredModels!.map((id) => ({ id, displayName: id }))
        );
        setGeminiDiscoveryNote(`${res.discoveredModels.length} modelo(s) Gemini descobertos na tua API Key.`);
      }

      if (!silentToast) {
        pushToast({
          title: res.ok
            ? `${getProviderDisplayName(targetProvider)} operacional (${res.latencyMs}ms)`
            : `${getProviderDisplayName(targetProvider)} em modo fallback`,
          detail: res.detail,
          tone: res.ok ? 'success' : 'info',
        });
      }
      return res;
    } catch (err) {
      pushToast({
        title: 'Erro ao testar conectividade',
        detail: (err as Error).message,
        tone: 'error',
      });
      return null;
    } finally {
      setTestingSingle(null);
    }
  };

  const handleProbeAllProviders = async () => {
    if (testingAll) return;
    setTestingAll(true);
    try {
      const order: ModelProviderType[] = [
        'GEMINI_STUDIO',
        'OPENROUTER_COMPAT',
        'OLLAMA_LOCAL',
        'LOCAL_DETERMINISTIC',
      ];
      const results = await Promise.all(
        order.map((prov) =>
          apiJson<ProviderLiveProbeResult>('/api/settings/test-provider', {
            method: 'POST',
            body: JSON.stringify({
              provider: prov,
              preferredGeminiModel: geminiModelDraft,
              ollamaEndpoint: ollamaUrlDraft,
              ollamaModel: ollamaModelDraft,
              openRouterEndpoint: openRouterUrlDraft,
              openRouterModel: openRouterModelDraft,
            }),
          })
        )
      );

      const nextMap: Partial<Record<ModelProviderType, ProviderLiveProbeResult>> = {};
      let latestEnv = liveEnvStatus;
      for (const item of results) {
        nextMap[item.provider as ModelProviderType] = item;
        if (item.envKeysStatus) {
          latestEnv = item.envKeysStatus;
        }
        if (item.provider === 'GEMINI_STUDIO' && item.discoveredModels?.length) {
          setGeminiDiscovered((prev) =>
            prev.length > 0
              ? prev
              : item.discoveredModels!.map((id) => ({ id, displayName: id }))
          );
          setGeminiDiscoveryNote(
            `${item.discoveredModels.length} modelo(s) Gemini descobertos na tua API Key.`
          );
        }
      }
      setProbeMap(nextMap);
      setLiveEnvStatus(latestEnv);
      await onRefreshBootstrap();

      const onlineCount = results.filter((r) => r.ok).length;
      pushToast({
        title: `Diagnóstico concluído: ${onlineCount}/4 motores prontos`,
        detail: 'Latências reais medidas ponta-a-ponta a partir do servidor.',
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Falha no diagnóstico global',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setTestingAll(false);
    }
  };

  const handleSelectProvider = async (nextProvider: ModelProviderType) => {
    await persistSettings(
      { modelProvider: nextProvider },
      `Motor principal definido: ${getProviderDisplayName(nextProvider)}`
    );
    await runProviderProbe(nextProvider, true);
  };

  const handleSaveAllParameters = async (e: React.FormEvent) => {
    e.preventDefault();
    const safeGemini = normalizeGeminiModelId(geminiModelDraft);
    setGeminiModelDraft(safeGemini);
    await persistSettings(
      {
        preferredGeminiModel: safeGemini,
        ollamaEndpoint: ollamaUrlDraft.trim() || 'http://127.0.0.1:11434',
        ollamaModel: ollamaModelDraft.trim() || 'qwen2.5-coder:7b',
        openRouterEndpoint: openRouterUrlDraft.trim() || 'https://openrouter.ai/api/v1',
        openRouterModel: openRouterModelDraft.trim() || 'meta-llama/llama-3.3-70b-instruct',
      },
      'Parâmetros de modelos e endpoints guardados'
    );
  };

  const handleCopyMcpConfig = async () => {
    try {
      await navigator.clipboard.writeText(antigravityMcpSnippet);
      setCopiedMcpSnippet(true);
      setTimeout(() => setCopiedMcpSnippet(false), 2200);
      pushToast({
        title: 'Configuração MCP copiada',
        detail: 'Cola no mcp_config.json do Antigravity para usar a tua subscrição Google com o Jarvis.',
        tone: 'success',
      });
    } catch {
      pushToast({
        title: 'Não foi possível copiar automaticamente',
        detail: 'Seleciona o bloco JSON abaixo manualmente.',
        tone: 'info',
      });
    }
  };

  const handleProbeAntigravityBridge = async () => {
    setProbingBridge(true);
    try {
      const res = await apiJson<{ online: boolean; message: string }>('/api/memories/sync-brain', {
        method: 'POST',
      });
      await onRefreshBootstrap();
      pushToast({
        title: res.online ? 'Ponte Antigravity :8765 ligada' : 'Córtex Nativo autónomo ativo',
        detail: res.message,
        tone: res.online ? 'success' : 'info',
      });
    } finally {
      setProbingBridge(false);
    }
  };

  const activeProbe = probeMap[activeProvider];
  const ollamaDiscovered = probeMap.OLLAMA_LOCAL?.discoveredModels || [];

  const providerCards: {
    id: ModelProviderType;
    indexLabel: string;
    title: string;
    audience: string;
    costLine: string;
    summary: string;
    readyStateText: string;
    readyOk: boolean;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      id: 'GEMINI_STUDIO',
      indexLabel: '01',
      title: 'Gemini Server SDK',
      audience: 'Cloud Oficial · Multimodal & 18 Tools',
      costLine: '0,00 € (Free Tier) ou Pay-as-you-go',
      summary:
        'Raciocínio completo, visão de ecrã em tempo real e criação automática de Goals e sub-agentes via @google/genai no servidor.',
      readyStateText: liveEnvStatus.geminiConfigured
        ? `Credencial ativa no servidor · ${geminiModelDraft}`
        : 'Sem chave no servidor · Usa fallback determinístico',
      readyOk: liveEnvStatus.geminiConfigured,
      icon: Layers,
    },
    {
      id: 'OPENROUTER_COMPAT',
      indexLabel: '02',
      title: 'OpenRouter / OpenAI Local',
      audience: 'Multi-Modelo Cloud ou LM Studio / vLLM',
      costLine: isLocalOpenAi ? '0,00 € (Servidor Local)' : 'Pago ao token (Cloud)',
      summary:
        'Liga-te a dezenas de modelos na cloud via OpenRouter ou aponta sem chave para servidores locais compatíveis (LM Studio :1234, vLLM :8000).',
      readyStateText: isLocalOpenAi
        ? `Modo local sem chave · ${openRouterUrlDraft}`
        : liveEnvStatus.openRouterConfigured
          ? `Credencial ativa · ${openRouterModelDraft}`
          : 'Requer OPENROUTER_API_KEY ou URL local',
      readyOk: isLocalOpenAi || liveEnvStatus.openRouterConfigured,
      icon: Server,
    },
    {
      id: 'OLLAMA_LOCAL',
      indexLabel: '03',
      title: 'Ollama Local',
      audience: 'Inferência 100% Privada na Tua Máquina',
      costLine: '0,00 € · Sem envio de dados externos',
      summary:
        'Executa modelos abertos (Qwen 2.5 Coder, Llama 3.3, DeepSeek R1) localmente em 127.0.0.1:11434 usando a GPU/CPU do teu computador.',
      readyStateText: probeMap.OLLAMA_LOCAL
        ? probeMap.OLLAMA_LOCAL.ok
          ? `Daemon ativo · ${ollamaModelDraft}`
          : 'Daemon local desligado · Fallback pronto'
        : `${ollamaUrlDraft} · ${ollamaModelDraft}`,
      readyOk: Boolean(probeMap.OLLAMA_LOCAL?.ok),
      icon: HardDrive,
    },
    {
      id: 'LOCAL_DETERMINISTIC',
      indexLabel: '04',
      title: 'Motor Determinístico Nativo',
      audience: 'Zero-VRAM · 100% Offline · Instantâneo',
      costLine: '0,00 € · 0 GB VRAM · < 2 ms',
      summary:
        'Motor algorítmico nativo do Jarvis (Q-18 + JEV-S1 + HippoRAG + Sidecar). Estrutura Goals, sub-agentes e memória sem depender de redes ou GPUs.',
      readyStateText: 'Sempre disponível · 0 dependências externas',
      readyOk: true,
      icon: Cpu,
    },
  ];

  return (
    <div data-testid="llm-settings-view" className="space-y-8">
      {/* 1. Header & Real-Time Connectivity Command Bar */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-white/8">
        <div className="space-y-1.5 max-w-3xl">
          {!embedded && (
            <p className="text-xs font-medium text-[#e59a54]">
              Arquitetura Cognitiva · Cloud, Subscrição Antigravity & Modos Locais
            </p>
          )}
          <h2 className="text-xl sm:text-2xl font-bold text-slate-100 font-display tracking-tight">
            Configuração Unificada de Motores LLM & Custos
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Escolhe entre motores cloud (Gemini SDK, OpenRouter), inferência local privada (Ollama,
            LM Studio, Motor Determinístico Zero-VRAM) ou integração direta com a tua subscrição
            Google através do servidor MCP para Antigravity.
          </p>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1 text-xs text-slate-400 font-mono tabular-nums">
            <span>
              Ativo: <strong className="text-slate-200">{getProviderDisplayName(activeProvider)}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>Persistência: {storageEngine}</span>
            <span aria-hidden="true">·</span>
            <span>
              Fallback Determinístico: <strong className="text-emerald-400">Sempre Pronto</strong>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            data-testid="llm-test-active-btn"
            disabled={testingSingle !== null || testingAll}
            onClick={() => runProviderProbe(activeProvider)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[#e59a54] text-slate-950 hover:bg-[#eba868] transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
            <span>
              {testingSingle === activeProvider
                ? 'A testar ligação...'
                : 'Testar Motor Ativo'}
            </span>
          </button>

          <button
            type="button"
            data-testid="llm-test-all-btn"
            disabled={testingAll || testingSingle !== null}
            onClick={handleProbeAllProviders}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium bg-[#141821] border border-white/10 text-slate-200 hover:border-white/20 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testingAll ? 'animate-spin' : ''}`} />
            <span>{testingAll ? 'A sondar 4 motores...' : 'Testar Todos os Motores'}</span>
          </button>
        </div>
      </section>

      {/* Live Connectivity Telemetry Strip (Rendered immediately on test or on demand) */}
      {Object.keys(probeMap).length > 0 && (
        <section
          data-testid="llm-live-probe-results"
          className="studio-card rounded-xl p-5 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#e59a54] shrink-0" />
              <h3 className="text-sm font-semibold text-slate-100 font-display">
                Resultado do Teste de Conectividade em Tempo Real
              </h3>
            </div>
            {activeProbe && (
              <p className="text-xs font-mono tabular-nums text-slate-400">
                Última medição no motor ativo: <strong className="text-slate-200">{activeProbe.latencyMs} ms</strong>
              </p>
            )}
          </div>

          <div className="divide-y divide-white/6 border-t border-white/6">
            {(
              [
                'GEMINI_STUDIO',
                'OPENROUTER_COMPAT',
                'OLLAMA_LOCAL',
                'LOCAL_DETERMINISTIC',
              ] as ModelProviderType[]
            )
              .filter((prov) => Boolean(probeMap[prov]))
              .map((prov) => {
                const res = probeMap[prov]!;
                return (
                  <div
                    key={prov}
                    data-testid={`probe-row-${prov}`}
                    className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-semibold text-slate-100">
                          {getProviderDisplayName(prov)}
                        </span>
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span
                          className={`font-mono font-medium ${
                            res.ok ? 'text-emerald-400' : 'text-[#e59a54]'
                          }`}
                        >
                          {res.ok ? 'OPERACIONAL' : 'EM FALLBACK LOCAL'}
                        </span>
                        {res.modelUsed && (
                          <>
                            <span className="text-slate-600" aria-hidden="true">
                              ·
                            </span>
                            <span className="font-mono text-slate-400">{res.modelUsed}</span>
                          </>
                        )}
                      </div>
                      <p className="text-slate-300 leading-relaxed">{res.detail}</p>
                      {res.sampleOutput && (
                        <p className="font-mono text-[11px] text-slate-400 truncate">
                          Resposta: {res.sampleOutput}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                      <span className="text-slate-300 font-semibold">{res.latencyMs} ms</span>
                      {activeProvider !== prov && (
                        <button
                          type="button"
                          onClick={() => handleSelectProvider(prov)}
                          className="px-2.5 py-1 rounded-md bg-[#141821] border border-white/10 text-slate-200 hover:border-[#e59a54]/50 transition-colors whitespace-nowrap"
                        >
                          Usar este motor
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* 2. Mode Selector Grid (4 Primary Modes) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-200 font-display">
            01. Selecionar Modo de Operação Principal
          </h3>
          <span className="text-xs text-slate-400">
            Clica num modo para o ativar imediatamente
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {providerCards.map((card) => {
            const Icon = card.icon;
            const selected = activeProvider === card.id;
            const probe = probeMap[card.id];

            return (
              <div
                key={card.id}
                data-testid={`llm-mode-card-${card.id}`}
                className={`rounded-xl p-5 border transition-colors flex flex-col justify-between gap-4 ${
                  selected
                    ? 'bg-[#151a24] border-[#e59a54]/60'
                    : 'bg-[#10131a] border-white/8 hover:border-white/16'
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-xs text-slate-400 font-mono tabular-nums">
                        {card.indexLabel}. {card.audience}
                      </p>
                      <h4 className="text-base font-semibold text-slate-100 font-display">
                        {card.title}
                      </h4>
                    </div>
                    <Icon
                      className={`w-4 h-4 shrink-0 mt-1 ${
                        selected ? 'text-[#e59a54]' : 'text-slate-500'
                      }`}
                    />
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">{card.summary}</p>
                </div>

                <div className="pt-3 border-t border-white/6 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-mono tabular-nums text-slate-400 min-w-0">
                    <span className={card.readyOk ? 'text-emerald-400' : 'text-slate-400'}>
                      {card.costLine}
                    </span>
                    <span className="mx-1.5 text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="truncate">
                      {probe ? `${probe.ok ? 'Online' : 'Fallback'} (${probe.latencyMs}ms)` : card.readyStateText}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={testingSingle === card.id}
                      onClick={() => runProviderProbe(card.id)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#0b0d11] border border-white/10 text-slate-300 hover:text-slate-100 hover:border-white/20 transition-colors whitespace-nowrap"
                    >
                      {testingSingle === card.id ? 'A testar...' : 'Testar'}
                    </button>

                    <button
                      type="button"
                      data-testid={`activate-provider-${card.id}`}
                      onClick={() => handleSelectProvider(card.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                        selected
                          ? 'bg-[#e59a54]/18 border border-[#e59a54]/50 text-[#f3c394]'
                          : 'bg-[#e59a54] text-slate-950 hover:bg-[#eba868]'
                      }`}
                    >
                      {selected ? 'Modo Ativo' : 'Ativar Modo'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Parameters & Credentials Split: Cloud APIs vs Local Modes + Antigravity Subscription */}
      <form
        onSubmit={handleSaveAllParameters}
        className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
      >
        {/* Left Column: Cloud Providers & Server-Side Credentials */}
        <section className="lg:col-span-6 studio-card rounded-xl p-6 flex flex-col justify-between gap-5">
          <div className="space-y-5">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-100 font-display">
                02. Chaves API & Parâmetros Cloud
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Configura ou altera diretamente a tua <code className="font-mono text-slate-300">GEMINI_API_KEY</code>{' '}
                (e <code className="font-mono text-slate-300">OPENROUTER_API_KEY</code>) no servidor com hot-reload
                imediato e persistência opcional no <code className="font-mono text-slate-300">.env</code> local, mantendo
                todas as chamadas protegidas nas rotas <code className="font-mono text-slate-300">/api/*</code>.
              </p>
            </div>

            {/* Interactive Server API Keys Manager */}
            <div className="p-4 rounded-xl bg-[#0b0d11] border border-white/8 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <KeyRound className="w-3.5 h-3.5 text-[#e59a54] shrink-0" />
                  <span className="font-mono text-slate-300 truncate">GEMINI_API_KEY (Servidor)</span>
                  {apiKeysStatus?.geminiMaskedKey && (
                    <span className="font-mono text-[11px] text-slate-400 px-1.5 py-0.5 rounded bg-[#141821] border border-white/6">
                      {apiKeysStatus.geminiMaskedKey} · {apiKeysStatus.geminiKeySource}
                    </span>
                  )}
                </div>
                <span
                  data-testid="env-status-gemini"
                  className={`font-mono font-medium shrink-0 ${
                    liveEnvStatus.geminiConfigured ? 'text-emerald-400' : 'text-[#e59a54]'
                  }`}
                >
                  {liveEnvStatus.geminiConfigured ? 'Detetada e Pronta' : 'Ausente (Fallback Ativo)'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <input
                    id="llm-gemini-api-key-input"
                    data-testid="llm-gemini-api-key-input"
                    type={showGeminiKey ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    value={geminiKeyInput}
                    onChange={(e) => setGeminiKeyInput(e.target.value)}
                    placeholder={
                      liveEnvStatus.geminiConfigured
                        ? 'Substituir GEMINI_API_KEY (AIzaSy...)'
                        : 'Inserir GEMINI_API_KEY (AIzaSy...)'
                    }
                    className="w-full pl-3 pr-8 py-1.5 text-xs font-mono bg-[#141821] border border-white/10 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#e59a54]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey((prev) => !prev)}
                    aria-label={showGeminiKey ? 'Ocultar chave Gemini' : 'Mostrar chave Gemini'}
                    className="absolute right-2 top-1.5 p-0.5 text-slate-400 hover:text-slate-100"
                  >
                    {showGeminiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="save-gemini-api-key-btn"
                  disabled={savingApiKeys || !geminiKeyInput.trim()}
                  onClick={() =>
                    handleSaveApiKeys({
                      geminiApiKey: geminiKeyInput.trim(),
                      persistToDotEnv,
                      validateNow: true,
                    })
                  }
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#e59a54] text-[#0b0d11] hover:bg-[#f0ac6b] disabled:opacity-45 transition-colors whitespace-nowrap"
                >
                  {savingApiKeys ? 'A validar...' : 'Guardar & Validar Gemini'}
                </button>

                {liveEnvStatus.geminiConfigured && (
                  <button
                    type="button"
                    data-testid="clear-gemini-api-key-btn"
                    disabled={savingApiKeys}
                    onClick={() =>
                      handleSaveApiKeys({
                        clearGeminiKey: true,
                        persistToDotEnv,
                      })
                    }
                    title="Remover GEMINI_API_KEY do servidor"
                    aria-label="Remover GEMINI_API_KEY"
                    className="p-1.5 rounded-lg bg-[#141821] border border-white/10 text-slate-400 hover:text-rose-400 hover:border-rose-400/40 disabled:opacity-45 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* OpenRouter API Key Section */}
              <div className="pt-2.5 border-t border-white/6 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-slate-300 truncate">OPENROUTER_API_KEY (Servidor)</span>
                    {apiKeysStatus?.openRouterMaskedKey && (
                      <span className="font-mono text-[11px] text-slate-400 px-1.5 py-0.5 rounded bg-[#141821] border border-white/6">
                        {apiKeysStatus.openRouterMaskedKey} · {apiKeysStatus.openRouterKeySource}
                      </span>
                    )}
                  </div>
                  <span
                    data-testid="env-status-openrouter"
                    className={`font-mono font-medium shrink-0 ${
                      liveEnvStatus.openRouterConfigured
                        ? 'text-emerald-400'
                        : isLocalOpenAi
                          ? 'text-slate-300'
                          : 'text-slate-500'
                    }`}
                  >
                    {liveEnvStatus.openRouterConfigured
                      ? 'Detetada e Pronta'
                      : isLocalOpenAi
                        ? 'Opcional em URL local'
                        : 'Não definida'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <input
                      id="llm-openrouter-api-key-input"
                      data-testid="llm-openrouter-api-key-input"
                      type={showOpenRouterKey ? 'text' : 'password'}
                      autoComplete="off"
                      spellCheck={false}
                      value={openRouterKeyInput}
                      onChange={(e) => setOpenRouterKeyInput(e.target.value)}
                      placeholder="Inserir / substituir OPENROUTER_API_KEY (sk-or-...)"
                      className="w-full pl-3 pr-8 py-1.5 text-xs font-mono bg-[#141821] border border-white/10 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#e59a54]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowOpenRouterKey((prev) => !prev)}
                      aria-label={
                        showOpenRouterKey ? 'Ocultar chave OpenRouter' : 'Mostrar chave OpenRouter'
                      }
                      className="absolute right-2 top-1.5 p-0.5 text-slate-400 hover:text-slate-100"
                    >
                      {showOpenRouterKey ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <button
                    type="button"
                    data-testid="save-openrouter-api-key-btn"
                    disabled={savingApiKeys || !openRouterKeyInput.trim()}
                    onClick={() =>
                      handleSaveApiKeys({
                        openRouterApiKey: openRouterKeyInput.trim(),
                        persistToDotEnv,
                      })
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#181d28] border border-white/10 text-slate-200 hover:border-[#e59a54]/50 disabled:opacity-45 transition-colors whitespace-nowrap"
                  >
                    Guardar OpenRouter
                  </button>

                  {liveEnvStatus.openRouterConfigured && (
                    <button
                      type="button"
                      data-testid="clear-openrouter-api-key-btn"
                      disabled={savingApiKeys}
                      onClick={() =>
                        handleSaveApiKeys({
                          clearOpenRouterKey: true,
                          persistToDotEnv,
                        })
                      }
                      title="Remover OPENROUTER_API_KEY do servidor"
                      aria-label="Remover OPENROUTER_API_KEY"
                      className="p-1.5 rounded-lg bg-[#141821] border border-white/10 text-slate-400 hover:text-rose-400 hover:border-rose-400/40 disabled:opacity-45 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-white/6 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={persistToDotEnv}
                    onChange={(e) => setPersistToDotEnv(e.target.checked)}
                    className="rounded border-slate-700 bg-[#141821]"
                  />
                  <span>Persistir no ficheiro .env local</span>
                </label>

                <button
                  type="button"
                  onClick={async () => {
                    await discoverGeminiModels(true, true);
                    await runProviderProbe(activeProvider);
                  }}
                  className="font-medium text-[#e59a54] hover:text-[#eba868] whitespace-nowrap"
                >
                  Testar Ligação Agora
                </button>
              </div>

              {apiKeySaveFeedback && (
                <p
                  data-testid="api-key-save-feedback"
                  className={`text-[11px] font-mono ${
                    apiKeySaveFeedback.ok ? 'text-emerald-400' : 'text-amber-300'
                  }`}
                >
                  {apiKeySaveFeedback.detail}
                </p>
              )}
            </div>

            {/* Gemini Model Selection — Strictly API-Verified Models */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="llm-gemini-model-select"
                  className="block text-xs font-medium text-slate-300"
                >
                  Modelos Disponíveis na tua API (@google/genai)
                </label>
                <button
                  type="button"
                  onClick={() => discoverGeminiModels(false, true)}
                  disabled={loadingGeminiModels}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#0b0d11] border border-white/10 text-[11px] font-medium text-[#e59a54] hover:border-[#e59a54]/60 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingGeminiModels ? 'animate-spin' : ''}`} />
                  {loadingGeminiModels ? 'A consultar API...' : 'Atualizar Lista da API'}
                </button>
              </div>
              <select
                id="llm-gemini-model-select"
                value={apiGeminiOptions.length > 0 ? geminiModelDraft : ''}
                disabled={loadingGeminiModels || apiGeminiOptions.length === 0}
                onChange={async (e) => {
                  const chosen = e.target.value;
                  setGeminiModelDraft(chosen);
                  if (chosen) {
                    await persistSettings(
                      { preferredGeminiModel: chosen },
                      `Modelo Gemini ativo: ${chosen}`
                    );
                  }
                }}
                className="w-full px-3 py-2 text-xs font-mono bg-[#0b0d11] border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:border-[#e59a54] disabled:opacity-60"
              >
                {apiGeminiOptions.length === 0 ? (
                  <option value="">
                    {loadingGeminiModels
                      ? 'A consultar modelos compatíveis na tua GEMINI_API_KEY...'
                      : 'Nenhum modelo carregado — insere a GEMINI_API_KEY acima e clica Atualizar'}
                  </option>
                ) : (
                  apiGeminiOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))
                )}
              </select>
              {apiGeminiOptions.length > 0 && (
                <p className="text-[11px] text-slate-400">
                  {apiGeminiOptions.find((o) => o.id === geminiModelDraft)?.summary}
                </p>
              )}
              {geminiDiscoveryNote && (
                <p
                  className={`text-[11px] font-mono ${
                    apiGeminiOptions.length > 0 ? 'text-emerald-400/90' : 'text-amber-400/90'
                  }`}
                >
                  {geminiDiscoveryNote}
                </p>
              )}
            </div>

            {/* OpenRouter / OpenAI-Compatible Endpoint & Presets */}
            <div className="space-y-2.5 pt-2 border-t border-white/6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="llm-openrouter-url"
                  className="text-xs font-medium text-slate-300"
                >
                  Endpoint OpenRouter / OpenAI Compatível
                </label>
                <div className="flex flex-wrap items-center gap-1">
                  {OPENAI_COMPAT_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setOpenRouterUrlDraft(preset.endpoint);
                        setOpenRouterModelDraft(preset.model);
                      }}
                      className="px-2 py-0.5 rounded bg-[#0b0d11] border border-white/8 text-[11px] text-slate-300 hover:border-[#e59a54]/50 transition-colors whitespace-nowrap"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <input
                id="llm-openrouter-url"
                type="text"
                value={openRouterUrlDraft}
                onChange={(e) => setOpenRouterUrlDraft(e.target.value)}
                placeholder="https://openrouter.ai/api/v1 ou http://127.0.0.1:1234/v1"
                className="w-full px-3 py-2 text-xs font-mono bg-[#0b0d11] border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:border-[#e59a54]"
              />

              <div>
                <label
                  htmlFor="llm-openrouter-model"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Identificador do Modelo (OpenRouter / Local)
                </label>
                <input
                  id="llm-openrouter-model"
                  type="text"
                  value={openRouterModelDraft}
                  onChange={(e) => setOpenRouterModelDraft(e.target.value)}
                  placeholder="meta-llama/llama-3.3-70b-instruct"
                  className="w-full px-3 py-2 text-xs font-mono bg-[#0b0d11] border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:border-[#e59a54]"
                />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-white/6 flex items-center justify-end">
            <button
              type="submit"
              data-testid="save-llm-params-btn"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[#e59a54] text-slate-950 hover:bg-[#eba868] transition-colors whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Guardar Modelos & Endpoints</span>
            </button>
          </div>
        </section>

        {/* Right Column: Local Ollama + Google Subscription via Antigravity MCP */}
        <section className="lg:col-span-6 studio-card rounded-xl p-6 flex flex-col justify-between gap-5">
          <div className="space-y-5">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-100 font-display">
                03. Modos Locais & Subscrição Google no Antigravity
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Corre modelos localmente sem custos por token ou liga o Antigravity ao Gateway MCP
                do Jarvis para tirares partido da tua subscrição Google pessoal de forma 100% oficial.
              </p>
            </div>

            {/* Ollama Local Configuration */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="llm-ollama-endpoint"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Endpoint Ollama Local
                  </label>
                  <input
                    id="llm-ollama-endpoint"
                    type="text"
                    value={ollamaUrlDraft}
                    onChange={(e) => setOllamaUrlDraft(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-[#0b0d11] border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:border-[#e59a54]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="llm-ollama-model"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Modelo Local Ollama
                  </label>
                  <input
                    id="llm-ollama-model"
                    type="text"
                    value={ollamaModelDraft}
                    onChange={(e) => setOllamaModelDraft(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-[#0b0d11] border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:border-[#e59a54]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-400 mr-1">
                  {ollamaDiscovered.length > 0 ? 'Instalados em /api/tags:' : 'Sugestões locais:'}
                </span>
                {(ollamaDiscovered.length > 0 ? ollamaDiscovered.slice(0, 5) : OLLAMA_MODEL_PRESETS).map(
                  (mdl) => (
                    <button
                      key={mdl}
                      type="button"
                      onClick={() => setOllamaModelDraft(mdl)}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-colors whitespace-nowrap ${
                        ollamaModelDraft === mdl
                          ? 'bg-[#e59a54]/16 border-[#e59a54]/50 text-[#f3c394]'
                          : 'bg-[#0b0d11] border-white/8 text-slate-300 hover:border-white/20'
                      }`}
                    >
                      {mdl}
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Antigravity Personal Google Subscription Bridge */}
            <div className="pt-4 border-t border-white/6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-semibold text-slate-100">
                    Usar a Tua Subscrição Google via Antigravity (Servidor MCP)
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    A Google separa o login OAuth de consumidor das chaves de API externas, mas o
                    Antigravity liga-se nativamente ao Jarvis por MCP dando-te as 18 tools, Goals e
                    memória HippoRAG incluídos no teu plano.
                  </p>
                </div>
              </div>

              <pre className="p-3 rounded-lg bg-[#0b0d11] border border-white/8 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                {antigravityMcpSnippet}
              </pre>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-mono text-slate-400">
                  Ponte Brain :8765:{' '}
                  <strong className={externalBrainOnline ? 'text-emerald-400' : 'text-slate-300'}>
                    {externalBrainOnline ? 'Sincronizada' : 'Modo Nativo Autónomo'}
                  </strong>
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={probingBridge}
                    onClick={handleProbeAntigravityBridge}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#0b0d11] border border-white/10 text-slate-300 hover:text-slate-100 transition-colors whitespace-nowrap"
                  >
                    {probingBridge ? 'A sondar :8765...' : 'Sondar Ponte :8765'}
                  </button>

                  <button
                    type="button"
                    data-testid="copy-antigravity-mcp-btn"
                    onClick={handleCopyMcpConfig}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#141821] border border-white/12 text-slate-100 hover:border-[#e59a54]/50 transition-colors whitespace-nowrap"
                  >
                    {copiedMcpSnippet ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>JSON Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-[#e59a54]" />
                        <span>Copiar MCP JSON</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </form>

      {/* 4. Clear Cost / Benefit Matrix & Interactive Monthly Token Diet Simulator */}
      <section
        data-testid="llm-cost-benefit-section"
        className="studio-card rounded-xl p-6 space-y-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-4 border-b border-white/8">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-100 font-display">
              04. Matriz Comparativa de Custo / Benefício & Poupança Token Diet
            </h3>
            <p className="text-xs text-slate-400">
              Simula o teu volume diário de mensagens para comparar custos mensais reais, latência,
              privacidade e acesso a visão de ecrã.
            </p>
          </div>

          {/* Interactive Volume & Token Diet Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs">
              <Sliders className="w-3.5 h-3.5 text-[#e59a54]" />
              <span className="text-slate-400">Mensagens/dia:</span>
              {[20, 50, 150, 400].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setPromptsPerDay(val)}
                  className={`px-2.5 py-1 rounded-md font-mono tabular-nums transition-colors ${
                    promptsPerDay === val
                      ? 'bg-[#e59a54] text-slate-950 font-semibold'
                      : 'bg-[#0b0d11] border border-white/8 text-slate-300 hover:text-slate-100'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={tokenDietSimEnabled}
                onChange={(e) => setTokenDietSimEnabled(e.target.checked)}
                className="accent-[#e59a54]"
              />
              <span>Token Diet 5-Fases (-82% input)</span>
            </label>
          </div>
        </div>

        {/* Quantitative Token Diet Impact Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-1 text-xs font-mono tabular-nums">
          <div>
            <p className="text-slate-400 font-sans">Volume Mensal Simulado</p>
            <p className="text-base font-semibold text-slate-100 mt-0.5">
              {costEstimate.promptsPerMonth.toLocaleString('pt-PT')} interações/mês
            </p>
          </div>
          <div>
            <p className="text-slate-400 font-sans">Tokens de Contexto Enviados</p>
            <p className="text-base font-semibold text-slate-100 mt-0.5">
              {(costEstimate.monthlyInputTokensEffective / 1000).toFixed(0)}k tok{' '}
              <span className="text-slate-500 font-normal">
                (bruto: {(costEstimate.monthlyInputTokensRaw / 1000).toFixed(0)}k)
              </span>
            </p>
          </div>
          <div>
            <p className="text-slate-400 font-sans">Tokens Poupados pelo Jarvis</p>
            <p className="text-base font-semibold text-emerald-400 mt-0.5">
              {(costEstimate.monthlyTokensSavedByDiet / 1000).toFixed(0)}k tokens/mês
            </p>
          </div>
        </div>

        {/* Comparison Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="py-2.5 pr-4 font-medium">Opção / Motor</th>
                <th className="py-2.5 pr-4 font-medium">Visão de Ecrã & Tools</th>
                <th className="py-2.5 pr-4 font-medium">Privacidade & Hardware</th>
                <th className="py-2.5 pr-4 font-medium">Melhor Cenário de Uso</th>
                <th className="py-2.5 text-right font-medium">Custo Mensal Estimado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              <tr className="hover:bg-white/3">
                <td className="py-3 pr-4 font-semibold text-slate-100 whitespace-nowrap">
                  Gemini API · Escalão Gratuito
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  Completa (Stream WebRTC + 18 Tools)
                </td>
                <td className="py-3 pr-4 text-slate-400">
                  Cloud Google · 0 GB VRAM local
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  {costEstimate.withinGeminiFreeTierQuota
                    ? 'Uso pessoal diário sem cartão bancário (dentro da quota gratuita)'
                    : 'Acima de ~250/dia recomenda-se Flash-Lite ou Pay-as-you-go'}
                </td>
                <td className="py-3 text-right font-mono tabular-nums font-semibold text-emerald-400 whitespace-nowrap">
                  {costEstimate.withinGeminiFreeTierQuota
                    ? '0,00 €'
                    : `~${formatEur(costEstimate.geminiFlashLitePaidEur)}`}
                </td>
              </tr>

              <tr className="hover:bg-white/3">
                <td className="py-3 pr-4 font-semibold text-slate-100 whitespace-nowrap">
                  Gemini 3.8 Flash · Pay-as-you-go
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  Completa · Quotas altas de produção
                </td>
                <td className="py-3 pr-4 text-slate-400">
                  Dados privados (não treinam modelos no tier pago)
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  Equipas, sessões intensivas com visão contínua de ecrã e enxames
                </td>
                <td className="py-3 text-right font-mono tabular-nums font-semibold text-slate-100 whitespace-nowrap">
                  {formatEur(costEstimate.geminiFlashPaidEur)}
                </td>
              </tr>

              <tr className="hover:bg-white/3">
                <td className="py-3 pr-4 font-semibold text-slate-100 whitespace-nowrap">
                  Subscrição Google via Antigravity MCP
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  18 Tools MCP + Goals + Memória HippoRAG
                </td>
                <td className="py-3 pr-4 text-slate-400">
                  Usa a tua conta oficial no Antigravity + Jarvis local
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  Aproveitar a subscrição Google Pro/Ultra que já pagas sem custos extra de API
                </td>
                <td className="py-3 text-right font-mono tabular-nums font-semibold text-emerald-400 whitespace-nowrap">
                  0,00 € extra
                </td>
              </tr>

              <tr className="hover:bg-white/3">
                <td className="py-3 pr-4 font-semibold text-slate-100 whitespace-nowrap">
                  OpenRouter Cloud (Multi-Modelo)
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  Chat + Planeamento multi-fornecedor
                </td>
                <td className="py-3 pr-4 text-slate-400">
                  Cloud externa · 0 GB VRAM local
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  Alternar entre Llama 3.3, Claude, Qwen ou DeepSeek numa só conta
                </td>
                <td className="py-3 text-right font-mono tabular-nums font-semibold text-slate-200 whitespace-nowrap">
                  {formatEur(costEstimate.openRouterCloudEur)}
                </td>
              </tr>

              <tr className="hover:bg-white/3">
                <td className="py-3 pr-4 font-semibold text-slate-100 whitespace-nowrap">
                  Ollama / LM Studio Local
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  Geração local + Fallback Sidecar
                </td>
                <td className="py-3 pr-4 text-slate-400">
                  100% Local · Requer 6–16 GB RAM/VRAM
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  Privacidade absoluta em código proprietário sem tráfego externo
                </td>
                <td className="py-3 text-right font-mono tabular-nums font-semibold text-emerald-400 whitespace-nowrap">
                  0,00 €
                </td>
              </tr>

              <tr className="hover:bg-white/3">
                <td className="py-3 pr-4 font-semibold text-slate-100 whitespace-nowrap">
                  Motor Determinístico Nativo Jarvis
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  Goals, Sub-Agentes, AST, Q-18 & Sidecar
                </td>
                <td className="py-3 pr-4 text-slate-400">
                  100% Offline · 0 GB VRAM · &lt; 2 ms
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  Operação instantânea offline, poupança total de bateria e rede de segurança
                </td>
                <td className="py-3 text-right font-mono tabular-nums font-semibold text-emerald-400 whitespace-nowrap">
                  0,00 €
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
