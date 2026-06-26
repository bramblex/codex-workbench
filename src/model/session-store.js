'use strict';

const fs = require('fs');
const path = require('path');
const { loadMeta, removeMetadata, updateMetadata } = require('./metadata');
const { getAllSessionFiles, getProvider } = require('../providers');

// ---------------------------------------------------------------------------
// Metadata persistence (provider-agnostic: keyed by session id)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Session listing (aggregates across all providers)
// ---------------------------------------------------------------------------

function listSessions() {
  const meta = loadMeta();
  const fileEntries = getAllSessionFiles();

  const sessions = [];
  for (const { file, backend, session: listedSession } of fileEntries) {
    try {
      const provider = getProvider(backend);
      const session = listedSession || provider.parseSession(file);
      // Merge workbench metadata (name, note, archived)
      const custom = meta.sessions[session.id] || {};
      sessions.push({ ...session, ...custom });
    } catch (_err) {
      // Skip unparseable files
    }
  }

  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return sessions;
}

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

function resolveSession(query, sessions) {
  if (!sessions) sessions = listSessions();
  if (!query) throw new Error('Missing session. Run `codex-workbench list` to find a session id.');
  const matches = sessions.filter((session) => {
    return session.id === query ||
      session.id.startsWith(query) ||
      session.name === query ||
      (session.file && path.basename(session.file) === query);
  });
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No session matched: ${query}`);
  throw new Error(
    `Ambiguous session: ${query}\n${matches.map((s) => `  ${s.id} ${s.name || ''}`).join('\n')}`
  );
}

function deleteSessionFile(session) {
  if (!session.file) throw new Error(`Session does not have a standalone file: ${session.id}`);
  fs.unlinkSync(session.file);
  removeMetadata(session);
}

// ---------------------------------------------------------------------------
// Re-export parseSession for backward compat (uses codex provider by default)
// ---------------------------------------------------------------------------

function parseSession(file) {
  const codex = getProvider('codex');
  return codex.parseSession(file);
}

module.exports = {
  deleteSessionFile,
  listSessions,
  loadMeta,
  parseSession,
  removeMetadata,
  resolveSession,
  updateMetadata,
};
