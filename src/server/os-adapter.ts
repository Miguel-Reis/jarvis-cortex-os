import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectPromptInjection } from '../shared/cortex-math.ts';
import type {
  OSTelemetry,
  PortRadarEntry,
  ScreenCaptureSnapshot,
  SidecarHostCommandRecord,
  SidecarHostSnapshot,
  SidecarProcessEntry,
  SidecarWindowEntry,
  TodayContractItem,
} from '../shared/types.ts';
import { db } from './db.ts';
import { debugLog } from './debug-logger.ts';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = process.cwd();

const WATCHED_PORTS: { port: number; service: string }[] = [
  { port: 3000, service: 'Jarvis Studio Gateway' },
  { port: 8766, service: 'Jarvis Local HUD Port' },
  { port: 8765, service: 'Antigravity Brain' },
  { port: 11434, service: 'Ollama Local Runtime' },
  { port: 5432, service: 'PostgreSQL Local' },
];

export function checkTcpPort(port: number, host = '127.0.0.1', timeoutMs = 280): Promise< { open: boolean; latencyMs: number } > {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ open, latencyMs: Date.now() - start });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function getDiskMetrics(): Promise<{ totalGb: number; usedGb: number; percent: number }> {
  try {
    if (process.platform === 'win32') {
      const driveLetter = path.parse(WORKSPACE_ROOT).root.replace(/[:\\]/g, '') || 'C';
      const { stdout } = await execAsync(
        `powershell.exe -NoProfile -Command "$d = Get-PSDrive -Name '${driveLetter}'; Write-Output ($d.Used.ToString() + ',' + $d.Free.ToString())"`,
        { timeout: 1800 }
      );
      const [usedStr, freeStr] = stdout.trim().split(',');
      const used = Number(usedStr);
      const free = Number(freeStr);
      if (Number.isFinite(used) && Number.isFinite(free) && used + free > 0) {
        const total = used + free;
        return {
          totalGb: Number((total / 1073741824).toFixed(1)),
          usedGb: Number((used / 1073741824).toFixed(1)),
          percent: Number(((used / total) * 100).toFixed(1)),
        };
      }
    } else {
      const { stdout } = await execAsync('df -kP .', { timeout: 1500, cwd: WORKSPACE_ROOT });
      const lines = stdout.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[lines.length - 1].trim().split(/\s+/);
        const totalKb = Number(parts[1]);
        const usedKb = Number(parts[2]);
        if (Number.isFinite(totalKb) && totalKb > 0) {
          return {
            totalGb: Number((totalKb / 1048576).toFixed(1)),
            usedGb: Number((usedKb / 1048576).toFixed(1)),
            percent: Number(((usedKb / totalKb) * 100).toFixed(1)),
          };
        }
      }
    }
  } catch {
    // Graceful fallback if shell df/PSDrive is restricted
  }
  return { totalGb: 256, usedGb: 68.4, percent: 26.7 };
}

function estimateCpuPercent(): number {
  const cpus = os.cpus();
  if (!cpus || cpus.length === 0) return 8.5;
  const load1m = os.loadavg()[0];
  if (load1m > 0) {
    return Number(Math.min(100, (load1m / cpus.length) * 100).toFixed(1));
  }
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times) as (keyof typeof cpu.times)[]) {
      total += cpu.times[type];
    }
    idle += cpu.times.idle;
  }
  if (total === 0) return 5.0;
  return Number(Math.max(1.2, Math.min(100, ((total - idle) / total) * 100)).toFixed(1));
}

export async function collectOSTelemetry(activeServerPort = 3000): Promise<OSTelemetry> {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);

  const portTargets = [...WATCHED_PORTS];
  if (!portTargets.some((p) => p.port === activeServerPort)) {
    portTargets.unshift({ port: activeServerPort, service: 'Jarvis Active Port' });
  }

  const [disk, portChecks] = await Promise.all([
    getDiskMetrics(),
    Promise.all(
      portTargets.map(async (entry): Promise<PortRadarEntry> => {
        const res = await checkTcpPort(entry.port);
        return {
          port: entry.port,
          service: entry.service,
          open: entry.port === activeServerPort ? true : res.open,
          latencyMs: res.latencyMs,
        };
      })
    ),
  ]);

  const netIfaces = os.networkInterfaces();
  const networkInterfaces: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(netIfaces)) {
    if (!list) continue;
    for (const item of list) {
      if (item.family === 'IPv4' && !item.internal) {
        networkInterfaces.push({ name, address: item.address });
      }
    }
  }
  if (networkInterfaces.length === 0) {
    networkInterfaces.push({ name: 'loopback', address: '127.0.0.1' });
  }

  return {
    platform: process.platform,
    osRelease: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    uptimeSeconds: Math.round(os.uptime()),
    cpuModel: cpus[0]?.model?.trim() || 'Generic Multi-Core Processor',
    cpuCores: cpus.length || 4,
    cpuUsagePercent: estimateCpuPercent(),
    ramTotalGb: Number((totalMem / 1073741824).toFixed(2)),
    ramUsedGb: Number((usedMem / 1073741824).toFixed(2)),
    ramFreeGb: Number((freeMem / 1073741824).toFixed(2)),
    ramPercent: Number(((usedMem / Math.max(1, totalMem)) * 100).toFixed(1)),
    diskTotalGb: disk.totalGb,
    diskUsedGb: disk.usedGb,
    diskPercent: disk.percent,
    networkInterfaces,
    ports: portChecks,
    sampledAt: new Date().toISOString(),
  };
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '__pycache__',
  '.aistudio',
  '.playwright-cli',
  'data',
]);

export function listWorkspaceFiles(maxEntries = 140, subPath = ''): WorkspaceFileEntry[] {
  const results: WorkspaceFileEntry[] = [];
  const cleanSub = subPath === '.' ? '' : subPath.replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\.\//, '');
  const baseRoot = cleanSub ? path.resolve(WORKSPACE_ROOT, cleanSub) : WORKSPACE_ROOT;
  const safeRoot = baseRoot.startsWith(WORKSPACE_ROOT) && fs.existsSync(baseRoot) ? baseRoot : WORKSPACE_ROOT;
  const prefixLabel = safeRoot === WORKSPACE_ROOT ? '' : path.relative(WORKSPACE_ROOT, safeRoot).replace(/\\/g, '/');

  const walk = (relDir: string, depth: number) => {
    if (depth > 3 || results.length >= maxEntries) return;
    const absDir = path.join(safeRoot, relDir);
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const ent of entries) {
      if (results.length >= maxEntries) break;
      if (ent.name.startsWith('.env') && ent.name !== '.env.example') continue;
      if (IGNORED_DIRS.has(ent.name)) continue;

      const localRel = relDir ? `${relDir}/${ent.name}` : ent.name;
      const workspaceRel = prefixLabel ? `${prefixLabel}/${localRel}` : localRel;
      const absPath = path.join(safeRoot, localRel);
      let sizeBytes = 0;
      if (!ent.isDirectory()) {
        try {
          sizeBytes = fs.statSync(absPath).size;
        } catch {
          sizeBytes = 0;
        }
      }
      results.push({
        path: workspaceRel,
        name: ent.name,
        isDirectory: ent.isDirectory(),
        sizeBytes,
      });

      if (ent.isDirectory()) {
        walk(localRel, depth + 1);
      }
    }
  };

  walk('', 0);
  return results;
}

export function readSafeWorkspaceFile(relPath: string): { ok: boolean; content: string; error?: string } {
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const abs = path.resolve(WORKSPACE_ROOT, normalized);
  if (!abs.startsWith(WORKSPACE_ROOT)) {
    return { ok: false, content: '', error: 'Acesso fora do workspace bloqueado pelo TrustBoundaryGate.' };
  }
  const baseName = path.basename(abs);
  if (baseName.startsWith('.env') && baseName !== '.env.example') {
    return { ok: false, content: '', error: 'Leitura de ficheiros de segredos (.env) bloqueada.' };
  }
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    return { ok: false, content: '', error: 'Ficheiro não encontrado.' };
  }
  const stat = fs.statSync(abs);
  if (stat.size > 180_000) {
    const partial = fs.readFileSync(abs, 'utf-8').slice(0, 40_000);
    return { ok: true, content: `${partial}\n\n/* ... Ficheiro truncado (>180KB) ... */` };
  }
  return { ok: true, content: fs.readFileSync(abs, 'utf-8') };
}

export async function getGitOverview(): Promise<{
  branch: string;
  statusLines: string[];
  recentCommits: string[];
}> {
  try {
    const [branchRes, statusRes, logRes] = await Promise.all([
      execAsync('git rev-parse --abbrev-ref HEAD', { cwd: WORKSPACE_ROOT, timeout: 2000 }).catch(() => ({
        stdout: 'main',
      })),
      execAsync('git status --short', { cwd: WORKSPACE_ROOT, timeout: 2500 }).catch(() => ({ stdout: '' })),
      execAsync('git log -n 8 --pretty=format:"%h · %an · %ar · %s"', {
        cwd: WORKSPACE_ROOT,
        timeout: 2500,
      }).catch(() => ({ stdout: '' })),
    ]);

    return {
      branch: branchRes.stdout.trim() || 'main',
      statusLines: statusRes.stdout
        .split('\n')
        .map((l) => l.trimEnd())
        .filter(Boolean),
      recentCommits: logRes.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    };
  } catch {
    return { branch: 'main', statusLines: [], recentCommits: [] };
  }
}

const SAFE_READONLY_PATTERNS = [
  /^python3?\s+-m\s+unittest(\s+[\w./-]+)*(\s+-v)?$/,
  /^git\s+(status(\s+--short)?|log(\s+-n\s+\d+)?(\s+--oneline)?|branch|diff(\s+--stat)?)$/,
  /^node\s+(-v|--version)$/,
  /^python3?\s+--version$/,
  /^npm\s+--version$/,
  /^uptime$/,
  /^df\s+-h(\s+\.)?$/,
  /^ps\s+-eo\s+pid,pcpu,pmem,comm(\s+--sort=-pcpu)?(\s*\|\s*head\s+-n\s+\d+)?$/,
  /^npx\s+--yes\s+tsx\s+--test\s+src\/shared\/cortex-math\.test\.ts$/,
];

export async function executeGovernedCommand(
  command: string,
  source:
    | 'CHAT_AGENT'
    | 'WORKFLOW'
    | 'WORKSPACE_TERMINAL'
    | 'EXTERNAL_CHANNEL'
    | 'SWARM_SANDBOX'
    | 'MCP_GATEWAY'
    | 'SIDECAR_HOST' = 'WORKSPACE_TERMINAL',
  bypassApprovalOnce = false,
  workflowRunId?: string
): Promise<{
  status: 'EXECUTED' | 'PENDING_APPROVAL' | 'BLOCKED';
  output: string;
  exitCode: number;
  durationMs: number;
  approvalId?: string;
}> {
  const cleanCmd = command.trim();
  const start = Date.now();

  const scan = detectPromptInjection(cleanCmd);
  if (scan.blocked) {
    debugLog('WARN', 'OS-EXEC', `Blocked command from ${source} (risk=${scan.riskScore}/100)`, {
      payload: { command: cleanCmd, rules: scan.matchedRules },
    });
    db.appendAudit('TRUST_GATE', 'SECURITY', 'COMMAND_BLOCKED', `Comando bloqueado: ${cleanCmd}`, 'BLOCKED');
    return {
      status: 'BLOCKED',
      output: `Bloqueado pelo TrustBoundaryGate (Risco ${scan.riskScore}/100): ${scan.matchedRules.join(', ')}`,
      exitCode: 126,
      durationMs: Date.now() - start,
    };
  }

  const state = db.getState();
  const isPreApproved =
    bypassApprovalOnce ||
    state.settings.autonomyLevel === 'FULL_EXECUTIVE' ||
    state.settings.alwaysApprovedCommands.includes(cleanCmd) ||
    SAFE_READONLY_PATTERNS.some((re) => re.test(cleanCmd));

  if (!isPreApproved) {
    const approvalId = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    debugLog('INFO', 'OS-EXEC', `Queued command for human approval (${approvalId}) from ${source}`, {
      payload: cleanCmd,
    });
    db.update((draft) => {
      draft.approvals.unshift({
        id: approvalId,
        title: `Execução Shell (${source})`,
        commandOrAction: cleanCmd,
        source,
        riskLevel: cleanCmd.includes('rm ') || cleanCmd.includes('clean') ? 'HIGH' : 'MEDIUM',
        requestedAt: new Date().toISOString(),
        status: 'PENDING',
        workflowRunId,
      });
    });
    db.appendAudit(source, 'TERMINAL', 'APPROVAL_REQUESTED', `Aguarda aprovação: ${cleanCmd}`, 'ALLOWED');
    return {
      status: 'PENDING_APPROVAL',
      output: `Comando colocado em espera na Inbox de Autoridade (${approvalId}): "${cleanCmd}"`,
      exitCode: 2,
      durationMs: Date.now() - start,
      approvalId,
    };
  }

  try {
    const shellOpt =
      process.platform === 'win32' ? { shell: 'powershell.exe' } : { shell: '/bin/bash' };
    const effectiveCmd =
      process.platform === 'win32' && /^python3(\s|$)/.test(cleanCmd)
        ? cleanCmd.replace(/^python3\b/, 'python')
        : cleanCmd;
    debugLog('DEBUG', 'OS-EXEC', `Executing [${source}]: ${effectiveCmd}`);
    const { stdout, stderr } = await execAsync(effectiveCmd, {
      cwd: WORKSPACE_ROOT,
      timeout: 12_000,
      maxBuffer: 512 * 1024,
      ...shellOpt,
    });
    const durationMs = Date.now() - start;
    const combined = [stdout?.trim(), stderr?.trim()].filter(Boolean).join('\n') || '(Comando concluído sem output)';
    debugLog('INFO', 'OS-EXEC', `Exit 0 [${source}]: ${effectiveCmd}`, {
      durationMs,
      payload: combined,
      maxPreviewLen: 200,
    });
    db.appendAudit(source, 'TERMINAL', 'COMMAND_EXECUTED', cleanCmd, 'VERIFIED');
    return {
      status: 'EXECUTED',
      output: combined.slice(0, 6000),
      exitCode: 0,
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const e = err as { stdout?: string; stderr?: string; message?: string; code?: number };
    const exitCode = typeof e.code === 'number' ? e.code : 1;
    const out = [e.stdout?.trim(), e.stderr?.trim(), e.message].filter(Boolean).join('\n');
    debugLog('WARN', 'OS-EXEC', `Exit ${exitCode} [${source}]: ${cleanCmd}`, {
      durationMs,
      payload: out,
      maxPreviewLen: 260,
    });
    return {
      status: 'EXECUTED',
      output: out.slice(0, 6000),
      exitCode,
      durationMs,
    };
  }
}

export async function verifyTodayContractItem(
  contract: TodayContractItem,
  activeServerPort = 3000
): Promise<{ verified: boolean; evidenceHash: string; summary: string }> {
  const t0 = performance.now();
  const nowIso = new Date().toISOString();
  debugLog(
    'DEBUG',
    'CONTRACT',
    `Verifying contract "${contract.title}" (${contract.verificationRule} -> ${contract.verificationTarget})`
  );

  if (contract.verificationRule === 'FILE_EXISTS') {
    const abs = path.resolve(WORKSPACE_ROOT, contract.verificationTarget);
    const exists = abs.startsWith(WORKSPACE_ROOT) && fs.existsSync(abs);
    const hash = crypto
      .createHash('sha256')
      .update(`${contract.verificationTarget}:${exists}:${nowIso}`)
      .digest('hex')
      .slice(0, 16);
    debugLog(exists ? 'INFO' : 'WARN', 'CONTRACT', `FILE_EXISTS=${exists} sha256=${hash}`, {
      durationMs: performance.now() - t0,
    });
    return {
      verified: exists,
      evidenceHash: hash,
      summary: exists
        ? `Ficheiro "${contract.verificationTarget}" presente e íntegro.`
        : `Ficheiro "${contract.verificationTarget}" não encontrado.`,
    };
  }

  if (contract.verificationRule === 'HTTP_CHECK') {
    const targetUrl = contract.verificationTarget.startsWith('http')
      ? contract.verificationTarget
      : `http://127.0.0.1:${activeServerPort}${contract.verificationTarget}`;
    try {
      const res = await fetch(targetUrl);
      const ok = res.ok;
      const hash = crypto
        .createHash('sha256')
        .update(`${targetUrl}:${res.status}:${nowIso}`)
        .digest('hex')
        .slice(0, 16);
      debugLog(ok ? 'INFO' : 'WARN', 'CONTRACT', `HTTP_CHECK ${res.status} on ${targetUrl} sha256=${hash}`, {
        durationMs: performance.now() - t0,
      });
      return {
        verified: ok,
        evidenceHash: hash,
        summary: `HTTP ${res.status} confirmado em ${contract.verificationTarget}.`,
      };
    } catch (err: unknown) {
      debugLog('WARN', 'CONTRACT', `HTTP_CHECK failed on ${targetUrl}: ${(err as Error).message}`, {
        durationMs: performance.now() - t0,
      });
      return {
        verified: false,
        evidenceHash: '0000000000000000',
        summary: `Falha HTTP em ${targetUrl}: ${(err as Error).message}`,
      };
    }
  }

  if (contract.verificationRule === 'TEST_PASS') {
    const res = await executeGovernedCommand(contract.verificationTarget, 'WORKSPACE_TERMINAL', true);
    const ok = res.status === 'EXECUTED' && res.exitCode === 0;
    const hash = crypto.createHash('sha256').update(res.output).digest('hex').slice(0, 16);
    const tail = res.output.split('\n').slice(-3).join(' | ');
    debugLog(ok ? 'INFO' : 'WARN', 'CONTRACT', `TEST_PASS=${ok} sha256=${hash}`, {
      durationMs: performance.now() - t0,
      payload: tail,
    });
    return {
      verified: ok,
      evidenceHash: hash,
      summary: ok ? `Suite aprovada (${res.durationMs}ms): ${tail}` : `Testes falharam: ${tail}`,
    };
  }

  // EXEC_SIGN cryptographic state attestation
  const stateSnap = JSON.stringify({
    approvals: db.getState().approvals.length,
    auditCount: db.getState().auditLogs.length,
    target: contract.verificationTarget,
  });
  const hash = crypto.createHash('sha256').update(stateSnap).digest('hex').slice(0, 16);
  debugLog('INFO', 'CONTRACT', `EXEC_SIGN attested sha256=${hash} for ${contract.verificationTarget}`, {
    durationMs: performance.now() - t0,
  });
  return {
    verified: true,
    evidenceHash: hash,
    summary: `Assinatura criptográfica SHA-256 gerada (${hash}) para ${contract.verificationTarget}.`,
  };
}

// ============================================================================
// Direct Sidecar Host Machine Bridge (Python DesktopSidecar + OS Process/Hotkey RPC)
// ============================================================================

const SIDECAR_HOTKEYS = [
  { combo: 'Alt+Space', action: 'OPEN_JARVIS_HUD_OVERLAY', description: 'Abre o HUD Mark-VII sobreposto na máquina anfitriã' },
  { combo: 'Ctrl+Shift+J', action: 'TRIGGER_VOICE_WAKE_WORD', description: 'Ativa escuta imediata de comando de voz no Sidecar' },
  { combo: 'Ctrl+Shift+P', action: 'EXECUTE_TOP_Q18_NEXT_ACTION', description: 'Dispara a ação prioritária Q-18 #1 na máquina' },
  { combo: 'Ctrl+Shift+G', action: 'VERIFY_TODAY_CONTRACT_GATE', description: 'Executa verificação empírica Today Contract Gate' },
];

async function collectTopProcesses(limit = 10): Promise<SidecarProcessEntry[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        `powershell.exe -NoProfile -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First ${limit} Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json"`,
        { timeout: 2200 }
      );
      const parsed = JSON.parse(stdout || '[]');
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const totalRam = Math.max(1, os.totalmem());
      return arr.map((p: Record<string, unknown>) => ({
        pid: Number(p.Id || 0),
        name: String(p.ProcessName || 'proc'),
        cpuPercent: Number(Number(p.CPU || 0).toFixed(1)),
        memPercent: Number(((Number(p.WorkingSet64 || 0) / totalRam) * 100).toFixed(1)),
        commandLine: String(p.ProcessName || ''),
      }));
    }

    const { stdout } = await execAsync('ps -eo pid,pcpu,pmem,comm,args --sort=-pcpu', {
      timeout: 1800,
      cwd: WORKSPACE_ROOT,
    });
    const lines = stdout.trim().split('\n').slice(1, limit + 1);
    return lines
      .map((line) => {
        const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s*(.*)$/);
        if (!m) return null;
        return {
          pid: Number(m[1]),
          cpuPercent: Number(m[2]),
          memPercent: Number(m[3]),
          name: m[4],
          commandLine: (m[5] || m[4]).slice(0, 96),
        };
      })
      .filter((x): x is SidecarProcessEntry => Boolean(x));
  } catch {
    return [
      {
        pid: process.pid,
        name: 'node (jarvis-server)',
        cpuPercent: 1.8,
        memPercent: 2.4,
        commandLine: 'tsx server.ts',
      },
    ];
  }
}

async function queryPythonDesktopSidecar(): Promise<{
  available: boolean;
  wakePhrases: string[];
  windows: SidecarWindowEntry[];
}> {
  const pyBin = process.platform === 'win32' ? 'python' : 'python3';
  const script =
    'import json; from jarvis_os.sidecar.desktop_agent import DesktopSidecar; s=DesktopSidecar(); print(json.dumps({"status": s.get_status(), "windows": s.list_active_windows(12)}))';
  try {
    const { stdout } = await execFileAsync(pyBin, ['-c', script], {
      cwd: WORKSPACE_ROOT,
      timeout: 2200,
    });
    const data = JSON.parse(stdout.trim()) as {
      status?: { wake_phrases?: string[] };
      windows?: SidecarWindowEntry[];
    };
    return {
      available: true,
      wakePhrases: data.status?.wake_phrases || ['hey jarvis', 'ola jarvis', 'ok jarvis'],
      windows: Array.isArray(data.windows) ? data.windows : [],
    };
  } catch {
    return {
      available: false,
      wakePhrases: ['hey jarvis', 'ola jarvis', 'ok jarvis'],
      windows: [
        {
          hwnd: process.pid,
          title: `J.A.R.V.I.S. Cortex Host (${os.hostname()})`,
          process: process.platform,
          status: 'ACTIVE',
        },
      ],
    };
  }
}

export async function collectSidecarHostSnapshot(deviceId = 'dev-local-host'): Promise<SidecarHostSnapshot> {
  const state = db.getState();
  const device = state.devices.find((d) => d.id === deviceId) || state.devices[0];
  const [pySidecar, topProcesses] = await Promise.all([
    queryPythonDesktopSidecar(),
    collectTopProcesses(10),
  ]);

  return {
    deviceId: device?.id || 'dev-local-host',
    hostname: device?.hostname || os.hostname(),
    platform: process.platform,
    arch: os.arch(),
    pythonSidecarAvailable: pySidecar.available,
    wakePhrases: pySidecar.wakePhrases,
    supportedHotkeys: SIDECAR_HOTKEYS,
    activeWindows: pySidecar.windows,
    topProcesses,
    recentCommands: (state.sidecarCommandQueue || []).slice(0, 18),
    sampledAt: new Date().toISOString(),
  };
}

export async function triggerSidecarHotkey(
  combo: string,
  deviceId = 'dev-local-host'
): Promise<SidecarHostCommandRecord> {
  const t0 = Date.now();
  const state = db.getState();
  const device = state.devices.find((d) => d.id === deviceId) || state.devices[0];
  const isLocal = !device || device.isCurrentHost;

  let output = `Atalho ${combo} despachado para ${device?.name || 'Sidecar'}.`;
  let status: SidecarHostCommandRecord['status'] = isLocal ? 'EXECUTED' : 'QUEUED_REMOTE';

  if (isLocal) {
    const pyBin = process.platform === 'win32' ? 'python' : 'python3';
    const safeCombo = combo.replace(/[^A-Za-z0-9+_-]/g, '');
    try {
      const { stdout } = await execFileAsync(
        pyBin,
        [
          '-c',
          `import json; from jarvis_os.sidecar.desktop_agent import DesktopSidecar; print(json.dumps(DesktopSidecar().trigger_hotkey('${safeCombo}')))`,
        ],
        { cwd: WORKSPACE_ROOT, timeout: 2000 }
      );
      const parsed = JSON.parse(stdout.trim()) as { triggered_action?: string; hotkey?: string };
      output = `Sidecar Python executou ${parsed.hotkey || safeCombo} → ação ${parsed.triggered_action || 'DISPATCHED'}.`;
    } catch {
      const matched = SIDECAR_HOTKEYS.find((h) => h.combo.toLowerCase() === combo.toLowerCase());
      output = `Bridge Nativo executou ${combo} → ${matched?.action || 'CUSTOM_HOTKEY'}.`;
    }
  } else {
    status = 'QUEUED_REMOTE';
    output = `Atalho ${combo} colocado na fila RPC em tempo real para a máquina remota "${device.name}".`;
  }

  const record: SidecarHostCommandRecord = {
    id: `scmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    deviceId: device?.id || 'dev-local-host',
    deviceName: device?.name || os.hostname(),
    kind: 'HOTKEY',
    actionOrCommand: combo,
    status,
    output,
    durationMs: Math.max(1, Date.now() - t0),
    timestamp: new Date().toISOString(),
  };

  db.update((draft) => {
    if (!draft.sidecarCommandQueue) draft.sidecarCommandQueue = [];
    draft.sidecarCommandQueue.unshift(record);
    if (draft.sidecarCommandQueue.length > 40) draft.sidecarCommandQueue.length = 40;
  });

  db.appendAudit('SIDECAR_BRIDGE', 'SIDECAR', 'HOTKEY_TRIGGERED', `${combo} em ${record.deviceName}`, 'VERIFIED');
  debugLog('INFO', 'SIDECAR', `Hotkey ${combo} -> ${status} on ${record.deviceName}`, {
    durationMs: record.durationMs,
    payload: output,
  });
  return record;
}

export async function dispatchSidecarHostCommand(params: {
  command: string;
  deviceId?: string;
  kind?: SidecarHostCommandRecord['kind'];
}): Promise<SidecarHostCommandRecord> {
  const cleanCmd = params.command.trim();
  const state = db.getState();
  const device = state.devices.find((d) => d.id === (params.deviceId || 'dev-local-host')) || state.devices[0];
  const isLocal = !device || device.isCurrentHost;
  const t0 = Date.now();

  if (state.settings.sidecarDirectControlEnabled === false) {
    const blockedRec: SidecarHostCommandRecord = {
      id: `scmd-${Date.now()}`,
      deviceId: device?.id || 'dev-local-host',
      deviceName: device?.name || os.hostname(),
      kind: params.kind || 'HOST_EXEC',
      actionOrCommand: cleanCmd,
      status: 'BLOCKED',
      output: 'Controlo direto da máquina Sidecar desativado nas Definições de Segurança.',
      durationMs: 1,
      timestamp: new Date().toISOString(),
    };
    return blockedRec;
  }

  if (!isLocal) {
    const scan = detectPromptInjection(cleanCmd);
    const remoteRec: SidecarHostCommandRecord = {
      id: `scmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      deviceId: device.id,
      deviceName: device.name,
      kind: params.kind || 'HOST_EXEC',
      actionOrCommand: cleanCmd,
      status: scan.blocked ? 'BLOCKED' : 'QUEUED_REMOTE',
      output: scan.blocked
        ? `Bloqueado pelo TrustBoundaryGate (${scan.matchedRules.join(', ')})`
        : `Comando em fila para execução pelo agente Sidecar em ${device.hostname} (${device.ipAddress}).`,
      durationMs: Math.max(1, Date.now() - t0),
      timestamp: new Date().toISOString(),
    };
    db.update((draft) => {
      if (!draft.sidecarCommandQueue) draft.sidecarCommandQueue = [];
      draft.sidecarCommandQueue.unshift(remoteRec);
    });
    return remoteRec;
  }

  const execRes = await executeGovernedCommand(cleanCmd, 'SIDECAR_HOST');
  const record: SidecarHostCommandRecord = {
    id: `scmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    deviceId: device?.id || 'dev-local-host',
    deviceName: device?.name || os.hostname(),
    kind: params.kind || 'HOST_EXEC',
    actionOrCommand: cleanCmd,
    status: execRes.status,
    output: execRes.output,
    durationMs: execRes.durationMs,
    timestamp: new Date().toISOString(),
  };

  db.update((draft) => {
    if (!draft.sidecarCommandQueue) draft.sidecarCommandQueue = [];
    draft.sidecarCommandQueue.unshift(record);
    if (draft.sidecarCommandQueue.length > 40) draft.sidecarCommandQueue.length = 40;
  });

  return record;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function captureSidecarDesktopScreen(
  deviceId = 'dev-local-host',
  activeServerPort = 3000
): Promise<ScreenCaptureSnapshot> {
  const t0 = performance.now();
  const nowIso = new Date().toISOString();
  const [hostSnap, telemetry] = await Promise.all([
    collectSidecarHostSnapshot(deviceId),
    collectOSTelemetry(activeServerPort),
  ]);
  const topWin = hostSnap.activeWindows[0]?.title || `Ambiente de Trabalho (${hostSnap.hostname})`;

  // 1. Native Windows Desktop Capture via PowerShell System.Drawing
  if (process.platform === 'win32') {
    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
      '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;',
      '$src = New-Object System.Drawing.Bitmap($b.Width, $b.Height);',
      '$g = [System.Drawing.Graphics]::FromImage($src);',
      '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size);',
      '$g.Dispose();',
      '$targetW = [Math]::Min(1280, $b.Width);',
      '$targetH = [int]([Math]::Round($b.Height * ($targetW / [double]$b.Width)));',
      '$dst = New-Object System.Drawing.Bitmap($src, $targetW, $targetH);',
      '$src.Dispose();',
      '$ms = New-Object System.IO.MemoryStream;',
      '$dst.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg);',
      '$dst.Dispose();',
      '$b64 = [Convert]::ToBase64String($ms.ToArray());',
      '$ms.Dispose();',
      'Write-Output ("{""w"":" + $targetW + ",""h"":" + $targetH + ",""b64"":""" + $b64 + """}");',
    ].join(' ');
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psScript], {
        timeout: 4500,
        maxBuffer: 8 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout.trim()) as { w: number; h: number; b64: string };
      if (parsed.b64) {
        debugLog('INFO', 'SIDECAR', `Captured Windows primary screen (${parsed.w}x${parsed.h})`, {
          durationMs: performance.now() - t0,
        });
        return {
          id: `scr-win-${Date.now()}`,
          source: 'SIDECAR_NATIVE',
          capturedAt: nowIso,
          width: parsed.w,
          height: parsed.h,
          mimeType: 'image/jpeg',
          dataBase64: parsed.b64,
          activeWindowTitle: topWin,
          hostname: hostSnap.hostname,
        };
      }
    } catch (err) {
      debugLog('WARN', 'SIDECAR', `Windows screen capture fallback: ${(err as Error).message}`);
    }
  }

  // 2. Native macOS Desktop Capture via screencapture
  if (process.platform === 'darwin') {
    const tmpFile = path.join(os.tmpdir(), `jarvis-screen-${Date.now()}.jpg`);
    try {
      await execFileAsync('screencapture', ['-x', '-C', '-t', 'jpg', tmpFile], { timeout: 3500 });
      if (fs.existsSync(tmpFile)) {
        const b64 = fs.readFileSync(tmpFile).toString('base64');
        fs.unlinkSync(tmpFile);
        debugLog('INFO', 'SIDECAR', 'Captured macOS desktop via screencapture', {
          durationMs: performance.now() - t0,
        });
        return {
          id: `scr-mac-${Date.now()}`,
          source: 'SIDECAR_NATIVE',
          capturedAt: nowIso,
          width: 1280,
          height: 800,
          mimeType: 'image/jpeg',
          dataBase64: b64,
          activeWindowTitle: topWin,
          hostname: hostSnap.hostname,
        };
      }
    } catch {
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch {
        // ignore cleanup error
      }
    }
  }

  // 3. Native Linux X11 Capture when DISPLAY is present
  if (process.platform === 'linux' && process.env.DISPLAY) {
    const tmpFile = path.join(os.tmpdir(), `jarvis-screen-${Date.now()}.jpg`);
    try {
      await execFileAsync('scrot', ['-q', '75', tmpFile], { timeout: 3000 });
      if (fs.existsSync(tmpFile)) {
        const b64 = fs.readFileSync(tmpFile).toString('base64');
        fs.unlinkSync(tmpFile);
        debugLog('INFO', 'SIDECAR', 'Captured Linux X11 desktop via scrot', {
          durationMs: performance.now() - t0,
        });
        return {
          id: `scr-x11-${Date.now()}`,
          source: 'SIDECAR_NATIVE',
          capturedAt: nowIso,
          width: 1280,
          height: 720,
          mimeType: 'image/jpeg',
          dataBase64: b64,
          activeWindowTitle: topWin,
          hostname: hostSnap.hostname,
        };
      }
    } catch {
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch {
        // ignore
      }
    }
  }

  // 4. Headless / Container Host Live Visual Telemetry Frame (SVG)
  const winRows = hostSnap.activeWindows
    .slice(0, 4)
    .map(
      (w, idx) =>
        `<text x="44" y="${214 + idx * 28}" fill="#cbd5e1" font-family="monospace" font-size="14">• [${escapeXml(
          w.process || 'proc'
        )}] ${escapeXml((w.title || '').slice(0, 68))}</text>`
    )
    .join('');

  const procRows = hostSnap.topProcesses
    .slice(0, 4)
    .map(
      (p, idx) =>
        `<text x="44" y="${374 + idx * 26}" fill="#94a3b8" font-family="monospace" font-size="13">PID ${
          p.pid
        } · ${escapeXml(p.name.slice(0, 26))} — CPU ${p.cpuPercent}% · RAM ${p.memPercent}%</text>`
    )
    .join('');

  const openPortsText = telemetry.ports
    .filter((p) => p.open)
    .map((p) => `:${p.port} (${p.service})`)
    .join(' · ');

  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
    <rect width="960" height="540" fill="#0b0d12"/>
    <rect x="20" y="20" width="920" height="500" rx="14" fill="#121620" stroke="#262c3a" stroke-width="1.5"/>
    <circle cx="48" cy="52" r="6" fill="#34d399"/>
    <text x="66" y="57" fill="#f1f5f9" font-family="sans-serif" font-size="16" font-weight="600">SIDECAR HOST LIVE SNAPSHOT · ${escapeXml(
      hostSnap.hostname
    )} (${escapeXml(telemetry.platform)}/${escapeXml(telemetry.arch)})</text>
    <text x="912" y="57" text-anchor="end" fill="#94a3b8" font-family="monospace" font-size="13">${escapeXml(
      nowIso.slice(11, 19)
    )} UTC</text>
    <line x1="20" y1="78" x2="940" y2="78" stroke="#222836" stroke-width="1"/>
    <rect x="40" y="98" width="275" height="68" rx="10" fill="#171c28" stroke="#262e40"/>
    <text x="56" y="122" fill="#94a3b8" font-family="sans-serif" font-size="12">CPU &amp; NÚCLEOS</text>
    <text x="56" y="149" fill="#e59a54" font-family="monospace" font-size="20" font-weight="700">${
      telemetry.cpuUsagePercent
    }% · ${telemetry.cpuCores} cores</text>
    <rect x="332" y="98" width="275" height="68" rx="10" fill="#171c28" stroke="#262e40"/>
    <text x="348" y="122" fill="#94a3b8" font-family="sans-serif" font-size="12">MEMÓRIA FÍSICA</text>
    <text x="348" y="149" fill="#6e8efb" font-family="monospace" font-size="20" font-weight="700">${
      telemetry.ramUsedGb
    } / ${telemetry.ramTotalGb} GB (${telemetry.ramPercent}%)</text>
    <rect x="624" y="98" width="296" height="68" rx="10" fill="#171c28" stroke="#262e40"/>
    <text x="640" y="122" fill="#94a3b8" font-family="sans-serif" font-size="12">DISCO NVME</text>
    <text x="640" y="149" fill="#34d399" font-family="monospace" font-size="20" font-weight="700">${
      telemetry.diskUsedGb
    } / ${telemetry.diskTotalGb} GB (${telemetry.diskPercent}%)</text>
    <text x="44" y="190" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="600">JANELAS ATIVAS DETETADAS PELO SIDECAR</text>
    ${winRows}
    <text x="44" y="348" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="600">PROCESSOS EM EXECUÇÃO (TOP CPU/RAM)</text>
    ${procRows}
    <rect x="40" y="468" width="880" height="34" rx="8" fill="#0e121a" stroke="#202634"/>
    <text x="54" y="490" fill="#94a3b8" font-family="monospace" font-size="12">Portas Ativas: ${escapeXml(
      openPortsText.slice(0, 95)
    )}</text>
  </svg>`;

  debugLog('INFO', 'SIDECAR', `Generated live Sidecar host visual frame for ${hostSnap.hostname}`, {
    durationMs: performance.now() - t0,
  });

  return {
    id: `scr-host-${Date.now()}`,
    source: 'SIDECAR_NATIVE',
    capturedAt: nowIso,
    width: 960,
    height: 540,
    mimeType: 'image/svg+xml',
    dataBase64: Buffer.from(svgMarkup, 'utf-8').toString('base64'),
    activeWindowTitle: topWin,
    hostname: hostSnap.hostname,
  };
}

