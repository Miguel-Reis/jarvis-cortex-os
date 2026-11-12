import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import {
  classifyHttpLogLevel,
  formatDebugPayloadPreview,
  redactAiDefenceSecrets,
  type DebugLogLevel,
} from '../shared/cortex-math.ts';

export type DebugSubsystem =
  | 'BOOT'
  | 'HTTP'
  | 'SSE'
  | 'DB'
  | 'AUDIT'
  | 'SECURITY'
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
  | 'STUDIO-LOG'
  | 'VOICE-STT'
  | 'VOICE-TTS'
  | 'LIVE-WS'
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
const MAX_DAILY_LOG_FILE_BYTES = 8 * 1024 * 1024; // 8 MB cap per daily log file
const LOG_RETENTION_DAYS = 7;
const MAX_RING_BUFFER = 300;

const ringBuffer: DebugLogEntry[] = [];
let seqCounter = 0;
let logDirReady = false;
let lastPrunedDateKey = '';

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

function currentUtcDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getDailyLogFilePath(dateKey = currentUtcDateKey()): string {
  return path.join(LOGS_DIR, `jarvis-debug-${dateKey}.log`);
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

/**
 * A-11: Daily log retention sweep (keeps last 7 days of `jarvis-debug-YYYY-MM-DD*.log`).
 */
export function pruneOldDebugLogs(nowMs = Date.now(), retentionDays = LOG_RETENTION_DAYS): number {
  if (!ensureLogDirectory()) return 0;
  let removed = 0;
  const maxAgeMs = Math.max(1, retentionDays) * 86_400_000;
  try {
    const entries = fs.readdirSync(LOGS_DIR);
    for (const fileName of entries) {
      if (!fileName.startsWith('jarvis-debug') || !fileName.endsWith('.log')) continue;
      const fullPath = path.join(LOGS_DIR, fileName);
      try {
        const stat = fs.statSync(fullPath);
        if (nowMs - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
          removed += 1;
        }
      } catch {
        // Ignore concurrent deletion
      }
    }
  } catch {
    // Non-fatal
  }
  return removed;
}

function appendFileSafe(plainLine: string, now = new Date()): void {
  if (!ensureLogDirectory()) return;
  const dateKey = currentUtcDateKey(now);
  if (dateKey !== lastPrunedDateKey) {
    lastPrunedDateKey = dateKey;
    pruneOldDebugLogs(now.getTime());
  }

  const dailyFile = getDailyLogFilePath(dateKey);
  try {
    if (fs.existsSync(dailyFile)) {
      const stat = fs.statSync(dailyFile);
      if (stat.size >= MAX_DAILY_LOG_FILE_BYTES) {
        try {
          fs.renameSync(dailyFile, `${dailyFile}.prev.log`);
        } catch {
          // ignore rotation collision
        }
      }
    }
    fs.appendFileSync(dailyFile, `${plainLine}\n`, 'utf-8');
  } catch {
    // Non-fatal if filesystem is read-only
  }
}

/**
 * A-11: Redacts AI-Defence secrets PLUS configured JARVIS_API_TOKEN / Bearer tokens
 * from every debug log message and payload preview before writing to memory, console, or disk.
 */
export function sanitizeLogText(raw: string): string {
  if (!raw) return '';
  let text = redactAiDefenceSecrets(raw).sanitized;
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, 'Bearer [REDACTED_BEARER_TOKEN]');
  const envToken = (process.env.JARVIS_API_TOKEN || '').trim();
  if (envToken.length >= 6 && text.includes(envToken)) {
    text = text.split(envToken).join('[REDACTED_JARVIS_API_TOKEN]');
  }
  return text;
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
    case 'LIVE-WS':
    case 'VOICE-STT':
    case 'VOICE-TTS':
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
    case 'SECURITY':
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
  const now = new Date();
  const nowIso = now.toISOString();
  const timeShort = nowIso.slice(11, 23); // HH:MM:SS.mmm
  const durStr =
    options?.durationMs !== undefined ? ` (${Number(options.durationMs.toFixed(2))}ms)` : '';

  const safeMessage = sanitizeLogText(message);
  const rawMeta =
    options?.payload !== undefined
      ? formatDebugPayloadPreview(options.payload, options.maxPreviewLen ?? 280)
      : '';
  const safeMeta = rawMeta ? sanitizeLogText(rawMeta) : '';

  const entry: DebugLogEntry = {
    seq: seqCounter,
    timestamp: nowIso,
    level,
    subsystem,
    message: safeMessage,
    durationMs: options?.durationMs,
    meta: safeMeta || undefined,
  };

  ringBuffer.push(entry);
  if (ringBuffer.length > MAX_RING_BUFFER) {
    ringBuffer.shift();
  }

  const seqTag = `#${String(seqCounter).padStart(4, '0')}`;
  const plainLine = `[${nowIso}] ${seqTag} [${level.padEnd(5)}] [${subsystem.padEnd(10)}] ${safeMessage}${durStr}${
    safeMeta ? ` | ${safeMeta}` : ''
  }`;

  appendFileSafe(plainLine, now);

  const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== '1';
  if (useColor) {
    const lvlColor = colorForLevel(level);
    const subColor = colorForSubsystem(subsystem);
    const consoleLine =
      `${ANSI.gray}${timeShort} ${seqTag}${ANSI.reset} ` +
      `${lvlColor}${level.padEnd(5)}${ANSI.reset} ` +
      `${subColor}[${subsystem.padEnd(10)}]${ANSI.reset} ` +
      `${safeMessage}` +
      `${durStr ? `${ANSI.amber}${durStr}${ANSI.reset}` : ''}` +
      `${safeMeta ? ` ${ANSI.gray}| ${safeMeta}${ANSI.reset}` : ''}`;

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
  return getDailyLogFilePath();
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
  debugLog('INFO', 'BOOT', `Daily Redacted Log: ${getDailyLogFilePath()} (7-day retention)`);
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

    const rawUrl = req.originalUrl || req.url || '/';
    // Redact token query param if present on SSE /api/events?token=...
    const url = rawUrl.replace(/([?&]token=)[^&]+/gi, '$1[REDACTED]');

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
      req.body &&
      typeof req.body === 'object' &&
      !Buffer.isBuffer(req.body) &&
      Object.keys(req.body as object).length > 0;

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
