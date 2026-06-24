'use strict';

const fs = require('fs');
const { CONFIG_PATH } = require('../config');

function readWorkbenchConfig(file = CONFIG_PATH) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function normalizeServer(server, index) {
  const target = server.target || server.host || '';
  if (!target) return null;
  const id = server.id || target.replace(/[^a-zA-Z0-9_.-]+/g, '-');
  return {
    id,
    label: server.label || server.name || id || `server-${index + 1}`,
    target,
    command: server.command || 'cwb',
    sshArgs: Array.isArray(server.sshArgs) ? server.sshArgs.map(String) : [],
  };
}

function listServers(config = readWorkbenchConfig()) {
  return (Array.isArray(config.servers) ? config.servers : [])
    .map(normalizeServer)
    .filter(Boolean);
}

module.exports = {
  listServers,
  normalizeServer,
  readWorkbenchConfig,
};
