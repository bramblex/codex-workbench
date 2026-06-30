'use strict';

const path = require('path');
const React = require('react');
const pkg = require('../../package.json');
const { printList } = require('../cli-output');
const { deleteSessionFile } = require('../model/session-store');
const { localTime, shortId, truncate } = require('../model/format');
const { SessionLockError } = require('../services/session-locks');
const {
  LOCAL_SOURCE,
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
const { checkForUpdate } = require('../services/update-checker');

const h = React.createElement;

const THEME = {
  bg: 'blue',
  panel: 'blue',
  borderIdle: 'white',
  text: 'white',
  muted: 'cyan',
  accent: 'cyan',
  project: 'green',
  detail: 'yellow',
  warning: 'yellow',
  danger: 'red',
  selected: 'magenta',
  header: 'blueBright',
};

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function sessionsForSource(sessions, sourceId) {
  return sessions.filter((session) => session.sourceId === sourceId);
}

function buildGroups(sessions, sources) {
  const groups = [{ kind: 'all', label: 'All', source: null, cwd: null }];
  for (const source of sources) {
    const sourceSessions = sessionsForSource(sessions, source.id);
    groups.push({ kind: 'source', source, cwd: null });
    for (const cwd of [...new Set(sourceSessions.map((session) => session.cwd))]) {
      groups.push({ kind: 'project', source, cwd });
    }
  }
  return groups;
}

function groupKey(group) {
  if (!group || group.kind === 'all') return 'all';
  if (group.kind === 'source') return `source:${group.source.id}`;
  return `project:${group.source.id}:${group.cwd}`;
}

function groupSessions(group, sessions) {
  if (!group || group.kind === 'all') return sessions;
  if (group.kind === 'source') return sessionsForSource(sessions, group.source.id);
  return sessions.filter((session) => session.sourceId === group.source.id && session.cwd === group.cwd);
}

function sessionMatchesSearch(session, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    session.backend,
    session.cwd,
    session.first,
    session.id,
    session.last,
    session.lastAssistant,
    session.name,
    session.note,
    session.provider,
    session.sourceLabel,
  ].filter(Boolean).join('\n').toLowerCase().includes(needle);
}

function groupTitle(group, sessions, projectWidth) {
  if (!group || group.kind === 'all') return `0 All (${sessions.length})`;
  if (group.kind === 'source') {
    const text = `${group.source.label} (${sessionsForSource(sessions, group.source.id).length})`;
    const width = Math.max(12, projectWidth - 4);
    return `= ${text} ${'='.repeat(width)}`.slice(0, width);
  }
  const count = sessions.filter((session) => session.sourceId === group.source.id && session.cwd === group.cwd).length;
  return `  ${truncate(path.basename(group.cwd) || group.cwd, Math.max(10, projectWidth - 10))} (${count})`;
}

function displayTitle(session) {
  return session.name || session.first || session.last || '(no prompt)';
}

function fixedWidth(text, width) {
  const value = truncate(String(text || ''), width);
  return value + ' '.repeat(Math.max(0, width - value.length));
}

function currentSourceFor(group, session, sources) {
  if (group && (group.kind === 'source' || group.kind === 'project')) return group.source;
  return session ? sourceById(sources, session.sourceId) : LOCAL_SOURCE;
}

function currentCwdFor(group, session) {
  if (group && group.kind === 'project') return group.cwd;
  if (group && group.kind === 'source' && group.source.remote) return '.';
  if (group && group.kind === 'source') return process.cwd();
  if (session && session.cwd && session.cwd !== '(unknown)') return session.cwd;
  return process.cwd();
}

function boxProps(focused, color, extra = {}) {
  return {
    borderStyle: 'single',
    borderColor: focused ? color : THEME.borderIdle,
    paddingX: 1,
    flexDirection: 'column',
    ...extra,
  };
}

function fillLine(width) {
  return ' '.repeat(Math.max(0, width));
}

function usePrompt(ink, state, setState) {
  const { useInput } = ink;
  useInput((input, key) => {
    if (!state.prompt) return;
    if (key.escape) {
      const resolve = state.prompt.resolve;
      setState((prev) => ({ ...prev, prompt: null, status: 'Cancelled.' }));
      resolve(null);
      return;
    }
    if (key.return) {
      const value = state.prompt.value;
      const resolve = state.prompt.resolve;
      setState((prev) => ({ ...prev, prompt: null }));
      resolve(value);
      return;
    }
    if (key.backspace || key.delete) {
      setState((prev) => ({ ...prev, prompt: { ...prev.prompt, value: prev.prompt.value.slice(0, -1) } }));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setState((prev) => ({ ...prev, prompt: { ...prev.prompt, value: prev.prompt.value + input } }));
    }
  }, { isActive: Boolean(state.prompt) });
}

function useConfirm(ink, state, setState) {
  const { useInput } = ink;
  useInput((input, key) => {
    if (!state.confirm) return;
    if (key.escape || input === 'n' || input === 'q') {
      const resolve = state.confirm.resolve;
      setState((prev) => ({ ...prev, confirm: null, status: 'Cancelled.' }));
      resolve(false);
      return;
    }
    if (key.return || input === 'y') {
      const resolve = state.confirm.resolve;
      setState((prev) => ({ ...prev, confirm: null }));
      resolve(true);
    }
  }, { isActive: Boolean(state.confirm) });
}

function usePicker(ink, state, setState) {
  const { useInput } = ink;
  useInput((input, key) => {
    if (!state.picker) return;
    const max = Math.max(0, state.picker.items.length - 1);
    if (key.downArrow || input === 'j') {
      setState((prev) => ({ ...prev, picker: { ...prev.picker, index: Math.min(max, prev.picker.index + 1) } }));
      return;
    }
    if (key.upArrow || input === 'k') {
      setState((prev) => ({ ...prev, picker: { ...prev.picker, index: Math.max(0, prev.picker.index - 1) } }));
      return;
    }
    if (key.escape || input === 'q') {
      const resolve = state.picker.resolve;
      setState((prev) => ({ ...prev, picker: null, status: 'Cancelled.' }));
      resolve(null);
      return;
    }
    if (key.return) {
      const resolve = state.picker.resolve;
      const item = state.picker.items[state.picker.index] || null;
      setState((prev) => ({ ...prev, picker: null }));
      resolve(item);
    }
  }, { isActive: Boolean(state.picker) });
}

function useTerminalSize(ink) {
  const { useStdout } = ink;
  const { stdout } = useStdout();
  const readSize = React.useCallback(() => ({
    width: stdout.columns || process.stdout.columns || 100,
    height: stdout.rows || process.stdout.rows || 30,
  }), [stdout]);
  const [size, setSize] = React.useState(readSize);
  React.useEffect(() => {
    const onResize = () => setSize(readSize());
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [readSize, stdout]);
  return size;
}

function Workbench({ ink }) {
  const { Box, Text, useApp, useInput } = ink;
  const { exit } = useApp();
  const size = useTerminalSize(ink);
  const [state, setState] = React.useState(() => {
    const local = loadLocalWorkbenchSessions();
    const sessions = sortSessions(local.sessions.filter((session) => !session.archived));
    return {
      active: 'projects',
      closed: false,
      groupIndex: 0,
      groups: buildGroups(sessions, local.sources),
      message: local.sources.some((source) => source.remote) ? 'Loading remote sources...' : 'Ready',
      prompt: null,
      confirm: null,
      picker: null,
      remoteErrors: [],
      remoteLoading: false,
      search: '',
      selected: 0,
      sessions,
      sources: local.sources,
      updateInfo: null,
    };
  });

  const askInput = React.useCallback((label, initial = '') => new Promise((resolve) => {
    setState((prev) => ({ ...prev, prompt: { label, value: initial, resolve } }));
  }), []);

  const askConfirm = React.useCallback((label) => new Promise((resolve) => {
    setState((prev) => ({ ...prev, confirm: { label, resolve } }));
  }), []);

  const askPicker = React.useCallback((label, items) => new Promise((resolve) => {
    setState((prev) => ({ ...prev, picker: { label, items, index: 0, resolve } }));
  }), []);

  const reloadLocal = React.useCallback((preserveRemote = true, preferredKey = null) => {
    setState((prev) => {
      const local = loadLocalWorkbenchSessions();
      const sourceIds = new Set(local.sources.map((source) => source.id));
      const remoteSessions = preserveRemote
        ? prev.sessions.filter((session) => session.sourceRemote && sourceIds.has(session.sourceId))
        : [];
      const sessions = sortSessions([...local.sessions, ...remoteSessions].filter((session) => !session.archived));
      const groups = buildGroups(sessions, local.sources);
      const key = preferredKey || groupKey(prev.groups[prev.groupIndex]);
      const groupIndex = Math.max(0, groups.findIndex((group) => groupKey(group) === key));
      return {
        ...prev,
        groups,
        groupIndex: groupIndex === -1 ? 0 : groupIndex,
        selected: 0,
        sessions,
        sources: local.sources,
      };
    });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const remoteSources = state.sources.filter((source) => source.remote);
    if (!remoteSources.length) return undefined;
    setState((prev) => ({ ...prev, remoteLoading: true }));
    let completed = 0;
    for (const source of remoteSources) {
      loadRemoteSourceSessions(source)
        .then((sourceSessions) => {
          if (cancelled) return;
          setState((prev) => {
            const sessions = sortSessions([
              ...prev.sessions.filter((session) => session.sourceId !== source.id),
              ...sourceSessions.filter((session) => !session.archived),
            ]);
            const key = groupKey(prev.groups[prev.groupIndex]);
            const groups = buildGroups(sessions, prev.sources);
            const nextIndex = groups.findIndex((group) => groupKey(group) === key);
            return {
              ...prev,
              groups,
              groupIndex: nextIndex === -1 ? 0 : nextIndex,
              sessions,
            };
          });
        })
        .catch((err) => {
          if (!cancelled) {
            setState((prev) => ({ ...prev, remoteErrors: [...prev.remoteErrors, { source, error: err.message }] }));
          }
        })
        .finally(() => {
          if (cancelled) return;
          completed += 1;
          if (completed >= remoteSources.length) {
            setState((prev) => ({
              ...prev,
              message: prev.remoteErrors.length ? 'Some remote sources failed.' : 'Remote sources loaded.',
              remoteLoading: false,
            }));
          }
        });
    }
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    let alive = true;
    checkForUpdate(pkg.version).then((info) => {
      if (alive && info && info.updateAvailable) setState((prev) => ({ ...prev, updateInfo: info }));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  usePrompt(ink, state, setState);
  useConfirm(ink, state, setState);
  usePicker(ink, state, setState);

  const currentGroup = state.groups[state.groupIndex] || state.groups[0] || { kind: 'all', source: null, cwd: null };
  const groupSessionList = groupSessions(currentGroup, state.sessions);
  const visibleSessions = groupSessionList.filter((session) => sessionMatchesSearch(session, state.search));
  const selected = Math.min(state.selected, Math.max(0, visibleSessions.length - 1));
  const selectedSession = visibleSessions[selected] || null;

  const setMessage = React.useCallback((message) => setState((prev) => ({ ...prev, message })), []);

  const panelTitle = React.useCallback((title, focused, color) => h(Box, { marginBottom: 1 },
    h(Text, { color: focused ? color : THEME.borderIdle, bold: focused }, `${focused ? '> ' : '  '}${title}`),
  ), [Box, Text]);

  const refreshAfterAction = React.useCallback((message, preferredKey = null) => {
    reloadLocal(true, preferredKey);
    setMessage(message);
  }, [reloadLocal, setMessage]);

  const runAndReturn = React.useCallback((command, session, args = [], doneText = `${command} finished.`, options = {}) => {
    const status = runSourceSessionCommand(session, command, args, options);
    if (status === 0) refreshAfterAction(doneText, groupKey(currentGroup));
    else setMessage(`${command} exited with code ${status}.`);
  }, [currentGroup, refreshAfterAction, setMessage]);

  useInput((input, key) => {
    if (state.prompt || state.confirm || state.picker) return;
    const active = state.active;
    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (key.tab) {
      setState((prev) => ({
        ...prev,
        active: tiny
          ? (prev.active === 'projects' ? 'sessions' : 'projects')
          : (prev.active === 'projects' ? 'sessions' : prev.active === 'sessions' ? 'details' : 'projects'),
      }));
      return;
    }
    if (input === '0') {
      setState((prev) => ({ ...prev, groupIndex: 0, selected: 0, active: 'projects', message: 'Switched to all sources.' }));
      return;
    }
    if (/^[1-9]$/.test(input)) {
      const source = state.sources[Number(input) - 1];
      if (!source) return;
      const index = state.groups.findIndex((group) => group.kind === 'source' && group.source.id === source.id);
      if (index !== -1) setState((prev) => ({ ...prev, groupIndex: index, selected: 0, active: 'projects', message: `Switched to ${source.label}.` }));
      return;
    }
    if (input === ']') {
      const group = currentGroup;
      const currentIndex = group.kind === 'source' || group.kind === 'project'
        ? state.sources.findIndex((source) => source.id === group.source.id)
        : selectedSession ? state.sources.findIndex((source) => source.id === selectedSession.sourceId) : -1;
      const next = currentIndex === -1 ? 0 : (currentIndex + 1) % Math.max(1, state.sources.length);
      const source = state.sources[next];
      const index = source ? state.groups.findIndex((item) => item.kind === 'source' && item.source.id === source.id) : -1;
      if (index !== -1) setState((prev) => ({ ...prev, groupIndex: index, selected: 0, active: 'projects' }));
      return;
    }
    if (input === '[') {
      const group = currentGroup;
      const currentIndex = group.kind === 'source' || group.kind === 'project'
        ? state.sources.findIndex((source) => source.id === group.source.id)
        : selectedSession ? state.sources.findIndex((source) => source.id === selectedSession.sourceId) : -1;
      const next = currentIndex === -1 ? state.sources.length - 1 : (currentIndex - 1 + state.sources.length) % Math.max(1, state.sources.length);
      const source = state.sources[next];
      const index = source ? state.groups.findIndex((item) => item.kind === 'source' && item.source.id === source.id) : -1;
      if (index !== -1) setState((prev) => ({ ...prev, groupIndex: index, selected: 0, active: 'projects' }));
      return;
    }
    if (input === '/') {
      askInput('Search', state.search).then((value) => {
        if (value === null) return;
        setState((prev) => ({ ...prev, search: value.trim(), selected: 0, active: 'sessions' }));
      });
      return;
    }
    if (input === 'x' && state.search) {
      setState((prev) => ({ ...prev, search: '', selected: 0, message: 'Search cleared.' }));
      return;
    }
    if (active === 'projects') {
      if (key.downArrow || input === 'j') {
        setState((prev) => ({ ...prev, groupIndex: Math.min(prev.groups.length - 1, prev.groupIndex + 1), selected: 0 }));
        return;
      }
      if (key.upArrow || input === 'k') {
        setState((prev) => ({ ...prev, groupIndex: Math.max(0, prev.groupIndex - 1), selected: 0 }));
        return;
      }
      if (key.rightArrow || key.return || input === 'l') {
        setState((prev) => ({ ...prev, active: 'sessions' }));
        return;
      }
    }
    if (active === 'sessions') {
      if (key.downArrow || input === 'j') {
        setState((prev) => ({ ...prev, selected: Math.min(visibleSessions.length - 1, prev.selected + 1) }));
        return;
      }
      if (key.upArrow || input === 'k') {
        setState((prev) => ({ ...prev, selected: Math.max(0, prev.selected - 1) }));
        return;
      }
      if (key.leftArrow || input === 'h') {
        setState((prev) => ({ ...prev, active: 'projects' }));
        return;
      }
      if (key.rightArrow || input === 'l') {
        if (!tiny) setState((prev) => ({ ...prev, active: 'details' }));
        return;
      }
      if (key.return && selectedSession) {
        try {
          runAndReturn('resume', selectedSession);
        } catch (err) {
          if (!(err instanceof SessionLockError)) {
            setMessage(`error: ${err.message}`);
            return;
          }
          const lock = err.lock || {};
          const label = `${lock.host || 'unknown'}${lock.pid ? ` pid ${lock.pid}` : ''}`;
          askConfirm(`Session is already open on ${label}. Close it and reopen?`).then((confirmed) => {
            if (!confirmed) return setMessage('Resume cancelled.');
            try {
              runAndReturn('resume', selectedSession, [], 'resume finished.', { force: true });
            } catch (forceErr) {
              setMessage(`error: ${forceErr.message}`);
            }
          });
        }
        return;
      }
    }
    if (active === 'details') {
      if (key.leftArrow || input === 'h') {
        setState((prev) => ({ ...prev, active: 'sessions' }));
        return;
      }
      if (key.rightArrow || input === 'l') {
        setState((prev) => ({ ...prev, active: 'projects' }));
        return;
      }
    }
    if (input === 'n') {
      const source = currentSourceFor(currentGroup, selectedSession, state.sources);
      let cwd = currentCwdFor(currentGroup, selectedSession);
      askInput('New session cwd', cwd).then(async (dir) => {
        if (dir === null) return;
        cwd = source.remote ? dir.trim() || '.' : usableCwd(dir.trim() || process.cwd());
        let backend = null;
        try {
          const backends = listSourceBackends(source);
          if (backends.length > 1) {
            const choice = await askPicker('Backend', backends.map((item) => ({ label: `${item.id}  ${item.label}`, value: item.id })));
            backend = choice && choice.value;
          } else {
            backend = backends[0] ? backends[0].id : null;
          }
        } catch (err) {
          setMessage(`error: ${err.message}`);
          return;
        }
        if (!backend) {
          setMessage('New session cancelled.');
          return;
        }
        try {
          const status = runSourceNewSession(source, cwd, [], backend);
          refreshAfterAction(status === 0 ? `New session finished in ${cwd}.` : `new session exited with code ${status}.`);
        } catch (err) {
          setMessage(`error: ${err.message}`);
        }
      });
      return;
    }
    if (input === 'r' && selectedSession) {
      askInput('Name', selectedSession.name || '').then((name) => {
        if (name === null) return;
        try {
          updateSourceMetadata(selectedSession, { name });
          refreshAfterAction('Renamed.');
        } catch (err) {
          setMessage(`error: ${err.message}`);
        }
      });
      return;
    }
    if (input === 'o' && selectedSession) {
      askInput('Note', selectedSession.note || '').then((note) => {
        if (note === null) return;
        try {
          updateSourceMetadata(selectedSession, { note });
          refreshAfterAction('Note saved.');
        } catch (err) {
          setMessage(`error: ${err.message}`);
        }
      });
      return;
    }
    if (input === 'a' && selectedSession) {
      try {
        runAndReturn('archive', selectedSession, [], `Archived ${shortId(selectedSession.id)}.`);
      } catch (err) {
        setMessage(`error: ${err.message}`);
      }
      return;
    }
    if (input === 'd' && selectedSession) {
      askConfirm(`Delete ${shortId(selectedSession.id)}?`).then((confirmed) => {
        if (!confirmed) return setMessage('Delete cancelled.');
        try {
          const status = runSourceSessionCommand(selectedSession, 'delete', ['--force']);
          if (status === 0) refreshAfterAction(`Deleted ${shortId(selectedSession.id)}.`);
          else setMessage(`delete exited with code ${status}.`);
        } catch (err) {
          if (selectedSession.sourceRemote) return setMessage(`Remote delete failed: ${err.message}`);
          askConfirm(`Backend could not delete ${shortId(selectedSession.id)}. Delete its session file?`).then((removeFile) => {
            if (!removeFile) return;
            try {
              deleteSessionFile(selectedSession);
              refreshAfterAction(`Deleted file for ${shortId(selectedSession.id)}.`);
            } catch (fileErr) {
              setMessage(`error: ${fileErr.message}`);
            }
          });
        }
      });
    }
  });

  const width = size.width || 100;
  const height = size.height || 30;
  const projectWidth = Math.min(42, Math.max(24, Math.floor(width * 0.28)));
  const compact = height < 22;
  const tiny = height < 16;
  const effectiveActive = tiny && state.active === 'details' ? 'sessions' : state.active;
  const headerHeight = compact ? 2 : 3;
  const footerHeight = compact ? 2 : 3;
  const mainHeight = Math.max(4, height - headerHeight - footerHeight);
  const listHeight = tiny ? mainHeight : Math.max(4, Math.floor(mainHeight * 0.45));
  const detailHeight = Math.max(0, mainHeight - listHeight);
  const projectRowCount = Math.max(1, mainHeight - 4);
  const projectOffset = Math.max(0, Math.min(state.groupIndex - projectRowCount + 1, Math.max(0, state.groups.length - projectRowCount)));
  const projectRows = state.groups.slice(projectOffset, projectOffset + projectRowCount);
  const sessionRowCount = Math.max(1, listHeight - 3);
  const sessionOffset = Math.max(0, Math.min(selected - sessionRowCount + 1, Math.max(0, visibleSessions.length - sessionRowCount)));
  const sessionRows = visibleSessions.slice(sessionOffset, sessionOffset + sessionRowCount);
  const detailRowCount = tiny ? 0 : Math.max(1, detailHeight - 4);
  const projectEmptyRows = Array.from({ length: Math.max(0, projectRowCount - projectRows.length) });
  const sessionEmptyRows = Array.from({ length: Math.max(0, sessionRowCount - sessionRows.length) });
  const detailWidth = Math.max(30, width - projectWidth - 6);
  const detailRows = selectedSession ? [
    { text: truncate(displayTitle(selectedSession), Math.max(20, detailWidth - 2)), color: THEME.accent, bold: true },
    { text: '', color: THEME.text },
    { text: 'Session', color: THEME.muted },
    { text: `  backend  ${selectedSession.backend || 'unknown'}${selectedSession.open ? '  open' : ''}`, color: THEME.text },
    { text: `  id       ${selectedSession.id}`, color: THEME.text },
    { text: `  source   ${selectedSession.sourceLabel || 'Local'}`, color: THEME.text },
    { text: `  cwd      ${selectedSession.cwd}`, color: THEME.text },
    { text: '', color: THEME.text },
    { text: 'Timeline', color: THEME.muted },
    { text: `  started  ${localTime(selectedSession.startedAt)}`, color: THEME.text },
    { text: `  updated  ${localTime(selectedSession.updatedAt)}`, color: THEME.text },
    { text: `  turns    ${selectedSession.turns}`, color: THEME.text },
    ...(selectedSession.note ? [
      { text: 'Note', color: THEME.muted },
      { text: `  ${truncate(selectedSession.note, detailWidth)}`, color: THEME.text },
    ] : []),
    { text: '', color: THEME.text },
    { text: 'Last user', color: THEME.muted },
    { text: truncate(selectedSession.last || selectedSession.first || '', detailWidth), color: THEME.text },
    { text: '', color: THEME.text },
    { text: 'Last assistant', color: THEME.muted },
    { text: truncate(selectedSession.lastAssistant || '', detailWidth), color: THEME.text },
  ].slice(0, detailRowCount) : [];
  const shownText = `${visibleSessions.length}/${groupSessionList.length} shown`;
  const updateText = state.updateInfo ? ` update v${state.updateInfo.latestVersion}` : '';
  const headerTitle = fixedWidth(`Codex Workbench v${pkg.version}${updateText}`, width - 2);
  const headerMeta = fixedWidth(`${shownText}  ${currentGroup.kind === 'all' ? 'All sources' : currentGroup.kind === 'source' ? currentGroup.source.label : `${currentGroup.source.label}: ${currentGroup.cwd}`}${state.search ? `  search: ${state.search}` : ''}`, width - 2);
  const searchHelp = state.search ? `  search "${state.search}"  x clear` : '  / search';
  const statusText = fixedWidth(state.remoteLoading ? `${state.message}...` : state.message, width - 2);
  const helpText = fixedWidth(
    effectiveActive === 'projects'
      ? `Sources: ↑/↓ select  0 all  1-9 machine  [/] prev/next  n new${searchHelp}  → sessions  q quit`
      : effectiveActive === 'details'
        ? `Details: ↑/↓ scroll  1-9 machine  [/] prev/next  n new${searchHelp}  ← sessions  q quit`
        : `Sessions: ↑/↓ select  Enter resume  r rename  n new  d delete${searchHelp}  q quit`,
    width - 2,
  );

  return h(Box, { flexDirection: 'column', minHeight: height, backgroundColor: THEME.bg },
    h(Box, { backgroundColor: THEME.header, paddingX: 1, height: headerHeight, flexDirection: 'column' },
      h(Text, { color: THEME.text, bold: true, wrap: 'truncate-end' }, headerTitle),
      h(Text, { color: THEME.muted, wrap: 'truncate-end' }, headerMeta),
      !compact ? h(Text, { color: THEME.header }, fillLine(width - 2)) : null,
    ),
    h(Box, { flexDirection: 'row', flexGrow: 1 },
      h(Box, boxProps(effectiveActive === 'projects', THEME.project, { width: projectWidth, flexShrink: 0 }),
        panelTitle(`Sources (${state.sources.length})`, effectiveActive === 'projects', THEME.project),
        ...projectRows.map((group) => {
          const index = state.groups.indexOf(group);
          const selectedGroup = index === state.groupIndex;
          return h(Text, {
            key: groupKey(group),
            color: group.kind === 'source' ? THEME.warning : group.kind === 'all' ? THEME.text : THEME.muted,
            bold: selectedGroup,
            inverse: selectedGroup,
            wrap: 'truncate-end',
          }, fixedWidth(groupTitle(group, state.sessions, projectWidth), projectWidth - 4));
        }),
        ...projectEmptyRows.map((_, index) => h(Text, {
          key: `project-empty-${index}`,
          color: THEME.panel,
          wrap: 'truncate-end',
        }, fixedWidth('', projectWidth - 4))),
      ),
      h(Box, { flexDirection: 'column', flexGrow: 1 },
        h(Box, boxProps(effectiveActive === 'sessions', THEME.accent, { height: listHeight }),
          panelTitle(state.search ? `Sessions / ${state.search}` : 'Sessions', effectiveActive === 'sessions', THEME.accent),
          ...(sessionRows.length ? sessionRows.map((session) => {
            const isSelected = session === selectedSession;
            const rowWidth = Math.max(20, width - projectWidth - 6);
            const backend = fixedWidth(session.backend || 'unknown', 9);
            const open = session.open ? ' open' : '     ';
            const time = fixedWidth(localTime(session.updatedAt), 18);
            const titleWidth = Math.max(8, rowWidth - 36);
            const row = fixedWidth(`${backend}${open}  ${time}  ${truncate(displayTitle(session), titleWidth)}`, rowWidth);
            return h(Text, {
              key: session.sourceKey || session.id,
              color: isSelected ? THEME.text : session.open ? THEME.warning : THEME.text,
              bold: isSelected || session.open,
              inverse: isSelected,
              wrap: 'truncate-end',
            }, row);
          }) : [h(Text, { key: 'empty', color: THEME.muted }, state.search ? 'No sessions match this search.' : 'No sessions in this project.')]),
          ...sessionEmptyRows.map((_, index) => h(Text, {
            key: `session-empty-${index}`,
            color: THEME.panel,
            wrap: 'truncate-end',
          }, fixedWidth('', Math.max(20, width - projectWidth - 6)))),
        ),
        !tiny ? h(Box, boxProps(effectiveActive === 'details', THEME.detail, { flexGrow: 1 }),
          panelTitle('Details', effectiveActive === 'details', THEME.detail),
          selectedSession
            ? h(Box, { flexDirection: 'column' },
              ...detailRows.map((row, index) => h(Text, {
                key: `detail-${index}`,
                color: row.color,
                bold: row.bold,
                wrap: 'truncate-end',
              }, fixedWidth(row.text, detailWidth))),
            )
            : h(Text, { color: THEME.muted }, 'No sessions match this view.'),
        ) : null,
      ),
    ),
    h(Box, { height: footerHeight, paddingX: 1, flexDirection: 'column', backgroundColor: THEME.panel },
      h(Text, { color: state.message.startsWith('error') ? THEME.danger : THEME.text, wrap: 'truncate-end' }, statusText),
      h(Text, { color: THEME.muted, wrap: 'truncate-end' }, helpText),
      !compact ? h(Text, { color: THEME.panel }, fillLine(width - 2)) : null,
    ),
    state.prompt ? h(Box, { position: 'absolute', top: 4, left: 6, width: Math.max(40, Math.floor((size.width || 80) * 0.7)), borderStyle: 'round', borderColor: THEME.warning, paddingX: 1, flexDirection: 'column', backgroundColor: THEME.panel },
      h(Text, { color: THEME.warning, bold: true }, state.prompt.label),
      h(Text, { color: THEME.text }, `> ${state.prompt.value}`),
    ) : null,
    state.confirm ? h(Box, { position: 'absolute', top: 4, left: 6, width: Math.max(40, Math.floor((size.width || 80) * 0.7)), borderStyle: 'round', borderColor: THEME.danger, paddingX: 1, flexDirection: 'column', backgroundColor: THEME.panel },
      h(Text, { color: THEME.danger, bold: true }, state.confirm.label),
      h(Text, { color: THEME.muted }, 'Enter/y confirm  n/Esc cancel'),
    ) : null,
    state.picker ? h(Box, { position: 'absolute', top: 4, left: 6, width: 48, borderStyle: 'round', borderColor: THEME.warning, paddingX: 1, flexDirection: 'column', backgroundColor: THEME.panel },
      h(Text, { color: THEME.warning, bold: true }, state.picker.label),
      ...state.picker.items.map((item, index) => h(Text, { key: item.value || item.label, color: THEME.text, inverse: index === state.picker.index, bold: index === state.picker.index }, item.label)),
    ) : null,
  );
}

async function runWorkbench() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return printList(loadWorkbenchSessions().sessions);
  }
  const ink = await import('ink');
  const instance = ink.render(h(Workbench, { ink }), { exitOnCtrlC: false });
  await instance.waitUntilExit();
}

module.exports = {
  runWorkbench,
};
