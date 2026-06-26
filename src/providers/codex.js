'use strict';

// ---------------------------------------------------------------------------
// Codex provider – session parsing, binary discovery, and CLI operations
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { HOME } = require('../config');

// ---------------------------------------------------------------------------
// Binary discovery (extracted from codex-bin.js)
// ---------------------------------------------------------------------------

const DEFAULT_CODEX_BIN = '/Applications/Codex.app/Contents/Resources/codex';

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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function executableFromOutput(output) {
  for (const line of String(output || '').split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate && path.isAbsolute(candidate) && isExecutable(candidate)) return candidate;
  }
  return null;
}

function runShellLookup(shell, shellArgs, command, env) {
  const result = spawnSync(shell, [...shellArgs, `command -v ${shellQuote(command)}`], {
    encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) return null;
  return executableFromOutput(result.stdout);
}

function findWithShell(command, env) {
  const shell = (env || process.env).SHELL || '/bin/sh';
  if (!isExecutable(shell)) return null;
  return runShellLookup(shell, ['-lc'], command, env) ||
         runShellLookup(shell, ['-ic'], command, env);
}

function resolveCodexBin() {
  const env = process.env;

  if (env.CODEX_BIN) {
    if (isExecutable(env.CODEX_BIN)) return env.CODEX_BIN;
    throw new Error(`CODEX_BIN is not executable: ${env.CODEX_BIN}`);
  }

  const fromLogin = findWithShell('codex', env);
  if (fromLogin) return fromLogin;

  const fromPath = findOnPath('codex', env.PATH);
  if (fromPath) return fromPath;

  if (DEFAULT_CODEX_BIN && isExecutable(DEFAULT_CODEX_BIN)) return DEFAULT_CODEX_BIN;

  throw new Error('Could not find the codex executable. Set CODEX_BIN or add codex to your shell PATH.');
}

// ---------------------------------------------------------------------------
// CLI execution (extracted from codex-runner.js)
// ---------------------------------------------------------------------------

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

function runArgv(argv, cwd, inherit) {
  const shellCommand = `exec ${argv.map(shellQuote).join(' ')}`;
  const shell = commandShell();
  if (inherit) {
    const child = spawn(shell, ['-lc', shellCommand], { stdio: 'inherit', cwd, env: process.env });
    child.on('error', (err) => { console.error(`error: failed to start codex: ${err.message}`); process.exit(1); });
    child.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); process.exit(code || 0); });
    return undefined;
  }
  const result = spawnSync(shell, ['-lc', shellCommand], { stdio: 'inherit', cwd, env: process.env });
  if (result.error) throw new Error(`failed to start codex: ${result.error.message}`);
  const status = typeof result.status === 'number' ? result.status : 1;
  process.exitCode = status;
  return status;
}

function runCommand(command, session, args, inherit) {
  const executable = resolveCodexBin();
  const argv = [executable, command, session.id, ...(args || [])];
  return runArgv(argv, usableCwd(session.cwd), inherit);
}

function runNew(cwd, args, inherit) {
  const executable = resolveCodexBin();
  const argv = [executable, ...(args || [])];
  return runArgv(argv, usableCwd(cwd), inherit);
}

// ---------------------------------------------------------------------------
// Session parsing (extracted from session-store.js)
// ---------------------------------------------------------------------------

const CODEX_SESSIONS_DIR = process.env.CODEX_SESSIONS_DIR || path.join(
  process.env.CODEX_HOME || path.join(HOME, '.codex'),
  'sessions'
);

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

function parseSession(file) {
  const stat = fs.statSync(file);
  const raw = fs.readFileSync(file, 'utf8').trim();
  const lines = raw ? raw.split(/\n/) : [];
  let meta = {};
  const messages = [];
  let turns = 0;

  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.type === 'session_meta') meta = row.payload || {};
    if (row.type === 'response_item' && row.payload && row.payload.type === 'message') {
      const msg = row.payload;
      if (msg.role === 'developer') continue;
      const text = textFromContent(msg.content);
      if (!text) continue;
      if (msg.role === 'user' && isNoiseUserText(text)) continue;
      messages.push({ role: msg.role, phase: msg.phase || '', text });
      if (msg.role === 'user') turns += 1;
    }
  }

  const id = meta.id || path.basename(file, '.jsonl').split('-').slice(-5).join('-');

  return {
    id,
    file,
    cwd: meta.cwd || '(unknown)',
    startedAt: meta.timestamp || null,
    updatedAt: stat.mtime.toISOString(),
    cliVersion: meta.cli_version || '',
    provider: meta.model_provider || '',
    turns,
    first: firstUserText(messages),
    last: lastUserText(messages),
    lastAssistant: lastAssistantText(messages),
    messages,
    backend: 'codex',
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
// Provider interface
// ---------------------------------------------------------------------------

function isAvailable() {
  try { return fs.statSync(CODEX_SESSIONS_DIR).isDirectory(); } catch { return false; }
}

function getSessionFiles() {
  return walk(CODEX_SESSIONS_DIR);
}

function resolveBin() {
  try { return resolveCodexBin(); } catch { return null; }
}

// Map workbench command names → codex CLI commands
const COMMAND_MAP = {
  resume:  'resume',
  fork:    'fork',
  delete:  'delete',
  archive: 'archive',
  unarchive: 'unarchive',
};

function runSessionCommand(command, session, args, inherit) {
  const codexCmd = COMMAND_MAP[command];
  if (!codexCmd) throw new Error(`Unknown command for codex backend: ${command}`);
  return runCommand(codexCmd, session, args, inherit);
}

module.exports = {
  id: 'codex',
  label: 'Codex',
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
  // Re-export for backward compat
  shellQuote,
  commandShell,
  resolveCodexBin,
  DEFAULT_CODEX_BIN,
  findOnPath,
  findWithShell,
  isExecutable,
};
