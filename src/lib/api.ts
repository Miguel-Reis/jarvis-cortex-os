import { formatDebugPayloadPreview } from '../shared/cortex-math';
import type { DoctorReport, SeedMode } from '../shared/types';

const OPERATOR_TOKEN_STORAGE_KEY = 'jarvis_operator_token';

export function getStoredOperatorToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(OPERATOR_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredOperatorToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token && token.trim()) {
      window.sessionStorage.setItem(OPERATOR_TOKEN_STORAGE_KEY, token.trim());
    } else {
      window.sessionStorage.removeItem(OPERATOR_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota / sandbox restrictions
  }
}

/**
 * Typed JSON HTTP Client for J.A.R.V.I.S. Cortex OS v4.0 Gateway.
 * Attaches Operator Bearer credentials when configured and emits structured DevTools traces.
 */
export async function apiJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const headers = new Headers(init?.headers || {});
  if (init?.body !== undefined && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const storedToken = getStoredOperatorToken();
  if (storedToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${storedToken}`);
  }

  let reqPreview = '';
  if (typeof init?.body === 'string' && init.body.length > 0) {
    try {
      reqPreview = formatDebugPayloadPreview(JSON.parse(init.body), 160);
    } catch {
      reqPreview = formatDebugPayloadPreview(init.body, 160);
    }
  }

  console.debug(
    `[JARVIS:HTTP] --> ${method} ${url}${reqPreview ? ` | ${reqPreview}` : ''}`
  );

  const response = await fetch(url, {
    ...init,
    credentials: init?.credentials ?? 'same-origin',
    headers,
  });

  const rawText = await response.text();
  const elapsedMs = Number(
    ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(1)
  );
  let parsed: unknown = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const errObj = parsed as { error?: string; message?: string; code?: string } | null;
    if (
      response.status === 401 &&
      url !== '/api/auth/login' &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(
        new CustomEvent('jarvis:auth-required', {
          detail: { code: errObj?.code || 'AUTH_REQUIRED', url },
        })
      );
    }
    const detail =
      errObj?.error ||
      errObj?.message ||
      (rawText ? rawText.slice(0, 240) : `HTTP ${response.status} ${response.statusText}`);
    console.debug(
      `[JARVIS:HTTP] <-- ${method} ${url} -> ${response.status} (${elapsedMs}ms) | ERROR: ${detail}`
    );
    throw new Error(detail);
  }

  console.debug(
    `[JARVIS:HTTP] <-- ${method} ${url} -> ${response.status} (${elapsedMs}ms · ${rawText.length}B)`
  );

  return (parsed ?? ({} as unknown)) as T;
}

export async function loginOperatorToken(
  token: string
): Promise<{ ok: boolean; authRequired: boolean }> {
  const clean = token.trim();
  const res = await apiJson<{ ok: boolean; authRequired: boolean }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ token: clean }),
  });
  setStoredOperatorToken(clean);
  return res;
}

export async function fetchSystemDoctor(): Promise<DoctorReport> {
  return apiJson<DoctorReport>('/api/system/doctor');
}

export async function purgeDemoSeedsApi(): Promise<{
  ok: boolean;
  removedSwarmRuns: number;
  removedWorkflowRuns: number;
  removedMemories: number;
  seedMode: SeedMode;
}> {
  return apiJson('/api/system/purge-seeds', { method: 'POST', body: JSON.stringify({}) });
}

export async function compactMemoryVaultApi(opts?: {
  workingTtlHours?: number;
  duplicateThreshold?: number;
}): Promise<{
  ok: boolean;
  duplicatesSuperseded: number;
  workingPruned: number;
  importanceDecayed: number;
}> {
  return apiJson('/api/memories/compact', {
    method: 'POST',
    body: JSON.stringify(opts || {}),
  });
}


