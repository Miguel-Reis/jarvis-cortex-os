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
import {
  getServerApiKeysStatus,
  loadDotEnvIntoProcess,
  sanitizeApiKeyInput,
  updateServerApiKeys,
} from './api-keys-manager';
import { CURRENT_SCHEMA_VERSION, db, JarvisDatabase } from './db';
import { sanitizeLogText } from './debug-logger';
import { AGENT_TOOL_DECLARATIONS } from './gemini-engine';
import { enqueueApprovalRequest } from './os-adapter';
import {
  evaluateBindAuthPolicy,
  resolveSafeBindHost,
  SlidingWindowRateLimiter,
} from './security-gate';
import { LIVE_VOICE_TOOL_DECLARATIONS } from './voice-live-bridge';
import { GENERAL_CHAT_PROJECT_ID } from '../shared/types.ts';
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

test('Isolated Server API Keys Manager sanitizes input, hot-reloads runtime env, preserves .env comments, and clears safely', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-apikeys-'));
  const tmpDotEnv = path.join(tmpDir, '.env');
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevOpenRouter = process.env.OPENROUTER_API_KEY;

  try {
    fs.writeFileSync(tmpDotEnv, '# Existing Jarvis Env\nPORT=3000\n', 'utf-8');

    // Prevent newline injection
    assert.equal(sanitizeApiKeyInput('  "AIzaTest\r\nMALICIOUS=1"  '), 'AIzaTestMALICIOUS=1');

    const statusSet = updateServerApiKeys(
      {
        geminiApiKey: 'AIzaSyIsolatedTestKey1234567890ABCD',
        openRouterApiKey: 'sk-or-v1-isolatedtest987654',
        persistToDotEnv: true,
      },
      tmpDotEnv
    );

    assert.equal(statusSet.geminiConfigured, true);
    assert.equal(statusSet.geminiKeySource, 'DOTENV');
    assert.ok(
      statusSet.geminiMaskedKey && !statusSet.geminiMaskedKey.includes('IsolatedTestKey')
    );
    assert.equal(statusSet.openRouterConfigured, true);
    assert.equal(process.env.GEMINI_API_KEY, 'AIzaSyIsolatedTestKey1234567890ABCD');

    const dotEnvBody = fs.readFileSync(tmpDotEnv, 'utf-8');
    assert.ok(dotEnvBody.includes('# Existing Jarvis Env'));
    assert.ok(dotEnvBody.includes('PORT=3000'));
    assert.ok(dotEnvBody.includes('GEMINI_API_KEY=AIzaSyIsolatedTestKey1234567890ABCD'));

    // Clearing key removes it from runtime, removes from .env, and prevents reload resurrection
    const statusCleared = updateServerApiKeys(
      { clearGeminiKey: true, clearOpenRouterKey: true, persistToDotEnv: true },
      tmpDotEnv
    );
    assert.equal(statusCleared.geminiConfigured, false);
    assert.equal(statusCleared.geminiKeySource, 'NONE');
    assert.equal(process.env.GEMINI_API_KEY, undefined);

    loadDotEnvIntoProcess(tmpDotEnv);
    assert.equal(process.env.GEMINI_API_KEY, undefined);

    const freshStatus = getServerApiKeysStatus(tmpDotEnv);
    assert.equal(freshStatus.geminiConfigured, false);
  } finally {
    if (prevGemini === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      updateServerApiKeys({ geminiApiKey: prevGemini, persistToDotEnv: false }, tmpDotEnv);
    }
    if (prevOpenRouter === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      updateServerApiKeys({ openRouterApiKey: prevOpenRouter, persistToDotEnv: false }, tmpDotEnv);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Live Voice Principal Agent exposes all 22 jarvis-os tools without subset restrictions', () => {
  assert.ok(LIVE_VOICE_TOOL_DECLARATIONS.length >= 22);
  assert.equal(LIVE_VOICE_TOOL_DECLARATIONS.length, AGENT_TOOL_DECLARATIONS.length);

  const toolNames = new Set(LIVE_VOICE_TOOL_DECLARATIONS.map((t) => t.name));
  for (const requiredTool of [
    'get_jarvis_os_full_state',
    'manage_jarvis_projects_and_chats',
    'manage_jarvis_operations',
    'write_workspace_file_governed',
    'query_python_jarvis_cortex',
    'request_shell_approval',
    'sidecar_host_control',
    'dispatch_swarm_48x',
  ]) {
    assert.ok(toolNames.has(requiredTool), `Missing Live Voice tool: ${requiredTool}`);
  }
});

test('General Chat (__general__), API keys status masking, and Sub-Agent real-time authorization flow work end-to-end', async () => {
  const initialSnapshot = structuredClone(db.getState());
  const prevToken = process.env.JARVIS_API_TOKEN;
  delete process.env.JARVIS_API_TOKEN;

  const { app } = createJarvisExpressApp({ port: 0, host: '127.0.0.1' });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Bootstrap includes seeded unlinked General Chat
    const bootRes = await fetch(`${baseUrl}/api/bootstrap`);
    assert.equal(bootRes.status, 200);
    const bootJson = (await bootRes.json()) as {
      state: {
        chatThreads: Array<{ id: string; projectId: string; isGeneral?: boolean }>;
        goals: unknown[];
      };
    };
    const seededGeneral = bootJson.state.chatThreads.find((c) => c.id === 'chat-general-main');
    assert.ok(seededGeneral, 'Expected default chat-general-main in bootstrap');
    assert.equal(seededGeneral?.projectId, GENERAL_CHAT_PROJECT_ID);
    assert.equal(seededGeneral?.isGeneral, true);

    // 2. Creating a second General Chat activates __general__ cleanly
    const createGenRes = await fetch(`${baseUrl}/api/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isGeneral: true, title: 'Chat Livre de Arquitetura' }),
    });
    assert.equal(createGenRes.status, 200);
    const createdGen = (await createGenRes.json()) as {
      chat: { id: string; projectId: string; isGeneral?: boolean };
    };
    assert.equal(createdGen.chat.projectId, GENERAL_CHAT_PROJECT_ID);
    assert.equal(createdGen.chat.isGeneral, true);

    // 3. Sending a message in General Chat succeeds deterministically without altering Goals
    db.update((draft) => {
      draft.settings.modelProvider = 'LOCAL_DETERMINISTIC';
    });
    const goalsBefore = db.getState().goals.length;
    const sendRes = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: 'room-exec',
        projectId: GENERAL_CHAT_PROJECT_ID,
        chatId: createdGen.chat.id,
        content: 'Conversa livre: faz um resumo rápido.',
      }),
    });
    assert.equal(sendRes.status, 200);
    assert.equal(db.getState().goals.length, goalsBefore);

    // 4. GET /api/settings/api-keys never returns raw secret strings
    const keysRes = await fetch(`${baseUrl}/api/settings/api-keys`);
    assert.equal(keysRes.status, 200);
    const keysStatus = (await keysRes.json()) as {
      geminiConfigured: boolean;
      geminiMaskedKey: string | null;
    };
    assert.equal(typeof keysStatus.geminiConfigured, 'boolean');
    if (keysStatus.geminiMaskedKey) {
      assert.ok(keysStatus.geminiMaskedKey.includes('•'));
    }

    // 5. Enqueuing a Sub-Agent ApprovalRequest and deciding via /api/approvals/:id/decide
    const queued = enqueueApprovalRequest({
      id: `appr-test-${Date.now()}`,
      title: 'Escrita Sub-Agente em src/demo.ts',
      commandOrAction: 'write_workspace_file_governed("src/demo.ts")',
      riskLevel: 'MEDIUM',
      source: 'SUBAGENT',
      actorName: 'Frontend Specialist',
      agentId: 'room-sub-ui',
      agentCallsign: 'SUB-UI',
      isSubagent: true,
      projectId: 'proj-jarvis-core',
      chatId: 'chat-web-main',
      status: 'PENDING',
      requestedAt: new Date().toISOString(),
    });
    assert.equal(queued.isSubagent, true);

    const decideRes = await fetch(`${baseUrl}/api/approvals/${queued.id}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'BLOCKED' }),
    });
    assert.equal(decideRes.status, 200);
    const decided = db.getState().approvals.find((a) => a.id === queued.id);
    assert.equal(decided?.status, 'BLOCKED');
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.replaceAll(initialSnapshot);
    db.flushSync({ writeJsonMirror: true });
    if (prevToken !== undefined) {
      process.env.JARVIS_API_TOKEN = prevToken;
    } else {
      delete process.env.JARVIS_API_TOKEN;
    }
  }
});
