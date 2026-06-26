'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();

// Codex paths (backward compatible env vars)
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, '.codex');
const CODEX_SESSIONS_DIR = process.env.CODEX_SESSIONS_DIR || path.join(CODEX_HOME, 'sessions');

// Workbench-owned paths. Keep separate from provider-owned directories.
const CWB_HOME = process.env.CWB_HOME || path.join(HOME, '.cwb');

// pi coding agent paths
const PI_CODING_AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(HOME, '.pi', 'agent');
const PI_SESSIONS_DIR = process.env.PI_CODING_AGENT_SESSION_DIR || path.join(PI_CODING_AGENT_DIR, 'sessions');

function migrateLegacyFile(legacyPath, nextPath) {
  if (!legacyPath || !nextPath || legacyPath === nextPath) return;
  if (fs.existsSync(nextPath) || !fs.existsSync(legacyPath)) return;
  fs.mkdirSync(path.dirname(nextPath), { recursive: true });
  fs.renameSync(legacyPath, nextPath);
}

const LEGACY_META_PATH = path.join(CODEX_HOME, 'codex-workbench.json');
const LEGACY_CONFIG_PATH = path.join(CODEX_HOME, 'codex-workbench.config.json');

const META_PATH = process.env.CWB_META ||
  process.env.CODEX_WORKBENCH_META ||
  process.env.CSM_META ||
  path.join(CWB_HOME, 'metadata.json');

const CONFIG_PATH = process.env.CWB_CONFIG ||
  process.env.CODEX_WORKBENCH_CONFIG ||
  path.join(CWB_HOME, 'config.json');

if (!process.env.CWB_META && !process.env.CODEX_WORKBENCH_META && !process.env.CSM_META) {
  migrateLegacyFile(LEGACY_META_PATH, META_PATH);
}
if (!process.env.CWB_CONFIG && !process.env.CODEX_WORKBENCH_CONFIG) {
  migrateLegacyFile(LEGACY_CONFIG_PATH, CONFIG_PATH);
}

module.exports = {
  HOME,
  CWB_HOME,
  CODEX_HOME,
  CODEX_SESSIONS_DIR,
  LEGACY_CONFIG_PATH,
  LEGACY_META_PATH,
  PI_CODING_AGENT_DIR,
  PI_SESSIONS_DIR,
  CONFIG_PATH,
  SESSIONS_DIR: CODEX_SESSIONS_DIR, // backward compat: default sessions dir (legacy)
  META_PATH,
};
