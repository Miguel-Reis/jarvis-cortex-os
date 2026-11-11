import React, { useCallback, useEffect, useState } from 'react';
import {
  Code2,
  FileCode2,
  Folder,
  FolderGit2,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { apiJson } from '../../lib/api';
import { useToast } from '../ToastContext';
import type {
  CoChangeEdge,
  JarvisStoreData,
  ProjectWorkspace,
  ScoutSymbolEntry,
} from '../../shared/types';

interface FileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
}

interface BlastRadiusReport {
  targetPath: string;
  blastRadiusScore: number;
  symbolsInFile: ScoutSymbolEntry[];
  importedBy: string[];
  imports: string[];
  coChangedFiles: CoChangeEdge[];
}

interface WorkspaceViewProps {
  store: JarvisStoreData;
  initialFilePath?: string;
  onRefreshBootstrap: () => Promise<void>;
  onOpenProjectsModal?: () => void;
}

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  store,
  initialFilePath,
  onRefreshBootstrap,
  onOpenProjectsModal,
}) => {
  const { pushToast } = useToast();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [gitInfo, setGitInfo] = useState<{
    branch: string;
    statusLines: string[];
    recentCommits: string[];
  }>({ branch: 'main', statusLines: [], recentCommits: [] });
  const [selectedFile, setSelectedFile] = useState<string>(initialFilePath || 'AGENTS.md');
  const [fileContent, setFileContent] = useState<string>('');
  const [fileFilter, setFileFilter] = useState('');

  const [fileSymbols, setFileSymbols] = useState<ScoutSymbolEntry[]>([]);
  const [blastRadius, setBlastRadius] = useState<BlastRadiusReport | null>(null);

  const [commandInput, setCommandInput] = useState('python3 -m unittest discover -s tests -v');
  const [terminalOutput, setTerminalOutput] = useState<string>(
    'Consola Governada J.A.R.V.I.S. pronta. Comandos de leitura/testes executam diretamente; comandos mutáveis requerem aprovação na Inbox de Autoridade.'
  );
  const [runningCmd, setRunningCmd] = useState(false);
  const [scanningProj, setScanningProj] = useState(false);

  const projects = store.projects || [];
  const activeProject =
    projects.find((p) => p.id === store.activeProjectId) || projects[0];

  const loadFile = useCallback(async (relPath: string) => {
    setSelectedFile(relPath);
    try {
      const [fileRes, blastRes] = await Promise.all([
        apiJson<{ content: string }>(`/api/workspace/file?path=${encodeURIComponent(relPath)}`),
        apiJson<BlastRadiusReport>(
          `/api/workspace/blast-radius?path=${encodeURIComponent(relPath)}`
        ),
      ]);
      setFileContent(fileRes.content);
      setFileSymbols(blastRes.symbolsInFile || []);
      setBlastRadius(blastRes);
    } catch (err) {
      setFileContent(`Erro: ${(err as Error).message}`);
      setFileSymbols([]);
      setBlastRadius(null);
    }
  }, []);

  const loadOverview = useCallback(
    async (projectId?: string, autoSelectFirst = false) => {
      try {
        const pid = projectId || activeProject?.id || '';
        const res = await apiJson<{
          files: FileEntry[];
          git: { branch: string; statusLines: string[]; recentCommits: string[] };
        }>(`/api/workspace/overview?projectId=${encodeURIComponent(pid)}`);
        setFiles(res.files);
        setGitInfo(res.git);

        const firstFile = res.files.find((f) => !f.isDirectory);
        if (autoSelectFirst && firstFile) {
          loadFile(firstFile.path);
        }
      } catch (err) {
        pushToast({
          title: 'Erro ao ler workspace',
          detail: (err as Error).message,
          tone: 'error',
        });
      }
    },
    [activeProject?.id, loadFile, pushToast]
  );

  useEffect(() => {
    loadOverview(activeProject?.id, false);
  }, [activeProject?.id, loadOverview]);

  useEffect(() => {
    loadFile(initialFilePath || 'AGENTS.md');
  }, [initialFilePath, loadFile]);

  const handleSwitchProject = async (proj: ProjectWorkspace) => {
    await apiJson(`/api/projects/${proj.id}/activate`, { method: 'POST' });
    await onRefreshBootstrap();
    await loadOverview(proj.id, true);
  };

  const handleToggleProjectProactive = async () => {
    if (!activeProject) return;
    await apiJson(`/api/projects/${activeProject.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ proactiveEnabled: !activeProject.proactiveEnabled }),
    });
    await onRefreshBootstrap();
    pushToast({
      title: !activeProject.proactiveEnabled
        ? `Proatividade ativada em ${activeProject.name}`
        : `Proatividade pausada em ${activeProject.name}`,
      tone: 'info',
    });
  };

  const handleScanProjectNow = async () => {
    if (!activeProject) return;
    setScanningProj(true);
    try {
      await apiJson('/api/projects/proactive-scan', {
        method: 'POST',
        body: JSON.stringify({ projectId: activeProject.id }),
      });
      await onRefreshBootstrap();
      pushToast({
        title: `Scan proativo concluído: ${activeProject.name}`,
        tone: 'success',
      });
    } finally {
      setScanningProj(false);
    }
  };

  const handleRunCommand = async (cmdOverride?: string) => {
    const cmd = (cmdOverride ?? commandInput).trim();
    if (!cmd || runningCmd) return;
    if (cmdOverride) setCommandInput(cmdOverride);
    setRunningCmd(true);
    try {
      const res = await apiJson<{
        result: { status: string; output: string; exitCode: number; durationMs: number };
      }>('/api/workspace/exec', {
        method: 'POST',
        body: JSON.stringify({ command: cmd }),
      });
      setTerminalOutput(
        `$ ${cmd}\n[${res.result.status} · Exit ${res.result.exitCode} · ${res.result.durationMs}ms]\n\n${res.result.output}`
      );
      await onRefreshBootstrap();
      await loadOverview();

      if (res.result.status === 'PENDING_APPROVAL') {
        pushToast({
          title: 'Comando enviado para Inbox de Autoridade',
          detail: 'Aprova em Definições & Autoridade para executar.',
          tone: 'warning',
        });
      }
    } catch (err) {
      pushToast({
        title: 'Erro ao executar comando',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setRunningCmd(false);
    }
  };

  const visibleFiles = files.filter(
    (f) =>
      !f.isDirectory && (!fileFilter || f.path.toLowerCase().includes(fileFilter.toLowerCase()))
  );

  const presetDiagnostics = [
    { label: 'Testes Python (jarvis_os)', cmd: 'python3 -m unittest discover -s tests -v' },
    { label: 'Testes Core TS (node:test)', cmd: 'npx --yes tsx --test src/shared/cortex-math.test.ts' },
    { label: 'Git Status', cmd: 'git status --short' },
    { label: 'Últimos Commits', cmd: 'git log -n 5 --oneline' },
  ];

  return (
    <div className="space-y-6">
      {/* Concurrent Multi-Project Workspace Bar */}
      <section className="jarvis-surface border border-slate-800/80 rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mr-1">
              <FolderGit2 className="w-4 h-4 text-cyan-400" />
              Projetos em Simultâneo:
            </span>
            {projects.map((proj) => {
              const active = proj.id === activeProject?.id;
              return (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => handleSwitchProject(proj)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-[#141b25] border-cyan-500/60 text-cyan-300'
                      : 'bg-[#07090e] border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {proj.name}{' '}
                  <span className="font-mono text-[11px] opacity-75">({proj.rootPath})</span>
                </button>
              );
            })}
            {onOpenProjectsModal && (
              <button
                type="button"
                onClick={onOpenProjectsModal}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#141b25] border border-slate-700 text-slate-200 hover:border-cyan-500/50"
              >
                <Plus className="w-3.5 h-3.5 text-cyan-400" />
                Novo Projeto
              </button>
            )}
          </div>

          {activeProject && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleToggleProjectProactive}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                  activeProject.proactiveEnabled
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                    : 'bg-[#07090e] border-slate-800 text-slate-400'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                {activeProject.proactiveEnabled ? 'Proatividade ON' : 'Proatividade OFF'}
              </button>
              <button
                type="button"
                disabled={scanningProj}
                onClick={handleScanProjectNow}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#141b25] border border-slate-700 text-slate-200 hover:border-cyan-500/50"
              >
                {scanningProj ? 'A analisar...' : 'Scan Projeto'}
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* File Explorer */}
        <section className="lg:col-span-4 jarvis-surface border border-slate-800/80 rounded-xl p-5 flex flex-col gap-3 max-h-[560px]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-100 font-display flex items-center gap-2">
              <Folder className="w-4 h-4 text-cyan-400" />
              Ficheiros ({activeProject?.rootPath || '.'})
            </h2>
            <button
              type="button"
              onClick={() => loadOverview(activeProject?.id, false)}
              aria-label="Atualizar árvore de ficheiros"
              className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md hover:bg-[#141b25]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <input
            type="text"
            value={fileFilter}
            onChange={(e) => setFileFilter(e.target.value)}
            placeholder="Filtrar caminho (ex.: jarvis_os, server.ts)..."
            className="w-full px-3 py-1.5 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />

          <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
            {visibleFiles.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => loadFile(f.path)}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors ${
                  selectedFile === f.path
                    ? 'bg-cyan-500/15 text-cyan-200 font-medium'
                    : 'text-slate-300 hover:bg-[#141b25]'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <FileCode2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="truncate font-mono">{f.path}</span>
                </span>
                <span className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                  {Math.max(1, Math.round(f.sizeBytes / 1024))} KB
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Code / Markdown Viewer + SCOUT-01 AST (:Lstart-end) Strip */}
        <section className="lg:col-span-8 jarvis-surface border border-slate-800/80 rounded-xl p-5 flex flex-col gap-3 max-h-[560px]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2 min-w-0 text-xs font-mono">
              <span className="text-cyan-300 truncate">{selectedFile}</span>
              {blastRadius && (
                <>
                  <span className="text-slate-600">·</span>
                  <span
                    className={
                      blastRadius.blastRadiusScore >= 6
                        ? 'text-rose-300'
                        : blastRadius.blastRadiusScore >= 3.5
                          ? 'text-amber-300'
                          : 'text-emerald-300'
                    }
                  >
                    Blast {blastRadius.blastRadiusScore}/10
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400">{fileSymbols.length} símbolos AST</span>
                </>
              )}
            </div>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {fileContent.split('\n').length} linhas
            </span>
          </div>

          {fileSymbols.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <Code2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              {fileSymbols.slice(0, 12).map((sym) => (
                <span
                  key={sym.id}
                  className="px-2 py-0.5 text-[11px] font-mono rounded bg-[#07090e] border border-slate-800 text-slate-300 whitespace-nowrap shrink-0"
                >
                  {sym.name}:L{sym.startLine}-{sym.endLine}
                </span>
              ))}
            </div>
          )}

          {blastRadius &&
            (blastRadius.importedBy.length > 0 || blastRadius.coChangedFiles.length > 0) && (
              <div className="px-3 py-1.5 rounded-lg bg-[#07090e] border border-slate-800 flex items-center gap-2 text-xs font-mono text-amber-300">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  Dependentes: {blastRadius.importedBy.length} ficheiro(s) · Co-Change:{' '}
                  {blastRadius.coChangedFiles
                    .slice(0, 3)
                    .map((c) => (c.fileA === selectedFile ? c.fileB : c.fileA))
                    .join(', ') || 'nenhum'}
                </span>
              </div>
            )}

          <pre className="flex-1 overflow-auto p-3.5 rounded-lg bg-[#07090e] border border-slate-800/80 text-xs text-slate-300 leading-relaxed">
            {fileContent}
          </pre>
        </section>
      </div>

      {/* Bottom Split: Governed Diagnostic Console + Git Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 jarvis-surface border border-slate-800/80 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-100 font-display flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              Terminal de Diagnóstico Governado
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {presetDiagnostics.map((preset) => (
                <button
                  key={preset.cmd}
                  type="button"
                  disabled={runningCmd}
                  onClick={() => handleRunCommand(preset.cmd)}
                  className="px-2.5 py-1 text-xs bg-[#141b25] border border-slate-800 hover:border-cyan-500/50 rounded-md text-slate-300 whitespace-nowrap"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRunCommand();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="Comando a executar ou submeter a aprovação..."
              className="flex-1 px-3 py-2 text-xs font-mono bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={runningCmd || !commandInput.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 disabled:opacity-40 whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              {runningCmd ? 'A correr...' : 'Executar'}
            </button>
          </form>

          <pre className="p-4 rounded-lg bg-[#07090e] border border-slate-800 text-xs text-slate-300 max-h-60 overflow-auto whitespace-pre-wrap">
            {terminalOutput}
          </pre>
        </section>

        <section className="lg:col-span-5 jarvis-surface border border-slate-800/80 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100 font-display flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-amber-400" />
              Inspetor Git ({gitInfo.branch})
            </h3>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {gitInfo.statusLines.length} modificados
            </span>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-400">Working Tree Status</p>
            <div className="p-3 rounded-lg bg-[#07090e] border border-slate-800 text-xs font-mono text-slate-300 max-h-28 overflow-y-auto">
              {gitInfo.statusLines.length > 0
                ? gitInfo.statusLines.map((l, idx) => <div key={idx}>{l}</div>)
                : 'Working tree limpa.'}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-400">Últimos Commits</p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {gitInfo.recentCommits.length > 0 ? (
                gitInfo.recentCommits.map((c, idx) => (
                  <p key={idx} className="text-xs font-mono text-slate-400 truncate">
                    {c}
                  </p>
                ))
              ) : (
                <p className="text-xs text-slate-500">
                  Sem histórico de commits visível neste contentor.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
