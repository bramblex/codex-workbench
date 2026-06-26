'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  listServers,
  normalizeServer,
  readWorkbenchConfig,
} = require('../src/model/workbench-config');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-workbench-config-'));
const missingConfig = path.join(tmp, 'missing.json');
const invalidJsonConfig = path.join(tmp, 'invalid.json');
const scalarConfig = path.join(tmp, 'scalar.json');

assert.deepStrictEqual(readWorkbenchConfig(missingConfig), {});
assert.deepStrictEqual(listServers({}), []);

assert.deepStrictEqual(normalizeServer({
  target: 'user@example.com',
  label: 'Example',
  sshArgs: ['-p', '2222'],
}, 0), {
  id: 'user-example.com',
  label: 'Example',
  target: 'user@example.com',
  command: 'cwb',
  sshArgs: ['-p', '2222'],
});

assert.deepStrictEqual(listServers({
  servers: [{ host: 'devbox', name: 'Dev Box', command: '/usr/local/bin/cwb' }],
}), [{
  id: 'devbox',
  label: 'Dev Box',
  target: 'devbox',
  command: '/usr/local/bin/cwb',
  sshArgs: [],
}]);

fs.writeFileSync(invalidJsonConfig, '{');
assert.throws(() => readWorkbenchConfig(invalidJsonConfig), /Invalid workbench config JSON/);

fs.writeFileSync(scalarConfig, '[]');
assert.throws(() => readWorkbenchConfig(scalarConfig), /Workbench config must be a JSON object/);

assert.throws(() => listServers({ servers: {} }), /servers must be an array/);
assert.throws(() => normalizeServer(null, 0), /server must be an object/);
assert.throws(() => normalizeServer({}, 0), /target is required/);
assert.throws(() => normalizeServer({ target: 'x', id: 123 }, 0), /id must be a string/);
assert.throws(() => normalizeServer({ target: 'x', sshArgs: '-t' }, 0), /sshArgs must be an array/);
assert.throws(() => normalizeServer({ target: 'x', sshArgs: ['-p', 2222] }, 0), /sshArgs\[1\] must be a string/);
