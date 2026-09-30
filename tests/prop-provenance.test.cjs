const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { Project, ts } = require('ts-morph');
const { extractPropProvenance } = require('../packages/codegen/src/propProvenance.ts');
const { extractComponents } = require('../packages/codegen/src/extract.ts');
const { buildProps } = require('../packages/codegen/src/metadataProps.ts');
require('../packages/schema/src/index.ts').registerCommonSchemas();
const project = new Project({ compilerOptions: { strict: true, moduleResolution: ts.ModuleResolutionKind.NodeJs } });
const source = project.createSourceFile(path.resolve(__dirname, '__provenance_fixture.ts'), `
import type { ComponentProps, ButtonHTMLAttributes } from 'react';
interface AppearanceProps { size?: 'small' | 'large' }
interface Broad extends ButtonHTMLAttributes<HTMLButtonElement>, AppearanceProps { variant: string }
type Selected = Pick<ComponentProps<'button'>, 'disabled' | 'onClick'> & { variant: string };
type Omitted = Omit<ComponentProps<'button'>, 'children'>;
interface Override extends ButtonHTMLAttributes<HTMLButtonElement> { disabled?: boolean }
interface Left { title?: string }
interface Right { title?: string }
type Mixed = Left & Right;
type Unknown = Record<string, unknown>;
export function Example(props: { own: string } & Pick<ComponentProps<'button'>, 'disabled'>) { return null; }
`);
function get(name, prop) {
  const declaration = source.getTypeAlias(name) ?? source.getInterfaceOrThrow(name);
  return extractPropProvenance(declaration.getType(), prop);
}
test('broad native inheritance is distinguished from own and shared component props', () => {
  assert.equal(get('Broad', 'disabled').origin, 'native');
  assert.equal(get('Broad', 'disabled').exposure, 'broad');
  assert.equal(get('Broad', 'size').origin, 'component');
  assert.equal(get('Broad', 'variant').exposure, 'explicit');
});
test('finite Pick exposes native props explicitly while Omit remains broad', () => {
  assert.equal(get('Selected', 'disabled').origin, 'native');
  assert.equal(get('Selected', 'disabled').exposure, 'explicit');
  assert.equal(get('Selected', 'onClick').exposure, 'explicit');
  assert.equal(get('Omitted', 'disabled').exposure, 'broad');
});
test('overrides use their actual declaration and intersections retain declaration sources', () => {
  assert.equal(get('Override', 'disabled').origin, 'component');
  assert.equal(get('Override', 'disabled').declarations[0].typeName, 'Override');
  assert.equal(get('Mixed', 'title').origin, 'component');
  assert.deepEqual(get('Mixed', 'title').declarations.map(d => d.typeName).sort(), ['Left', 'Right']);
  assert.equal(get('Unknown', 'missing').origin, 'unknown');
  assert.equal(get('Unknown', 'missing').exposure, 'unknown');
});
test('intersection props carry provenance through extraction into portable metadata', () => {
  const component = extractComponents(project, [source.getFilePath()]).find(c => c.name === 'Example');
  assert.ok(component);
  const props = buildProps(component);
  assert.equal(props.own.provenance.origin, 'component');
  assert.equal(props.disabled.provenance.origin, 'native');
  assert.equal(props.disabled.provenance.exposure, 'explicit');
});
