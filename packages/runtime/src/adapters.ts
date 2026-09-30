import {ArraySchema, classTypeEquals, fromValueJson, InstanceSchema, ObjectSchema, Schema, UnionSchema, ValueAdapter, ValueAdapterRegistry, ValueJson} from "@reactive-forge/schema"

export function urlFromData(data: unknown): URL {
    if (typeof data !== "string") throw new Error("URL payload must be an absolute URL string")
    return new URL(data)
}
export const urlAdapter: ValueAdapter = {
    id: "builtin/URL", version: 1, typeRef: {kind: "builtin", name: "URL"},
    fromData: urlFromData,
    validateData: data => { urlFromData(data) },
    toData: value => { if (!(value instanceof URL)) throw new Error("Expected URL"); return value.href },
    export: {module: "@reactive-forge/runtime", exportName: "urlFromData"}
}
function mapData(data: unknown): asserts data is [unknown, unknown][] {
    if (!Array.isArray(data) || !data.every(entry => Array.isArray(entry) && entry.length === 2)) throw new Error("Map payload must be an array of key/value pairs")
}
function setData(data: unknown): asserts data is unknown[] {
    if (!Array.isArray(data)) throw new Error("Set payload must be an array")
}
export function mapFromData(data: unknown): Map<unknown, unknown> { mapData(data); return new Map(data) }
export function setFromData(data: unknown): Set<unknown> { setData(data); return new Set(data) }
function regexpData(data: unknown): asserts data is {source: string, flags: string, lastIndex: number} {
    if (data === null || typeof data !== "object" || !("source" in data) || typeof data.source !== "string" ||
        !("flags" in data) || typeof data.flags !== "string" || !("lastIndex" in data) || typeof data.lastIndex !== "number" ||
        !Number.isSafeInteger(data.lastIndex) || data.lastIndex < 0) throw new Error("RegExp payload requires source, flags and a nonnegative safe integer lastIndex")
    new RegExp(data.source, data.flags)
}
export function regexpFromData(data: unknown): RegExp {
    regexpData(data)
    const expression = new RegExp(data.source, data.flags)
    expression.lastIndex = data.lastIndex
    return expression
}
export const mapAdapter: ValueAdapter = {
    id: "builtin/Map", version: 1, typeRef: {kind: "builtin", name: "Map"},
    fromData: mapFromData, validateData: mapData,
    toData: value => { if (!(value instanceof Map)) throw new Error("Expected Map"); return [...value.entries()] },
    export: {module: "@reactive-forge/runtime", exportName: "mapFromData"}
}
export const setAdapter: ValueAdapter = {
    id: "builtin/Set", version: 1, typeRef: {kind: "builtin", name: "Set"},
    fromData: setFromData, validateData: setData,
    toData: value => { if (!(value instanceof Set)) throw new Error("Expected Set"); return [...value as Set<unknown>] },
    export: {module: "@reactive-forge/runtime", exportName: "setFromData"}
}
export const regexpAdapter: ValueAdapter = {
    id: "builtin/RegExp", version: 1, typeRef: {kind: "builtin", name: "RegExp"},
    fromData: regexpFromData, validateData: regexpData,
    toData: value => { if (!(value instanceof RegExp)) throw new Error("Expected RegExp"); return {source: value.source, flags: value.flags, lastIndex: value.lastIndex} },
    export: {module: "@reactive-forge/runtime", exportName: "regexpFromData"}
}
const builtinAdapters: ValueAdapterRegistry = Object.fromEntries([urlAdapter, mapAdapter, setAdapter, regexpAdapter].map(adapter => [adapter.id, adapter]))
export function findValueAdapter(id: string, version: number, adapters: ValueAdapterRegistry = {}): ValueAdapter {
    const adapter = Object.hasOwn(adapters, id) ? adapters[id] : Object.hasOwn(builtinAdapters, id) ? builtinAdapters[id] : undefined
    if (!adapter || adapter.id !== id) throw new Error(`Missing value adapter: ${id}`)
    if (adapter.version !== version) throw new Error(`Unsupported version ${String(version)} of value adapter ${id}`)
    return adapter
}

/** Converts validated payload data; false never constructs user instances. */
export function decodeAdapterValue(value: ValueJson, adapters: ValueAdapterRegistry = {}, construct = true): unknown {
    switch (value.type) {
        case "instance": {
            const adapter = findValueAdapter(value.adapterId, value.version, adapters)
            const data = decodeAdapterValue(value.value, adapters, construct)
            return construct ? adapter.fromData(data) : data
        }
        case "object": return Object.fromEntries(Object.entries(value.value).map(([k, v]) => [k, decodeAdapterValue(v, adapters, construct)]))
        case "array": return value.value.map(v => decodeAdapterValue(v, adapters, construct))
        case "date": return new Date(value.value)
        case "bigint": return BigInt(value.value)
        case "null": return null
        case "void": case "undefined": return undefined
        case "element": throw new Error("Class payloads cannot contain React elements")
        default: return value.value
    }
}

export function validateAdapterValue(schema: Schema, value: ValueJson, adapters: ValueAdapterRegistry = {}): void {
    fromValueJson(schema, value)
    if (schema instanceof UnionSchema) {
        const member = schema.types.find(s => { try { fromValueJson(s, value); return true } catch { return false } })
        if (member) validateAdapterValue(member, value, adapters)
    } else if (schema instanceof InstanceSchema && value.type === "instance") {
        const adapter = findValueAdapter(value.adapterId, value.version, adapters)
        if (!classTypeEquals(adapter.typeRef, schema.typeRef)) throw new Error(`Value adapter ${adapter.id} targets a different class`)
        if (!schema.payloadSchema) throw new Error("Missing instance payload schema")
        validateAdapterValue(schema.payloadSchema, value.value, adapters)
        adapter.validateData?.(decodeAdapterValue(value.value, adapters, false))
    } else if (schema instanceof ObjectSchema && value.type === "object") {
        for (const [key, child] of Object.entries(value.value)) {
            const childSchema = schema.properties[key]?.schema ?? schema.indexType
            if (childSchema) validateAdapterValue(childSchema, child, adapters)
        }
    } else if (schema instanceof ArraySchema && value.type === "array") {
        value.value.forEach((child, index) => { validateAdapterValue(schema.typeAtIndex(index), child, adapters) })
    } else visitInstanceValues(value, () => { throw new Error("Class values require an explicit instance schema") })
}

/** Serialize an existing instance only through its registered adapter. Cycles are rejected. */
export function encodeAdapterValue(schema: Schema, value: unknown, adapters: ValueAdapterRegistry = {}): ValueJson {
    const active = new Set<object>()
    function encode(expected: Schema, data: unknown): ValueJson {
        if (expected instanceof UnionSchema) {
            for (const member of expected.types) {
                try { const candidate = encode(member, data); validateAdapterValue(member, candidate, adapters); return candidate } catch { /* try next member */ }
            }
            throw new Error("Value matches no serializable union member")
        }
        if (typeof data === "object" && data !== null) {
            if (active.has(data)) throw new Error("Cyclic class values cannot be serialized")
            active.add(data)
        }
        try {
            let result: ValueJson
            if (expected instanceof InstanceSchema) {
                if (!expected.adapter || !expected.payloadSchema) throw new Error("Class has no adapter binding")
                const adapter = findValueAdapter(expected.adapter.id, expected.adapter.version, adapters)
                if (!adapter.toData) throw new Error(`Value adapter ${adapter.id} cannot serialize existing instances`)
                result = {type: "instance", adapterId: adapter.id, version: adapter.version, value: encode(expected.payloadSchema, adapter.toData(data))}
            } else if (expected instanceof ArraySchema && Array.isArray(data)) {
                result = {type: "array", value: data.map((item, index) => encode(expected.typeAtIndex(index), item))}
            } else if (expected instanceof ObjectSchema && data !== null && typeof data === "object") {
                const fields: Record<string, ValueJson> = {}
                for (const [key, child] of Object.entries(data)) {
                    const field = expected.properties[key]?.schema ?? expected.indexType
                    if (!field) throw new Error(`Unknown payload field: ${key}`)
                    Object.defineProperty(fields, key, {value: encode(field, child), enumerable: true, configurable: true, writable: true})
                }
                result = {type: "object", value: fields}
            } else if (data instanceof Date) result = {type: "date", value: data.toISOString()}
            else if (data === null) result = {type: "null"}
            else if (data === undefined) result = {type: "undefined"}
            else if (typeof data === "bigint") result = {type: "bigint", value: String(data)}
            else if (typeof data === "string") result = {type: "string", value: data}
            else if (typeof data === "boolean") result = {type: "boolean", value: data}
            else if (typeof data === "number") result = {type: "number", value: data}
            else throw new Error("Unsupported adapter payload value")
            validateAdapterValue(expected, result, adapters)
            return result
        } finally { if (typeof data === "object" && data !== null) active.delete(data) }
    }
    return encode(schema, value)
}

export function visitInstanceValues(value: unknown, visit: (instance: Extract<ValueJson, {type: "instance"}>) => void): void {
    if (value === null || typeof value !== "object") return
    if ("type" in value && value.type === "instance" && "adapterId" in value) visit(value as Extract<ValueJson, {type: "instance"}>)
    for (const child of Object.values(value)) visitInstanceValues(child, visit)
}
