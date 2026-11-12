import type { Response } from 'express';
import { redactAiDefenceSecrets } from '../shared/cortex-math.ts';
import type { JarvisStoreData } from '../shared/types.ts';
import { db } from './db.ts';

/**
 * A-12: Centralized Schema Validation, Redacted Audit Logging & HTTP Response Helpers.
 */

export type AuditCategory = JarvisStoreData['auditLogs'][number]['category'];
export type AuditStatus = JarvisStoreData['auditLogs'][number]['status'];

export function audit(
  actor: string,
  category: AuditCategory,
  action: string,
  detail: string,
  status: AuditStatus = 'VERIFIED'
): void {
  const safeActor = actor.trim() || 'OPERATOR';
  const redacted = redactAiDefenceSecrets(String(detail || '')).sanitized;
  db.appendAudit(safeActor, category, action, redacted.slice(0, 260), status);
}

export function respondError(
  res: Response,
  status: number,
  error: string,
  extra?: Record<string, unknown>
): void {
  res.status(status).json({
    error,
    ...(extra || {}),
  });
}

export function respondOk<T extends object>(res: Response, payload: T, status = 200): void {
  res.status(status).json(payload);
}

export function requireNonEmptyString(raw: unknown, maxLen = 4000): string | null {
  const clean = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
  if (!clean) {
    return null;
  }
  return clean.slice(0, maxLen);
}

export function parseStringList(raw: unknown, maxItems = 32): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .slice(0, maxItems);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, maxItems);
  }
  return [];
}
