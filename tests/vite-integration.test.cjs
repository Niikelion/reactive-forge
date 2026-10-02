const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request === '@reactive-forge/codegen') request = path.join(root, 'packages/codegen/src/index.ts');
  return resolve.call(this, request, parent, ...rest);
};
const {reactiveForge} = require('../packages/vite/src/index.ts');
Module._resolveFilename = resolve;

async function fixture() {
  const directory = await fs.mkdtemp(path.join(root, '.cache-vite-integration-'));
  await fs.mkdir(path.join(directory, 'src/components'), {recursive: true});
  await fs.writeFile(path.join(directory, 'tsconfig.app.json'), JSON.stringify({compilerOptions: {jsx: 'react-jsx', target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true}, include: ['src']}));
  await fs.writeFile(path.join(directory, 'src/components/Button.tsx'), 'export function Button(props: {label: string}) { return <button>{props.label}</button> }');
  await fs.writeFile(path.join(directory, 'src/main.ts'), 'import {components} from "../reactive-forge/index"; console.log(components);');
  await fs.writeFile(path.join(directory, 'index.html'), '<div id="app"></div><script type="module" src="/src/main.ts"></script>');
  return directory;
}

function plugin() {
  return reactiveForge({componentRoots: ['src/components'], typescriptLibPath: '../node_modules/typescript/lib'}, {debounceMs: 25});
}

async function waitFor(read, accept) {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    try { const value = await read(); if (accept(value)) return value; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('Vite regeneration did not reach expected metadata within 20 seconds');
}

test('Vite production build generates missing registry before application imports resolve', async () => {
  const {build} = await import('vite');
  const directory = await fixture();
  try {
    await build({root: directory, configFile: false, plugins: [plugin()], logLevel: 'silent'});
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'reactive-forge/metadata.json'), 'utf8'));
    assert.deepEqual(metadata.components.map(component => component.name), ['Button']);
    const output = await fs.readdir(path.join(directory, 'dist/assets'));
    assert.ok(output.some(file => file.endsWith('.js')));
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
});

test('Vite dev watcher regenerates changed, added and removed components without output loops', async () => {
  const {createServer} = await import('vite');
  const directory = await fixture();
  let server;
  try {
    server = await createServer({root: directory, configFile: false, plugins: [plugin()], logLevel: 'silent', server: {port: 0}});
    await server.listen();
    const metadataPath = path.join(directory, 'reactive-forge/metadata.json');
    const read = async () => JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    assert.deepEqual((await read()).components.map(component => component.name), ['Button']);
    await fs.writeFile(path.join(directory, 'src/components/Button.tsx'), 'export function Button(props: {label: string; disabled?: boolean}) { return <button disabled={props.disabled}>{props.label}</button> }');
    await waitFor(read, metadata => metadata.components[0].props.disabled !== undefined);
    const extra = path.join(directory, 'src/components/Badge.tsx');
    await fs.writeFile(extra, 'export function Badge(props: {text: string}) { return <span>{props.text}</span> }');
    await waitFor(read, metadata => metadata.components.some(component => component.name === 'Badge'));
    await fs.unlink(extra);
    await waitFor(read, metadata => metadata.components.length === 1 && metadata.components[0].name === 'Button');
    // Generated output remains stable after the debounce interval has passed.
    await new Promise(resolve => setTimeout(resolve, 200));
    const before = (await fs.stat(metadataPath)).mtimeMs;
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal((await fs.stat(metadataPath)).mtimeMs, before);
    const transformed = await server.transformRequest('/src/main.ts');
    assert.match(transformed.code, /reactive-forge/);
  } finally {
    await server?.close();
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('Vite reports configuration errors and recovers after a valid configuration edit', async () => {
  const {createServer} = await import('vite');
  const directory = await fixture();
  const configPath = path.join(directory, 'forge.config.ts');
  const valid = 'export default {tsConfigFilePath: "tsconfig.app.json", componentRoots: ["src/components"]}';
  await fs.writeFile(configPath, valid);
  let server;
  try {
    server = await createServer({root: directory, configFile: false, plugins: [plugin()], logLevel: 'silent', server: {port: 0}});
    await server.listen();
    const errors = [];
    const send = server.ws.send.bind(server.ws);
    server.ws.send = (...args) => { if (args[0]?.type === 'error') errors.push(args[0]); return send(...args); };
    await fs.writeFile(configPath, 'export default { componentRoots: [');
    await waitFor(async () => errors, values => values.some(value => value.err.plugin === 'reactive-forge'));
    const extra = path.join(directory, 'src/components/Recovered.tsx');
    await fs.writeFile(extra, 'export function Recovered() { return <p>Recovered</p> }');
    await fs.writeFile(configPath, valid);
    const read = async () => JSON.parse(await fs.readFile(path.join(directory, 'reactive-forge/metadata.json'), 'utf8'));
    await waitFor(read, metadata => metadata.components.some(component => component.name === 'Recovered'));
  } finally {
    await server?.close();
    await fs.rm(directory, {recursive: true, force: true});
  }
});
