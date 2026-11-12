import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  CheckCircle2,
  GitCommitHorizontal,
  HelpCircle,
  History,
  Layers,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { apiJson, compactMemoryVaultApi } from '../../lib/api';
import { useToast } from '../ToastContext';
import { computeEbbinghausRetention } from '../../shared/cortex-math';
import type {
  GraphNodeComputed,
  JarvisStoreData,
  MemoryCategory,
  MemoryRankedHit,
  MemoryTier,
} from '../../shared/types';

interface MemoryGraphViewProps {
  store: JarvisStoreData;
  initialSeedId?: string;
  pprNodesInitial: GraphNodeComputed[];
  onRefreshBootstrap: () => Promise<void>;
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  category: MemoryCategory;
  pprScore: number;
  pinned: boolean;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  id: string;
  relation: string;
  weight: number;
}

function getEndpointId(endpoint: string | number | D3Node): string {
  if (typeof endpoint === 'object' && endpoint !== null) {
    return endpoint.id;
  }
  return String(endpoint);
}

export const MemoryGraphView: React.FC<MemoryGraphViewProps> = ({
  store,
  initialSeedId,
  pprNodesInitial,
  onRefreshBootstrap,
}) => {
  const { pushToast } = useToast();
  const [search, setSearch] = useState('');
  const [provenanceFilter, setProvenanceFilter] = useState<'ALL' | 'CONFIRMED' | 'INFERRED'>('ALL');
  const [tierFilter, setTierFilter] = useState<'ALL' | MemoryTier>('ALL');
  const [includeHistory, setIncludeHistory] = useState(false);
  const [rrfHits, setRrfHits] = useState<MemoryRankedHit[] | null>(null);

  const [seedNodeId, setSeedNodeId] = useState<string | undefined>(initialSeedId);
  const [pprNodes, setPprNodes] = useState<GraphNodeComputed[]>(pprNodesInitial);
  const [syncingBrain, setSyncingBrain] = useState(false);
  const [compactingVault, setCompactingVault] = useState(false);

  // Shortest Path BFS state
  const [pathFromId, setPathFromId] = useState<string>(store.memories[0]?.id || '');
  const [pathToId, setPathToId] = useState<string>(
    store.memories[1]?.id || store.memories[0]?.id || ''
  );
  const [shortestPathResult, setShortestPathResult] = useState<{
    found: boolean;
    nodeIds: string[];
    relations: string[];
  } | null>(null);

  // Create Memory Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTopic, setNewTopic] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryCategory>('FACT');
  const [newTier, setNewTier] = useState<MemoryTier>('SEMANTIC');
  const [newProvenance, setNewProvenance] = useState<'CONFIRMED' | 'INFERRED'>('CONFIRMED');
  const [newTags, setNewTags] = useState('');

  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    setPprNodes(pprNodesInitial);
  }, [pprNodesInitial]);

  useEffect(() => {
    if (initialSeedId) {
      handleSelectSeed(initialSeedId);
    }
  }, [initialSeedId]);

  // Trigger 4-Way Weighted RRF search whenever search query or includeHistory changes
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setRrfHits(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({
          q,
          includeSuperseded: includeHistory ? 'true' : 'false',
          ...(seedNodeId ? { seedId: seedNodeId } : {}),
        });
        const res = await apiJson<{ hits: MemoryRankedHit[] }>(
          `/api/memories/search-rrf?${qs.toString()}`
        );
        if (!cancelled) setRrfHits(res.hits);
      } catch {
        if (!cancelled) setRrfHits(null);
      }
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, includeHistory, seedNodeId, store.memories]);

  const handleSelectSeed = async (id?: string) => {
    setSeedNodeId(id);
    try {
      const params = new URLSearchParams();
      if (id) params.set('seedId', id);
      if (includeHistory) params.set('includeSuperseded', 'true');
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await apiJson<{ nodes: GraphNodeComputed[] }>(`/api/memories/graph${qs}`);
      setPprNodes(res.nodes);
    } catch {
      // Keep existing nodes
    }
  };

  const handleFindShortestPath = async () => {
    if (!pathFromId || !pathToId) return;
    try {
      const res = await apiJson<{
        found: boolean;
        nodeIds: string[];
        relations: string[];
      }>(
        `/api/memories/path?from=${encodeURIComponent(pathFromId)}&to=${encodeURIComponent(
          pathToId
        )}`
      );
      if (!res.found) {
        setShortestPathResult(null);
        pushToast({
          title: 'Sem caminho associativo direto',
          detail: 'Estes dois nós pertencem a subgrafos disjuntos.',
          tone: 'info',
        });
      } else {
        setShortestPathResult(res);
      }
    } catch (err) {
      pushToast({ title: 'Erro no cálculo BFS', detail: (err as Error).message, tone: 'error' });
    }
  };

  // Interactive D3.js Force-Directed HippoRAG 2 PPR Graph
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || pprNodes.length === 0) return;

    const width = svgEl.clientWidth || 640;
    const height = 340;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const highlightSet = new Set(shortestPathResult?.nodeIds || []);
    const nodes: D3Node[] = pprNodes.map((n) => ({ ...n }));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links: D3Link[] = store.graphEdges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        relation: e.relation,
        weight: e.weight,
      }));

    const simulation = d3
      .forceSimulation<D3Node>(nodes)
      .force(
        'link',
        d3
          .forceLink<D3Node, D3Link>(links)
          .id((d) => d.id)
          .distance(118)
      )
      .force('charge', d3.forceManyBody().strength(-330))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(48));

    const linkGroup = svg
      .append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', (l) => {
        const sId = getEndpointId(l.source);
        const tId = getEndpointId(l.target);
        return highlightSet.has(sId) && highlightSet.has(tId)
          ? '#f59e0b'
          : 'rgba(148, 163, 184, 0.28)';
      })
      .attr('stroke-width', (l) => {
        const sId = getEndpointId(l.source);
        const tId = getEndpointId(l.target);
        return highlightSet.has(sId) && highlightSet.has(tId) ? 2.4 : 1.3;
      });

    const nodeGroup = svg
      .append('g')
      .selectAll<SVGGElement, D3Node>('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        handleSelectSeed(d.id === seedNodeId ? undefined : d.id);
      })
      .call(
        d3
          .drag<SVGGElement, D3Node>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    nodeGroup
      .append('circle')
      .attr('r', (d) => Math.max(9, Math.min(22, 9 + d.pprScore * 28)))
      .attr('fill', (d) =>
        d.id === seedNodeId || highlightSet.has(d.id)
          ? '#f59e0b'
          : d.category === 'ENTITY'
            ? '#06b6d4'
            : d.category === 'COMMITMENT'
              ? '#10b981'
              : '#38bdf8'
      )
      .attr('fill-opacity', 0.88)
      .attr('stroke', (d) =>
        d.id === seedNodeId || highlightSet.has(d.id) ? '#fef3c7' : '#0f172a'
      )
      .attr('stroke-width', 2);

    nodeGroup
      .append('text')
      .text((d) => `${d.label.slice(0, 20)} · ${(d.pprScore * 100).toFixed(1)}%`)
      .attr('x', 0)
      .attr('y', (d) => Math.max(9, Math.min(22, 9 + d.pprScore * 28)) + 15)
      .attr('text-anchor', 'middle')
      .attr('fill', '#e2e8f0')
      .attr('stroke', '#07090e')
      .attr('stroke-width', 3)
      .style('paint-order', 'stroke')
      .attr('font-size', '11px')
      .attr('font-family', 'Plus Jakarta Sans, sans-serif');

    simulation.on('tick', () => {
      linkGroup
        .attr('x1', (d) => (d.source as D3Node).x ?? 0)
        .attr('y1', (d) => (d.source as D3Node).y ?? 0)
        .attr('x2', (d) => (d.target as D3Node).x ?? 0)
        .attr('y2', (d) => (d.target as D3Node).y ?? 0);

      nodeGroup.attr('transform', (d) => {
        const x = Math.max(72, Math.min(width - 72, d.x ?? width / 2));
        const y = Math.max(28, Math.min(height - 34, d.y ?? height / 2));
        return `translate(${x},${y})`;
      });
    });

    return () => {
      simulation.stop();
    };
  }, [pprNodes, store.graphEdges, seedNodeId, shortestPathResult]);

  const displayedEntries = useMemo(() => {
    const baseList = rrfHits
      ? rrfHits.map((h) => ({ mem: h.memory, rrf: h }))
      : store.memories
          .filter((m) => includeHistory || (!m.supersededBy && !m.validUntil))
          .map((m) => ({ mem: m, rrf: null as MemoryRankedHit | null }));

    return baseList.filter(({ mem }) => {
      if (provenanceFilter !== 'ALL' && mem.provenance !== provenanceFilter) return false;
      const tier = mem.tier || 'SEMANTIC';
      if (tierFilter !== 'ALL' && tier !== tierFilter) return false;
      return true;
    });
  }, [rrfHits, store.memories, includeHistory, provenanceFilter, tierFilter]);

  const handleCreateMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTopic.trim() || !newContent.trim()) return;
    try {
      const res = await apiJson<{ supersededIds?: string[] }>('/api/memories', {
        method: 'POST',
        body: JSON.stringify({
          topic: newTopic.trim(),
          content: newContent.trim(),
          category: newCategory,
          tier: newTier,
          provenance: newProvenance,
          tags: newTags,
          linkedMemoryId: seedNodeId || 'mem-core-01',
        }),
      });
      setNewTopic('');
      setNewContent('');
      setNewTags('');
      setShowCreateModal(false);
      await onRefreshBootstrap();
      pushToast({
        title: 'Memória Bi-Temporal guardada (128-Bit BQ)',
        detail:
          res.supersededIds && res.supersededIds.length > 0
            ? `${res.supersededIds.length} memória(s) contraditória(s) arquivada(s) no histórico bi-temporal.`
            : 'Indexada em 4-Way RRF + HippoRAG 2 PPR.',
        tone: 'success',
      });
    } catch (err) {
      pushToast({ title: 'Erro ao gravar memória', detail: (err as Error).message, tone: 'error' });
    }
  };

  const handleTogglePin = async (id: string, pinned: boolean) => {
    await apiJson(`/api/memories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    });
    await onRefreshBootstrap();
  };

  const handleConfirmProvenance = async (id: string) => {
    await apiJson(`/api/memories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ provenance: 'CONFIRMED' }),
    });
    await onRefreshBootstrap();
    pushToast({ title: 'Proveniência promovida para Confirmada', tone: 'success' });
  };

  const handleDeleteMemory = async (id: string) => {
    await apiJson(`/api/memories/${id}`, { method: 'DELETE' });
    await onRefreshBootstrap();
    pushToast({ title: 'Memória removida', tone: 'info' });
  };

  const handleSyncBrain = async () => {
    setSyncingBrain(true);
    try {
      const res = await apiJson<{ online: boolean; message: string }>('/api/memories/sync-brain', {
        method: 'POST',
      });
      await onRefreshBootstrap();
      pushToast({
        title: res.online ? 'Sincronizado com Antigravity Brain :8765' : 'Motor Nativo v7.2 Ativo',
        detail: res.message,
        tone: res.online ? 'success' : 'info',
      });
    } finally {
      setSyncingBrain(false);
    }
  };

  const handleCompactVault = async () => {
    if (compactingVault) return;
    setCompactingVault(true);
    try {
      const res = await compactMemoryVaultApi();
      await onRefreshBootstrap();
      pushToast({
        title: 'Cofre de Memória compactado',
        detail: `Duplicados superados: ${res.duplicatesSuperseded} · Working expiradas: ${res.workingPruned} · Decaídas: ${res.importanceDecayed}`,
        tone: 'success',
      });
    } catch (err) {
      pushToast({
        title: 'Erro ao compactar cofre',
        detail: (err as Error).message,
        tone: 'error',
      });
    } finally {
      setCompactingVault(false);
    }
  };

  const memoryLabelById = (id: string) =>
    store.memories.find((m) => m.id === id)?.topic || id;

  return (
    <div className="space-y-6">
      {/* Interactive HippoRAG 2 PPR Graph + BFS Shortest Path Card */}
      <section className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Grafo Associativo HippoRAG 2 (PPR) & Caminho Mínimo BFS
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Difusão Personalized PageRank (<code className="text-cyan-300">alpha = 0.85</code>) +
              pesquisa de linhagem causal multi-hop entre entidades.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {seedNodeId && (
              <button
                type="button"
                onClick={() => handleSelectSeed(undefined)}
                className="px-3 py-1.5 text-xs bg-[#151c26] border border-amber-500/50 text-amber-300 rounded-lg whitespace-nowrap"
              >
                Limpar Semente PPR
              </button>
            )}
            <button
              type="button"
              disabled={compactingVault}
              onClick={handleCompactVault}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#151c26] border border-slate-700 text-slate-200 rounded-lg hover:border-cyan-500/50 whitespace-nowrap disabled:opacity-50"
            >
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              {compactingVault ? 'A compactar...' : 'Compactar Cofre'}
            </button>
            <button
              type="button"
              disabled={syncingBrain}
              onClick={handleSyncBrain}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#151c26] border border-slate-700 text-slate-200 rounded-lg hover:border-cyan-500/50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingBrain ? 'animate-spin' : ''}`} />
              Sincronizar Brain (:8765)
            </button>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Nova Memória
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className="lg:col-span-8 rounded-xl bg-[#07090e] border border-slate-800 overflow-hidden">
            <svg
              ref={svgRef}
              data-testid="hipporag-d3-graph"
              className="w-full h-[340px] block"
            />
          </div>

          <div className="lg:col-span-4 rounded-xl bg-[#07090e] border border-slate-800 p-4 flex flex-col justify-between gap-3">
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-slate-200">
                Top Ranking PPR {seedNodeId ? '(Focado na Semente)' : '(Global)'}
              </p>
              <div className="space-y-1.5 max-h-[175px] overflow-y-auto pr-1">
                {pprNodes.slice(0, 6).map((node, i) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => handleSelectSeed(node.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border text-left text-xs transition-colors ${
                      seedNodeId === node.id
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-200'
                        : 'bg-[#0d1117] border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="truncate">
                      {i + 1}. {node.label}
                    </span>
                    <span className="font-mono tabular-nums text-cyan-400 shrink-0">
                      {(node.pprScore * 100).toFixed(1)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Multi-Modal BFS Shortest Path Finder */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <p className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <GitCommitHorizontal className="w-3.5 h-3.5 text-amber-400" />
                Caminho Mínimo (BFS)
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  aria-label="Nó de origem"
                  value={pathFromId}
                  onChange={(e) => setPathFromId(e.target.value)}
                  className="px-2 py-1 text-[11px] bg-[#0d1117] border border-slate-800 rounded text-slate-200 truncate"
                >
                  {store.memories.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.topic}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Nó de destino"
                  value={pathToId}
                  onChange={(e) => setPathToId(e.target.value)}
                  className="px-2 py-1 text-[11px] bg-[#0d1117] border border-slate-800 rounded text-slate-200 truncate"
                >
                  {store.memories.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.topic}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleFindShortestPath}
                className="w-full py-1.5 text-xs font-medium bg-[#151c26] border border-slate-700 text-amber-300 rounded-md hover:border-amber-500/50"
              >
                Traçar Rota Causal
              </button>
              {shortestPathResult && (
                <p className="text-[11px] font-mono text-amber-200 truncate">
                  {shortestPathResult.relations.length} salto(s):{' '}
                  {shortestPathResult.nodeIds.map(memoryLabelById).join(' → ')}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Memory Vault 4-Way Weighted RRF + 128-Bit BQ + Ebbinghaus + Bi-Temporal Gate */}
      <section className="bg-[#0d1117] border border-slate-800/80 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-60">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisa 4-Way RRF (BM25 + 128-Bit BQ POPCNT + PPR + Ebbinghaus)..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Tier Filter [W] [E] [S] */}
          <div className="flex items-center gap-1 p-1 bg-[#07090e] border border-slate-800 rounded-lg">
            {(
              [
                ['ALL', 'Tiers'],
                ['WORKING', '[W]'],
                ['EPISODIC', '[E]'],
                ['SEMANTIC', '[S]'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setTierFilter(val)}
                className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors ${
                  tierFilter === val
                    ? 'bg-[#151c26] text-cyan-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Provenance Filter */}
          <div className="flex items-center gap-1 p-1 bg-[#07090e] border border-slate-800 rounded-lg">
            {(
              [
                ['ALL', 'Todas'],
                ['CONFIRMED', 'Confirmadas'],
                ['INFERRED', 'Inferidas'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setProvenanceFilter(val)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  provenanceFilter === val
                    ? 'bg-[#151c26] text-cyan-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Bi-Temporal History Toggle */}
          <button
            type="button"
            onClick={() => setIncludeHistory((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
              includeHistory
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                : 'bg-[#07090e] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            {includeHistory ? 'Histórico Bi-Temporal ON' : 'Ocultar Superadas'}
          </button>
        </div>

        <div className="divide-y divide-slate-800/70">
          {displayedEntries.map(({ mem, rrf }) => {
            const ebb = computeEbbinghausRetention(mem);
            const tier = mem.tier || 'SEMANTIC';
            const isSuperseded = Boolean(mem.supersededBy || mem.validUntil);
            const bqPrefix = (mem.bq128Hex || mem.simHash).slice(0, 12);

            return (
              <div
                key={mem.id}
                className={`py-4 first:pt-1 last:pb-0 flex items-start justify-between gap-4 ${
                  isSuperseded ? 'opacity-65' : ''
                }`}
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {mem.provenance === 'CONFIRMED' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <span className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-[#151c26] border border-slate-700 text-cyan-300">
                      [{tier[0]}]
                    </span>
                    <h4 className="text-sm font-medium text-slate-100 truncate">{mem.topic}</h4>
                    {isSuperseded && (
                      <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-amber-500/10 border border-amber-500/40 text-amber-300">
                        SUPERSEDED → {mem.supersededBy}
                      </span>
                    )}
                    {rrf && (
                      <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-emerald-500/10 border border-emerald-500/35 text-emerald-300">
                        RRF {rrf.rrfScore.toFixed(2)} · BQ {Math.round(rrf.bqSimilarity * 100)}%
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{mem.content}</p>
                  <p className="text-xs text-slate-500 font-mono tabular-nums">
                    {mem.category} · {mem.source === 'REAL' ? 'Real' : 'Demo'} · Retenção Ebbinghaus{' '}
                    {Math.round(ebb.retentionScore * 100)}% (H={ebb.halfLifeDays}d) · BQ128{' '}
                    {bqPrefix}
                    {mem.tags.length > 0 ? ` · #${mem.tags.join(' #')}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {mem.provenance === 'INFERRED' && (
                    <button
                      type="button"
                      onClick={() => handleConfirmProvenance(mem.id)}
                      className="px-2.5 py-1 text-xs bg-[#151c26] border border-emerald-500/40 text-emerald-300 rounded-md hover:bg-emerald-500/15 whitespace-nowrap"
                    >
                      Confirmar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleTogglePin(mem.id, !mem.pinned)}
                    aria-label={mem.pinned ? `Desafixar ${mem.topic}` : `Fixar ${mem.topic}`}
                    className={`p-1.5 rounded-md border transition-colors ${
                      mem.pinned
                        ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                        : 'bg-[#151c26] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Pin className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteMemory(mem.id)}
                    aria-label={`Eliminar ${mem.topic}`}
                    className="p-1.5 rounded-md bg-[#151c26] border border-slate-800 text-slate-400 hover:text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Create Memory Modal */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Registar Nova Memória"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
          onClick={() => setShowCreateModal(false)}
        >
          <form
            onSubmit={handleCreateMemory}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-[#0d1117] border border-slate-800 rounded-xl p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">
                Nova Entrada Bi-Temporal no Memory Vault
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                aria-label="Fechar modal"
                className="text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Tópico / Entidade (se coincidir e contradisser, arquiva a anterior)
              </label>
              <input
                type="text"
                required
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                placeholder="Ex.: Regra de Deploy Sexta-Feira"
                className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Conteúdo Factual</label>
              <textarea
                rows={3}
                required
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Descreve o facto, preferência ou compromisso..."
                className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Categoria</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
                  className="w-full px-2.5 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-200"
                >
                  <option value="FACT">FACT</option>
                  <option value="ENTITY">ENTITY</option>
                  <option value="PREFERENCE">PREFERENCE</option>
                  <option value="DECISION">DECISION</option>
                  <option value="COMMITMENT">COMMITMENT</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Tier Ebbinghaus</label>
                <select
                  value={newTier}
                  onChange={(e) => setNewTier(e.target.value as MemoryTier)}
                  className="w-full px-2.5 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-200"
                >
                  <option value="SEMANTIC">[S] SEMANTIC (120d)</option>
                  <option value="EPISODIC">[E] EPISODIC (14d)</option>
                  <option value="WORKING">[W] WORKING (3d)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Proveniência</label>
                <select
                  value={newProvenance}
                  onChange={(e) => setNewProvenance(e.target.value as 'CONFIRMED' | 'INFERRED')}
                  className="w-full px-2.5 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-200"
                >
                  <option value="CONFIRMED">CONFIRMED</option>
                  <option value="INFERRED">INFERRED</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Tags (separadas por vírgula)
              </label>
              <input
                type="text"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="devops, seguranca, producao"
                className="w-full px-3 py-2 text-xs bg-[#07090e] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-xs text-slate-300 bg-[#151c26] rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400"
              >
                Guardar no Vault
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
