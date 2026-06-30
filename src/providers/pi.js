'use strict';

// ---------------------------------------------------------------------------
// pi provider – session parsing, binary discovery, and CLI operations
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { HOME, PI_CODING_AGENT_DIR } = require('../config');
const { removeMetadata, updateMetadata } = require('../model/metadata');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PI_SESSIONS_DIR = process.env.PI_CODING_AGENT_SESSION_DIR ||
  path.join(PI_CODING_AGENT_DIR, 'sessions');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function isExecutable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
}

function findOnPath(command, pathValue) {
  for (const dir of (pathValue || process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function usableCwd(dir) {
  for (const candidate of [dir, process.cwd(), HOME]) {
    if (!candidate || candidate === '(unknown)') continue;
    try { if (fs.statSync(candidate).isDirectory()) return candidate; } catch { /* skip */ }
  }
  return HOME;
}

function commandShell() {
  const shell = process.env.SHELL || '/bin/sh';
  try { fs.accessSync(shell, fs.constants.X_OK); return shell; } catch { return '/bin/sh'; }
}

// ---------------------------------------------------------------------------
// Binary discovery
// ---------------------------------------------------------------------------

function resolvePiBin() {
  const env = process.env;

  // PI_BIN env var takes priority
  if (env.PI_BIN) {
    if (isExecutable(env.PI_BIN)) return env.PI_BIN;
    throw new Error(`PI_BIN is not executable: ${env.PI_BIN}`);
  }

  // Check PATH
  const fromPath = findOnPath('pi', env.PATH);
  if (fromPath) return fromPath;

  // npm global bin (common locations)
  const npmPrefix = (() => {
    try {
      const result = spawnSync('npm', ['prefix', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return (result.stdout || '').trim();
    } catch { return ''; }
  })();

  if (npmPrefix) {
    const candidate = path.join(npmPrefix, 'bin', 'pi');
    if (isExecutable(candidate)) return candidate;
  }

  throw new Error('Could not find the pi executable. Install with: npm install -g @earendil-works/pi-coding-agent');
}

// ---------------------------------------------------------------------------
// Session listing
// ---------------------------------------------------------------------------

function walk(dir, out) {
  out = out || [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Session parsing – pi v3 JSONL format
//
// Header:  {"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"/path"}
// Message: {"type":"message","id":"...","parentId":"...","message":{"role":"user|assistant|toolResult","content":[...]}}
// Model:   {"type":"model_change", ...}
// Thinking:{"type":"thinking_level_change", ...}
// ---------------------------------------------------------------------------

function piTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item && item.type === 'text')
    .map((item) => item.text || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSession(file) {
  const stat = fs.statSync(file);
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) {
    return emptySession(file, stat, path.basename(file, '.jsonl'));
  }

  const lines = raw.split(/\n/);
  let header = {};
  const messages = [];
  let turns = 0;
  let provider = '';
  let cliVersion = '';

  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }

    if (row.type === 'session') {
      header = row;
      continue;
    }

    if (row.type === 'model_change') {
      provider = row.provider || '';
      continue;
    }

    if (row.type === 'message' && row.message) {
      const msg = row.message;
      if (msg.role === 'toolResult') continue; // skip tool results for display purposes

      const text = piTextFromContent(msg.content);
      // Skip empty messages (e.g. tool calls with no text)
      if (!text && msg.role !== 'user') continue;

      messages.push({
        role: msg.role,
        text: text || '',
      });

      if (msg.role === 'user') turns += 1;

      // Extract provider from first assistant message
      if (!provider && msg.role === 'assistant' && msg.provider) {
        provider = msg.provider;
      }
    }
  }

  const id = header.id || extractIdFromFilename(file);

  return {
    id,
    file,
    cwd: header.cwd || '(unknown)',
    startedAt: header.timestamp || stat.birthtime?.toISOString() || null,
    updatedAt: stat.mtime.toISOString(),
    cliVersion,
    provider,
    turns,
    first: firstUserText(messages),
    last: lastUserText(messages),
    lastAssistant: lastAssistantText(messages),
    messages,
    backend: 'pi',
  };
}

function extractIdFromFilename(file) {
  const base = path.basename(file, '.jsonl');
  // pi filenames: <timestamp>_<uuid>.jsonl
  const parts = base.split('_');
  if (parts.length >= 2) return parts[parts.length - 1];
  return base;
}

function emptySession(file, stat, fallbackId) {
  return {
    id: extractIdFromFilename(file) || fallbackId,
    file,
    cwd: '(unknown)',
    startedAt: stat.birthtime?.toISOString() || null,
    updatedAt: stat.mtime.toISOString(),
    cliVersion: '',
    provider: '',
    turns: 0,
    first: '',
    last: '',
    lastAssistant: '',
    messages: [],
    backend: 'pi',
  };
}

function firstUserText(messages) {
  const m = messages.find((msg) => msg.role === 'user');
  return m ? m.text : '';
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].text;
  }
  return '';
}

function lastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i].text;
  }
  return '';
}

// ---------------------------------------------------------------------------
// CLI execution
// ---------------------------------------------------------------------------

function runArgv(argv, cwd, inherit, hooks = {}) {
  const shellCommand = `exec ${argv.map(shellQuote).join(' ')}`;
  const shell = commandShell();
  if (inherit) {
    const child = spawn(shell, ['-lc', shellCommand], { stdio: 'inherit', cwd, env: process.env });
    if (hooks.onChild) hooks.onChild(child);
    child.on('error', (err) => { console.error(`error: failed to start pi: ${err.message}`); process.exit(1); });
    child.on('exit', (code, signal) => {
      if (hooks.onExit) hooks.onExit(code, signal);
      if (signal) process.kill(process.pid, signal);
      process.exit(code || 0);
    });
    return undefined;
  }
  const result = spawnSync(shell, ['-lc', shellCommand], { stdio: 'inherit', cwd, env: process.env });
  if (result.error) throw new Error(`failed to start pi: ${result.error.message}`);
  const status = typeof result.status === 'number' ? result.status : 1;
  process.exitCode = status;
  return status;
}

// pi CLI commands mapping
function runSessionCommand(command, session, args, inherit, hooks) {
  const executable = resolvePiBin();
  const cwd = usableCwd(session.cwd);

  switch (command) {
    case 'resume': {
      // pi --session <file> [args...]
      let argv = [executable, '--session', session.file];
      if (args && args.length) argv.push('-p', args.join(' '));
      return runArgv(argv, cwd, inherit, hooks);
    }
    case 'fork': {
      // pi --fork <file>
      const argv = [executable, '--fork', session.file];
      return runArgv(argv, cwd, inherit, hooks);
    }
    case 'delete': {
      fs.unlinkSync(session.file);
      removeMetadata(session);
      return 0;
    }
    case 'archive':
    case 'unarchive': {
      updateMetadata(session, { archived: command === 'archive' });
      return 0;
    }
    default:
      throw new Error(`Unknown command for pi backend: ${command}`);
  }
}

function runNew(cwd, args, inherit) {
  const executable = resolvePiBin();
  let argv = [executable];
  if (args && args.length) argv.push('-p', args.join(' '));
  return runArgv(argv, usableCwd(cwd), inherit);
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

function isAvailable() {
  try { return fs.statSync(PI_SESSIONS_DIR).isDirectory(); } catch { return false; }
}

function getSessionFiles() {
  return walk(PI_SESSIONS_DIR);
}

function resolveBin() {
  try { return resolvePiBin(); } catch { return null; }
}

module.exports = {
  id: 'pi',
  label: 'pi',
  capabilities: {
    new: true,
    resume: true,
    fork: true,
    archive: true,
    unarchive: true,
    delete: true,
  },
  isAvailable,
  getSessionFiles,
  parseSession,
  resolveBin,
  runCommand: runSessionCommand,
  runNew,
  usableCwd,
  // Re-exports
  shellQuote,
  commandShell,
  resolvePiBin,
};
