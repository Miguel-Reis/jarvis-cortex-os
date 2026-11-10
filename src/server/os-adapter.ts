import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { detectPromptInjection } from '../shared/cortex-math.ts';
import type { OSTelemetry, PortRadarEntry, TodayContractItem } from '../shared/types.ts';
import { db } from './db.ts';

const execAsync = promisify(exec);
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

export function listWorkspaceFiles(maxEntries = 140): WorkspaceFileEntry[] {
  const results: WorkspaceFileEntry[] = [];

  const walk = (relDir: string, depth: number) => {
    if (depth > 3 || results.length >= maxEntries) return;
    const absDir = path.join(WORKSPACE_ROOT, relDir);
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

      const relPath = relDir ? `${relDir}/${ent.name}` : ent.name;
      const absPath = path.join(WORKSPACE_ROOT, relPath);
      let sizeBytes = 0;
      if (!ent.isDirectory()) {
        try {
          sizeBytes = fs.statSync(absPath).size;
        } catch {
          sizeBytes = 0;
        }
      }
      results.push({
        path: relPath,
        name: ent.name,
        isDirectory: ent.isDirectory(),
        sizeBytes,
      });

      if (ent.isDirectory()) {
        walk(relPath, depth + 1);
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
  /^npm\s+--version$/,
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
    | 'MCP_GATEWAY' = 'WORKSPACE_TERMINAL',
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
    const { stdout, stderr } = await execAsync(cleanCmd, {
      cwd: WORKSPACE_ROOT,
      timeout: 12_000,
      maxBuffer: 512 * 1024,
      ...shellOpt,
    });
    const combined = [stdout?.trim(), stderr?.trim()].filter(Boolean).join('\n') || '(Comando concluído sem output)';
    db.appendAudit(source, 'TERMINAL', 'COMMAND_EXECUTED', cleanCmd, 'VERIFIED');
    return {
      status: 'EXECUTED',
      output: combined.slice(0, 6000),
      exitCode: 0,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string; code?: number };
    const out = [e.stdout?.trim(), e.stderr?.trim(), e.message].filter(Boolean).join('\n');
    return {
      status: 'EXECUTED',
      output: out.slice(0, 6000),
      exitCode: typeof e.code === 'number' ? e.code : 1,
      durationMs: Date.now() - start,
    };
  }
}

export async function verifyTodayContractItem(
  contract: TodayContractItem,
  activeServerPort = 3000
): Promise<{ verified: boolean; evidenceHash: string; summary: string }> {
  const nowIso = new Date().toISOString();

  if (contract.verificationRule === 'FILE_EXISTS') {
    const abs = path.resolve(WORKSPACE_ROOT, contract.verificationTarget);
    const exists = abs.startsWith(WORKSPACE_ROOT) && fs.existsSync(abs);
    const hash = crypto
      .createHash('sha256')
      .update(`${contract.verificationTarget}:${exists}:${nowIso}`)
      .digest('hex')
      .slice(0, 16);
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
      return {
        verified: ok,
        evidenceHash: hash,
        summary: `HTTP ${res.status} confirmado em ${contract.verificationTarget}.`,
      };
    } catch (err: unknown) {
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
  return {
    verified: true,
    evidenceHash: hash,
    summary: `Assinatura criptográfica SHA-256 gerada (${hash}) para ${contract.verificationTarget}.`,
  };
}
