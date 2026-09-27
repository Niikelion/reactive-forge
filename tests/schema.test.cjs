const assert = require('node:assert/strict');
const test = require('node:test');
const { ArraySchema, ObjectSchema, StringSchema, NumberSchema, c, equals, isAssignableTo, registerCommonSchemas, schemaFromJson } = require('../packages/schema/src/index.ts');
registerCommonSchemas();

test('S01: primitive literals and required object props validate supplied values', () => {
  const schema = new ObjectSchema({ title: { schema: new StringSchema('hello'), required: true }, count: { schema: new NumberSchema(), required: false } });
  assert.equal(schema.verifyConstructType(c.object({ title: c.string('hello') })), true);
  assert.equal(schema.verifyConstructType(c.object({})), false);
  assert.equal(schema.verifyConstructType(c.object({ title: c.string('wrong') })), false);
  assert.equal(schema.verifyConstructType(c.object({ title: c.string('hello'), count: c.string('wrong') })), false);
});

test('S02: nested object/array metadata survives actual JSON serialization', () => {
  const schema = new ObjectSchema({ tags: { schema: new ArraySchema([], new StringSchema()), required: true } });
  const restored = schemaFromJson(JSON.parse(JSON.stringify(schema.toJson())));
  assert.equal(equals(schema, restored), true);
  assert.equal(restored.verifyConstructType(c.object({ tags: c.array([c.string('tag')]) })), true);
  assert.equal(restored.verifyConstructType(c.object({ tags: c.array([c.number(1)]) })), false);
});

test('S03: string index signature accepts strings and rejects numbers', () => {
  const schema = new ObjectSchema({}, new StringSchema());
  assert.equal(schema.verifyConstructType(c.object({ anyKey: c.string('valid') })), true);
  assert.equal(schema.verifyConstructType(c.object({ anyKey: c.number(1) })), false);
});

test('S04: object index signature survives a JSON round trip', () => {
  const schema = new ObjectSchema({}, new StringSchema());
  assert.equal(equals(schema, schemaFromJson(JSON.parse(JSON.stringify(schema.toJson())))), true);
});

test('S05: literal string is assignable to broad string, not conversely', () => {
  assert.equal(isAssignableTo(new StringSchema('a'), new StringSchema()), true);
  assert.equal(isAssignableTo(new StringSchema(), new StringSchema('a')), false);
});

test('S06: construct equality distinguishes different object keys', () => {
  assert.equal(c.equals(c.object({ a: c.string('x') }), c.object({ b: c.string('x') })), false);
});

test('S07: construct equality distinguishes dates sharing day of month', () => {
  assert.equal(c.equals(c.date(new Date('2025-01-01T00:00:00Z')), c.date(new Date('2025-02-01T00:00:00Z'))), false);
});

test('S08: registering common schemas twice is safe for repeated codegen calls', () => {
  assert.doesNotThrow(() => registerCommonSchemas());
});
