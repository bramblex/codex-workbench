'use strict';

const path = require('path');
const { inspectCodexBin } = require('./codex-bin');
const { localTime, shortId, truncate } = require('./model/format');

function usage() {
  console.log(`codex-workbench

Usage:
  codex-workbench [ui]
  codex-workbench doctor
  codex-workbench list [--json] [--cwd <dir>] [--all]
  codex-workbench show <session>
  codex-workbench rename <session> <name>
  codex-workbench note <session> <note>
  codex-workbench new [--cwd <dir>] [prompt...]
  codex-workbench resume <session> [prompt...]
  codex-workbench fork <session>
  codex-workbench archive <session>
  codex-workbench unarchive <session>
  codex-workbench hide <session>
  codex-workbench unhide <session>
  codex-workbench delete <session> [--force] [--file]

Environment:
  CODEX_HOME            default: ~/.codex
  CODEX_SESSIONS_DIR    default: $CODEX_HOME/sessions
  CODEX_WORKBENCH_META  default: $CODEX_HOME/codex-workbench.json
  CODEX_BIN             default: codex from shell PATH
`);
}

function printList(sessions, opts = {}) {
  const filtered = sessions.filter((session) => {
    if (!opts.all && (session.archived || session.hidden)) return false;
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
      const flags = [session.archived ? 'archived' : '', session.hidden ? 'hidden' : '', session.note ? 'note' : ''].filter(Boolean).join(',');
      console.log(`  ${shortId(session.id)}  ${localTime(session.updatedAt)}  ${String(session.turns).padStart(2)} turns  ${flags ? `[${flags}] ` : ''}${label}`);
    }
  }
  if (!filtered.length) console.log('No sessions found.');
}

function printShow(session) {
  console.log(`${session.name || '(unnamed)'} ${session.archived ? '[archived]' : ''}${session.hidden ? '[hidden]' : ''}`);
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

module.exports = {
  printDoctor,
  printList,
  printShow,
  usage,
};
