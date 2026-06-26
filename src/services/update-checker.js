'use strict';

const https = require('https');
const pkg = require('../../package.json');

const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(pkg.name).replace(/^%40/, '@')}/latest`;

function parseVersion(version) {
  return String(version || '')
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (left[i] || 0) - (right[i] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function fetchLatestVersion(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = https.get(REGISTRY_URL, {
      headers: { accept: 'application/json', 'user-agent': `${pkg.name}/${pkg.version}` },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const payload = JSON.parse(body);
          resolve(payload && payload.version ? String(payload.version) : null);
        } catch {
          resolve(null);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

async function checkForUpdate(currentVersion = pkg.version) {
  const latestVersion = await fetchLatestVersion();
  if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) return null;
  return {
    currentVersion,
    latestVersion,
  };
}

module.exports = {
  checkForUpdate,
  compareVersions,
  fetchLatestVersion,
};
