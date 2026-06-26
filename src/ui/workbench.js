'use strict';

const path = require('path');
require('./blessed-compat');
const blessed = require('blessed');
const pkg = require('../../package.json');
const { printList, printShow } = require('../cli-output');
const { deleteSessionFile } = require('../model/session-store');
const { localTime, shortId, truncate } = require('../model/format');
const {
  LOCAL_SOURCE,
  createSourceDirectory,
  listSourceDirectories,
  listSourceBackends,
  loadLocalWorkbenchSessions,
  loadRemoteSourceSessions,
  loadWorkbenchSessions,
  runSourceNewSession,
  runSourceSessionCommand,
  sourceById,
  updateSourceMetadata,
} = require('../services/session-sources');
const { usableCwd } = require('../services/codex-runner');
const { createDirectoryPicker } = require('./directory-picker');

async function runWorkbench() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return printList(loadWorkbenchSessions().sessions);
  }

  const appTitle = `Codex Workbench v${pkg.version}`;
  let sessions = [];
  let sources = [];
  let sourceErrors = [];
  let groups = [];
  let groupIndex = 0;
  let selected = 0;
  let message = '';
  let syncingList = false;
  let syncingProjects = false;
  let projectWidth = 32;
  let activePanel = 'projects';
  let remoteLoadId = 0;
  let remoteLoading = false;
  let closed = false;

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: appTitle,
  });

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    padding: { left: 1, right: 1 },
    style: { fg: 'white', bg: 'blue' },
    content: appTitle,
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
    tags: true,
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

  const backendPicker = blessed.list({
    parent: screen,
    label: ' Backend ',
    top: 'center',
    left: 'center',
    width: 42,
    height: 8,
    border: 'line',
    hidden: true,
    mouse: true,
    keys: true,
    vi: false,
    style: {
      border: { fg: 'yellow' },
      selected: { fg: 'black', bg: 'yellow', bold: true },
      item: { fg: 'white' },
    },
  });

  let backendPickerState = null;

  const sessionsForSource = (sourceId) => sessions.filter((session) => session.sourceId === sourceId);

  const buildGroups = () => {
    const nextGroups = [{ kind: 'all', label: 'All', source: null, cwd: null }];
    for (const source of sources) {
      const sourceSessions = sessionsForSource(source.id);
      nextGroups.push({ kind: 'source', source, cwd: null });
      const cwds = [...new Set(sourceSessions.map((session) => session.cwd))];
      for (const cwd of cwds) {
        nextGroups.push({ kind: 'project', source, cwd });
      }
    }
    return nextGroups;
  };

  const currentGroup = () => groups[groupIndex] || groups[0] || { kind: 'all', source: null, cwd: null };

  const groupKey = (group) => {
    if (!group || group.kind === 'all') return 'all';
    if (group.kind === 'source') return `source:${group.source.id}`;
    return `project:${group.source.id}:${group.cwd}`;
  };

  const restoreGroupKey = (key) => {
    const index = groups.findIndex((group) => groupKey(group) === key);
    if (index !== -1) groupIndex = index;
  };

  const currentSessions = () => {
    const group = currentGroup();
    if (group.kind === 'all') return sessions;
    if (group.kind === 'source') return sessionsForSource(group.source.id);
    return sessions.filter((session) => session.sourceId === group.source.id && session.cwd === group.cwd);
  };

  const selectedSession = () => currentSessions()[selected] || null;

  const groupDisplayName = (group) => {
    if (group.kind === 'all') return 'All sources';
    if (group.kind === 'source') return group.source.label;
    return `${group.source.label}: ${group.cwd}`;
  };

  const sourceShortcut = (source) => {
    const index = sources.findIndex((item) => item.id === source.id);
    return index >= 0 && index < 9 ? String(index + 1) : '';
  };

  const styledListLabel = (color, text) => `{${color}-fg}{bold}${blessed.escape(text)}{/}`;

  const machineLabel = (source, count) => {
    const shortcut = sourceShortcut(source);
    const prefix = shortcut ? `${shortcut} ` : '';
    const maxLabel = Math.max(8, projectWidth - 18);
    const text = `${prefix}${truncate(source.label, maxLabel)} (${count})`;
    const width = Math.max(12, projectWidth - 4);
    const head = `= ${text} `;
    const line = `${head}${'='.repeat(width)}`.slice(0, width);
    return styledListLabel('yellow', line);
  };

  const projectLabel = (group) => {
    if (group.kind === 'all') return styledListLabel('white', `0 All (${sessions.length})`);
    if (group.kind === 'source') {
      const count = sessionsForSource(group.source.id).length;
      return machineLabel(group.source, count);
    }
    const count = sessions.filter((session) => session.sourceId === group.source.id && session.cwd === group.cwd).length;
    const base = path.basename(group.cwd) || group.cwd;
    return `  ${blessed.escape(`${truncate(base, Math.max(10, projectWidth - 12))} (${count})`)}`;
  };

  const sessionLabel = (session) => {
    const flags = [
      session.backend || '',
      session.name ? 'renamed' : '',
      session.note ? 'note' : '',
    ].filter(Boolean).join(',');
    const title = session.name || session.first || session.last || '(no prompt)';
    const flagText = flags ? `[${flags}]` : '';
    return `${shortId(session.id)}  ${String(session.turns).padStart(2)}t  ${truncate(localTime(session.updatedAt), 18)}  ${flagText} ${truncate(title, 88)}`;
  };

  const detailContent = (session) => {
    if (!session) return 'No sessions in this project.';
    const title = session.name || session.first || session.last || '(no prompt)';
    return [
      title,
      '',
      `id:       ${session.id}`,
      `backend:  ${session.backend || 'unknown'}`,
      `source:   ${session.sourceLabel || 'Local'}`,
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

  const visibleSession = (session) => !session.archived;

  const sortSessionList = (list) => {
    list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return list;
  };

  const setSourceErrorMessage = () => {
    if (!sourceErrors.length) return false;
    const first = sourceErrors[0];
    const detail = `${first.source.label}: ${first.error}`;
    const prefix = sourceErrors.length === 1 ? 'Remote source failed' : `${sourceErrors.length} remote sources failed`;
    setMessage(`${prefix}: ${truncate(detail, 100)}`, true);
    return true;
  };

  const updateSessionViews = (preferredGroupKey = groupKey(currentGroup())) => {
    groups = buildGroups();
    restoreGroupKey(preferredGroupKey);
    if (groupIndex >= groups.length) groupIndex = Math.max(0, groups.length - 1);
    const visible = currentSessions();
    if (selected >= visible.length) selected = Math.max(0, visible.length - 1);
  };

  const reloadLocal = (preserveRemote = true) => {
    const preferredGroupKey = groupKey(currentGroup());
    const state = loadLocalWorkbenchSessions();
    const sourceIds = new Set(state.sources.map((source) => source.id));
    const remoteSessions = preserveRemote
      ? sessions.filter((session) => session.sourceRemote && sourceIds.has(session.sourceId))
      : [];
    sources = state.sources;
    sourceErrors = sourceErrors.filter((item) => sourceIds.has(item.source.id));
    sessions = sortSessionList([...state.sessions, ...remoteSessions].filter(visibleSession));
    updateSessionViews(preferredGroupKey);
  };

  const replaceSourceSessions = (source, sourceSessions) => {
    const preferredGroupKey = groupKey(currentGroup());
    sessions = sortSessionList([
      ...sessions.filter((session) => session.sourceId !== source.id),
      ...sourceSessions.filter(visibleSession),
    ]);
    updateSessionViews(preferredGroupKey);
  };

  const renderRemoteUpdate = () => {
    if (closed) return;
    syncProjects();
    syncList();
    render();
  };

  const startRemoteReload = (quiet = false) => {
    const remoteSources = sources.filter((source) => source.remote);
    remoteLoadId += 1;
    const loadId = remoteLoadId;
    sourceErrors = [];
    if (!remoteSources.length) {
      remoteLoading = false;
      return;
    }

    remoteLoading = true;
    let completed = 0;
    if (!quiet && (!message || message === 'Ready')) {
      setMessage(`Loading ${remoteSources.length} remote source${remoteSources.length === 1 ? '' : 's'}...`);
      renderRemoteUpdate();
    }

    for (const source of remoteSources) {
      loadRemoteSourceSessions(source)
        .then((sourceSessions) => {
          if (closed || loadId !== remoteLoadId) return;
          replaceSourceSessions(source, sourceSessions);
        })
        .catch((err) => {
          if (closed || loadId !== remoteLoadId) return;
          sourceErrors.push({ source, error: err.message });
        })
        .finally(() => {
          if (closed || loadId !== remoteLoadId) return;
          completed += 1;
          remoteLoading = completed < remoteSources.length;
          if (remoteLoading) {
            if (!quiet && message.startsWith('Loading ')) {
              setMessage(`Loading remote sources... ${completed}/${remoteSources.length}`);
            }
          } else if (sourceErrors.length) {
            setSourceErrorMessage();
          } else if (message.startsWith('Loading ')) {
            setMessage('Remote sources loaded.');
          }
          renderRemoteUpdate();
        });
    }
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

    setPanelLabel(projectsList, `Sources (${sources.length})`, projectFocused, 'green');
    setPanelLabel(sessionsList, 'Sessions', sessionsFocused, 'cyan');
    setPanelLabel(detailBox, 'Details', detailFocused, 'yellow');

    const firstLine = message || 'Ready';
    if (projectFocused) {
      status.setContent(`${firstLine}\nSources: ↑/↓ select  0 all  1-9 machine  [/] prev/next  n new  → sessions  q quit`);
    } else if (detailFocused) {
      status.setContent(`${firstLine}\nDetails: ↑/↓ scroll  1-9 machine  [/] prev/next  n new  ← sessions  q quit`);
    } else {
      status.setContent(`${firstLine}\nSessions: ↑/↓ select  Enter resume  1-9 machine  [/] prev/next  r rename  n new  d delete`);
    }
  };

  const render = () => {
    applyLayout();
    const visible = currentSessions();
    header.setContent(` ${appTitle}\n ${visible.length}/${sessions.length} visible  ${groupDisplayName(currentGroup())}`);
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

  const askBackend = (source) => new Promise((resolve) => {
    let backends = [];
    try {
      backends = listSourceBackends(source);
    } catch (err) {
      setMessage(`error: ${err.message}`, true);
      render();
      resolve(null);
      return;
    }
    if (backends.length <= 1) {
      resolve(backends[0] ? backends[0].id : null);
      return;
    }

    backendPickerState = { backends, resolve };
    backendPicker.clearItems();
    backendPicker.setItems(backends.map((backend) => `${backend.id}  ${backend.label || backend.id}`));
    backendPicker.select(0);
    backendPicker.show();
    backendPicker.setFront();
    backendPicker.focus();
    screen.render();
  });

  const directoryPicker = createDirectoryPicker({
    askInput,
    focusOnClose: () => focusPanel(projectsList, 'projects'),
    screen,
    truncate,
  });

  const closeBackendPicker = (backend = null) => {
    if (!backendPickerState) return;
    const { resolve } = backendPickerState;
    backendPickerState = null;
    backendPicker.hide();
    focusPanel(sessionsList, 'sessions');
    resolve(backend);
  };

  const promptOpen = () => prompt.visible || question.visible || directoryPicker.isOpen() || Boolean(backendPickerState);

  const leaveScreen = () => {
    closed = true;
    screen.destroy();
  };

  const refreshAfterAction = (text, isError = false, focusCwd = null, focusSourceId = null) => {
    setMessage(text, isError);
    reloadLocal();
    if (focusCwd) {
      const nextGroupIndex = groups.findIndex((group) => {
        return group.kind === 'project' &&
          group.cwd === focusCwd &&
          (!focusSourceId || group.source.id === focusSourceId);
      });
      if (nextGroupIndex !== -1) groupIndex = nextGroupIndex;
    }
    syncProjects();
    syncList();
    render();
    startRemoteReload(true);
  };

  const selectGroup = (index) => {
    if (!groups.length) return;
    groupIndex = Math.max(0, Math.min(groups.length - 1, index));
    selected = 0;
    syncProjects();
    syncList();
    render();
  };

  const selectSourceIndex = (sourceIndex) => {
    const source = sources[sourceIndex];
    if (!source) return;
    const nextIndex = groups.findIndex((group) => group.kind === 'source' && group.source.id === source.id);
    if (nextIndex === -1) return;
    selectGroup(nextIndex);
    setMessage(`Switched to ${source.label}.`);
    render();
  };

  const currentSourceIndex = () => {
    const group = currentGroup();
    if (group.kind === 'source' || group.kind === 'project') {
      return sources.findIndex((source) => source.id === group.source.id);
    }
    const session = selectedSession();
    if (session) return sources.findIndex((source) => source.id === session.sourceId);
    return -1;
  };

  const switchSource = (delta) => {
    if (!sources.length) return;
    const currentIndex = currentSourceIndex();
    const nextIndex = currentIndex === -1
      ? (delta > 0 ? 0 : sources.length - 1)
      : (currentIndex + delta + sources.length) % sources.length;
    selectSourceIndex(nextIndex);
  };

  const runCodexAndReturn = (command, session, args = [], doneText = `${command} finished.`) => {
    screen.leave();
    let status = 0;
    try {
      status = runSourceSessionCommand(session, command, args);
    } finally {
      screen.enter();
    }
    if (status === 0) refreshAfterAction(doneText);
    else refreshAfterAction(`${command} exited with code ${status}.`, true);
    return status;
  };

  const currentProjectCwd = () => {
    const group = currentGroup();
    if (group.kind === 'project') return group.cwd;
    const session = selectedSession();
    if (session && session.cwd && session.cwd !== '(unknown)') return session.cwd;
    if (group.kind === 'source' && group.source.remote) return '.';
    return process.cwd();
  };

  const currentSource = () => {
    const group = currentGroup();
    if (group.kind === 'source' || group.kind === 'project') return group.source;
    if (activePanel === 'projects') return LOCAL_SOURCE;
    const session = selectedSession();
    return session ? sourceById(sources, session.sourceId) : LOCAL_SOURCE;
  };

  const currentDirectoryStart = () => {
    const group = currentGroup();
    if (group.kind === 'project') return group.cwd;
    return currentSource().remote ? '.' : currentProjectCwd();
  };

  const directoryOpsForSource = (source) => ({
    listDirectories: (dir) => listSourceDirectories(source, dir),
    createDirectory: (parent, name) => createSourceDirectory(source, parent, name),
  });

  const runNewCodexAndReturn = async (cwd, args = []) => {
    const source = currentSource();
    const resolvedCwd = source.remote ? cwd : usableCwd(cwd);
    const backend = await askBackend(source);
    if (!backend) {
      setMessage('New session cancelled.');
      render();
      return null;
    }
    screen.leave();
    let status = 0;
    try {
      status = runSourceNewSession(source, resolvedCwd, args, backend);
    } finally {
      screen.enter();
    }
    const label = source.remote ? `${source.label}: ${resolvedCwd}` : `${resolvedCwd} (${backend})`;
    if (status === 0) refreshAfterAction(`New session finished in ${label}.`, false, resolvedCwd, source.id);
    else refreshAfterAction(`new session exited with code ${status}.`, true, resolvedCwd, source.id);
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

  reloadLocal(false);
  const remoteSourceCount = sources.filter((source) => source.remote).length;
  setMessage(remoteSourceCount ? `Loading ${remoteSourceCount} remote source${remoteSourceCount === 1 ? '' : 's'}...` : 'Ready');
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

  // blessed handles up/down natively via keys:true; only bind j/k
  projectsList.key(['j'], () => {
    if (promptOpen()) return;
    selectGroup(groupIndex + 1);
  });

  projectsList.key(['k'], () => {
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

  backendPicker.key(['enter'], () => {
    if (!backendPickerState) return;
    const backend = backendPickerState.backends[backendPicker.selected];
    closeBackendPicker(backend ? backend.id : null);
  });

  backendPicker.key(['escape', 'q'], () => {
    closeBackendPicker(null);
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

  screen.key(['0'], () => {
    if (promptOpen()) return;
    selectGroup(0);
    setMessage('Switched to all sources.');
    render();
  });

  for (let i = 1; i <= 9; i += 1) {
    screen.key([String(i)], () => {
      if (promptOpen()) return;
      selectSourceIndex(i - 1);
    });
  }

  screen.key([']'], () => {
    if (promptOpen()) return;
    switchSource(1);
  });

  screen.key(['['], () => {
    if (promptOpen()) return;
    switchSource(-1);
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
      const source = currentSource();
      const dir = await directoryPicker.ask(currentDirectoryStart(), directoryOpsForSource(source));
      if (!dir) {
        setMessage('New project cancelled.');
        return render();
      }
      await runNewCodexAndReturn(dir);
      return;
    }
    await runNewCodexAndReturn(currentProjectCwd());
  });

  screen.key(['r'], () => runAction(async (session) => {
    const name = await askInput('Name', session.name || '');
    if (name === null) return render();
    const status = updateSourceMetadata(session, { name });
    refreshAfterAction(status === 0 ? 'Renamed.' : `rename exited with code ${status}.`, status !== 0);
  }));

  screen.key(['o'], () => runAction(async (session) => {
    const note = await askInput('Note', session.note || '');
    if (note === null) return render();
    const status = updateSourceMetadata(session, { note });
    refreshAfterAction(status === 0 ? 'Note saved.' : `note exited with code ${status}.`, status !== 0);
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
      if (session.sourceRemote) {
        setMessage(`Remote delete failed for ${shortId(session.id)}.`, true);
        render();
        return;
      }
      const removeFile = await askConfirm(`Codex could not delete ${shortId(session.id)}. Delete its session file?`);
      if (removeFile) {
        deleteSessionFile(session);
        refreshAfterAction(`Deleted file for ${shortId(session.id)}.`);
        return;
      }
    }
  }));

  projectsList.focus();
  render();
  startRemoteReload(true);

  return new Promise(() => {});
}

module.exports = {
  runWorkbench,
};
