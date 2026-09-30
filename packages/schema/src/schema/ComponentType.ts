import {Schema, SchemaJson} from "@/schema/Schema";
import {ValueConstruct} from "@/schema/Construct";
import {c} from "@/schema/constructUtils";
import {AsJson, makeSchema, parseJson, schemaFromJson, selfRule} from "@/schema/utils";
import {equals} from "@/schema/equality";
import {intersect} from "@/schema/intersection";

// New schema class, docs/slot-contract.md section 2 ("React.ComponentType<Props> paths"). A prop
// typed `React.ComponentType<SomeProps>` is a constructor reference, not ReactNode-domain, so it
// is not representable by ReactNodeSchema/FunctionSchema — a component constructor is never
// "called" by the prop's consumer the way an event handler is. `props` carries the expected props
// shape (as a live Schema, mirroring how FunctionSchema.returnType/paramsType are live Schema
// instances internally even though the contract describes the wire shape as a nested SchemaJson —
// `toJson()` is where that nesting actually surfaces).
//
// There is no ValueConstruct variant for "a component constructor reference" today (Construct.ts
// is shared, frozen infrastructure this task does not extend) — a componentType-typed prop's
// actual value is carried through CompositionPropValue's `"componentRef"` kind (slot-contract
// section 7) as a ComponentIdentity, entirely bypassing ValueJson/ValueConstruct. verifyConstructType
// therefore always returns false here (no ordinary ValueConstruct ever legitimately satisfies a
// componentType schema) and exampleConstruct is c.null(), mirroring ReactNodeSchema's own
// placeholder-illustration choice for a domain ValueConstruct can't really represent.
export class ComponentTypeSchema implements Schema {
    readonly name = "componentType"
    readonly props: Schema
    readonly exampleConstruct: ValueConstruct = c.null()

    constructor(props: Schema) {
        this.props = props
    }

    toJson(): AsJson<typeof ComponentTypeSchema> {
        return {type: "componentType", props: this.props.toJson()}
    }

    verifyConstructType(): boolean {
        return false
    }

    withTransformedChildren(transformer: (node: Schema) => Schema): ComponentTypeSchema {
        return new ComponentTypeSchema(transformer(this.props))
    }

    static readonly jsonSchema = makeSchema("componentType", {props: SchemaJson})
    static readonly fromJson = (json: SchemaJson): ComponentTypeSchema => {
        const parsed = parseJson(json, ComponentTypeSchema.jsonSchema)
        return new ComponentTypeSchema(schemaFromJson(parsed.props))
    }
    static readonly intersectionRules = [
        selfRule(ComponentTypeSchema, "componentType", (a, b) => new ComponentTypeSchema(intersect(a.props, b.props)))
    ]
    static readonly equalityRules = [
        selfRule(ComponentTypeSchema, "componentType", (a, b) => equals(a.props, b.props))
    ]
}
