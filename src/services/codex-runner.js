'use strict';

const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { HOME } = require('../config');
const { resolveCodexBin } = require('../codex-bin');

function usableCwd(dir) {
  const candidates = [dir, process.cwd(), HOME];
  for (const candidate of candidates) {
    if (!candidate || candidate === '(unknown)') continue;
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Try the next fallback.
    }
  }
  return HOME;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandShell() {
  const shell = process.env.SHELL || '/bin/sh';
  try {
    fs.accessSync(shell, fs.constants.X_OK);
    return shell;
  } catch {
    return '/bin/sh';
  }
}

function runCodexArgv(argv, cwd, inherit = false) {
  const shellCommand = `exec ${argv.map(shellQuote).join(' ')}`;
  const shell = commandShell();
  if (inherit) {
    const child = spawn(shell, ['-lc', shellCommand], { stdio: 'inherit', cwd, env: process.env });
    child.on('error', (err) => {
      console.error(`error: failed to start codex: ${err.message}`);
      process.exit(1);
    });
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      process.exit(code || 0);
    });
    return undefined;
  }
  const result = spawnSync(shell, ['-lc', shellCommand], { stdio: 'inherit', cwd, env: process.env });
  if (result.error) throw new Error(`failed to start codex: ${result.error.message}`);
  const status = result.status || 0;
  process.exitCode = status;
  return status;
}

function runCodexCommand(command, session, args = [], inherit = false) {
  const executable = resolveCodexBin();
  const argv = [executable, command, session.id, ...args];
  return runCodexArgv(argv, usableCwd(session.cwd), inherit);
}

function runNewCodexSession(cwd, args = [], inherit = false) {
  const executable = resolveCodexBin();
  const argv = [executable, ...args];
  return runCodexArgv(argv, usableCwd(cwd), inherit);
}

module.exports = {
  commandShell,
  runCodexCommand,
  runNewCodexSession,
  shellQuote,
  usableCwd,
};
