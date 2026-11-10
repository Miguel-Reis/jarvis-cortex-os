/**
 * Typed JSON HTTP Client for J.A.R.V.I.S. Cortex OS v3.0 Gateway.
 */
export async function apiJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (init?.body !== undefined && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  const rawText = await response.text();
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
    throw new Error(detail);
  }

  return (parsed ?? ({} as unknown)) as T;
}
