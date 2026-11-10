import React, { useState } from 'react';
import { Plus, ShieldCheck, ShieldAlert, Send, X } from 'lucide-react';
import { apiJson } from '../../lib/api';
import { useToast } from '../ToastContext';
import type { JarvisStoreData } from '../../shared/types';

interface SkillsChannelsViewProps {
  store: JarvisStoreData;
  onRefreshBootstrap: () => Promise<void>;
}

export const SkillsChannelsView: React.FC<SkillsChannelsViewProps> = ({
  store,
  onRefreshBootstrap,
}) => {
  const { pushToast } = useToast();
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [skillName, setSkillName] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillInstr, setSkillInstr] = useState('');
  const [skillCmd, setSkillCmd] = useState('');

  // Channel Allow-List inline editor
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [allowListInput, setAllowListInput] = useState('');

  // Webhook Simulator state
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

  const handleToggleSkill = async (id: string, enabled: boolean) => {
    await apiJson(`/api/skills/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    await onRefreshBootstrap();
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
          allowedTools: ['search_memories', 'get_system_telemetry'],
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
        title: res.verdict.allowed ? 'Evento aceite pelo Gateway' : 'Evento bloqueado pelo Gateway',
        detail: res.verdict.reason,
        tone: res.verdict.allowed ? 'success' : 'warning',
      });
    } finally {
      setSimBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Modular Skills Catalog */}
      <section className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Catálogo Modular de Skills (OpenClaw)</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Instruções especializadas e permissões de ferramentas injetadas dinamicamente no loop ReAct.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSkillModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Criar Nova Skill
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {store.skills.map((skill) => (
            <div
              key={skill.id}
              className="p-4 rounded-xl bg-[#07090e] border border-slate-800 flex flex-col justify-between gap-3"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-100">{skill.name}</h3>
                  <button
                    type="button"
                    onClick={() => handleToggleSkill(skill.id, !skill.enabled)}
                    className={`px-2.5 py-0.5 text-xs rounded border font-mono ${
                      skill.enabled
                        ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                        : 'border-slate-700 text-slate-400 bg-[#151c26]'
                    }`}
                  >
                    {skill.enabled ? 'Ativa' : 'Inativa'}
                  </button>
                </div>
                <p className="text-xs text-slate-400">{skill.description}</p>
                <p className="text-xs text-slate-500 italic">
                  &ldquo;{skill.systemInstruction}&rdquo;
                </p>
              </div>
              <p className="text-xs font-mono text-slate-500 pt-2 border-t border-slate-800/80">
                Comando: <span className="text-cyan-300">{skill.quickCommand}</span> · v{skill.version} ·{' '}
                {skill.allowedTools.join(', ')}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Multi-Channel Gateway + Owner Allow-List Security + Webhook Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Canais Externos & Regra Owner Allow-List
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              O 1.º ID da lista é o Owner com poder de aprovação; canais sem Allow-List ficam bloqueados automaticamente.
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
                        className="px-2.5 py-1 text-xs bg-[#151c26] border border-slate-700 rounded-md text-slate-200 hover:border-cyan-500/50 whitespace-nowrap"
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

        {/* Interactive Webhook Simulator */}
        <section className="lg:col-span-5 bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Simulador & Testador de Webhook</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Testa a validação de remetente (Owner vs Intruso) e resposta em tempo real do Gateway.
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
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Sender ID (experimenta o Owner ID ou um ID desconhecido)
              </label>
              <input
                type="text"
                value={simSenderId}
                onChange={(e) => setSimSenderId(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Payload da Mensagem</label>
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
            className="w-full max-w-lg bg-[#0d1117] border border-slate-800 rounded-xl p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">Nova Skill Modular OpenClaw</h3>
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
                className="px-4 py-2 text-xs text-slate-300 bg-[#151c26] rounded-lg"
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
    </div>
  );
};
