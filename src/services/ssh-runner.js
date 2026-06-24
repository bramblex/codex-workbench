'use strict';

const { spawn, spawnSync } = require('child_process');
const { shellQuote } = require('./codex-runner');

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

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
    maxBuffer: opts.maxBuffer || DEFAULT_MAX_BUFFER,
    stdio: opts.stdio || (opts.encoding ? ['ignore', 'pipe', 'pipe'] : 'inherit'),
  });
}

function runRemoteCwbAsync(server, argv, opts = {}) {
  const command = remoteCwbCommand(server, argv);
  const args = [...sshBaseArgs(server, { tty: opts.tty }), command];
  const maxBuffer = opts.maxBuffer || DEFAULT_MAX_BUFFER;
  const encoding = opts.encoding || 'utf8';

  return new Promise((resolve) => {
    const child = spawn('ssh', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let stdoutSize = 0;
    let stderrSize = 0;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const append = (name, chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString(encoding) : String(chunk);
      const size = Buffer.byteLength(text);
      if (name === 'stdout') {
        stdout += text;
        stdoutSize += size;
      } else {
        stderr += text;
        stderrSize += size;
      }
      if (stdoutSize + stderrSize > maxBuffer) {
        child.kill();
        const error = new Error('spawn ssh ENOBUFS');
        error.code = 'ENOBUFS';
        finish({ error, stdout, stderr, status: null, signal: 'SIGTERM' });
      }
    };

    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (error) => finish({ error, stdout, stderr, status: null, signal: null }));
    child.on('close', (status, signal) => finish({ stdout, stderr, status, signal }));
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

async function runRemoteCwbJsonAsync(server, argv) {
  const result = await runRemoteCwbAsync(server, argv, { encoding: 'utf8' });
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
  runRemoteCwbAsync,
  runRemoteCwbJson,
  runRemoteCwbJsonAsync,
  sshBaseArgs,
};
