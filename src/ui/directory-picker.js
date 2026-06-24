'use strict';

const fs = require('fs');
const path = require('path');
const blessed = require('blessed');

const DEFAULT_HELP = '↑/↓ move  ←/h parent  →/l child  n new directory  Enter choose selected  Esc/q cancel';

function directoryNameError(name) {
  if (!name) return 'Directory name is required.';
  if (name === '.' || name === '..') return 'Directory name cannot be . or ..';
  if (path.isAbsolute(name)) return 'Directory name must be relative.';
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return 'Directory name cannot contain path separators.';
  return '';
}

function createDirectoryPicker({ screen, askInput, focusOnClose, usableCwd, truncate }) {
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
    scrollbar: { ch: ' ', track: { bg: 'black' }, style: { bg: 'green' } },
    style: {
      border: { fg: 'green' },
      selected: { fg: 'black', bg: 'green', bold: true },
      item: { fg: 'white' },
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
    style: { border: { fg: 'green' }, fg: 'white', bg: 'black' },
  });

  let state = null;

  const isOpen = () => Boolean(state);

  const setHelp = (text = DEFAULT_HELP, isError = false) => {
    help.setContent(text);
    help.style.fg = isError ? 'red' : 'white';
  };

  const entriesFor = (dir) => {
    const resolved = usableCwd(dir);
    const entries = [{ label: `./  ${resolved}`, path: resolved, type: 'current' }];
    let children = [];
    try {
      children = fs.readdirSync(resolved, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          label: `${entry.name}/`,
          path: path.join(resolved, entry.name),
          type: 'child',
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch {
      children = [];
    }
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
    const resolved = usableCwd(dir);
    const entries = entriesFor(resolved);
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

    const target = path.join(parent, name);
    try {
      fs.mkdirSync(target);
    } catch (err) {
      setHelp(`error: ${err.message}`, true);
      screen.render();
      return;
    }

    render(target);
    setHelp(`Created ${name}. Enter choose selected, ← parent, n new directory.`);
    screen.render();
  };

  const ask = (startDir) => new Promise((resolve) => {
    state = { resolve, dir: usableCwd(startDir), entries: [] };
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
