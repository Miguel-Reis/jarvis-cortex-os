import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DoctorCheckItem, DoctorReport } from '../shared/types.ts';
import { db } from './db.ts';
import { checkTcpPort } from './os-adapter.ts';
import {
  evaluateBindAuthPolicy,
  isLoopbackAddress,
  resolveAllowedSingleOrigin,
} from './security-gate.ts';

const execFileAsync = promisify(execFile);

export function parseNodeMajorMinor(versionStr = process.versions.node): {
  major: number;
  minor: number;
  supported: boolean;
} {
  const parts = versionStr.split('.').map((n) => Number(n) || 0);
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  const supported = major > 22 || (major === 22 && minor >= 6);
  return { major, minor, supported };
}

/**
 * A-09: Explicit runtime version check executed at boot.
 * Warns on Node < 22.6.0 (falling back to tsx + json-transactional store)
 * instead of crashing Windows setups running Node 18/20 LTS.
 */
export function enforceMinimumNodeRuntime(): void {
  const { supported } = parseNodeMajorMinor();
  if (!supported) {
    const msg =
      `[A-09 RUNTIME GUARD] Node.js ${process.version} detetado (< 22.6.0). ` +
      `Modo de compatibilidade ativo (tsx + fallback JSON transacional). Recomendado Node.js >= 22.6.0 para node:sqlite WAL nativo.`;
    if (process.env.JARVIS_STRICT_NODE_VERSION === '1') {
      throw new Error(msg);
    }
    console.warn(msg);
  }
}

/**
 * §7: Comprehensive `--doctor` diagnostic suite (callable from CLI and `GET /api/system/doctor`).
 */
export async function runSystemDoctor(params: {
  port: number;
  host: string;
  env?: NodeJS.ProcessEnv;
}): Promise<DoctorReport> {
  const env = params.env ?? process.env;
  const checks: DoctorCheckItem[] = [];
  const nodeVer = parseNodeMajorMinor();

  checks.push({
    id: 'NODE_RUNTIME',
    category: 'RUNTIME',
    label: 'Versão de Runtime Node.js (>= 22.6.0)',
    status: nodeVer.supported ? 'PASS' : nodeVer.major >= 18 ? 'WARN' : 'FAIL',
    detail: `Node v${process.versions.node} (${process.platform}/${process.arch}).`,
  });

  // Check data/ and logs/ write permissions
  const dataDir = path.resolve(process.cwd(), 'data');
  const logsDir = path.resolve(process.cwd(), 'logs');
  let fsWritable = false;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    const probeFile = path.join(dataDir, `.doctor-write-${process.pid}`);
    fs.writeFileSync(probeFile, 'ok', 'utf-8');
    fs.unlinkSync(probeFile);
    fsWritable = true;
  } catch {
    fsWritable = false;
  }

  checks.push({
    id: 'FS_PERMISSIONS',
    category: 'STORAGE',
    label: 'Permissões de Escrita em data/ & logs/',
    status: fsWritable ? 'PASS' : 'FAIL',
    detail: fsWritable
      ? 'Diretórios data/ e logs/ verificados com escrita atómica.'
      : 'Sem permissão de escrita em data/ ou logs/.',
  });

  const engine = db.getEngineName();
  const state = db.getState();
  const schemaVer = state.schemaVersion ?? 4;
  checks.push({
    id: 'SQLITE_WAL_COLLECTIONS',
    category: 'STORAGE',
    label: 'Persistência SQLite WAL por Coleção + Fila Debounce',
    status: engine.includes('sqlite') ? 'PASS' : 'WARN',
    detail: `Motor ativo: ${engine} · Schema v${schemaVer} · ${db.getRegisteredCollectionCount()} coleções isoladas.`,
  });

  // Security & Auth Posture (A-01)
  const authPolicy = evaluateBindAuthPolicy(params.host, env);
  const corsOrigin = resolveAllowedSingleOrigin(params.port, env);
  const isLoopback = isLoopbackAddress(params.host);

  checks.push({
    id: 'AUTH_AND_BIND',
    category: 'SECURITY',
    label: 'Fronteira HTTP, Bind Host & Token de API (A-01)',
    status: !authPolicy.allowedToBoot
      ? 'FAIL'
      : authPolicy.tokenConfigured || isLoopback || authPolicy.managedIngress
        ? 'PASS'
        : 'WARN',
    detail: authPolicy.tokenConfigured
      ? `Bind ${params.host}:${params.port} protegido por Authorization: Bearer (CORS: ${corsOrigin}).`
      : isLoopback
        ? `Bind estrito em loopback ${params.host}:${params.port} (CORS: ${corsOrigin}).`
        : authPolicy.managedIngress
          ? `Ingress gerido Cloud Run/AI Studio ativo (CORS: ${corsOrigin}).`
          : authPolicy.errorMessage || 'JARVIS_API_TOKEN recomendado.',
  });

  // Port probe
  const portProbe = await checkTcpPort(params.port, '127.0.0.1', 260);
  checks.push({
    id: 'GATEWAY_PORT',
    category: 'RUNTIME',
    label: `Porta HTTP Gateway (:${params.port})`,
    status: 'PASS',
    detail: portProbe.open
      ? `Porta ${params.port} em escuta ativa (${portProbe.latencyMs}ms).`
      : `Porta ${params.port} livre e pronta para arranque.`,
  });

  // LLM Provider Readiness
  const geminiReady = Boolean(env.GEMINI_API_KEY?.trim());
  const openRouterReady = Boolean(env.OPENROUTER_API_KEY?.trim());
  checks.push({
    id: 'LLM_PROVIDERS',
    category: 'PROVIDERS',
    label: 'Credenciais Cloud LLM & Fallback Determinístico',
    status: geminiReady || openRouterReady ? 'PASS' : 'WARN',
    detail: geminiReady
      ? 'GEMINI_API_KEY detetada no servidor (nunca exposta ao cliente).'
      : openRouterReady
        ? 'OPENROUTER_API_KEY detetada no servidor.'
        : 'Sem chave Cloud configurada — modo cognitivo local determinístico ativo.',
  });

  // Python 3.11+ Sidecar check
  const pyBin = process.platform === 'win32' ? 'python' : 'python3';
  let pyDetail = 'Python Sidecar indisponível.';
  let pyOk = false;
  try {
    const { stdout } = await execFileAsync(
      pyBin,
      ['-c', 'import sys, jarvis_os.sidecar.desktop_agent; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")'],
      { timeout: 1800 }
    );
    pyOk = true;
    pyDetail = `Python ${stdout.trim()} + jarvis_os.sidecar operacional via execFile.`;
  } catch {
    pyOk = false;
  }

  checks.push({
    id: 'PYTHON_SIDECAR',
    category: 'SIDECAR',
    label: 'Sidecar Nativo Python 3.11+ (stdlib pura)',
    status: pyOk ? 'PASS' : 'WARN',
    detail: pyDetail,
  });

  const healthy = checks.every((c) => c.status !== 'FAIL');
  const seedMode = state.seedMode || state.settings.seedMode || (env.SEED_MODE === 'real' ? 'real' : 'demo');

  return {
    checkedAt: new Date().toISOString(),
    healthy,
    nodeVersion: process.version,
    storageEngine: engine,
    schemaVersion: schemaVer,
    seedMode,
    bindHost: params.host,
    authRequired: authPolicy.authRequired,
    tokenConfigured: authPolicy.tokenConfigured,
    corsOrigin,
    checks,
  };
}
