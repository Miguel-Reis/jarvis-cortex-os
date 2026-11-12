import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

process.env.JARVIS_SKIP_AUTO_LISTEN = '1';

import { KeyedAsyncMutex } from './async-mutex';
import { CURRENT_SCHEMA_VERSION, JarvisDatabase } from './db';
import { sanitizeLogText } from './debug-logger';
import {
  evaluateBindAuthPolicy,
  resolveSafeBindHost,
  SlidingWindowRateLimiter,
} from './security-gate';
import { createJarvisExpressApp } from '../../server';

const execFileAsync = promisify(execFile);

test('A-07 KeyedAsyncMutex serializes concurrent async read-modify-write mutations without lost updates', async () => {
  const mutex = new KeyedAsyncMutex();
  let sharedCounter = 0;

  const worker = async (delayMs: number) =>
    mutex.withLock('swarm', async () => {
      const snapshot = sharedCounter;
      await new Promise((r) => setTimeout(r, delayMs));
      sharedCounter = snapshot + 1;
    });

  await Promise.all([worker(18), worker(6), worker(12), worker(4), worker(9)]);
  assert.equal(sharedCounter, 5);
});

test('A-03, A-06 & A-10 JarvisDatabase persists per-collection SQLite WAL v4, enforces freezeReads, preserves exact backup imports, and purges demo seeds', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-audit-db-'));
  try {
    const db1 = new JarvisDatabase({
      dataDir: tmpDir,
      debounceMs: 250,
      seedMode: 'demo',
      freezeReads: true,
      registerShutdownHooks: false,
    });

    const initialState = db1.getState();
    assert.equal(initialState.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(initialState.quota5h?.savedByDietTokens5h, 0);

    // A-06: contract-03 (/api/health) starts PENDING without a fabricated SHA-256 hash; contract-02 has real 16-hex SHA-256
    const c2 = initialState.contracts.find((c) => c.id === 'contract-02');
    const c3 = initialState.contracts.find((c) => c.id === 'contract-03');
    assert.ok(c2?.evidenceHash && /^[0-9a-f]{16}$/.test(c2.evidenceHash));
    assert.notEqual(c2?.evidenceHash, 'f31d9902b8e411ca');
    assert.equal(c3?.status, 'PENDING');
    assert.equal(c3?.evidenceHash, undefined);

    // A-03: Mutating deep-frozen getState() outside db.update() throws TypeError
    assert.throws(() => {
      (initialState.goals as unknown as unknown[]).push({ id: 'illegal-direct-mutation' });
    }, TypeError);

    // A-03: Mutating a single collection only marks that 1 collection dirty instead of rewriting all 42 collections
    db1.update((draft) => {
      draft.goals[0].progress = 77;
    });
    const flushedCount = db1.flushSync();
    assert.equal(flushedCount, 1);

    // A-10: replaceAll preserves exact imported memories without re-injecting mem-superseded-09
    const customBackup = structuredClone(db1.getState());
    customBackup.memories = [
      {
        id: 'mem-exact-only-01',
        topic: 'Única Memória Importada',
        content: 'Importação limpa sem injeção lateral.',
        category: 'FACT',
        provenance: 'CONFIRMED',
        confidence: 1,
        tags: ['clean-import'],
        pinned: true,
        sourceUri: 'backup://json',
        simHash: 'a'.repeat(32),
        createdAt: '2026-11-12T00:00:00.000Z',
        updatedAt: '2026-11-12T00:00:00.000Z',
        source: 'REAL',
      },
    ];
    customBackup.graphEdges = [];
    db1.replaceAll(customBackup);
    assert.equal(db1.getState().memories.length, 1);
    assert.equal(db1.getState().memories[0].id, 'mem-exact-only-01');
    assert.ok(!db1.getState().memories.some((m) => m.id === 'mem-superseded-09'));

    db1.close();

    // Reopen from disk and verify v4 per-collection state survived cleanly
    const db2 = new JarvisDatabase({
      dataDir: tmpDir,
      debounceMs: 0,
      registerShutdownHooks: false,
    });
    assert.equal(db2.getState().schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(db2.getState().goals[0].progress, 77);
    assert.equal(db2.getState().memories.length, 1);
    assert.equal(db2.getState().memories[0].id, 'mem-exact-only-01');
    db2.close();

    // Verify purgeDemoSeeds on a fresh demo DB switches to real mode and clears seeded swarm/workflow/memories
    const tmpDemoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-purge-db-'));
    try {
      const dbDemo = new JarvisDatabase({
        dataDir: tmpDemoDir,
        debounceMs: 0,
        seedMode: 'demo',
        registerShutdownHooks: false,
      });
      assert.ok((dbDemo.getState().swarmRuns?.length ?? 0) >= 1);
      const purged = dbDemo.purgeDemoSeeds();
      assert.ok(purged.removedSwarmRuns >= 1);
      assert.ok(purged.removedMemories >= 1);
      assert.equal(dbDemo.getState().seedMode, 'real');
      assert.equal(dbDemo.getState().swarmRuns?.length ?? 0, 0);
      dbDemo.close();
    } finally {
      fs.rmSync(tmpDemoDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('A-01 & A-11 Security Gate enforces loopback default, LAN token policy, log redaction, rate limit, CORS, CSRF, Bearer auth, and A-14 binary upload', async () => {
  // 1. Default bind host is 127.0.0.1
  assert.equal(resolveSafeBindHost(['node', 'server.ts'], {}), '127.0.0.1');
  assert.equal(
    resolveSafeBindHost(['node', 'server.ts', '--host', '0.0.0.0'], {}),
    '0.0.0.0'
  );

  // 2. Unmanaged 0.0.0.0 bind without JARVIS_API_TOKEN refuses to boot
  const unsafeLan = evaluateBindAuthPolicy('0.0.0.0', {});
  assert.equal(unsafeLan.canBoot, false);
  assert.equal(unsafeLan.allowedToBoot, false);

  const safeLanWithToken = evaluateBindAuthPolicy('0.0.0.0', {
    JARVIS_API_TOKEN: 'super-secret-operator-token',
  });
  assert.equal(safeLanWithToken.canBoot, true);
  assert.equal(safeLanWithToken.tokenConfigured, true);

  // 3. Sliding-window rate limiter enforces quota
  const limiter = new SlidingWindowRateLimiter();
  assert.equal(limiter.consume('ip-1', 2, 60_000, 1000).allowed, true);
  assert.equal(limiter.consume('ip-1', 2, 60_000, 1010).allowed, true);
  const thirdTry = limiter.consume('ip-1', 2, 60_000, 1020);
  assert.equal(thirdTry.allowed, false);
  assert.ok(thirdTry.retryAfterSec >= 1);

  // 4. A-11 Log redaction strips Gemini/OpenAI keys, Bearer headers, and JARVIS_API_TOKEN
  const prevToken = process.env.JARVIS_API_TOKEN;
  process.env.JARVIS_API_TOKEN = 'jarvis-top-secret-token-777';
  try {
    const dirtyLog =
      'Auth header Authorization: Bearer abcdef1234567890 token=jarvis-top-secret-token-777 key=sk-proj1234567890abcdefghijklmnop';
    const cleanLog = sanitizeLogText(dirtyLog);
    assert.ok(!cleanLog.includes('abcdef1234567890'));
    assert.ok(!cleanLog.includes('jarvis-top-secret-token-777'));
    assert.ok(!cleanLog.includes('sk-proj123456'));

    // 5. Live Express HTTP verification of Auth, CORS, CSRF, and A-14 Binary Screen endpoint
    const { app } = createJarvisExpressApp({ port: 0, host: '127.0.0.1' });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Public /api/health works without token
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);

      // Unauthenticated /api/backup/export blocked with 401
      const noAuthRes = await fetch(`${baseUrl}/api/backup/export`);
      assert.equal(noAuthRes.status, 401);

      // Wrong token blocked with 401
      const badAuthRes = await fetch(`${baseUrl}/api/backup/export`, {
        headers: { Authorization: 'Bearer wrong-token-000' },
      });
      assert.equal(badAuthRes.status, 401);

      // Valid Bearer token succeeds with 200
      const okAuthRes = await fetch(`${baseUrl}/api/backup/export`, {
        headers: { Authorization: 'Bearer jarvis-top-secret-token-777' },
      });
      assert.equal(okAuthRes.status, 200);
      const exportedJson = (await okAuthRes.json()) as { schemaVersion: number };
      assert.equal(exportedJson.schemaVersion, CURRENT_SCHEMA_VERSION);

      // Disallowed external Origin blocked with 403
      const corsBlockedRes = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'https://malicious.example.com' },
      });
      assert.equal(corsBlockedRes.status, 403);

      // Cross-site mutating request blocked with 403 CSRF guard
      const csrfBlockedRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer jarvis-top-secret-token-777',
          'Content-Type': 'application/json',
          'Sec-Fetch-Site': 'cross-site',
        },
        body: JSON.stringify({ operatorName: 'Intruder' }),
      });
      assert.equal(csrfBlockedRes.status, 403);

      // A-14 Binary raw screen upload works without base64 JSON inflation
      const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      const binRes = await fetch(
        `${baseUrl}/api/screen/analyze-binary?width=1280&height=720&sourceLabel=AuditBinaryTest`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer jarvis-top-secret-token-777',
            'Content-Type': 'image/jpeg',
          },
          body: fakeJpeg,
        }
      );
      assert.equal(binRes.status, 200);
      const binPayload = (await binRes.json()) as { transport: string; byteLength: number };
      assert.equal(binPayload.transport, 'BINARY_RAW');
      assert.equal(binPayload.byteLength, fakeJpeg.byteLength);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    if (prevToken === undefined) {
      delete process.env.JARVIS_API_TOKEN;
    } else {
      process.env.JARVIS_API_TOKEN = prevToken;
    }
  }
});

test('A-09 & §7 CLI --doctor executes cleanly under Node >= 22.6 and outputs structured health report', async () => {
  const cleanEnv: NodeJS.ProcessEnv = {
    ...process.env,
    JARVIS_SKIP_AUTO_LISTEN: '0',
    JARVIS_DEBUG: '0',
  };
  delete cleanEnv.NODE_TEST_CONTEXT;
  const { stdout } = await execFileAsync(process.execPath, ['server.ts', '--doctor'], {
    cwd: process.cwd(),
    env: cleanEnv,
    timeout: 8000,
  });

  const jsonStart = stdout.indexOf('{');
  assert.ok(jsonStart >= 0, 'Expected JSON output from --doctor');
  const report = JSON.parse(stdout.slice(jsonStart)) as {
    healthy: boolean;
    schemaVersion: number;
    checks: Array<{ id: string; status: string }>;
  };
  assert.equal(report.healthy, true);
  assert.equal(report.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.ok(report.checks.some((c) => c.id === 'NODE_RUNTIME' && c.status === 'PASS'));
  assert.ok(report.checks.some((c) => c.id === 'SQLITE_WAL_COLLECTIONS'));
});
