'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { removeMetadata } = require('../model/metadata');

const HOME = os.homedir();
const OPENCODE_DATA_DIR = process.env.OPENCODE_DATA_DIR ||
  path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share'), 'opencode');
const OPENCODE_DB = process.env.OPENCODE_DB || path.join(OPENCODE_DATA_DIR, 'opencode.db');

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

function resolveOpenCodeBin() {
  if (process.env.OPENCODE_BIN) {
    if (isExecutable(process.env.OPENCODE_BIN)) return process.env.OPENCODE_BIN;
    throw new Error(`OPENCODE_BIN is not executable: ${process.env.OPENCODE_BIN}`);
  }
  const fromPath = findOnPath('opencode', process.env.PATH);
  if (fromPath) return fromPath;
  const fromShell = findWithShell('opencode', process.env);
  if (fromShell) return fromShell;
  throw new Error('Could not find the opencode executable. Set OPENCODE_BIN or add opencode to PATH.');
}

function dbQuery(sql) {
  const result = spawnSync(resolveOpenCodeBin(), ['db', sql, '--format', 'json'], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || '').trim() || `opencode db exited with code ${result.status}`);
  return JSON.parse(result.stdout || '[]');
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function collectText(value, out = []) {
  if (!value) return out;
  if (typeof value === 'string') {
    if (value.trim()) out.push(value.trim());
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'content', 'prompt', 'message', 'title']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) collectText(value[key], out);
    }
  }
  return out;
}

function messageRole(row, data) {
  const type = String(row.type || data.role || data.type || '').toLowerCase();
  if (type.includes('user') || type.includes('input')) return 'user';
  if (type.includes('assistant') || type.includes('agent')) return 'assistant';
  return type || 'message';
}

function listMessages(sessionId) {
  const rows = dbQuery(
    `select type, data from session_message where session_id = ${sqlString(sessionId)} order by seq asc`
  );
  return rows.map((row) => {
    const data = parseJson(row.data, {});
    return {
      role: messageRole(row, data),
      text: collectText(data).join(' ').replace(/\s+/g, ' ').trim(),
    };
  }).filter((message) => message.text);
}

function firstUserText(messages) {
  const message = messages.find((item) => item.role === 'user');
  return message ? message.text : '';
}

function lastText(messages, role) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!role || messages[i].role === role) return messages[i].text;
  }
  return '';
}

function millisToIso(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Date(number).toISOString();
}

function sessionFromRow(row) {
  const messages = listMessages(row.id);
  const turns = messages.filter((message) => message.role === 'user').length;
  return {
    id: row.id,
    file: '',
    cwd: row.directory || '(unknown)',
    startedAt: millisToIso(row.time_created),
    updatedAt: millisToIso(row.time_updated),
    cliVersion: row.version || '',
    provider: row.model || '',
    turns,
    first: row.title || firstUserText(messages),
    last: lastText(messages, 'user'),
    lastAssistant: lastText(messages, 'assistant'),
    messages,
    archived: Boolean(row.time_archived),
    backend: 'opencode',
  };
}

function listSessions() {
  const rows = dbQuery(
    'select id, title, directory, version, model, time_created, time_updated, time_archived from session order by time_updated desc'
  );
  return rows.map(sessionFromRow);
}

function usableCwd(dir) {
  for (const candidate of [dir, process.cwd(), HOME]) {
    if (!candidate || candidate === '(unknown)') continue;
    try { if (fs.statSync(candidate).isDirectory()) return candidate; } catch { /* skip */ }
  }
  return HOME;
}

function runArgv(argv, cwd, inherit) {
  if (inherit) {
    const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', cwd, env: process.env });
    child.on('error', (err) => { console.error(`error: failed to start opencode: ${err.message}`); process.exit(1); });
    child.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); process.exit(code || 0); });
    return undefined;
  }
  const result = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', cwd, env: process.env });
  if (result.error) throw new Error(`failed to start opencode: ${result.error.message}`);
  const status = typeof result.status === 'number' ? result.status : 1;
  process.exitCode = status;
  return status;
}

function runSessionCommand(command, session, args, inherit) {
  const executable = resolveOpenCodeBin();
  const cwd = usableCwd(session.cwd);
  switch (command) {
    case 'resume':
      {
        const argv = [executable, cwd, '--session', session.id];
        if (args && args.length) argv.push('--prompt', args.join(' '));
        return runArgv(argv, cwd, inherit);
      }
    case 'fork':
      return runArgv([executable, cwd, '--session', session.id, '--fork'], cwd, inherit);
    case 'delete': {
      const status = runArgv([executable, 'session', 'delete', session.id], cwd, false);
      if (status === 0) removeMetadata(session);
      return status;
    }
    case 'archive':
      dbQuery(`update session set time_archived = ${Date.now()} where id = ${sqlString(session.id)}`);
      return 0;
    case 'unarchive':
      dbQuery(`update session set time_archived = null where id = ${sqlString(session.id)}`);
      return 0;
    default:
      throw new Error(`Unknown command for opencode backend: ${command}`);
  }
}

function runNew(cwd, args, inherit) {
  const resolvedCwd = usableCwd(cwd);
  const argv = [resolveOpenCodeBin(), resolvedCwd];
  if (args && args.length) argv.push('--prompt', args.join(' '));
  return runArgv(argv, resolvedCwd, inherit);
}

function isAvailable() {
  try {
    resolveOpenCodeBin();
    return fs.statSync(OPENCODE_DB).isFile();
  } catch {
    return false;
  }
}

function getSessionFiles() {
  return [];
}

function resolveBin() {
  try { return resolveOpenCodeBin(); } catch { return null; }
}

module.exports = {
  id: 'opencode',
  label: 'opencode',
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
  listSessions,
  resolveBin,
  runCommand: runSessionCommand,
  runNew,
};
