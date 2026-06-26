'use strict';

const fs = require('fs');
const { CONFIG_PATH } = require('../config');

function readWorkbenchConfig(file = CONFIG_PATH) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`Workbench config must be a JSON object: ${file}`);
    }
    return data;
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    if (err instanceof SyntaxError) throw new Error(`Invalid workbench config JSON: ${file}`);
    throw err;
  }
}

function configError(index, message) {
  return new Error(`Invalid server config at servers[${index}]: ${message}`);
}

function stringField(value, field, index, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw configError(index, `${field} is required`);
    return '';
  }
  if (typeof value !== 'string') throw configError(index, `${field} must be a string`);
  return value;
}

function normalizeSshArgs(value, index) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw configError(index, 'sshArgs must be an array');
  return value.map((item, argIndex) => {
    if (typeof item !== 'string') {
      throw configError(index, `sshArgs[${argIndex}] must be a string`);
    }
    return item;
  });
}

function normalizeServer(server, index) {
  if (!server || typeof server !== 'object' || Array.isArray(server)) {
    throw configError(index, 'server must be an object');
  }
  const target = stringField(server.target || server.host, 'target', index, true);
  const id = stringField(server.id, 'id', index) || target.replace(/[^a-zA-Z0-9_.-]+/g, '-');
  const label = stringField(server.label || server.name, 'label', index) || id || `server-${index + 1}`;
  const command = stringField(server.command, 'command', index) || 'cwb';
  const sshArgs = normalizeSshArgs(server.sshArgs, index);
  return {
    id,
    label,
    target,
    command,
    sshArgs,
  };
}

function listServers(config = readWorkbenchConfig()) {
  if (config.servers === undefined) return [];
  if (!Array.isArray(config.servers)) {
    throw new Error('Invalid workbench config: servers must be an array');
  }
  return config.servers.map(normalizeServer);
}

module.exports = {
  listServers,
  normalizeServer,
  readWorkbenchConfig,
};
