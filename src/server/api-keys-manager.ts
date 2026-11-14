import fs from 'node:fs';
import path from 'node:path';
import { maskSecretApiKey } from '../shared/cortex-math.ts';
import type {
  ServerApiKeysStatus,
  UpdateServerApiKeysPayload,
} from '../shared/types.ts';

const DEFAULT_DOT_ENV_PATH = path.resolve(process.cwd(), '.env');
const runtimeClearedKeys = new Set<string>();
let lastUpdatedAt: string | undefined;

/**
 * Strips newlines, surrounding whitespace, and matching outer quotes from an API key
 * input so `.env` injection via embedded newlines is impossible.
 */
export function sanitizeApiKeyInput(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let val = raw.replace(/[\r\n]/g, '').trim();
  if (
    (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
    (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
  ) {
    val = val.slice(1, -1).trim();
  }
  return val;
}

function readDotEnvKeySet(dotEnvPath: string): Set<string> {
  const keys = new Set<string>();
  if (!fs.existsSync(dotEnvPath)) return keys;
  try {
    const lines = fs.readFileSync(dotEnvPath, 'utf-8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = sanitizeApiKeyInput(line.slice(eqIdx + 1));
      if (key && val) keys.add(key);
    }
  } catch {
    // Ignore unreadable .env file
  }
  return keys;
}

/**
 * Loads key/value pairs from `.env` into `process.env` without overwriting
 * variables already defined in memory or explicitly cleared at runtime.
 */
export function loadDotEnvIntoProcess(dotEnvPath = DEFAULT_DOT_ENV_PATH): void {
  if (!fs.existsSync(dotEnvPath)) return;
  try {
    const lines = fs.readFileSync(dotEnvPath, 'utf-8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = sanitizeApiKeyInput(line.slice(eqIdx + 1));
      if (key && process.env[key] === undefined && !runtimeClearedKeys.has(key)) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore unreadable .env file
  }
}

/**
 * Returns the masked runtime & `.env` status for configured LLM API keys.
 * Raw secret values are never returned.
 */
export function getServerApiKeysStatus(dotEnvPath = DEFAULT_DOT_ENV_PATH): ServerApiKeysStatus {
  const envKeys = readDotEnvKeySet(dotEnvPath);
  const geminiRaw = process.env.GEMINI_API_KEY?.trim() || '';
  const openRouterRaw = process.env.OPENROUTER_API_KEY?.trim() || '';

  return {
    geminiConfigured: Boolean(geminiRaw),
    geminiMaskedKey: maskSecretApiKey(geminiRaw),
    geminiKeySource: !geminiRaw
      ? 'NONE'
      : envKeys.has('GEMINI_API_KEY')
        ? 'DOTENV'
        : 'RUNTIME',
    openRouterConfigured: Boolean(openRouterRaw),
    openRouterMaskedKey: maskSecretApiKey(openRouterRaw),
    openRouterKeySource: !openRouterRaw
      ? 'NONE'
      : envKeys.has('OPENROUTER_API_KEY')
        ? 'DOTENV'
        : 'RUNTIME',
    updatedAt: lastUpdatedAt,
  };
}

function upsertDotEnvVariables(
  dotEnvPath: string,
  updates: Record<string, string | null>
): void {
  const existingContent = fs.existsSync(dotEnvPath)
    ? fs.readFileSync(dotEnvPath, 'utf-8')
    : '';
  const rawLines = existingContent ? existingContent.split(/\r?\n/) : [];
  const handled = new Set<string>();
  const nextLines: string[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      nextLines.push(rawLine);
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) {
      nextLines.push(rawLine);
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      handled.add(key);
      const nextVal = updates[key];
      if (nextVal !== null && nextVal !== '') {
        nextLines.push(`${key}=${nextVal}`);
      }
      // If null, omit the line to remove the cleared key cleanly
    } else {
      nextLines.push(rawLine);
    }
  }

  for (const [key, val] of Object.entries(updates)) {
    if (!handled.has(key) && val !== null && val !== '') {
      nextLines.push(`${key}=${val}`);
    }
  }

  // Trim trailing blank lines then ensure single trailing newline
  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
    nextLines.pop();
  }
  const finalContent = nextLines.length > 0 ? `${nextLines.join('\n')}\n` : '';
  fs.mkdirSync(path.dirname(dotEnvPath), { recursive: true });
  fs.writeFileSync(dotEnvPath, finalContent, { encoding: 'utf-8', mode: 0o600 });
}

function applySingleEnvUpdate(
  envName: 'GEMINI_API_KEY' | 'OPENROUTER_API_KEY',
  rawValue: string | null | undefined,
  explicitClear: boolean | undefined,
  dotEnvUpdates: Record<string, string | null>
): void {
  if (explicitClear || rawValue === null || rawValue === '') {
    delete process.env[envName];
    runtimeClearedKeys.add(envName);
    dotEnvUpdates[envName] = null;
    return;
  }
  if (typeof rawValue === 'string') {
    const clean = sanitizeApiKeyInput(rawValue);
    if (!clean) {
      delete process.env[envName];
      runtimeClearedKeys.add(envName);
      dotEnvUpdates[envName] = null;
    } else {
      process.env[envName] = clean;
      runtimeClearedKeys.delete(envName);
      dotEnvUpdates[envName] = clean;
    }
  }
}

/**
 * Updates `GEMINI_API_KEY` and/or `OPENROUTER_API_KEY` immediately in runtime
 * memory (`process.env`) and optionally persists changes to `.env`.
 */
export function updateServerApiKeys(
  payload: UpdateServerApiKeysPayload,
  dotEnvPath = DEFAULT_DOT_ENV_PATH
): ServerApiKeysStatus {
  const dotEnvUpdates: Record<string, string | null> = {};

  if (payload.clearGeminiKey || payload.geminiApiKey !== undefined) {
    applySingleEnvUpdate(
      'GEMINI_API_KEY',
      payload.geminiApiKey,
      payload.clearGeminiKey,
      dotEnvUpdates
    );
  }

  if (payload.clearOpenRouterKey || payload.openRouterApiKey !== undefined) {
    applySingleEnvUpdate(
      'OPENROUTER_API_KEY',
      payload.openRouterApiKey,
      payload.clearOpenRouterKey,
      dotEnvUpdates
    );
  }

  if (payload.persistToDotEnv !== false && Object.keys(dotEnvUpdates).length > 0) {
    upsertDotEnvVariables(dotEnvPath, dotEnvUpdates);
  }

  lastUpdatedAt = new Date().toISOString();
  return getServerApiKeysStatus(dotEnvPath);
}
