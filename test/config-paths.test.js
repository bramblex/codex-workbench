'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const configModule = path.resolve(__dirname, '..', 'src', 'config.js');

function loadConfig(envPatch) {
  const saved = {
    CWB_HOME: process.env.CWB_HOME,
    CWB_META: process.env.CWB_META,
    CWB_CONFIG: process.env.CWB_CONFIG,
    CODEX_WORKBENCH_META: process.env.CODEX_WORKBENCH_META,
    CODEX_WORKBENCH_CONFIG: process.env.CODEX_WORKBENCH_CONFIG,
    CSM_META: process.env.CSM_META,
    CODEX_HOME: process.env.CODEX_HOME,
  };
  for (const key of Object.keys(saved)) delete process.env[key];
  Object.assign(process.env, envPatch || {});
  delete require.cache[configModule];
  const config = require(configModule);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete require.cache[configModule];
  return config;
}

let config = loadConfig();
assert.strictEqual(config.CWB_HOME, path.join(os.homedir(), '.cwb'));
assert.strictEqual(config.META_PATH, path.join(config.CWB_HOME, 'metadata.json'));
assert.strictEqual(config.CONFIG_PATH, path.join(config.CWB_HOME, 'config.json'));

config = loadConfig({ CWB_HOME: '/tmp/cwb-home' });
assert.strictEqual(config.CWB_HOME, '/tmp/cwb-home');
assert.strictEqual(config.META_PATH, '/tmp/cwb-home/metadata.json');
assert.strictEqual(config.CONFIG_PATH, '/tmp/cwb-home/config.json');

config = loadConfig({
  CWB_HOME: '/tmp/cwb-home',
  CWB_META: '/tmp/meta.json',
  CWB_CONFIG: '/tmp/config.json',
  CODEX_WORKBENCH_META: '/tmp/legacy-meta.json',
  CODEX_WORKBENCH_CONFIG: '/tmp/legacy-config.json',
});
assert.strictEqual(config.META_PATH, '/tmp/meta.json');
assert.strictEqual(config.CONFIG_PATH, '/tmp/config.json');

config = loadConfig({
  CODEX_WORKBENCH_META: '/tmp/legacy-meta.json',
  CODEX_WORKBENCH_CONFIG: '/tmp/legacy-config.json',
});
assert.strictEqual(config.META_PATH, '/tmp/legacy-meta.json');
assert.strictEqual(config.CONFIG_PATH, '/tmp/legacy-config.json');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-workbench-paths-'));
const cwbHome = path.join(tmp, '.cwb');
const codexHome = path.join(tmp, '.codex');
const legacyMeta = path.join(codexHome, 'codex-workbench.json');
const legacyConfig = path.join(codexHome, 'codex-workbench.config.json');

fs.mkdirSync(codexHome, { recursive: true });
fs.writeFileSync(legacyMeta, '{"sessions":{}}\n');
fs.writeFileSync(legacyConfig, '{"servers":[]}\n');

config = loadConfig({
  CWB_HOME: cwbHome,
  CODEX_HOME: codexHome,
});

assert.strictEqual(config.META_PATH, path.join(cwbHome, 'metadata.json'));
assert.strictEqual(config.CONFIG_PATH, path.join(cwbHome, 'config.json'));
assert.strictEqual(fs.existsSync(config.META_PATH), true);
assert.strictEqual(fs.existsSync(config.CONFIG_PATH), true);
assert.strictEqual(fs.existsSync(legacyMeta), false);
assert.strictEqual(fs.existsSync(legacyConfig), false);

fs.writeFileSync(legacyMeta, '{"sessions":{"old":{}}}\n');
fs.writeFileSync(config.META_PATH, '{"sessions":{"new":{}}}\n');
config = loadConfig({
  CWB_HOME: cwbHome,
  CODEX_HOME: codexHome,
});
assert.strictEqual(fs.existsSync(legacyMeta), true);
assert.strictEqual(fs.readFileSync(config.META_PATH, 'utf8'), '{"sessions":{"new":{}}}\n');
