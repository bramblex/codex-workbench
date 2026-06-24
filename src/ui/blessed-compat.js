'use strict';

const Tput = require('blessed/lib/tput');

function patchBlessedTerminfo() {
  if (Tput.prototype._codexWorkbenchPatched) return;

  const compile = Tput.prototype._compile;
  Tput.prototype._compile = function patchedCompile(info, key, str) {
    if (key === 'plab_norm') return () => '';
    return compile.call(this, info, key, str);
  };

  Tput.prototype._codexWorkbenchPatched = true;
}

patchBlessedTerminfo();

module.exports = {
  patchBlessedTerminfo,
};
