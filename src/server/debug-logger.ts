import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import {
  classifyHttpLogLevel,
  formatDebugPayloadPreview,
  type DebugLogLevel,
} from '../shared/cortex-math.ts';

export type DebugSubsystem =
  | 'BOOT'
  | 'HTTP'
  | 'SSE'
  | 'DB'
  | 'AUDIT'
  | 'OS-EXEC'
  | 'SIDECAR'
  | 'CONTRACT'
  | 'WORKFLOW'
  | 'HEARTBEAT'
  | 'SWARM'
  | 'SCOUT-AST'
  | 'PROACTIVE'
  | 'BRAIN:8765'
  | 'MCP'
  | 'AI-ENGINE'
  | 'FATAL';

export interface DebugLogEntry {
  seq: number;
  timestamp: string;
  level: DebugLogLevel;
  subsystem: DebugSubsystem;
  message: string;
  durationMs?: number;
  meta?: string;
}

const LOGS_DIR = path.resolve(process.cwd(), 'logs');
const DEBUG_LOG_FILE = path.join(LOGS_DIR, 'jarvis-debug.log');
const DEBUG_LOG_PREV_FILE = path.join(LOGS_DIR, 'jarvis-debug.prev.log');
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024; // 5 MB auto-rotate
const MAX_RING_BUFFER = 300;

const ringBuffer: DebugLogEntry[] = [];
let seqCounter = 0;
let logDirReady = false;

function isRunningUnderUnitTest(): boolean {
  return (
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.execArgv.includes('--test') ||
    process.argv.includes('--test')
  );
}

export function isDebugLoggingEnabled(): boolean {
  if (process.env.JARVIS_DEBUG === '0' || process.env.JARVIS_DEBUG === 'false') {
    return false;
  }
  if (isRunningUnderUnitTest() && process.env.JARVIS_DEBUG !== '1') {
    return false;
  }
  return true;
}

function ensureLogDirectory(): boolean {
  if (logDirReady) return true;
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    logDirReady = true;
    return true;
  } catch {
    return false;
  }
}

function appendFileSafe(plainLine: string): void {
  if (!ensureLogDirectory()) return;
  try {
    if (fs.existsSync(DEBUG_LOG_FILE)) {
      const stat = fs.statSync(DEBUG_LOG_FILE);
      if (stat.size >= MAX_LOG_FILE_BYTES) {
        try {
          fs.renameSync(DEBUG_LOG_FILE, DEBUG_LOG_PREV_FILE);
        } catch {
          // ignore rotation collision
        }
      }
    }
    fs.appendFileSync(DEBUG_LOG_FILE, `${plainLine}\n`, 'utf-8');
  } catch {
    // Non-fatal if filesystem is read-only
  }
}

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  amber: '\x1b[33m',
  emerald: '\x1b[32m',
  rose: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function colorForLevel(level: DebugLogLevel): string {
  switch (level) {
    case 'ERROR':
      return ANSI.rose;
    case 'WARN':
      return ANSI.amber;
    case 'INFO':
      return ANSI.emerald;
    case 'DEBUG':
    default:
      return ANSI.cyan;
  }
}

function colorForSubsystem(sub: DebugSubsystem): string {
  switch (sub) {
    case 'BOOT':
    case 'AI-ENGINE':
      return ANSI.amber;
    case 'HTTP':
    case 'SSE':
    case 'MCP':
      return ANSI.cyan;
    case 'SWARM':
    case 'SCOUT-AST':
    case 'BRAIN:8765':
    case 'PROACTIVE':
      return ANSI.magenta;
    case 'DB':
    case 'AUDIT':
    case 'CONTRACT':
      return ANSI.emerald;
    case 'FATAL':
      return ANSI.rose;
    default:
      return ANSI.blue;
  }
}

export function debugLog(
  level: DebugLogLevel,
  subsystem: DebugSubsystem,
  message: string,
  options?: {
    durationMs?: number;
    payload?: unknown;
    maxPreviewLen?: number;
  }
): void {
  if (!isDebugLoggingEnabled()) return;

  seqCounter += 1;
  const nowIso = new Date().toISOString();
  const timeShort = nowIso.slice(11, 23); // HH:MM:SS.mmm
  const durStr =
    options?.durationMs !== undefined ? ` (${Number(options.durationMs.toFixed(2))}ms)` : '';
  const meta =
    options?.payload !== undefined
      ? formatDebugPayloadPreview(options.payload, options.maxPreviewLen ?? 280)
      : '';

  const entry: DebugLogEntry = {
    seq: seqCounter,
    timestamp: nowIso,
    level,
    subsystem,
    message,
    durationMs: options?.durationMs,
    meta: meta || undefined,
  };

  ringBuffer.push(entry);
  if (ringBuffer.length > MAX_RING_BUFFER) {
    ringBuffer.shift();
  }

  const seqTag = `#${String(seqCounter).padStart(4, '0')}`;
  const plainLine = `[${nowIso}] ${seqTag} [${level.padEnd(5)}] [${subsystem.padEnd(10)}] ${message}${durStr}${
    meta ? ` | ${meta}` : ''
  }`;

  appendFileSafe(plainLine);

  const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== '1';
  if (useColor) {
    const lvlColor = colorForLevel(level);
    const subColor = colorForSubsystem(subsystem);
    const consoleLine =
      `${ANSI.gray}${timeShort} ${seqTag}${ANSI.reset} ` +
      `${lvlColor}${level.padEnd(5)}${ANSI.reset} ` +
      `${subColor}[${subsystem.padEnd(10)}]${ANSI.reset} ` +
      `${message}` +
      `${durStr ? `${ANSI.amber}${durStr}${ANSI.reset}` : ''}` +
      `${meta ? ` ${ANSI.gray}| ${meta}${ANSI.reset}` : ''}`;

    if (level === 'ERROR') {
      console.error(consoleLine);
    } else if (level === 'WARN') {
      console.warn(consoleLine);
    } else {
      console.log(consoleLine);
    }
  } else {
    if (level === 'ERROR') {
      console.error(plainLine);
    } else if (level === 'WARN') {
      console.warn(plainLine);
    } else {
      console.log(plainLine);
    }
  }
}

export function getDebugLogFilePath(): string {
  return DEBUG_LOG_FILE;
}

export function getRecentDebugLogs(limit = 150): DebugLogEntry[] {
  const safeLimit = Math.max(1, Math.min(MAX_RING_BUFFER, Number(limit) || 150));
  return ringBuffer.slice(-safeLimit).reverse();
}

export function printStartupDebugBanner(params: {
  port: number;
  host: string;
  storageEngine: string;
  isProd: boolean;
  geminiConfigured: boolean;
  openRouterConfigured: boolean;
}): void {
  if (!isDebugLoggingEnabled()) return;
  const totalRamGb = (os.totalmem() / 1073741824).toFixed(1);
  const freeRamGb = (os.freemem() / 1073741824).toFixed(1);

  debugLog(
    'INFO',
    'BOOT',
    `========================================================================`
  );
  debugLog(
    'INFO',
    'BOOT',
    `J.A.R.V.I.S. CORTEX OS v3.0 × ANTIGRAVITY BRAIN v7.2 — FULL DEBUG MODE`
  );
  debugLog(
    'INFO',
    'BOOT',
    `Runtime: Node ${process.version} · PID ${process.pid} · ${process.platform}/${process.arch} · RAM ${freeRamGb}/${totalRamGb} GB free`
  );
  debugLog(
    'INFO',
    'BOOT',
    `Gateway: http://${params.host === '0.0.0.0' ? 'localhost' : params.host}:${params.port} · Mode=${
      params.isProd ? 'PRODUCTION_STATIC' : 'VITE_DEV_MIDDLEWARE'
    } · Storage=${params.storageEngine}`
  );
  debugLog(
    'INFO',
    'BOOT',
    `Providers: Gemini=${params.geminiConfigured ? 'CONFIGURED' : 'LOCAL_FALLBACK'} · OpenRouter=${
      params.openRouterConfigured ? 'CONFIGURED' : 'OFF'
    } · BrainBridge=http://127.0.0.1:8765`
  );
  debugLog('INFO', 'BOOT', `Debug Log File: ${DEBUG_LOG_FILE}`);
  debugLog(
    'INFO',
    'BOOT',
    `========================================================================`
  );
}

export function createHttpDebugMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isDebugLoggingEnabled()) {
      next();
      return;
    }

    const url = req.originalUrl || req.url || '/';
    // Skip noisy Vite internal module/asset requests unless JARVIS_DEBUG_ASSETS=1
    const isViteAsset =
      !url.startsWith('/api') &&
      (url.startsWith('/@') ||
        url.startsWith('/src/') ||
        url.startsWith('/node_modules/') ||
        /\.(js|ts|tsx|css|svg|png|ico|woff2?|map)(\?|$)/.test(url));

    if (isViteAsset && process.env.JARVIS_DEBUG_ASSETS !== '1') {
      next();
      return;
    }

    const startNs = process.hrtime.bigint();
    const method = req.method;
    const hasBody =
      req.body && typeof req.body === 'object' && Object.keys(req.body as object).length > 0;

    debugLog('DEBUG', 'HTTP', `--> ${method} ${url}`, {
      payload: hasBody ? req.body : Object.keys(req.query || {}).length > 0 ? req.query : undefined,
      maxPreviewLen: 260,
    });

    let responsePreview: unknown = undefined;
    const origJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      responsePreview = body;
      return origJson(body);
    }) as typeof res.json;

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      const status = res.statusCode;
      const level = classifyHttpLogLevel(status, durationMs);
      const contentLen = res.getHeader('content-length');
      const sizeTag = contentLen ? ` · ${contentLen}B` : '';

      // Summarize large bootstrap payloads cleanly instead of dumping 50KB
      let outPayload = responsePreview;
      if (url.startsWith('/api/bootstrap') && outPayload && typeof outPayload === 'object') {
        const b = outPayload as {
          storageEngine?: string;
          activePort?: number;
          brain8765?: { mode?: string };
          state?: {
            projects?: unknown[];
            memories?: unknown[];
            rooms?: unknown[];
            approvals?: unknown[];
          };
        };
        outPayload = {
          engine: b.storageEngine,
          port: b.activePort,
          brainMode: b.brain8765?.mode,
          projects: b.state?.projects?.length ?? 0,
          memories: b.state?.memories?.length ?? 0,
          rooms: b.state?.rooms?.length ?? 0,
          approvals: b.state?.approvals?.length ?? 0,
        };
      }

      debugLog(level, 'HTTP', `<-- ${method} ${url} -> ${status}${sizeTag}`, {
        durationMs,
        payload: outPayload,
        maxPreviewLen: status >= 400 ? 420 : 220,
      });
    });

    next();
  };
}
