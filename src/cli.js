#!/usr/bin/env node
'use strict';

const {
  deleteSessionFile,
  listSessions,
  resolveSession,
  updateMetadata,
} = require('./model/session-store');
const {
  printDoctor,
  printList,
  printShow,
  usage,
} = require('./cli-output');
const {
  runCodexCommand,
  runNewCodexSession,
  usableCwd,
} = require('./services/codex-runner');
const { runWorkbench } = require('./ui/workbench');
const { createChildDirectory, listDirectories } = require('./model/directories');

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--all') out.all = true;
    else if (arg === '--compact') out.compact = true;
    else if (arg === '--force') out.force = true;
    else if (arg === '--file') out.file = true;
    else if (arg === '--cwd') {
      if (i + 1 >= args.length) throw new Error('--cwd requires a directory.');
      out.cwd = args[++i];
    }
    else out._.push(arg);
  }
  return out;
}

async function main() {
  const [cmd = 'ui', ...rest] = process.argv.slice(2);
  if (cmd === '-h' || cmd === '--help' || cmd === 'help') return usage();

  const flags = parseFlags(rest);
  if (cmd === 'doctor') return printDoctor();
  if (cmd === 'dirs') {
    const payload = listDirectories(flags.cwd || process.cwd(), usableCwd);
    if (flags.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(payload.cwd);
      for (const entry of payload.entries) console.log(entry.path);
    }
    return undefined;
  }
  if (cmd === 'mkdir') {
    const target = createChildDirectory(usableCwd(flags.cwd || process.cwd()), flags._[0] || '');
    if (flags.json) console.log(JSON.stringify({ path: target }, null, 2));
    else console.log(target);
    return undefined;
  }

  const sessions = listSessions();

  if (cmd === 'ui') return runWorkbench();
  if (cmd === 'list' || cmd === 'ls') return printList(sessions, flags);
  if (cmd === 'show') return printShow(resolveSession(flags._[0], sessions));
  if (cmd === 'rename') return updateMetadata(resolveSession(flags._[0], sessions), { name: flags._.slice(1).join(' ') });
  if (cmd === 'note') return updateMetadata(resolveSession(flags._[0], sessions), { note: flags._.slice(1).join(' ') });
  if (cmd === 'new' || cmd === 'start') return runNewCodexSession(flags.cwd || process.cwd(), flags._, true);
  if (cmd === 'resume') return runCodexCommand('resume', resolveSession(flags._[0], sessions), flags._.slice(1), true);
  if (cmd === 'fork') return runCodexCommand('fork', resolveSession(flags._[0], sessions), [], true);
  if (cmd === 'archive') return runCodexCommand('archive', resolveSession(flags._[0], sessions));
  if (cmd === 'unarchive') return runCodexCommand('unarchive', resolveSession(flags._[0], sessions));
  if (cmd === 'hide') return updateMetadata(resolveSession(flags._[0], sessions), { hidden: true });
  if (cmd === 'unhide') return updateMetadata(resolveSession(flags._[0], sessions), { hidden: false });
  if (cmd === 'delete') {
    const session = resolveSession(flags._[0], sessions);
    if (flags.file) return deleteSessionFile(session);
    return runCodexCommand('delete', session, flags.force ? ['--force'] : []);
  }

  usage();
  process.exitCode = 2;
}

function run() {
  return main().catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
}

if (require.main === module) run();

module.exports = {
  main,
  parseFlags,
  run,
};
