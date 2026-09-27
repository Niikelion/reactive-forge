const assert = require('node:assert/strict');
const test = require('node:test');

module.exports = function defect(name, fn, matchesKnownFailure = () => true) {
  if (process.env.FORGE_STRICT_REGRESSIONS === '1') return test(name, fn);
  return test(name, async t => {
    try {
      await fn();
    } catch (error) {
      if (!(error instanceof assert.AssertionError) || !matchesKnownFailure(error)) throw error;
      t.todo('Known defect: desired behavior is not implemented');
      throw error;
    }
    assert.fail('Unexpected pass: promote this known-defect case to a normal test');
  });
};
