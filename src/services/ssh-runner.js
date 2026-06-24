'use strict';

const { spawnSync } = require('child_process');
const { shellQuote } = require('./codex-runner');

function sshBaseArgs(server, opts = {}) {
  const args = [];
  if (opts.tty) args.push('-t');
  args.push(...(server.sshArgs || []), server.target);
  return args;
}

function remoteCwbCommand(server, argv) {
  const command = server.command || 'cwb';
  return [command, ...argv].map(shellQuote).join(' ');
}

function runRemoteCwb(server, argv, opts = {}) {
  const command = remoteCwbCommand(server, argv);
  const args = [...sshBaseArgs(server, { tty: opts.tty }), command];
  return spawnSync('ssh', args, {
    encoding: opts.encoding,
    env: process.env,
    maxBuffer: opts.maxBuffer || 64 * 1024 * 1024,
    stdio: opts.stdio || (opts.encoding ? ['ignore', 'pipe', 'pipe'] : 'inherit'),
  });
}

function runRemoteCwbJson(server, argv) {
  const result = runRemoteCwb(server, argv, { encoding: 'utf8' });
  if (result.error) {
    if (result.error.code === 'ENOBUFS') {
      throw new Error('remote output exceeded buffer; update the remote codex-workbench so compact listing is available');
    }
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(stderr || `ssh exited with code ${result.status}`);
  }
  return JSON.parse(result.stdout || 'null');
}

module.exports = {
  remoteCwbCommand,
  runRemoteCwb,
  runRemoteCwbJson,
  sshBaseArgs,
};
