'use strict';

const path = require('path');
const blessed = require('blessed');
const { printList, printShow } = require('../cli-output');
const { deleteSessionFile, listSessions, updateMetadata } = require('../model/session-store');
const { localTime, shortId, truncate } = require('../model/format');
const { runCodexCommand, runNewCodexSession, usableCwd } = require('../services/codex-runner');
const { createDirectoryPicker } = require('./directory-picker');

async function runWorkbench() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return printList(listSessions());
  }

  let sessions = [];
  let groups = [];
  let groupIndex = 0;
  let selected = 0;
  let message = '';
  let syncingList = false;
  let syncingProjects = false;
  let projectWidth = 32;
  let activePanel = 'projects';

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'Codex Workbench',
  });

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    padding: { left: 1, right: 1 },
    style: { fg: 'white', bg: 'blue' },
    content: 'Codex Workbench',
  });

  const projectsList = blessed.list({
    parent: screen,
    label: ' Projects ',
    top: 3,
    left: 0,
    width: projectWidth,
    bottom: 3,
    border: 'line',
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

  const sessionsList = blessed.list({
    parent: screen,
    label: ' Sessions ',
    top: 3,
    left: projectWidth,
    right: 0,
    height: '40%',
    border: 'line',
    mouse: true,
    keys: true,
    vi: false,
    scrollbar: { ch: ' ', track: { bg: 'black' }, style: { bg: 'cyan' } },
    style: {
      border: { fg: 'cyan' },
      selected: { fg: 'black', bg: 'cyan', bold: true },
      item: { fg: 'white' },
    },
  });

  const detailBox = blessed.log({
    parent: screen,
    label: ' Details ',
    top: '50%',
    left: projectWidth,
    right: 0,
    bottom: 3,
    border: 'line',
    padding: { left: 1, right: 1 },
    scrollable: true,
    mouse: true,
    keys: true,
    vi: true,
    alwaysScroll: true,
    tags: false,
    parseTags: false,
    scrollbar: { ch: ' ', track: { bg: 'black' }, style: { bg: 'cyan' } },
    style: { border: { fg: 'cyan' }, fg: 'white' },
  });

  const status = blessed.box({
    parent: screen,
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    padding: { left: 1, right: 1 },
    style: { fg: 'white', bg: 'black' },
  });

  const prompt = blessed.prompt({
    parent: screen,
    border: 'line',
    height: 8,
    width: '70%',
    top: 'center',
    left: 'center',
    padding: { left: 1, right: 1 },
    style: { border: { fg: 'yellow' }, fg: 'white', bg: 'black' },
  });

  const question = blessed.question({
    parent: screen,
    border: 'line',
    height: 6,
    width: '70%',
    top: 'center',
    left: 'center',
    padding: { left: 1, right: 1 },
    style: { border: { fg: 'red' }, fg: 'white', bg: 'black' },
  });

  const currentSessions = () => {
    const group = groups[groupIndex];
    return group === 'All' ? sessions : sessions.filter((s) => s.cwd === group);
  };

  const selectedSession = () => currentSessions()[selected] || null;

  const groupLabel = (group) => {
    if (group === 'All') return `All (${sessions.length})`;
    const count = sessions.filter((s) => s.cwd === group).length;
    return `${path.basename(group) || group} (${count})`;
  };

  const projectLabel = (group) => {
    if (group === 'All') return groupLabel(group);
    const count = sessions.filter((s) => s.cwd === group).length;
    const base = path.basename(group) || group;
    return `${truncate(base, Math.max(10, projectWidth - 10))} (${count})`;
  };

  const sessionLabel = (session) => {
    const flags = [
      session.name ? 'renamed' : '',
      session.note ? 'note' : '',
    ].filter(Boolean).join(',');
    const title = session.name || session.first || session.last || '(no prompt)';
    const flagText = flags ? `[${flags}]` : '';
    return `${shortId(session.id)}  ${String(session.turns).padStart(2)}t  ${truncate(localTime(session.updatedAt), 18)}  ${flagText} ${truncate(title, 90)}`;
  };

  const detailContent = (session) => {
    if (!session) return 'No sessions in this project.';
    const title = session.name || session.first || session.last || '(no prompt)';
    return [
      title,
      '',
      `id:       ${session.id}`,
      `cwd:      ${session.cwd}`,
      `started:  ${localTime(session.startedAt)}`,
      `updated:  ${localTime(session.updatedAt)}`,
      `turns:    ${session.turns}`,
      session.note ? `note:     ${session.note}` : '',
      '',
      `last user:      ${session.last || session.first || ''}`,
      '',
      `last assistant: ${session.lastAssistant || ''}`,
    ].filter((line) => line !== '').join('\n');
  };

  const setMessage = (text, isError = false) => {
    message = text || 'Ready';
    status.style.fg = isError ? 'red' : 'white';
  };

  const reload = () => {
    sessions = listSessions().filter((s) => !s.archived && !s.hidden);
    groups = ['All', ...new Set(sessions.map((s) => s.cwd))];
    if (groupIndex >= groups.length) groupIndex = Math.max(0, groups.length - 1);
    const visible = currentSessions();
    if (selected >= visible.length) selected = Math.max(0, visible.length - 1);
  };

  const applyLayout = () => {
    const width = screen.width || 80;
    const height = screen.height || 24;
    projectWidth = Math.min(42, Math.max(24, Math.floor(width * 0.28)));
    const top = 3;
    const bottom = 3;
    const available = Math.max(10, height - top - bottom);
    const sessionsHeight = Math.max(7, Math.floor(available * 0.45));

    projectsList.width = projectWidth;
    projectsList.top = top;
    projectsList.bottom = bottom;

    sessionsList.left = projectWidth;
    sessionsList.top = top;
    sessionsList.height = sessionsHeight;

    detailBox.left = projectWidth;
    detailBox.top = top + sessionsHeight;
    detailBox.bottom = bottom;
  };

  const syncProjects = () => {
    const items = groups.length ? groups.map(projectLabel) : ['No projects'];
    syncingProjects = true;
    projectsList.clearItems();
    projectsList.setItems(items);
    projectsList.select(groupIndex);
    projectsList.scrollTo(groupIndex);
    syncingProjects = false;
  };

  const syncList = () => {
    const visible = currentSessions();
    const listRows = Math.max(1, (sessionsList.height || Math.floor((screen.height || 24) * 0.4)) - 2);
    const items = visible.length ? visible.map(sessionLabel) : ['No sessions in this project.'];
    while (items.length < listRows) items.push('');
    syncingList = true;
    sessionsList.clearItems();
    sessionsList.setItems(items);
    selected = Math.min(selected, Math.max(0, visible.length - 1));
    sessionsList.childBase = 0;
    sessionsList.childOffset = 0;
    sessionsList.select(selected);
    sessionsList.scrollTo(0);
    syncingList = false;
  };

  const setPanelLabel = (panel, title, focused, fg) => {
    panel.setLabel(focused ? ` > ${title} ` : `   ${title} `);
    if (!panel._label) return;
    panel._label.style.fg = focused ? fg : 'white';
    panel._label.style.bg = 'default';
    panel._label.style.bold = focused;
  };

  const updateFocusStyles = () => {
    const projectFocused = activePanel === 'projects';
    const sessionsFocused = activePanel === 'sessions';
    const detailFocused = activePanel === 'details';

    projectsList.style.border.fg = projectFocused ? 'green' : 'gray';
    sessionsList.style.border.fg = sessionsFocused ? 'cyan' : 'gray';
    detailBox.style.border.fg = detailFocused ? 'yellow' : 'gray';
    projectsList.style.selected.bg = projectFocused ? 'green' : 'gray';
    projectsList.style.selected.fg = 'black';
    sessionsList.style.selected.bg = sessionsFocused ? 'cyan' : 'gray';
    sessionsList.style.selected.fg = 'black';

    setPanelLabel(projectsList, `Projects (${Math.max(0, groups.length - 1)})`, projectFocused, 'green');
    setPanelLabel(sessionsList, 'Sessions', sessionsFocused, 'cyan');
    setPanelLabel(detailBox, 'Details', detailFocused, 'yellow');

    const firstLine = message || 'Ready';
    if (projectFocused) {
      status.setContent(`${firstLine}\nProjects: ↑/↓ select project  n new project  →/Enter sessions  Tab focus  q quit`);
    } else if (detailFocused) {
      status.setContent(`${firstLine}\nDetails: ↑/↓ scroll  n new session  ← sessions  → projects  Tab focus  q quit`);
    } else {
      status.setContent(`${firstLine}\nSessions: ↑/↓ select  Enter resume  r rename  n new session  f fork  v view  o note  a archive  d delete  q quit`);
    }
  };

  const render = () => {
    applyLayout();
    const visible = currentSessions();
    header.setContent(` Codex Workbench\n ${visible.length}/${sessions.length} visible  ${groups[groupIndex] === 'All' ? 'All projects' : groups[groupIndex]}`);
    detailBox.setContent(detailContent(selectedSession()));
    updateFocusStyles();
    screen.render();
  };

  const focusPanel = (panel, panelName) => {
    activePanel = panelName;
    panel.focus();
    updateFocusStyles();
    screen.render();
  };

  const askInput = (label, initial = '') => new Promise((resolve) => {
    prompt.setFront();
    prompt.input(label, initial, (err, value) => resolve(err ? null : value));
  });

  const askConfirm = (label) => new Promise((resolve) => {
    question.setFront();
    question.ask(label, (err, answer) => resolve(!err && Boolean(answer)));
  });

  const directoryPicker = createDirectoryPicker({
    askInput,
    focusOnClose: () => focusPanel(projectsList, 'projects'),
    screen,
    truncate,
    usableCwd,
  });

  const promptOpen = () => prompt.visible || question.visible || directoryPicker.isOpen();

  const leaveScreen = () => {
    screen.destroy();
  };

  const refreshAfterAction = (text, isError = false, focusCwd = null) => {
    setMessage(text, isError);
    reload();
    if (focusCwd) {
      const nextGroupIndex = groups.indexOf(focusCwd);
      if (nextGroupIndex !== -1) groupIndex = nextGroupIndex;
    }
    syncProjects();
    syncList();
    render();
  };

  const selectGroup = (index) => {
    if (!groups.length) return;
    groupIndex = Math.max(0, Math.min(groups.length - 1, index));
    selected = 0;
    syncProjects();
    syncList();
    render();
  };

  const runCodexAndReturn = (command, session, args = [], doneText = `${command} finished.`) => {
    screen.leave();
    let status = 0;
    try {
      status = runCodexCommand(command, session, args);
    } finally {
      screen.enter();
    }
    if (status === 0) refreshAfterAction(doneText);
    else refreshAfterAction(`${command} exited with code ${status}.`, true);
    return status;
  };

  const currentProjectCwd = () => {
    const group = groups[groupIndex];
    if (group && group !== 'All') return group;
    const session = selectedSession();
    return session && session.cwd && session.cwd !== '(unknown)' ? session.cwd : process.cwd();
  };

  const runNewCodexAndReturn = (cwd, args = []) => {
    const resolvedCwd = usableCwd(cwd);
    screen.leave();
    let status = 0;
    try {
      status = runNewCodexSession(resolvedCwd, args);
    } finally {
      screen.enter();
    }
    if (status === 0) refreshAfterAction(`New session finished in ${resolvedCwd}.`, false, resolvedCwd);
    else refreshAfterAction(`new session exited with code ${status}.`, true, resolvedCwd);
    return status;
  };

  const runAction = async (action) => {
    if (promptOpen()) return;
    const session = selectedSession();
    if (!session) return;
    try {
      await action(session);
    } catch (err) {
      setMessage(`error: ${err.message}`, true);
      render();
    }
  };

  reload();
  setMessage('Ready');
  applyLayout();
  syncProjects();
  syncList();

  projectsList.on('select item', (_item, index) => {
    if (syncingProjects) return;
    activePanel = 'projects';
    selectGroup(index);
  });

  projectsList.on('focus', () => {
    activePanel = 'projects';
    updateFocusStyles();
  });

  sessionsList.on('focus', () => {
    activePanel = 'sessions';
    updateFocusStyles();
  });

  detailBox.on('focus', () => {
    activePanel = 'details';
    updateFocusStyles();
  });

  projectsList.key(['j', 'down'], () => {
    if (promptOpen()) return;
    selectGroup(groupIndex + 1);
  });

  projectsList.key(['k', 'up'], () => {
    if (promptOpen()) return;
    selectGroup(groupIndex - 1);
  });

  projectsList.key(['right', 'l', 'enter'], () => {
    if (promptOpen()) return;
    focusPanel(sessionsList, 'sessions');
  });

  sessionsList.on('select item', (_item, index) => {
    if (syncingList) return;
    activePanel = 'sessions';
    const visible = currentSessions();
    if (index >= visible.length) {
      selected = Math.max(0, visible.length - 1);
      sessionsList.select(selected);
      return;
    }
    selected = Math.min(index, Math.max(0, visible.length - 1));
    detailBox.setContent(detailContent(selectedSession()));
    screen.render();
  });

  sessionsList.key(['enter'], () => runAction((session) => {
    runCodexAndReturn('resume', session);
  }));

  sessionsList.key(['j'], () => {
    if (promptOpen()) return;
    sessionsList.down();
    screen.render();
  });

  sessionsList.key(['k'], () => {
    if (promptOpen()) return;
    sessionsList.up();
    screen.render();
  });

  sessionsList.key(['left', 'h'], () => {
    if (promptOpen()) return;
    focusPanel(projectsList, 'projects');
  });

  sessionsList.key(['right', 'l'], () => {
    if (promptOpen()) return;
    focusPanel(detailBox, 'details');
  });

  detailBox.key(['left', 'h'], () => {
    if (promptOpen()) return;
    focusPanel(sessionsList, 'sessions');
  });

  detailBox.key(['right', 'l'], () => {
    if (promptOpen()) return;
    focusPanel(projectsList, 'projects');
  });

  screen.on('resize', () => {
    applyLayout();
    if (directoryPicker.isOpen()) directoryPicker.applyLayout();
    syncProjects();
    syncList();
    render();
  });

  screen.key(['tab'], () => {
    if (promptOpen()) return;
    if (activePanel === 'projects') focusPanel(sessionsList, 'sessions');
    else if (activePanel === 'sessions') focusPanel(detailBox, 'details');
    else focusPanel(projectsList, 'projects');
  });

  screen.key(['S-tab'], () => {
    if (promptOpen()) return;
    if (activePanel === 'details') focusPanel(sessionsList, 'sessions');
    else if (activePanel === 'sessions') focusPanel(projectsList, 'projects');
    else focusPanel(detailBox, 'details');
  });

  screen.key(['q', 'escape', 'C-c'], () => {
    if (promptOpen()) return;
    leaveScreen();
    process.exit(0);
  });

  screen.key(['f'], () => runAction((session) => {
    runCodexAndReturn('fork', session);
  }));

  screen.key(['v'], () => runAction((session) => {
    leaveScreen();
    printShow(session);
    process.exit(0);
  }));

  screen.key(['n'], async () => {
    if (promptOpen()) return;
    if (activePanel === 'projects') {
      const dir = await directoryPicker.ask(currentProjectCwd());
      if (!dir) {
        setMessage('New project cancelled.');
        return render();
      }
      runNewCodexAndReturn(dir);
      return;
    }
    runNewCodexAndReturn(currentProjectCwd());
  });

  screen.key(['r'], () => runAction(async (session) => {
    const name = await askInput('Name', session.name || '');
    if (name === null) return render();
    updateMetadata(session, { name });
    refreshAfterAction('Renamed.');
  }));

  screen.key(['o'], () => runAction(async (session) => {
    const note = await askInput('Note', session.note || '');
    if (note === null) return render();
    updateMetadata(session, { note });
    refreshAfterAction('Note saved.');
  }));

  screen.key(['a'], () => runAction((session) => {
    runCodexAndReturn('archive', session, [], `Archived ${shortId(session.id)}.`);
  }));

  screen.key(['d'], () => runAction(async (session) => {
    const confirmed = await askConfirm(`Delete ${shortId(session.id)}? Enter/y to confirm, n/Esc to cancel`);
    if (!confirmed) {
      setMessage('Delete cancelled.');
      return render();
    }
    const status = runCodexAndReturn('delete', session, ['--force'], `Deleted ${shortId(session.id)}.`);
    if (status !== 0) {
      const removeFile = await askConfirm(`Codex could not delete ${shortId(session.id)}. Delete its session file?`);
      if (removeFile) {
        deleteSessionFile(session);
        refreshAfterAction(`Deleted file for ${shortId(session.id)}.`);
        return;
      }
      const hideSession = await askConfirm(`Hide ${shortId(session.id)} from workbench instead?`);
      if (hideSession) {
        updateMetadata(session, { hidden: true });
        refreshAfterAction(`Hidden ${shortId(session.id)}.`);
      }
    }
  }));

  projectsList.focus();
  render();

  return new Promise(() => {});
}

module.exports = {
  runWorkbench,
};
