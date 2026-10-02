const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const net = require('node:net');
const {pathToFileURL} = require('node:url');
const {spawn, spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const fixture = path.join(root, '.cache', 'next-integration-project');
const bin = path.join(root, 'packages/next/dist/bin.js');
const {withReactiveForge} = require(path.join(root, 'packages/next/src/index.ts'));

function write(file, content) {
  const target = path.join(fixture, file);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, content);
}
function setup() {
  assert.equal(path.dirname(fixture), path.join(root, '.cache'));
  fs.rmSync(fixture, {recursive: true, force: true});
  write('package.json', JSON.stringify({private: true, name: 'forge-next-integration-fixture', dependencies: {next: '^16.0.0', react: '^19.0.0', 'react-dom': '^19.0.0'}}));
  write('tsconfig.json', JSON.stringify({compilerOptions: {strict: true, jsx: 'preserve', target: 'esnext', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true, esModuleInterop: true, resolveJsonModule: true}, include: ['src/**/*', 'app/**/*', 'generated/**/*']}));
  write('forge.config.ts', `export default {baseDir: './src',componentRoots:['./src/components'],outDir:'./generated',pathPrefix:'fixture/',typescriptLibPath:${JSON.stringify(path.join(root, 'node_modules/typescript/lib'))},reactTypesFilePath:${JSON.stringify(path.join(path.dirname(require.resolve('@types/react/package.json')), 'index.d.ts'))}}`);
  write('next.config.mjs', `export default {turbopack: {root: ${JSON.stringify(root)}},experimental: {cpus: 1}, devIndicators: false}`);
  write('src/components/Card.tsx', 'export function Card({title}: {title:string}) {return <div>{title}</div>}');
  write('app/layout.tsx', 'export default function Layout({children}: {children: React.ReactNode}) {return <html><body>{children}</body></html>}');
  write('app/page.tsx', `import {components} from '../generated/index'; export default function Page() {return <main>{components.files.flatMap(file=>Object.keys(file.components)).join(',')}</main>}`);
  write('app/api/metadata/route.ts', `import {readFile} from 'node:fs/promises';import path from 'node:path';import {components} from '../../../generated/index';export const dynamic='force-dynamic';export async function GET(){return Response.json({registry:components.files.flatMap(file=>Object.keys(file.components)), metadata:JSON.parse(await readFile(path.join(process.cwd(),'generated/metadata.json'),'utf8'))})}`);
}
async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitFor(action, timeout = 90000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const result = await action(); if (result) return result; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Next: ${last?.message ?? 'condition not met'}`);
}

test('Next wrapper preserves asynchronous config/hooks and skips unrelated phases', async () => {
  let calls = 0;
  const webpack = value => value;
  const wrapped = withReactiveForge({tsConfigFilePath: 'must-not-read-this.json'})(async (phase, context) => {
    calls++;
    assert.equal(phase, 'phase-production-server');
    assert.equal(context.defaultConfig.reactStrictMode, false);
    return {webpack, reactStrictMode: true, images: {unoptimized: true}};
  });
  const result = await wrapped('phase-production-server', {defaultConfig: {reactStrictMode: false}});
  assert.equal(calls, 1);
  assert.equal(result.webpack, webpack);
  assert.deepEqual(result.images, {unoptimized: true});
  assert.equal(result.reactStrictMode, true);
});

test('Next CLI generates before real Turbopack build and Webpack dev regenerates edit/add/delete', {timeout: 300000}, async () => {
  setup();
  const env = {...process.env, NEXT_TELEMETRY_DISABLED: '1'};
  const build = spawnSync(process.execPath, [bin, 'build', fixture], {cwd: root, env, encoding: 'utf8', timeout: 180000});
  assert.ifError(build.error);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  assert.ok(fs.existsSync(path.join(fixture, '.next/BUILD_ID')));
  const config = {reactStrictMode: true};
  const wrapped = withReactiveForge({outDir: './wrapper-generated'}, {projectRootDir: fixture})(config);
  assert.equal(await wrapped('phase-development-server', {defaultConfig: {}}), config);
  assert.ok(fs.existsSync(path.join(fixture, 'wrapper-generated/metadata.json')), 'config wrapper generates during development without adding Webpack hooks');
  assert.equal(config.webpack, undefined);
  const port = await unusedPort();
  // IPC asks the CLI process to handle SIGINT itself; Windows child.kill bypasses
  // JavaScript signal handlers and would not exercise graceful watcher teardown.
  const launch = `process.argv=[process.execPath,${JSON.stringify(bin)},'dev','--webpack','--hostname','127.0.0.1','--port',${JSON.stringify(String(port))}];process.on('message',()=>{process.disconnect();process.emit('SIGINT')});import(${JSON.stringify(pathToFileURL(bin).href)});`;
  const child = spawn(process.execPath, ['-e', launch], {cwd: fixture, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
  let log = '';
  child.stdout.on('data', chunk => {log += chunk});
  child.stderr.on('data', chunk => {log += chunk});
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
  const get = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/metadata`, {signal: AbortSignal.timeout(5000)});
    assert.equal(response.status, 200, log);
    return response.json();
  };
  try {
    const initial = await waitFor(async () => {const data = await get(); return data.registry.includes('Card') && data});
    assert.ok(initial.metadata.components.find(c => c.name === 'Card'));
    write('src/components/Card.tsx', 'export function Card({title,count}: {title:string;count:number}) {return <div>{title}:{count}</div>}');
    await waitFor(async () => {const data = await get(); return JSON.stringify(data.metadata.components.find(c => c.name === 'Card')).includes('count')});
    write('src/components/Badge.tsx', 'export function Badge({label}: {label:string}) {return <span>{label}</span>}');
    await waitFor(async () => {const data = await get(); return data.registry.includes('Badge') && data.metadata.components.some(c => c.name === 'Badge')});
    fs.unlinkSync(path.join(fixture, 'src/components/Badge.tsx'));
    await waitFor(async () => {const data = await get(); return !data.registry.includes('Badge') && !data.metadata.components.some(c => c.name === 'Badge')});
  } finally {
    if (child.connected) child.send('shutdown');
    let shutdownTimer;
    const ended = await Promise.race([exit, new Promise(resolve => {shutdownTimer = setTimeout(() => resolve(undefined), 10000)})]);
    clearTimeout(shutdownTimer);
    if (!ended) child.kill('SIGKILL');
    assert.ok(ended, `forge-next must exit and close its watcher after interrupt\n${log}`);
    await waitFor(() => new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {socket.destroy(); resolve(false)});
      socket.once('error', () => {socket.destroy(); resolve(true)});
    }), 10000);
  }
});
