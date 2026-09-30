import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const releasePackages = ['schema', 'runtime', 'editor', 'codegen'];

/** Only an explicit registry E404 means it is safe to publish a version. */
export function registryVersionState(result, expectedVersion) {
  if (result.status === 0) {
    const version = JSON.parse(result.stdout);
    if (version !== expectedVersion) throw new Error(`Unexpected registry version: ${JSON.stringify(version)}`);
    return 'published';
  }
  let error;
  try { error = JSON.parse(result.stdout).error; } catch { /* npm can fail before producing JSON. */ }
  if (error?.code === 'E404') return 'missing';
  throw new Error(`Registry lookup failed: ${result.stderr || result.stdout || result.error?.message || result.status}`);
}

export function releaseNotes(changelog, version, name) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `## ${version}`);
  if (start === -1) return `${name} ${version}\n\nSee the repository changelog for changes.`;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => /^## /.test(line));
  return rest.slice(0, end === -1 ? undefined : end).join('\n').trim();
}

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${commandName} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

export function publishRelease(root = process.cwd()) {
  const output = join(root, '.cache', 'ci-release');
  mkdirSync(output, { recursive: true });
  const revision = command('git', ['rev-parse', 'HEAD'], { cwd: root });
  const repository = process.env.GITHUB_REPOSITORY || 'Niikelion/reactive-forge';
  for (const folder of releasePackages) {
    const directory = join(root, 'packages', folder);
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const version = `${pkg.name}@${pkg.version}`;
    const state = registryVersionState(spawnSync('npm', ['view', version, 'version', '--json', '--registry=https://registry.npmjs.org'], { encoding: 'utf8' }), pkg.version);
    const packed = JSON.parse(command('npm', ['pack', '--json', '--pack-destination', output], { cwd: directory }));
    const archive = join(output, packed[0].filename);
    if (state === 'missing') {
      command('npm', ['publish', archive, '--access=public', '--provenance', '--registry=https://registry.npmjs.org']);
      console.log(`Published ${version}`);
    } else console.log(`${version} already published`);
    // Listing succeeds even when a release is absent, so authentication/network
    // failures cannot be mistaken for permission to create a duplicate release.
    const releases = JSON.parse(command('gh', ['api', `repos/${repository}/releases`, '--paginate', '--slurp'])).flat();
    if (releases.some(release => release.tag_name === version || release.tag_name === `v${pkg.version}`)) continue;
    let changelog = '';
    try { changelog = readFileSync(join(directory, 'CHANGELOG.md'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const notes = join(output, `${folder}-notes.md`);
    writeFileSync(notes, releaseNotes(changelog, pkg.version, pkg.name));
    command('gh', ['release', 'create', version, archive, '--repo', repository, '--target', revision, '--title', version, '--notes-file', notes]);
    console.log(`Created release ${version}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) publishRelease();
