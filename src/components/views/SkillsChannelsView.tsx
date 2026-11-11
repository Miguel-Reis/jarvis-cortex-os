import React, { useMemo, useState } from 'react';
import {
  Plus,
  ShieldCheck,
  ShieldAlert,
  Send,
  X,
  Blocks,
  Puzzle,
  Library,
  Radio,
  Download,
  Check,
  Trash2,
  Copy,
  Sliders,
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import { useToast } from '../ToastContext';
import { STANDARD_SKILLS_LIBRARY } from '../../shared/skills-plugins-catalog';
import type {
  JarvisStoreData,
  PluginItem,
  PluginLifecycleHook,
  SkillLibraryTemplate,
} from '../../shared/types';

interface SkillsChannelsViewProps {
  store: JarvisStoreData;
  onRefreshBootstrap: () => Promise<void>;
}

type EcosystemTab = 'installed' | 'library' | 'plugins' | 'channels';

export const SkillsChannelsView: React.FC<SkillsChannelsViewProps> = ({
  store,
  onRefreshBootstrap,
}) => {
  const { pushToast } = useToast();
  const [activeTab, setActiveTab] = useState<EcosystemTab>('installed');
  const [searchQuery, setSearchQuery] = useState('');
  const [libCategory, setLibCategory] = useState<string>('ALL');

  // Create Custom Skill modal
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [skillName, setSkillName] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillInstr, setSkillInstr] = useState('');
  const [skillCmd, setSkillCmd] = useState('');

  // Create Custom Plugin modal
  const [showPluginModal, setShowPluginModal] = useState(false);
  const [pluginName, setPluginName] = useState('');
  const [pluginDesc, setPluginDesc] = useState('');
  const [pluginHook, setPluginHook] = useState<PluginLifecycleHook>('POST_TURN');
  const [pluginCategory, setPluginCategory] = useState<PluginItem['category']>('WORKFLOW');
  const [editingPluginId, setEditingPluginId] = useState<string | null>(null);
  const [pluginConfigDraft, setPluginConfigDraft] = useState<string>('');

  // Channel Allow-List inline editor & Webhook Simulator
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [allowListInput, setAllowListInput] = useState('');
  const [simChannelId, setSimChannelId] = useState<string>(store.channels[0]?.id || '');
  const [simSenderId, setSimSenderId] = useState<string>(
    store.channels[0]?.ownerAllowList[0] || 'tg_owner_774109'
  );
  const [simMessage, setSimMessage] = useState<string>('Qual é a prioridade Q-18 atual?');
  const [simResult, setSimResult] = useState<{
    verdict: { allowed: boolean; isOwner: boolean; reason: string };
    reply: string | null;
  } | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const plugins = store.plugins || [];
  const installedSlugs = useMemo(
    () => new Set(store.skills.map((s) => s.slug)),
    [store.skills]
  );

  const filteredInstalledSkills = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return store.skills.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.quickCommand.toLowerCase().includes(q)
    );
  }, [searchQuery, store.skills]);

  const filteredLibrarySkills = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return STANDARD_SKILLS_LIBRARY.filter((tpl) => {
      if (libCategory !== 'ALL' && tpl.category !== libCategory) return false;
      if (!q) return true;
      return (
        tpl.name.toLowerCase().includes(q) ||
        tpl.description.toLowerCase().includes(q) ||
        tpl.quickCommand.toLowerCase().includes(q)
      );
    });
  }, [libCategory, searchQuery]);

  const handleToggleSkill = async (id: string, enabled: boolean) => {
    await apiJson(`/api/skills/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    await onRefreshBootstrap();
  };

  const handleDeleteSkill = async (id: string) => {
    await apiJson(`/api/skills/${id}`, { method: 'DELETE' });
    await onRefreshBootstrap();
    pushToast({ title: 'Skill removida', tone: 'info' });
  };

  const handleInstallLibrarySkill = async (tpl: SkillLibraryTemplate) => {
    setInstallingId(tpl.id);
    try {
      await apiJson('/api/skills/install-template', {
        method: 'POST',
        body: JSON.stringify({ templateId: tpl.id }),
      });
      await onRefreshBootstrap();
      pushToast({
        title: `Skill instalada: ${tpl.name}`,
        detail: `Comando ${tpl.quickCommand} ativo no loop ReAct.`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Aviso na instalação da Skill',
        detail: (err as Error).message,
        tone: 'warning',
      });
    } finally {
      setInstallingId(null);
    }
  };

  const handleCreateSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!skillName.trim() || !skillInstr.trim()) return;
    try {
      await apiJson('/api/skills', {
        method: 'POST',
        body: JSON.stringify({
          name: skillName.trim(),
          description: skillDesc.trim(),
          systemInstruction: skillInstr.trim(),
          quickCommand: skillCmd.trim() || undefined,
          allowedTools: ['search_memories', 'get_system_telemetry', 'lookup_ast_symbol'],
        }),
      });
      setSkillName('');
      setSkillDesc('');
      setSkillInstr('');
      setSkillCmd('');
      setShowSkillModal(false);
      await onRefreshBootstrap();
      pushToast({ title: 'Nova Skill OpenClaw criada', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Erro ao criar Skill', detail: (err as Error).message, tone: 'error' });
    }
  };

  const handleUpdatePlugin = async (
    id: string,
    patch: { enabled?: boolean; installed?: boolean; config?: Record<string, string | number | boolean> }
  ) => {
    await apiJson(`/api/plugins/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    await onRefreshBootstrap();
    pushToast({ title: 'Estado do plugin atualizado', tone: 'success' });
  };

  const handleCreatePlugin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pluginName.trim()) return;
    try {
      await apiJson('/api/plugins', {
        method: 'POST',
        body: JSON.stringify({
          name: pluginName.trim(),
          description: pluginDesc.trim(),
          hook: pluginHook,
          category: pluginCategory,
          config: { strictMode: true },
        }),
      });
      setPluginName('');
      setPluginDesc('');
      setShowPluginModal(false);
      await onRefreshBootstrap();
      pushToast({ title: 'Plugin registado e ativado', tone: 'success' });
    } catch (err) {
      pushToast({ title: 'Erro ao registar plugin', detail: (err as Error).message, tone: 'error' });
    }
  };

  const handleSavePluginConfig = async (pluginId: string) => {
    try {
      const parsed = JSON.parse(pluginConfigDraft);
      await handleUpdatePlugin(pluginId, { config: parsed });
      setEditingPluginId(null);
    } catch {
      pushToast({
        title: 'Configuração JSON inválida',
        detail: 'Verifica as chaves e valores JSON.',
        tone: 'error',
      });
    }
  };

  const handleSaveAllowList = async (channelId: string) => {
    await apiJson(`/api/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify({ ownerAllowList: allowListInput }),
    });
    setEditingChannelId(null);
    await onRefreshBootstrap();
    pushToast({ title: 'Owner Allow-List atualizada', tone: 'success' });
  };

  const handleToggleChannel = async (channelId: string, enabled: boolean) => {
    await apiJson(`/api/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    await onRefreshBootstrap();
  };

  const handleSimulateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simChannelId || simBusy) return;
    setSimBusy(true);
    try {
      const res = await apiJson<{
        verdict: { allowed: boolean; isOwner: boolean; reason: string };
        reply: string | null;
      }>(`/api/channels/${simChannelId}/simulate-webhook`, {
        method: 'POST',
        body: JSON.stringify({
          senderId: simSenderId,
          message: simMessage,
        }),
      });
      setSimResult(res);
      await onRefreshBootstrap();
      pushToast({
        title: res.verdict.allowed
          ? 'Evento aceite pelo Gateway'
          : 'Evento bloqueado pelo Gateway',
        detail: res.verdict.reason,
        tone: res.verdict.allowed ? 'success' : 'warning',
      });
    } finally {
      setSimBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Segmented Navigation */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-cyan-400">
            Ecossistema Modular · OpenClaw × Cortex Hooks
          </p>
          <h1 className="text-2xl font-bold text-slate-100 font-display mt-0.5">
            Skills, Biblioteca Standard & Plugins
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Injeta competências cognitivas especializadas em 1 clique, gere plugins com hooks de
            ciclo de vida e governa canais externos por Owner Allow-List.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowSkillModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#141b25] border border-slate-700 text-slate-100 hover:border-cyan-500/50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-cyan-400" />
            Criar Skill
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('plugins');
              setShowPluginModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors"
          >
            <Puzzle className="w-3.5 h-3.5" />
            Registar Plugin
          </button>
        </div>
      </div>

      {/* Tabs + Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-slate-800/80">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            {
              id: 'installed' as const,
              label: `Skills Instaladas (${store.skills.length})`,
              icon: Blocks,
            },
            {
              id: 'library' as const,
              label: `Biblioteca de Skills (${STANDARD_SKILLS_LIBRARY.length})`,
              icon: Library,
            },
            {
              id: 'plugins' as const,
              label: `Plugins & Extensões (${plugins.length})`,
              icon: Puzzle,
            },
            {
              id: 'channels' as const,
              label: `Canais & Allow-List (${store.channels.length})`,
              icon: Radio,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  active
                    ? 'bg-[#141b25] border-cyan-500/50 text-cyan-300'
                    : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#0d1117]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {(activeTab === 'installed' || activeTab === 'library') && (
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar skills ou /comandos..."
            className="w-full sm:w-64 px-3 py-1.5 text-xs bg-[#0d1117] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
        )}
      </div>

      {/* TAB 1: Installed Skills */}
      {activeTab === 'installed' && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredInstalledSkills.map((skill) => (
            <div
              key={skill.id}
              className="jarvis-surface p-5 rounded-xl border border-slate-800/80 flex flex-col justify-between gap-3.5"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">{skill.name}</h2>
                    <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                      {skill.category || 'CORE'} · {skill.origin || 'BUILTIN'} · v{skill.version}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggleSkill(skill.id, !skill.enabled)}
                      className={`px-2.5 py-1 text-xs rounded-md border font-mono transition-colors ${
                        skill.enabled
                          ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                          : 'border-slate-700 text-slate-400 bg-[#141b25]'
                      }`}
                    >
                      {skill.enabled ? 'Ativa' : 'Inativa'}
                    </button>
                    {skill.origin !== 'BUILTIN' && (
                      <button
                        type="button"
                        onClick={() => handleDeleteSkill(skill.id)}
                        aria-label={`Remover ${skill.name}`}
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded-md"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-300">{skill.description}</p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  &ldquo;{skill.systemInstruction}&rdquo;
                </p>
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(skill.quickCommand).catch(() => {});
                    pushToast({
                      title: 'Comando copiado',
                      detail: skill.quickCommand,
                      tone: 'info',
                    });
                  }}
                  className="inline-flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200"
                >
                  <Copy className="w-3 h-3" />
                  {skill.quickCommand}
                </button>
                <span className="text-slate-500 truncate">
                  {skill.allowedTools.join(' · ')}
                </span>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* TAB 2: Standard Skills Library */}
      {activeTab === 'library' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {['ALL', 'SIDECAR', 'ENGINEERING', 'DEVOPS', 'SECURITY', 'RESEARCH', 'PRODUCTIVITY'].map(
              (cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setLibCategory(cat)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded-md border transition-colors ${
                    libCategory === cat
                      ? 'bg-cyan-500/15 border-cyan-500/45 text-cyan-300'
                      : 'bg-[#0d1117] border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat === 'ALL' ? 'TODAS AS CATEGORIAS' : cat}
                </button>
              )
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredLibrarySkills.map((tpl) => {
              const isInstalled =
                installedSlugs.has(tpl.slug) ||
                store.skills.some((s) => s.id === `skill-${tpl.id}`);
              return (
                <div
                  key={tpl.id}
                  className="jarvis-surface p-5 rounded-xl border border-slate-800/80 flex flex-col justify-between gap-3.5"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-mono text-cyan-400">
                          {tpl.category} · {tpl.author} · v{tpl.version}
                        </p>
                        <h3 className="text-sm font-semibold text-slate-100 mt-0.5">{tpl.name}</h3>
                      </div>
                      {isInstalled ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg shrink-0">
                          <Check className="w-3.5 h-3.5" />
                          Instalada
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={installingId === tpl.id}
                          onClick={() => handleInstallLibrarySkill(tpl)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition-colors shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Instalar
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-300">{tpl.description}</p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {tpl.systemInstruction}
                    </p>
                  </div>

                  <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-2 text-xs font-mono text-slate-500">
                    <span className="text-cyan-300">{tpl.quickCommand}</span>
                    <span className="truncate">{tpl.allowedTools.join(' · ')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* TAB 3: Cortex Plugins & Lifecycle Extensions */}
      {activeTab === 'plugins' && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plugins.map((plug) => (
            <div
              key={plug.id}
              className="jarvis-surface p-5 rounded-xl border border-slate-800/80 flex flex-col justify-between gap-3.5"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-mono">
                      <span className="text-cyan-400">{plug.hook}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">{plug.category}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-500">v{plug.version}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-100 mt-0.5">{plug.name}</h3>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {!plug.installed ? (
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdatePlugin(plug.id, { installed: true, enabled: true })
                        }
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Instalar
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            if (editingPluginId === plug.id) {
                              setEditingPluginId(null);
                            } else {
                              setEditingPluginId(plug.id);
                              setPluginConfigDraft(JSON.stringify(plug.config || {}, null, 2));
                            }
                          }}
                          title="Configurar parâmetros do plugin"
                          className="p-1.5 rounded-md bg-[#141b25] border border-slate-800 text-slate-300 hover:text-cyan-300"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdatePlugin(plug.id, { enabled: !plug.enabled })}
                          className={`px-2.5 py-1 text-xs font-mono rounded-md border transition-colors ${
                            plug.enabled
                              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                              : 'bg-[#141b25] border-slate-700 text-slate-400'
                          }`}
                        >
                          {plug.enabled ? 'Ativo' : 'Pausado'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{plug.description}</p>

                {editingPluginId === plug.id && (
                  <div className="pt-2 space-y-2">
                    <textarea
                      rows={3}
                      value={pluginConfigDraft}
                      onChange={(e) => setPluginConfigDraft(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-200"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingPluginId(null)}
                        className="px-2.5 py-1 text-xs text-slate-400"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSavePluginConfig(plug.id)}
                        className="px-3 py-1 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-md"
                      >
                        Guardar Config
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500 tabular-nums">
                <span>Autor: {plug.author}</span>
                <span>{plug.invocationsCount || 0} execuções registadas</span>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* TAB 4: External Channels & Owner Allow-List */}
      {activeTab === 'channels' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 jarvis-surface border border-slate-800/80 rounded-xl p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-100 font-display">
                Canais Externos & Regra Owner Allow-List
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                O 1.º ID da lista é o Owner com poder de aprovação; canais sem Allow-List ficam
                bloqueados preventivamente.
              </p>
            </div>

            <div className="divide-y divide-slate-800/70">
              {store.channels.map((ch) => {
                const hasAllowList = ch.ownerAllowList.length > 0;
                const ownerId = ch.ownerAllowList[0];
                return (
                  <div key={ch.id} className="py-4 first:pt-1 last:pb-0 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          {hasAllowList && ch.enabled ? (
                            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                          )}
                          <p className="text-sm font-medium text-slate-100">{ch.name}</p>
                        </div>
                        <p className="text-xs font-mono text-slate-400">
                          {ch.platform} · {ch.endpointOrBotTag}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingChannelId(editingChannelId === ch.id ? null : ch.id);
                            setAllowListInput(ch.ownerAllowList.join(', '));
                          }}
                          className="px-2.5 py-1 text-xs bg-[#141b25] border border-slate-700 rounded-md text-slate-200 hover:border-cyan-500/50 whitespace-nowrap"
                        >
                          Editar Allow-List
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleChannel(ch.id, !ch.enabled)}
                          className={`px-2.5 py-1 text-xs rounded-md border font-mono ${
                            ch.enabled
                              ? 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10'
                              : 'border-slate-700 text-slate-500'
                          }`}
                        >
                          {ch.enabled ? 'On' : 'Off'}
                        </button>
                      </div>
                    </div>

                    {hasAllowList ? (
                      <p className="text-xs text-slate-400 font-mono">
                        Owner (#1): <span className="text-emerald-300">{ownerId}</span>
                        {ch.ownerAllowList.length > 1
                          ? ` · Outros autorizados: ${ch.ownerAllowList.slice(1).join(', ')}`
                          : ''}
                      </p>
                    ) : (
                      <p className="text-xs text-rose-400">
                        Bloqueio Preventivo Ativo: Nenhuma entrada definida na Owner Allow-List.
                      </p>
                    )}

                    {editingChannelId === ch.id && (
                      <div className="flex gap-2 pt-1">
                        <input
                          type="text"
                          value={allowListInput}
                          onChange={(e) => setAllowListInput(e.target.value)}
                          placeholder="owner_id_1, membro_id_2..."
                          className="flex-1 px-3 py-1.5 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveAllowList(ch.id)}
                          className="px-3 py-1.5 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg"
                        >
                          Guardar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="lg:col-span-5 jarvis-surface border border-slate-800/80 rounded-xl p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-100 font-display">
                Simulador & Testador de Webhook
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Testa a validação de remetente (Owner vs Intruso) e resposta do Gateway.
              </p>
            </div>

            <form onSubmit={handleSimulateWebhook} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Canal Alvo</label>
                <select
                  value={simChannelId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSimChannelId(id);
                    const found = store.channels.find((c) => c.id === id);
                    setSimSenderId(found?.ownerAllowList[0] || 'intruder_999');
                  }}
                  className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-200"
                >
                  {store.channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.platform})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Sender ID</label>
                <input
                  type="text"
                  value={simSenderId}
                  onChange={(e) => setSimSenderId(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Payload da Mensagem
                </label>
                <input
                  type="text"
                  value={simMessage}
                  onChange={(e) => setSimMessage(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
                />
              </div>

              <button
                type="submit"
                disabled={simBusy}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {simBusy ? 'A processar payload...' : 'Disparar Evento Inbound'}
              </button>
            </form>

            {simResult && (
              <div className="p-3.5 rounded-lg bg-[#07090e] border border-slate-800 space-y-2 text-xs">
                <p className="font-mono">
                  Veredicto:{' '}
                  <span className={simResult.verdict.allowed ? 'text-emerald-400' : 'text-rose-400'}>
                    {simResult.verdict.reason}
                  </span>
                  {simResult.verdict.isOwner ? ' (Privilégio OWNER)' : ''}
                </p>
                {simResult.reply && (
                  <p className="text-slate-300 whitespace-pre-wrap border-t border-slate-800 pt-2">
                    {simResult.reply}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Create Skill Modal */}
      {showSkillModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Criar Nova Skill"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
          onClick={() => setShowSkillModal(false)}
        >
          <form
            onSubmit={handleCreateSkill}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg jarvis-surface border border-slate-800 rounded-xl p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100 font-display">
                Nova Skill Modular OpenClaw
              </h3>
              <button
                type="button"
                onClick={() => setShowSkillModal(false)}
                aria-label="Fechar modal"
                className="text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              required
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              placeholder="Nome da Skill (ex.: Revisor de Segurança SQL)"
              className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
            />
            <input
              type="text"
              value={skillDesc}
              onChange={(e) => setSkillDesc(e.target.value)}
              placeholder="Descrição curta..."
              className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
            />
            <input
              type="text"
              value={skillCmd}
              onChange={(e) => setSkillCmd(e.target.value)}
              placeholder="Comando rápido (ex.: /review-sql)"
              className="w-full px-3 py-2 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
            />
            <textarea
              rows={3}
              required
              value={skillInstr}
              onChange={(e) => setSkillInstr(e.target.value)}
              placeholder="Instruções de sistema detalhadas para o agente..."
              className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSkillModal(false)}
                className="px-4 py-2 text-xs text-slate-300 bg-[#141b25] rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg"
              >
                Registar Skill
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Create Plugin Modal */}
      {showPluginModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Registar Novo Plugin"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
          onClick={() => setShowPluginModal(false)}
        >
          <form
            onSubmit={handleCreatePlugin}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg jarvis-surface border border-slate-800 rounded-xl p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100 font-display">
                Registar Plugin de Ciclo de Vida
              </h3>
              <button
                type="button"
                onClick={() => setShowPluginModal(false)}
                aria-label="Fechar modal"
                className="text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              required
              value={pluginName}
              onChange={(e) => setPluginName(e.target.value)}
              placeholder="Nome do Plugin (ex.: Telemetria Sidecar Auto-Log)"
              className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={pluginHook}
                onChange={(e) => setPluginHook(e.target.value as PluginLifecycleHook)}
                className="px-3 py-2 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-200"
              >
                <option value="PRE_PROMPT">PRE_PROMPT</option>
                <option value="POST_TURN">POST_TURN</option>
                <option value="ON_PROACTIVE_SCAN">ON_PROACTIVE_SCAN</option>
                <option value="ON_HEARTBEAT">ON_HEARTBEAT</option>
                <option value="SIDECAR_BRIDGE">SIDECAR_BRIDGE</option>
                <option value="SECURITY_GATE">SECURITY_GATE</option>
              </select>
              <select
                value={pluginCategory}
                onChange={(e) => setPluginCategory(e.target.value as PluginItem['category'])}
                className="px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-200"
              >
                <option value="WORKFLOW">WORKFLOW</option>
                <option value="COGNITIVE">COGNITIVE</option>
                <option value="SIDECAR_HOST">SIDECAR_HOST</option>
                <option value="SECURITY">SECURITY</option>
                <option value="TELEMETRY">TELEMETRY</option>
              </select>
            </div>
            <textarea
              rows={3}
              value={pluginDesc}
              onChange={(e) => setPluginDesc(e.target.value)}
              placeholder="Descrição do comportamento injetado pelo hook..."
              className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPluginModal(false)}
                className="px-4 py-2 text-xs text-slate-300 bg-[#141b25] rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg"
              >
                Ativar Plugin
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
