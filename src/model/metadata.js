'use strict';

const fs = require('fs');
const path = require('path');
const { META_PATH } = require('../config');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function loadMeta() {
  const data = readJson(META_PATH, { sessions: {} });
  if (!data.sessions) data.sessions = {};
  return data;
}

function updateMetadata(session, patch) {
  const meta = loadMeta();
  meta.sessions[session.id] = { ...(meta.sessions[session.id] || {}), ...patch };
  meta.updatedAt = new Date().toISOString();
  writeJson(META_PATH, meta);
}

function removeMetadata(session) {
  const meta = loadMeta();
  delete meta.sessions[session.id];
  meta.updatedAt = new Date().toISOString();
  writeJson(META_PATH, meta);
}

module.exports = {
  loadMeta,
  removeMetadata,
  updateMetadata,
};
