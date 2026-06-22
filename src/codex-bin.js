'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_CODEX_BIN = '/Applications/Codex.app/Contents/Resources/codex';

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(command, pathValue = process.env.PATH || '') {
  for (const dir of pathValue.split(path.delimiter)) {
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

function findWithShell(command, env = process.env) {
  const shell = env.SHELL || '/bin/sh';
  if (!isExecutable(shell)) return null;

  return runShellLookup(shell, ['-lc'], command, env) ||
    runShellLookup(shell, ['-ic'], command, env);
}

function inspectCodexBin(options = {}) {
  const env = options.env || process.env;
  const fallbackPath = Object.prototype.hasOwnProperty.call(options, 'fallbackPath')
    ? options.fallbackPath
    : DEFAULT_CODEX_BIN;
  const shell = env.SHELL || '/bin/sh';
  const checks = [];

  if (env.CODEX_BIN) {
    const executable = isExecutable(env.CODEX_BIN);
    checks.push({ source: 'CODEX_BIN', path: env.CODEX_BIN, executable });
    return {
      ok: executable,
      path: executable ? env.CODEX_BIN : null,
      source: executable ? 'CODEX_BIN' : null,
      checks,
      error: executable ? null : `CODEX_BIN is not executable: ${env.CODEX_BIN}`,
    };
  }

  checks.push({ source: 'shell', shell, mode: 'login', executable: isExecutable(shell) });
  const fromLoginShell = isExecutable(shell) ? runShellLookup(shell, ['-lc'], 'codex', env) : null;
  if (fromLoginShell) {
    checks[checks.length - 1].path = fromLoginShell;
    return { ok: true, path: fromLoginShell, source: 'shell login PATH', checks, error: null };
  }

  checks.push({ source: 'shell', shell, mode: 'interactive', executable: isExecutable(shell) });
  const fromInteractiveShell = isExecutable(shell) ? runShellLookup(shell, ['-ic'], 'codex', env) : null;
  if (fromInteractiveShell) {
    checks[checks.length - 1].path = fromInteractiveShell;
    return { ok: true, path: fromInteractiveShell, source: 'shell interactive PATH', checks, error: null };
  }

  const fromProcessPath = findOnPath('codex', env.PATH || '');
  checks.push({ source: 'process PATH', path: fromProcessPath, executable: Boolean(fromProcessPath) });
  if (fromProcessPath) {
    return { ok: true, path: fromProcessPath, source: 'process PATH', checks, error: null };
  }

  const fallbackExecutable = Boolean(fallbackPath && isExecutable(fallbackPath));
  checks.push({ source: 'fallback', path: fallbackPath || '', executable: fallbackExecutable });
  if (fallbackExecutable) {
    return { ok: true, path: fallbackPath, source: 'fallback', checks, error: null };
  }

  return {
    ok: false,
    path: null,
    source: null,
    checks,
    error: 'Could not find the codex executable. Set CODEX_BIN or add codex to your shell PATH.',
  };
}

function resolveCodexBin(options = {}) {
  const result = inspectCodexBin(options);
  if (result.ok) return result.path;
  throw new Error(result.error);
}

module.exports = {
  DEFAULT_CODEX_BIN,
  findOnPath,
  findWithShell,
  inspectCodexBin,
  isExecutable,
  resolveCodexBin,
};
