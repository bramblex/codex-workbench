'use strict';

const fs = require('fs');
const path = require('path');
const { META_PATH, SESSIONS_DIR } = require('../config');

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

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function textFromContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item && (item.type === 'input_text' || item.type === 'output_text'))
    .map((item) => item.text || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoiseUserText(text) {
  return text.includes('<environment_context>') || text.includes('<permissions instructions>');
}

function parseSession(file) {
  const stat = fs.statSync(file);
  const raw = fs.readFileSync(file, 'utf8').trim();
  const lines = raw ? raw.split(/\n/) : [];
  let meta = {};
  const messages = [];
  let turns = 0;

  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type === 'session_meta') meta = row.payload || {};
    if (row.type === 'response_item' && row.payload && row.payload.type === 'message') {
      const msg = row.payload;
      if (msg.role === 'developer') continue;
      const text = textFromContent(msg.content);
      if (!text) continue;
      if (msg.role === 'user' && isNoiseUserText(text)) continue;
      messages.push({
        role: msg.role,
        phase: msg.phase || '',
        text,
      });
      if (msg.role === 'user') turns += 1;
    }
  }

  const id = meta.id || path.basename(file, '.jsonl').split('-').slice(-5).join('-');
  const firstUser = messages.find((msg) => msg.role === 'user');
  const lastUser = [...messages].reverse().find((msg) => msg.role === 'user');
  const lastAssistant = [...messages].reverse().find((msg) => msg.role === 'assistant');

  return {
    id,
    file,
    cwd: meta.cwd || '(unknown)',
    startedAt: meta.timestamp || null,
    updatedAt: stat.mtime.toISOString(),
    cliVersion: meta.cli_version || '',
    source: meta.source || '',
    provider: meta.model_provider || '',
    turns,
    first: firstUser ? firstUser.text : '',
    last: lastUser ? lastUser.text : '',
    lastAssistant: lastAssistant ? lastAssistant.text : '',
    messages,
  };
}

function loadMeta() {
  const data = readJson(META_PATH, { sessions: {} });
  if (!data.sessions) data.sessions = {};
  return data;
}

function listSessions() {
  const meta = loadMeta();
  return walk(SESSIONS_DIR)
    .map(parseSession)
    .map((session) => ({ ...session, ...(meta.sessions[session.id] || {}) }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function resolveSession(query, sessions = listSessions()) {
  if (!query) throw new Error('Missing session. Run `codex-workbench list` to find a session id.');
  const matches = sessions.filter((session) => {
    return session.id === query ||
      session.id.startsWith(query) ||
      session.name === query ||
      path.basename(session.file) === query;
  });
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No session matched: ${query}`);
  throw new Error(`Ambiguous session: ${query}\n${matches.map((s) => `  ${s.id} ${s.name || ''}`).join('\n')}`);
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

function deleteSessionFile(session) {
  fs.unlinkSync(session.file);
  removeMetadata(session);
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
