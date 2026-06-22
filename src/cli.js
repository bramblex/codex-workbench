#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const blessed = require('blessed');
const { spawnSync, spawn } = require('child_process');
const { inspectCodexBin, resolveCodexBin } = require('./codex-bin');

const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, '.codex');
const SESSIONS_DIR = process.env.CODEX_SESSIONS_DIR || path.join(CODEX_HOME, 'sessions');
const META_PATH = process.env.CODEX_WORKBENCH_META || process.env.CSM_META || path.join(CODEX_HOME, 'codex-workbench.json');

function usage() {
  console.log(`codex-workbench

Usage:
  codex-workbench [ui]
  codex-workbench doctor
  codex-workbench list [--json] [--cwd <dir>] [--all]
  codex-workbench show <session>
  codex-workbench rename <session> <name>
  codex-workbench note <session> <note>
  codex-workbench resume <session> [prompt...]
  codex-workbench fork <session>
  codex-workbench archive <session>
  codex-workbench unarchive <session>
  codex-workbench delete <session> [--force]

Environment:
  CODEX_HOME            default: ~/.codex
  CODEX_SESSIONS_DIR    default: $CODEX_HOME/sessions
  CODEX_WORKBENCH_META  default: $CODEX_HOME/codex-workbench.json
  CODEX_BIN             default: codex from shell PATH
`);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function textFromContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item && (item.type === 'input_text' || item.type === 'output_text'))
    .map((item) => item.text || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoiseUserText(text) {
  return text.includes('<environment_context>') || text.includes('<permissions instructions>');
}

function parseSession(file) {
  const stat = fs.statSync(file);
  const raw = fs.readFileSync(file, 'utf8').trim();
  const lines = raw ? raw.split(/\n/) : [];
  let meta = {};
  const messages = [];
  let turns = 0;

  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type === 'session_meta') meta = row.payload || {};
    if (row.type === 'response_item' && row.payload && row.payload.type === 'message') {
      const msg = row.payload;
      if (msg.role === 'developer') continue;
      const text = textFromContent(msg.content);
      if (!text) continue;
      if (msg.role === 'user' && isNoiseUserText(text)) continue;
      messages.push({
        role: msg.role,
        phase: msg.phase || '',
        text,
      });
      if (msg.role === 'user') turns += 1;
    }
  }

  const id = meta.id || path.basename(file, '.jsonl').split('-').slice(-5).join('-');
  const firstUser = messages.find((msg) => msg.role === 'user');
  const lastUser = [...messages].reverse().find((msg) => msg.role === 'user');
  const lastAssistant = [...messages].reverse().find((msg) => msg.role === 'assistant');

  return {
    id,
    file,
    cwd: meta.cwd || '(unknown)',
    startedAt: meta.timestamp || null,
    updatedAt: stat.mtime.toISOString(),
    cliVersion: meta.cli_version || '',
    source: meta.source || '',
    provider: meta.model_provider || '',
    turns,
    first: firstUser ? firstUser.text : '',
    last: lastUser ? lastUser.text : '',
    lastAssistant: lastAssistant ? lastAssistant.text : '',
    messages,
  };
}

function loadMeta() {
  const data = readJson(META_PATH, { sessions: {} });
  if (!data.sessions) data.sessions = {};
  return data;
}

function listSessions() {
  const meta = loadMeta();
  return walk(SESSIONS_DIR)
    .map(parseSession)
    .map((session) => ({ ...session, ...(meta.sessions[session.id] || {}) }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function resolveSession(query, sessions = listSessions()) {
  if (!query) throw new Error('Missing session. Run `codex-workbench list` to find a session id.');
  const matches = sessions.filter((session) => {
    return session.id === query ||
      session.id.startsWith(query) ||
      session.name === query ||
      path.basename(session.file) === query;
  });
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No session matched: ${query}`);
  throw new Error(`Ambiguous session: ${query}\n${matches.map((s) => `  ${s.id} ${s.name || ''}`).join('\n')}`);
}

function shortId(id) {
  return id.slice(0, 13);
}

function localTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

function truncate(text, width) {
  if (!text) return '';
  return text.length > width ? text.slice(0, Math.max(0, width - 1)) + '...' : text;
}

function printList(sessions, opts = {}) {
  const filtered = sessions.filter((session) => {
    if (!opts.all && session.archived) return false;
    if (opts.cwd) return path.resolve(session.cwd) === path.resolve(opts.cwd);
    return true;
  });
  if (opts.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }
  const groups = new Map();
  for (const session of filtered) {
    if (!groups.has(session.cwd)) groups.set(session.cwd, []);
    groups.get(session.cwd).push(session);
  }
  for (const [cwd, group] of groups) {
    console.log(`\n${cwd}`);
    for (const session of group) {
      const label = session.name || truncate(session.first || session.last || '(no prompt)', 56);
      const flags = [session.archived ? 'archived' : '', session.note ? 'note' : ''].filter(Boolean).join(',');
      console.log(`  ${shortId(session.id)}  ${localTime(session.updatedAt)}  ${String(session.turns).padStart(2)} turns  ${flags ? `[${flags}] ` : ''}${label}`);
    }
  }
  if (!filtered.length) console.log('No sessions found.');
}

function printShow(session) {
  console.log(`${session.name || '(unnamed)'} ${session.archived ? '[archived]' : ''}`);
  console.log(`id:       ${session.id}`);
  console.log(`cwd:      ${session.cwd}`);
  console.log(`started:  ${localTime(session.startedAt)}`);
  console.log(`updated:  ${localTime(session.updatedAt)}`);
  console.log(`file:     ${session.file}`);
  console.log(`turns:    ${session.turns}`);
  if (session.note) console.log(`note:     ${session.note}`);
  console.log('\nMessages:');
  for (const msg of session.messages) {
    if (msg.role === 'developer') continue;
    const prefix = msg.role === 'assistant' ? 'A' : msg.role === 'user' ? 'U' : msg.role.slice(0, 1).toUpperCase();
    console.log(`  ${prefix}: ${truncate(msg.text, 180)}`);
  }
}

function printDoctor() {
  const result = inspectCodexBin();
  console.log('codex-workbench doctor');
  console.log(`status: ${result.ok ? 'ok' : 'error'}`);
  if (result.path) console.log(`codex:  ${result.path}`);
  if (result.source) console.log(`source: ${result.source}`);
  if (result.error) console.log(`error:  ${result.error}`);
  console.log('\nChecks:');
  for (const check of result.checks) {
    const parts = [
      check.source,
      check.mode ? `mode=${check.mode}` : '',
      check.shell ? `shell=${check.shell}` : '',
      check.path ? `path=${check.path}` : '',
      `executable=${check.executable ? 'yes' : 'no'}`,
    ].filter(Boolean);
    console.log(`  - ${parts.join(' ')}`);
  }
  if (!result.ok) process.exitCode = 1;
}

function updateMetadata(session, patch) {
  const meta = loadMeta();
  meta.sessions[session.id] = { ...(meta.sessions[session.id] || {}), ...patch };
  meta.updatedAt = new Date().toISOString();
  writeJson(META_PATH, meta);
}

function usableCwd(dir) {
  const candidates = [dir, process.cwd(), HOME];
  for (const candidate of candidates) {
    if (!candidate || candidate === '(unknown)') continue;
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Try the next fallback.
    }
  }
  return HOME;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandShell() {
  const shell = process.env.SHELL || '/bin/sh';
  try {
    fs.accessSync(shell, fs.constants.X_OK);
    return shell;
  } catch {
    return '/bin/sh';
  }
}

function codexCommand(command, session, args = [], inherit = false) {
  const executable = resolveCodexBin();
  const argv = [executable, command, session.id, ...args];
  const shellCommand = `exec ${argv.map(shellQuote).join(' ')}`;
  const cwd = usableCwd(session.cwd);
  const shell = commandShell();
  if (inherit) {
    const child = spawn(shell, ['-lc', shellCommand], { stdio: 'inherit', cwd, env: process.env });
    child.on('error', (err) => {
      console.error(`error: failed to start codex: ${err.message}`);
      process.exit(1);
    });
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      process.exit(code || 0);
    });
    return;
  }
  const result = spawnSync(shell, ['-lc', shellCommand], { stdio: 'inherit', cwd, env: process.env });
  if (result.error) throw new Error(`failed to start codex: ${result.error.message}`);
  const status = result.status || 0;
  process.exitCode = status;
  return status;
}

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--all') out.all = true;
    else if (arg === '--force') out.force = true;
    else if (arg === '--cwd') {
      if (i + 1 >= args.length) throw new Error('--cwd requires a directory.');
      out.cwd = args[++i];
    }
    else out._.push(arg);
  }
  return out;
}

async function ui() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return printList(listSessions());
  }

  let sessions = [];
  let groups = [];
  let groupIndex = 0;
  let selected = 0;
  let message = '';
  let syncingList = false;

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

  const groupsBar = blessed.box({
    parent: screen,
    label: ' Projects ',
    top: 3,
    left: 0,
    right: 0,
    height: 3,
    border: 'line',
    padding: { left: 1, right: 1 },
    tags: true,
    parseTags: true,
    style: {
      border: { fg: 'green' },
      fg: 'white',
    },
  });

  const sessionsList = blessed.list({
    parent: screen,
    label: ' Sessions ',
    top: 6,
    left: 0,
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
    left: 0,
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

  const tagText = (text) => String(text).replace(/[{}]/g, '');

  const groupsContent = () => {
    if (!groups.length) return '';
    const width = Math.max(20, (screen.width || 80) - 4);
    const labels = groups.map((group, index) => {
      const max = index === groupIndex ? 34 : 24;
      return tagText(truncate(groupLabel(group), max));
    });
    const chipWidth = (index) => labels[index].length + 2;
    let start = groupIndex;
    let end = groupIndex;
    let used = chipWidth(groupIndex);

    while (start > 0 || end < groups.length - 1) {
      const reserve = (start > 0 ? 4 : 0) + (end < groups.length - 1 ? 4 : 0);
      const leftCost = start > 0 ? chipWidth(start - 1) + 2 : Infinity;
      const rightCost = end < groups.length - 1 ? chipWidth(end + 1) + 2 : Infinity;
      const preferLeft = groupIndex - start <= end - groupIndex;
      const firstCost = preferLeft ? leftCost : rightCost;
      const secondCost = preferLeft ? rightCost : leftCost;

      if (used + firstCost + reserve <= width) {
        if (preferLeft) start -= 1;
        else end += 1;
        used += firstCost;
      } else if (used + secondCost + reserve <= width) {
        if (preferLeft) end += 1;
        else start -= 1;
        used += secondCost;
      } else {
        break;
      }
    }

    const parts = [];
    if (start > 0) parts.push('...');
    for (let index = start; index <= end; index += 1) {
      const label = ` ${labels[index]} `;
      parts.push(index === groupIndex ? `{black-fg}{cyan-bg}{bold}${label}{/bold}{/cyan-bg}{/black-fg}` : label);
    }
    if (end < groups.length - 1) parts.push('...');
    return parts.join(' ');
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

  const promptOpen = () => prompt.visible || question.visible;

  const reload = () => {
    sessions = listSessions().filter((s) => !s.archived);
    groups = ['All', ...new Set(sessions.map((s) => s.cwd))];
    if (groupIndex >= groups.length) groupIndex = Math.max(0, groups.length - 1);
    const visible = currentSessions();
    if (selected >= visible.length) selected = Math.max(0, visible.length - 1);
  };

  const syncList = () => {
    const visible = currentSessions();
    const listRows = Math.max(1, (screen.height || 24) - 11);
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

  const render = () => {
    const visible = currentSessions();
    header.setContent(` Codex Workbench\n ${visible.length}/${sessions.length} visible  ${groups[groupIndex] === 'All' ? 'All projects' : groups[groupIndex]}`);
    groupsBar.setContent(groupsContent());
    detailBox.setLabel(' Details ');
    detailBox.setContent(detailContent(selectedSession()));
    status.setContent(`${message || 'Ready'}\nEnter/r resume  tab focus  f fork  v view  n rename  o note  a archive  d delete  q quit`);
    screen.render();
  };

  const askInput = (label, initial = '') => new Promise((resolve) => {
    prompt.input(label, initial, (err, value) => resolve(err ? null : value));
  });

  const askConfirm = (label) => new Promise((resolve) => {
    question.ask(label, (err, answer) => resolve(!err && Boolean(answer)));
  });

  const leaveScreen = () => {
    screen.destroy();
  };

  const refreshAfterAction = (text, isError = false) => {
    setMessage(text, isError);
    reload();
    syncList();
    render();
  };

  const switchGroup = (offset) => {
    if (!groups.length) return;
    groupIndex = Math.max(0, Math.min(groups.length - 1, groupIndex + offset));
    selected = 0;
    syncList();
    render();
  };

  const runCodexAndReturn = (command, session, args = [], doneText = `${command} finished.`) => {
    screen.leave();
    let status = 0;
    try {
      status = codexCommand(command, session, args);
    } finally {
      screen.enter();
    }
    if (status === 0) refreshAfterAction(doneText);
    else refreshAfterAction(`${command} exited with code ${status}.`, true);
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
  syncList();

  sessionsList.on('select item', (_item, index) => {
    if (syncingList) return;
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

  sessionsList.on('select', () => runAction((session) => {
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
    switchGroup(-1);
  });

  sessionsList.key(['right', 'l'], () => {
    if (promptOpen()) return;
    switchGroup(1);
  });

  detailBox.key(['left', 'h'], () => {
    if (promptOpen()) return;
    switchGroup(-1);
  });

  detailBox.key(['right', 'l'], () => {
    if (promptOpen()) return;
    switchGroup(1);
  });

  screen.key(['tab'], () => {
    if (promptOpen()) return;
    if (screen.focused === detailBox) sessionsList.focus();
    else detailBox.focus();
    screen.render();
  });

  screen.key(['q', 'escape', 'C-c'], () => {
    if (promptOpen()) return;
    leaveScreen();
    process.exit(0);
  });

  screen.key(['r'], () => runAction((session) => {
    runCodexAndReturn('resume', session);
  }));

  screen.key(['f'], () => runAction((session) => {
    runCodexAndReturn('fork', session);
  }));

  screen.key(['v'], () => runAction((session) => {
    leaveScreen();
    printShow(session);
    process.exit(0);
  }));

  screen.key(['n'], () => runAction(async (session) => {
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
    runCodexAndReturn('delete', session, ['--force'], `Deleted ${shortId(session.id)}.`);
  }));

  sessionsList.focus();
  render();

  return new Promise(() => {});
}

async function main() {
  const [cmd = 'ui', ...rest] = process.argv.slice(2);
  if (cmd === '-h' || cmd === '--help' || cmd === 'help') return usage();

  const flags = parseFlags(rest);
  if (cmd === 'doctor') return printDoctor();

  const sessions = listSessions();

  if (cmd === 'ui') return ui();
  if (cmd === 'list' || cmd === 'ls') return printList(sessions, flags);
  if (cmd === 'show') return printShow(resolveSession(flags._[0], sessions));
  if (cmd === 'rename') return updateMetadata(resolveSession(flags._[0], sessions), { name: flags._.slice(1).join(' ') });
  if (cmd === 'note') return updateMetadata(resolveSession(flags._[0], sessions), { note: flags._.slice(1).join(' ') });
  if (cmd === 'resume') return codexCommand('resume', resolveSession(flags._[0], sessions), flags._.slice(1), true);
  if (cmd === 'fork') return codexCommand('fork', resolveSession(flags._[0], sessions), [], true);
  if (cmd === 'archive') return codexCommand('archive', resolveSession(flags._[0], sessions));
  if (cmd === 'unarchive') return codexCommand('unarchive', resolveSession(flags._[0], sessions));
  if (cmd === 'delete') return codexCommand('delete', resolveSession(flags._[0], sessions), flags.force ? ['--force'] : []);

  usage();
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
