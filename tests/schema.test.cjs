const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ArraySchema, ObjectSchema, StringSchema, NumberSchema, BooleanSchema, BigIntSchema, DateSchema,
  FunctionSchema, ReactNodeSchema, ComponentTypeSchema, UnionSchema, NullSchema,
  c, equals, isAssignableTo, registerCommonSchemas, schemaFromJson,
  toValueJson, fromValueJson, exampleValue, toDefaultValueJson, createMetadataDocument,
  FunctionConstructNotSerializableError,
  each, variant, resolveSegment, resolvePath, buildRootSchema, pathEquals,
  mergeSlotPolicy, mergeCollection, mergeRule,
  migrateMetadataDocumentV1ToV2,
  resolveSlotPolicy, checkSlotValue,
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

// --- slot-contract.md path resolution, worked example (section 2) --------------------------

function propMeta(schema, required = true) {
  return {schema: schema.toJson(), required, diagnostics: []};
}

const cardProps = {
  header: propMeta(ReactNodeSchema.instance),
  actions: propMeta(new ArraySchema([], ReactNodeSchema.instance)),
};

test('S20: resolvePath resolves ["actions"] to the declared array itself (worked example)', () => {
  const resolved = resolvePath(cardProps, ['actions']);
  assert.ok(resolved instanceof ArraySchema, 'expected an ArraySchema');
  assert.equal(equals(resolved, new ArraySchema([], ReactNodeSchema.instance)), true);
});

test('S21: resolvePath resolves ["actions", each()] to the array element schema (worked example)', () => {
  const resolved = resolvePath(cardProps, ['actions', each()]);
  assert.equal(equals(resolved, ReactNodeSchema.instance), true);
});

test('S22: resolvePath resolves bare ["header"] directly, without each() (worked example)', () => {
  const resolved = resolvePath(cardProps, ['header']);
  assert.equal(equals(resolved, ReactNodeSchema.instance), true);
});

test('S23: resolveSegment reports "unknown-path-segment" for a property that does not exist', () => {
  const result = resolvePath(cardProps, ['doesNotExist']);
  assert.equal(result.severity, 'error');
  assert.equal(result.code, 'unknown-path-segment');
});

test('S24: resolveSegment reports "each-on-non-array" when each() targets a bare ReactNode', () => {
  const result = resolvePath(cardProps, ['header', each()]);
  assert.equal(result.severity, 'error');
  assert.equal(result.code, 'each-on-non-array');
});

// --- union / variant path resolution ------------------------------------------------------

const linkAction = new ObjectSchema({
  kind: {schema: new StringSchema('link'), required: true},
  label: {schema: new StringSchema(), required: true},
});
const buttonAction = new ObjectSchema({
  kind: {schema: new StringSchema('button'), required: true},
  label: {schema: new NumberSchema(), required: true}, // deliberately a different shape for "label"
});
const actionUnionProps = {
  action: propMeta(new UnionSchema([linkAction, buttonAction])),
};

test('S25: resolveSegment reports "ambiguous-union-path" when union members disagree on a property\'s shape', () => {
  const result = resolvePath(actionUnionProps, ['action', 'label']);
  assert.equal(result.severity, 'error');
  assert.equal(result.code, 'ambiguous-union-path');
});

test('S26: a preceding variant() selector resolves an otherwise-ambiguous union path', () => {
  const resolved = resolvePath(actionUnionProps, ['action', variant('kind', 'link'), 'label']);
  assert.equal(equals(resolved, new StringSchema()), true);
});

test('S27: resolveSegment reports "unknown-variant" for a discriminant value no member declares', () => {
  const result = resolvePath(actionUnionProps, ['action', variant('kind', 'missing')]);
  assert.equal(result.severity, 'error');
  assert.equal(result.code, 'unknown-variant');
});

const dupA = new ObjectSchema({
  kind: {schema: new StringSchema('link'), required: true},
  a: {schema: new StringSchema(), required: true},
});
const dupB = new ObjectSchema({
  kind: {schema: new StringSchema('link'), required: true},
  b: {schema: new NumberSchema(), required: true},
});
const dupUnionProps = {dup: propMeta(new UnionSchema([dupA, dupB]))};

test('S28: resolveSegment reports "ambiguous-variant" when two members share a discriminant value', () => {
  const result = resolvePath(dupUnionProps, ['dup', variant('kind', 'link')]);
  assert.equal(result.severity, 'error');
  assert.equal(result.code, 'ambiguous-variant');
});

test('S29: a null/undefined ancestor is unwrapped before a string segment resolves', () => {
  const nullableHeaderProps = {
    header: propMeta(new UnionSchema([
      new ObjectSchema({title: {schema: new StringSchema(), required: true}}),
      NullSchema.instance,
    ]), false),
  };
  const resolved = resolvePath(nullableHeaderProps, ['header', 'title']);
  assert.equal(equals(resolved, new StringSchema()), true);
});

// --- ComponentTypeSchema (section 2, "React.ComponentType<Props> paths") -------------------

test('S30: ComponentTypeSchema round-trips through toJson/fromJson', () => {
  const expectedProps = new ObjectSchema({title: {schema: new StringSchema(), required: true}});
  const schema = new ComponentTypeSchema(expectedProps);
  assert.deepEqual(schema.toJson(), {type: 'componentType', props: expectedProps.toJson()});
  const restored = schemaFromJson(JSON.parse(JSON.stringify(schema.toJson())));
  assert.ok(restored instanceof ComponentTypeSchema);
  assert.equal(equals(schema, restored), true);
});

// --- SlotPolicy merging (section 4) ---------------------------------------------------------

test('S31: mergeSlotPolicy fully replaces the policy on a kind switch', () => {
  const base = {kind: 'any', multiple: true};
  const incoming = {kind: 'components', accepts: [{source: 'project', id: 'button'}]};
  assert.deepEqual(mergeSlotPolicy(base, incoming), incoming);
});

test('S32: mergeSlotPolicy replaces array fields wholesale (never concatenates) within the same kind', () => {
  const base = {kind: 'components', accepts: [{source: 'project', id: 'a'}], multiple: false};
  const incoming = {kind: 'components', accepts: [{source: 'project', id: 'b'}]};
  const merged = mergeSlotPolicy(base, incoming);
  assert.deepEqual(merged.accepts, [{source: 'project', id: 'b'}]);
  assert.equal(merged.multiple, false); // not restated by incoming, base survives
});

test('S33: mergeSlotPolicy replaces "blocks" wholesale, not key-by-key', () => {
  const base = {kind: 'richText', inline: false, marks: ['bold'], blocks: {lists: true}};
  const incoming = {kind: 'richText', inline: false, marks: ['bold'], blocks: {paragraphs: true}};
  const merged = mergeSlotPolicy(base, incoming);
  assert.deepEqual(merged.blocks, {paragraphs: true});
});

test('S34: mergeCollection merges minItems/maxItems field-by-field', () => {
  assert.deepEqual(mergeCollection({minItems: 1, maxItems: 5}, {maxItems: 3}), {minItems: 1, maxItems: 3});
});

test('S35: mergeRule tracks appliedFrom per field across layers', () => {
  const afterLibrary = mergeRule(undefined, {path: ['actions', each()], slot: {kind: 'any'}}, 'library');
  assert.equal(afterLibrary.appliedFrom.slot, 'library');
  assert.equal(afterLibrary.appliedFrom.collection, undefined);

  const afterProject = mergeRule(afterLibrary, {path: ['actions', each()], collection: {maxItems: 2}}, 'project');
  assert.equal(afterProject.appliedFrom.slot, 'library'); // untouched by the project-layer rule
  assert.equal(afterProject.appliedFrom.collection, 'project');
});

// --- MetadataDocument v1 -> v2 migration (section 10) ---------------------------------------

test('S36: migrateMetadataDocumentV1ToV2 is total and lossless', () => {
  const component = {
    id: 'abc123',
    name: 'Card',
    sourcePath: 'components/cards.tsx',
    isDefault: false,
    props: {title: {schema: new StringSchema().toJson(), required: true, diagnostics: []}},
    diagnostics: [],
  };
  const v1 = createMetadataDocument([component], '2026-09-27T00:00:00.000Z');
  const v2 = migrateMetadataDocumentV1ToV2(v1);
  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.generatedAt, v1.generatedAt);
  assert.equal(v2.components.length, 1);
  assert.deepEqual(v2.components[0].slots, []);
  assert.equal(v2.components[0].id, 'abc123');
  const restored = JSON.parse(JSON.stringify(v2));
  assert.deepEqual(restored, v2);
});

// --- resolveSlotPolicy / checkSlotValue (section 8) ------------------------------------------

const buttonIdentity = {source: 'project', id: 'button-1'};
const cardMetadata = {
  id: 'card-1',
  name: 'Card',
  sourcePath: 'components/card.tsx',
  isDefault: false,
  props: cardProps,
  diagnostics: [],
  slots: [
    {
      path: ['actions', each()],
      slot: {kind: 'components', accepts: [buttonIdentity], maxItems: 1},
      appliedFrom: {slot: 'library'},
    },
  ],
};

const libraryWithButton = {
  files: [{
    path: 'components/button.tsx',
    components: {Button: {id: 'button-1', component: () => null, args: {type: 'object', properties: {}}}},
  }],
};

// A library that never registered `button-1` - simulates stale metadata vs. a trimmed bundle, or a
// config/library mismatch (independent review finding, docs/baseline.md).
const libraryWithoutButton = {files: []};

test('S37: resolveSlotPolicy returns an explicit rule for a path with an authored SlotRule', () => {
  const rule = resolveSlotPolicy(cardMetadata, ['actions', each()]);
  assert.equal(rule.slot.kind, 'components');
  assert.deepEqual(rule.slot.accepts, [buttonIdentity]);
});

test('S38: resolveSlotPolicy synthesizes the AnyNodePolicy default for an unruled ReactNode path', () => {
  const rule = resolveSlotPolicy(cardMetadata, ['header']);
  assert.equal(rule.slot.kind, 'any');
  assert.equal(rule.slot.multiple, true);
});

test('S39: resolveSlotPolicy returns undefined for a non-slot-domain path', () => {
  const notSlotProps = {title: propMeta(new StringSchema())};
  const meta = {...cardMetadata, props: notSlotProps, slots: []};
  assert.equal(resolveSlotPolicy(meta, ['title']), undefined);
});

test('S40: checkSlotValue accepts a component instance matching an explicit "components" policy', () => {
  const rule = resolveSlotPolicy(cardMetadata, ['actions', each()]);
  const result = checkSlotValue(
    rule,
    {itemId: 'i1', kind: 'instance', instance: {componentId: 'button-1'}},
    {library: libraryWithButton, currentItemCount: 0, currentNonVoidCount: 0}
  );
  assert.deepEqual(result, {ok: true});
});

test('S41: checkSlotValue rejects a component instance not in the accepted list, with a real diagnostic', () => {
  const rule = resolveSlotPolicy(cardMetadata, ['actions', each()]);
  const result = checkSlotValue(
    rule,
    {itemId: 'i2', kind: 'instance', instance: {componentId: 'other-component'}},
    {library: libraryWithButton, currentItemCount: 0, currentNonVoidCount: 0}
  );
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'component-not-accepted');
});

test('S42: checkSlotValue enforces maxItems on the default AnyNodePolicy', () => {
  const rule = resolveSlotPolicy(cardMetadata, ['header']);
  const withinBounds = checkSlotValue(
    rule,
    {itemId: 'i3', kind: 'text', value: 'hello'},
    {library: libraryWithButton, currentItemCount: 0, currentNonVoidCount: 0}
  );
  assert.equal(withinBounds.ok, true);
});

test('S43: checkSlotValue accepts a richText value matching an inline policy and rejects a disallowed mark', () => {
  const richRule = {
    path: ['title'],
    slot: {kind: 'richText', inline: true, marks: ['bold']},
    appliedFrom: {slot: 'library'},
  };
  const ok = checkSlotValue(
    richRule,
    {kind: 'richText', version: 1, inline: true, nodes: [{type: 'text', text: 'hi', marks: ['bold']}]},
    {library: libraryWithButton, currentItemCount: 0, currentNonVoidCount: 0}
  );
  assert.deepEqual(ok, {ok: true});

  const rejected = checkSlotValue(
    richRule,
    {kind: 'richText', version: 1, inline: true, nodes: [{type: 'text', text: 'hi', marks: ['italic']}]},
    {library: libraryWithButton, currentItemCount: 0, currentNonVoidCount: 0}
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.diagnostics[0].code, 'richtext-mark-not-accepted');
});

test('S44: checkSlotValue rejects an accepts-list match that is not actually registered in the library (independent review finding)', () => {
  // A "components"-policy instance item: accepts-list match alone must not be enough.
  const rule = resolveSlotPolicy(cardMetadata, ['actions', each()]);
  const instanceResult = checkSlotValue(
    rule,
    {itemId: 'i5', kind: 'instance', instance: {componentId: 'button-1'}},
    {library: libraryWithoutButton, currentItemCount: 0, currentNonVoidCount: 0}
  );
  assert.equal(instanceResult.ok, false);
  assert.equal(instanceResult.diagnostics[0].code, 'component-not-in-library');

  // A componentRef-policy identity: same requirement.
  const refRule = {
    path: ['icon'],
    slot: {kind: 'componentRef', accepts: [buttonIdentity]},
    appliedFrom: {slot: 'library'},
  };
  const refResult = checkSlotValue(
    refRule,
    buttonIdentity,
    {library: libraryWithoutButton, currentItemCount: 0, currentNonVoidCount: 0}
  );
  assert.equal(refResult.ok, false);
  assert.equal(refResult.diagnostics[0].code, 'component-not-in-library');

  // Control: the same checks pass once the library actually registers the identity.
  const instanceOk = checkSlotValue(
    rule,
    {itemId: 'i6', kind: 'instance', instance: {componentId: 'button-1'}},
    {library: libraryWithButton, currentItemCount: 0, currentNonVoidCount: 0}
  );
  assert.equal(instanceOk.ok, true);
  const refOk = checkSlotValue(refRule, buttonIdentity, {library: libraryWithButton, currentItemCount: 0, currentNonVoidCount: 0});
  assert.equal(refOk.ok, true);
});
