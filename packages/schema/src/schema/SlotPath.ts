import {mapValues} from "remeda";
import {Schema} from "@/schema/Schema";
import {ObjectSchema} from "@/schema/Object";
import {ArraySchema} from "@/schema/Array";
import {UnionSchema} from "@/schema/Union";
import {NullSchema} from "@/schema/Null";
import {UndefinedSchema} from "@/schema/Undefined";
import {StringSchema} from "@/schema/String";
import {NumberSchema} from "@/schema/Number";
import {BooleanSchema} from "@/schema/Boolean";
import {equals} from "@/schema/equality";
import {schemaFromJson} from "@/schema/utils";
import {Diagnostic, PropMetadata} from "@/schema/metadata";
import {ReactNodeSchema} from "@/schema/ReactNode";
import {ComponentTypeSchema} from "@/schema/ComponentType";

// Path addressing, docs/slot-contract.md section 2.

export type VariantLiteral = string | number | boolean

export type PathSegment =
    | string
    | { kind: "each" }
    | { kind: "variant", prop: string, equals: VariantLiteral }

export type SlotPath = PathSegment[]

/** Authoring helper — constructs the literal `{kind: "each"}` marker. Never spelled as the string "*". */
export function each(): PathSegment {
    return {kind: "each"}
}

/** Authoring helper — constructs the literal `{kind: "variant", prop, equals}` marker. */
export function variant(prop: string, value: VariantLiteral): PathSegment {
    return {kind: "variant", prop, equals: value}
}

/** Structural equality of two path segments, including `variant.equals` — section 4's "canonical path" notion. */
export function pathSegmentEquals(a: PathSegment, b: PathSegment): boolean {
    if (typeof a === "string" || typeof b === "string") return a === b
    if (a.kind === "each") return b.kind === "each"
    return b.kind === "variant" && a.prop === b.prop && a.equals === b.equals
}

/** Structural equality of two full paths (section 4: "two rules target the same path iff every segment matches"). */
export function pathEquals(a: SlotPath, b: SlotPath): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        const left = a[i]
        const right = b[i]
        if (left === undefined || right === undefined || !pathSegmentEquals(left, right)) return false
    }
    return true
}

function isDiagnostic(value: Schema | Diagnostic): value is Diagnostic {
    return "severity" in value
}

function errorDiagnostic(code: string, message: string): Diagnostic {
    return {severity: "error", code, message}
}

/** Drops `null`/`undefined` union members before resolving a segment against `schema` (section 2). */
export function stripNullish(schema: Schema): Schema {
    if (!(schema instanceof UnionSchema)) return schema
    const remaining = schema.types.filter(t => !(t instanceof NullSchema) && !(t instanceof UndefinedSchema))
    if (remaining.length === 0) return schema
    if (remaining.length === 1) {
        const only = remaining[0]
        return only ?? schema
    }
    return new UnionSchema(remaining)
}

function literalOf(schema: Schema): VariantLiteral | undefined {
    if (schema instanceof StringSchema) return schema.literal
    if (schema instanceof NumberSchema) return schema.literal
    if (schema instanceof BooleanSchema) return schema.literal
    return undefined
}

function resolveStringSegment(schema: Schema, name: string): Schema | Diagnostic {
    const stripped = stripNullish(schema)

    if (stripped instanceof ObjectSchema) {
        const prop = Object.hasOwn(stripped.properties, name) ? stripped.properties[name] : undefined
        if (prop) return prop.schema
        // A record type: any key takes the index type.
        if (stripped.indexType && !["__proto__", "constructor", "prototype"].includes(name)) return stripped.indexType
        return errorDiagnostic("unknown-path-segment", `Unknown property "${name}" on object schema`)
    }

    if (stripped instanceof UnionSchema) {
        const resolved = stripped.types.map(member =>
            member instanceof ObjectSchema ? member.properties[name]?.schema : undefined)

        if (resolved.some(r => r === undefined))
            return errorDiagnostic("unknown-path-segment", `Property "${name}" is not present on every union member`)

        const first = resolved[0]
        if (first === undefined)
            return errorDiagnostic("unknown-path-segment", `Property "${name}" is not present on every union member`)

        const allEqual = resolved.every(r => r !== undefined && r.name === first.name && equals(r, first))
        if (!allEqual)
            return errorDiagnostic("ambiguous-union-path", `Property "${name}" resolves to different shapes across union members; a preceding variant() selector is required`)

        return first
    }

    return errorDiagnostic("unknown-path-segment", `Cannot look up property "${name}" on a non-object schema "${stripped.name}"`)
}

function resolveEachSegment(schema: Schema): Schema | Diagnostic {
    const stripped = stripNullish(schema)

    if (!(stripped instanceof ArraySchema))
        return errorDiagnostic("each-on-non-array", `each() used on a non-array schema "${stripped.name}"`)

    const element = stripped.indexType ?? (stripped.tupleTypes.length === 1 ? stripped.tupleTypes[0] : undefined)
    if (!element)
        return errorDiagnostic("each-on-non-array", "each() requires a declared array with a single element type")

    return element
}

function resolveVariantSegment(schema: Schema, prop: string, value: VariantLiteral): Schema | Diagnostic {
    const stripped = stripNullish(schema)

    if (!(stripped instanceof UnionSchema))
        return errorDiagnostic("unknown-variant", `variant() used on a non-union schema "${stripped.name}"`)

    const matches = stripped.types.filter(member => {
        if (!(member instanceof ObjectSchema)) return false
        const discriminant = member.properties[prop]?.schema
        if (!discriminant) return false
        return literalOf(discriminant) === value
    })

    if (matches.length === 0)
        return errorDiagnostic("unknown-variant", `No union member has "${prop}" matching ${JSON.stringify(value)}`)
    if (matches.length > 1)
        return errorDiagnostic("ambiguous-variant", `More than one union member has "${prop}" matching ${JSON.stringify(value)}`)

    const only = matches[0]
    return only ?? errorDiagnostic("unknown-variant", `No union member has "${prop}" matching ${JSON.stringify(value)}`)
}

/** `resolveSegment(schema, segment)` from section 2's resolution algorithm, exactly. */
export function resolveSegment(schema: Schema, segment: PathSegment): Schema | Diagnostic {
    if (typeof segment === "string") return resolveStringSegment(schema, segment)
    if (segment.kind === "each") return resolveEachSegment(schema)
    return resolveVariantSegment(schema, segment.prop, segment.equals)
}

/**
 * The synthetic root `ObjectSchema` a path resolves against — its properties are exactly
 * `ComponentMetadata.props` (section 2: "the root is a synthetic ObjectSchema whose properties
 * are exactly ComponentMetadata.props").
 */
export function buildRootSchema(props: Record<string, PropMetadata>): ObjectSchema {
    return new ObjectSchema(mapValues(props, p => ({schema: schemaFromJson(p.schema), required: p.required})))
}

/**
 * Folds `resolveSegment` across every segment of `path`, starting from the component's root
 * `ObjectSchema` (built from `props` via `buildRootSchema`). Returns the path's target schema, or
 * the first `Diagnostic` encountered.
 */
export function resolvePath(props: Record<string, PropMetadata>, path: SlotPath): Schema | Diagnostic {
    let schema: Schema = buildRootSchema(props)

    for (const segment of path) {
        const result = resolveSegment(schema, segment)
        if (isDiagnostic(result)) return result
        schema = result
    }

    return schema
}

export {isDiagnostic as isPathResolutionDiagnostic}

/**
 * `docs/slot-contract-recursive.md` section 1.6: a pure, recursive, document-independent property
 * of a `Schema` alone — `false` for `ReactNodeSchema`/`ComponentTypeSchema` (the only two
 * slot-domain leaf schema kinds), `true` for every primitive schema, and for `ObjectSchema`/
 * `ArraySchema`/`UnionSchema` iff every reachable member/property/index/tuple type is itself
 * `isSlotFree`. This is the sole, minor, explicitly-scoped exception to section 6's "packages/schema
 * needs zero changes" — section 1.6 calls it out by name as belonging here, alongside
 * `stripNullish`/`resolveSegment`, despite that general summary. Used by editor-authoring
 * convention (deciding when a document subtree may safely collapse to a single `"leaf"`
 * `CompositionValue` rather than be recursively decomposed) — not called anywhere in this
 * function's own module, and not a correctness precondition for validation (section 2's traversal
 * drives entirely off `CompositionValue.kind`, never off this helper).
 */
export function isSlotFree(schema: Schema): boolean {
    if (schema instanceof ReactNodeSchema || schema instanceof ComponentTypeSchema) return false
    if (schema instanceof UnionSchema) return schema.types.every(isSlotFree)
    if (schema instanceof ObjectSchema) {
        return Object.values(schema.properties).every(p => isSlotFree(p.schema))
            && (schema.indexType === undefined || isSlotFree(schema.indexType))
    }
    if (schema instanceof ArraySchema) {
        return schema.tupleTypes.every(isSlotFree)
            && (schema.indexType === undefined || isSlotFree(schema.indexType))
    }
    return true
}
