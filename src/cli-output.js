'use strict';

const path = require('path');
const codex = require('./providers/codex');
const { getAvailableProviders } = require('./providers');
const { localTime, shortId, truncate } = require('./model/format');

function usage() {
  console.log(`codex-workbench

Usage:
  codex-workbench [ui]
  codex-workbench doctor
  codex-workbench backends [--json]
  codex-workbench list [--json] [--compact] [--cwd <dir>] [--all]
  codex-workbench show <session>
  codex-workbench rename <session> <name>
  codex-workbench note <session> <note>
  codex-workbench new [--cwd <dir>] [--backend <backend>] [prompt...]
  codex-workbench dirs [--cwd <dir>] [--json]
  codex-workbench mkdir [--cwd <dir>] <name> [--json]
  codex-workbench resume <session> [prompt...]
  codex-workbench fork <session>
  codex-workbench archive <session>
  codex-workbench unarchive <session>
  codex-workbench delete <session> [--force] [--file]

Environment:
  CWB_HOME              default: ~/.cwb
  CWB_META              default: $CWB_HOME/metadata.json
  CWB_CONFIG            default: $CWB_HOME/config.json
  CODEX_HOME            default: ~/.codex
  CODEX_SESSIONS_DIR    default: $CODEX_HOME/sessions
  CLAUDE_HOME           default: ~/.claude
  CLAUDE_PROJECTS_DIR   default: $CLAUDE_HOME/projects
  PI_CODING_AGENT_DIR   default: ~/.pi/agent
  PI_CODING_AGENT_SESSION_DIR default: $PI_CODING_AGENT_DIR/sessions
  OPENCODE_DATA_DIR     default: ~/.local/share/opencode
  OPENCODE_DB           default: $OPENCODE_DATA_DIR/opencode.db
  CODEX_WORKBENCH_META  legacy override for CWB_META
  CODEX_WORKBENCH_CONFIG legacy override for CWB_CONFIG
  CODEX_BIN             default: codex from shell PATH
  CLAUDE_BIN            default: claude from shell PATH
  PI_BIN                default: pi from shell PATH
  OPENCODE_BIN          default: opencode from shell PATH
`);
}

function printList(sessions, opts = {}) {
  const filtered = sessions.filter((session) => {
    if (!opts.all && session.archived) return false;
    if (opts.cwd) return path.resolve(session.cwd) === path.resolve(opts.cwd);
    return true;
  });
  if (opts.json) {
    const payload = opts.compact ? filtered.map(compactSession) : filtered;
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const groups = new Map();
  for (const session of filtered) {
    const source = session.sourceLabel || '';
    const key = `${source}\0${session.cwd}`;
    if (!groups.has(key)) groups.set(key, { source, cwd: session.cwd, sessions: [] });
    groups.get(key).sessions.push(session);
  }
  for (const group of groups.values()) {
    console.log(`\n${group.source ? `${group.source}: ` : ''}${group.cwd}`);
    for (const session of group.sessions) {
      const label = session.name || truncate(session.first || session.last || '(no prompt)', 52);
      const flags = [session.backend || '', session.archived ? 'archived' : '', session.note ? 'note' : ''].filter(Boolean).join(',');
      console.log(`  ${shortId(session.id)}  ${localTime(session.updatedAt)}  ${String(session.turns).padStart(2)} turns  ${flags ? `[${flags}] ` : ''}${label}`);
    }
  }
  if (!filtered.length) console.log('No sessions found.');
}

function compactSession(session) {
  const { messages, ...compact } = session;
  return compact;
}

function printShow(session) {
  console.log(`${session.name || '(unnamed)'} ${session.archived ? '[archived]' : ''}`);
  console.log(`id:       ${session.id}`);
  console.log(`backend:  ${session.backend || 'unknown'}`);
  if (session.sourceLabel) console.log(`source:   ${session.sourceLabel}`);
  console.log(`cwd:      ${session.cwd}`);
  console.log(`started:  ${localTime(session.startedAt)}`);
  console.log(`updated:  ${localTime(session.updatedAt)}`);
  if (session.file) console.log(`file:     ${session.file}`);
  console.log(`turns:    ${session.turns}`);
  if (session.note) console.log(`note:     ${session.note}`);
  console.log('\nMessages:');
  for (const msg of session.messages || []) {
    if (msg.role === 'developer') continue;
    const prefix = msg.role === 'assistant' ? 'A' : msg.role === 'user' ? 'U' : msg.role.slice(0, 1).toUpperCase();
    console.log(`  ${prefix}: ${truncate(msg.text, 180)}`);
  }
}

function printDoctor() {
  const providers = getAvailableProviders();

  console.log('codex-workbench doctor');
  console.log(`\nBackends detected: ${providers.length ? providers.map((p) => p.label).join(', ') : 'none'}`);

  for (const provider of providers) {
    console.log(`\n-- ${provider.label} --`);
    const bin = provider.resolveBin();
    if (bin) {
      console.log(`  binary:   ${bin}`);
    } else {
      console.log(`  binary:   not found`);
      try { provider.resolveBin(); } catch (err) { console.log(`  error:    ${err.message}`); }
    }
    try {
      if (provider.listSessions) {
        const sessions = provider.listSessions();
        console.log(`  sessions: ${sessions.length}`);
      } else {
        const files = provider.getSessionFiles();
        console.log(`  sessions: ${files.length} file${files.length === 1 ? '' : 's'}`);
      }
    } catch (err) {
      console.log(`  sessions: error - ${err.message}`);
    }
  }

  if (!providers.length) {
    console.log('\nNo backends available. Install Codex CLI or pi coding agent.');
    process.exitCode = 1;
  }
}

module.exports = {
  compactSession,
  printDoctor,
  printList,
  printShow,
  usage,
};
