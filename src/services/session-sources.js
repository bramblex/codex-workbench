'use strict';

const path = require('path');
const { createChildDirectory, listDirectories } = require('../model/directories');
const { listSessions, updateMetadata } = require('../model/session-store');
const { listServers } = require('../model/workbench-config');
const { runCodexCommand, runNewCodexSession, usableCwd } = require('./codex-runner');
const { runRemoteCwb, runRemoteCwbJson } = require('./ssh-runner');

const LOCAL_SOURCE = {
  id: 'local',
  label: 'Local',
  type: 'local',
  remote: false,
};

function sourceForServer(server) {
  return {
    ...server,
    type: 'ssh',
    remote: true,
  };
}

function sourceKey(sourceId, id) {
  return `${sourceId}:${id}`;
}

function attachSource(session, source) {
  return {
    ...session,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    sourceRemote: source.remote,
    sourceKey: sourceKey(source.id, session.id),
  };
}

function configuredSources() {
  return [LOCAL_SOURCE, ...listServers().map(sourceForServer)];
}

function loadWorkbenchSessions() {
  const sources = configuredSources();
  const sessions = listSessions().map((session) => attachSource(session, LOCAL_SOURCE));
  const errors = [];

  for (const source of sources.filter((candidate) => candidate.remote)) {
    try {
      const remoteSessions = runRemoteCwbJson(source, ['list', '--json']);
      if (!Array.isArray(remoteSessions)) throw new Error('remote list did not return an array');
      sessions.push(...remoteSessions.map((session) => attachSource(session, source)));
    } catch (err) {
      errors.push({ source, error: err.message });
    }
  }

  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return { errors, sessions, sources };
}

function sourceById(sources, sourceId) {
  return sources.find((source) => source.id === sourceId) || LOCAL_SOURCE;
}

function configuredSourceOrThrow(sourceId) {
  const source = configuredSources().find((candidate) => candidate.id === sourceId);
  if (!source) throw new Error(`Remote source is not configured: ${sourceId}`);
  return source;
}

function resultStatus(result) {
  return typeof result.status === 'number' ? result.status : 1;
}

function runSourceSessionCommand(session, command, args = []) {
  if (!session.sourceRemote) return runCodexCommand(command, session, args);
  const source = configuredSourceOrThrow(session.sourceId);
  const tty = command === 'resume' || command === 'fork';
  const result = runRemoteCwb(source, [command, session.id, ...args], { tty });
  if (result.error) throw result.error;
  const status = resultStatus(result);
  process.exitCode = status;
  return status;
}

function runSourceNewSession(source, cwd, args = []) {
  if (!source || !source.remote) return runNewCodexSession(cwd, args);
  const result = runRemoteCwb(source, ['new', '--cwd', cwd, ...args], { tty: true });
  if (result.error) throw result.error;
  const status = resultStatus(result);
  process.exitCode = status;
  return status;
}

function updateSourceMetadata(session, patch) {
  if (!session.sourceRemote) {
    updateMetadata(session, patch);
    return 0;
  }
  const source = configuredSourceOrThrow(session.sourceId);
  let result = null;
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    result = runRemoteCwb(source, ['rename', session.id, patch.name || '']);
  } else if (Object.prototype.hasOwnProperty.call(patch, 'note')) {
    result = runRemoteCwb(source, ['note', session.id, patch.note || '']);
  } else if (Object.prototype.hasOwnProperty.call(patch, 'hidden')) {
    result = runRemoteCwb(source, [patch.hidden ? 'hide' : 'unhide', session.id]);
  }
  if (!result) return 0;
  if (result.error) throw result.error;
  const status = resultStatus(result);
  process.exitCode = status;
  return status;
}

function listSourceDirectories(source, dir) {
  if (!source || !source.remote) return listDirectories(dir, usableCwd);
  const payload = runRemoteCwbJson(source, ['dirs', '--cwd', dir, '--json']);
  return {
    cwd: payload.cwd || dir || '.',
    entries: (payload.entries || []).map((entry) => ({
      name: entry.name || path.basename(entry.path),
      path: entry.path,
    })),
  };
}

function createSourceDirectory(source, parent, name) {
  if (!source || !source.remote) return createChildDirectory(parent, name);
  const payload = runRemoteCwbJson(source, ['mkdir', '--cwd', parent, '--json', name]);
  return payload.path;
}

module.exports = {
  LOCAL_SOURCE,
  attachSource,
  configuredSources,
  createSourceDirectory,
  listSourceDirectories,
  loadWorkbenchSessions,
  runSourceNewSession,
  runSourceSessionCommand,
  sourceById,
  sourceKey,
  updateSourceMetadata,
};
