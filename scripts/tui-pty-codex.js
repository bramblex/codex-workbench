#!/usr/bin/env node
'use strict';

const blessed = require('blessed');
const pty = require('node-pty');
const { resolveCodexBin } = require('../src/codex-bin');

const args = process.argv.slice(2);
const bin = resolveCodexBin();

const screen = blessed.screen({
  smartCSR: true,
  fullUnicode: true,
  title: 'Codex PTY TUI Experiment',
});

const header = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  right: 0,
  height: 3,
  padding: { left: 1, right: 1 },
  style: { fg: 'white', bg: 'blue' },
  content: ` Codex PTY TUI Experiment\n ${bin} ${args.join(' ')}`,
});

const terminal = blessed.box({
  parent: screen,
  label: ' Codex ',
  top: 3,
  left: 0,
  right: 0,
  bottom: 2,
  border: 'line',
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  mouse: true,
  tags: false,
  parseTags: false,
  scrollbar: { ch: ' ', track: { bg: 'black' }, style: { bg: 'cyan' } },
  style: { fg: 'white', border: { fg: 'cyan' } },
});

const footer = blessed.box({
  parent: screen,
  left: 0,
  right: 0,
  bottom: 0,
  height: 2,
  padding: { left: 1, right: 1 },
  style: { fg: 'white', bg: 'black' },
  content: 'Ctrl+] close child  Ctrl+C quit wrapper  PageUp/PageDown scroll',
});

function terminalSize() {
  return {
    cols: Math.max(20, (terminal.width || process.stdout.columns || 80) - 2),
    rows: Math.max(5, (terminal.height || process.stdout.rows || 24) - 2),
  };
}

function appendOutput(data) {
  const maxLength = 300000;
  const next = `${terminal.getContent() || ''}${String(data)}`;
  terminal.setContent(next.length > maxLength ? next.slice(-maxLength) : next);
  terminal.setScrollPerc(100);
  screen.render();
}

function cleanup(code = 0) {
  try {
    screen.destroy();
  } finally {
    process.exit(code);
  }
}

const size = terminalSize();
let proc;
try {
  proc = pty.spawn(bin, args, {
    name: process.env.TERM || 'xterm-256color',
    cols: size.cols,
    rows: size.rows,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: process.env.TERM || 'xterm-256color',
    },
  });
} catch (err) {
  screen.destroy();
  console.error(`failed to start pty: ${err.message}`);
  process.exit(1);
}

proc.onData(appendOutput);

proc.onExit(({ exitCode, signal }) => {
  cleanup(typeof exitCode === 'number' ? exitCode : signal ? 1 : 0);
});

screen.on('resize', () => {
  const next = terminalSize();
  try {
    proc.resize(next.cols, next.rows);
  } catch {
    // Ignore resize races while the child is exiting.
  }
});

screen.key(['C-]'], () => {
  try {
    proc.kill();
  } finally {
    cleanup(0);
  }
});

screen.key(['C-c'], () => {
  cleanup(130);
});

screen.key(['pageup'], () => {
  terminal.scroll(-Math.max(1, Math.floor((terminal.height || 20) / 2)));
  screen.render();
});

screen.key(['pagedown'], () => {
  terminal.scroll(Math.max(1, Math.floor((terminal.height || 20) / 2)));
  screen.render();
});

screen.program.input.on('data', (data) => {
  if (data === '\u001d') return;
  proc.write(data);
});

terminal.focus();
screen.render();
