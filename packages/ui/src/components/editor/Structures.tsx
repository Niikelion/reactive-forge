import {FC, ReactNode} from "react";
import {c, ValueConstruct} from "../../constructs";
import {useEditorComponents} from "./EditorComponentsProvider";
import {
    isConstantValueSchema,
    PickValueTypeSchema,
    UnionTypeSchema,
    ValueTypeSchema,
    verifyValue
} from "@reactive-forge/shared";

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

export const UnionConstruct: FC<{ value: ValueConstruct, schema: UnionTypeSchema, onValueChanged(v: ValueConstruct): void }> = ({ value, schema, onValueChanged }) => {
    const EditorUI = useEditorComponents()

    const providedValueIndex = Math.max(0, schema.types.findIndex(s => verifyValue(value, s)))

    return <EditorUI.List type="unordered">
        <EditorUI.ObjectPropertyInput name="variant" required onEnable={() => {}} onDisable={() => {}}>
            <EditorUI.DropdownInput
                value={providedValueIndex}
                onValueChanged={n => onValueChanged(c.constructFromSchema(schema.types[n]) ?? c.undefined()) }
                options={schema.types.map((_, i) => i.toString())}
            />
        </EditorUI.ObjectPropertyInput>
        <EditorUI.ObjectPropertyInput name="value" required onEnable={() => {}} onDisable={() => {}}>
            <Construct schema={schema.types[providedValueIndex]} value={value} onValueChanged={onValueChanged} />
        </EditorUI.ObjectPropertyInput>
    </EditorUI.List>
}

export const Construct: FC<{ schema: ValueTypeSchema, value: ValueConstruct, onValueChanged: (value: ValueConstruct) => void }> = ({schema, value, onValueChanged}) => {
    const EditorUI = useEditorComponents()

    switch (schema.type) {
        case "null": return <EditorUI.NullInput key={schema.type} />
        case "undefined": return <EditorUI.UndefinedInput key={schema.type} />
        case "boolean": return <BooleanConstruct key={schema.type} value={value} schema={schema} onValueChanged={onValueChanged} />
        case "number": return <NumberConstruct key={schema.type} value={value} schema={schema} onValueChanged={onValueChanged} />
        case "string": return <StringConstruct key={schema.type} value={value} schema={schema} onValueChanged={onValueChanged} />
        case "date": return <EditorUI.DateInput key={schema.type} value={value.type === "date" ? new Date(value.value) : new Date()} onValueChanged={v => onValueChanged(c.date(v))} />
        case "array": {
            const correctedValue = value.type === "array" ? value.value : []

            const insertAtIndex = (i: number) => {
                if (i < 0 || i > correctedValue.length) return

                const newValue = c.array(correctedValue.toSpliced(i, 0, c.constructFromSchema(schema.elementType, true) ?? c.undefined()))
                onValueChanged(newValue)
            }
            const deleteAtIndex = (i: number) => {
                if (i < 0 || i >= correctedValue.length) return
                const newValue = c.array(correctedValue.toSpliced(i, 1))
                onValueChanged(newValue)
            }

            return <EditorUI.List key={schema.type} type="ordered">
                {correctedValue.map((elementValue, i) =>
                    <EditorUI.ArrayItemInput key={i} onInsertBefore={() => insertAtIndex(i)} onDelete={() => deleteAtIndex(i)}>
                        <Construct value={elementValue} schema={schema.elementType} onValueChanged={
                            v => {
                                const newValue = c.array([...correctedValue])
                                newValue.value[i] = v
                                onValueChanged(newValue)
                            }
                        } />
                    </EditorUI.ArrayItemInput>
                )}
                <EditorUI.ArrayItemInput onInsertBefore={() => insertAtIndex(correctedValue.length)} onDelete={() => {}} />
            </EditorUI.List>
        }
        case "element": return <EditorUI.TextInput key={schema.type} value={value.type === "string" ? value.value : ""} onValueChanged={v => onValueChanged(c.string(v))} />
        case "object": {
            const correctedValue = value.type === "object" ? value.value : {}

            const objectProps = [...Object.entries(schema.properties)]
                .sort(([aN, aS], [bN, bS]) => {
                if (aS.required !== bS.required)
                    return aS.required ? -1 : 1

                return aN < bN ? -1 : 1
            })

            const indexProps = [...(schema.index === undefined ? [] : Object.entries(correctedValue))]
                .filter(([n]) => !(n in schema.properties))
                .sort(([a], [b]) => a < b ? -1 : 1)

            const objectSchema = schema

            function addProp(name: string) {
                const newValue = getNewValue(name)
                if (newValue === null) return
                updateProp(name, newValue)
            }

            function getNewValue(name: string) {
                if (name in objectSchema.properties)
                    return c.constructFromSchema(objectSchema.properties[name])
                if (objectSchema.index !== undefined)
                    return c.constructFromSchema(objectSchema.index.value)
                return null
            }

            function deleteProp(name: string) {
                const newValue = c.object({ ...correctedValue })
                delete newValue.value[name]
                onValueChanged(newValue)
            }

            function renameProp(oldName: string, newName: string) {
                if (oldName in objectSchema.properties || newName in objectSchema.properties)
                    return
                if (!(oldName in correctedValue)) {
                    addProp(newName)
                    return
                }

                if (oldName === newName) return

                const newValue = c.object({
                    ...correctedValue,
                    [newName]: correctedValue[oldName]
                })
                delete newValue.value[oldName]
                onValueChanged(newValue)
            }

            function updateProp(name: string, value: ValueConstruct)
            {
                const newValue = c.object({
                    ...correctedValue,
                    [name]: value
                })
                onValueChanged(newValue)
            }

            return <EditorUI.List key={schema.type} type="unordered">
                {objectProps.map(([propName, propSchema]) =>
                    {
                        const propValue: ValueConstruct | undefined = correctedValue[propName]
                        return <EditorUI.ObjectPropertyInput
                            key={`prop__${propName}`}
                            name={propName} required={propSchema.required}
                            onEnable={() => addProp(propName)}
                            onDisable={() => deleteProp(propName)}
                        >
                            {propValue !== undefined && <Construct
                                schema={propSchema}
                                value={propValue}
                                onValueChanged={v => updateProp(propName, v)}
                            />}
                        </EditorUI.ObjectPropertyInput>;
                    }
                )}
                {objectSchema.index !== undefined && indexProps.map(([propName, propValue]) =>
                    <EditorUI.ObjectIndexInput
                        name={propName}
                        key={`index__${propName}`}
                        onRename={newName => renameProp(propName, newName)}
                        onDelete={() => deleteProp(propName)}
                    >
                        <Construct
                            schema={objectSchema.index!.value}
                            value={propValue}
                            onValueChanged={v => updateProp(propName, v)}
                        />
                    </EditorUI.ObjectIndexInput>
                )}
            </EditorUI.List>
        }
        case "union":  {
            if (!schema.types.every(isConstantValueSchema))
                return <UnionConstruct key={schema.type} value={value} schema={schema} onValueChanged={onValueChanged} />

            const values = schema.types.map(s => c.constructFromSchema(s)).filter(v => v !== null)

            const currentIndex = values.findIndex(v => v.type === value.type && v.value === value.value)

            return <EditorUI.DropdownInput
                key={schema.type}
                value={currentIndex >= 0 ? currentIndex : 0}
                onValueChanged={i => onValueChanged(values[i])}
                options={values.map(v => {
                    switch (v.type) {
                        case "boolean":
                        case "number":
                            return v.value.toString()
                        case "string": return `"${v.value}"`
                    }
                    return v.type
                })}
            />
        }
    }
}