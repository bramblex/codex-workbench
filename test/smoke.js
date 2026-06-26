'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'src', 'cli.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-workbench-smoke-'));
const codexHome = path.join(tmp, '.codex');
const sessionsDir = path.join(codexHome, 'sessions', '2026', '06');
const piSessionsDir = path.join(tmp, '.pi', 'agent', 'sessions');
const sessionFile = path.join(sessionsDir, 'rollout-2026-06-22T00-00-00-abcdef1234567890.jsonl');
const deleteFileSession = path.join(sessionsDir, 'rollout-2026-06-22T00-00-01-fedcba0987654321.jsonl');
const piSessionFile = path.join(piSessionsDir, '2026-06-22T00-00-02_pi123.jsonl');
const fakeBinDir = path.join(tmp, 'bin');
const fakeCodex = path.join(fakeBinDir, 'codex');
const fakePi = path.join(fakeBinDir, 'pi');
const failingCodex = path.join(fakeBinDir, 'failing-codex');
const fakeCodexLog = path.join(tmp, 'codex-argv.log');
const fakePiLog = path.join(tmp, 'pi-argv.log');
const fakeShell = path.join(fakeBinDir, 'shell');

fs.mkdirSync(sessionsDir, { recursive: true });
fs.mkdirSync(piSessionsDir, { recursive: true });
fs.mkdirSync(fakeBinDir, { recursive: true });
fs.writeFileSync(fakeCodex, `#!/bin/sh
printf '%s\\n' "$@" > "${fakeCodexLog}"
exit 0
`);
fs.chmodSync(fakeCodex, 0o755);
fs.writeFileSync(fakePi, `#!/bin/sh
printf '%s\\n' "$@" > "${fakePiLog}"
exit 0
`);
fs.chmodSync(fakePi, 0o755);
fs.writeFileSync(failingCodex, '#!/bin/sh\nexit 7\n');
fs.chmodSync(failingCodex, 0o755);
fs.writeFileSync(fakeShell, `#!/bin/sh
case "$2" in
  "command -v 'codex'") printf '%s\\n' "${fakeCodex}" ;;
  *) /bin/sh -c "$2" ;;
esac
`);
fs.chmodSync(fakeShell, 0o755);
fs.writeFileSync(sessionFile, [
  JSON.stringify({
    type: 'session_meta',
    payload: {
      id: 'abcdef1234567890',
      timestamp: '2026-06-22T00:00:00.000Z',
      cwd: root,
      cli_version: '0.0.0-test',
    },
  }),
  JSON.stringify({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Fix the project' }],
    },
  }),
  JSON.stringify({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Done' }],
    },
  }),
].join('\n') + '\n');
fs.writeFileSync(deleteFileSession, [
  JSON.stringify({
    type: 'session_meta',
    payload: {
      id: 'fedcba0987654321',
      timestamp: '2026-06-22T00:00:01.000Z',
      cwd: root,
      cli_version: '0.0.0-test',
    },
  }),
  JSON.stringify({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Broken session' }],
    },
  }),
].join('\n') + '\n');
fs.writeFileSync(piSessionFile, [
  JSON.stringify({
    type: 'session',
    version: 3,
    id: 'pi123',
    timestamp: '2026-06-22T00:00:02.000Z',
    cwd: root,
  }),
  JSON.stringify({
    type: 'message',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Pi prompt' }],
    },
  }),
].join('\n') + '\n');

function run(args, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_WORKBENCH_META: path.join(codexHome, 'meta.json'),
      PI_CODING_AGENT_DIR: path.join(tmp, '.pi', 'agent'),
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

let result = run(['list', '--json']);
assert.strictEqual(result.status, 0, result.stderr);
const sessions = JSON.parse(result.stdout);
assert.strictEqual(sessions.length, 3);
const mainSession = sessions.find((session) => session.id === 'abcdef1234567890');
assert.ok(mainSession);
assert.strictEqual(mainSession.first, 'Fix the project');
assert.ok(Array.isArray(mainSession.messages));

result = run(['list', '--json', '--compact']);
assert.strictEqual(result.status, 0, result.stderr);
const compactSessions = JSON.parse(result.stdout);
const compactSession = compactSessions.find((session) => session.id === 'abcdef1234567890');
assert.ok(compactSession);
assert.strictEqual(compactSession.first, 'Fix the project');
assert.strictEqual(Object.prototype.hasOwnProperty.call(compactSession, 'messages'), false);

result = run(['backends', '--json']);
assert.strictEqual(result.status, 0, result.stderr);
const backends = JSON.parse(result.stdout);
assert.ok(backends.some((backend) => backend.id === 'codex'));
assert.ok(backends.some((backend) => backend.id === 'pi'));

result = run(['show', 'abcdef']);
assert.strictEqual(result.status, 0, result.stderr);
assert.match(result.stdout, /id:\s+abcdef1234567890/);
assert.match(result.stdout, /U: Fix the project/);

result = run(['show']);
assert.strictEqual(result.status, 1);
assert.match(result.stderr, /Missing session/);

result = run(['list', '--cwd']);
assert.strictEqual(result.status, 1);
assert.match(result.stderr, /--cwd requires a directory/);

const dirsRoot = path.join(tmp, 'dirs-root');
fs.mkdirSync(path.join(dirsRoot, 'child'), { recursive: true });
result = run(['dirs', '--cwd', dirsRoot, '--json']);
assert.strictEqual(result.status, 0, result.stderr);
let dirsPayload = JSON.parse(result.stdout);
assert.strictEqual(dirsPayload.cwd, dirsRoot);
assert.deepStrictEqual(dirsPayload.entries, [{ name: 'child', path: path.join(dirsRoot, 'child') }]);

result = run(['mkdir', '--cwd', dirsRoot, '--json', 'new-child']);
assert.strictEqual(result.status, 0, result.stderr);
dirsPayload = JSON.parse(result.stdout);
assert.strictEqual(dirsPayload.path, path.join(dirsRoot, 'new-child'));
assert.strictEqual(fs.statSync(dirsPayload.path).isDirectory(), true);

result = run(['list', '--json']);
assert.strictEqual(result.status, 0, result.stderr);
assert.strictEqual(JSON.parse(result.stdout).length, 3);
result = run(['list', '--json', '--all']);
assert.strictEqual(result.status, 0, result.stderr);
let allSessions = JSON.parse(result.stdout);
assert.strictEqual(allSessions.length, 3);

result = run(['archive', 'pi123']);
assert.strictEqual(result.status, 0, result.stderr);
result = run(['list', '--json']);
assert.strictEqual(result.status, 0, result.stderr);
assert.strictEqual(JSON.parse(result.stdout).some((session) => session.id === 'pi123'), false);
result = run(['list', '--json', '--all']);
assert.strictEqual(result.status, 0, result.stderr);
allSessions = JSON.parse(result.stdout);
assert.strictEqual(allSessions.find((session) => session.id === 'pi123').archived, true);
result = run(['unarchive', 'pi123']);
assert.strictEqual(result.status, 0, result.stderr);
result = run(['list', '--json']);
assert.strictEqual(result.status, 0, result.stderr);
assert.strictEqual(JSON.parse(result.stdout).some((session) => session.id === 'pi123'), true);

result = run(['delete', 'fedcba', '--file']);
assert.strictEqual(result.status, 0, result.stderr);
assert.strictEqual(fs.existsSync(deleteFileSession), false);
result = run(['list', '--json', '--all']);
assert.strictEqual(result.status, 0, result.stderr);
assert.strictEqual(JSON.parse(result.stdout).some((session) => session.id === 'fedcba0987654321'), false);

result = run(['archive', 'abcdef'], {
  CODEX_BIN: fakeCodex,
});
assert.strictEqual(result.status, 0, result.stderr);
assert.deepStrictEqual(fs.readFileSync(fakeCodexLog, 'utf8').trim().split(/\r?\n/), [
  'archive',
  'abcdef1234567890',
]);

fs.rmSync(fakeCodexLog, { force: true });
result = run(['new', '--cwd', tmp, 'hello'], {
  CODEX_BIN: fakeCodex,
});
assert.strictEqual(result.status, 0, result.stderr);
assert.deepStrictEqual(fs.readFileSync(fakeCodexLog, 'utf8').trim().split(/\r?\n/), [
  'hello',
]);

result = run(['new', '--cwd', tmp, '--backend', 'pi', 'hello pi'], {
  PI_BIN: fakePi,
});
assert.strictEqual(result.status, 0, result.stderr);
assert.deepStrictEqual(fs.readFileSync(fakePiLog, 'utf8').trim().split(/\r?\n/), [
  '-p',
  'hello pi',
]);

result = run(['new', '--backend', 'missing']);
assert.strictEqual(result.status, 1);
assert.match(result.stderr, /Unknown backend: missing/);

fs.rmSync(fakeCodexLog, { force: true });
result = run(['fork', 'abcdef'], {
  CODEX_BIN: fakeCodex,
});
assert.strictEqual(result.status, 0, result.stderr);
assert.deepStrictEqual(fs.readFileSync(fakeCodexLog, 'utf8').trim().split(/\r?\n/), [
  'fork',
  'abcdef1234567890',
]);

fs.rmSync(fakeCodexLog, { force: true });
result = run(['archive', 'abcdef'], {
  CODEX_BIN: '',
  PATH: fakeBinDir,
  SHELL: '/bin/sh',
});
assert.strictEqual(result.status, 0, result.stderr);
assert.deepStrictEqual(fs.readFileSync(fakeCodexLog, 'utf8').trim().split(/\r?\n/), [
  'archive',
  'abcdef1234567890',
]);

result = run(['doctor'], {
  CODEX_BIN: '',
  PATH: '',
  SHELL: fakeShell,
  PI_CODING_AGENT_DIR: path.join(tmp, '.pi', 'agent'),
});
assert.strictEqual(result.status, 0, result.stderr);
assert.match(result.stdout, /Backends detected/);
assert.match(result.stdout, new RegExp(`binary:\\s+${fakeCodex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

fs.rmSync(fakeCodexLog, { force: true });
result = run(['archive', 'abcdef'], {
  CODEX_BIN: '',
  PATH: '',
  SHELL: fakeShell,
});
assert.strictEqual(result.status, 0, result.stderr);
assert.deepStrictEqual(fs.readFileSync(fakeCodexLog, 'utf8').trim().split(/\r?\n/), [
  'archive',
  'abcdef1234567890',
]);

result = run(['archive', 'abcdef'], { CODEX_BIN: path.join(tmp, 'missing-codex') });
assert.strictEqual(result.status, 1);
assert.match(result.stderr, /CODEX_BIN is not executable/);

result = run(['archive', 'abcdef'], { CODEX_BIN: failingCodex });
assert.strictEqual(result.status, 7);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const binPath of Object.values(pkg.bin)) {
  assert.ok(fs.existsSync(path.join(root, binPath)), `missing bin target: ${binPath}`);
}
