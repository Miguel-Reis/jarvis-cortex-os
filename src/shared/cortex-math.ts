import type {
  ArchitecturalDriftItem,
  ArtifactKind,
  AutonomyLevel,
  ChannelConfig,
  CoChangeEdge,
  GeminiVoiceName,
  GoalItem,
  GoalSubtask,
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
  NormalizedScreenRegion,
  ProactiveInsight,
  ProjectActivityLogEntry,
  ProjectArtifact,
  ProjectBlueprintBundle,
  ProjectWorkspace,
  Q18Candidate,
  Room,
  ScoutSymbolEntry,
  SkillItem,
  VoicePersonaOption,
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
  { id: 'DESTRUCTIVE_SHELL', regex: /rm\s+-rf\s+(\/|~|\*|\.)|Format-Volume|del\s+\/f\s+\/s\s+\/q\s+c:\\|mkfs\./i, weight: 100 },
  { id: 'ENCODED_OBFUSCATION', regex: /base64\s+(-d|--decode)\s*\|\s*(sh|bash|pwsh|powershell)|eval\s*\(\s*atob/i, weight: 95 },
  { id: 'REMOTE_PIPE_EXEC', regex: /(curl|wget|Invoke-WebRequest)\s+[^\n|]+\|\s*(sh|bash|zsh|pwsh|powershell|python3?|node)/i, weight: 100 },
];

export function detectPromptInjection(input: string, threshold = 70): InjectionScanResult {
  const safeThreshold = Math.min(100, Math.max(20, Number.isFinite(threshold) ? threshold : 70));
  const matchedRules: string[] = [];
  let score = 0;

  for (const rule of INJECTION_RULES) {
    if (rule.regex.test(input)) {
      matchedRules.push(rule.id);
      score = Math.min(100, score + rule.weight);
    }
  }

  return {
    blocked: score >= safeThreshold,
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
    case 'studio': {
      const projId = store.activeProjectId || store.projects?.[0]?.id;
      const projGoals = store.goals.filter((g) =>
        g.projectId ? g.projectId === projId : projId === 'proj-jarvis-core'
      );
      if (projGoals.length === 0) return 0.5;
      const avg =
        projGoals.reduce((acc, g) => acc + Math.min(100, Math.max(0, g.progress)) / 100, 0) /
        projGoals.length;
      return clamp01(Math.max(0.15, avg));
    }
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
    case 'llm': {
      return 1;
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
  'studio',
  'llm',
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
    const ssrfVerdict = validateSafeOutboundUrl(cleanUrl, {
      allowLocalPorts: [3000, 8765, 8766, 11434],
      allowAnyLoopbackPort: true,
    });
    if (!ssrfVerdict.allowed) {
      hardBlocked = true;
      riskScore = Math.min(100, riskScore + 95);
      checks.push({
        id: ssrfVerdict.code === 'INVALID_PROTOCOL' ? 'TRANSPORT_PROTOCOL' : 'SSRF_BOUNDARY',
        label: 'Proteção Anti-SSRF & Transporte',
        status: 'FAIL',
        detail: ssrfVerdict.reason,
      });
    } else if (ssrfVerdict.warning) {
      riskScore = Math.min(100, riskScore + 25);
      checks.push({
        id: 'TLS_POSTURE',
        label: 'Encriptação de Transporte TLS',
        status: 'WARN',
        detail: ssrfVerdict.warning,
      });
    } else {
      checks.push({
        id: 'SSRF_BOUNDARY',
        label: 'Proteção Anti-SSRF & Transporte',
        status: 'PASS',
        detail: ssrfVerdict.reason,
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

// ============================================================================
// 22. Conversational Studio Helpers (Isolated Logs, Goal Progress & Auto-Planning)
// ============================================================================

export function filterProjectActivityLogs(
  logs: ProjectActivityLogEntry[],
  projectIdOrOptions:
    | string
    | {
        projectId?: string;
        chatId?: string;
        scope?: 'CHAT' | 'PROJECT';
      },
  chatIdArg?: string,
  scopeArg: 'CHAT' | 'PROJECT' = 'CHAT'
): ProjectActivityLogEntry[] {
  if (!Array.isArray(logs) || logs.length === 0) return [];

  const resolvedProjectId =
    typeof projectIdOrOptions === 'string'
      ? projectIdOrOptions
      : projectIdOrOptions?.projectId || '';
  const resolvedChatId =
    typeof projectIdOrOptions === 'string'
      ? chatIdArg
      : projectIdOrOptions?.chatId;
  const resolvedScope: 'CHAT' | 'PROJECT' =
    typeof projectIdOrOptions === 'string'
      ? scopeArg
      : projectIdOrOptions?.scope || 'CHAT';

  return logs.filter((entry) => {
    if (resolvedProjectId && entry.projectId !== resolvedProjectId) return false;
    if (resolvedScope === 'CHAT' && resolvedChatId) {
      return entry.chatId === resolvedChatId;
    }
    return true;
  });
}

export function computeGoalProgressFromSubtasks(
  subtasks: GoalSubtask[] | undefined,
  fallbackProgress = 15
): { progress: number; status: GoalItem['status'] } {
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    const clamped = Math.max(0, Math.min(100, Math.round(fallbackProgress)));
    return {
      progress: clamped,
      status: clamped >= 100 ? 'COMPLETED' : 'ACTIVE',
    };
  }
  const doneCount = subtasks.filter((s) => s.done).length;
  const progress = Math.round((doneCount / subtasks.length) * 100);
  return {
    progress,
    status: progress >= 100 ? 'COMPLETED' : 'ACTIVE',
  };
}

export interface DeterministicStudioPlanDraft {
  isPlanningIntent: boolean;
  goalsToCreate: {
    title: string;
    category: string;
    targetMetric: string;
    subtasks: string[];
  }[];
  subagentsToSpawn: {
    name: string;
    callsign: string;
    roleTitle: string;
    description: string;
    accentColor: Room['accentColor'];
    allowedTools: string[];
  }[];
  skillsToActivate: string[]; // skill slugs
}

export function extractDeterministicPlanFromPrompt(params: {
  prompt: string;
  project?: ProjectWorkspace;
  existingGoals?: GoalItem[];
  existingRooms?: Room[];
  skills?: SkillItem[];
}): DeterministicStudioPlanDraft {
  const {
    prompt,
    project,
    existingGoals = [],
    existingRooms = [],
    skills = [],
  } = params;
  const lower = prompt.toLowerCase().trim();

  const planningKeywords = [
    'quero fazer',
    'quero criar',
    'vamos fazer',
    'vamos criar',
    'vamos planear',
    'planear',
    'planeia',
    'estruturar',
    'ideia',
    'website',
    'site',
    'landing',
    'saas',
    'app',
    'aplicação',
    'aplicacao',
    'mobile',
    'sistema',
    'plataforma',
    'goal',
    'meta',
    'objetivo',
    'roadmap',
    'arquitetura',
    'construir',
    'build',
    'create',
    'plan',
    'design',
    'agente',
    'sub-agente',
    'subagente',
  ];

  const isPlanningIntent =
    lower.length >= 16 && planningKeywords.some((kw) => lower.includes(kw));

  if (!isPlanningIntent) {
    return {
      isPlanningIntent: false,
      goalsToCreate: [],
      subagentsToSpawn: [],
      skillsToActivate: [],
    };
  }

  const projectGoals = existingGoals.filter(
    (g) => !project || !g.projectId || g.projectId === project.id
  );
  const existingTitlesLower = new Set(projectGoals.map((g) => g.title.toLowerCase()));
  const existingAgentRolesLower = new Set(
    existingRooms
      .filter((r) => !r.projectId || (project && r.projectId === project.id))
      .map((r) => `${r.name} ${r.roleTitle}`.toLowerCase())
  );

  const goalsToCreate: DeterministicStudioPlanDraft['goalsToCreate'] = [];
  const subagentsToSpawn: DeterministicStudioPlanDraft['subagentsToSpawn'] = [];
  const skillsToActivate: string[] = [];

  const isWeb =
    lower.includes('website') ||
    lower.includes('site') ||
    lower.includes('landing') ||
    lower.includes('web') ||
    lower.includes('saas') ||
    lower.includes('frontend') ||
    project?.ideaCategory === 'WEBSITE';

  const isMobile =
    lower.includes('app') ||
    lower.includes('mobile') ||
    lower.includes('ios') ||
    lower.includes('android') ||
    lower.includes('aplicação') ||
    lower.includes('aplicacao') ||
    project?.ideaCategory === 'APP';

  const isBackendOrDb =
    lower.includes('api') ||
    lower.includes('backend') ||
    lower.includes('base de dados') ||
    lower.includes('database') ||
    lower.includes('auth') ||
    lower.includes('login') ||
    lower.includes('pagamentos') ||
    lower.includes('stripe');

  if (isWeb) {
    const title = 'Definir Arquitetura Visual, UX & Páginas Principais';
    if (!existingTitlesLower.has(title.toLowerCase())) {
      goalsToCreate.push({
        title,
        category: 'Produto & UI',
        targetMetric: 'Estrutura de navegação, design system e protótipo navegável validados',
        subtasks: [
          'Mapear fluxo principal do utilizador e proposta de valor',
          'Estruturar sistema visual tipográfico e componentes chave',
          'Construir e validar secções principais em desktop e mobile',
        ],
      });
    }
    if (!Array.from(existingAgentRolesLower).some((s) => s.includes('frontend') || s.includes('ui'))) {
      subagentsToSpawn.push({
        name: 'Arquiteto UI & Frontend',
        callsign: 'STUDIO-UI-01',
        roleTitle: 'Especialista de Interface, UX & Componentes Web',
        description: 'Desenha fluxos de utilizador limpos, sistemas de design responsivos e código React/CSS.',
        accentColor: 'amber',
        allowedTools: ['upsert_project_goal', 'list_workspace_files', 'read_workspace_file', 'search_memories'],
      });
    }
  }

  if (isMobile) {
    const title = 'Estruturar Fluxos Mobile, Ecrãs Nucleares & Estado Offline';
    if (!existingTitlesLower.has(title.toLowerCase())) {
      goalsToCreate.push({
        title,
        category: 'App Mobile',
        targetMetric: 'Navegação móvel fluida, autenticação e sincronização testadas',
        subtasks: [
          'Definir ecrãs do MVP e transições principais',
          'Modelar armazenamento local e sincronização de sessão',
          'Validar ergonomia tátil e notificações chave',
        ],
      });
    }
    if (!Array.from(existingAgentRolesLower).some((s) => s.includes('mobile'))) {
      subagentsToSpawn.push({
        name: 'Engenheiro Mobile & Fluxos',
        callsign: 'MOBILE-ARCH-02',
        roleTitle: 'Especialista em Aplicações Móveis & Estado Offline-First',
        description: 'Planeia arquitetura móvel, navegação nativa, cache local e experiência cross-platform.',
        accentColor: 'violet',
        allowedTools: ['upsert_project_goal', 'search_memories', 'save_memory'],
      });
    }
  }

  if (isBackendOrDb || goalsToCreate.length === 0) {
    const cleanIdeaSnippet = prompt
      .replace(/^(olá|ola|jarvis|quero|vamos|preciso de)\s+/i, '')
      .trim()
      .slice(0, 56);
    const title = isBackendOrDb
      ? 'Modelar Dados, Autenticação & Contratos de API'
      : `Estruturar Plano de Execução: ${cleanIdeaSnippet}${prompt.length > 56 ? '…' : ''}`;

    if (!existingTitlesLower.has(title.toLowerCase())) {
      goalsToCreate.push({
        title,
        category: isBackendOrDb ? 'Backend & Dados' : 'Planeamento',
        targetMetric: 'Requisitos técnicos decompostos e validados com critérios claros',
        subtasks: [
          'Levantar entidades principais, regras de negócio e integrações',
          'Definir contratos de API, segurança e validação de dados',
          'Verificar entrega inicial com testes automatizados',
        ],
      });
    }

    if (
      !Array.from(existingAgentRolesLower).some(
        (s) => s.includes('backend') || s.includes('api') || s.includes('estrategista')
      )
    ) {
      subagentsToSpawn.push({
        name: isBackendOrDb ? 'Arquiteto Backend & Dados' : 'Estrategista de Produto',
        callsign: isBackendOrDb ? 'API-CORE-03' : 'PRODUCT-LEAD-01',
        roleTitle: isBackendOrDb
          ? 'Especialista de APIs, Esquemas & Segurança'
          : 'Coordenador de Escopo, Prioridades & Entregáveis',
        description: isBackendOrDb
          ? 'Estrutura endpoints, modelos de dados, autenticação e testes de contrato.'
          : 'Decompõe ideias complexas em etapas claras, metas mensuráveis e prioridades.',
        accentColor: 'cyan',
        allowedTools: ['upsert_project_goal', 'search_memories', 'save_memory', 'lookup_ast_symbol'],
      });
    }
  }

  for (const sk of skills) {
    const skText = `${sk.name} ${sk.slug} ${sk.description}`.toLowerCase();
    if (
      (lower.includes('test') || lower.includes('código') || lower.includes('codigo') || isWeb || isBackendOrDb) &&
      skText.includes('ast')
    ) {
      skillsToActivate.push(sk.slug);
    } else if ((lower.includes('ecrã') || lower.includes('ecra') || lower.includes('sidecar')) && skText.includes('sidecar')) {
      skillsToActivate.push(sk.slug);
    } else if (skText.includes('rrf') || skText.includes('curator')) {
      skillsToActivate.push(sk.slug);
    }
  }

  return {
    isPlanningIntent: true,
    goalsToCreate: goalsToCreate.slice(0, 2),
    subagentsToSpawn: subagentsToSpawn.slice(0, 1),
    skillsToActivate: Array.from(new Set(skillsToActivate)).slice(0, 2),
  };
}

// ============================================================================
// Unified LLM Provider Configuration, Validation & Cost/Benefit Engine
// ============================================================================

const DEPRECATED_GEMINI_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
  'gemini-2.5-flash',
]);

/**
 * Ensures the configured Gemini model is a supported @google/genai model,
 * migrating legacy/deprecated identifiers cleanly to 'gemini-3.8-flash'.
 */
export function normalizeGeminiModelId(rawModel?: string): string {
  const clean = (rawModel || '').trim();
  if (!clean) return 'gemini-3.8-flash';
  const lower = clean.toLowerCase();
  if (DEPRECATED_GEMINI_MODELS.has(lower) || lower.startsWith('gemini-1.5-') || lower.startsWith('gemini-2.0-')) {
    return 'gemini-3.8-flash';
  }
  return clean;
}

/**
 * Detects whether an OpenAI-compatible base URL points to a local inference server
 * (e.g., LM Studio :1234, vLLM :8000, LiteLLM, Jan :1337) that can operate without
 * requiring a remote cloud API key.
 */
export function isLocalOpenAiCompatibleEndpoint(endpointUrl?: string): boolean {
  const raw = (endpointUrl || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '[::1]' ||
      host === '::1' ||
      host.endsWith('.local')
    );
  } catch {
    return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(raw);
  }
}

export interface MonthlyLlmCostEstimate {
  promptsPerMonth: number;
  monthlyInputTokensRaw: number;
  monthlyInputTokensEffective: number;
  monthlyOutputTokens: number;
  monthlyTokensSavedByDiet: number;
  withinGeminiFreeTierQuota: boolean;
  geminiFreeTierEur: number;
  geminiFlashLitePaidEur: number;
  geminiFlashPaidEur: number;
  openRouterCloudEur: number;
  antigravityMcpIncrementalEur: number;
  localModesEur: number;
}

/**
 * Pure, deterministic monthly cost & token savings calculator comparing Cloud APIs
 * (with and without Jarvis 5-Stage Token Diet) against Free Tier, Antigravity MCP, and Local modes.
 */
export function estimateMonthlyLlmCostEur(params: {
  promptsPerDay: number;
  avgContextTokens?: number;
  avgOutputTokens?: number;
  tokenDietEnabled?: boolean;
}): MonthlyLlmCostEstimate {
  const promptsPerDay = Math.max(1, Math.min(5000, Math.round(params.promptsPerDay || 40)));
  const avgContextTokens = Math.max(200, params.avgContextTokens ?? 3400);
  const avgOutputTokens = Math.max(80, params.avgOutputTokens ?? 520);
  const dietEnabled = params.tokenDietEnabled !== false;

  const promptsPerMonth = promptsPerDay * 30;
  const monthlyInputTokensRaw = promptsPerMonth * avgContextTokens;
  // 5-Stage Token Diet compresses MCP schemas + memory context by ~84% on average
  const dietRatio = dietEnabled ? 0.18 : 1.0;
  const monthlyInputTokensEffective = Math.round(monthlyInputTokensRaw * dietRatio);
  const monthlyOutputTokens = promptsPerMonth * avgOutputTokens;
  const monthlyTokensSavedByDiet = Math.max(0, monthlyInputTokensRaw - monthlyInputTokensEffective);

  const inMillions = monthlyInputTokensEffective / 1_000_000;
  const outMillions = monthlyOutputTokens / 1_000_000;

  // Approximate EUR per 1M tokens rates for transparent comparison:
  // gemini-3.1-flash-lite (~0.09€ in / 0.36€ out), gemini-3.8-flash (~0.28€ in / 1.85€ out), OpenRouter frontier (~2.75€ in / 13.80€ out)
  const geminiFlashLitePaidEur = Number((inMillions * 0.09 + outMillions * 0.36).toFixed(2));
  const geminiFlashPaidEur = Number((inMillions * 0.28 + outMillions * 1.85).toFixed(2));
  const openRouterCloudEur = Number((inMillions * 2.75 + outMillions * 13.8).toFixed(2));

  const withinGeminiFreeTierQuota = promptsPerDay <= 250;

  return {
    promptsPerMonth,
    monthlyInputTokensRaw,
    monthlyInputTokensEffective,
    monthlyOutputTokens,
    monthlyTokensSavedByDiet,
    withinGeminiFreeTierQuota,
    geminiFreeTierEur: 0,
    geminiFlashLitePaidEur,
    geminiFlashPaidEur,
    openRouterCloudEur,
    antigravityMcpIncrementalEur: 0,
    localModesEur: 0,
  };
}

/**
 * Official Prebuilt Voice Personas supported by Gemini Live API (gemini-3.8-live)
 * and Gemini TTS (gemini-3.8-flash-lite-tts).
 */
export const GEMINI_VOICE_CATALOG: VoicePersonaOption[] = [
  {
    id: 'Charon',
    label: 'Charon',
    badgePt: 'Clássica J.A.R.V.I.S.',
    timbrePt: 'Profunda, serena e executiva — ideal para co-pilotagem estratégica.',
    timbreEn: 'Deep, calm, and executive — ideal for strategic co-piloting.',
  },
  {
    id: 'Zephyr',
    label: 'Zephyr',
    badgePt: 'Equilibrada & Fluida',
    timbrePt: 'Natural, luminosa e versátil para sessões longas de brainstorming.',
    timbreEn: 'Natural, balanced, and versatile for long brainstorming sessions.',
  },
  {
    id: 'Kore',
    label: 'Kore',
    badgePt: 'Clara & Analítica',
    timbrePt: 'Articulada, nítida e precisa — excelente para revisão técnica e código.',
    timbreEn: 'Crisp, articulate, and precise — great for code and technical review.',
  },
  {
    id: 'Fenrir',
    label: 'Fenrir',
    badgePt: 'Firme & Tática',
    timbrePt: 'Grave, direta e assertiva — ideal para operações rápidas e foco.',
    timbreEn: 'Resonant, direct, and tactical — built for focused operations.',
  },
  {
    id: 'Puck',
    label: 'Puck',
    badgePt: 'Dinâmica & Criativa',
    timbrePt: 'Expressiva, ágil e conversacional para explorar ideias de produto.',
    timbreEn: 'Expressive, upbeat, and conversational for product ideation.',
  },
];

export function normalizeGeminiVoiceName(raw?: string | null): GeminiVoiceName {
  const clean = (raw || '').trim().toLowerCase();
  const match = GEMINI_VOICE_CATALOG.find((v) => v.id.toLowerCase() === clean);
  return match ? match.id : 'Charon';
}

/**
 * Anti-aliased box-averaging downsampler (e.g. 48000 Hz or 44100 Hz -> 16000 Hz)
 * for Gemini Live API 16kHz PCM microphone input.
 */
export function downsampleFloat32Buffer(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = 16000
): Float32Array {
  if (!input.length || inputSampleRate <= 0 || targetSampleRate <= 0) {
    return new Float32Array(0);
  }
  if (inputSampleRate === targetSampleRate) {
    return input;
  }
  if (targetSampleRate > inputSampleRate) {
    // Linear upsample fallback if hardware runs below 16kHz
    const outLength = Math.max(1, Math.round((input.length * targetSampleRate) / inputSampleRate));
    const out = new Float32Array(outLength);
    const ratio = (input.length - 1) / Math.max(1, outLength - 1);
    for (let i = 0; i < outLength; i++) {
      const pos = i * ratio;
      const idx0 = Math.floor(pos);
      const idx1 = Math.min(input.length - 1, idx0 + 1);
      const frac = pos - idx0;
      out[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
    }
    return out;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.min(input.length, Math.round((offsetResult + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += input[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : input[Math.min(input.length - 1, offsetBuffer)];
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function uint8ToBase64CrossEnv(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToUint8CrossEnv(base64: string): Uint8Array {
  const clean = (base64 || '').trim();
  if (!clean) return new Uint8Array(0);
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(clean, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * Encodes normalized Float32 [-1, 1] audio samples to Base64 16-bit Little-Endian PCM
 * (`audio/pcm;rate=16000` for Gemini Live API).
 */
export function encodeFloat32ToPcm16Base64(samples: Float32Array): string {
  if (!samples.length) return '';
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    view.setInt16(i * 2, int16, true); // little-endian
  }
  return uint8ToBase64CrossEnv(new Uint8Array(buffer));
}

/**
 * Decodes Base64 16-bit Little-Endian raw PCM (`24000` Hz from Gemini Live API)
 * directly into normalized Float32 [-1, 1] samples for WebAudio playback.
 */
export function decodePcm16Base64ToFloat32(base64: string): Float32Array {
  const bytes = base64ToUint8CrossEnv(base64);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (sampleCount <= 0) return new Float32Array(0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(i * 2, true);
    out[i] = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
  }
  return out;
}

/**
 * Extracts Float32 samples and sampleRate from either a unary RIFF WAV (`audio/wav`
 * returned by `gemini-3.8-flash-lite-tts`) or headerless raw 16-bit LE PCM (`24000` Hz).
 */
export function extractPcm16FromWavOrRawBase64(
  base64: string,
  defaultSampleRate = 24000
): { samples: Float32Array; sampleRate: number; wasWav: boolean } {
  const bytes = base64ToUint8CrossEnv(base64);
  if (bytes.byteLength < 2) {
    return { samples: new Float32Array(0), sampleRate: defaultSampleRate, wasWav: false };
  }

  // Check for "RIFF" .... "WAVE" header
  const isRiffWave =
    bytes.byteLength > 44 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x41 && // A
    bytes[10] === 0x56 && // V
    bytes[11] === 0x45; // E

  if (isRiffWave) {
    const headerView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const wavSampleRate = headerView.getUint32(24, true) || defaultSampleRate;
    // Locate "data" subchunk dynamically (usually at byte 36 -> payload at 44)
    let dataOffset = 44;
    let dataByteLen = bytes.byteLength - 44;
    let cursor = 12;
    while (cursor + 8 <= bytes.byteLength) {
      const c0 = bytes[cursor];
      const c1 = bytes[cursor + 1];
      const c2 = bytes[cursor + 2];
      const c3 = bytes[cursor + 3];
      const chunkSize = headerView.getUint32(cursor + 4, true);
      if (c0 === 0x64 && c1 === 0x61 && c2 === 0x74 && c3 === 0x61) {
        dataOffset = cursor + 8;
        dataByteLen = Math.min(chunkSize, bytes.byteLength - dataOffset);
        break;
      }
      cursor += 8 + chunkSize + (chunkSize % 2);
    }

    const sampleCount = Math.floor(Math.max(0, dataByteLen) / 2);
    const pcmView = new DataView(bytes.buffer, bytes.byteOffset + dataOffset, sampleCount * 2);
    const samples = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const int16 = pcmView.getInt16(i * 2, true);
      samples[i] = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
    }
    return { samples, sampleRate: wavSampleRate, wasWav: true };
  }

  return {
    samples: decodePcm16Base64ToFloat32(base64),
    sampleRate: defaultSampleRate,
    wasWav: false,
  };
}

// ============================================================================
// Studio Enhancements: URL Context Extraction, Screen Region Crop,
// Cross-Project HippoRAG Memory Reuse, Interactive Artifacts & Blueprint Export
// ============================================================================

/**
 * Extracts up to 20 deduplicated HTTP/HTTPS URLs from a user prompt for Gemini `urlContext`.
 */
export function extractUrlsFromPrompt(text: string, maxUrls = 20): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>"'`)\]]+/gi) || [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?]+$/, '');
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        const href = parsed.toString();
        if (!seen.has(href)) {
          seen.add(href);
          out.push(href);
          if (out.length >= maxUrls) break;
        }
      }
    } catch {
      // Ignore malformed URLs
    }
  }
  return out;
}

/**
 * Clamps a normalized screen crop region into `[0..1]` and guarantees minimum 4% width/height.
 */
export function normalizeScreenRegionBox(box: NormalizedScreenRegion): NormalizedScreenRegion {
  const minSize = 0.04;
  const rawW = Number.isFinite(box.w) ? Math.abs(box.w) : 0.25;
  const rawH = Number.isFinite(box.h) ? Math.abs(box.h) : 0.25;
  const w = Math.max(minSize, Math.min(1, rawW));
  const h = Math.max(minSize, Math.min(1, rawH));

  const rawX = Number.isFinite(box.x) ? box.x : 0;
  const rawY = Number.isFinite(box.y) ? box.y : 0;
  const x = Math.max(0, Math.min(1 - w, rawX));
  const y = Math.max(0, Math.min(1 - h, rawY));

  return {
    x: Number(x.toFixed(4)),
    y: Number(y.toFixed(4)),
    w: Number(w.toFixed(4)),
    h: Number(h.toFixed(4)),
  };
}

/**
 * Surfaces reusable architectural decisions, preferences, and stack facts from OTHER projects
 * (or global semantic memory) that match the active project's stack or category.
 */
export function findCrossProjectReusableMemories(params: {
  activeProject: ProjectWorkspace;
  projects?: ProjectWorkspace[];
  memories: MemoryItem[];
  limit?: number;
}): MemoryItem[] {
  const { activeProject, memories, limit = 3 } = params;
  const stackTokens = `${activeProject.techStack} ${activeProject.ideaCategory || ''} ${activeProject.ideaBrief || ''}`
    .toLowerCase()
    .split(/[^a-z0-9à-ÿ+#.-]+/i)
    .filter((tok) => tok.length >= 3);
  const tokenSet = new Set(stackTokens);

  const scored: { mem: MemoryItem; score: number }[] = [];
  for (const mem of memories) {
    if (mem.supersededBy) continue;
    // Focus on reusable architectural / preference / fact memories
    if (!['PREFERENCE', 'DECISION', 'FACT', 'COMMITMENT'].includes(mem.category)) continue;

    // Skip if already explicitly tagged exclusively for this exact project ID
    if (mem.tags?.includes(`applied:${activeProject.id}`)) continue;

    const hay = `${mem.topic} ${mem.content} ${(mem.tags || []).join(' ')}`.toLowerCase();
    let overlap = 0;
    for (const tok of tokenSet) {
      if (hay.includes(tok)) overlap += 1;
    }

    let score = overlap * 2 + (mem.pinned ? 3 : 0) + (mem.importance ?? 3) * 0.5;
    if (mem.category === 'PREFERENCE' || mem.category === 'DECISION') {
      score += 2.5;
    }
    if (score >= 3.5) {
      scored.push({ mem, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, limit)).map((s) => s.mem);
}

/**
 * Builds a complete 4-file Antigravity / Cursor / VS Code Starter Blueprint
 * (`PRD.md`, `ARCHITECTURE.md`, `TASKS.md`, `AGENTS.md`) from the active Studio workspace.
 */
export function buildAntigravityProjectBlueprint(params: {
  project: ProjectWorkspace;
  goals: GoalItem[];
  agents: Room[];
  skills: SkillItem[];
  artifacts?: ProjectArtifact[];
  memories?: MemoryItem[];
  generatedAt?: string;
}): ProjectBlueprintBundle {
  const {
    project,
    goals,
    agents,
    skills,
    artifacts = [],
    memories = [],
    generatedAt = new Date().toISOString(),
  } = params;

  const projGoals = goals.filter(
    (g) => !g.projectId || g.projectId === project.id
  );
  const activeSkills = skills.filter(
    (s) => s.enabled && (!project.activeSkillIds || project.activeSkillIds.includes(s.id))
  );
  const projArtifacts = artifacts.filter((a) => a.projectId === project.id);
  const reusableMemories = findCrossProjectReusableMemories({
    activeProject: project,
    memories,
    limit: 5,
  });

  const prdMd = [
    `# PRD — ${project.name}`,
    ``,
    `- **Categoria**: \`${project.ideaCategory || 'CUSTOM'}\``,
    `- **Stack Principal**: \`${project.techStack}\``,
    `- **Caminho / Branch**: \`${project.rootPath}\` (\`${project.gitBranch}\`)`,
    `- **Exportado em**: \`${generatedAt.slice(0, 19).replace('T', ' ')} UTC\``,
    ``,
    `## 1. Visão & Resumo do Produto`,
    project.ideaBrief || project.description || 'Projeto planeado no J.A.R.V.I.S. Studio.',
    ``,
    `## 2. Objetivos Estruturados (Goals) & Critérios de Sucesso`,
    projGoals.length > 0
      ? projGoals
          .map(
            (g, i) =>
              `### ${i + 1}. ${g.title} (${g.status} · ${g.progress}%)\n- **Categoria**: ${g.category}\n- **Meta Verificável**: ${g.targetMetric}\n- **Prazo Alvo**: ${g.deadline}`
          )
          .join('\n\n')
      : '_Nenhum Goal registado ainda. Usa o J.A.R.V.I.S. Studio para gerar os primeiros objetivos._',
    ``,
    `## 3. Artefactos & Protótipos Validados (${projArtifacts.length})`,
    projArtifacts.length > 0
      ? projArtifacts
          .map(
            (a) =>
              `- **${a.title}** (\`${a.kind}\` · v${a.currentVersion}) — ${
                a.versions[a.versions.length - 1]?.summary || 'Artefacto interativo'
              }`
          )
          .join('\n')
      : '- Sem artefactos anexados.',
  ].join('\n');

  const architectureMd = [
    `# ARCHITECTURE — ${project.name}`,
    ``,
    `## 1. Stack Tecnológica & Convenções`,
    `- **Stack**: ${project.techStack}`,
    `- **Diretório Raiz**: \`${project.rootPath}\``,
    `- **Saúde Atual do Projeto**: ${project.healthScore}%`,
    ``,
    `## 2. Decisões Arquiteturais & Memória Semântica (HippoRAG)`,
    reusableMemories.length > 0
      ? reusableMemories
          .map((m) => `- **[${m.category}] ${m.topic}**: ${m.content}`)
          .join('\n')
      : `- Modularidade estrita entre lógica pura testável (\`src/shared/\`) e componentes visuais (\`src/components/\`).`,
    ``,
    `## 3. Skills Estilo Antigravity Ativas (${activeSkills.length})`,
    activeSkills.length > 0
      ? activeSkills
          .map(
            (s) =>
              `- **${s.name}** (\`${s.slug}\`, comando \`${s.quickCommand}\`): ${s.description}`
          )
          .join('\n')
      : `- Skills padrão de auditoria AST e curadoria bi-temporal.`,
  ].join('\n');

  const tasksMd = [
    `# TASKS — Plano de Execução (${project.name})`,
    ``,
    projGoals.length > 0
      ? projGoals
          .map((g) => {
            const header = `## [${g.status === 'COMPLETED' ? 'x' : ' '}] ${g.title} (${g.progress}%)`;
            const subs =
              g.subtasks && g.subtasks.length > 0
                ? g.subtasks
                    .map((st) => `- [${st.done ? 'x' : ' '}] ${st.title}`)
                    .join('\n')
                : `- [ ] Concluir critério: ${g.targetMetric}`;
            return `${header}\n${subs}`;
          })
          .join('\n\n')
      : `- [ ] Definir arquitetura inicial de ${project.name}\n- [ ] Implementar fluxos críticos e testes unitários`,
  ].join('\n');

  const agentsMd = [
    `# AGENTS.md — Regras de Agentes & Sub-Agentes (${project.name})`,
    ``,
    `## 1. Princípios de Engenharia`,
    `- Responder sempre em **Português de Portugal (PT-PT)**.`,
    `- Separar regras de negócio e cálculos puros dos componentes de interface para cobertura de testes determinísticos.`,
    `- Validar compilação TypeScript e testes unitários antes de cada entrega.`,
    ``,
    `## 2. Equipa de Agentes Alocada (${agents.length})`,
    agents.length > 0
      ? agents
          .map(
            (ag) =>
              `### ${ag.name}${ag.callsign ? ` (\`${ag.callsign}\`)` : ''}\n- **Papel**: ${ag.roleTitle}\n- **Responsabilidade**: ${ag.description}\n- **Ferramentas Autorizadas**: \`${(ag.allowedTools || []).join(', ')}\``
          )
          .join('\n\n')
      : `- **Jarvis (Coordenador)**: Planeamento executivo, Goals e revisão arquitetural.`,
  ].join('\n');

  const bundleMd = [
    prdMd,
    '\n---\n',
    architectureMd,
    '\n---\n',
    tasksMd,
    '\n---\n',
    agentsMd,
  ].join('\n');

  return {
    projectName: project.name,
    generatedAt,
    prdMd,
    architectureMd,
    tasksMd,
    agentsMd,
    bundleMd,
  };
}

/**
 * Generates a clean deterministic interactive Artifact (`HTML_PREVIEW`, `SVG_DIAGRAM`, `MARKDOWN_DOC`, or `CODE_MODULE`)
 * when requested in offline/local mode or via quick artifact generator fallback.
 */
export function buildDeterministicArtifactFromPrompt(params: {
  prompt: string;
  project?: ProjectWorkspace;
  preferredKind?: ArtifactKind;
}): {
  title: string;
  kind: ArtifactKind;
  language: string;
  content: string;
  summary: string;
} {
  const { prompt, project, preferredKind } = params;
  const lower = prompt.toLowerCase();
  const projName = project?.name || 'Projeto Studio';

  const resolvedKind: ArtifactKind =
    preferredKind ||
    (lower.includes('svg') || lower.includes('diagrama') || lower.includes('fluxograma') || lower.includes('arquitetura visual')
      ? 'SVG_DIAGRAM'
      : lower.includes('markdown') || lower.includes('prd') || lower.includes('especificação') || lower.includes('documento')
        ? 'MARKDOWN_DOC'
        : lower.includes('typescript') || lower.includes('python') || lower.includes('função') || lower.includes('api route') || lower.includes('hook')
          ? 'CODE_MODULE'
          : 'HTML_PREVIEW');

  if (resolvedKind === 'SVG_DIAGRAM') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 360" width="100%" height="100%">
  <rect width="760" height="360" rx="16" fill="#0b0d11" />
  <rect x="24" y="24" width="712" height="312" rx="12" fill="#12161f" stroke="#242c3d" stroke-width="1.5" />
  <text x="48" y="62" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="16" font-weight="700">Arquitetura Modular — ${projName}</text>
  <text x="48" y="84" fill="#94a3b8" font-family="monospace" font-size="11">Fluxo Cliente ⇄ API Gateway ⇄ Motor de Dados &amp; Verificação</text>
  <rect x="48" y="130" width="185" height="120" rx="12" fill="#171d29" stroke="#e59a54" stroke-width="1.5" />
  <text x="70" y="166" fill="#e59a54" font-family="monospace" font-size="11" font-weight="600">01 · FRONTEND UI</text>
  <text x="70" y="192" fill="#f1f5f9" font-family="system-ui, sans-serif" font-size="13" font-weight="600">Interface Reativa</text>
  <text x="70" y="214" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="11"> Estados &amp; PWA Offline</text>
  <line x1="233" y1="190" x2="287" y2="190" stroke="#e59a54" stroke-width="2" />
  <polygon points="287,190 279,185 279,195" fill="#e59a54" />
  <rect x="288" y="130" width="185" height="120" rx="12" fill="#171d29" stroke="#8ea6ff" stroke-width="1.5" />
  <text x="310" y="166" fill="#8ea6ff" font-family="monospace" font-size="11" font-weight="600">02 · API &amp; AGENTES</text>
  <text x="310" y="192" fill="#f1f5f9" font-family="system-ui, sans-serif" font-size="13" font-weight="600">Serviços &amp; Auth</text>
  <text x="310" y="214" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="11">Validação &amp; Webhooks</text>
  <line x1="473" y1="190" x2="527" y2="190" stroke="#34d399" stroke-width="2" />
  <polygon points="527,190 519,185 519,195" fill="#34d399" />
  <rect x="528" y="130" width="184" height="120" rx="12" fill="#171d29" stroke="#34d399" stroke-width="1.5" />
  <text x="548" y="166" fill="#34d399" font-family="monospace" font-size="11" font-weight="600">03 · PERSISTÊNCIA</text>
  <text x="548" y="192" fill="#f1f5f9" font-family="system-ui, sans-serif" font-size="13" font-weight="600">Dados &amp; Telemetria</text>
  <text x="548" y="214" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="11">SQLite WAL / Cloud DB</text>
</svg>`;
    return {
      title: `Diagrama de Arquitetura · ${projName}`,
      kind: 'SVG_DIAGRAM',
      language: 'svg',
      content: svg,
      summary: `Diagrama SVG vetorial gerado para "${prompt.slice(0, 64)}".`,
    };
  }

  if (resolvedKind === 'MARKDOWN_DOC') {
    const md = `# Especificação Funcional — ${projName}\n\n## Objetivo\n${prompt}\n\n## Requisitos Principais\n- Arquitetura limpa com estados de carregamento, vazio e erro explícitos.\n- Acessibilidade nativa por teclado e contraste elevado.\n- Cobertura de testes unitários para regras críticas.\n\n## Critérios de Aceitação\n- [ ] Fluxo principal validado ponta a ponta\n- [ ] Zero erros de consola e latência sub-100ms nas interações locais`;
    return {
      title: `Especificação · ${projName}`,
      kind: 'MARKDOWN_DOC',
      language: 'markdown',
      content: md,
      summary: `Documento técnico estruturado para "${prompt.slice(0, 64)}".`,
    };
  }

  if (resolvedKind === 'CODE_MODULE') {
    const code = `export interface PlanTier {\n  id: string;\n  name: string;\n  monthlyEur: number;\n  annualDiscountPct: number;\n}\n\nexport function calculateEffectiveMonthlyPrice(tier: PlanTier, annualBilling: boolean): number {\n  if (!annualBilling) return tier.monthlyEur;\n  const factor = Math.max(0, Math.min(1, 1 - tier.annualDiscountPct / 100));\n  return Number((tier.monthlyEur * factor).toFixed(2));\n}\n`;
    return {
      title: `Módulo TypeScript · ${projName}`,
      kind: 'CODE_MODULE',
      language: 'typescript',
      content: code,
      summary: `Módulo TypeScript tipado gerado para "${prompt.slice(0, 64)}".`,
    };
  }

  const html = `<!DOCTYPE html>
<html lang="pt-PT">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-[#0b0d11] text-slate-100 font-sans antialiased p-6">
  <div class="max-w-xl mx-auto space-y-6">
    <header class="flex items-center justify-between border-b border-white/10 pb-4">
      <div>
        <p class="text-xs uppercase tracking-wider text-amber-400 font-semibold">${projName}</p>
        <h1 class="text-xl font-bold tracking-tight mt-0.5">Protótipo Interativo em Direto</h1>
      </div>
      <button id="billingToggle" class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium transition">
        Faturação: <span id="billingLabel" class="text-amber-300 font-semibold">Mensal</span>
      </button>
    </header>
    <p class="text-sm text-slate-300 leading-relaxed">${prompt.replace(/[<>&]/g, '')}</p>
    <div class="grid grid-cols-2 gap-3">
      <div class="p-4 rounded-xl bg-[#141821] border border-white/10 space-y-2">
        <p class="text-xs text-slate-400 font-medium">Plano Starter</p>
        <p class="text-2xl font-bold tabular-nums"><span id="priceStarter">19€</span><span class="text-xs text-slate-400 font-normal">/mês</span></p>
        <button class="w-full py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold transition">Começar Agora</button>
      </div>
      <div class="p-4 rounded-xl bg-[#181f2e] border border-amber-400/40 space-y-2">
        <p class="text-xs text-amber-300 font-medium">Plano Studio Pro</p>
        <p class="text-2xl font-bold tabular-nums"><span id="pricePro">49€</span><span class="text-xs text-slate-400 font-normal">/mês</span></p>
        <button class="w-full py-2 rounded-lg bg-amber-400 text-slate-950 hover:bg-amber-300 text-xs font-semibold transition">Selecionar Pro</button>
      </div>
    </div>
  </div>
  <script>
    let annual = false;
    document.getElementById('billingToggle').addEventListener('click', () => {
      annual = !annual;
      document.getElementById('billingLabel').textContent = annual ? 'Anual (-20%)' : 'Mensal';
      document.getElementById('priceStarter').textContent = annual ? '15€' : '19€';
      document.getElementById('pricePro').textContent = annual ? '39€' : '49€';
    });
  </script>
</body>
</html>`;

  return {
    title: `Protótipo UI · ${projName}`,
    kind: 'HTML_PREVIEW',
    language: 'html',
    content: html,
    summary: `Protótipo HTML/Tailwind interativo para "${prompt.slice(0, 64)}".`,
  };
}

// ============================================================================
// Architectural Security Hardening (A-04, A-05, A-08) & Vault Intelligence (§7)
// ============================================================================

/**
 * A-05: Strict boundary-aware path containment check (browser & Node pure logic).
 * Prevents prefix bypasses where root "/app" falsely matched "/app-evil/secret".
 */
export function isPathInsideWorkspace(workspaceRoot: string, candidateAbsPath: string): boolean {
  const normalizeSlashes = (p: string) =>
    p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');

  const rootNorm = normalizeSlashes(workspaceRoot.trim());
  const candNorm = normalizeSlashes(candidateAbsPath.trim());
  if (!rootNorm || !candNorm) return false;
  if (candNorm.includes('\0')) return false;

  // Collapse any '.' or '..' segments canonically
  const resolveSegments = (fullPath: string): string => {
    const isWinDrive = /^[A-Za-z]:/.test(fullPath);
    const prefix = isWinDrive ? fullPath.slice(0, 2).toLowerCase() : fullPath.startsWith('/') ? '' : '';
    const rawParts = (isWinDrive ? fullPath.slice(2) : fullPath).split('/');
    const stack: string[] = [];
    for (const part of rawParts) {
      if (!part || part === '.') continue;
      if (part === '..') {
        stack.pop();
      } else {
        stack.push(isWinDrive ? part.toLowerCase() : part);
      }
    }
    return `${prefix}/${stack.join('/')}`;
  };

  const canonicalRoot = resolveSegments(rootNorm);
  const canonicalCand = resolveSegments(candNorm);

  if (canonicalCand === canonicalRoot) return true;
  const rootWithSep = canonicalRoot === '/' ? '/' : `${canonicalRoot}/`;
  return canonicalCand.startsWith(rootWithSep);
}

/**
 * A-04: Structured Shell Command Analyzer & Tokenizer.
 * Parses commands without shell operators (`;`, `|`, `&&`, `$()`, `` ` ``, `>`, `<`)
 * into `[executable, ...args]` so `execFile` runs with `shell: false`.
 * Flags shell interpolation operators so they always require explicit operator review.
 */
export interface ShellSafetyAnalysis {
  canUseExecFile: boolean;
  executable: string;
  args: string[];
  hasShellOperators: boolean;
  detectedOperators: string[];
  riskAdjustment: number;
}

export function analyzeShellCommandSafety(rawCommand: string): ShellSafetyAnalysis {
  const trimmed = rawCommand.trim();
  if (!trimmed) {
    return {
      canUseExecFile: false,
      executable: '',
      args: [],
      hasShellOperators: false,
      detectedOperators: [],
      riskAdjustment: 0,
    };
  }

  const detectedOperators: string[] = [];
  if (/[;\n\r]/.test(trimmed)) detectedOperators.push(';');
  if (/&&|\|\|/.test(trimmed)) detectedOperators.push('&&/||');
  if (/(?<!\|)\|(?!\|)/.test(trimmed)) detectedOperators.push('|');
  if (/\$\(|`/.test(trimmed)) detectedOperators.push('$()/`');
  if (/[><]/.test(trimmed)) detectedOperators.push('>/</redirect');

  const hasShellOperators = detectedOperators.length > 0;
  if (hasShellOperators) {
    return {
      canUseExecFile: false,
      executable: '',
      args: [],
      hasShellOperators: true,
      detectedOperators,
      riskAdjustment: Math.min(45, detectedOperators.length * 20),
    };
  }

  // Tokenize respecting single and double quotes without shell interpolation
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (quote !== null) {
    return {
      canUseExecFile: false,
      executable: '',
      args: [],
      hasShellOperators: true,
      detectedOperators: ['UNCLOSED_QUOTE'],
      riskAdjustment: 25,
    };
  }
  if (current.length > 0) tokens.push(current);

  const [executable = '', ...args] = tokens;
  const validBin = /^[A-Za-z0-9._/\\:-]+$/.test(executable) && !executable.includes('..');

  return {
    canUseExecFile: Boolean(executable) && validBin,
    executable: validBin ? executable : '',
    args: validBin ? args : [],
    hasShellOperators: false,
    detectedOperators: [],
    riskAdjustment: 0,
  };
}

/**
 * A-08: Unified Anti-SSRF Outbound URL Validator used by both HTTP_CHECK contracts
 * and MCP External Server Probes.
 * Blocks cloud metadata (169.254.0.0/16), 0.0.0.0, RFC1918 private networks (10/8,
 * 172.16/12, 192.168/16), IPv6 link-local/ULA, and non-allowlisted loopback targets.
 */
export interface SafeOutboundUrlVerdict {
  allowed: boolean;
  code: 'OK' | 'INVALID_SYNTAX' | 'INVALID_PROTOCOL' | 'BLOCKED_METADATA' | 'BLOCKED_LOOPBACK' | 'BLOCKED_PRIVATE_NET';
  reason: string;
  warning?: string;
}

export function validateSafeOutboundUrl(
  rawUrl: string,
  options?: {
    allowLocalPorts?: number[];
    allowAnyLoopbackPort?: boolean;
    allowPrivateNetworks?: boolean;
  }
): SafeOutboundUrlVerdict {
  const clean = (rawUrl || '').trim();
  if (!clean) {
    return {
      allowed: false,
      code: 'INVALID_SYNTAX',
      reason: 'URL de destino em falta ou vazio.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    return {
      allowed: false,
      code: 'INVALID_SYNTAX',
      reason: 'URL de endpoint sintaticamente inválido.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      allowed: false,
      code: 'INVALID_PROTOCOL',
      reason: `Protocolo '${parsed.protocol}' proibido. Usa apenas http:// (loopback autorizado) ou https://.`,
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // 1. Cloud Metadata & Unspecified Bind Addresses (Hard Block Always)
  if (
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host.startsWith('169.254.') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host.startsWith('fe80:')
  ) {
    return {
      allowed: false,
      code: 'BLOCKED_METADATA',
      reason: `Destino '${host}' bloqueado pela proteção Anti-SSRF (Cloud Metadata / Link-Local).`,
    };
  }

  // 2. Loopback Range (127.0.0.0/8, localhost, ::1)
  const isIpv4Loopback = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  const isLoopback = isIpv4Loopback || host === 'localhost' || host === '::1';
  if (isLoopback) {
    // Block non-standard 127.x.y.z aliases (e.g. 127.0.0.2) unless 127.0.0.1 / localhost / ::1
    if (isIpv4Loopback && host !== '127.0.0.1') {
      return {
        allowed: false,
        code: 'BLOCKED_LOOPBACK',
        reason: `Endereço loopback alternativo '${host}' bloqueado por prevenção SSRF.`,
      };
    }
    if (options?.allowAnyLoopbackPort) {
      return {
        allowed: true,
        code: 'OK',
        reason: `Loopback local autorizado (${host}).`,
      };
    }
    const effectivePort = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === 'https:'
        ? 443
        : 80;
    const allowedPorts = options?.allowLocalPorts || [];
    if (allowedPorts.includes(effectivePort)) {
      return {
        allowed: true,
        code: 'OK',
        reason: `Sonda local autorizada em ${host}:${effectivePort}.`,
      };
    }
    return {
      allowed: false,
      code: 'BLOCKED_LOOPBACK',
      reason: `Porta loopback ${host}:${effectivePort} bloqueada (apenas portas locais autorizadas são permitidas).`,
    };
  }

  // 3. RFC1918 Private IPv4 & IPv6 Unique Local (10/8, 172.16/12, 192.168/16, fc00::/7)
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const isPrivateIpv4 = Boolean(
    ipv4Match &&
      (Number(ipv4Match[1]) === 10 ||
        (Number(ipv4Match[1]) === 172 && Number(ipv4Match[2]) >= 16 && Number(ipv4Match[2]) <= 31) ||
        (Number(ipv4Match[1]) === 192 && Number(ipv4Match[2]) === 168))
  );
  const isPrivateIpv6 = host.startsWith('fc') || host.startsWith('fd');

  if ((isPrivateIpv4 || isPrivateIpv6) && !options?.allowPrivateNetworks) {
    return {
      allowed: false,
      code: 'BLOCKED_PRIVATE_NET',
      reason: `Rede interna privada '${host}' bloqueada por omissão contra SSRF (define JARVIS_ALLOW_PRIVATE_NET_PROBES=1 para permitir).`,
    };
  }

  const warning =
    parsed.protocol === 'http:'
      ? `Endpoint remoto sem TLS (${host}). Recomenda-se HTTPS para tráfego externo.`
      : undefined;

  return {
    allowed: true,
    code: 'OK',
    reason: `Ligação externa validada (${host}).`,
    warning,
  };
}

/**
 * §7 Recommended Addition 1: Automatic Entity Extraction & Graph Edge Inference on Memory Ingest.
 * Extracts code files, ports, architectural technologies, and commitments from new memories
 * and automatically links them to existing active memories that share entities or strong BQ similarity.
 */
const KNOWN_TECH_ENTITIES = [
  'typescript',
  'python',
  'sqlite',
  'postgres',
  'postgresql',
  'react',
  'tailwind',
  'express',
  'vite',
  'hipporag',
  'ebbinghaus',
  'mcp',
  'sidecar',
  'webrtc',
  'oauth',
  'stripe',
  'docker',
  'playwright',
  'threejs',
  'gemini',
  'ollama',
  'openrouter',
];

export function extractMemoryEntities(text: string): {
  entities: string[];
  hasCommitment: boolean;
} {
  const found = new Set<string>();
  const clean = text || '';

  // 1. Source file references (e.g. server.ts, db.ts, cortex-math.ts, app.py)
  const fileMatches = clean.match(/\b[A-Za-z0-9_-]+\.(?:ts|tsx|js|mjs|py|json|md|sql|sh|bat)\b/g) || [];
  for (const f of fileMatches) {
    found.add(f.toLowerCase());
  }

  // 2. Port numbers (e.g. :3000, porta 5432, port 8765)
  const portMatches = clean.match(/(?::|\bporta\s+|\bport\s+)(3000|5432|6379|8000|8080|8765|8766|11434)\b/gi) || [];
  for (const pm of portMatches) {
    const num = pm.replace(/\D+/g, '');
    if (num) found.add(`port:${num}`);
  }

  // 3. Known technology & subsystem keywords
  const lower = clean.toLowerCase();
  for (const tech of KNOWN_TECH_ENTITIES) {
    const re = new RegExp(`\\b${tech}\\b`, 'i');
    if (re.test(lower)) {
      found.add(tech);
    }
  }

  // 4. Capitalized CamelCase / PascalCase module identifiers (e.g. JarvisDatabase, BrainBridge)
  const camelMatches = clean.match(/\b[A-Z][a-z0-9]+(?:[A-Z][a-zA-Z0-9]+)+\b/g) || [];
  for (const cm of camelMatches.slice(0, 6)) {
    found.add(cm.toLowerCase());
  }

  const hasCommitment =
    /\b(vou\s+\w+|iremos\s+\w+|i\s+will\s+\w+|we\s+will\s+\w+|todo:|fixme:|obrigat[oó]rio)\b/i.test(clean);

  return {
    entities: Array.from(found).slice(0, 10),
    hasCommitment,
  };
}

export function extractEntitiesAndInferEdges(params: {
  newMemory: MemoryItem;
  existingMemories: MemoryItem[];
  existingEdges: GraphEdge[];
  maxInferredEdges?: number;
}): { enrichedTags: string[]; inferredEdges: GraphEdge[]; extractedEntities: string[] } {
  const { newMemory, existingMemories, existingEdges, maxInferredEdges = 4 } = params;
  const combinedText = `${newMemory.topic} ${newMemory.content}`;
  const { entities, hasCommitment } = extractMemoryEntities(combinedText);

  const tagSet = new Set<string>((newMemory.tags || []).map((t) => t.trim()).filter(Boolean));
  for (const ent of entities.slice(0, 5)) {
    tagSet.add(ent);
  }
  if (hasCommitment) tagSet.add('compromisso');

  const newBq = newMemory.bq128Hex || computeBinaryQuantization128(combinedText);
  const candidates: { targetId: string; weight: number; relation: string }[] = [];

  const alreadyLinked = new Set<string>();
  for (const e of existingEdges) {
    if (e.source === newMemory.id) alreadyLinked.add(e.target);
    if (e.target === newMemory.id) alreadyLinked.add(e.source);
  }

  for (const other of existingMemories) {
    if (other.id === newMemory.id || other.supersededBy || other.validUntil) continue;
    if (alreadyLinked.has(other.id)) continue;

    const otherEntities = extractMemoryEntities(`${other.topic} ${other.content}`).entities;
    const shared = entities.filter((e) => otherEntities.includes(e) || (other.tags || []).includes(e));

    const otherBq = other.bq128Hex || computeBinaryQuantization128(`${other.topic} ${other.content}`);
    const bqSim = hammingSimilarity128(newBq, otherBq);

    if (shared.length > 0) {
      const weight = Number(Math.min(0.98, 0.72 + shared.length * 0.08).toFixed(2));
      candidates.push({
        targetId: other.id,
        weight,
        relation: `ENTIDADE_${shared[0].toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
      });
    } else if (bqSim >= 0.72) {
      candidates.push({
        targetId: other.id,
        weight: Number(bqSim.toFixed(2)),
        relation: 'SIMILARIDADE_SEMANTICA',
      });
    }
  }

  candidates.sort((a, b) => b.weight - a.weight);
  const inferredEdges: GraphEdge[] = candidates.slice(0, maxInferredEdges).map((c, idx) => ({
    id: `edge-auto-${Date.now()}-${idx}-${c.targetId.slice(-4)}`,
    source: newMemory.id,
    target: c.targetId,
    relation: c.relation,
    weight: c.weight,
  }));

  return {
    enrichedTags: Array.from(tagSet),
    inferredEdges,
    extractedEntities: entities,
  };
}

/**
 * §7 Recommended Addition 2: Scheduled Memory Vault Compaction & Ebbinghaus Pruning.
 * 1. Auto-supersedes near-duplicate active memories (128-bit BQ similarity >= duplicateBqThreshold, default 0.92).
 * 2. Prunes unpinned WORKING-tier memories untouched for > workingMaxAgeDays (default 7 days).
 * 3. Decays importance by 1 step on unpinned EPISODIC memories whose Ebbinghaus retention fell below 0.20.
 */
export interface MemoryCompactionResult {
  memories: MemoryItem[];
  edges: GraphEdge[];
  duplicatesSuperseded: number;
  workingPruned: number;
  importanceDecayed: number;
}

export function compactMemoryVault(params: {
  memories: MemoryItem[];
  edges: GraphEdge[];
  nowMs?: number;
  workingMaxAgeDays?: number;
  duplicateBqThreshold?: number;
}): MemoryCompactionResult {
  const nowMs = params.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const workingMaxAgeDays = Math.max(1, params.workingMaxAgeDays ?? 7);
  const duplicateThreshold = params.duplicateBqThreshold ?? 0.92;

  const cloned: MemoryItem[] = params.memories.map((m) => ({
    ...m,
    bq128Hex: m.bq128Hex || computeBinaryQuantization128(`${m.topic} ${m.content}`),
  }));
  const nextEdges: GraphEdge[] = [...params.edges];

  let duplicatesSuperseded = 0;
  let workingPruned = 0;
  let importanceDecayed = 0;

  // Sort active memories newest/highest-importance first so the canonical survivor supersedes older duplicates
  const activeIndices = cloned
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => !m.supersededBy && !m.validUntil)
    .sort((a, b) => {
      if (a.m.pinned !== b.m.pinned) return a.m.pinned ? -1 : 1;
      const tA = Date.parse(a.m.updatedAt || a.m.createdAt || nowIso) || 0;
      const tB = Date.parse(b.m.updatedAt || b.m.createdAt || nowIso) || 0;
      return tB - tA;
    });

  for (let i = 0; i < activeIndices.length; i++) {
    const survivor = cloned[activeIndices[i].idx];
    if (survivor.supersededBy || survivor.validUntil) continue;

    for (let j = i + 1; j < activeIndices.length; j++) {
      const candidate = cloned[activeIndices[j].idx];
      if (candidate.supersededBy || candidate.validUntil || candidate.pinned) continue;

      const sim = hammingSimilarity128(survivor.bq128Hex!, candidate.bq128Hex!);
      if (sim >= duplicateThreshold) {
        candidate.validUntil = nowIso;
        candidate.supersededBy = survivor.id;
        candidate.updatedAt = nowIso;
        duplicatesSuperseded += 1;
        nextEdges.push({
          id: `edge-compact-${nowMs}-${candidate.id.slice(-4)}`,
          source: survivor.id,
          target: candidate.id,
          relation: 'COMPACTED_DUPLICATE',
          weight: sim,
        });
      }
    }
  }

  const prunedIds = new Set<string>();
  const keptMemories: MemoryItem[] = [];

  for (const mem of cloned) {
    if (!mem.pinned && !mem.supersededBy && !mem.validUntil && mem.tier === 'WORKING') {
      const refIso = mem.lastAccessedAt || mem.updatedAt || mem.createdAt;
      const refMs = refIso ? Date.parse(refIso) : nowMs;
      const ageDays = Number.isFinite(refMs) ? (nowMs - refMs) / 86_400_000 : 0;
      if (ageDays > workingMaxAgeDays) {
        prunedIds.add(mem.id);
        workingPruned += 1;
        continue;
      }
    }

    if (!mem.pinned && !mem.supersededBy && !mem.validUntil && mem.tier === 'EPISODIC') {
      const { retentionScore } = computeEbbinghausRetention(mem, nowMs);
      const currentImp = mem.importance ?? 3;
      if (retentionScore < 0.2 && currentImp > 1) {
        mem.importance = currentImp - 1;
        importanceDecayed += 1;
      }
    }

    keptMemories.push(mem);
  }

  const filteredEdges = nextEdges.filter(
    (e) => !prunedIds.has(e.source) && !prunedIds.has(e.target)
  );

  return {
    memories: keptMemories,
    edges: filteredEdges,
    duplicatesSuperseded,
    workingPruned,
    importanceDecayed,
  };
}
