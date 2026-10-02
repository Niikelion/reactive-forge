const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs/promises');
const {createGenerationService} = require('../packages/codegen/src/index.ts');
const root = path.resolve(__dirname, '..');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(root, '.cache-forge-service-'));
  const services = [];
  t.after(async () => {
    for (const service of services) await service.close();
    assert.equal(path.dirname(directory), root);
    assert.ok(path.basename(directory).startsWith('.cache-forge-service-'));
    await fs.rm(directory, {recursive: true, force: true});
  });
  await fs.mkdir(path.join(directory, 'src'));
  await fs.writeFile(path.join(directory, 'tsconfig.base.json'), JSON.stringify({compilerOptions: {
    strict: true, jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'Bundler', skipLibCheck: true,
    baseUrl: root, paths: {'@reactive-forge/schema': ['packages/schema/src/index.ts']}
  }}));
  await fs.writeFile(path.join(directory, 'tsconfig.json'), JSON.stringify({extends: './tsconfig.base.json', include: ['src', 'annotation.ts']}));
  const component = path.join(directory, 'src/card.tsx');
  await fs.writeFile(component, 'export const Card = (props: {title: string}) => <h1>{props.title}</h1>;');
  const config = {typescriptLibPath: path.join(root, 'node_modules/typescript/lib'), outDir: 'generated'};
  return {directory, component, config, closeWith: service => services.push(service), metadata: async (out = 'generated') => JSON.parse(await fs.readFile(path.join(directory, out, 'metadata.json'), 'utf8'))};
}

test('shared generation rebuilds changed/added/deleted components and reloads imported config, annotations and tsconfig', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.directory, 'settings.ts'), 'export const output = "generated";');
  await fs.writeFile(path.join(f.directory, 'forge.config.ts'), 'import {output} from "./settings"; export default {outDir: output, annotationSources: {overrideSources: ["annotation.ts"]}};');
  const annotation = path.join(f.directory, 'annotation.ts');
  await fs.writeFile(annotation, 'import {defineComponentMetadata} from "../packages/codegen/src/slotAuthoring"; import {Card} from "./src/card"; export default [defineComponentMetadata(Card, {groups: [{kind:"group", id:"example/First"}]})];');
  const service = await createGenerationService({typescriptLibPath: f.config.typescriptLibPath}, {projectRootDir: f.directory});
  f.closeWith(service);
  await service.generate();
  assert.equal((await f.metadata()).components[0].groups[0].id, 'example/First');
  assert.equal(service.isRelevant(path.join(f.directory, 'tsconfig.base.json')), true);
  assert.equal(service.isRelevant(path.join(f.directory, 'settings.ts')), true);
  assert.equal(service.isRelevant(path.join(f.directory, 'generated/index.ts')), false);
  assert.equal(service.isRelevant(path.join(f.directory, '.next/types/page.ts')), false);
  await fs.writeFile(f.component, 'export const Card = (props: {title: number}) => <h1>{props.title}</h1>;');
  service.invalidate(f.component); await service.flush();
  assert.equal((await f.metadata()).components[0].props.title.schema.type, 'number');
  const extra = path.join(f.directory, 'src/extra.tsx');
  await fs.writeFile(extra, 'export const Extra = () => <p />;');
  service.invalidate(extra); await service.flush();
  assert.equal((await f.metadata()).components.length, 2);
  await fs.unlink(extra); service.invalidate(extra); await service.flush();
  assert.equal((await f.metadata()).components.length, 1);
  await fs.writeFile(annotation, 'import {defineComponentMetadata} from "../packages/codegen/src/slotAuthoring"; import {Card} from "./src/card"; export default [defineComponentMetadata(Card, {groups: []})];');
  service.invalidate(annotation); await service.flush();
  assert.deepEqual((await f.metadata()).components[0].groups, []);
  await fs.writeFile(path.join(f.directory, 'settings.ts'), 'export const output = "new-generated";');
  service.invalidate(path.join(f.directory, 'settings.ts')); await service.flush();
  assert.equal(service.config.outDir, path.join(f.directory, 'new-generated'));
  assert.equal((await f.metadata('new-generated')).components.length, 1);
});

test('watch errors retain usable output, recover on correction and stop after close', async t => {
  const f = await fixture(t);
  const errors = [];
  let runs = 0;
  const service = await createGenerationService(f.config, {projectRootDir: f.directory, debounceMs: 10,
    onError: error => errors.push(error), onGenerated: () => runs++});
  f.closeWith(service);
  await service.generate(); await service.watch();
  const before = await fs.readFile(path.join(f.directory, 'generated/metadata.json'), 'utf8');
  await fs.writeFile(path.join(f.directory, 'forge.config.ts'), 'export default {broken syntax');
  await until(() => errors.length > 0);
  assert.equal(await fs.readFile(path.join(f.directory, 'generated/metadata.json'), 'utf8'), before);
  await fs.writeFile(path.join(f.directory, 'forge.config.ts'), 'export default 42;');
  await until(() => errors.length === 2);
  assert.match(errors[1].message, /must export a plain configuration object/);
  assert.equal(await fs.readFile(path.join(f.directory, 'generated/metadata.json'), 'utf8'), before);
  await fs.writeFile(path.join(f.directory, 'forge.config.ts'), 'export default {};');
  await until(() => runs === 2);
  await fs.writeFile(f.component, 'export const Card = () => <p />;');
  await until(() => runs === 3);
  assert.deepEqual((await f.metadata()).components[0].props, {});
  await service.close();
  await fs.writeFile(f.component, 'export const Card = (props: {title: string}) => <p />;');
  service.invalidate(f.component); await service.flush();
  assert.equal(runs, 3);
});

test('burst invalidations coalesce and an invalidation during generation schedules one follow-up', async t => {
  const f = await fixture(t);
  let runs = 0;
  let invalidateDuringRun = false;
  const service = await createGenerationService(f.config, {projectRootDir: f.directory,
    onGenerated() { runs++; if (invalidateDuringRun) { invalidateDuringRun = false; service.invalidate(f.component); } }});
  f.closeWith(service);
  service.invalidate(f.component); service.invalidate(f.component); service.invalidate(f.component);
  await service.flush(); assert.equal(runs, 1);
  invalidateDuringRun = true;
  await service.generate(); assert.equal(runs, 3);
});

test('disabled config discovery and framework TypeScript fallback obey explicit configuration', async t => {
  const f = await fixture(t);
  await fs.rename(path.join(f.directory, 'tsconfig.json'), path.join(f.directory, 'tsconfig.app.json'));
  await fs.writeFile(path.join(f.directory, 'forge.config.ts'), 'invalid syntax is never loaded');
  const service = await createGenerationService(f.config, {projectRootDir: f.directory, configFile: false,
    defaultTsConfigFilePath: 'tsconfig.app.json'});
  f.closeWith(service);
  await service.generate();
  assert.equal(service.config.tsConfigFilePath, path.join(f.directory, 'tsconfig.app.json'));
  assert.equal(service.watchPaths.includes(path.join(f.directory, 'forge.config.ts')), false);
  assert.equal((await f.metadata()).components.length, 1);
  await fs.writeFile(path.join(f.directory, 'forge.config.ts'), 'export default {tsConfigFilePath: "tsconfig.app.json"};');
  const explicit = await createGenerationService(f.config, {projectRootDir: f.directory,
    defaultTsConfigFilePath: 'does-not-exist.json'});
  f.closeWith(explicit);
  await explicit.generate();
  assert.equal(explicit.config.tsConfigFilePath, path.join(f.directory, 'tsconfig.app.json'));
});

test('watch discovers imported TypeScript dependencies outside the project root', async t => {
  const f = await fixture(t);
  const app = path.join(f.directory, 'app');
  await fs.mkdir(path.join(app, 'src'), {recursive: true});
  const shared = path.join(f.directory, 'shared.ts');
  await fs.writeFile(shared, 'export interface SharedProps {title: string}');
  await fs.writeFile(path.join(app, 'src/card.tsx'), 'import type {SharedProps} from "../../shared"; export const Card = (props: SharedProps) => <h1>{props.title}</h1>;');
  await fs.writeFile(path.join(app, 'tsconfig.json'), JSON.stringify({extends: '../tsconfig.base.json', include: ['src']}));
  let runs = 0;
  const service = await createGenerationService(f.config, {projectRootDir: app, onGenerated: () => runs++});
  f.closeWith(service);
  await service.generate();
  assert.equal(service.isRelevant(shared), true);
  assert.equal(service.watchPaths.includes(shared), true);
  await service.watch();
  await fs.writeFile(shared, 'export interface SharedProps {title: number}');
  await until(() => runs === 2);
  const metadata = JSON.parse(await fs.readFile(path.join(app, 'generated/metadata.json'), 'utf8'));
  assert.equal(metadata.components[0].props.title.schema.type, 'number');
});

async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Watcher did not produce the expected event');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
