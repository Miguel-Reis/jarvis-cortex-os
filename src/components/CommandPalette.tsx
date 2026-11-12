import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Play, MessageSquare, Brain, ArrowRight, Moon, X, FolderGit2 } from 'lucide-react';
import type { JarvisStoreData } from '../shared/types';
import type { NavSectionId } from '../lib/i18n';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  store: JarvisStoreData;
  onNavigate: (section: NavSectionId, subId?: string) => void;
  onSwitchProject?: (projectId: string) => void;
  onRunWorkflow: (workflowId: string) => void;
  onQuickDirective: (text: string) => void;
  onToggleFocusMode: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  store,
  onNavigate,
  onSwitchProject,
  onRunWorkflow,
  onQuickDirective,
  onToggleFocusMode,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const navItems: { id: NavSectionId; label: string; hint: string }[] = [
    { id: 'studio', label: 'Ir para Estúdio de Ideias & Projetos', hint: 'Conversas · Goals · Sub-Agentes · Ecrã em Direto' },
    { id: 'llm', label: 'Ir para Motores LLM, Custos & Conectividade', hint: 'Gemini · OpenRouter · Antigravity MCP · Ollama · Local' },
    { id: 'mcp', label: 'Ir para Gateway Nativo MCP 2026', hint: '18 Tools · 6 Recursos · Biblioteca Standard' },
    { id: 'skills', label: 'Ir para Skills, Biblioteca & Plugins', hint: 'Skills Standard · Hooks · Canais' },
    { id: 'devices', label: 'Ir para Máquina & Desktop Sidecar', hint: 'Controlo Direto · Janelas · Processos · Hotkeys' },
    { id: 'brain', label: 'Ir para Cérebro do J.A.R.V.I.S.', hint: 'Nativo v7.2 · Ponte :8765 · JEV-S1 · Ebbinghaus' },
    { id: 'memory', label: 'Ir para Memory Vault & Grafo HippoRAG 2', hint: '4-Way RRF · 128-Bit BQ · Provenance' },
    { id: 'workflows', label: 'Ir para Workflows & Automação Cron', hint: 'DAG · Heartbeat' },
    { id: 'swarm', label: 'Ir para Enxame Swarm 48x & Escritório 3D', hint: 'SCOUT-01 · CoW Sandboxes · Verify Gates' },
    { id: 'orbit', label: 'Ir para Orbit Agent OS', hint: 'DOTS · Self-Learn · Quota 5h & ROI' },
    { id: 'brief', label: 'Ir para Brief & Comando Executivo', hint: 'Q-18 · Proatividade · Contratos' },
    { id: 'workspace', label: 'Ir para Projetos, AST & Terminal', hint: 'Multi-Projeto · Co-Change · Git' },
    { id: 'chat', label: 'Ir para Agentes & Salas Táticas', hint: 'Recrutar Agentes · Multimodal · ReAct' },
    { id: 'authority', label: 'Ir para Definições, IA & Autoridade', hint: 'Motores IA · Allow-List · Canary · Backup' },
  ];

  const q = query.toLowerCase().trim();

  const filteredNav = useMemo(
    () => navItems.filter((n) => !q || n.label.toLowerCase().includes(q) || n.hint.toLowerCase().includes(q)),
    [q]
  );

  const filteredProjects = useMemo(
    () =>
      (store.projects || []).filter(
        (p) => !q || p.name.toLowerCase().includes(q) || p.rootPath.toLowerCase().includes(q)
      ),
    [q, store.projects]
  );

  const filteredWorkflows = useMemo(
    () =>
      store.workflows
        .filter((w) => !q || w.name.toLowerCase().includes(q) || w.description.toLowerCase().includes(q))
        .slice(0, 4),
    [q, store.workflows]
  );

  const filteredRooms = useMemo(
    () => store.rooms.filter((r) => !q || r.name.toLowerCase().includes(q) || r.roleTitle.toLowerCase().includes(q)),
    [q, store.rooms]
  );

  const filteredMemories = useMemo(
    () =>
      store.memories
        .filter((m) => q && (m.topic.toLowerCase().includes(q) || m.content.toLowerCase().includes(q)))
        .slice(0, 4),
    [q, store.memories]
  );

  if (!open) return null;

  const handleDirectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    onQuickDirective(query.trim());
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/75 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl studio-card rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleDirectSubmit} className="flex items-center gap-3 px-4 py-3.5 border-b border-white/8">
          <Search className="w-4 h-4 text-[#e59a54] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Alternar projeto, criar conversa, abrir Gateway MCP ou enviar diretiva..."
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          {query.trim() && (
            <button
              type="submit"
              className="px-2.5 py-1 text-xs font-medium bg-[#e59a54] text-slate-950 rounded-md hover:bg-[#eba868] transition-colors whitespace-nowrap shrink-0"
            >
              Enviar ao Jarvis
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar Command Palette"
            className="p-1 text-slate-500 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </form>

        <div className="max-h-[65vh] overflow-y-auto divide-y divide-slate-800/70">
          {(!q || 'modo foco noturno focus night'.includes(q)) && (
            <div className="p-3">
              <button
                type="button"
                onClick={() => {
                  onToggleFocusMode();
                  onClose();
                }}
                className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-left hover:bg-[#151c26] transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Moon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-sm text-slate-200 truncate">
                    {store.settings.focusModeEnabled
                      ? 'Desativar Modo Foco Noturno'
                      : 'Ativar Modo Foco (Sessão Noturna · Baixa Fadiga Ocular)'}
                  </span>
                </div>
                <span className="text-xs text-slate-500 font-mono shrink-0">Ctrl+Shift+F</span>
              </button>
            </div>
          )}

          {onSwitchProject && filteredProjects.length > 0 && (
            <div className="p-3">
              <p className="px-2 pb-1.5 text-xs font-medium text-slate-400">Projetos Simultâneos</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {filteredProjects.map((proj) => {
                  const isActive = proj.id === store.activeProjectId;
                  return (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => {
                        onSwitchProject(proj.id);
                        onClose();
                      }}
                      className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-[#151c26] transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderGit2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span className="text-xs font-medium text-slate-200 truncate">{proj.name}</span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 shrink-0">
                        {isActive ? 'ATIVO' : proj.rootPath}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {filteredRooms.length > 0 && (
            <div className="p-3">
              <p className="px-2 pb-1.5 text-xs font-medium text-slate-400">Agentes & Salas Especialistas</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {filteredRooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => {
                      onNavigate('chat', room.id);
                      onClose();
                    }}
                    className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-[#151c26] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="text-xs font-medium text-slate-200 truncate">{room.name}</span>
                    </div>
                    <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredWorkflows.length > 0 && (
            <div className="p-3">
              <p className="px-2 pb-1.5 text-xs font-medium text-slate-400">Disparar Workflows</p>
              <div className="space-y-1">
                {filteredWorkflows.map((wf) => (
                  <button
                    key={wf.id}
                    type="button"
                    onClick={() => {
                      onRunWorkflow(wf.id);
                      onClose();
                    }}
                    className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-left hover:bg-[#151c26] transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Play className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="text-sm text-slate-200 truncate">{wf.name}</span>
                    </div>
                    <span className="text-xs text-slate-500 font-mono shrink-0">{wf.cronExpr || 'Manual'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredMemories.length > 0 && (
            <div className="p-3">
              <p className="px-2 pb-1.5 text-xs font-medium text-slate-400">Memórias Encontradas no Vault</p>
              <div className="space-y-1">
                {filteredMemories.map((mem) => (
                  <button
                    key={mem.id}
                    type="button"
                    onClick={() => {
                      onNavigate('memory', mem.id);
                      onClose();
                    }}
                    className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-[#151c26] transition-colors"
                  >
                    <Brain className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-200 truncate">{mem.topic}</p>
                      <p className="text-xs text-slate-500 truncate">{mem.content}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredNav.length > 0 && (
            <div className="p-3">
              <p className="px-2 pb-1.5 text-xs font-medium text-slate-400">Navegação Rápida</p>
              <div className="space-y-0.5">
                {filteredNav.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigate(item.id);
                      onClose();
                    }}
                    className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-left hover:bg-[#151c26] transition-colors"
                  >
                    <span className="text-xs text-slate-200">{item.label}</span>
                    <span className="text-xs text-slate-500">{item.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
