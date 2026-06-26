'use strict';

// ---------------------------------------------------------------------------
// Provider registry – auto-detects available backends, routes operations
// ---------------------------------------------------------------------------

const codex = require('./codex');
const claude = require('./claude');
const opencode = require('./opencode');
const pi = require('./pi');

const ALL_PROVIDERS = [codex, pi, opencode, claude];
const providerMap = new Map(ALL_PROVIDERS.map((p) => [p.id, p]));

/**
 * Auto-detect which providers are available (their session directories exist).
 */
function getAvailableProviders() {
  return ALL_PROVIDERS.filter((p) => p.isAvailable());
}

/**
 * Get a specific provider by id. Throws if not registered.
 */
function getProvider(id) {
  const p = providerMap.get(id);
  if (!p) throw new Error(`Unknown backend: ${id}. Available: ${[...providerMap.keys()].join(', ')}`);
  return p;
}

/**
 * Get the provider for a session (reads session.backend).
 */
function providerForSession(session) {
  const backend = session.backend || 'codex';
  return getProvider(backend);
}

/**
 * List all session files across all available providers.
 * Returns [{ file, backend, providerId }].
 */
function getAllSessionFiles() {
  const files = [];
  for (const provider of getAvailableProviders()) {
    if (provider.listSessions) {
      for (const session of provider.listSessions()) files.push({ session, backend: provider.id });
      continue;
    }
    for (const file of provider.getSessionFiles()) {
      files.push({ file, backend: provider.id });
    }
  }
  return files;
}

module.exports = {
  ALL_PROVIDERS,
  getAvailableProviders,
  getProvider,
  providerForSession,
  getAllSessionFiles,
  claude,
  codex,
  opencode,
  pi,
};
