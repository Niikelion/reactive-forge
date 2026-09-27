import {fromValueJson, schemaFromJson, SchemaJson, toValueJson, ValueJson} from "@reactive-forge/schema"

/**
 * Validates `candidate` against `schema` by decoding it through the real
 * schema machinery (`schemaFromJson` + `fromValueJson`, never hand-rolled
 * checks - per the architecture doc's "editor hints must not change runtime
 * type semantics") and re-encodes the verified result back to `ValueJson`
 * via `toValueJson`. Every control's "commit" path goes through this, so a
 * value a control produces is always the schema's own normalized form, not
 * whatever the control's input widget happened to produce.
 *
 * Throws (with the schema/fromValueJson error message) if `candidate` is not
 * assignable to `schema` - callers should catch this and surface it as a
 * validation message rather than let it propagate as an unhandled render-time throw.
 */
export function commitValue(schema: SchemaJson, candidate: ValueJson): ValueJson {
    const parsedSchema = schemaFromJson(schema)
    const construct = fromValueJson(parsedSchema, candidate)
    return toValueJson(construct)
}
