const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Project, ts } = require('ts-morph');
const { findDefineComponentMetadataCalls, parseDefineComponentMetadataCall } = require('../packages/codegen/src/annotations/parseRules.ts');
const { mergeAuthoredRules } = require('../packages/codegen/src/annotations/merge.ts');

function parse(editor) {
  const project = new Project({ useInMemoryFileSystem: true });
  const source = project.createSourceFile('/fixture.ts', `function Button() {}\ndefineComponentMetadata(Button, {rules: [{path: ['onClick'], editor: ${editor}}]});`);
  return parseDefineComponentMetadataCall(findDefineComponentMetadataCalls(source)[0], { rootDir: '/' });
}
test('editor annotations statically preserve all visibility choices and presentation fields', () => {
  assert.equal(parse(`{'visibility': 'primary'}`).rules[0].editor.visibility, 'primary');
  for (const visibility of ['primary', 'advanced', 'hidden', 'auto']) {
    const parsed = parse(`{visibility: '${visibility}', group: 'events', label: 'On click'}`);
    assert.deepEqual(parsed.diagnostics, []);
    assert.deepEqual(parsed.rules[0].editor, { visibility, group: 'events', label: 'On click' });
  }
});
test('invalid or dynamic editor objects are diagnosed and ignored without executing code', () => {
  for (const expression of [
    `makeEditor()`, `{visibility: 'garbage'}`, `{visibility: setting}`, `{label: 3}`,
    `{...settings, label: 'Click'}`, `{group}`, `{unexpected: 'x'}`, `{['label']: 'Click'}`,
    `{visibility: 'primary', visibility: 'hidden'}`
  ]) {
    const parsed = parse(expression);
    assert.equal(parsed.rules.length, 0, expression);
    assert.ok(parsed.diagnostics.some(d => d.code === 'unsupported-annotation-expression'), expression);
  }
});
function authored(editor, layer = 'library', line = 1) {
  return { componentId: 'button', layer, rule: { path: ['onClick'], editor }, location: { sourcePath: '/fixture.ts', line, column: 1 } };
}
test('same-layer editor fields compose, conflicts retain first value and identify its source', () => {
  const [merged] = mergeAuthoredRules([
    authored({ group: 'events' }, 'library', 1),
    authored({ visibility: 'primary', label: 'Click' }, 'library', 2),
    authored({ visibility: 'hidden', label: 'Click' }, 'library', 3)
  ]).values();
  assert.deepEqual(merged.rule.editor, { group: 'events', visibility: 'primary', label: 'Click' });
  assert.equal(merged.diagnostics.length, 1);
  assert.match(merged.diagnostics[0].message, /editor.visibility/);
  assert.match(merged.diagnostics[0].message, /fixture.ts:2:1/);
});
test('project override merges individual fields and preserves explicit auto reset', () => {
  const [merged] = mergeAuthoredRules([
    authored({ visibility: 'hidden', group: 'events', label: 'Click' }),
    authored({ visibility: 'auto' }, 'project')
  ]).values();
  assert.deepEqual(merged.rule.editor, { visibility: 'auto', group: 'events', label: 'Click' });
  assert.deepEqual(merged.diagnostics, []);
  assert.equal(merged.rule.editorAppliedFrom.visibility, 'project');
});
test('generated metadata separates presentation rules and diagnoses hidden required props', async () => {
  const { extractComponents } = require('../packages/codegen/src/extract.ts');
  const { generateFiles } = require('../packages/codegen/src/generate.ts');
  const schema = require('../packages/schema/src/index.ts');
  schema.registerCommonSchemas();
  const root = path.resolve(__dirname, '..');
  const outDir = await fs.mkdtemp(path.join(root, '.cache-forge-test-editor-'));
  try {
    const project = new Project({ compilerOptions: { strict: true, moduleResolution: ts.ModuleResolutionKind.NodeJs } });
    const source = project.createSourceFile(path.join(root, 'tests', '__editor_generation_fixture.ts'), `
      import type { ReactNode } from 'react';
      export function Card(props: { title: string; children?: ReactNode }) { return null; }
      export const metadata = defineComponentMetadata(Card, {rules: [
        {path: ['title'], editor: {visibility: 'hidden'}},
        {path: ['children'], editor: {visibility: 'primary', label: 'Content'}}
      ]});
    `);
    const components = extractComponents(project, [source.getFilePath()]);
    await generateFiles(project, components, { outDir, rootDir: root, baseDir: root, pathPrefix: '', annotationSources: {} }, { info() {} });
    const document = JSON.parse(await fs.readFile(path.join(outDir, 'metadata.json'), 'utf8'));
    const card = document.components.find(c => c.name === 'Card');
    assert.equal(card.editorRules.length, 2);
    assert.equal(card.editorRules.find(rule => rule.path[0] === 'children').editor.label, 'Content');
    assert.ok(card.slots.every(rule => rule.editor === undefined));
    assert.ok(!card.slots.some(rule => rule.path[0] === 'title'));
    assert.equal(schema.resolveSlotPolicy(card, ['children']).slot.kind, 'any');
    assert.ok(card.diagnostics.some(d => d.code === 'required-editor-visibility'));
  } finally {
    assert.equal(path.dirname(path.resolve(outDir)), root);
    assert.ok(path.basename(outDir).startsWith('.cache-forge-test-editor-'));
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
