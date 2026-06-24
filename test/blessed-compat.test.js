'use strict';

const assert = require('assert');
const Tput = require('blessed/lib/tput');
const { patchBlessedTerminfo } = require('../src/ui/blessed-compat');

patchBlessedTerminfo();

const tput = new Tput();
const compiled = tput._compile({}, 'plab_norm', '";5%;%?%p5%t;2%;m%?%p9%t\u000e%e\u000f%;"');

assert.strictEqual(compiled(), '');
