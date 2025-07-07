import {FC, ReactNode, useMemo} from "react";
import {c} from "../../constructs";
import type {ObjectConstruct, ValueConstruct} from "../../constructs";
import {useEditorComponents} from "./EditorComponentsProvider";
import {
    arrayTypeAtIndex,
    ObjectTypeSchema,
    PickValueTypeSchema,
    UnionTypeSchema,
    ValueTypeSchema,
    verifyValue
} from "@reactive-forge/shared";
import {extractDiscriminatedUnion} from "../../discriminatedUnion";
import { extractPrimitiveUnion } from "../../primitiveUnion";

type ConstructEditor<T extends ValueTypeSchema["type"]> = FC<{ value: ValueConstruct, schema: PickValueTypeSchema<T>, onValueChanged(value: ValueConstruct): void }>

type SimpleType = "boolean" | "number" | "string"

const makeConstructEditor = <T extends SimpleType>(type: T, defaultValue: (ValueConstruct & { type: T })["value"], render: (value: (ValueConstruct & { type: T })["value"], onValueChanged: (value: ValueConstruct) => void, ui: ReturnType<typeof useEditorComponents>) => ReactNode): ConstructEditor<T> =>
    ({ value, schema, onValueChanged }) => {
        const EditorUI = useEditorComponents()
        if (schema.type !== type) return null

        return render((schema.value !== undefined ? schema.value : (value.type === type ? value.value : defaultValue)) as never, onValueChanged, EditorUI)
    }

const BooleanConstruct = makeConstructEditor("boolean", false, (value, onValueChanged, UI) =>
    <UI.BooleanInput value={value} onValueChanged={v => onValueChanged(c.boolean(v))} />
)
const NumberConstruct = makeConstructEditor("number", 0, (value, onValueChanged, UI) =>
    <UI.NumberInput value={value} onValueChanged={v => onValueChanged(c.number(v))} />
)
const StringConstruct = makeConstructEditor("string", "", (value, onValueChanged, UI) =>
    <UI.TextInput value={value} onValueChanged={v => onValueChanged(c.string(v))} />
)

const UnionConstruct: FC<{ value: ValueConstruct, schema: UnionTypeSchema, onValueChanged(v: ValueConstruct): void }> = ({ value, schema, onValueChanged }) => {
    const EditorUI = useEditorComponents()

    const providedValueIndex = Math.max(0, schema.types.findIndex(s => verifyValue(value, s)))

    return <EditorUI.List type="unordered">
        <EditorUI.ObjectPropertyInput name="variant" type="required">
            <EditorUI.DropdownInput
                value={providedValueIndex}
                onValueChanged={n => onValueChanged(c.constructFromSchema(schema.types[n]) ?? c.undefined()) }
                options={schema.types.map((_, i) => i.toString())}
            />
        </EditorUI.ObjectPropertyInput>
        <EditorUI.ObjectPropertyInput name="value" type="required">
            <Construct schema={schema.types[providedValueIndex]} value={value} onValueChanged={onValueChanged} />
        </EditorUI.ObjectPropertyInput>
    </EditorUI.List>
}

function createObjectUtils(value: ObjectConstruct, schema: ObjectTypeSchema, onValueChanged: (v: ValueConstruct) => void, blacklistProp?: string) {
    function addProp(name: string) {
        if (name === blacklistProp) {
            onValueChanged(value)
            return
        }
        const newValue = getNewValue(name)
        if (newValue === null) {
            onValueChanged(value)
            return
        }
        updateProp(name, newValue)
    }

    function schemaFromPropName(name: string)
    {
        return name in schema.properties ? schema.properties[name] : schema.index ?? null
    }

    function getNewValue(name: string) {
        try {
            const propSchema = schemaFromPropName(name)
            return propSchema === null ? null : c.constructFromSchema(propSchema)
        } catch {}
        return null
    }

    function deleteProp(name: string) {
        if (name === blacklistProp) {
            onValueChanged(value)
            return
        }

        const newValue = c.object({ ...value.value })
        delete newValue.value[name]
        onValueChanged(newValue)
    }

    function renameProp(oldName: string, newName: string) {
        if (oldName === blacklistProp || newName === blacklistProp) {
            onValueChanged(value)
            return
        }

        if (oldName in schema.properties || newName in schema.properties) {
            onValueChanged(value)
            return
        }

        if (isNaN(Number(oldName)) !== isNaN(Number(newName))) {
            onValueChanged(value)
            return
        }

        if (!(oldName in value.value)) {
            addProp(newName)
            return
        }

        if (oldName === newName) return

        const newValue = c.object({
            ...value.value,
            [newName]: value.value[oldName]
        })
        delete newValue.value[oldName]
        onValueChanged(newValue)
    }

    function updateProp(name: string, updatedValue: ValueConstruct)
    {
        if (name === blacklistProp) {
            onValueChanged(value)
            return
        }

        const newValue = c.object({
            ...value.value,
            [name]: updatedValue
        })
        onValueChanged(newValue)
    }

    return {
        addProp,
        deleteProp,
        renameProp,
        updateProp,
        schemaFromPropName
    }
}

const ObjectConstruct: FC<{ value: ValueConstruct, schema: ObjectTypeSchema, onValueChanged: (v: ValueConstruct) => void, blackListProp?: string, children?: ReactNode }> = ({ value, schema, onValueChanged, blackListProp, children }) => {
    const EditorUI = useEditorComponents()

    const correctedValue = value.type === "object" ? value : c.object({})

    const { addProp, deleteProp, renameProp, updateProp, schemaFromPropName } = createObjectUtils(correctedValue, schema, onValueChanged, blackListProp)

    type Prop = {
        name: string
        schema: ValueTypeSchema
        type: "required" | "optional" | "index"
        value?: ValueConstruct
    }

    const requiredProps = useMemo<Prop[]>(() =>
        Object.entries(schema.properties)
            .filter(([, propSchema]) => propSchema.required)
            .map(([name, schema]) => ({name, schema, type: "required"})),
        [schema])
    const requiredPropsSet = useMemo(() => new Set<string>(requiredProps.map(({name}) => name)), [requiredProps])

    const optionalProps: Prop[] = Object.entries(correctedValue.value)
        .filter(([name]) => !requiredPropsSet.has(name) && (schema.index !== undefined || name in schema.properties))
        .sort(([aN], [bN]) => aN < bN ? -1 : 1)
        .map(([name, value]) => ({ name, value, schema: schemaFromPropName(name)!, type: name in schema.properties ? "optional" : "index" }))

    function renderProp(prop: Prop)
    {
        const propValue: ValueConstruct = prop.value ?? correctedValue.value[prop.name] ?? c.undefined()
        return <EditorUI.ObjectPropertyInput
            key={`prop__${prop.name}`}
            name={prop.name}
            type={prop.type}
            onRename={newName => renameProp(prop.name, newName)}
            onDelete={() => deleteProp(prop.name)}
        >
            <Construct
                schema={prop.schema}
                value={propValue}
                onValueChanged={v => updateProp(prop.name, v)} />
        </EditorUI.ObjectPropertyInput>
    }

    return <EditorUI.List key={schema.type} type="unordered">
        {children}
        {requiredProps.map(renderProp)}
        {optionalProps.map(renderProp)}
        <EditorUI.ObjectNewPropertyInput
            onAdd={addProp}
            allowCustomNames={schema.index !== undefined}
            namesToSuggest={optionalProps.filter(p => p.type === "optional").map(p => p.name)}
        />
    </EditorUI.List>
}

export const Construct: FC<{ schema: ValueTypeSchema, value: ValueConstruct, onValueChanged: (value: ValueConstruct) => void }> = ({schema: rawSchema, value, onValueChanged}) => {
    const EditorUI = useEditorComponents()

    const schema = extractPrimitiveUnion(rawSchema) ?? extractDiscriminatedUnion(rawSchema) ?? rawSchema

    switch (schema.type) {
        case "null":
            return <EditorUI.NullInput key={schema.type}/>
        case "undefined":
            return <EditorUI.UndefinedInput key={schema.type}/>
        case "boolean":
            return <BooleanConstruct key={schema.type} value={value} schema={schema} onValueChanged={onValueChanged}/>
        case "number":
            return <NumberConstruct key={schema.type} value={value} schema={schema} onValueChanged={onValueChanged}/>
        case "string":
            return <StringConstruct key={schema.type} value={value} schema={schema} onValueChanged={onValueChanged}/>
        case "date":
            return <EditorUI.DateInput
                key={schema.type}
                value={value.type === "date" ? new Date(value.value) : new Date()}
                onValueChanged={v => onValueChanged(c.date(v))}
            />
        case "array": {
            const correctedValue = value.type === "array" && value.value.length >= schema.tupleTypes.length ? value.value : c.constructFromSchema(schema).value

            const insertAtIndex = (i: number) => {
                if (i < 0 || i > correctedValue.length) return
                if (i < schema.tupleTypes.length) return
                if (schema.elementType === undefined) return
                try {
                    const newValue = c.array(correctedValue.toSpliced(i, 0, c.constructFromSchema(schema.elementType)))
                    onValueChanged(newValue)
                } catch {}
            }
            const deleteAtIndex = (i: number) => {
                if (i < 0 || i >= correctedValue.length) return
                if (i < schema.tupleTypes.length) return
                const newValue = c.array(correctedValue.toSpliced(i, 1))
                onValueChanged(newValue)
            }
            const updateAtIndex = (i: number, v: ValueConstruct) => {
                if (i < 0 || i >= correctedValue.length) return
                const newValue = c.array(correctedValue.toSpliced(i, 1, v))
                onValueChanged(newValue)
            }

            return <EditorUI.List key={schema.type} type="ordered">
                {correctedValue.map((elementValue, i) =>
                    <EditorUI.ArrayItemInput
                        key={i}
                        required={i < schema.tupleTypes.length}
                        onInsertBefore={() => insertAtIndex(i)}
                        onDelete={() => deleteAtIndex(i)}
                    >
                        <Construct value={elementValue} schema={arrayTypeAtIndex(schema, i)} onValueChanged={
                            v => updateAtIndex(i, v)
                        }/>
                    </EditorUI.ArrayItemInput>
                )}
                <EditorUI.ArrayItemInput required={false} onInsertBefore={() => insertAtIndex(correctedValue.length)} onDelete={() => {
                }}/>
            </EditorUI.List>
        }
        case "element":
            return <EditorUI.TextInput
                key={schema.type}
                value={value.type === "string" ? value.value : ""}
                onValueChanged={v => onValueChanged(c.string(v))}
            />
        case "object":
            return <ObjectConstruct value={value} schema={schema} onValueChanged={onValueChanged}/>
        case "union":
            return <UnionConstruct key={`${schema.type}_switch`} value={value} schema={schema} onValueChanged={onValueChanged}/>
        case "primitiveUnion": {
            const values = schema.types.map(s => c.constructFromSchema(s))

            const currentIndex = values.findIndex(v => v.type === value.type && v.value === value.value)

            return <EditorUI.DropdownInput
                key={`${schema.type}_dropdown`}
                value={currentIndex >= 0 ? currentIndex : 0}
                onValueChanged={i => onValueChanged(values[i])}
                options={values.map(v => {
                    switch (v.type) {
                        case "boolean":
                        case "number":
                            return v.value.toString()
                        case "string":
                            return `"${v.value}"`
                    }
                    return v.type
                })}
            />
        }
        case "discriminatedUnion": {
            const correctedValue = value.type === "object" ? value : c.object({[schema.property]: schema.types[0].propertyValue})
            const currentValue = correctedValue.value[schema.property]

            const currentIndex = schema.types.findIndex(v => c.constructsEquals(v.propertyValue, currentValue))
            const currentVariant = schema.types[currentIndex >= 0 ? currentIndex : 0]

            return <EditorUI.List key={schema.type} type="unordered">
                <ObjectConstruct value={correctedValue} schema={currentVariant.schema} onValueChanged={v => {
                    const oldProps = v.type === "object" ? v.value : {}
                    const newValue = c.object({
                        ...oldProps,
                        [schema.property]: currentValue
                    })
                    onValueChanged(newValue)
                }}>
                    <EditorUI.ObjectPropertyInput name={schema.property} type="required">
                        <EditorUI.DropdownInput
                            value={currentIndex >= 0 ? currentIndex : 0}
                            onValueChanged={v => {
                                try {
                                    onValueChanged(c.constructFromSchema(schema.types[v].schema))
                                } catch {}
                            }}
                            options={schema.types.map(v => {
                                switch (v.propertyValue.type) {
                                    case "boolean":
                                    case "number":
                                        return v.propertyValue.value.toString()
                                    case "string":
                                        return `"${v.propertyValue.value}"`
                                }
                                return v.propertyValue.type
                            })}
                        />
                    </EditorUI.ObjectPropertyInput>
                </ObjectConstruct>
            </EditorUI.List>
        }
    }
}