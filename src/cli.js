#!/usr/bin/env node
'use strict';

const {
  deleteSessionFile,
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
  runNewCodexSession,
  usableCwd,
} = require('./services/codex-runner');
const {
  defaultBackend,
  listLocalBackends,
  loadLocalWorkbenchSessions,
  runSourceSessionCommand,
} = require('./services/session-sources');
const { getProvider } = require('./providers');
const { runWorkbench } = require('./ui/ink-workbench');
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
    else if (arg === '--backend') {
      if (i + 1 >= args.length) throw new Error('--backend requires a backend id.');
      out.backend = args[++i];
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
  if (cmd === 'backends') {
    const backends = listLocalBackends();
    if (flags.json) console.log(JSON.stringify(backends, null, 2));
    else backends.forEach((backend) => console.log(`${backend.id}\t${backend.label}`));
    return undefined;
  }
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

  const sessions = loadLocalWorkbenchSessions().sessions;

  if (cmd === 'ui') return runWorkbench();
  if (cmd === 'list' || cmd === 'ls') return printList(sessions, flags);
  if (cmd === 'show') return printShow(resolveSession(flags._[0], sessions));
  if (cmd === 'rename') return updateMetadata(resolveSession(flags._[0], sessions), { name: flags._.slice(1).join(' ') });
  if (cmd === 'note') return updateMetadata(resolveSession(flags._[0], sessions), { note: flags._.slice(1).join(' ') });
  if (cmd === 'new' || cmd === 'start') {
    const backend = flags.backend || defaultBackend();
    getProvider(backend);
    return runNewCodexSession(flags.cwd || process.cwd(), flags._, true, backend);
  }
  if (cmd === 'resume') return runSourceSessionCommand(resolveSession(flags._[0], sessions), 'resume', flags._.slice(1), { force: flags.force, inherit: true });
  if (cmd === 'fork') return runSourceSessionCommand(resolveSession(flags._[0], sessions), 'fork', [], { inherit: true });
  if (cmd === 'archive') return runSourceSessionCommand(resolveSession(flags._[0], sessions), 'archive');
  if (cmd === 'unarchive') return runSourceSessionCommand(resolveSession(flags._[0], sessions), 'unarchive');
  if (cmd === 'delete') {
    const session = resolveSession(flags._[0], sessions);
    if (flags.file) return deleteSessionFile(session);
    return runSourceSessionCommand(session, 'delete', flags.force ? ['--force'] : []);
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
