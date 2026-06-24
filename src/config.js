'use strict';

const os = require('os');
const path = require('path');

const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, '.codex');
const SESSIONS_DIR = process.env.CODEX_SESSIONS_DIR || path.join(CODEX_HOME, 'sessions');
const META_PATH = process.env.CODEX_WORKBENCH_META || process.env.CSM_META || path.join(CODEX_HOME, 'codex-workbench.json');
const CONFIG_PATH = process.env.CODEX_WORKBENCH_CONFIG || path.join(CODEX_HOME, 'codex-workbench.config.json');

module.exports = {
  HOME,
  CODEX_HOME,
  CONFIG_PATH,
  SESSIONS_DIR,
  META_PATH,
};
