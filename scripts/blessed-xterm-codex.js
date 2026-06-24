#!/usr/bin/env node
'use strict';

const blessed = require('blessed');
const XTerm = require('blessed-xterm');
const { resolveCodexBin } = require('../src/codex-bin');

const args = process.argv.slice(2);
const bin = resolveCodexBin();
const childEnv = {
  ...process.env,
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
};
delete childEnv.NO_COLOR;

const screen = blessed.screen({
  title: 'Codex Blessed-XTerm Experiment',
  smartCSR: true,
  autoPadding: false,
  warnings: false,
});

const header = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  right: 0,
  height: 3,
  padding: { left: 1, right: 1 },
  style: { fg: 'white', bg: 'blue' },
  content: ` Codex Blessed-XTerm Experiment\n ${bin} ${args.join(' ')}`,
});

const terminal = new XTerm({
  shell: bin,
  args,
  env: childEnv,
  cwd: process.cwd(),
  cursorType: 'block',
  border: 'line',
  scrollback: 2000,
  controlKey: 'C-w',
  mousePassthrough: false,
  left: 0,
  top: 3,
  width: screen.width,
  height: Math.max(5, screen.height - 5),
  label: ' Codex ',
  style: {
    fg: 'default',
    bg: 'default',
    border: { fg: 'cyan' },
    focus: { border: { fg: 'green' } },
    scrolling: { border: { fg: 'red' } },
  },
});

const footer = blessed.box({
  parent: screen,
  left: 0,
  right: 0,
  bottom: 0,
  height: 2,
  padding: { left: 1, right: 1 },
  style: { fg: 'white', bg: 'black' },
  content: 'Ctrl+Q quit wrapper  Ctrl+W scroll mode  PageUp/PageDown scroll',
});

function cleanup(code = 0) {
  try {
    terminal.kill();
  } catch {
    // The child may have already exited.
  }
  screen.destroy();
  process.exit(code);
}

screen.key(['C-q'], () => cleanup(0));
screen.key(['C-c'], () => cleanup(130));

screen.on('resize', () => {
  terminal.width = screen.width;
  terminal.height = Math.max(5, screen.height - 5);
  screen.render();
});

terminal.on('exit', (code) => {
  screen.destroy();
  process.exit(typeof code === 'number' ? code : 0);
});

screen.append(terminal);
terminal.focus();
screen.render();
