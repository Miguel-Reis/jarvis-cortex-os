/**
 * Deterministic Cortex Math & Mark-VII WAV Synthesizer (Zero-Dependency ESM)
 * Shared by server.mjs fallback gateway and tests/cortex_math.test.mjs.
 */

/**
 * Protocol Q-18 Deterministic Next-Action Priority Formula:
 * Score = (Impact * Urgency * Authority) / ((Effort + 0.1) * (1.0 + 0.2 * Risk))
 */
export function calculateQ18Score(candidate, authorityMultiplier = 1.0) {
  const impact = Number(candidate?.impact ?? 1.0);
  const urgency = Number(candidate?.urgency ?? 1.0);
  const effort = Math.max(0.1, Number(candidate?.effort ?? 1.0));
  const risk = Math.max(0.0, Number(candidate?.risk ?? 0.0));
  const auth = Number(candidate?.authorityWeight ?? authorityMultiplier ?? 1.0);
  const numerator = impact * urgency * auth;
  const denominator = (effort + 0.1) * (1.0 + 0.2 * risk);
  return Number((numerator / denominator).toFixed(4));
}

/**
 * HippoRAG 2 Personalized PageRank (PPR) Associative Diffusion.
 * Supports string node names or { name / id } node objects.
 */
export function runHippoRagPpr(nodes, edges, seedNode, alpha = 0.85, iterations = 30) {
  const nodeNames = (nodes || []).map((n) => (typeof n === 'string' ? n : String(n.name ?? n.id)));
  const count = nodeNames.length;
  if (count === 0) return [];

  const idxByName = new Map(nodeNames.map((name, i) => [name, i]));
  const seedIdx = idxByName.has(seedNode) ? idxByName.get(seedNode) : 0;

  // Build weighted undirected/associative adjacency list
  const adj = Array.from({ length: count }, () => []);
  for (const edge of edges || []) {
    const u = idxByName.get(String(edge.source));
    const v = idxByName.get(String(edge.target));
    const w = Math.max(0.01, Number(edge.weight ?? 1.0));
    if (u !== undefined && v !== undefined) {
      adj[u].push({ to: v, weight: w });
      adj[v].push({ to: u, weight: w });
    }
  }

  let ranks = new Float64Array(count);
  ranks[seedIdx] = 1.0;

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Float64Array(count);
    next[seedIdx] += 1.0 - alpha;

    for (let u = 0; u < count; u++) {
      const mass = ranks[u];
      if (mass <= 0) continue;
      const neighbors = adj[u];
      if (neighbors.length === 0) {
        next[seedIdx] += alpha * mass;
      } else {
        const totalW = neighbors.reduce((acc, item) => acc + item.weight, 0);
        for (const nb of neighbors) {
          next[nb.to] += alpha * mass * (nb.weight / totalW);
        }
      }
    }
    ranks = next;
  }

  const totalMass = ranks.reduce((acc, v) => acc + v, 0) || 1.0;
  return nodeNames
    .map((node, i) => ({
      node,
      score: Number((ranks[i] / totalMass).toFixed(6)),
    }))
    .sort((a, b) => b.score - a.score);
}

const INJECTION_RULES = [
  { name: 'IGNORE_INSTRUCTIONS', re: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i },
  { name: 'BYPASS_SECURITY', re: /bypass\s+(all\s+)?(security|safety|trust|guard|rules)/i },
  { name: 'SYSTEM_OVERRIDE', re: /\b(system\s+prompt|developer\s+mode|jailbreak|sudo\s+rm\s+-rf)\b/i },
  { name: 'EXFILTRATE_ENV', re: /\b(cat\s+\.env|GEMINI_API_KEY|OPENAI_API_KEY|reveal\s+canary)\b/i },
];

/**
 * TrustBoundaryGate Prompt-Injection & Canary Leak Inspector.
 */
export function inspectTrustBoundary(text, activeCanary = '') {
  const input = String(text ?? '');
  const findings = [];

  for (const rule of INJECTION_RULES) {
    if (rule.re.test(input)) {
      findings.push(`RULE_${rule.name}`);
    }
  }

  if (activeCanary && input.includes(activeCanary)) {
    findings.push(`CANARY_LEAK:${activeCanary}`);
  }

  return {
    safe: findings.length === 0,
    findings,
  };
}

/**
 * Skywalker Sound Mark-VII Helmet Acoustic Chime Synthesizer (16kHz 16-bit Mono PCM RIFF WAVE).
 */
export function synthesizeMarkViiWav(preset = 'MARK_VII_HELMET') {
  const sampleRate = 16000;
  const durationSec = 0.46;
  const numSamples = Math.floor(sampleRate * durationSec);
  const floatSamples = new Float32Array(numSamples);
  const combDelay = Math.floor(0.0185 * sampleRate); // 18.5ms titanium faceplate comb filter
  const baseFreq = preset === 'WAR_ROOM_ALERT' ? 220 : 165;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t * 28) * Math.exp(-t * 3.4);
    let sig =
      0.46 * Math.sin(2 * Math.PI * baseFreq * t) +
      0.28 * Math.sin(2 * Math.PI * baseFreq * 2 * t) +
      0.14 * Math.sin(2 * Math.PI * baseFreq * 3 * t);
    if (i >= combDelay) {
      sig += 0.38 * floatSamples[i - combDelay];
    }
    floatSamples[i] = Math.tanh(sig * env * 1.3);
  }

  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // Mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, floatSamples[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  return buf;
}
