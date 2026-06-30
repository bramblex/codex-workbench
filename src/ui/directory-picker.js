'use strict';

const path = require('path');
require('./blessed-compat');
const blessed = require('blessed');
const { createChildDirectory, directoryNameError, listDirectories } = require('../model/directories');

const DEFAULT_HELP = '↑/↓ move  ←/h parent  →/l child  n new directory  Enter choose selected  Esc/q cancel';
const color = (hex) => blessed.colors.match(hex);

const FALLBACK_THEME = {
  bg: color('#111c2f'),
  surface: color('#172554'),
  surfaceRaised: color('#1e3a8a'),
  text: color('#f8fafc'),
  textOnAccent: color('#ffffff'),
  project: color('#86efac'),
  selectedProject: color('#15803d'),
  danger: color('#fb7185'),
};

const DEFAULT_OPS = {
  listDirectories: (dir) => listDirectories(dir),
  createDirectory: (parent, name) => createChildDirectory(parent, name),
};

function createDirectoryPicker({ screen, askInput, focusOnClose, theme = FALLBACK_THEME, truncate }) {
  const list = blessed.list({
    parent: screen,
    label: ' Choose directory ',
    top: 'center',
    left: 'center',
    width: '80%',
    height: '70%',
    border: 'line',
    hidden: true,
    mouse: true,
    keys: true,
    vi: false,
    scrollbar: { ch: ' ', track: { bg: theme.surfaceRaised || theme.surface }, style: { bg: theme.project } },
    style: {
      bg: theme.surfaceRaised || theme.surface,
      border: { fg: theme.project, bg: theme.surfaceRaised || theme.surface },
      label: { fg: theme.project, bg: theme.surfaceRaised || theme.surface },
      selected: { fg: theme.textOnAccent || theme.text, bg: theme.selectedProject || theme.project, bold: true },
      item: { fg: theme.text, bg: theme.surfaceRaised || theme.surface },
    },
  });

  const help = blessed.box({
    parent: screen,
    hidden: true,
    left: 'center',
    width: '80%',
    height: 3,
    border: 'line',
    padding: { left: 1, right: 1 },
    content: DEFAULT_HELP,
    style: {
      bg: theme.surface,
      border: { fg: theme.project, bg: theme.surface },
      fg: theme.text,
      label: { fg: theme.project, bg: theme.surface },
    },
  });

  let state = null;

  const isOpen = () => Boolean(state);

  const setHelp = (text = DEFAULT_HELP, isError = false) => {
    help.setContent(text);
    help.style.fg = isError ? theme.danger : theme.text;
    help.style.bg = theme.surface;
  };

  const entriesFor = (dir) => {
    const payload = state.ops.listDirectories(dir);
    const resolved = payload.cwd;
    const entries = [{ label: `./  ${resolved}`, path: resolved, type: 'current' }];
    const children = (payload.entries || [])
      .map((entry) => ({
        label: `${entry.name || path.basename(entry.path)}/`,
        path: entry.path,
        type: 'child',
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return entries.concat(children);
  };

  const applyLayout = () => {
    const width = screen.width || 80;
    const height = screen.height || 24;
    const pickerWidth = Math.max(40, Math.floor(width * 0.8));
    const pickerHeight = Math.max(10, Math.min(height - 6, Math.floor(height * 0.7)));
    const pickerTop = Math.max(1, Math.floor((height - pickerHeight - 3) / 2));
    const pickerLeft = Math.max(0, Math.floor((width - pickerWidth) / 2));

    list.width = pickerWidth;
    list.height = pickerHeight;
    list.top = pickerTop;
    list.left = pickerLeft;

    help.width = pickerWidth;
    help.top = pickerTop + pickerHeight;
    help.left = pickerLeft;
  };

  const render = (dir, selectedPath = null) => {
    if (!state) return;
    let entries = [];
    try {
      entries = entriesFor(dir);
    } catch (err) {
      setHelp(`error: ${err.message}`, true);
      screen.render();
      return;
    }
    const resolved = entries[0] ? entries[0].path : dir;
    const selectedIndex = Math.max(0, entries.findIndex((entry) => selectedPath && entry.path === selectedPath));
    state.dir = resolved;
    state.entries = entries;
    applyLayout();
    setHelp();
    list.setLabel(` Choose directory: ${truncate(resolved, Math.max(24, (screen.width || 80) - 20))} `);
    list.clearItems();
    list.setItems(entries.map((entry) => entry.label));
    list.select(selectedIndex);
    list.scrollTo(selectedIndex);
  };

  const close = (value) => {
    if (!state) return;
    const { resolve } = state;
    state = null;
    list.hide();
    help.hide();
    focusOnClose();
    resolve(value);
  };

  const confirmSelection = (index = list.selected) => {
    if (!state) return;
    const entry = state.entries[index];
    if (!entry) return;
    close(entry.path);
  };

  const createDirectory = async () => {
    if (!state) return;
    const parent = state.dir;
    const rawName = await askInput('New directory name', '');
    list.focus();
    if (rawName === null) {
      screen.render();
      return;
    }
    const name = rawName.trim();
    const validationError = directoryNameError(name);
    if (validationError) {
      setHelp(`error: ${validationError}`, true);
      screen.render();
      return;
    }

    let target = '';
    try {
      target = state.ops.createDirectory(parent, name);
    } catch (err) {
      setHelp(`error: ${err.message}`, true);
      screen.render();
      return;
    }

    render(target);
    setHelp(`Created ${name}. Enter choose selected, ← parent, n new directory.`);
    screen.render();
  };

  const ask = (startDir, ops = DEFAULT_OPS) => new Promise((resolve) => {
    state = { resolve, dir: startDir, entries: [], ops };
    render(startDir);
    list.show();
    help.show();
    list.focus();
    screen.render();
  });

  list.key(['enter'], () => {
    confirmSelection();
  });

  list.key(['up', 'k'], () => {
    if (!state) return;
    list.up();
    screen.render();
  });

  list.key(['down', 'j'], () => {
    if (!state) return;
    list.down();
    screen.render();
  });

  list.key(['n'], () => {
    createDirectory();
  });

  list.key(['escape', 'q'], () => {
    close(null);
  });

  list.key(['left', 'h'], () => {
    if (!state) return;
    const current = state.dir;
    const parent = path.dirname(current);
    if (parent === current) return;
    render(parent, current);
    screen.render();
  });

  list.key(['right', 'l'], () => {
    if (!state) return;
    const entry = state.entries[list.selected];
    if (!entry || entry.type !== 'child') return;
    render(entry.path);
    screen.render();
  });

  return {
    applyLayout,
    ask,
    isOpen,
  };
}

module.exports = {
  createDirectoryPicker,
  directoryNameError,
};
