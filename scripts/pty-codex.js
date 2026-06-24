#!/usr/bin/env node
'use strict';

const pty = require('node-pty');
const { resolveCodexBin } = require('../src/codex-bin');

function terminalSize() {
  return {
    cols: Math.max(20, process.stdout.columns || 80),
    rows: Math.max(5, process.stdout.rows || 24),
  };
}

function setRawMode(enabled) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') return;
  process.stdin.setRawMode(enabled);
}

const args = process.argv.slice(2);
const bin = resolveCodexBin();
const size = terminalSize();

let proc;
try {
  proc = pty.spawn(bin, args, {
    name: process.env.TERM || 'xterm-256color',
    cols: size.cols,
    rows: size.rows,
    cwd: process.cwd(),
    env: process.env,
  });
} catch (err) {
  console.error(`failed to start pty: ${err.message}`);
  process.exit(1);
}

process.stdin.resume();
setRawMode(true);

proc.onData((data) => {
  process.stdout.write(data);
});

process.stdin.on('data', (data) => {
  proc.write(data);
});

process.stdout.on('resize', () => {
  const next = terminalSize();
  try {
    proc.resize(next.cols, next.rows);
  } catch {
    // Ignore resize races while the child is exiting.
  }
});

proc.onExit(({ exitCode, signal }) => {
  setRawMode(false);
  process.exit(typeof exitCode === 'number' ? exitCode : signal ? 1 : 0);
});

process.on('SIGINT', () => {
  proc.write('\x03');
});

process.on('SIGTERM', () => {
  try {
    proc.kill();
  } finally {
    setRawMode(false);
  }
});
