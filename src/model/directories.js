'use strict';

const fs = require('fs');
const path = require('path');

function directoryNameError(name) {
  if (!name) return 'Directory name is required.';
  if (name === '.' || name === '..') return 'Directory name cannot be . or ..';
  if (path.isAbsolute(name)) return 'Directory name must be relative.';
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return 'Directory name cannot contain path separators.';
  return '';
}

function listDirectories(dir, usableCwd) {
  const cwd = usableCwd ? usableCwd(dir) : path.resolve(dir || process.cwd());
  const entries = fs.readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(cwd, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { cwd, entries };
}

function createChildDirectory(parent, name) {
  const error = directoryNameError(name);
  if (error) throw new Error(error);
  const target = path.join(parent, name);
  fs.mkdirSync(target);
  return target;
}

module.exports = {
  createChildDirectory,
  directoryNameError,
  listDirectories,
};
