#!/usr/bin/env node
/**
 * Unified ESM Launcher for J.A.R.V.I.S. Cortex OS v4.0 (A-02 Consolidation).
 * Delegates execution to the single canonical TypeScript server (`server.ts`)
 * instead of maintaining a duplicate server implementation.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.includes('--build')) {
  const indexHtml = path.join(__dirname, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    console.error('[ERROR] Missing index.html in workspace root.');
    process.exit(1);
  }
  console.log('[BUILD] Verified entrypoint assets -> delegates runtime to server.ts');
  process.exit(0);
}

const tsxBin = path.join(
  __dirname,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
);
const runner = fs.existsSync(tsxBin) ? tsxBin : process.execPath;
const runnerArgs = [path.join(__dirname, 'server.ts'), ...args];

const child = spawn(runner, runnerArgs, {
  cwd: __dirname,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
