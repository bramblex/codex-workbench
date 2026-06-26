'use strict';

// ---------------------------------------------------------------------------
// Claude Code provider – session parsing, binary discovery, and CLI operations
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { removeMetadata, updateMetadata } = require('../model/metadata');

const HOME = os.homedir();
const CLAUDE_HOME = process.env.CLAUDE_HOME || path.join(HOME, '.claude');
const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(CLAUDE_HOME, 'projects');

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

function executableFromOutput(output) {
  for (const line of String(output || '').split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate && path.isAbsolute(candidate) && isExecutable(candidate)) return candidate;
  }
  return null;
}

function runShellLookup(shell, shellArgs, command, env) {
  const result = spawnSync(shell, [...shellArgs, `command -v ${shellQuote(command)}`], {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
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

function resolveClaudeBin() {
  const env = process.env;
  if (env.CLAUDE_BIN) {
    if (isExecutable(env.CLAUDE_BIN)) return env.CLAUDE_BIN;
    throw new Error(`CLAUDE_BIN is not executable: ${env.CLAUDE_BIN}`);
  }
  const fromShell = findWithShell('claude', env);
  if (fromShell) return fromShell;
  const fromPath = findOnPath('claude', env.PATH);
  if (fromPath) return fromPath;
  throw new Error('Could not find the claude executable. Set CLAUDE_BIN or add claude to PATH.');
}

function commandShell() {
  const shell = process.env.SHELL || '/bin/sh';
  try { fs.accessSync(shell, fs.constants.X_OK); return shell; } catch { return '/bin/sh'; }
}

function usableCwd(dir) {
  for (const candidate of [dir, process.cwd(), HOME]) {
    if (!candidate || candidate === '(unknown)') continue;
    try { if (fs.statSync(candidate).isDirectory()) return candidate; } catch { /* skip */ }
  }
  return HOME;
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

function textFromContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (!item) return '';
      if (typeof item === 'string') return item;
      if (item.type === 'text') return item.text || '';
      if (item.type === 'tool_result') return '';
      return '';
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstUserText(messages) {
  const message = messages.find((msg) => msg.role === 'user');
  return message ? message.text : '';
}

function lastText(messages, role) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!role || messages[i].role === role) return messages[i].text;
  }
  return '';
}

function isNoiseUserText(text) {
  return /^<local-command-/.test(text) ||
    /^<command-name>/.test(text) ||
    text.includes('<environment_context>') ||
    text.includes('<permissions instructions>');
}

function emptySession(file, stat) {
  return {
    id: path.basename(file, '.jsonl'),
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
    backend: 'claude',
  };
}

function parseSession(file) {
  const stat = fs.statSync(file);
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return emptySession(file, stat);

  const messages = [];
  let id = path.basename(file, '.jsonl');
  let cwd = '';
  let startedAt = '';
  let updatedAt = stat.mtime.toISOString();
  let cliVersion = '';
  let provider = '';
  let turns = 0;

  for (const line of raw.split(/\n/)) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }

    if (row.sessionId) id = row.sessionId;
    if (row.cwd) cwd = row.cwd;
    if (row.version) cliVersion = row.version;
    if (row.timestamp) {
      if (!startedAt) startedAt = row.timestamp;
      updatedAt = row.timestamp;
    }

    if ((row.type === 'user' || row.type === 'assistant') && row.message) {
      const role = row.message.role || row.type;
      const text = textFromContent(row.message.content);
      if (!text) continue;
      if (role === 'user' && isNoiseUserText(text)) continue;
      messages.push({ role, text });
      if (role === 'user') turns += 1;
      if (!provider && role === 'assistant' && row.message.model) provider = row.message.model;
    }
  }

  return {
    id,
    file,
    cwd: cwd || '(unknown)',
    startedAt: startedAt || stat.birthtime?.toISOString() || null,
    updatedAt,
    cliVersion,
    provider,
    turns,
    first: firstUserText(messages),
    last: lastText(messages, 'user'),
    lastAssistant: lastText(messages, 'assistant'),
    messages,
    backend: 'claude',
  };
}

function runArgv(argv, cwd, inherit) {
  const shellCommand = `exec ${argv.map(shellQuote).join(' ')}`;
  const shell = commandShell();
  if (inherit) {
    const child = spawn(shell, ['-lc', shellCommand], { stdio: 'inherit', cwd, env: process.env });
    child.on('error', (err) => { console.error(`error: failed to start claude: ${err.message}`); process.exit(1); });
    child.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); process.exit(code || 0); });
    return undefined;
  }
  const result = spawnSync(shell, ['-lc', shellCommand], { stdio: 'inherit', cwd, env: process.env });
  if (result.error) throw new Error(`failed to start claude: ${result.error.message}`);
  const status = typeof result.status === 'number' ? result.status : 1;
  process.exitCode = status;
  return status;
}

function runSessionCommand(command, session, args, inherit) {
  const executable = resolveClaudeBin();
  const cwd = usableCwd(session.cwd);
  switch (command) {
    case 'resume': {
      const argv = [executable, '--resume', session.id];
      if (args && args.length) argv.push(args.join(' '));
      return runArgv(argv, cwd, inherit);
    }
    case 'fork': {
      return runArgv([executable, '--resume', session.id, '--fork-session'], cwd, inherit);
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
      throw new Error(`Unknown command for claude backend: ${command}`);
  }
}

function runNew(cwd, args, inherit) {
  const argv = [resolveClaudeBin(), ...(args || [])];
  return runArgv(argv, usableCwd(cwd), inherit);
}

function isAvailable() {
  try { return fs.statSync(CLAUDE_PROJECTS_DIR).isDirectory(); } catch { return false; }
}

function getSessionFiles() {
  return walk(CLAUDE_PROJECTS_DIR);
}

function resolveBin() {
  try { return resolveClaudeBin(); } catch { return null; }
}

module.exports = {
  id: 'claude',
  label: 'Claude Code',
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
  resolveClaudeBin,
};
