const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ArraySchema, ObjectSchema, StringSchema, NumberSchema, BooleanSchema, BigIntSchema, DateSchema,
  FunctionSchema,
  c, equals, isAssignableTo, registerCommonSchemas, schemaFromJson,
  toValueJson, fromValueJson, exampleValue, toDefaultValueJson, createMetadataDocument,
  FunctionConstructNotSerializableError,
} = require('../packages/schema/src/index.ts');
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

test('S09: toValueJson/fromValueJson round-trip every ValueJson variant', () => {
  const cases = [
    { schema: new BooleanSchema(), construct: c.boolean(true) },
    { schema: new NumberSchema(), construct: c.number(42) },
    { schema: new StringSchema(), construct: c.string('hi') },
    { schema: new DateSchema(), construct: c.date(new Date('2025-03-04T05:06:07.000Z')) },
    { schema: new ArraySchema([], new NumberSchema()), construct: c.array([c.number(1), c.number(2)]) },
    {
      schema: new ObjectSchema({ title: { schema: new StringSchema(), required: true } }),
      construct: c.object({ title: c.string('hello') }),
    },
  ];

  for (const { schema, construct } of cases) {
    const json = toValueJson(construct);
    assert.equal(JSON.stringify(json), JSON.stringify(JSON.parse(JSON.stringify(json))));
    const restored = fromValueJson(schema, json);
    assert.equal(c.equals(construct, restored), true);
  }
});

test('S10: bigint values round-trip through ValueJson as a decimal string tag', () => {
  const construct = c.bigint(12345678901234567890n);
  const json = toValueJson(construct);
  assert.deepEqual(json, { type: 'bigint', value: '12345678901234567890' });
  const restored = fromValueJson(new BigIntSchema(), json);
  assert.equal(c.equals(construct, restored), true);
});

test('S11: date values round-trip through ValueJson as an ISO string', () => {
  const date = new Date('2025-06-15T12:00:00.000Z');
  const construct = c.date(date);
  const json = toValueJson(construct);
  assert.deepEqual(json, { type: 'date', value: date.toISOString() });
  const restored = fromValueJson(new DateSchema(), json);
  assert.equal(c.equals(construct, restored), true);
});

test('S12: void/null/undefined values round-trip through ValueJson', () => {
  for (const [construct, expectedType] of [[c.void(), 'void'], [c.null(), 'null'], [c.undefined(), 'undefined']]) {
    const json = toValueJson(construct);
    assert.deepEqual(json, { type: expectedType });
  }
});

test('S13: toValueJson rejects a FunctionConstruct, including nested inside an object', () => {
  const fn = c.function(() => 1, new NumberSchema(), new ArraySchema([]));
  assert.throws(() => toValueJson(fn), FunctionConstructNotSerializableError);
  assert.throws(() => toValueJson(c.object({ onClick: fn })), FunctionConstructNotSerializableError);
});

test('S14: exampleValue derives a ValueJson from a schema\'s exampleConstruct', () => {
  const schema = new ObjectSchema({
    title: { schema: new StringSchema('hello'), required: true },
    count: { schema: new NumberSchema(), required: false },
  });
  const value = exampleValue(schema);
  assert.deepEqual(value, toValueJson(schema.exampleConstruct));
  assert.deepEqual(value, { type: 'object', value: { title: { type: 'string', value: 'hello' }, count: { type: 'number', value: 0 } } });
});

test('S15: exampleValue returns undefined instead of throwing for function-shaped schemas', () => {
  const schema = new FunctionSchema(new NumberSchema(), new ArraySchema([]));
  assert.equal(exampleValue(schema), undefined);
});

test('S16: toDefaultValueJson validates a literal default against its schema', () => {
  const schema = new StringSchema();
  const value = toDefaultValueJson(schema, { type: 'string', value: 'medium' });
  assert.deepEqual(value, { type: 'string', value: 'medium' });
  assert.throws(() => toDefaultValueJson(schema, { type: 'number', value: 1 }));
});

test('S17: ValueJson survives real JSON.stringify/JSON.parse round trips byte-for-byte', () => {
  const schema = new ObjectSchema({
    tags: { schema: new ArraySchema([], new StringSchema()), required: true },
    big: { schema: new BigIntSchema(), required: true },
    when: { schema: new DateSchema(), required: true },
  });
  const construct = c.object({
    tags: c.array([c.string('a'), c.string('b')]),
    big: c.bigint(9007199254740993n),
    when: c.date(new Date('2024-12-25T00:00:00.000Z')),
  });
  const json = toValueJson(construct);
  const roundTripped = JSON.parse(JSON.stringify(json));
  assert.deepEqual(roundTripped, json);
  assert.equal(c.equals(fromValueJson(schema, roundTripped), construct), true);
});

test('S18: fixed schema literal/index JSON fields no longer leak bigint or undefined', () => {
  const bigintJson = new BigIntSchema(5n).toJson();
  assert.equal(typeof bigintJson.literal, 'string');
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(bigintJson))), JSON.stringify(bigintJson));

  const numberJson = new NumberSchema().toJson();
  assert.equal('literal' in numberJson, false);

  const arrayJson = new ArraySchema([]).toJson();
  assert.equal('indexType' in arrayJson, false);

  const objectJson = new ObjectSchema({}).toJson();
  assert.equal('indexType' in objectJson, false);
});

test('S19: createMetadataDocument assembles a schemaVersion-1 document that survives JSON round trip', () => {
  const component = {
    id: 'abc123',
    name: 'Card',
    sourcePath: 'components/cards.tsx',
    isDefault: false,
    props: {
      title: {
        schema: new StringSchema().toJson(),
        required: true,
        exampleValue: exampleValue(new StringSchema()),
        diagnostics: [],
      },
    },
    diagnostics: [],
  };
  const doc = createMetadataDocument([component], '2026-09-27T00:00:00.000Z');
  assert.equal(doc.schemaVersion, 1);
  const restored = JSON.parse(JSON.stringify(doc));
  assert.deepEqual(restored, doc);
});
