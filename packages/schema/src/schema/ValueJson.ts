import {z, ZodType} from "zod";
import {mapValues} from "remeda";
import {ValueConstruct} from "@/schema/Construct";
import {Schema} from "@/schema/Schema";
import {c} from "@/schema/constructUtils";

// JSON-safe subset of `ValueConstruct` (see Construct.ts). Excludes "function" entirely — a
// FunctionConstruct carries a live `func` closure, which never belongs in portable metadata — and
// requires bigint to be carried as a decimal string tag, since real bigint is not valid JSON.
// Mirrors docs/metadata-contract.md's `ValueJson` shape exactly; keep both in sync if either
// changes.
export type ValueJson =
    | {type: "instance", adapterId: string, version: number, value: ValueJson}
    | { type: "void" | "null" | "undefined" }
    | { type: "boolean", value: boolean }
    | { type: "number", value: number }
    | { type: "bigint", value: string }
    | { type: "string", value: string }
    | { type: "date", value: string }
    | { type: "array", value: ValueJson[] }
    | { type: "object", value: Record<string, ValueJson> }
    | { type: "element", value: { path: string, name: string, args: Record<string, ValueJson> } }

// Same shape as ValueJson: the field that is safe to trust as "this is what the source actually
// declared" rather than a generated illustration (see PropMetadata.defaultValue in metadata.ts).
export type DefaultValueJson = ValueJson

export const ValueJson: ZodType<ValueJson> = z.lazy(() => z.union([
    z.object({type: z.literal("instance"), adapterId: z.string().min(1), version: z.number().int().positive(), value: ValueJson}),
    z.object({type: z.union([z.literal("void"), z.literal("null"), z.literal("undefined")])}),
    z.object({type: z.literal("boolean"), value: z.boolean()}),
    z.object({type: z.literal("number"), value: z.number()}),
    z.object({type: z.literal("bigint"), value: z.string()}),
    z.object({type: z.literal("string"), value: z.string()}),
    z.object({type: z.literal("date"), value: z.string()}),
    z.object({type: z.literal("array"), value: ValueJson.array()}),
    z.object({type: z.literal("object"), value: z.record(ValueJson)}),
    z.object({type: z.literal("element"), value: z.object({
        path: z.string(),
        name: z.string(),
        args: z.record(ValueJson)
    })}),
]))

// Thrown by toValueJson when it encounters a FunctionConstruct anywhere in the value being
// serialized (including nested inside an object/array/element). Functions never appear in
// ValueJson (see "Callbacks/functions" in docs/metadata-contract.md) — this is a deliberate,
// clearly-identifiable rejection rather than a silent drop or an opaque TypeError.
export class FunctionConstructNotSerializableError extends Error {
    constructor() {
        super("Cannot convert a FunctionConstruct to ValueJson: functions are never part of portable metadata (see docs/metadata-contract.md, \"Callbacks/functions\")")
        this.name = "FunctionConstructNotSerializableError"
    }
}

/**
 * Converts a live `ValueConstruct` into its JSON-safe `ValueJson` form.
 * Throws `FunctionConstructNotSerializableError` if `construct` is, or contains, a
 * `FunctionConstruct` (functions have no ValueJson representation).
 */
export function toValueJson(construct: ValueConstruct): ValueJson {
    switch (construct.type) {
        case "instance": return {...construct, value: toValueJson(construct.value)}
        case "void":
        case "null":
        case "undefined":
            return {type: construct.type}
        case "boolean":
            return {type: "boolean", value: construct.value}
        case "number":
            return {type: "number", value: construct.value}
        case "bigint":
            return {type: "bigint", value: construct.value.toString()}
        case "string":
            return {type: "string", value: construct.value}
        case "date":
            return {type: "date", value: construct.value}
        case "array":
            return {type: "array", value: construct.value.map(toValueJson)}
        case "object":
            return {type: "object", value: mapValues(construct.value, toValueJson)}
        case "element":
            return {
                type: "element",
                value: {
                    path: construct.value.path,
                    name: construct.value.name,
                    args: mapValues(construct.value.args, toValueJson)
                }
            }
        case "function":
            throw new FunctionConstructNotSerializableError()
    }
}

function valueConstructFromJson(json: ValueJson): ValueConstruct {
    switch (json.type) {
        case "instance": return {...json, value: valueConstructFromJson(json.value)}
        case "void": return c.void()
        case "null": return c.null()
        case "undefined": return c.undefined()
        case "boolean": return c.boolean(json.value)
        case "number": return c.number(json.value)
        case "bigint": return c.bigint(BigInt(json.value))
        case "string": return c.string(json.value)
        case "date": return {type: "date", value: json.value}
        case "array": return c.array(json.value.map(valueConstructFromJson))
        case "object": return c.object(mapValues(json.value, valueConstructFromJson))
        case "element": return c.element(json.value.path, json.value.name, mapValues(json.value.args, valueConstructFromJson))
    }
}

/**
 * Converts a `ValueJson` back into a live `ValueConstruct`, then verifies the result against
 * `schema` (via `schema.verifyConstructType`). Throws if `json`'s shape doesn't parse as a
 * `ValueJson` variant, or if the resulting construct does not satisfy `schema`.
 */
export function fromValueJson(schema: Schema, json: ValueJson): ValueConstruct {
    const construct = valueConstructFromJson(json)
    if (!schema.verifyConstructType(construct))
        throw new Error(`Value of type "${json.type}" does not match schema "${schema.name}"`)
    return construct
}

/**
 * Derives an always-available, synthetic illustrative value for `schema` from its existing
 * `exampleConstruct`, run through `toValueJson`. Returns `undefined` when the schema's example
 * construct is, or transitively contains, a function (functions have no ValueJson
 * representation) — callers should treat that as "no example value available" rather than as an
 * error, matching PropMetadata.exampleValue's optionality.
 */
export function exampleValue(schema: Schema): ValueJson | undefined {
    try {
        if (schema.name === "instance" && !schema.verifyConstructType(schema.exampleConstruct)) return undefined
        return toValueJson(schema.exampleConstruct)
    } catch (e) {
        if (e instanceof FunctionConstructNotSerializableError) return undefined
        throw e
    }
}

/**
 * Validates and normalizes a literal-only `ValueJson` (as extracted from a source AST default
 * expression by the codegen/extraction side) against `schema`, producing the final
 * `DefaultValueJson`. Throws if the value does not satisfy `schema`. This does not parse AST
 * literals itself — extraction is responsible for turning a source expression into `ValueJson`
 * before calling this.
 */
export function toDefaultValueJson(schema: Schema, json: ValueJson): DefaultValueJson {
    const construct = fromValueJson(schema, json)
    return toValueJson(construct)
}
