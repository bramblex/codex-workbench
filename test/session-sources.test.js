'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-workbench-sources-'));
const codexHome = path.join(tmp, '.codex');
const binDir = path.join(tmp, 'bin');
const configPath = path.join(codexHome, 'codex-workbench.config.json');
const sshLog = path.join(tmp, 'ssh.log');

fs.mkdirSync(codexHome, { recursive: true });
fs.mkdirSync(binDir, { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({
  servers: [
    {
      id: 'a',
      label: 'A server',
      target: 'server-a',
      command: 'cwb',
    },
  ],
}, null, 2));

fs.writeFileSync(path.join(binDir, 'ssh'), `#!/bin/sh
printf '<call>' >> '${sshLog}'
for arg do
  printf '\\t%s' "$arg" >> '${sshLog}'
done
printf '\\n' >> '${sshLog}'

last=''
for arg do
  last="$arg"
done

case "$last" in
  *"'list'"*"'--json'"*"'--compact'"*)
    printf '%s\\n' '[{"id":"remote-123","cwd":"/srv/app","updatedAt":"2026-06-24T00:00:00.000Z","startedAt":"2026-06-24T00:00:00.000Z","turns":1,"first":"remote prompt","last":"remote prompt","lastAssistant":"remote answer","messages":[]}]'
    ;;
  *"'dirs'"*"'--json'"*)
    printf '%s\\n' '{"cwd":"/srv/app","entries":[{"name":"src","path":"/srv/app/src"}]}'
    ;;
  *"'mkdir'"*"'--json'"*)
    printf '%s\\n' '{"path":"/srv/app/new-dir"}'
    ;;
  *"'backends'"*"'--json'"*)
    printf '%s\\n' '[{"id":"codex","label":"Codex"},{"id":"pi","label":"pi"}]'
    ;;
esac
exit 0
`);
fs.chmodSync(path.join(binDir, 'ssh'), 0o755);

process.env.CODEX_HOME = codexHome;
process.env.CODEX_WORKBENCH_CONFIG = configPath;
process.env.CODEX_WORKBENCH_META = path.join(codexHome, 'meta.json');
process.env.PI_CODING_AGENT_DIR = path.join(tmp, '.pi', 'agent');
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;

const {
  createSourceDirectory,
  listSourceDirectories,
  listSourceBackends,
  loadRemoteSourceSessions,
  loadWorkbenchSessions,
  runSourceNewSession,
  runSourceSessionCommand,
  updateSourceMetadata,
} = require('../src/services/session-sources');

const state = loadWorkbenchSessions();
assert.strictEqual(state.errors.length, 0);
assert.strictEqual(state.sources.length, 2);

const source = state.sources.find((item) => item.id === 'a');
assert.ok(source);
assert.strictEqual(source.remote, true);

const session = state.sessions.find((item) => item.id === 'remote-123');
assert.ok(session);
assert.strictEqual(session.sourceId, 'a');
assert.strictEqual(session.sourceLabel, 'A server');
assert.strictEqual(session.sourceRemote, true);

const dirs = listSourceDirectories(source, '/srv/app');
assert.strictEqual(dirs.cwd, '/srv/app');
assert.deepStrictEqual(dirs.entries, [{ name: 'src', path: '/srv/app/src' }]);

assert.strictEqual(createSourceDirectory(source, '/srv/app', 'new-dir'), '/srv/app/new-dir');
assert.deepStrictEqual(listSourceBackends(source), [
  { id: 'codex', label: 'Codex' },
  { id: 'pi', label: 'pi' },
]);
assert.strictEqual(updateSourceMetadata(session, { name: 'Named remote' }), 0);
assert.strictEqual(runSourceSessionCommand(session, 'resume', ['hello']), 0);
assert.strictEqual(runSourceNewSession(source, '/srv/app', ['start here'], 'pi'), 0);

const log = fs.readFileSync(sshLog, 'utf8');
assert.match(log, /\tserver-a\t'cwb' 'list' '--json' '--compact'/);
assert.match(log, /\tserver-a\t'cwb' 'dirs' '--cwd' '\/srv\/app' '--json'/);
assert.match(log, /\tserver-a\t'cwb' 'mkdir' '--cwd' '\/srv\/app' '--json' 'new-dir'/);
assert.match(log, /\tserver-a\t'cwb' 'backends' '--json'/);
assert.match(log, /\tserver-a\t'cwb' 'rename' 'remote-123' 'Named remote'/);
assert.match(log, /\t-t\tserver-a\t'cwb' 'resume' 'remote-123' 'hello'/);
assert.match(log, /\t-t\tserver-a\t'cwb' 'new' '--cwd' '\/srv\/app' '--backend' 'pi' 'start here'/);

loadRemoteSourceSessions(source)
  .then((remoteSessions) => {
    assert.strictEqual(remoteSessions.length, 1);
    assert.strictEqual(remoteSessions[0].sourceId, 'a');
    assert.strictEqual(remoteSessions[0].first, 'remote prompt');
    const asyncLog = fs.readFileSync(sshLog, 'utf8');
    assert.match(asyncLog, /\tserver-a\t'cwb' 'list' '--json' '--compact'/);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
