'use strict';

// ---------------------------------------------------------------------------
// Backward-compatible re-exports – delegates to the provider layer.
// New code should import directly from src/providers/ and use
// providerForSession() to route by session.backend.
// ---------------------------------------------------------------------------

const codex = require('../providers/codex');
const { providerForSession } = require('../providers');

// Re-export low-level helpers
const shellQuote = codex.shellQuote;
const commandShell = codex.commandShell;
const usableCwd = codex.usableCwd;

/**
 * Run a CLI command against a session, routing to the correct provider backend.
 */
function runCodexCommand(command, session, args, inherit, hooks) {
  const provider = providerForSession(session);
  return provider.runCommand(command, session, args, inherit, hooks);
}

/**
 * Start a new session, routing to the correct provider backend.
 * Defaults to codex if no backend is specified.
 */
function runNewCodexSession(cwd, args, inherit, backend) {
  const provider = backend ? require('../providers').getProvider(backend) : codex;
  return provider.runNew(cwd, args, inherit);
}

module.exports = {
  commandShell,
  runCodexCommand,
  runNewCodexSession,
  shellQuote,
  usableCwd,
};
