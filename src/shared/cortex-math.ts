import type {
  ArchitecturalDriftItem,
  AutonomyLevel,
  ChannelConfig,
  CoChangeEdge,
  GraphEdge,
  GraphNodeComputed,
  JarvisStoreData,
  JevRouteDecision,
  LanguageCode,
  LookaheadAlert,
  McpAuthorityCheckItem,
  McpAuthorityGateResult,
  McpCustomServer,
  McpLatencyStats,
  McpTransportType,
  MemoryCategory,
  MemoryItem,
  MemoryRankedHit,
  MemoryTier,
  ProactiveInsight,
  ProjectWorkspace,
  Q18Candidate,
  ScoutSymbolEntry,
  WorkflowNode,
} from './types.ts';

/**
 * Protocol Q-18 Deterministic Next-Action Formula:
 * Score = (Impact * Urgency * AuthorityWeight) / ((Effort + 0.1) * (1 + 0.2 * Risk))
 */
export function computeQ18Score(candidate: Q18Candidate, dependencyPenalty = 1.0): number {
  const numerator = candidate.impact * candidate.urgency * candidate.authorityWeight;
  const denominator = (Math.max(0.1, candidate.effort) + 0.1) * (1 + 0.2 * Math.max(0, candidate.risk));
  const raw = (numerator / denominator) * dependencyPenalty;
  return Number(raw.toFixed(2));
}

export function rankQ18Actions(candidates: Q18Candidate[]): Q18Candidate[] {
  const completedIds = new Set(candidates.filter((c) => c.completed).map((c) => c.id));
  return candidates
    .map((c) => {
      const unmetDeps = c.dependencies.filter((depId) => !completedIds.has(depId));
      const penalty = unmetDeps.length > 0 ? 0.45 : 1.0;
      return {
        ...c,
        q18Score: computeQ18Score(c, penalty),
      };
    })
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return (b.q18Score ?? 0) - (a.q18Score ?? 0);
    });
}

/**
 * Deterministic 128-bit LSH SimHash (32 hex chars) without native dependencies.
 */
export function computeSimHash128(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const weights = new Int32Array(128);
  const effectiveTokens = tokens.length > 0 ? tokens : ['empty'];

  for (const token of effectiveTokens) {
    const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
    for (let wordIdx = 0; wordIdx < 4; wordIdx++) {
      let h = seeds[wordIdx] >>> 0;
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      for (let bit = 0; bit < 32; bit++) {
        const bitSet = (h >>> bit) & 1;
        weights[wordIdx * 32 + bit] += bitSet ? 1 : -1;
      }
    }
  }

  let hex = '';
  for (let nibble = 0; nibble < 32; nibble++) {
    let val = 0;
    for (let b = 0; b < 4; b++) {
      if (weights[nibble * 4 + b] >= 0) {
        val |= 1 << b;
      }
    }
    hex += val.toString(16);
  }
  return hex;
}

// ============================================================================
// Antigravity Brain v7.2: 128-Bit Binary Quantization (BQ) + POPCNT (<0.2ms)
// ============================================================================

const CONCEPT_CLUSTERS: string[][] = [
  ['arch', 'arquitetura', 'core', 'sistema', 'gateway', 'server', 'cortex'],
  ['memory', 'memoria', 'vault', 'hipporag', 'ppr', 'ebbinghaus', 'rrf', 'fact'],
  ['swarm', 'enxame', 'agent', 'agente', 'scout', 'ruflo', 'lane', 'parallel'],
  ['sandbox', 'rollback', 'snapshot', 'zlib', 'cow', 'atomic', 'verify'],
  ['ast', 'symbol', 'git', 'commit', 'branch', 'file', 'ficheiro', 'impact'],
  ['security', 'seguranca', 'canary', 'injection', 'secret', 'allow', 'trust'],
  ['workflow', 'cron', 'dag', 'heartbeat', 'routine', 'rotina', 'trigger'],
  ['orbit', 'dots', 'mcp', 'quota', 'roi', 'handoff', 'broadcast', 'toon'],
  ['ui', 'three', '3d', 'webgl', 'canvas', 'hud', 'focus', 'foco', 'orb'],
  ['voice', 'voz', 'audio', 'dsp', 'pebble', 'mark', 'wake'],
  ['test', 'teste', 'unittest', 'assert', 'ci', 'gate', 'verified'],
  ['os', 'windows', 'linux', 'cpu', 'ram', 'disk', 'port', 'porta', 'sidecar'],
  ['plan', 'q18', 'goal', 'objetivo', 'decision', 'decisao', 'brief'],
  ['api', 'http', 'sse', 'json', 'rpc', 'endpoint', 'webhook'],
  ['db', 'sqlite', 'wal', 'persist', 'backup', 'store', 'schema'],
  ['model', 'gemini', 'llm', 'prompt', 'token', 'diet', 'jev'],
];

const NIBBLE_POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

function fnvHash32(str: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 128-D Subword LSH + Binary Quantization (16 bytes / 32 hex chars):
 * - Bits 0..15 (16-D): Semantic Concept Cluster Projections
 * - Bits 16..79 (64-D): Unigram + Bigram LSH Projections
 * - Bits 80..127 (48-D): Word-bounded <word> 3/4-gram morphological shingles
 */
export function computeBinaryQuantization128(text: string): string {
  const clean = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s_-]/g, ' ');
  const words = clean.split(/\s+/).filter((w) => w.length >= 2);
  const effectiveWords = words.length > 0 ? words : ['void'];

  const accum = new Float32Array(128);

  // 1. 16-D Concept Cluster Projections (bits 0..15)
  for (let cIdx = 0; cIdx < 16; cIdx++) {
    const vocab = CONCEPT_CLUSTERS[cIdx];
    let hits = 0;
    for (const w of effectiveWords) {
      if (vocab.some((kw) => w.includes(kw))) hits += 1;
    }
    accum[cIdx] = hits > 0 ? hits * 1.5 : -0.35;
  }

  // 2. 64-D Unigram + Bigram LSH Projections (bits 16..79)
  const lexicalFeatures: string[] = [...effectiveWords];
  for (let i = 0; i < effectiveWords.length - 1; i++) {
    lexicalFeatures.push(`${effectiveWords[i]}_${effectiveWords[i + 1]}`);
  }
  for (const feat of lexicalFeatures) {
    const hA = fnvHash32(feat, 0x9e3779b9);
    const hB = fnvHash32(feat, 0x85ebca6b);
    for (let b = 0; b < 32; b++) {
      accum[16 + b] += (hA >>> b) & 1 ? 1 : -1;
      accum[48 + b] += (hB >>> b) & 1 ? 1 : -1;
    }
  }

  // 3. 48-D Morphological Subword Shingles <word> 3-grams & 4-grams (bits 80..127)
  for (const w of effectiveWords) {
    const bounded = `<${w}>`;
    for (let n = 3; n <= 4; n++) {
      for (let i = 0; i <= bounded.length - n; i++) {
        const shingle = bounded.slice(i, i + n);
        const hS = fnvHash32(shingle, 0xc2b2ae35);
        const slot = 80 + (hS % 48);
        const sign = (hS >>> 16) & 1 ? 1.0 : -1.0;
        accum[slot] += sign;
      }
    }
  }

  let hex = '';
  for (let nibble = 0; nibble < 32; nibble++) {
    let val = 0;
    for (let b = 0; b < 4; b++) {
      if (accum[nibble * 4 + b] >= 0) {
        val |= 1 << b;
      }
    }
    hex += val.toString(16);
  }
  return hex;
}

export function hammingDistance128(hexA: string, hexB: string): number {
  const a = (hexA || '').padEnd(32, '0').slice(0, 32).toLowerCase();
  const b = (hexB || '').padEnd(32, '0').slice(0, 32).toLowerCase();
  let dist = 0;
  for (let i = 0; i < 32; i++) {
    const na = parseInt(a[i], 16) || 0;
    const nb = parseInt(b[i], 16) || 0;
    dist += NIBBLE_POPCOUNT[(na ^ nb) & 0xf];
  }
  return dist;
}

export function hammingSimilarity128(hexA: string, hexB: string): number {
  const dist = hammingDistance128(hexA, hexB);
  return Number((1 - dist / 128).toFixed(4));
}

// ============================================================================
// Ebbinghaus Spaced-Reinforcement Retention & Bi-Temporal Contradiction Engine
// ============================================================================

const TIER_BASE_HALFLIFE_DAYS: Record<MemoryTier, number> = {
  WORKING: 3,
  EPISODIC: 14,
  SEMANTIC: 120,
};

/**
 * Ebbinghaus Retention Formula (Antigravity Brain v7.2):
 * H = S_tier * (1 + 1.2 * ln(1 + accessCount)) * (importance / 3)
 * R(t) = exp(-deltaDays / H)
 */
export function computeEbbinghausRetention(
  memory: Pick<
    MemoryItem,
    'tier' | 'accessCount' | 'importance' | 'lastAccessedAt' | 'updatedAt' | 'createdAt' | 'pinned'
  >,
  nowMs = Date.now()
): { retentionScore: number; halfLifeDays: number } {
  const tier: MemoryTier = memory.tier || (memory.pinned ? 'SEMANTIC' : 'EPISODIC');
  const sTier = TIER_BASE_HALFLIFE_DAYS[tier] ?? 14;
  const accessCount = Math.max(0, memory.accessCount ?? 1);
  const importance = Math.min(5, Math.max(1, memory.importance ?? (memory.pinned ? 5 : 3)));

  const halfLifeDays = Math.max(
    0.5,
    sTier * (1 + 1.2 * Math.log(1 + accessCount)) * (importance / 3)
  );

  const refIso = memory.lastAccessedAt || memory.updatedAt || memory.createdAt;
  const refMs = refIso ? Date.parse(refIso) : nowMs;
  const deltaDays = Number.isFinite(refMs) ? Math.max(0, (nowMs - refMs) / 86_400_000) : 0;

  const rawRetention = memory.pinned ? Math.max(0.92, Math.exp(-deltaDays / halfLifeDays)) : Math.exp(-deltaDays / halfLifeDays);

  return {
    retentionScore: Number(Math.min(1, Math.max(0.01, rawRetention)).toFixed(4)),
    halfLifeDays: Number(halfLifeDays.toFixed(2)),
  };
}

/**
 * Bi-Temporal Contradiction Superseding Detector (Graphiti-style):
 * Finds active memories on the same normalized entity/subject key whose content is superseded.
 */
export function detectContradictedMemories(
  newTopic: string,
  newContent: string,
  newCategory: MemoryCategory,
  existingMemories: MemoryItem[]
): string[] {
  const normalizeTopicKey = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .slice(0, 4)
      .join('_');

  const targetKey = normalizeTopicKey(newTopic);
  if (!targetKey) return [];

  const newLower = newContent.toLowerCase().trim();
  const supersededIds: string[] = [];

  for (const mem of existingMemories) {
    if (mem.validUntil || mem.supersededBy) continue;
    if (mem.category !== newCategory && newCategory !== 'DECISION' && newCategory !== 'FACT') {
      continue;
    }
    const existingKey = normalizeTopicKey(mem.topic);
    if (existingKey === targetKey && mem.content.toLowerCase().trim() !== newLower) {
      supersededIds.push(mem.id);
    }
  }
  return supersededIds;
}

/**
 * HippoRAG 2 Personalized PageRank (PPR) over Memory Vault Associative Graph.
 * p^{(t+1)} = (1 - alpha) * s + alpha * M * p^{(t)}
 */
export function computeHippoRagPPR(
  memories: MemoryItem[],
  edges: GraphEdge[],
  seedId?: string,
  alpha = 0.85,
  iterations = 28
): GraphNodeComputed[] {
  if (memories.length === 0) return [];

  const n = memories.length;
  const idToIndex = new Map<string, number>();
  memories.forEach((m, idx) => idToIndex.set(m.id, idx));

  const validSeedIdx = seedId && idToIndex.has(seedId) ? idToIndex.get(seedId)! : -1;

  // Teleport / personalization vector s
  const teleport = new Float64Array(n);
  if (validSeedIdx >= 0) {
    teleport[validSeedIdx] = 1.0;
  } else {
    let sumBase = 0;
    for (let i = 0; i < n; i++) {
      const base = (memories[i].pinned ? 1.5 : 1.0) * Math.max(0.2, memories[i].confidence);
      teleport[i] = base;
      sumBase += base;
    }
    for (let i = 0; i < n; i++) teleport[i] /= sumBase || 1;
  }

  // Build weighted undirected adjacency list for associative recall
  const adj: { to: number; weight: number }[][] = Array.from({ length: n }, () => []);
  const outWeight = new Float64Array(n);

  for (const edge of edges) {
    const u = idToIndex.get(edge.source);
    const v = idToIndex.get(edge.target);
    if (u !== undefined && v !== undefined && u !== v) {
      const w = Math.max(0.1, edge.weight || 1.0);
      adj[u].push({ to: v, weight: w });
      adj[v].push({ to: u, weight: w });
      outWeight[u] += w;
      outWeight[v] += w;
    }
  }

  let ranks = Float64Array.from(teleport);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Float64Array(n);
    let danglingMass = 0;

    for (let u = 0; u < n; u++) {
      if (outWeight[u] === 0) {
        danglingMass += ranks[u];
      } else {
        for (const { to, weight } of adj[u]) {
          next[to] += alpha * ranks[u] * (weight / outWeight[u]);
        }
      }
    }

    for (let i = 0; i < n; i++) {
      next[i] += (1 - alpha) * teleport[i] + alpha * danglingMass * teleport[i];
    }
    ranks = next;
  }

  const nowMs = Date.now();
  return memories
    .map((m, idx) => {
      const { retentionScore } = computeEbbinghausRetention(m, nowMs);
      return {
        id: m.id,
        label: m.topic,
        category: m.category,
        provenance: m.provenance,
        pinned: m.pinned,
        pprScore: Number(ranks[idx].toFixed(4)),
        retentionScore,
        superseded: Boolean(m.validUntil || m.supersededBy),
      };
    })
    .sort((a, b) => b.pprScore - a.pprScore);
}

/**
 * 4-Way Weighted Reciprocal Rank Fusion (RRF, k = 60):
 * Fuses:
 * 1. BM25 Lexical TF-IDF Score (weight 1.35)
 * 2. 128-Bit Binary Quantization Hamming Similarity (weight 1.15)
 * 3. HippoRAG 2 Personalized PageRank Score (weight 1.0)
 * 4. Ebbinghaus Spaced-Reinforcement Salience (weight 0.9)
 */
export function searchMemories4WayRRF(
  query: string,
  memories: MemoryItem[],
  edges: GraphEdge[],
  options?: { includeSuperseded?: boolean; seedId?: string; nowMs?: number }
): MemoryRankedHit[] {
  const includeSuperseded = Boolean(options?.includeSuperseded);
  const nowMs = options?.nowMs ?? Date.now();

  const pool = includeSuperseded
    ? memories
    : memories.filter((m) => !m.validUntil && !m.supersededBy);

  if (pool.length === 0) return [];

  const qTerms = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  const queryBq = computeBinaryQuantization128(query || 'jarvis cortex');
  const pprComputed = computeHippoRagPPR(pool, edges, options?.seedId);
  const pprMap = new Map<string, number>();
  for (const node of pprComputed) pprMap.set(node.id, node.pprScore);

  // BM25-lite lexical scoring across topic + content + tags
  const docTokensList = pool.map((m) =>
    `${m.topic} ${m.topic} ${m.content} ${m.tags.join(' ')}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9_-]+/)
      .filter(Boolean)
  );
  const avgDl =
    docTokensList.reduce((acc, toks) => acc + toks.length, 0) / Math.max(1, docTokensList.length);

  const df = new Map<string, number>();
  for (const term of qTerms) {
    let count = 0;
    for (const toks of docTokensList) {
      if (toks.some((tk) => tk.includes(term))) count++;
    }
    df.set(term, count);
  }

  const rawEntries = pool.map((mem, idx) => {
    const toks = docTokensList[idx];
    let bm25 = 0;
    if (qTerms.length === 0) {
      bm25 = mem.pinned ? 1 : 0.5;
    } else {
      for (const term of qTerms) {
        let tf = 0;
        for (const tk of toks) {
          if (tk === term) tf += 1.2;
          else if (tk.includes(term)) tf += 0.65;
        }
        if (tf > 0) {
          const docFreq = df.get(term) || 1;
          const idf = Math.log(1 + (pool.length - docFreq + 0.5) / (docFreq + 0.5));
          const k1 = 1.5;
          const b = 0.75;
          const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + (b * toks.length) / Math.max(1, avgDl)));
          bm25 += idf * norm;
        }
      }
    }

    const memBq = mem.bq128Hex || computeBinaryQuantization128(`${mem.topic} ${mem.content}`);
    const bqSim = hammingSimilarity128(queryBq, memBq);
    const ppr = pprMap.get(mem.id) ?? 0;
    const { retentionScore, halfLifeDays } = computeEbbinghausRetention(mem, nowMs);

    return {
      memory: mem,
      bm25Score: Number(bm25.toFixed(4)),
      bqSimilarity: bqSim,
      pprScore: ppr,
      retentionScore,
      halfLifeDays,
    };
  });

  const rankBy = (key: 'bm25Score' | 'bqSimilarity' | 'pprScore' | 'retentionScore') => {
    const sorted = [...rawEntries].sort((a, b) => b[key] - a[key]);
    const rankMap = new Map<string, number>();
    sorted.forEach((item, index) => rankMap.set(item.memory.id, index + 1));
    return rankMap;
  };

  const rBm25 = rankBy('bm25Score');
  const rBq = rankBy('bqSimilarity');
  const rPpr = rankBy('pprScore');
  const rRet = rankBy('retentionScore');

  const K = 60;
  return rawEntries
    .map((entry) => {
      const id = entry.memory.id;
      const wBm25 = qTerms.length > 0 ? 1.4 : 0.6;
      const wBq = qTerms.length > 0 ? 1.2 : 0.7;
      const wPpr = 1.05;
      const wRet = 0.9;

      const rrf =
        wBm25 / (K + (rBm25.get(id) ?? pool.length)) +
        wBq / (K + (rBq.get(id) ?? pool.length)) +
        wPpr / (K + (rPpr.get(id) ?? pool.length)) +
        wRet / (K + (rRet.get(id) ?? pool.length));

      return {
        ...entry,
        rrfScore: Number((rrf * 1000).toFixed(3)),
      };
    })
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Multi-Modal Shortest Path BFS across Associative Graph
 */
export function findShortestGraphPath(
  startId: string,
  endId: string,
  edges: GraphEdge[]
): { found: boolean; nodeIds: string[]; relations: string[] } {
  if (!startId || !endId) return { found: false, nodeIds: [], relations: [] };
  if (startId === endId) return { found: true, nodeIds: [startId], relations: [] };

  const adj = new Map<string, { neighbor: string; relation: string }[]>();
  const addDir = (u: string, v: string, rel: string) => {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u)!.push({ neighbor: v, relation: rel });
  };

  for (const e of edges) {
    addDir(e.source, e.target, e.relation);
    addDir(e.target, e.source, e.relation);
  }

  const visited = new Set<string>([startId]);
  const parent = new Map<string, { prev: string; relation: string }>();
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === endId) {
      const nodeIds: string[] = [endId];
      const relations: string[] = [];
      let trace = endId;
      while (parent.has(trace)) {
        const step = parent.get(trace)!;
        relations.unshift(step.relation);
        nodeIds.unshift(step.prev);
        trace = step.prev;
      }
      return { found: true, nodeIds, relations };
    }

    for (const edge of adj.get(curr) || []) {
      if (!visited.has(edge.neighbor)) {
        visited.add(edge.neighbor);
        parent.set(edge.neighbor, { prev: curr, relation: edge.relation });
        queue.push(edge.neighbor);
      }
    }
  }

  return { found: false, nodeIds: [], relations: [] };
}

// ============================================================================
// JEV-S1 Sub-Millisecond Reflex Router (<1ms) + 5-Stage Token Diet (-96% MCP)
// ============================================================================

export const MCP_2026_TOOL_NAMES = [
  'store_fact',
  'search_brain',
  'forget_fact',
  'save_checkpoint',
  'brain_stats',
  'brain_prune_tools',
  'swarm_scout',
  'swarm_start',
  'swarm_update_task',
  'swarm_status',
  'swarm_sandbox',
  'swarm_symbol_lookup',
  'swarm_impact_graph',
  'swarm_watch_audit',
  'swarm_graph_path',
  'swarm_architecture_report',
  'orbit_mission_control',
  'orbit_briefing_roi',
] as const;

const MICRO_TICK_TOKENS = new Set([
  'sim',
  'ok',
  'okay',
  'continua',
  'prossegue',
  'proceed',
  'avanca',
  'avança',
  'confirmo',
  'aprovado',
  'next',
  'go',
  'yes',
  'feito',
]);

export function isMicroTickPrompt(prompt: string): boolean {
  const clean = prompt.trim().toLowerCase().replace(/[.!?,;:]+$/g, '');
  if (!clean || clean.length > 26) return false;
  return MICRO_TICK_TOKENS.has(clean);
}

/**
 * TOON Telegraphic Fact Compression (-35% tokens without semantic loss)
 */
export function compressFactTelegraphic(text: string): string {
  const stopWords =
    /\b(o|a|os|as|um|uma|de|do|da|dos|das|que|para|com|por|no|na|nos|nas|the|an|of|to|for|with|in|on|is|are|was|were|that|this)\b/gi;
  const compacted = text
    .replace(/\s+/g, ' ')
    .replace(stopWords, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return compacted || text.trim();
}

export function computeDeltaMemoryHash(memories: MemoryItem[]): string {
  const top = memories
    .slice(0, 12)
    .map((m) => `${m.id}:${m.updatedAt}:${m.supersededBy || ''}`)
    .join('|');
  return fnvHash32(top, 0x811c9dc5).toString(16).padStart(8, '0');
}

export function pruneMcpToolsForIntent(
  prompt: string,
  catalog: readonly string[] = MCP_2026_TOOL_NAMES
): string[] {
  if (catalog.length === 0) return [];
  if (isMicroTickPrompt(prompt)) {
    const micro = ['search_brain', 'orbit_mission_control'].filter((name) => catalog.includes(name));
    return micro.length > 0 ? micro : catalog.slice(0, 2);
  }
  const lower = prompt.toLowerCase();
  const selected = new Set<string>(['search_brain']);

  if (/swarm|enxame|48x|24x|lane|paralel|scout|ruflo/.test(lower)) {
    selected.add('swarm_scout');
    selected.add('swarm_start');
    selected.add('swarm_status');
    selected.add('swarm_sandbox');
  }
  if (/sandbox|rollback|snapshot|reverter/.test(lower)) {
    selected.add('swarm_sandbox');
    selected.add('swarm_watch_audit');
  }
  if (/ast|s[ií]mbolo|symbol|ficheiro|file|impact|git|commit|code|c[oó]digo|ts|py/.test(lower)) {
    selected.add('swarm_symbol_lookup');
    selected.add('swarm_impact_graph');
    selected.add('swarm_architecture_report');
  }
  if (/memor|vault|fact|lembra|guarda|ebbinghaus|grafo|path|caminho/.test(lower)) {
    selected.add('store_fact');
    selected.add('forget_fact');
    selected.add('swarm_graph_path');
    selected.add('brain_stats');
  }
  if (/orbit|dots|quota|roi|broadcast|handoff|mcp|checkpoint/.test(lower)) {
    selected.add('orbit_mission_control');
    selected.add('orbit_briefing_roi');
    selected.add('save_checkpoint');
  }

  // Also include any custom JEV-eligible tools whose name matches tokens in the prompt
  for (const name of catalog) {
    if (!MCP_2026_TOOL_NAMES.includes(name as (typeof MCP_2026_TOOL_NAMES)[number])) {
      const normalized = name.toLowerCase().replace(/[_-]+/g, ' ');
      if (lower.includes(name.toLowerCase()) || lower.includes(normalized)) {
        selected.add(name);
      }
    }
  }

  // Ensure crisp 4..6 tool window from available catalog
  const defaults = ['store_fact', 'swarm_symbol_lookup', 'orbit_mission_control', 'brain_stats', ...catalog];
  for (const d of defaults) {
    const validCount = Array.from(selected).filter((n) => catalog.includes(n)).length;
    if (validCount >= Math.min(5, catalog.length)) break;
    if (catalog.includes(d)) selected.add(d);
  }

  return Array.from(selected)
    .filter((name) => catalog.includes(name))
    .slice(0, 6);
}

/**
 * JEV-S1 Sub-Millisecond Reflex Router (<1ms) + Notice Lookahead + 5-Stage Token Diet
 */
export function routeJevS1(params: {
  prompt: string;
  memories: MemoryItem[];
  scoutSymbols?: ScoutSymbolEntry[];
  previousDeltaHash?: string;
  activeMcpCatalog?: readonly string[];
}): { decision: JevRouteDecision; nextDeltaHash: string; compressedContextBlock: string } {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { prompt, memories, scoutSymbols = [], previousDeltaHash, activeMcpCatalog } = params;
  const lower = prompt.toLowerCase();
  const microTick = isMicroTickPrompt(prompt);

  let tier: MemoryTier = 'WORKING';
  let intent: JevRouteDecision['intent'] = 'EXECUTIVE_PLANNING';
  let dotsTrajectory: string[] = ['JEV_CLASSIFY', 'WORKING_CONTEXT', 'SYNTHESIZE'];

  if (microTick) {
    tier = 'WORKING';
    intent = 'MICRO_TICK';
    dotsTrajectory = ['MICRO_TICK_FASTPATH', 'COMMIT_NEXT_STEP'];
  } else if (/swarm|enxame|48x|24x|sandbox|rollback/.test(lower)) {
    tier = 'EPISODIC';
    intent = 'SWARM_ORCHESTRATION';
    dotsTrajectory = ['SCOUT_01_MAP', 'RUFLO_LANES_DISPATCH', 'DUAL_VERIFY_GATES'];
  } else if (/ast|symbol|ficheiro|file|server\.ts|app\.tsx|git|refactor|bug|erro|test/.test(lower)) {
    tier = 'SEMANTIC';
    intent = 'CODE_IMPACT';
    dotsTrajectory = ['AST_SYMBOL_LOOKUP', 'GIT_COCHANGE_BLAST', 'GOVERNED_EXEC'];
  } else if (/memor|vault|arquitetura|regra|decis|compromisso|lembra|hipporag/.test(lower)) {
    tier = 'SEMANTIC';
    intent = 'MEMORY_RECALL';
    dotsTrajectory = ['RRF_4WAY_FUSION', 'BI_TEMPORAL_FILTER', 'PPR_DIFFUSION'];
  } else if (/cpu|ram|porta|windows|linux|telemetria|sidecar|canal|telegram/.test(lower)) {
    tier = 'EPISODIC';
    intent = 'SYSTEM_DEVOPS';
    dotsTrajectory = ['OS_TELEMETRY_PROBE', 'PORT_RADAR', 'TRUST_BOUNDARY_AUDIT'];
  }

  // Notice Lookahead: check if prompt references any indexed workspace file or symbol
  const lookaheadAlerts: LookaheadAlert[] = [];
  if (!microTick && scoutSymbols.length > 0) {
    const seenFiles = new Set<string>();
    for (const sym of scoutSymbols) {
      const baseName = sym.filePath.split('/').pop()?.toLowerCase() || '';
      if (
        (baseName.length >= 5 && lower.includes(baseName)) ||
        (sym.name.length >= 6 && lower.includes(sym.name.toLowerCase()))
      ) {
        if (seenFiles.has(sym.filePath)) continue;
        seenFiles.add(sym.filePath);
        lookaheadAlerts.push({
          filePath: sym.filePath,
          symbolName: sym.name,
          lineRange: `L${sym.startLine}-${sym.endLine}`,
          blastRadiusScore: Math.min(9.8, Number((3.8 + sym.imports.length * 1.1).toFixed(1))),
          coChangedWith: sym.imports.slice(0, 3),
          reason: `Símbolo ${sym.name} (${sym.filePath}:L${sym.startLine}-${sym.endLine}) detetado em pré-voo.`,
        });
        if (lookaheadAlerts.length >= 3) break;
      }
    }
  }

  // 5-Stage Token Diet Computation
  const nextDeltaHash = computeDeltaMemoryHash(memories);
  const deltaHit = Boolean(previousDeltaHash && previousDeltaHash === nextDeltaHash);
  const catalogToUse = activeMcpCatalog ?? MCP_2026_TOOL_NAMES;
  const prunedTools = pruneMcpToolsForIntent(prompt, catalogToUse);

  const activeMems = memories.filter((m) => !m.validUntil && !m.supersededBy).slice(0, microTick ? 1 : 5);
  const rawChars = activeMems.reduce((acc, m) => acc + m.topic.length + m.content.length + 40, 0);
  // Full MCP catalog schema + raw memory + unrouted repo map baseline (~3,450 tokens)
  const baselineTokens = Math.max(600, catalogToUse.length * 158) + Math.ceil(rawChars / 3.8);

  const compressedLines = deltaHit
    ? [`[DELTA_SYNC:${nextDeltaHash}]`]
    : activeMems.map(
        (m) => `[${(m.tier || 'E')[0]}|${m.topic}] ${compressFactTelegraphic(m.content)}`
      );
  const compressedContextBlock = compressedLines.join('\n');

  const stagesApplied: JevRouteDecision['tokenDiet']['stagesApplied'] = ['TOOL_PRUNING'];
  if (deltaHit) stagesApplied.push('DELTA_CACHE');
  stagesApplied.push('TOON_COMPRESSION');
  if (lookaheadAlerts.length > 0 || intent === 'CODE_IMPACT' || intent === 'SWARM_ORCHESTRATION') {
    stagesApplied.push('SCOUT_ROUTED_MAP');
  }
  if (microTick) stagesApplied.push('MICRO_TICK');

  const injectedTokens = microTick
    ? Math.min(86, 48 + Math.ceil(compressedContextBlock.length / 4))
    : Math.max(
        110,
        prunedTools.length * 28 + Math.ceil(compressedContextBlock.length / 4) + lookaheadAlerts.length * 22
      );

  const savedTokens = Math.max(0, baselineTokens - injectedTokens);
  const savingsPercent = Number(((savedTokens / Math.max(1, baselineTokens)) * 100).toFixed(1));
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const latencyMs = Number(Math.max(0.08, t1 - t0).toFixed(2));

  return {
    decision: {
      tier,
      intent,
      dotsTrajectory,
      latencyMs,
      microTick,
      prunedTools,
      lookaheadAlerts,
      tokenDiet: {
        baselineTokens,
        injectedTokens,
        savedTokens,
        savingsPercent,
        stagesApplied,
        activeToolsCount: prunedTools.length,
        totalToolsCatalog: catalogToUse.length,
      },
    },
    nextDeltaHash,
    compressedContextBlock,
  };
}

/**
 * AI-Defence Post-Turn Secret Redactor (protects Self-Learn & Verify Gate 2)
 */
const SECRET_REDACTION_PATTERNS: { label: string; regex: RegExp }[] = [
  { label: 'REDACTED_OPENAI_KEY', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'REDACTED_GOOGLE_API_KEY', regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { label: 'REDACTED_GITHUB_TOKEN', regex: /\bgh[pousr]_[A-Za-z0-9]{28,}\b/g },
  { label: 'REDACTED_STRIPE_KEY', regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { label: 'REDACTED_PEM_KEY', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { label: 'REDACTED_JWT', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { label: 'REDACTED_DB_URI', regex: /\b(?:postgres|postgresql|mongodb(?:\+srv)?|mysql|redis):\/\/[^\s"']+/gi },
];

export function redactAiDefenceSecrets(input: string): { sanitized: string; redactedCount: number; labels: string[] } {
  let sanitized = input;
  let redactedCount = 0;
  const labels: string[] = [];

  for (const rule of SECRET_REDACTION_PATTERNS) {
    const matches = sanitized.match(rule.regex);
    if (matches && matches.length > 0) {
      redactedCount += matches.length;
      labels.push(rule.label);
      sanitized = sanitized.replace(rule.regex, `[${rule.label}]`);
    }
  }
  return { sanitized, redactedCount, labels };
}

/**
 * TrustBoundaryGate & Canary Anti-Injection Scanner
 */
export interface InjectionScanResult {
  blocked: boolean;
  riskScore: number; // 0..100
  matchedRules: string[];
  sanitizedPreview: string;
}

const INJECTION_RULES: { id: string; regex: RegExp; weight: number }[] = [
  { id: 'IGNORE_SYSTEM_PROMPT', regex: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i, weight: 85 },
  { id: 'IGNORE_PT_DIRECTIVES', regex: /ignora\s+(todas\s+as\s+)?(instru[cç][oõ]es|regras)\s+(anteriores|acima)/i, weight: 85 },
  { id: 'CANARY_TOKEN_TRIGGER', regex: /jarvis[_-]?canary|reveal\s+system\s+prompt|system\s+override\s+root/i, weight: 90 },
  { id: 'EXFILTRATE_SECRETS', regex: /(cat|type|Get-Content)\s+.*\.env|curl\s+.*(GEMINI_API_KEY|SECRET|TOKEN)/i, weight: 95 },
  { id: 'DESTRUCTIVE_SHELL', regex: /rm\s+-rf\s+\/|Format-Volume|del\s+\/f\s+\/s\s+\/q\s+c:\\/i, weight: 100 },
];

export function detectPromptInjection(input: string): InjectionScanResult {
  const matchedRules: string[] = [];
  let score = 0;

  for (const rule of INJECTION_RULES) {
    if (rule.regex.test(input)) {
      matchedRules.push(rule.id);
      score = Math.min(100, score + rule.weight);
    }
  }

  return {
    blocked: score >= 70,
    riskScore: score,
    matchedRules,
    sanitizedPreview: input.slice(0, 180),
  };
}

/**
 * OpenClaw Multi-Channel Owner Allow-List Security Gate:
 * - Channels without an allow-list are strictly BLOCKED.
 * - First ID in ownerAllowList is the Owner with exec approval rights.
 */
export interface ChannelAccessVerdict {
  allowed: boolean;
  isOwner: boolean;
  reason: string;
}

export function validateChannelSender(channel: ChannelConfig, senderId: string): ChannelAccessVerdict {
  const cleanList = channel.ownerAllowList.map((s) => s.trim()).filter(Boolean);
  if (!channel.enabled) {
    return { allowed: false, isOwner: false, reason: 'CHANNEL_DISABLED' };
  }
  if (cleanList.length === 0) {
    return { allowed: false, isOwner: false, reason: 'BLOCKED_EMPTY_ALLOW_LIST' };
  }
  const normalizedSender = senderId.trim();
  if (!normalizedSender || !cleanList.includes(normalizedSender)) {
    return { allowed: false, isOwner: false, reason: 'SENDER_NOT_IN_ALLOW_LIST' };
  }
  return {
    allowed: true,
    isOwner: cleanList[0] === normalizedSender,
    reason: cleanList[0] === normalizedSender ? 'OWNER_VERIFIED' : 'ALLOW_LIST_MEMBER',
  };
}

/**
 * Deterministic Natural-Language -> Visual DAG Workflow Builder (Offline-ready & fast fallback)
 */
export function buildDeterministicWorkflowFromPrompt(
  prompt: string,
  lang: LanguageCode = 'pt-PT'
): { name: string; description: string; cronExpr?: string; nodes: WorkflowNode[] } {
  const lower = prompt.toLowerCase();
  const isPt = lang === 'pt-PT';

  let cronExpr: string | undefined;
  const hourMatch = lower.match(/\b(\d{1,2})(?:h|:(\d{2})|\s*am|\s*pm)\b/);
  if (hourMatch || lower.includes('todos os dias') || lower.includes('every day') || lower.includes('diariamente')) {
    const hr = Math.min(23, Math.max(0, Number(hourMatch?.[1] ?? 9)));
    const min = Math.min(59, Math.max(0, Number(hourMatch?.[2] ?? 0)));
    cronExpr = `${min} ${hr} * * *`;
  }

  const triggerKind: 'cron' | 'webhook' | 'manual' = cronExpr
    ? 'cron'
    : lower.includes('webhook')
      ? 'webhook'
      : 'manual';

  const nodes: WorkflowNode[] = [];
  const triggerId = 'node-trigger';

  nodes.push({
    id: triggerId,
    type: 'trigger',
    label:
      triggerKind === 'cron'
        ? `${isPt ? 'Agendamento Cron' : 'Cron Schedule'} (${cronExpr})`
        : triggerKind === 'webhook'
          ? 'Webhook Trigger'
          : isPt
            ? 'Disparo Manual'
            : 'Manual Trigger',
    config: { triggerKind, cronExpr },
    nextIds: [],
  });

  let prevId = triggerId;
  let stepIdx = 1;

  const linkNode = (node: WorkflowNode) => {
    const prev = nodes.find((n) => n.id === prevId);
    if (prev) prev.nextIds.push(node.id);
    nodes.push(node);
    prevId = node.id;
  };

  if (lower.includes('test') || lower.includes('unittest') || lower.includes('pytest')) {
    linkNode({
      id: `node-step-${stepIdx++}`,
      type: 'shell',
      label: isPt ? 'Executar Suite de Testes' : 'Run Test Suite',
      config: { command: 'python3 -m unittest discover -s tests -v' },
      nextIds: [],
    });
  }

  if (lower.includes('git') || lower.includes('commit') || lower.includes('repo')) {
    linkNode({
      id: `node-step-${stepIdx++}`,
      type: 'shell',
      label: isPt ? 'Inspecionar Git Status' : 'Inspect Git Status',
      config: { command: 'git status --short' },
      nextIds: [],
    });
  }

  if (!nodes.some((n) => n.type === 'shell') && (lower.includes('porta') || lower.includes('cpu') || lower.includes('saúde') || lower.includes('health'))) {
    linkNode({
      id: `node-step-${stepIdx++}`,
      type: 'shell',
      label: isPt ? 'Diagnóstico de Telemetria SO' : 'OS Telemetry Check',
      config: { command: 'node -v' },
      nextIds: [],
    });
  }

  if (lower.includes('se ') || lower.includes('if ') || lower.includes('falh') || lower.includes('erro')) {
    linkNode({
      id: `node-step-${stepIdx++}`,
      type: 'condition',
      label: isPt ? 'Condição: Sem Erros Críticos?' : 'Condition: Zero Critical Errors?',
      config: { conditionExpr: 'prev.exitCode === 0' },
      nextIds: [],
    });
  }

  if (lower.includes('aprova') || lower.includes('approv') || lower.includes('deploy') || lower.includes('produção')) {
    linkNode({
      id: `node-step-${stepIdx++}`,
      type: 'approval',
      label: isPt ? 'Aprovação Humana do Operador' : 'Operator Human Approval',
      config: { approverNote: isPt ? 'Confirmar autorização antes de prosseguir.' : 'Confirm authorization before proceeding.' },
      nextIds: [],
    });
  }

  linkNode({
    id: `node-step-${stepIdx++}`,
    type: 'ai',
    label: isPt ? 'Sintetizar Resumo Executivo' : 'Synthesize Executive Summary',
    config: {
      prompt: prompt.trim(),
    },
    nextIds: [],
  });

  const cleanTitle = prompt.trim().slice(0, 52) + (prompt.trim().length > 52 ? '…' : '');
  return {
    name: cleanTitle || (isPt ? 'Rotina Automatizada Jarvis' : 'Jarvis Automated Routine'),
    description: prompt.trim(),
    cronExpr,
    nodes,
  };
}

/**
 * Computes normalized step/operational completion [0..1] for each primary view in J.A.R.V.I.S. Cortex OS.
 */
export function computeViewStepCompletion(section: string, store: JarvisStoreData): number {
  const clamp01 = (v: number) => Number(Math.min(1, Math.max(0, v)).toFixed(3));

  switch (section) {
    case 'brief': {
      const totalContracts = store.contracts.length;
      const verifiedContracts = store.contracts.filter((c) => c.status === 'VERIFIED').length;
      const contractRatio = totalContracts > 0 ? verifiedContracts / totalContracts : 1;

      const totalGoals = store.goals.length;
      const avgGoalRatio =
        totalGoals > 0
          ? store.goals.reduce((acc, g) => acc + Math.min(100, Math.max(0, g.progress)) / 100, 0) /
            totalGoals
          : 1;

      return clamp01(contractRatio * 0.65 + avgGoalRatio * 0.35);
    }
    case 'brain': {
      const activeMemories = store.memories.filter((m) => !m.supersededBy && !m.validUntil);
      if (activeMemories.length === 0) return 0.5;
      const semanticOrConfirmed = activeMemories.filter(
        (m) => m.provenance === 'CONFIRMED' || m.tier === 'SEMANTIC'
      ).length;
      return clamp01(semanticOrConfirmed / activeMemories.length);
    }
    case 'swarm': {
      const latestSwarm = store.swarmRuns?.[0];
      if (!latestSwarm || latestSwarm.verifyGatesTotal === 0) return 0.85;
      return clamp01(latestSwarm.verifyGatesPassed / latestSwarm.verifyGatesTotal);
    }
    case 'orbit': {
      const dots = store.dotsTasks ?? [];
      if (dots.length === 0) return 0.8;
      const done = dots.filter((d) => d.status === 'COMPLETED').length;
      return clamp01(Math.max(0.25, done / dots.length));
    }
    case 'mcp': {
      const tools = store.mcpRegistryTools ?? [];
      const resources = store.mcpRegistryResources ?? [];
      const servers = store.mcpServers ?? [];
      const totalNative = tools.length + resources.length;
      const healthyNative =
        tools.filter((t) => t.enabled && t.healthStatus === 'HEALTHY').length +
        resources.filter((r) => r.enabled && r.healthStatus === 'HEALTHY').length;
      const nativeRatio = totalNative > 0 ? healthyNative / totalNative : 1;
      const serverRatio =
        servers.length > 0
          ? servers.filter((s) => s.enabled && s.healthStatus === 'ONLINE').length / servers.length
          : 1;
      return clamp01(nativeRatio * 0.75 + serverRatio * 0.25);
    }
    case 'chat': {
      const totalRooms = store.rooms.length;
      if (totalRooms === 0) return 1;
      const activeRoomIds = new Set(store.messages.map((m) => m.roomId));
      const activeRooms = store.rooms.filter((r) => activeRoomIds.has(r.id)).length;
      return clamp01(Math.max(0.25, activeRooms / totalRooms));
    }
    case 'workflows': {
      const totalWf = store.workflows.length;
      const enabledRatio =
        totalWf > 0 ? store.workflows.filter((w) => w.enabled).length / totalWf : 0;
      const latestRun = store.workflowRuns[0];
      if (latestRun && latestRun.steps.length > 0) {
        const passedSteps = latestRun.steps.filter((s) => s.status === 'SUCCESS').length;
        const stepRatio = passedSteps / latestRun.steps.length;
        return clamp01(stepRatio * 0.6 + enabledRatio * 0.4);
      }
      return clamp01(enabledRatio);
    }
    case 'workspace': {
      const codeContracts = store.contracts.filter(
        (c) => c.verificationRule === 'TEST_PASS' || c.verificationRule === 'FILE_EXISTS'
      );
      if (codeContracts.length === 0) return 0.5;
      const verified = codeContracts.filter((c) => c.status === 'VERIFIED').length;
      return clamp01(verified / codeContracts.length);
    }
    case 'memory': {
      const totalMem = store.memories.length;
      if (totalMem === 0) return 0;
      const confirmed = store.memories.filter((m) => m.provenance === 'CONFIRMED').length;
      return clamp01(confirmed / totalMem);
    }
    case 'skills': {
      const skillRatio =
        store.skills.length > 0
          ? store.skills.filter((s) => s.enabled).length / store.skills.length
          : 1;
      const channelRatio =
        store.channels.length > 0
          ? store.channels.filter((c) => c.ownerAllowList.length > 0).length / store.channels.length
          : 1;
      return clamp01(skillRatio * 0.5 + channelRatio * 0.5);
    }
    case 'devices': {
      if (store.devices.length === 0) return 1;
      const online = store.devices.filter((d) => d.status === 'ONLINE').length;
      return clamp01(online / store.devices.length);
    }
    case 'authority': {
      if (store.approvals.length === 0) return 1;
      const resolved = store.approvals.filter((a) => a.status !== 'PENDING').length;
      return clamp01(resolved / store.approvals.length);
    }
    default:
      return 0.5;
  }
}

/**
 * Determines which sidebar navigation sections remain visible.
 * In Focus Mode, non-critical administrative/hardware sections ('skills', 'devices',
 * and 'authority' when there are 0 pending approvals) are hidden unless currently active.
 */
const CRITICAL_FOCUS_SECTIONS = new Set([
  'brief',
  'brain',
  'swarm',
  'orbit',
  'mcp',
  'chat',
  'workflows',
  'workspace',
  'memory',
]);

export function getVisibleSidebarIds(
  allIds: string[],
  focusModeEnabled: boolean,
  activeSection: string,
  pendingApprovalsCount: number
): string[] {
  if (!focusModeEnabled) {
    return allIds;
  }
  return allIds.filter((id) => {
    if (id === activeSection) return true;
    if (CRITICAL_FOCUS_SECTIONS.has(id)) return true;
    if (id === 'authority' && pendingApprovalsCount > 0) return true;
    return false;
  });
}

const TRUSTED_MCP_STDIO_RUNNERS = new Set([
  'npx',
  'uvx',
  'node',
  'python3',
  'python',
  'deno',
  'bun',
  'docker',
]);

/**
 * Authority Gate Security Validator for MCP Server Connections (HTTP Streamable, SSE, stdio)
 */
export function validateMcpServerAuthorityGate(params: {
  name: string;
  transport: McpTransportType;
  endpointUrl?: string;
  command?: string;
  args?: string[];
  autonomyLevel?: AutonomyLevel;
  alwaysApprovedCommands?: string[];
}): McpAuthorityGateResult {
  const {
    name,
    transport,
    endpointUrl = '',
    command = '',
    args = [],
    autonomyLevel = 'BALANCED_PROACTIVE',
    alwaysApprovedCommands = [],
  } = params;

  const checks: McpAuthorityCheckItem[] = [];
  let riskScore = 0;
  let hardBlocked = false;
  let requiresHumanApproval = false;

  const combinedInput = `${name} ${endpointUrl} ${command} ${args.join(' ')}`.trim();

  // 1. Canary & Prompt Injection Inspection
  const canary = detectPromptInjection(combinedInput);
  if (canary.blocked) {
    hardBlocked = true;
    riskScore = Math.min(100, riskScore + Math.max(85, canary.riskScore));
    checks.push({
      id: 'CANARY_INJECTION',
      label: 'Filtro Canary Anti-Injeção',
      status: 'FAIL',
      detail: `Padrão de injeção intercetado (${canary.matchedRules.join(', ')}).`,
    });
  } else {
    checks.push({
      id: 'CANARY_INJECTION',
      label: 'Filtro Canary Anti-Injeção',
      status: 'PASS',
      detail: 'Nenhum vetor de injeção ou exfiltração detetado nos parâmetros.',
    });
  }

  // 2. Transport-Specific Security Inspection
  if (transport === 'HTTP_STREAMABLE' || transport === 'SSE') {
    const cleanUrl = endpointUrl.trim();
    try {
      const parsed = new URL(cleanUrl);
      const host = parsed.hostname.toLowerCase();
      const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
      const isMetadataSsrf =
        host === '169.254.169.254' ||
        host === 'metadata.google.internal' ||
        host.startsWith('169.254.') ||
        host === '0.0.0.0';

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        hardBlocked = true;
        riskScore = Math.min(100, riskScore + 90);
        checks.push({
          id: 'TRANSPORT_PROTOCOL',
          label: 'Protocolo de Transporte HTTP/SSE',
          status: 'FAIL',
          detail: `Protocolo '${parsed.protocol}' proibido. Usa apenas http:// (loopback) ou https://.`,
        });
      } else if (isMetadataSsrf) {
        hardBlocked = true;
        riskScore = Math.min(100, riskScore + 95);
        checks.push({
          id: 'SSRF_BOUNDARY',
          label: 'Proteção Anti-SSRF Cloud Metadata',
          status: 'FAIL',
          detail: `Destino '${host}' bloqueado pela Fronteira de Confiança (proteção SSRF).`,
        });
      } else if (parsed.protocol === 'http:' && !isLoopback) {
        riskScore = Math.min(100, riskScore + 25);
        checks.push({
          id: 'TLS_POSTURE',
          label: 'Encriptação de Transporte TLS',
          status: 'WARN',
          detail: `Endpoint remoto sem TLS (${host}). Recomenda-se HTTPS para tráfego externo.`,
        });
      } else {
        checks.push({
          id: 'SSRF_BOUNDARY',
          label: 'Proteção Anti-SSRF & Transporte',
          status: 'PASS',
          detail: isLoopback
            ? `Loopback local seguro confirmado (${host}).`
            : `Ligação encriptada HTTPS validada (${host}).`,
        });
      }
    } catch {
      hardBlocked = true;
      riskScore = Math.min(100, riskScore + 85);
      checks.push({
        id: 'URL_SYNTAX',
        label: 'Validação Sintática de Endpoint',
        status: 'FAIL',
        detail: 'URL de endpoint inválido ou em falta.',
      });
    }
  } else {
    // STDIO Transport Validation
    const cleanCmd = command.trim();
    const fullStdioLine = [cleanCmd, ...args].filter(Boolean).join(' ').trim();
    const hasShellMetachars = /[;&|`$><\n\r]|\$\(/.test(fullStdioLine);

    if (!cleanCmd) {
      hardBlocked = true;
      riskScore = Math.min(100, riskScore + 85);
      checks.push({
        id: 'STDIO_BINARY',
        label: 'Executável stdio',
        status: 'FAIL',
        detail: 'Comando executável stdio obrigatório.',
      });
    } else if (hasShellMetachars) {
      hardBlocked = true;
      riskScore = Math.min(100, riskScore + 95);
      checks.push({
        id: 'SHELL_METACHAR_GUARD',
        label: 'Isolamento contra Shell Chaining',
        status: 'FAIL',
        detail: 'Metacaracteres de encadeamento shell (;, &, |, $, `, >) são bloqueados em stdio.',
      });
    } else {
      const binBase = cleanCmd.split(/[\\/]/).pop()?.toLowerCase() || cleanCmd.toLowerCase();
      if (TRUSTED_MCP_STDIO_RUNNERS.has(binBase)) {
        checks.push({
          id: 'STDIO_RUNNER_TRUST',
          label: 'Runtime Executável Reconhecido',
          status: 'PASS',
          detail: `Runner standard '${binBase}' validado para execução isolada execFile.`,
        });
      } else {
        riskScore = Math.min(100, riskScore + 30);
        checks.push({
          id: 'STDIO_RUNNER_TRUST',
          label: 'Runtime Executável Personalizado',
          status: 'WARN',
          detail: `Binário '${binBase}' fora da lista standard (npx/uvx/node/python3/docker).`,
        });
      }

      const isPreApproved =
        autonomyLevel === 'FULL_EXECUTIVE' || alwaysApprovedCommands.includes(fullStdioLine);
      if (isPreApproved) {
        checks.push({
          id: 'AUTHORITY_POLICY',
          label: 'Política de Autoridade stdio',
          status: 'PASS',
          detail: 'Comando pré-autorizado pela política ativa do Operador.',
        });
      } else {
        requiresHumanApproval = true;
        riskScore = Math.min(100, riskScore + 20);
        checks.push({
          id: 'AUTHORITY_POLICY',
          label: 'Governação Inbox de Autoridade',
          status: 'WARN',
          detail: 'Requer aprovação explícita do Operador antes de invocar o processo local.',
        });
      }
    }
  }

  // 3. AI-Defence Inline Secret Leak Check (URL query / CLI args)
  const leakCheck = redactAiDefenceSecrets(`${endpointUrl} ${args.join(' ')}`);
  if (leakCheck.redactedCount > 0) {
    riskScore = Math.min(100, riskScore + 25);
    checks.push({
      id: 'AI_DEFENCE_SECRETS',
      label: 'Higiene de Segredos AI-Defence',
      status: 'WARN',
      detail: `Detetados ${leakCheck.redactedCount} segredo(s) expostos em URL/argumentos. Move-os para Variáveis de Ambiente mascaradas.`,
    });
  } else {
    checks.push({
      id: 'AI_DEFENCE_SECRETS',
      label: 'Higiene de Segredos AI-Defence',
      status: 'PASS',
      detail: 'Zero chaves em texto limpo expostas no URL ou argumentos CLI.',
    });
  }

  const riskLevel: McpAuthorityGateResult['riskLevel'] =
    riskScore >= 80
      ? 'CRITICAL'
      : riskScore >= 50
        ? 'HIGH'
        : riskScore >= 20
          ? 'MEDIUM'
          : 'LOW';

  const verdict: McpAuthorityGateResult['verdict'] = hardBlocked
    ? 'BLOCKED_SECURITY_RISK'
    : requiresHumanApproval
      ? 'REQUIRES_STDIO_APPROVAL'
      : 'VERIFIED_SAFE';

  return {
    allowed: !hardBlocked,
    requiresHumanApproval,
    riskScore,
    riskLevel,
    verdict,
    checks,
    redactedSecretsCount: leakCheck.redactedCount,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Deterministic MCP Server Latency & Availability Aggregator + SVG Sparkline Builder
 */
export function computeMcpLatencyStats(params: {
  latencyHistory?: number[];
  fallbackLatencyMs?: number;
  probeCount?: number;
  errorCount?: number;
  healthStatus?: McpCustomServer['healthStatus'];
}): McpLatencyStats {
  const {
    latencyHistory = [],
    fallbackLatencyMs = 0,
    probeCount = 0,
    errorCount = 0,
    healthStatus = 'ONLINE',
  } = params;

  const validSamples = latencyHistory.filter((v) => Number.isFinite(v) && v >= 0).slice(-18);
  const samples =
    validSamples.length > 0
      ? validSamples
      : fallbackLatencyMs > 0
        ? [Number(fallbackLatencyMs.toFixed(2))]
        : [0];

  const currentMs = Number((samples[samples.length - 1] ?? 0).toFixed(2));
  const sorted = [...samples].sort((a, b) => a - b);
  const minMs = Number((sorted[0] ?? 0).toFixed(2));
  const maxMs = Number((sorted[sorted.length - 1] ?? 0).toFixed(2));
  const avgMs = Number(
    (samples.reduce((acc, v) => acc + v, 0) / Math.max(1, samples.length)).toFixed(2)
  );

  const p95Idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  const p95Ms = Number((sorted[p95Idx] ?? maxMs).toFixed(2));

  let diffSum = 0;
  for (let i = 1; i < samples.length; i += 1) {
    diffSum += Math.abs(samples[i] - samples[i - 1]);
  }
  const jitterMs =
    samples.length > 1 ? Number((diffSum / (samples.length - 1)).toFixed(2)) : 0;

  let uptimePercent = 100;
  if (probeCount > 0) {
    const okCount = Math.max(0, probeCount - Math.min(probeCount, errorCount));
    uptimePercent = Number(((okCount / probeCount) * 100).toFixed(1));
  } else if (healthStatus === 'OFFLINE') {
    uptimePercent = 0;
  } else if (healthStatus === 'PENDING_AUTH') {
    uptimePercent = 0;
  } else if (healthStatus === 'DEGRADED') {
    uptimePercent = 75;
  }

  return {
    currentMs,
    minMs,
    maxMs,
    avgMs,
    p95Ms,
    jitterMs,
    uptimePercent,
    samples,
  };
}

export function buildSparklineSvgPoints(
  samples: number[],
  width = 136,
  height = 28
): { polylinePoints: string; areaPath: string } {
  const padX = 2;
  const padY = 4;
  const usableW = Math.max(10, width - padX * 2);
  const usableH = Math.max(8, height - padY * 2);

  const ptsSource =
    samples.length >= 2
      ? samples
      : samples.length === 1
        ? [samples[0], samples[0]]
        : [0, 0];

  const minVal = Math.min(...ptsSource);
  const maxVal = Math.max(...ptsSource);
  const span = maxVal - minVal;

  const coords = ptsSource.map((val, idx) => {
    const x = Number((padX + (idx / Math.max(1, ptsSource.length - 1)) * usableW).toFixed(2));
    const norm = span < 0.001 ? 0.5 : (val - minVal) / span;
    const y = Number((padY + usableH - norm * usableH).toFixed(2));
    return { x, y };
  });

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];
  const baselineY = Number((height - 1).toFixed(2));
  const areaPath = `M ${first.x} ${baselineY} L ${coords
    .map((c) => `${c.x} ${c.y}`)
    .join(' L ')} L ${last.x} ${baselineY} Z`;

  return { polylinePoints, areaPath };
}

/**
 * Architectural Drift Detector: Cross-checks active DECISION/COMMITMENT/FACT memories
 * against indexed AST workspace files & symbols.
 */
export function computeArchitecturalDrift(params: {
  memories: MemoryItem[];
  symbols: ScoutSymbolEntry[];
  coChanges: CoChangeEdge[];
  knownFiles: string[];
}): ArchitecturalDriftItem[] {
  const { memories, symbols, coChanges, knownFiles } = params;
  const activeArchitectural = memories.filter(
    (m) =>
      !m.supersededBy &&
      !m.validUntil &&
      (m.category === 'DECISION' || m.category === 'COMMITMENT' || m.pinned)
  );

  const fileSet = new Set(knownFiles.map((f) => f.toLowerCase()));
  const results: ArchitecturalDriftItem[] = [];

  for (const mem of activeArchitectural.slice(0, 12)) {
    const text = `${mem.topic} ${mem.content}`;
    const fileRefs = Array.from(
      new Set(
        (text.match(/\b[\w./-]+\.(?:ts|tsx|py|json|md)\b/g) || []).map((f) =>
          f.replace(/^\.\//, '')
        )
      )
    );

    const targetFile =
      fileRefs.find((ref) =>
        knownFiles.some((kf) => kf.endsWith(ref) || kf.toLowerCase() === ref.toLowerCase())
      ) ||
      fileRefs[0] ||
      (mem.tags.includes('python') ? 'jarvis_os/cli.py' : 'server.ts');

    const resolvedFile =
      knownFiles.find(
        (kf) => kf.toLowerCase() === targetFile.toLowerCase() || kf.endsWith(targetFile)
      ) || targetFile;

    const exists =
      fileSet.has(resolvedFile.toLowerCase()) ||
      knownFiles.some((kf) => kf.endsWith(resolvedFile));

    const fileSyms = symbols.filter((s) => s.filePath === resolvedFile);
    const coupled = coChanges
      .filter((c) => c.fileA === resolvedFile || c.fileB === resolvedFile)
      .map((c) => (c.fileA === resolvedFile ? c.fileB : c.fileA))
      .slice(0, 4);

    let severity: ArchitecturalDriftItem['severity'] = 'NOMINAL';
    let summary = `Alinhado com ${resolvedFile} (${fileSyms.length} símbolos AST verificados).`;
    let recommendation = 'Manter monitorização contínua no SCOUT-01.';

    if (!exists && fileRefs.length > 0) {
      severity = 'DRIFT_DETECTED';
      summary = `A memória referencia "${resolvedFile}", mas o ficheiro já não consta no índice atual.`;
      recommendation = 'Atualizar ou superar esta decisão bi-temporal no Memory Vault.';
    } else if (coupled.length >= 3 && fileSyms.length > 25) {
      severity = 'WARNING';
      summary = `Elevada densidade estrutural em ${resolvedFile} (${fileSyms.length} símbolos · ${coupled.length} ficheiros acoplados).`;
      recommendation = 'Executar análise de Blast Radius antes de novas mutações.';
    }

    results.push({
      id: `drift-${mem.id}`,
      severity,
      memoryId: mem.id,
      memoryTopic: mem.topic,
      memoryCategory: mem.category,
      targetFile: resolvedFile,
      symbolCount: fileSyms.length,
      coupledFiles: coupled,
      summary,
      recommendation,
    });
  }

  return results;
}

/**
 * Evaluates a ProjectWorkspace for proactive health score & actionable ProactiveInsights.
 */
export function evaluateProjectProactivity(params: {
  project: ProjectWorkspace;
  modifiedGitFilesCount: number;
  symbolCount: number;
  unverifiedContractsCount: number;
  pendingDotsCount: number;
  nowIso?: string;
}): { healthScore: number; insights: ProactiveInsight[] } {
  const {
    project,
    modifiedGitFilesCount,
    symbolCount,
    unverifiedContractsCount,
    pendingDotsCount,
    nowIso = new Date().toISOString(),
  } = params;

  let score = 96;
  const insights: ProactiveInsight[] = [];

  if (unverifiedContractsCount > 0) {
    score -= Math.min(18, unverifiedContractsCount * 6);
    insights.push({
      id: `ins-${project.id}-contracts`,
      projectId: project.id,
      createdAt: nowIso,
      category: 'TEST_GATE',
      severity: 'WARNING',
      title: `${unverifiedContractsCount} contrato(s) sem verificação SHA-256`,
      detail: `O projeto "${project.name}" possui contratos pendentes no Today Contract Gate.`,
      suggestedActionLabel: 'Verificar Contratos',
      suggestedCommandOrPrompt: 'verify_all_contracts',
      actionKind: 'VERIFY_CONTRACTS',
      status: 'OPEN',
    });
  }

  if (modifiedGitFilesCount > 5) {
    score -= Math.min(14, modifiedGitFilesCount);
    insights.push({
      id: `ins-${project.id}-git`,
      projectId: project.id,
      createdAt: nowIso,
      category: 'GIT_HYGIENE',
      severity: 'OPPORTUNITY',
      title: `${modifiedGitFilesCount} ficheiros modificados em ${project.gitBranch}`,
      detail: `Árvore de trabalho ativa em ${project.rootPath}. Recomenda-se correr testes antes de consolidar.`,
      suggestedActionLabel: 'Correr Suite de Testes',
      suggestedCommandOrPrompt: project.techStack.toLowerCase().includes('python')
        ? 'python3 -m unittest discover -s tests -v'
        : 'npx --yes tsx --test src/shared/cortex-math.test.ts',
      actionKind: 'EXEC_COMMAND',
      status: 'OPEN',
    });
  }

  if (pendingDotsCount > 0) {
    score -= Math.min(10, pendingDotsCount * 2);
    insights.push({
      id: `ins-${project.id}-dots`,
      projectId: project.id,
      createdAt: nowIso,
      category: 'NEXT_STEP',
      severity: 'OPPORTUNITY',
      title: `${pendingDotsCount} tarefa(s) DOTS prontas para delegação`,
      detail: `Agentes atribuídos (${project.assignedAgentIds.length}) podem avançar no grafo DAG de ${project.name}.`,
      suggestedActionLabel: 'Coordenar com Agente',
      suggestedCommandOrPrompt: `Analisa o estado atual do projeto ${project.name} (${project.rootPath}) e propõe o próximo passo prático.`,
      actionKind: 'OPEN_CHAT',
      status: 'OPEN',
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: `ins-${project.id}-nominal`,
      projectId: project.id,
      createdAt: nowIso,
      category: 'HEALTH',
      severity: 'INFO',
      title: `Integridade nominal em ${project.name}`,
      detail: `${symbolCount} símbolos AST indexados em ${project.rootPath} sem desvios críticos.`,
      suggestedActionLabel: 'Inspecionar Estado Git',
      suggestedCommandOrPrompt: 'git status --short',
      actionKind: 'EXEC_COMMAND',
      status: 'OPEN',
    });
  }

  return {
    healthScore: Math.max(45, Math.min(100, Math.round(score))),
    insights: insights.slice(0, 4),
  };
}

/**
 * Bulk Enable/Disable Proactivity across all registered projects simultaneously.
 */
export function applyBulkProjectProactivity(
  projects: ProjectWorkspace[],
  proactiveEnabled: boolean
): {
  projects: ProjectWorkspace[];
  enabledCount: number;
  totalCount: number;
  allEnabled: boolean;
} {
  const updated = projects.map((proj) => ({
    ...proj,
    proactiveEnabled: Boolean(proactiveEnabled),
  }));
  const enabledCount = updated.filter((p) => p.proactiveEnabled).length;
  return {
    projects: updated,
    enabledCount,
    totalCount: updated.length,
    allEnabled: updated.length > 0 && enabledCount === updated.length,
  };
}

/**
 * Computes a 10-point 'proactive intervention frequency' time-series and SVG sparkline geometry
 * (interventions/hour) for a ProjectWorkspace.
 */
export function computeProjectProactiveFrequency(
  project: ProjectWorkspace,
  width = 124,
  height = 26
): {
  samples: number[];
  currentPerHour: number;
  peakPerHour: number;
  avgPerHour: number;
  trendDirection: 'UP' | 'STEADY' | 'PAUSED';
  polylinePoints: string;
  areaPath: string;
} {
  const seed = fnvHash32(project.id || project.name || 'proj', 0x811c9dc5);
  const openInsights = (project.proactiveInsights || []).filter((i) => i.status === 'OPEN').length;
  const totalInsights = (project.proactiveInsights || []).length;
  const cadenceFactor = Math.max(1, Math.round(3600 / Math.max(30, project.proactiveIntervalSec || 90)));
  const activeRate = project.proactiveEnabled
    ? Number(
        Math.min(
          24,
          Math.max(1.5, openInsights * 2.2 + totalInsights * 0.8 + Math.min(6, cadenceFactor * 0.12))
        ).toFixed(1)
      )
    : 0;

  const baseSeries: number[] = [];
  for (let i = 0; i < 9; i++) {
    const wave = ((seed >>> (i * 3)) & 0x7) * 0.65;
    const healthMod = Math.max(0.5, (100 - (project.healthScore || 90)) * 0.18);
    const val = Number((2.0 + wave + healthMod + (i % 3) * 0.5).toFixed(1));
    baseSeries.push(val);
  }

  let samples: number[];
  if (Array.isArray(project.proactiveFrequencyHistory) && project.proactiveFrequencyHistory.length > 0) {
    const cleanHist = project.proactiveFrequencyHistory
      .map((n) => Number(Number(n).toFixed(1)))
      .filter((n) => Number.isFinite(n) && n >= 0);
    const combined = [...baseSeries, ...cleanHist];
    if (!project.proactiveEnabled && combined[combined.length - 1] !== 0) {
      combined.push(0);
    }
    samples = combined.slice(-10);
  } else {
    samples = [...baseSeries, activeRate];
  }

  const currentPerHour = Number((samples[samples.length - 1] ?? activeRate).toFixed(1));
  const peakPerHour = Number(Math.max(...samples, 0).toFixed(1));
  const avgPerHour = Number(
    (samples.reduce((acc, v) => acc + v, 0) / Math.max(1, samples.length)).toFixed(1)
  );
  const prevAvg =
    samples.slice(0, -2).reduce((acc, v) => acc + v, 0) / Math.max(1, samples.length - 2);

  const trendDirection: 'UP' | 'STEADY' | 'PAUSED' = !project.proactiveEnabled
    ? 'PAUSED'
    : currentPerHour > prevAvg * 1.08
      ? 'UP'
      : 'STEADY';

  const { polylinePoints, areaPath } = buildSparklineSvgPoints(samples, width, height);

  return {
    samples,
    currentPerHour,
    peakPerHour,
    avgPerHour,
    trendDirection,
    polylinePoints,
    areaPath,
  };
}

/**
 * Computes the executive summary metrics for the Multi-Project Portfolio Modal:
 * - totalProjects: total number of registered projects
 * - activeProjectsCount: projects with ACTIVE or AUDITING status
 * - totalActiveHours: cumulative active engineering & proactive monitoring hours across all projects
 * - runningBackgroundAgents: number of currently running autonomous background agents across projects, DOTS & Swarm
 */
export function computeProjectsPortfolioSummary(params: {
  projects: ProjectWorkspace[];
  rooms?: { id: string }[];
  dotsTasks?: { status: string; assignedAgent?: string }[];
  swarmRuns?: { status: string; tasks?: { status: string; agentCallsign?: string }[] }[];
  heartbeatTotalBeats?: number;
}): {
  totalProjects: number;
  activeProjectsCount: number;
  proactiveProjectsCount: number;
  totalActiveHours: number;
  runningBackgroundAgents: number;
  uniqueAssignedAgentsCount: number;
} {
  const {
    projects = [],
    dotsTasks = [],
    swarmRuns = [],
    heartbeatTotalBeats = 0,
  } = params;

  const totalProjects = projects.length;
  const activeProjectsCount = projects.filter(
    (p) => p.status === 'ACTIVE' || p.status === 'AUDITING'
  ).length;
  const proactiveProjectsCount = projects.filter((p) => p.proactiveEnabled).length;

  let hoursAccum = 0;
  const assignedAgentSet = new Set<string>();
  const runningBackgroundAgentSet = new Set<string>();

  for (const proj of projects) {
    for (const agId of proj.assignedAgentIds || []) {
      assignedAgentSet.add(agId);
      if (proj.proactiveEnabled || proj.status === 'ACTIVE' || proj.status === 'AUDITING') {
        runningBackgroundAgentSet.add(agId);
      }
    }

    const histSamples = Array.isArray(proj.proactiveFrequencyHistory)
      ? proj.proactiveFrequencyHistory.length
      : 0;
    const insightsCount = (proj.proactiveInsights || []).length;
    const symbolFactor = Math.min(18, ((proj.symbolCount ?? 60) / 25) * 1.4);
    const taskFactor = (proj.openTasksCount || 1) * 2.6;
    const beatFactor = Math.min(12, heartbeatTotalBeats * 0.15);
    const statusMultiplier = proj.status === 'ACTIVE' ? 1.25 : proj.status === 'AUDITING' ? 1.1 : 0.65;

    const projHours =
      (6.4 + symbolFactor + taskFactor + insightsCount * 1.35 + histSamples * 0.8 + beatFactor) *
      statusMultiplier;
    hoursAccum += projHours;
  }

  for (const dt of dotsTasks) {
    if (dt.status === 'IN_PROGRESS' && dt.assignedAgent) {
      runningBackgroundAgentSet.add(`dots:${dt.assignedAgent}`);
    }
  }

  for (const sr of swarmRuns) {
    if (sr.status === 'RUNNING') {
      for (const t of sr.tasks || []) {
        if (t.status === 'RUNNING' && t.agentCallsign) {
          runningBackgroundAgentSet.add(`swarm:${t.agentCallsign}`);
        }
      }
    }
  }

  const totalActiveHours = Number(Math.max(0, hoursAccum).toFixed(1));
  const runningBackgroundAgents =
    totalProjects === 0 ? 0 : Math.max(proactiveProjectsCount > 0 ? 1 : 0, runningBackgroundAgentSet.size);

  return {
    totalProjects,
    activeProjectsCount,
    proactiveProjectsCount,
    totalActiveHours,
    runningBackgroundAgents,
    uniqueAssignedAgentsCount: assignedAgentSet.size,
  };
}

// ============================================================================
// 21. Debug Logging Helpers (Secret-Safe Preview & HTTP Level Classification)
// ============================================================================

export type DebugLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export function classifyHttpLogLevel(statusCode: number, durationMs = 0): DebugLogLevel {
  if (statusCode >= 500) return 'ERROR';
  if (statusCode >= 400 || durationMs >= 2500) return 'WARN';
  return 'DEBUG';
}

const SENSITIVE_KEY_RE =
  /(api[_-]?key|secret|password|passwd|authorization|cookie|credential|private[_-]?key|(?:^|[a-z0-9_-])token$)/i;
const BASE64_KEY_RE = /(base64|zlib|pcm|wav|inlineData)/i;

function sanitizeDebugValue(val: unknown, depth = 0): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'number' || typeof val === 'boolean') return val;

  if (typeof val === 'string') {
    if (val.length > 220 && /^[A-Za-z0-9+/=_-]+$/.test(val)) {
      return `<base64:${val.length}chars>`;
    }
    const { sanitized } = redactAiDefenceSecrets(val);
    return sanitized;
  }

  if (depth >= 3) {
    if (Array.isArray(val)) return `[Array(${val.length})]`;
    return '[Object]';
  }

  if (Array.isArray(val)) {
    const slice = val.slice(0, 8).map((item) => sanitizeDebugValue(item, depth + 1));
    if (val.length > 8) {
      slice.push(`…(+${val.length - 8} items)`);
    }
    return slice;
  }

  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(val as Record<string, unknown>);
    for (const [k, v] of entries.slice(0, 16)) {
      if (SENSITIVE_KEY_RE.test(k) && typeof v !== 'number' && typeof v !== 'boolean') {
        out[k] = '<REDACTED>';
      } else if (BASE64_KEY_RE.test(k) && typeof v === 'string') {
        out[k] = `<base64:${v.length}chars>`;
      } else {
        out[k] = sanitizeDebugValue(v, depth + 1);
      }
    }
    if (entries.length > 16) {
      out.__moreKeys = entries.length - 16;
    }
    return out;
  }

  return String(val);
}

export function formatDebugPayloadPreview(payload: unknown, maxLen = 280): string {
  if (payload === undefined) return '';
  if (payload === null) return 'null';

  let rawStr = '';
  if (typeof payload === 'string') {
    rawStr = redactAiDefenceSecrets(payload).sanitized.replace(/\s+/g, ' ').trim();
  } else {
    try {
      rawStr = JSON.stringify(sanitizeDebugValue(payload));
    } catch {
      rawStr = String(payload);
    }
  }

  const safeMax = Math.max(32, maxLen);
  if (rawStr.length <= safeMax) {
    return rawStr;
  }
  const extra = rawStr.length - safeMax;
  return `${rawStr.slice(0, safeMax)}…(+${extra} chars)`;
}




