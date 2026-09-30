const assert = require('node:assert/strict');
const test = require('node:test');
const { Text, RichText, defineComponentGroup, checkSlotValue } = require('../packages/schema/src/index.ts');

const custom = defineComponentGroup('app/navigation');
const entry = (id, groups) => ({ id, groups, component: () => null, args: { type: 'unknown' } });
const library = { files: [{ path: 'test', components: {
  a: entry('a', [Text, custom]), b: entry('b', [Text]), c: entry('c', [RichText]),
} }] };
const context = (overrides = {}) => ({ library, currentItemCount: 0, currentNonVoidCount: 0, ...overrides });
const rule = (accepts, kind = 'components') => ({ path: ['children'], slot: { kind, accepts, multiple: true }, appliedFrom: {} });
const node = id => ({ itemId: 'item', kind: 'instance', instance: { componentId: id } });
const code = result => result.diagnostics?.[0].code;

test('groups: helpers are ordinary portable identities and reject unnamespaced IDs', () => {
  assert.deepEqual(Text, { kind: 'group', id: 'forge/Text' });
  assert.deepEqual(RichText, { kind: 'group', id: 'forge/RichText' });
  for (const id of ['', 'Text', '/Text', 'forge/', 'forge//Text', 'forge/ RichText']) assert.throws(() => defineComponentGroup(id));
  assert.equal(checkSlotValue(rule([JSON.parse(JSON.stringify(Text))]), node('a'), context()).ok, true);
});

test('groups: alternatives accept multiple implementations and explicit identities', () => {
  assert.equal(checkSlotValue(rule([Text]), node('a'), context()).ok, true);
  assert.equal(checkSlotValue(rule([Text]), node('b'), context()).ok, true);
  assert.equal(code(checkSlotValue(rule([Text]), node('c'), context())), 'component-not-accepted');
  assert.equal(checkSlotValue(rule([Text, { source: 'project', id: 'c' }]), node('c'), context()).ok, true);
  assert.equal(checkSlotValue(rule([custom]), node('a'), context()).ok, true);
  assert.equal(code(checkSlotValue(rule([]), node('a'), context())), 'component-not-accepted');
  assert.equal(checkSlotValue(rule([]), { itemId: 'empty', kind: 'void' }, context()).ok, true);
});

test('groups: metadata cannot grant membership and unknown groups diagnose registry configuration', () => {
  const metadata = { schemaVersion: 4, components: [{ id: 'c', groups: [Text] }] };
  assert.equal(code(checkSlotValue(rule([Text]), node('c'), context({ metadata }))), 'component-not-accepted');
  assert.equal(code(checkSlotValue(rule([defineComponentGroup('app/missing')]), node('a'), context())), 'group-not-registered');
  const declared = { ...library, componentGroups: [defineComponentGroup('app/empty')] };
  assert.equal(code(checkSlotValue(rule([defineComponentGroup('app/empty')]), node('a'), context({ library: declared }))), 'component-not-accepted');
  assert.equal(code(checkSlotValue(rule([Text]), { itemId: 'raw', kind: 'text', value: 'hello' }, context())), 'text-not-accepted');
});

test('groups: external component references require real registry entries and share matching', () => {
  const external = { source: 'external', package: 'widgets', exportName: 'Heading', isDefault: false };
  const metadata = { schemaVersion: 4, components: [{ id: 'a', external }] };
  assert.equal(checkSlotValue(rule([Text], 'componentRef'), external, context({ metadata })).ok, true);
  assert.equal(checkSlotValue(rule([external]), node('a'), context({ metadata })).ok, true);
  assert.equal(code(checkSlotValue(rule([external], 'componentRef'), external, context())), 'component-not-in-library');
  assert.equal(code(checkSlotValue(rule([external], 'componentRef'), external, context({ metadata, library: { files: [] } }))), 'component-not-in-library');
});

test('groups: malformed saved references and forged group nodes diagnose instead of crashing', () => {
  for (const value of [null, {}, { kind: 'group', id: 'forge/Text' }, { kind: 'instance', itemId: 'bad' }, { source: 'project' }])
    assert.equal(code(checkSlotValue(rule([Text]), value, context())), 'invalid-slot-value');
});
