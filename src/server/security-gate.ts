import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { debugLog } from './debug-logger.ts';

/**
 * A-01: Host Binding, Authentication Gate, Single-Origin CORS Allowlist & IP Rate Limiter.
 */

const SESSION_COOKIE_NAME = 'jarvis_session_sig';

export function isLoopbackAddress(host: string): boolean {
  const clean = (host || '').trim().toLowerCase();
  return clean === '127.0.0.1' || clean === 'localhost' || clean === '::1';
}

export function isManagedCloudIngress(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.K_SERVICE || env.APPLET_ID);
}

/**
 * A-01.2: Default bind host is strictly loopback ('127.0.0.1').
 * Binding to '0.0.0.0' requires explicit CLI `--host 0.0.0.0` or `HOST=0.0.0.0`.
 */
export function resolveSafeBindHost(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): string {
  const hostFlagIdx = argv.indexOf('--host');
  if (hostFlagIdx >= 0 && argv[hostFlagIdx + 1]) {
    return String(argv[hostFlagIdx + 1]).trim() || '127.0.0.1';
  }
  const envHost = (env.HOST || env.npm_config_host || '').trim();
  if (envHost) return envHost;
  return '127.0.0.1';
}

export interface BindAuthPolicyVerdict {
  allowedToBoot: boolean;
  canBoot: boolean;
  authRequired: boolean;
  tokenRequired: boolean;
  tokenConfigured: boolean;
  isLoopback: boolean;
  managedIngress: boolean;
  isManagedPlatform: boolean;
  errorMessage?: string;
  fatalReason?: string;
}

/**
 * A-01.1: Enforces mandatory JARVIS_API_TOKEN when binding to a non-loopback address
 * on an unmanaged workstation/LAN (unless JARVIS_ALLOW_UNAUTHENTICATED_LAN=1).
 */
export function evaluateBindAuthPolicy(
  host: string,
  env: NodeJS.ProcessEnv = process.env
): BindAuthPolicyVerdict {
  const token = (env.JARVIS_API_TOKEN || '').trim();
  const tokenConfigured = token.length > 0;
  const loopback = isLoopbackAddress(host);
  const managedIngress = isManagedCloudIngress(env);

  if (!loopback && !managedIngress && !tokenConfigured && env.JARVIS_ALLOW_UNAUTHENTICATED_LAN !== '1') {
    const msg =
      `[SEGURANÇA A-01] Recusa de arranque em ${host} sem autenticação: define JARVIS_API_TOKEN=<segredo> ` +
      `no ambiente/.env ou arranca apenas em loopback (--host 127.0.0.1).`;
    return {
      allowedToBoot: false,
      canBoot: false,
      authRequired: true,
      tokenRequired: true,
      tokenConfigured: false,
      isLoopback: false,
      managedIngress: false,
      isManagedPlatform: false,
      errorMessage: msg,
      fatalReason: msg,
    };
  }

  const reqAuth = tokenConfigured || (!loopback && !managedIngress);
  return {
    allowedToBoot: true,
    canBoot: true,
    authRequired: reqAuth,
    tokenRequired: reqAuth,
    tokenConfigured,
    isLoopback: loopback,
    managedIngress,
    isManagedPlatform: managedIngress,
  };
}

export function constantTimeTokenEquals(expectedToken: string, candidateToken: string): boolean {
  if (!expectedToken || !candidateToken) return false;
  const hashA = crypto.createHash('sha256').update(expectedToken, 'utf-8').digest();
  const hashB = crypto.createHash('sha256').update(candidateToken, 'utf-8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function deriveSessionSignature(apiToken: string): string {
  return crypto
    .createHmac('sha256', apiToken)
    .update('jarvis-cortex-operator-session-v4')
    .digest('hex');
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

export function extractRequestBearerToken(req: Request): string {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  const headerToken = String(req.headers['x-jarvis-token'] || '').trim();
  if (headerToken) return headerToken;
  // EventSource (/api/events) cannot set custom headers in browsers
  if (req.path === '/api/events' && typeof req.query?.token === 'string') {
    return req.query.token.trim();
  }
  return '';
}

export function isAuthenticatedRequest(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const expectedToken = (env.JARVIS_API_TOKEN || '').trim();
  if (!expectedToken) {
    return true;
  }
  const bearer = extractRequestBearerToken(req);
  if (bearer && constantTimeTokenEquals(expectedToken, bearer)) {
    return true;
  }
  const cookies = parseCookies(req.headers.cookie);
  const sig = cookies[SESSION_COOKIE_NAME] || '';
  if (sig && constantTimeTokenEquals(deriveSessionSignature(expectedToken), sig)) {
    return true;
  }
  return false;
}

/**
 * A-01.3: Resolves the single allowed CORS origin (no wildcards `*`).
 */
export function resolveAllowedSingleOrigin(port: number, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = (env.JARVIS_CORS_ORIGIN || env.APP_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  return `http://127.0.0.1:${port}`;
}

export function isOriginPermitted(
  requestOrigin: string | undefined,
  requestHostHeader: string | undefined,
  port: number,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!requestOrigin) return true; // Same-origin non-CORS or CLI curl/supertest
  const cleanOrigin = requestOrigin.trim().replace(/\/$/, '');
  const primaryAllowed = resolveAllowedSingleOrigin(port, env);
  if (cleanOrigin === primaryAllowed) return true;

  // Permit exact same-host origin (e.g. http://localhost:3000 when accessed via localhost:3000)
  if (!env.JARVIS_CORS_ORIGIN) {
    try {
      const parsedOrigin = new URL(cleanOrigin);
      if (requestHostHeader && parsedOrigin.host.toLowerCase() === requestHostHeader.toLowerCase()) {
        return true;
      }
      if (
        (parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1') &&
        Number(parsedOrigin.port || 80) === port
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * A-01.4: Sliding-Window Rate Limiter per IP for high-impact routes.
 */
interface RateBucket {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  public consume(key: string, maxRequests: number, windowMs: number, nowMs = Date.now()): {
    allowed: boolean;
    remaining: number;
    retryAfterSec: number;
  } {
    const cutoff = nowMs - windowMs;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(key, bucket);
    }
    bucket.timestamps = bucket.timestamps.filter((ts) => ts > cutoff);

    if (bucket.timestamps.length >= maxRequests) {
      const oldest = bucket.timestamps[0] || nowMs;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000));
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec,
      };
    }

    bucket.timestamps.push(nowMs);
    if (this.buckets.size > 2000) {
      for (const [k, v] of this.buckets.entries()) {
        if (v.timestamps.every((ts) => ts <= cutoff)) {
          this.buckets.delete(k);
        }
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - bucket.timestamps.length),
      retryAfterSec: 0,
    };
  }

  public reset(): void {
    this.buckets.clear();
  }
}

export const defaultRateLimiter = new SlidingWindowRateLimiter();

function resolveClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

export function createSecurityGateMiddleware(params: {
  port: number;
  host?: string;
  env?: NodeJS.ProcessEnv;
  rateLimiter?: SlidingWindowRateLimiter;
}) {
  const env = params.env ?? process.env;
  const limiter = params.rateLimiter ?? defaultRateLimiter;

  return (req: Request, res: Response, next: NextFunction): void => {
    const urlPath = req.path || req.url || '/';

    // Security response headers on all requests
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (!urlPath.startsWith('/api')) {
      next();
      return;
    }

    // 1. Single-Origin CORS Allowlist
    const reqOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const reqHost = typeof req.headers.host === 'string' ? req.headers.host : undefined;

    if (!isOriginPermitted(reqOrigin, reqHost, params.port, env)) {
      debugLog('WARN', 'SECURITY' as 'AUDIT', `CORS blocked origin="${reqOrigin}" on ${urlPath}`);
      res.status(403).json({
        error: 'Origem CORS não autorizada pela allowlist de segurança.',
        code: 'CORS_ORIGIN_DENIED',
      });
      return;
    }

    if (reqOrigin) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Jarvis-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    // 2. Cross-Site Fetch Metadata CSRF Protection on mutating verbs
    const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
    if (isMutating && secFetchSite === 'cross-site') {
      res.status(403).json({
        error: 'Pedido cross-site bloqueado pela proteção anti-CSRF.',
        code: 'CSRF_CROSS_SITE_BLOCKED',
      });
      return;
    }

    // 3. Per-IP Rate Limiting on Execution, Backup & Auth Routes
    const clientIp = resolveClientIp(req);
    const isExecOrExport =
      urlPath.startsWith('/api/workspace/exec') ||
      urlPath.startsWith('/api/sidecar/host-exec') ||
      urlPath.startsWith('/api/backup/export') ||
      urlPath.startsWith('/api/backup/import') ||
      urlPath.startsWith('/api/auth/login');

    if (isExecOrExport) {
      const maxReq = Number(env.JARVIS_EXEC_RATE_LIMIT_PER_MIN) || 20;
      const verdict = limiter.consume(`sensitive:${clientIp}`, maxReq, 60_000);
      res.setHeader('X-RateLimit-Limit', String(maxReq));
      res.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
      if (!verdict.allowed) {
        res.setHeader('Retry-After', String(verdict.retryAfterSec));
        res.status(429).json({
          error: `Limite de pedidos excedido para operações sensíveis. Tenta novamente em ${verdict.retryAfterSec}s.`,
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfterSec: verdict.retryAfterSec,
        });
        return;
      }
    }

    // 4. Public unauthenticated health & auth handshake endpoints
    if (
      urlPath === '/api/health' ||
      urlPath === '/api/auth/status' ||
      urlPath === '/api/auth/login' ||
      urlPath === '/api/auth/logout'
    ) {
      next();
      return;
    }

    // 5. Mandatory Authorization: Bearer <JARVIS_API_TOKEN> (when configured)
    if (!isAuthenticatedRequest(req, env)) {
      res.status(401).json({
        error: 'Credencial em falta ou inválida. Fornece Authorization: Bearer <JARVIS_API_TOKEN>.',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    next();
  };
}

export function buildSessionSetCookieHeader(apiToken: string, secure: boolean): string {
  const sig = deriveSessionSignature(apiToken);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sig)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=43200',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
