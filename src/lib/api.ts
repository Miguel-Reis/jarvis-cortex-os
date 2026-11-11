import { formatDebugPayloadPreview } from '../shared/cortex-math';

/**
 * Typed JSON HTTP Client for J.A.R.V.I.S. Cortex OS v3.0 Gateway.
 * Emits structured Browser DevTools debug traces (`console.debug`).
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
    const errObj = parsed as { error?: string; message?: string } | null;
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

