'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  findOnPath,
  findWithShell,
  resolveCodexBin,
} = require('../src/codex-bin');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bin-test-'));
const binDir = path.join(tmp, 'bin');
const shellDir = path.join(tmp, 'shell');
const fallbackDir = path.join(tmp, 'fallback');
fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(shellDir, { recursive: true });
fs.mkdirSync(fallbackDir, { recursive: true });

function writeExecutable(file, body) {
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

const fakeCodex = path.join(binDir, 'codex');
writeExecutable(fakeCodex, '#!/bin/sh\nexit 0\n');

const fakeShell = path.join(shellDir, 'fake-shell');
writeExecutable(fakeShell, `#!/bin/sh
printf '%s\\n' "$*" > ${path.join(tmp, 'shell-args.log')}
printf '%s\\n' "$PATH" > ${path.join(tmp, 'shell-path.log')}
printf '%s\\n' "${fakeCodex}"
`);

const interactiveOnlyShell = path.join(shellDir, 'interactive-only-shell');
writeExecutable(interactiveOnlyShell, `#!/bin/sh
case "$1" in
  -lc) exit 1 ;;
  -ic) printf 'startup noise\\n%s\\n' "${fakeCodex}" ;;
esac
`);

assert.strictEqual(findOnPath('codex', binDir), fakeCodex);
assert.strictEqual(findOnPath('codex', path.join(tmp, 'missing')), null);

const shellEnv = {
  PATH: '',
  SHELL: fakeShell,
};
assert.strictEqual(findWithShell('codex', shellEnv), fakeCodex);
assert.match(fs.readFileSync(path.join(tmp, 'shell-args.log'), 'utf8'), /-lc command -v 'codex'/);

assert.strictEqual(findWithShell('codex', {
  PATH: '',
  SHELL: interactiveOnlyShell,
}), fakeCodex);

assert.strictEqual(resolveCodexBin({
  env: shellEnv,
  fallbackPath: null,
}), fakeCodex);

const processPathCodex = path.join(tmp, 'process-path-codex');
fs.mkdirSync(processPathCodex);
const processPathBin = path.join(processPathCodex, 'codex');
writeExecutable(processPathBin, '#!/bin/sh\nexit 0\n');
assert.strictEqual(resolveCodexBin({
  env: {
    PATH: processPathCodex,
    SHELL: path.join(tmp, 'missing-shell'),
  },
  fallbackPath: null,
}), processPathBin);

const fallbackCodex = path.join(fallbackDir, 'codex');
writeExecutable(fallbackCodex, '#!/bin/sh\nexit 0\n');
assert.strictEqual(resolveCodexBin({
  env: {
    PATH: '',
    SHELL: path.join(tmp, 'missing-shell'),
  },
  fallbackPath: fallbackCodex,
}), fallbackCodex);

assert.strictEqual(resolveCodexBin({
  env: {
    CODEX_BIN: fakeCodex,
    PATH: '',
    SHELL: path.join(tmp, 'missing-shell'),
  },
  fallbackPath: null,
}), fakeCodex);

assert.throws(() => resolveCodexBin({
  env: {
    CODEX_BIN: path.join(tmp, 'missing-codex'),
    PATH: binDir,
    SHELL: fakeShell,
  },
  fallbackPath: fallbackCodex,
}), /CODEX_BIN is not executable/);

assert.throws(() => resolveCodexBin({
  env: {
    PATH: '',
    SHELL: path.join(tmp, 'missing-shell'),
  },
  fallbackPath: null,
}), /Could not find the codex executable/);
