import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releasePackages } from './release.mjs';

export function changedReleasePackages(paths) {
  return releasePackages.filter(folder => paths.some(path =>
    path.startsWith(`packages/${folder}/`) && !/\.md$/i.test(path)
  ));
}

export function assertChangesetsCoverChanges(changed, releases) {
  const released = new Set(releases.map(release => release.name));
  const missing = changed.filter(folder => !released.has(`@reactive-forge/${folder}`));
  if (missing.length) throw new Error(`Add a Changeset for: ${missing.map(folder => `@reactive-forge/${folder}`).join(', ')}. Run yarn changeset.`);
}

export function checkChangeset(base = process.env.CHANGESET_BASE) {
  if (!base) throw new Error('CHANGESET_BASE must be the pull request base commit.');
  const diff = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  if (diff.error || diff.status !== 0) throw diff.error || new Error(diff.stderr);
  const changed = changedReleasePackages(diff.stdout.trim().split(/\r?\n/));
  if (!changed.length) return;
  mkdirSync('.cache', { recursive: true });
  const output = '.cache/changeset-status.json';
  const status = spawnSync('yarn', ['changeset', 'status', `--since=${base}`, '--output', output], { encoding: 'utf8' });
  if (status.error || status.status !== 0) throw status.error || new Error(status.stderr || status.stdout);
  assertChangesetsCoverChanges(changed, JSON.parse(readFileSync(output, 'utf8')).releases);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) checkChangeset();
