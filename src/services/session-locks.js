'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { LOCKS_DIR } = require('../config');

class SessionLockError extends Error {
  constructor(lock) {
    const location = lock.host ? `${lock.host}${lock.pid ? ` pid ${lock.pid}` : ''}` : `pid ${lock.pid}`;
    super(`Session is already open by ${location}. Close it first or pass --force.`);
    this.name = 'SessionLockError';
    this.code = 'SESSION_LOCKED';
    this.lock = lock;
  }
}

function lockKey(session) {
  const source = session.sourceId || 'local';
  const backend = session.backend || 'unknown';
  const id = session.id || 'unknown';
  return `${source}-${backend}-${id}`.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function lockPath(session) {
  return path.join(LOCKS_DIR, `${lockKey(session)}.json`);
}

function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeLock(file, lock) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(lock, null, 2) + '\n');
}

function removeLock(file) {
  try { fs.unlinkSync(file); } catch { /* ignore */ }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function sameHost(lock) {
  return !lock.host || lock.host === os.hostname();
}

function activeLock(file) {
  const lock = readLock(file);
  if (!lock) return null;
  if (!sameHost(lock)) return lock;
  if (pidAlive(lock.pid)) return lock;
  removeLock(file);
  return null;
}

function stopLockProcess(lock) {
  if (!sameHost(lock) || !lock.ownerPid || !pidAlive(lock.pid)) return false;
  try {
    process.kill(lock.pid, 'SIGTERM');
  } catch {
    return false;
  }
  const started = Date.now();
  while (Date.now() - started < 1500) {
    if (!pidAlive(lock.pid)) return true;
  }
  try {
    process.kill(lock.pid, 'SIGKILL');
  } catch {
    return !pidAlive(lock.pid);
  }
  return true;
}

function acquireSessionLock(session, command, options = {}) {
  const file = lockPath(session);
  const existing = activeLock(file);
  if (existing) {
    if (!options.force) throw new SessionLockError(existing);
    if (!stopLockProcess(existing)) throw new SessionLockError(existing);
    removeLock(file);
  }

  const base = {
    backend: session.backend || 'unknown',
    command,
    cwd: session.cwd || '',
    host: os.hostname(),
    lockedAt: new Date().toISOString(),
    ownerPid: process.pid,
    pid: process.pid,
    sessionId: session.id,
    sourceId: session.sourceId || 'local',
    tty: process.env.TTY || '',
  };
  writeLock(file, base);

  let released = false;
  return {
    file,
    release() {
      if (released) return;
      released = true;
      removeLock(file);
    },
    update(patch) {
      if (released) return;
      writeLock(file, { ...base, ...patch, ownerPid: process.pid, updatedAt: new Date().toISOString() });
    },
  };
}

function sessionLockInfo(session) {
  return activeLock(lockPath(session));
}

module.exports = {
  SessionLockError,
  acquireSessionLock,
  activeLock,
  lockPath,
  pidAlive,
  sessionLockInfo,
};
