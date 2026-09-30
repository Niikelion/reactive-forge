import {z} from "zod"
import {Schema, SchemaJson} from "@/schema/Schema"
import {ValueConstruct} from "@/schema/Construct"
import {makeSchema, parseJson, schemaFromJson, selfRule} from "@/schema/utils"
import {NeverSchema} from "@/schema/Never"

const typeRefSchema = z.union([
    z.object({kind: z.literal("builtin"), name: z.string()}),
    z.object({kind: z.literal("project"), sourcePath: z.string(), exportName: z.string()}),
    z.object({kind: z.literal("external"), package: z.string(), subpath: z.string().optional(), exportName: z.string()})
])
export type ClassTypeRef = z.infer<typeof typeRefSchema>
export function classTypeEquals(a: ClassTypeRef, b: ClassTypeRef): boolean {
    return a.kind === b.kind && (a.kind === "builtin" && b.kind === "builtin" ? a.name === b.name :
        a.kind === "project" && b.kind === "project" ? a.sourcePath === b.sourcePath && a.exportName === b.exportName :
        a.kind === "external" && b.kind === "external" && a.package === b.package && a.subpath === b.subpath && a.exportName === b.exportName)
}
export interface ValueAdapter {
    id: string
    version: number
    typeRef: ClassTypeRef
    fromData: (data: unknown) => unknown
    toData?: (instance: unknown) => unknown
    validateData?: (data: unknown) => void
    export?: {module: string, exportName: string, isDefault?: boolean}
}
export type ValueAdapterRegistry = Readonly<Record<string, ValueAdapter>>

export class InstanceSchema implements Schema {
    readonly name = "instance"
    readonly exampleConstruct: ValueConstruct
    constructor(readonly typeRef: ClassTypeRef, readonly typeArguments: Schema[] = [],
        readonly adapter?: {id: string, version: number}, readonly payloadSchema?: Schema) {
        this.exampleConstruct = adapter && payloadSchema ? {type: "instance", adapterId: adapter.id, version: adapter.version, value: payloadSchema.exampleConstruct} : {type: "undefined", value: undefined}
    }
    toJson(): SchemaJson {
        const typeRef = this.typeRef.kind === "external" ? {kind: this.typeRef.kind, package: this.typeRef.package,
            exportName: this.typeRef.exportName, ...(this.typeRef.subpath !== undefined ? {subpath: this.typeRef.subpath} : {})} : this.typeRef
        return {type: "instance", typeRef, typeArguments: this.typeArguments.map(s => s.toJson()),
            ...(this.adapter ? {adapter: this.adapter} : {}), ...(this.payloadSchema ? {payloadSchema: this.payloadSchema.toJson()} : {})}
    }
    verifyConstructType(value: ValueConstruct): boolean {
        return value.type === "instance" && this.adapter !== undefined && this.payloadSchema !== undefined &&
            value.adapterId === this.adapter.id && value.version === this.adapter.version && this.payloadSchema.verifyConstructType(value.value)
    }
    withTransformedChildren(transform: (schema: Schema) => Schema): InstanceSchema {
        return new InstanceSchema(this.typeRef, this.typeArguments.map(transform), this.adapter, this.payloadSchema && transform(this.payloadSchema))
    }
    static readonly jsonSchema = makeSchema("instance", {typeRef: typeRefSchema, typeArguments: SchemaJson.array().default([]),
        adapter: z.object({id: z.string().min(1), version: z.number().int().positive()}).optional(), payloadSchema: SchemaJson.optional()})
    static readonly fromJson = (json: SchemaJson): InstanceSchema => {
        const p = parseJson(json, InstanceSchema.jsonSchema)
        return new InstanceSchema(p.typeRef, (p.typeArguments ?? []).map(schemaFromJson), p.adapter, p.payloadSchema && schemaFromJson(p.payloadSchema))
    }
    static readonly equalityRules = [selfRule(InstanceSchema, "instance", (a, b) => JSON.stringify(a.toJson()) === JSON.stringify(b.toJson()))]
    static readonly intersectionRules = [selfRule(InstanceSchema, "instance", (a, b) => JSON.stringify(a.toJson()) === JSON.stringify(b.toJson()) ? a : NeverSchema.instance)]
}
