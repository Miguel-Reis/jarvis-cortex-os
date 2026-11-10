import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Code2,
  Edit3,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import { useToast } from '../ToastContext';
import type { NavSectionId } from '../../lib/i18n';
import type {
  McpCustomServer,
  McpLibraryCategory,
  McpRegistryResourceItem,
  McpRegistryToolItem,
  McpStandardLibraryItem,
  McpTransportType,
} from '../../shared/types';

interface McpGatewaySummary {
  totalTools: number;
  activeTools: number;
  healthyTools: number;
  jevEligibleCount: number;
  totalResources: number;
  activeResources: number;
  healthyResources: number;
  totalServers: number;
  onlineServers: number;
  pendingAuthServers: number;
  avgLatencyMs: number;
}

interface McpGatewayPayload {
  protocolVersion: string;
  tools: McpRegistryToolItem[];
  resources: McpRegistryResourceItem[];
  servers: McpCustomServer[];
  standardLibrary: McpStandardLibraryItem[];
  summary: McpGatewaySummary;
}

interface McpGatewayViewProps {
  onRefreshBootstrap: () => Promise<void>;
  onNavigate?: (section: NavSectionId) => void;
}

type GatewayTab = 'registry' | 'servers' | 'library' | 'console';
type RegistryFilter = 'ALL' | 'TOOLS' | 'RESOURCES' | 'ISSUES';
type LibraryFilter = 'ALL' | McpLibraryCategory;

const CATEGORY_LABELS: Record<McpLibraryCategory | 'CUSTOM', string> = {
  CORE_LOCAL: 'Core Local',
  WEB_SEARCH: 'Pesquisa & Web',
  CLOUD_DEVOPS: 'Engenharia & Cloud',
  PRODUCTIVITY: 'Produtividade',
  CUSTOM: 'Personalizado',
};

const TRANSPORT_LABELS: Record<McpTransportType, string> = {
  HTTP_STREAMABLE: 'HTTP Streamable',
  SSE: 'SSE Stream',
  STDIO: 'stdio Governado',
};

export const McpGatewayView: React.FC<McpGatewayViewProps> = ({
  onRefreshBootstrap,
  onNavigate,
}) => {
  const { pushToast } = useToast();

  const [data, setData] = useState<McpGatewayPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [probingAll, setProbingAll] = useState(false);
  const [probingServerId, setProbingServerId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const [activeTab, setActiveTab] = useState<GatewayTab>('registry');
  const [registryFilter, setRegistryFilter] = useState<RegistryFilter>('ALL');
  const [registrySearch, setRegistrySearch] = useState('');

  const [libraryCategory, setLibraryCategory] = useState<LibraryFilter>('ALL');
  const [librarySearch, setLibrarySearch] = useState('');
  const [installingLibId, setInstallingLibId] = useState<string | null>(null);

  // Tool Add / Edit Modal State
  const [toolModalOpen, setToolModalOpen] = useState(false);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [toolName, setToolName] = useState('');
  const [toolTitle, setToolTitle] = useState('');
  const [toolDesc, setToolDesc] = useState('');
  const [toolSchemaJson, setToolSchemaJson] = useState(
    '{\n  "type": "object",\n  "properties": {\n    "query": { "type": "string" }\n  }\n}'
  );
  const [toolMockResponse, setToolMockResponse] = useState('{"status":"ok","source":"custom-mcp"}');
  const [toolReadOnly, setToolReadOnly] = useState(true);
  const [toolIdempotent, setToolIdempotent] = useState(true);
  const [toolDestructive, setToolDestructive] = useState(false);
  const [toolJevEligible, setToolJevEligible] = useState(true);

  // Resource Add / Edit Modal State
  const [resModalOpen, setResModalOpen] = useState(false);
  const [editingResId, setEditingResId] = useState<string | null>(null);
  const [resUri, setResUri] = useState('brain://custom/');
  const [resName, setResName] = useState('');
  const [resDesc, setResDesc] = useState('');
  const [resMime, setResMime] = useState('application/json');
  const [resPayload, setResPayload] = useState('{\n  "status": "nominal"\n}');

  // Custom / Library Server Modal State
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [selectedLibraryPreset, setSelectedLibraryPreset] = useState<McpStandardLibraryItem | null>(
    null
  );
  const [srvName, setSrvName] = useState('');
  const [srvDesc, setSrvDesc] = useState('');
  const [srvTransport, setSrvTransport] = useState<McpTransportType>('HTTP_STREAMABLE');
  const [srvEndpoint, setSrvEndpoint] = useState('http://127.0.0.1:3000/api/mcp');
  const [srvCommand, setSrvCommand] = useState('npx');
  const [srvArgs, setSrvArgs] = useState('-y @modelcontextprotocol/server-filesystem .');
  const [srvEnvPairs, setSrvEnvPairs] = useState<{ key: string; value: string }[]>([]);
  const [savingServer, setSavingServer] = useState(false);

  // JSON-RPC 2.0 Console State
  const [rpcMethod, setRpcMethod] = useState<string>('tools/call');
  const [rpcParamsText, setRpcParamsText] = useState<string>(
    JSON.stringify({ name: 'brain_stats', arguments: {} }, null, 2)
  );
  const [rpcRunning, setRpcRunning] = useState(false);
  const [rpcElapsedMs, setRpcElapsedMs] = useState<number | null>(null);
  const [rpcResultText, setRpcResultText] = useState<string>('');

  const loadGateway = useCallback(async () => {
    try {
      const res = await apiJson<McpGatewayPayload>('/api/mcp/gateway');
      setData(res);
    } catch (err) {
      pushToast({
        title: 'Erro ao carregar Gateway MCP 2026',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    loadGateway();
  }, [loadGateway]);

  const handleProbeAll = async () => {
    setProbingAll(true);
    try {
      const updated = await apiJson<McpGatewayPayload>('/api/mcp/gateway/probe-all', {
        method: 'POST',
      });
      setData(updated);
      await onRefreshBootstrap();
      pushToast({
        title: 'Sonda Global MCP concluída',
        detail: `${updated.summary.healthyTools}/${updated.summary.activeTools} tools saudáveis · Latência média ${updated.summary.avgLatencyMs} ms`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Falha na sonda global', detail: (err as Error).message, tone: 'error' });
    } finally {
      setProbingAll(false);
    }
  };

  const handleResetDefaults = async () => {
    try {
      const updated = await apiJson<McpGatewayPayload>('/api/mcp/gateway/reset-defaults', {
        method: 'POST',
      });
      setData(updated);
      setConfirmReset(false);
      await onRefreshBootstrap();
      pushToast({
        title: 'Catálogo nativo reposto',
        detail: '18 ferramentas e 6 recursos brain:// restaurados de fábrica.',
        tone: 'info',
      });
    } catch (err) {
      pushToast({ title: 'Erro ao repor catálogo', detail: (err as Error).message, tone: 'error' });
    }
  };

  // Tool Actions
  const handleToggleTool = async (
    tool: McpRegistryToolItem,
    field: 'enabled' | 'jevEligible'
  ) => {
    try {
      const res = await apiJson<{ overview: McpGatewayPayload }>(
        `/api/mcp/gateway/tools/${tool.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ [field]: !tool[field] }),
        }
      );
      setData(res.overview);
      await onRefreshBootstrap();
    } catch (err) {
      pushToast({ title: 'Erro ao atualizar tool', detail: (err as Error).message, tone: 'error' });
    }
  };

  const handleDeleteTool = async (tool: McpRegistryToolItem) => {
    try {
      const res = await apiJson<{ overview: McpGatewayPayload }>(
        `/api/mcp/gateway/tools/${tool.id}`,
        { method: 'DELETE' }
      );
      setData(res.overview);
      await onRefreshBootstrap();
      pushToast({ title: `Ferramenta ${tool.name} removida`, tone: 'info' });
    } catch (err) {
      pushToast({ title: 'Erro ao remover tool', detail: (err as Error).message, tone: 'error' });
    }
  };

  const openCreateToolModal = () => {
    setEditingToolId(null);
    setToolName('');
    setToolTitle('');
    setToolDesc('');
    setToolSchemaJson(
      '{\n  "type": "object",\n  "properties": {\n    "query": { "type": "string" }\n  }\n}'
    );
    setToolMockResponse('{"status":"ok","verified":true}');
    setToolReadOnly(true);
    setToolIdempotent(true);
    setToolDestructive(false);
    setToolJevEligible(true);
    setToolModalOpen(true);
  };

  const openEditToolModal = (tool: McpRegistryToolItem) => {
    setEditingToolId(tool.id);
    setToolName(tool.name);
    setToolTitle(tool.title);
    setToolDesc(tool.description);
    setToolSchemaJson(JSON.stringify(tool.inputSchema, null, 2));
    setToolMockResponse(tool.mockResponseJson || '{"status":"ok"}');
    setToolReadOnly(tool.annotations.readOnlyHint);
    setToolIdempotent(tool.annotations.idempotentHint);
    setToolDestructive(tool.annotations.destructiveHint);
    setToolJevEligible(tool.jevEligible);
    setToolModalOpen(true);
  };

  const handleSaveTool = async (e: React.FormEvent) => {
    e.preventDefault();
    let parsedSchema: Record<string, unknown>;
    try {
      parsedSchema = JSON.parse(toolSchemaJson);
    } catch {
      pushToast({ title: 'Schema JSON inválido', detail: 'Verifica a sintaxe JSON do inputSchema.', tone: 'error' });
      return;
    }

    try {
      if (editingToolId) {
        const res = await apiJson<{ overview: McpGatewayPayload }>(
          `/api/mcp/gateway/tools/${editingToolId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              title: toolTitle,
              description: toolDesc,
              inputSchema: parsedSchema,
              jevEligible: toolJevEligible,
              mockResponseJson: toolMockResponse,
              annotations: {
                title: toolTitle || toolName,
                readOnlyHint: toolReadOnly,
                idempotentHint: toolIdempotent,
                destructiveHint: toolDestructive,
                openWorldHint: false,
              },
            }),
          }
        );
        setData(res.overview);
        pushToast({ title: `Ferramenta ${toolName} atualizada`, tone: 'success' });
      } else {
        const res = await apiJson<{ overview: McpGatewayPayload }>('/api/mcp/gateway/tools', {
          method: 'POST',
          body: JSON.stringify({
            name: toolName,
            title: toolTitle || toolName,
            description: toolDesc,
            inputSchema: parsedSchema,
            readOnlyHint: toolReadOnly,
            idempotentHint: toolIdempotent,
            destructiveHint: toolDestructive,
            jevEligible: toolJevEligible,
            mockResponseJson: toolMockResponse,
          }),
        });
        setData(res.overview);
        pushToast({ title: `Ferramenta ${toolName} adicionada ao Gateway`, tone: 'success' });
      }
      setToolModalOpen(false);
      await onRefreshBootstrap();
    } catch (err) {
      pushToast({ title: 'Falha ao guardar ferramenta', detail: (err as Error).message, tone: 'error' });
    }
  };

  // Resource Actions
  const handleToggleResource = async (resItem: McpRegistryResourceItem) => {
    try {
      const res = await apiJson<{ overview: McpGatewayPayload }>(
        `/api/mcp/gateway/resources/${resItem.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !resItem.enabled }),
        }
      );
      setData(res.overview);
      await onRefreshBootstrap();
    } catch (err) {
      pushToast({ title: 'Erro ao atualizar recurso', detail: (err as Error).message, tone: 'error' });
    }
  };

  const handleDeleteResource = async (resItem: McpRegistryResourceItem) => {
    try {
      const res = await apiJson<{ overview: McpGatewayPayload }>(
        `/api/mcp/gateway/resources/${resItem.id}`,
        { method: 'DELETE' }
      );
      setData(res.overview);
      await onRefreshBootstrap();
      pushToast({ title: `Recurso ${resItem.uri} removido`, tone: 'info' });
    } catch (err) {
      pushToast({ title: 'Erro ao remover recurso', detail: (err as Error).message, tone: 'error' });
    }
  };

  const openCreateResModal = () => {
    setEditingResId(null);
    setResUri('brain://custom/status');
    setResName('');
    setResDesc('');
    setResMime('application/json');
    setResPayload('{\n  "service": "jarvis-mcp",\n  "status": "nominal"\n}');
    setResModalOpen(true);
  };

  const openEditResModal = (resItem: McpRegistryResourceItem) => {
    setEditingResId(resItem.id);
    setResUri(resItem.uri);
    setResName(resItem.name);
    setResDesc(resItem.description);
    setResMime(resItem.mimeType);
    setResPayload(resItem.staticPayload || '');
    setResModalOpen(true);
  };

  const handleSaveResource = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingResId) {
        const res = await apiJson<{ overview: McpGatewayPayload }>(
          `/api/mcp/gateway/resources/${editingResId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name: resName,
              description: resDesc,
              mimeType: resMime,
              staticPayload: resPayload,
            }),
          }
        );
        setData(res.overview);
        pushToast({ title: `Recurso ${resUri} atualizado`, tone: 'success' });
      } else {
        const res = await apiJson<{ overview: McpGatewayPayload }>('/api/mcp/gateway/resources', {
          method: 'POST',
          body: JSON.stringify({
            uri: resUri,
            name: resName,
            description: resDesc,
            mimeType: resMime,
            isTemplate: resUri.includes('{'),
            staticPayload: resPayload,
          }),
        });
        setData(res.overview);
        pushToast({ title: `Recurso ${resUri} registado`, tone: 'success' });
      }
      setResModalOpen(false);
      await onRefreshBootstrap();
    } catch (err) {
      pushToast({ title: 'Falha ao guardar recurso', detail: (err as Error).message, tone: 'error' });
    }
  };

  // Live JSON-RPC Execution / Quick Probe from Registry
  const executeJsonRpcProbe = async (method: string, paramsObj: Record<string, unknown>) => {
    setRpcMethod(method);
    setRpcParamsText(JSON.stringify(paramsObj, null, 2));
    setActiveTab('console');
    setRpcRunning(true);
    const t0 = performance.now();
    try {
      const rpcRes = await apiJson<Record<string, unknown>>('/api/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params: paramsObj,
        }),
      });
      const elapsed = Number((performance.now() - t0).toFixed(2));
      setRpcElapsedMs(elapsed);
      setRpcResultText(JSON.stringify(rpcRes, null, 2));
      await loadGateway();
      await onRefreshBootstrap();
    } catch (err) {
      setRpcResultText(JSON.stringify({ error: (err as Error).message }, null, 2));
    } finally {
      setRpcRunning(false);
    }
  };

  const handleRunManualConsole = async (e: React.FormEvent) => {
    e.preventDefault();
    let parsed: Record<string, unknown> = {};
    if (rpcParamsText.trim()) {
      try {
        parsed = JSON.parse(rpcParamsText);
      } catch {
        pushToast({ title: 'Parâmetros JSON inválidos', detail: 'Corrige o bloco JSON antes de enviar.', tone: 'error' });
        return;
      }
    }
    await executeJsonRpcProbe(rpcMethod, parsed);
  };

  // Custom & Standard Library Server Actions
  const openCustomServerModal = (preset?: McpStandardLibraryItem) => {
    if (preset) {
      setSelectedLibraryPreset(preset);
      setSrvName(preset.name);
      setSrvDesc(preset.description);
      setSrvTransport(preset.transport);
      if (preset.transport === 'STDIO') {
        setSrvCommand(preset.defaultEndpointOrCommand);
        setSrvArgs(preset.defaultArgs.join(' '));
        setSrvEndpoint('');
      } else {
        setSrvEndpoint(preset.defaultEndpointOrCommand);
        setSrvCommand('npx');
        setSrvArgs('');
      }
      setSrvEnvPairs(preset.requiredEnvKeys.map((k) => ({ key: k, value: '' })));
    } else {
      setSelectedLibraryPreset(null);
      setSrvName('');
      setSrvDesc('');
      setSrvTransport('HTTP_STREAMABLE');
      setSrvEndpoint('http://127.0.0.1:3000/api/mcp');
      setSrvCommand('npx');
      setSrvArgs('-y @modelcontextprotocol/server-memory');
      setSrvEnvPairs([]);
    }
    setServerModalOpen(true);
  };

  const handleInstallLibraryItem = async (item: McpStandardLibraryItem) => {
    if (item.requiredEnvKeys.length > 0) {
      openCustomServerModal(item);
      return;
    }
    setInstallingLibId(item.id);
    try {
      const res = await apiJson<{ server: McpCustomServer; overview: McpGatewayPayload }>(
        '/api/mcp/gateway/servers',
        {
          method: 'POST',
          body: JSON.stringify({ libraryId: item.id }),
        }
      );
      setData(res.overview);
      await onRefreshBootstrap();
      pushToast({
        title: `${item.name} adicionado ao Gateway`,
        detail:
          res.server.authStatus === 'PENDING_APPROVAL'
            ? 'Comando stdio aguarda autorização do Operador.'
            : `Estado: ${res.server.healthStatus}`,
        tone: res.server.authStatus === 'PENDING_APPROVAL' ? 'info' : 'success',
      });
      setActiveTab('servers');
    } catch (err) {
      pushToast({ title: 'Falha ao instalar conector', detail: (err as Error).message, tone: 'error' });
    } finally {
      setInstallingLibId(null);
    }
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingServer(true);
    try {
      const envKeys: Record<string, string> = {};
      for (const pair of srvEnvPairs) {
        if (pair.key.trim()) {
          envKeys[pair.key.trim()] = pair.value.trim();
        }
      }

      const res = await apiJson<{ server: McpCustomServer; overview: McpGatewayPayload }>(
        '/api/mcp/gateway/servers',
        {
          method: 'POST',
          body: JSON.stringify({
            libraryId: selectedLibraryPreset?.id,
            name: srvName,
            description: srvDesc,
            transport: srvTransport,
            endpointUrl: srvTransport !== 'STDIO' ? srvEndpoint : undefined,
            command: srvTransport === 'STDIO' ? srvCommand : undefined,
            args: srvTransport === 'STDIO' ? srvArgs.split(/\s+/).filter(Boolean) : [],
            envKeys,
          }),
        }
      );
      setData(res.overview);
      setServerModalOpen(false);
      setActiveTab('servers');
      await onRefreshBootstrap();
      pushToast({
        title: `Servidor ${res.server.name} registado`,
        detail:
          res.server.authStatus === 'PENDING_APPROVAL'
            ? 'Colocado em contenção até autorização do comando stdio.'
            : `Ligação verificada (${res.server.lastLatencyMs} ms).`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Erro ao registar servidor MCP', detail: (err as Error).message, tone: 'error' });
    } finally {
      setSavingServer(false);
    }
  };

  const handleAuthorizeStdioServer = async (srv: McpCustomServer) => {
    setProbingServerId(srv.id);
    try {
      const res = await apiJson<{ server: McpCustomServer; overview: McpGatewayPayload }>(
        `/api/mcp/gateway/servers/${srv.id}/authorize`,
        { method: 'POST' }
      );
      setData(res.overview);
      await onRefreshBootstrap();
      pushToast({
        title: `${srv.name} autorizado`,
        detail: `Estado da sonda stdio: ${res.server.healthStatus} (${res.server.lastLatencyMs} ms)`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Falha ao autorizar stdio', detail: (err as Error).message, tone: 'error' });
    } finally {
      setProbingServerId(null);
    }
  };

  const handleProbeSingleServer = async (srv: McpCustomServer) => {
    setProbingServerId(srv.id);
    try {
      const res = await apiJson<{ server: McpCustomServer; overview: McpGatewayPayload }>(
        `/api/mcp/gateway/servers/${srv.id}/probe`,
        { method: 'POST' }
      );
      setData(res.overview);
      await onRefreshBootstrap();
      pushToast({
        title: `Sonda concluída: ${srv.name}`,
        detail: `${res.server.healthStatus} · ${res.server.lastLatencyMs} ms`,
        tone: res.server.healthStatus === 'ONLINE' ? 'success' : 'info',
      });
    } catch (err) {
      pushToast({ title: 'Erro na sonda do servidor', detail: (err as Error).message, tone: 'error' });
    } finally {
      setProbingServerId(null);
    }
  };

  const handleToggleServerEnabled = async (srv: McpCustomServer) => {
    try {
      const res = await apiJson<{ overview: McpGatewayPayload }>(
        `/api/mcp/gateway/servers/${srv.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !srv.enabled }),
        }
      );
      setData(res.overview);
      await onRefreshBootstrap();
    } catch (err) {
      pushToast({ title: 'Erro ao alternar servidor', detail: (err as Error).message, tone: 'error' });
    }
  };

  const handleDeleteServer = async (srv: McpCustomServer) => {
    try {
      const res = await apiJson<{ overview: McpGatewayPayload }>(
        `/api/mcp/gateway/servers/${srv.id}`,
        { method: 'DELETE' }
      );
      setData(res.overview);
      await onRefreshBootstrap();
      pushToast({ title: `Servidor ${srv.name} removido`, tone: 'info' });
    } catch (err) {
      pushToast({ title: 'Erro ao remover servidor', detail: (err as Error).message, tone: 'error' });
    }
  };

  // Filtered Lists
  const filteredTools = useMemo(() => {
    if (!data) return [];
    if (registryFilter === 'RESOURCES') return [];
    const q = registrySearch.toLowerCase().trim();
    return data.tools.filter((t) => {
      if (registryFilter === 'ISSUES' && t.enabled && t.healthStatus === 'HEALTHY') return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    });
  }, [data, registryFilter, registrySearch]);

  const filteredResources = useMemo(() => {
    if (!data) return [];
    if (registryFilter === 'TOOLS') return [];
    const q = registrySearch.toLowerCase().trim();
    return data.resources.filter((r) => {
      if (registryFilter === 'ISSUES' && r.enabled && r.healthStatus === 'HEALTHY') return false;
      if (!q) return true;
      return (
        r.uri.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
      );
    });
  }, [data, registryFilter, registrySearch]);

  const filteredLibrary = useMemo(() => {
    if (!data) return [];
    const q = librarySearch.toLowerCase().trim();
    return data.standardLibrary.filter((item) => {
      if (libraryCategory !== 'ALL' && item.category !== libraryCategory) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.officialPackage.toLowerCase().includes(q) ||
        item.sampleTools.some((st) => st.toLowerCase().includes(q))
      );
    });
  }, [data, libraryCategory, librarySearch]);

  const installedLibraryIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of data?.servers || []) {
      if (s.fromLibraryId) set.add(s.fromLibraryId);
    }
    return set;
  }, [data]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="h-20 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-24 bg-[#0d1117] border border-slate-800/80 rounded-xl p-4" />
          ))}
        </div>
        <div className="h-96 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6" />
      </div>
    );
  }

  const { summary } = data;

  return (
    <div className="space-y-6">
      {/* Header & Global Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 font-display">
            Gateway Nativo MCP 2026
          </h1>
          <p className="text-sm text-slate-400 max-w-3xl">
            Governação centralizada das ferramentas e recursos <span className="font-mono text-slate-300">brain://</span>, poda dinâmica JEV-S1, servidores externos personalizados e biblioteca standard de conectores.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {confirmReset ? (
            <div className="flex items-center gap-2 bg-[#0d1117] border border-amber-500/50 rounded-lg px-3 py-1.5">
              <span className="text-xs text-amber-300 whitespace-nowrap">Repor 18+6 de fábrica?</span>
              <button
                type="button"
                onClick={handleResetDefaults}
                className="px-2.5 py-1 text-xs font-semibold bg-amber-500 text-slate-950 rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 whitespace-nowrap"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#0d1117] border border-slate-800 text-slate-300 rounded-lg hover:text-slate-100 hover:border-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              Repor 18+6 de Fábrica
            </button>
          )}

          <button
            type="button"
            onClick={handleProbeAll}
            disabled={probingAll}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${probingAll ? 'animate-spin' : ''}`} />
            {probingAll ? 'A Sondar Saúde...' : 'Sondar Saúde Global'}
          </button>
        </div>
      </div>

      {/* 4-Column Tabular Telemetry Strip (Single-Elevation, Zero Nested Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-4 space-y-1.5">
          <p className="text-xs text-slate-400">Ferramentas Nativas & Custom</p>
          <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">
            {summary.activeTools} / {summary.totalTools}
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            {summary.healthyTools} saudáveis · {summary.jevEligibleCount} elegíveis JEV-S1
          </p>
        </div>

        <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-4 space-y-1.5">
          <p className="text-xs text-slate-400">Recursos & Templates brain://</p>
          <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">
            {summary.activeResources} / {summary.totalResources}
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            {summary.healthyResources} verificados · JSON & Markdown
          </p>
        </div>

        <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-4 space-y-1.5">
          <p className="text-xs text-slate-400">Servidores MCP Externos</p>
          <p className="text-2xl font-bold text-slate-100 font-mono tabular-nums">
            {summary.onlineServers} / {summary.totalServers}
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            {summary.pendingAuthServers > 0
              ? `${summary.pendingAuthServers} aguarda autorização stdio`
              : 'HTTP Streamable · SSE · stdio'}
          </p>
        </div>

        <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-4 space-y-1.5">
          <p className="text-xs text-slate-400">Latência Média JSON-RPC</p>
          <p className="text-2xl font-bold text-emerald-400 font-mono tabular-nums">
            {summary.avgLatencyMs} ms
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            Protocolo {data.protocolVersion} · Endpoint /api/mcp
          </p>
        </div>
      </div>

      {/* Primary Segmented Workspace Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0d1117] border border-slate-800/80 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('registry')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'registry'
                ? 'bg-[#151c26] text-cyan-300'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Catálogo Nativo ({data.tools.length} Tools · {data.resources.length} Recursos)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('servers')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'servers'
                ? 'bg-[#151c26] text-cyan-300'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Servidores MCP Custom ({data.servers.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'library'
                ? 'bg-[#151c26] text-cyan-300'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Biblioteca Standard ({data.standardLibrary.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('console')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'console'
                ? 'bg-[#151c26] text-cyan-300'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Consola Diagnóstico JSON-RPC
          </button>
        </div>

        {activeTab === 'registry' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openCreateToolModal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#151c26] border border-slate-700/90 text-slate-100 rounded-lg hover:border-cyan-500/60 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400" />
              Adicionar Tool
            </button>
            <button
              type="button"
              onClick={openCreateResModal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#151c26] border border-slate-700/90 text-slate-100 rounded-lg hover:border-cyan-500/60 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              Adicionar Recurso
            </button>
          </div>
        )}

        {activeTab === 'servers' && (
          <button
            type="button"
            onClick={() => openCustomServerModal()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar Servidor MCP Custom
          </button>
        )}
      </div>

      {/* TAB 1: NATIVE TOOLS & RESOURCES REGISTRY */}
      {activeTab === 'registry' && (
        <div className="space-y-6">
          {/* Search & Segmented Filter Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={registrySearch}
                onChange={(e) => setRegistrySearch(e.target.value)}
                placeholder="Filtrar por nome de tool, URI brain:// ou descrição..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-[#0d1117] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#0d1117] border border-slate-800/80 rounded-lg">
              {(
                [
                  { id: 'ALL', label: 'Todos' },
                  { id: 'TOOLS', label: `Tools (${data.tools.length})` },
                  { id: 'RESOURCES', label: `Recursos (${data.resources.length})` },
                  { id: 'ISSUES', label: 'Inativos / Degradados' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setRegistryFilter(f.id)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    registryFilter === f.id
                      ? 'bg-[#151c26] text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tools High-Density Table */}
          {registryFilter !== 'RESOURCES' && (
            <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100">
                  01. Ferramentas Registadas ({filteredTools.length})
                </h2>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  Poda JEV-S1 reduz overhead de schema em até 96%
                </span>
              </div>

              {filteredTools.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <p className="text-sm text-slate-300">Nenhuma ferramenta corresponde ao filtro atual.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setRegistryFilter('ALL');
                      setRegistrySearch('');
                    }}
                    className="px-3 py-1.5 text-xs font-medium bg-[#151c26] text-cyan-300 rounded-lg"
                  >
                    Limpar Filtros
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/70">
                  {filteredTools.map((tool) => {
                    const hints: string[] = [];
                    if (tool.annotations.readOnlyHint) hints.push('readOnly');
                    if (tool.annotations.idempotentHint) hints.push('idempotent');
                    if (tool.annotations.destructiveHint) hints.push('destructive');
                    if (tool.origin === 'CUSTOM') hints.push('custom');

                    return (
                      <div
                        key={tool.id}
                        className="px-5 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[#151c26]/35 transition-colors"
                      >
                        <div className="min-w-0 space-y-1 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono font-semibold text-slate-100 text-sm">
                              {tool.name}
                            </span>
                            <span className="text-slate-600" aria-hidden="true">
                              ·
                            </span>
                            <span className="text-slate-300">{tool.title}</span>
                            {hints.length > 0 && (
                              <>
                                <span className="text-slate-600" aria-hidden="true">
                                  ·
                                </span>
                                <span className="text-slate-500 font-mono">
                                  {hints.join(' · ')}
                                </span>
                              </>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 line-clamp-1">{tool.description}</p>
                        </div>

                        {/* Tabular Health & Controls */}
                        <div className="flex flex-wrap items-center gap-4 shrink-0">
                          <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-400">
                            <span
                              className={
                                !tool.enabled
                                  ? 'text-slate-500'
                                  : tool.healthStatus === 'HEALTHY'
                                    ? 'text-emerald-400'
                                    : 'text-amber-400'
                              }
                            >
                              {!tool.enabled
                                ? 'Desativada'
                                : tool.healthStatus === 'HEALTHY'
                                  ? 'Saudável'
                                  : 'Degradada'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{tool.lastLatencyMs} ms</span>
                            <span aria-hidden="true">·</span>
                            <span>{tool.callCount} exec</span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleToggleTool(tool, 'jevEligible')}
                              title="Incluir ou excluir da poda automática JEV-S1"
                              className={`px-2.5 py-1 text-xs font-mono rounded-md border transition-colors whitespace-nowrap ${
                                tool.jevEligible
                                  ? 'bg-[#151c26] border-cyan-500/40 text-cyan-300'
                                  : 'bg-transparent border-slate-800 text-slate-500 hover:text-slate-300'
                              }`}
                            >
                              JEV-S1: {tool.jevEligible ? 'ON' : 'OFF'}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleToggleTool(tool, 'enabled')}
                              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                                tool.enabled
                                  ? 'bg-[#151c26] border-emerald-500/40 text-emerald-300'
                                  : 'bg-transparent border-slate-800 text-slate-500 hover:text-slate-300'
                              }`}
                            >
                              {tool.enabled ? 'Ativa' : 'Inativa'}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                const defaultArgs =
                                  tool.name === 'search_brain'
                                    ? { query: 'arquitetura' }
                                    : tool.name === 'brain_prune_tools'
                                      ? { prompt: 'analisar impacto em server.ts' }
                                      : tool.name === 'swarm_symbol_lookup'
                                        ? { query: 'routeJevS1' }
                                        : tool.name === 'swarm_impact_graph'
                                          ? { filePath: 'server.ts' }
                                          : {};
                                executeJsonRpcProbe('tools/call', {
                                  name: tool.name,
                                  arguments: defaultArgs,
                                });
                              }}
                              title="Executar sonda JSON-RPC real"
                              className="p-1.5 text-slate-400 hover:text-cyan-300 bg-[#151c26] rounded-md transition-colors"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => openEditToolModal(tool)}
                              title="Editar ferramenta e anotações"
                              className="p-1.5 text-slate-400 hover:text-slate-100 bg-[#151c26] rounded-md transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteTool(tool)}
                              title="Remover ferramenta do registo"
                              className="p-1.5 text-slate-400 hover:text-rose-400 bg-[#151c26] rounded-md transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Resources & Templates High-Density Table */}
          {registryFilter !== 'TOOLS' && (
            <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100">
                  02. Recursos & Templates brain:// ({filteredResources.length})
                </h2>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  resources/list · resources/templates/list · resources/read
                </span>
              </div>

              {filteredResources.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  Nenhum recurso encontrado para o filtro selecionado.
                </div>
              ) : (
                <div className="divide-y divide-slate-800/70">
                  {filteredResources.map((resItem) => (
                    <div
                      key={resItem.id}
                      className="px-5 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[#151c26]/35 transition-colors"
                    >
                      <div className="min-w-0 space-y-1 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-semibold text-cyan-300 text-sm">
                            {resItem.uri}
                          </span>
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-slate-200">{resItem.name}</span>
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-slate-500 font-mono">
                            {resItem.mimeType} · {resItem.isTemplate ? 'URI Template' : 'Estático'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">{resItem.description}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 shrink-0">
                        <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-400">
                          <span
                            className={
                              !resItem.enabled
                                ? 'text-slate-500'
                                : resItem.healthStatus === 'HEALTHY'
                                  ? 'text-emerald-400'
                                  : 'text-amber-400'
                            }
                          >
                            {!resItem.enabled
                              ? 'Desativado'
                              : resItem.healthStatus === 'HEALTHY'
                                ? 'Saudável'
                                : 'Degradado'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{resItem.lastLatencyMs} ms</span>
                          <span aria-hidden="true">·</span>
                          <span>{resItem.readCount} leituras</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleToggleResource(resItem)}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                              resItem.enabled
                                ? 'bg-[#151c26] border-emerald-500/40 text-emerald-300'
                                : 'bg-transparent border-slate-800 text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            {resItem.enabled ? 'Ativo' : 'Inativo'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const targetUri = resItem.isTemplate
                                ? resItem.uri
                                    .replace('{ws}', 'default')
                                    .replace('{symbol}', 'startServer')
                                : resItem.uri;
                              executeJsonRpcProbe('resources/read', { uri: targetUri });
                            }}
                            title="Ler recurso via JSON-RPC"
                            className="p-1.5 text-slate-400 hover:text-cyan-300 bg-[#151c26] rounded-md transition-colors"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditResModal(resItem)}
                            title="Editar recurso"
                            className="p-1.5 text-slate-400 hover:text-slate-100 bg-[#151c26] rounded-md transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteResource(resItem)}
                            title="Remover recurso"
                            className="p-1.5 text-slate-400 hover:text-rose-400 bg-[#151c26] rounded-md transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: REGISTERED CUSTOM & STANDARD MCP SERVERS */}
      {activeTab === 'servers' && (
        <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-100">
              Servidores MCP Ligados ao Gateway ({data.servers.length})
            </h2>
            <span className="text-xs text-slate-500">
              Suporte nativo HTTP Streamable · SSE · stdio governado por Autoridade
            </span>
          </div>

          {data.servers.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <Server className="w-7 h-7 text-slate-500 mx-auto" />
              <p className="text-sm font-medium text-slate-200">
                Nenhum servidor MCP externo configurado.
              </p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Adiciona um endpoint HTTP Streamable, SSE ou comando stdio local, ou instala em 1 clique a partir da Biblioteca Standard.
              </p>
              <div className="flex items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => openCustomServerModal()}
                  className="px-3.5 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg"
                >
                  Adicionar Servidor Custom
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('library')}
                  className="px-3.5 py-2 text-xs font-medium bg-[#151c26] text-slate-200 rounded-lg"
                >
                  Explorar Biblioteca Standard
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {data.servers.map((srv) => {
                const targetLine =
                  srv.transport === 'STDIO'
                    ? `${srv.command || ''} ${(srv.args || []).join(' ')}`.trim()
                    : srv.endpointUrl || '';
                const envEntries = Object.entries(srv.envKeys || {});

                return (
                  <div key={srv.id} className="p-5 space-y-3 hover:bg-[#151c26]/25 transition-colors">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-sm font-semibold text-slate-100">{srv.name}</span>
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-cyan-300 font-mono">
                            {TRANSPORT_LABELS[srv.transport]}
                          </span>
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-slate-400">{CATEGORY_LABELS[srv.category]}</span>
                        </div>

                        <p className="text-xs text-slate-400">{srv.description}</p>

                        <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500 pt-0.5">
                          <span className="text-slate-300 truncate max-w-xl">{targetLine}</span>
                          {envEntries.length > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                Env:{' '}
                                {envEntries.map(([k, v]) => `${k}=${v}`).join(', ')}
                              </span>
                            </>
                          )}
                        </div>

                        {srv.discoveredTools.length > 0 && (
                          <p className="text-xs text-slate-500 font-mono">
                            Tools expostas ({srv.discoveredTools.length}):{' '}
                            <span className="text-slate-300">
                              {srv.discoveredTools.slice(0, 8).join(' · ')}
                              {srv.discoveredTools.length > 8
                                ? ` · +${srv.discoveredTools.length - 8}`
                                : ''}
                            </span>
                          </p>
                        )}

                        {srv.lastError && (
                          <p className="text-xs text-amber-300/90 flex items-center gap-1.5 pt-0.5">
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                            <span>{srv.lastError}</span>
                          </p>
                        )}
                      </div>

                      {/* Server Status & Actions */}
                      <div className="flex flex-wrap items-center gap-3 shrink-0">
                        <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                          {srv.healthStatus === 'ONLINE' ? (
                            <span className="flex items-center gap-1 text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Online
                            </span>
                          ) : srv.healthStatus === 'PENDING_AUTH' ? (
                            <span className="flex items-center gap-1 text-amber-300">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              Aguarda Autoridade
                            </span>
                          ) : srv.healthStatus === 'DEGRADED' ? (
                            <span className="flex items-center gap-1 text-amber-400">
                              <Activity className="w-3.5 h-3.5" />
                              Degradado
                            </span>
                          ) : (
                            <span className="text-slate-500">Offline</span>
                          )}
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-slate-400">{srv.lastLatencyMs} ms</span>
                        </div>

                        {srv.authStatus === 'PENDING_APPROVAL' && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleAuthorizeStdioServer(srv)}
                              disabled={probingServerId === srv.id}
                              className="px-3 py-1.5 text-xs font-semibold bg-amber-500 text-slate-950 rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap"
                            >
                              Autorizar stdio
                            </button>
                            {onNavigate && (
                              <button
                                type="button"
                                onClick={() => onNavigate('authority')}
                                className="px-2.5 py-1.5 text-xs text-slate-300 bg-[#151c26] rounded-md hover:text-white whitespace-nowrap"
                              >
                                Inbox
                              </button>
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => handleToggleServerEnabled(srv)}
                          className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                            srv.enabled
                              ? 'bg-[#151c26] border-emerald-500/40 text-emerald-300'
                              : 'bg-transparent border-slate-800 text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {srv.enabled ? 'Ativo' : 'Inativo'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleProbeSingleServer(srv)}
                          disabled={probingServerId === srv.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#151c26] text-slate-200 rounded-md hover:text-cyan-300 transition-colors whitespace-nowrap"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${
                              probingServerId === srv.id ? 'animate-spin' : ''
                            }`}
                          />
                          Sondar
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteServer(srv)}
                          title="Remover servidor MCP"
                          className="p-1.5 text-slate-400 hover:text-rose-400 bg-[#151c26] rounded-md transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: STANDARD MCP SERVER LIBRARY (14 CONNECTORS ACROSS 4 CATEGORIES) */}
      {activeTab === 'library' && (
        <div className="space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Pesquisar GitHub, SQLite, Linear, Brave, Docker, pacote oficial..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-[#0d1117] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0d1117] border border-slate-800/80 rounded-lg">
              {(
                [
                  { id: 'ALL', label: 'Todas (14)' },
                  { id: 'CORE_LOCAL', label: 'Core Local (4)' },
                  { id: 'WEB_SEARCH', label: 'Pesquisa & Web (3)' },
                  { id: 'CLOUD_DEVOPS', label: 'Engenharia & Cloud (4)' },
                  { id: 'PRODUCTIVITY', label: 'Produtividade (3)' },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setLibraryCategory(cat.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    libraryCategory === cat.id
                      ? 'bg-[#151c26] text-cyan-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl divide-y divide-slate-800/70">
            {filteredLibrary.map((item) => {
              const isInstalled = installedLibraryIds.has(item.id);
              const needsEnv = item.requiredEnvKeys.length > 0;

              return (
                <div
                  key={item.id}
                  className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[#151c26]/25 transition-colors"
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-sm font-semibold text-slate-100">{item.name}</span>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-slate-400">{CATEGORY_LABELS[item.category]}</span>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-cyan-300 font-mono">
                        {TRANSPORT_LABELS[item.transport]}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-slate-500 font-mono">{item.officialPackage}</span>
                    </div>

                    <p className="text-xs text-slate-400">{item.description}</p>

                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500">
                      <span>Tools: {item.sampleTools.join(' · ')}</span>
                      {needsEnv && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-300/90">
                            Requer: {item.requiredEnvKeys.join(', ')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {isInstalled && (
                      <span className="text-xs font-mono text-emerald-400 whitespace-nowrap">
                        Instalado
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleInstallLibraryItem(item)}
                      disabled={installingLibId === item.id}
                      className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                        isInstalled
                          ? 'bg-[#151c26] border border-slate-700 text-slate-200 hover:border-cyan-500/50'
                          : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                      }`}
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      {installingLibId === item.id
                        ? 'A Instalar...'
                        : isInstalled
                          ? 'Nova Instância'
                          : needsEnv
                            ? 'Configurar & Instalar'
                            : 'Instalar em 1 Clique'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: LIVE JSON-RPC 2.0 DIAGNOSTIC CONSOLE */}
      {activeTab === 'console' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <form
            onSubmit={handleRunManualConsole}
            className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-5 space-y-4 flex flex-col justify-between"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-cyan-400" />
                  Pedido JSON-RPC 2.0 (/api/mcp)
                </h2>
                <span className="text-xs text-slate-500 font-mono">POST application/json</span>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs text-slate-400">Método MCP</label>
                <select
                  value={rpcMethod}
                  onChange={(e) => {
                    const m = e.target.value;
                    setRpcMethod(m);
                    if (m === 'initialize' || m === 'tools/list' || m === 'resources/list' || m === 'resources/templates/list' || m === 'prompts/list') {
                      setRpcParamsText('{}');
                    } else if (m === 'tools/call') {
                      setRpcParamsText(
                        JSON.stringify({ name: 'brain_stats', arguments: {} }, null, 2)
                      );
                    } else if (m === 'resources/read') {
                      setRpcParamsText(JSON.stringify({ uri: 'brain://pinned' }, null, 2));
                    } else if (m === 'prompts/get') {
                      setRpcParamsText(
                        JSON.stringify(
                          {
                            name: 'ultraplan-scout',
                            arguments: { objective: 'Auditoria Gateway MCP 2026' },
                          },
                          null,
                          2
                        )
                      );
                    }
                  }}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#151c26] border border-slate-700/80 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  <option value="initialize">initialize</option>
                  <option value="tools/list">tools/list</option>
                  <option value="tools/call">tools/call</option>
                  <option value="resources/list">resources/list</option>
                  <option value="resources/templates/list">resources/templates/list</option>
                  <option value="resources/read">resources/read</option>
                  <option value="prompts/list">prompts/list</option>
                  <option value="prompts/get">prompts/get</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs text-slate-400">Bloco params (JSON)</label>
                <textarea
                  rows={10}
                  value={rpcParamsText}
                  onChange={(e) => setRpcParamsText(e.target.value)}
                  className="w-full p-3 text-xs font-mono bg-[#151c26] border border-slate-700/80 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end">
              <button
                type="submit"
                disabled={rpcRunning}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                {rpcRunning ? 'A Executar JSON-RPC...' : 'Disparar Chamada JSON-RPC'}
              </button>
            </div>
          </form>

          <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-5 flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Resposta Estruturada</h2>
              <span className="text-xs font-mono tabular-nums text-emerald-400">
                {rpcElapsedMs !== null ? `Round-trip: ${rpcElapsedMs} ms` : 'Pronto para sondar'}
              </span>
            </div>

            <pre className="flex-1 min-h-[280px] max-h-[420px] overflow-auto p-3.5 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-200 whitespace-pre-wrap">
              {rpcResultText ||
                'Seleciona uma ferramenta ou recurso no Catálogo Nativo (botão Play) ou dispara uma chamada manual ao lado para inspecionar o payload JSON-RPC 2.0 em tempo real.'}
            </pre>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT NATIVE OR CUSTOM MCP TOOL */}
      {toolModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setToolModalOpen(false)}
        >
          <form
            onSubmit={handleSaveTool}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-[#0d1117] border border-slate-800 rounded-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">
                {editingToolId ? `Editar Ferramenta (${toolName})` : 'Registar Nova Ferramenta MCP'}
              </h3>
              <button
                type="button"
                onClick={() => setToolModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Identificador Técnico (snake_case)</label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingToolId)}
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  placeholder="ex: audit_docker_health"
                  className="w-full px-3 py-2 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-lg text-slate-100 disabled:opacity-60"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Título Humano</label>
                <input
                  type="text"
                  required
                  value={toolTitle}
                  onChange={(e) => setToolTitle(e.target.value)}
                  placeholder="ex: Auditoria Docker Health"
                  className="w-full px-3 py-2 text-xs bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Descrição Semântica (usada pelo JEV-S1)</label>
              <input
                type="text"
                required
                value={toolDesc}
                onChange={(e) => setToolDesc(e.target.value)}
                placeholder="Descreve quando o agente deve invocar esta ferramenta..."
                className="w-full px-3 py-2 text-xs bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">inputSchema (JSON Schema)</label>
              <textarea
                rows={5}
                value={toolSchemaJson}
                onChange={(e) => setToolSchemaJson(e.target.value)}
                className="w-full p-2.5 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
              />
            </div>

            {(!editingToolId ||
              data.tools.find((x) => x.id === editingToolId)?.origin === 'CUSTOM') && (
              <div className="space-y-1">
                <label className="text-xs text-slate-400">
                  Payload Estruturado de Resposta (JSON para tools custom)
                </label>
                <input
                  type="text"
                  value={toolMockResponse}
                  onChange={(e) => setToolMockResponse(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
                />
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs text-slate-300">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={toolReadOnly}
                  onChange={(e) => setToolReadOnly(e.target.checked)}
                />
                readOnlyHint
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={toolIdempotent}
                  onChange={(e) => setToolIdempotent(e.target.checked)}
                />
                idempotentHint
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={toolDestructive}
                  onChange={(e) => setToolDestructive(e.target.checked)}
                />
                destructiveHint
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-cyan-300">
                <input
                  type="checkbox"
                  checked={toolJevEligible}
                  onChange={(e) => setToolJevEligible(e.target.checked)}
                />
                Elegível JEV-S1
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setToolModalOpen(false)}
                className="px-3.5 py-2 text-xs text-slate-400 hover:text-slate-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400"
              >
                Guardar Ferramenta
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ADD / EDIT RESOURCE */}
      {resModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setResModalOpen(false)}
        >
          <form
            onSubmit={handleSaveResource}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-[#0d1117] border border-slate-800 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">
                {editingResId ? 'Editar Recurso MCP' : 'Adicionar Recurso brain://'}
              </h3>
              <button
                type="button"
                onClick={() => setResModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">URI ou URI Template</label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingResId)}
                  value={resUri}
                  onChange={(e) => setResUri(e.target.value)}
                  placeholder="brain://custom/metrics"
                  className="w-full px-3 py-2 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-lg text-slate-100 disabled:opacity-60"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">MIME Type</label>
                <select
                  value={resMime}
                  onChange={(e) => setResMime(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
                >
                  <option value="application/json">application/json</option>
                  <option value="text/markdown">text/markdown</option>
                  <option value="text/plain">text/plain</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Nome do Recurso</label>
              <input
                type="text"
                required
                value={resName}
                onChange={(e) => setResName(e.target.value)}
                placeholder="Métricas Operacionais Custom"
                className="w-full px-3 py-2 text-xs bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Descrição</label>
              <input
                type="text"
                required
                value={resDesc}
                onChange={(e) => setResDesc(e.target.value)}
                placeholder="Contexto exposto aos agentes via resources/read"
                className="w-full px-3 py-2 text-xs bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Conteúdo / Payload do Recurso</label>
              <textarea
                rows={4}
                value={resPayload}
                onChange={(e) => setResPayload(e.target.value)}
                className="w-full p-2.5 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setResModalOpen(false)}
                className="px-3.5 py-2 text-xs text-slate-400 hover:text-slate-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400"
              >
                Guardar Recurso
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ADD CUSTOM SERVER OR CONFIGURE LIBRARY CONNECTOR */}
      {serverModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setServerModalOpen(false)}
        >
          <form
            onSubmit={handleSaveServer}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-[#0d1117] border border-slate-800 rounded-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">
                {selectedLibraryPreset
                  ? `Configurar ${selectedLibraryPreset.name}`
                  : 'Adicionar Servidor MCP Personalizado'}
              </h3>
              <button
                type="button"
                onClick={() => setServerModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Nome do Servidor</label>
                <input
                  type="text"
                  required
                  value={srvName}
                  onChange={(e) => setSrvName(e.target.value)}
                  placeholder="ex: Servidor MCP Interno"
                  className="w-full px-3 py-2 text-xs bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-400">Transporte MCP 2026</label>
                <select
                  value={srvTransport}
                  onChange={(e) => setSrvTransport(e.target.value as McpTransportType)}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
                >
                  <option value="HTTP_STREAMABLE">HTTP Streamable (POST JSON-RPC)</option>
                  <option value="SSE">SSE (Server-Sent Events)</option>
                  <option value="STDIO">stdio Local (Governado por Autoridade)</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Descrição</label>
              <input
                type="text"
                value={srvDesc}
                onChange={(e) => setSrvDesc(e.target.value)}
                placeholder="Finalidade operacional deste servidor MCP..."
                className="w-full px-3 py-2 text-xs bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
              />
            </div>

            {srvTransport !== 'STDIO' ? (
              <div className="space-y-1">
                <label className="text-xs text-slate-400">
                  Endpoint URL ({srvTransport === 'HTTP_STREAMABLE' ? 'HTTP/HTTPS POST' : 'SSE Stream'})
                </label>
                <input
                  type="url"
                  required
                  value={srvEndpoint}
                  onChange={(e) => setSrvEndpoint(e.target.value)}
                  placeholder="https://mcp.exemplo.pt/mcp"
                  className="w-full px-3 py-2 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Executável</label>
                  <input
                    type="text"
                    required
                    value={srvCommand}
                    onChange={(e) => setSrvCommand(e.target.value)}
                    placeholder="npx ou uvx"
                    className="w-full px-3 py-2 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs text-slate-400">Argumentos CLI</label>
                  <input
                    type="text"
                    value={srvArgs}
                    onChange={(e) => setSrvArgs(e.target.value)}
                    placeholder="-y @modelcontextprotocol/server-filesystem ."
                    className="w-full px-3 py-2 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-lg text-slate-100"
                  />
                </div>
              </div>
            )}

            {/* Environment Keys (Masked at rest by AI-Defence) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">
                  Variáveis de Ambiente / Credenciais (mascaradas em repouso)
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setSrvEnvPairs((prev) => [...prev, { key: '', value: '' }])
                  }
                  className="text-xs text-cyan-400 hover:text-cyan-300"
                >
                  + Adicionar Variável
                </button>
              </div>

              {srvEnvPairs.map((pair, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={pair.key}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSrvEnvPairs((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, key: val } : p))
                      );
                    }}
                    placeholder="NOME_DA_VARIAVEL"
                    className="w-1/2 px-2.5 py-1.5 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-md text-slate-100"
                  />
                  <input
                    type="password"
                    value={pair.value}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSrvEnvPairs((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, value: val } : p))
                      );
                    }}
                    placeholder="Valor ou referência de ambiente"
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-[#151c26] border border-slate-700 rounded-md text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setSrvEnvPairs((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="p-1 text-slate-500 hover:text-rose-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {srvTransport === 'STDIO' && (
              <p className="text-xs text-slate-400 bg-[#151c26] border border-slate-800 rounded-lg p-3">
                Comandos <span className="font-mono text-slate-200">stdio</span> não pré-aprovados são submetidos à Fronteira de Confiança antes de qualquer execução local.
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setServerModalOpen(false)}
                className="px-3.5 py-2 text-xs text-slate-400 hover:text-slate-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingServer}
                className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 disabled:opacity-60"
              >
                {savingServer ? 'A Registar & Sondar...' : 'Registar Servidor MCP'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default McpGatewayView;
