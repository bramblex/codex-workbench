'use strict';

const assert = require('assert');
const { compareVersions } = require('../src/services/update-checker');

assert.strictEqual(compareVersions('0.1.16', '0.1.16'), 0);
assert.ok(compareVersions('0.1.17', '0.1.16') > 0);
assert.ok(compareVersions('0.1.9', '0.1.10') < 0);
assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
assert.strictEqual(compareVersions('v0.1.16', '0.1.16'), 0);
