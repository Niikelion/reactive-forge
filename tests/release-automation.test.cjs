const test = require('node:test');
const assert = require('node:assert/strict');

test('release lookup only treats npm E404 as an unpublished version', async () => {
  const { registryVersionState } = await import('./support/release.mjs');
  assert.equal(registryVersionState({ status: 0, stdout: '"2.0.1"' }, '2.0.1'), 'published');
  assert.equal(registryVersionState({ status: 1, stdout: '{"error":{"code":"E404"}}' }, '2.0.1'), 'missing');
  for (const code of ['E401', 'E403', 'E500', 'ETIMEDOUT', 'ENOTFOUND']) {
    assert.throws(() => registryVersionState({ status: 1, stdout: JSON.stringify({ error: { code } }) }, '2.0.1'), /Registry lookup failed/);
  }
  assert.throws(() => registryVersionState({ status: 1, stdout: '', stderr: 'connection failed' }, '2.0.1'), /connection failed/);
  assert.throws(() => registryVersionState({ status: 0, stdout: '"2.0.0"' }, '2.0.1'), /Unexpected registry version/);
});

test('release notes select only the current package version', async () => {
  const { releaseNotes, releasePackages } = await import('./support/release.mjs');
  assert.deepEqual(releasePackages, ['schema', 'runtime', 'editor', 'codegen']);
  assert.equal(releaseNotes('# Changes\n\n## 2.1.0\n\nNew slots.\n\n## 2.0.1\n\nPrevious.', '2.1.0', 'schema'), 'New slots.');
  assert.match(releaseNotes('', '2.0.1', 'schema'), /schema 2\.0\.1/);
});

test('Changesets gate permits infrastructure/docs and requires releases for package changes', async () => {
  const { changedReleasePackages, assertChangesetsCoverChanges } = await import('./support/release-changeset.mjs');
  assert.deepEqual(changedReleasePackages(['.github/workflows/release.yml', 'tests/example.test.cjs', 'packages/schema/README.md', 'packages/eslint-config/index.js']), []);
  assert.deepEqual(changedReleasePackages(['packages/schema/src/index.ts', 'packages/runtime/package.json']), ['schema', 'runtime']);
  assert.throws(() => assertChangesetsCoverChanges(['schema', 'runtime'], [{ name: '@reactive-forge/schema' }]), /@reactive-forge\/runtime/);
  assert.doesNotThrow(() => assertChangesetsCoverChanges(['schema'], [{ name: '@reactive-forge/schema' }]));
});
