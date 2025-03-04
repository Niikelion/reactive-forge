import {createContext, FC, ReactNode, useContext, useEffect, useMemo, useRef, useState} from "react";
import {c, NonConstructValue, ValueConstruct} from "../constructs";
import {ArgumentValue, ComponentLibrary, ValueTypeSchema, verifyValue} from "@reactive-forge/shared";
import {useComponentLibrary} from "./ComponentLibraryProvider";

export class ComponentContext {
    private readonly params: Map<string, NonConstructValue>
    private readonly variables: Map<string, NonConstructValue>
    private readonly library: ComponentLibrary
    private readonly markDirty: () => void

    constructor(library: ComponentLibrary, markDirty?: () => void, params?: Map<string, NonConstructValue>) {
        this.markDirty = markDirty ?? (() => {})
        this.library = library
        this.params = params ?? new Map()
        this.variables = new Map()
    }

    public setVariable(name: string, value: ValueConstruct, schema: ValueTypeSchema) {
        const type = this.variables.get(name)?.type ?? schema

        const resolvedValue = this.resolve(value, type)
        this.variables.set(name, { value: resolvedValue, type })
        this.markDirty()
    }

    public resolve(value: ValueConstruct, schema: ValueTypeSchema): ArgumentValue {
        return c.resolveConstruct(value, schema, this.params, this.variables, this.library)
    }

    public verify(value: ValueConstruct, schema: ValueTypeSchema): boolean {
        if (value.type === "param" || value.type === "var")
            return verifyValue(this.resolve(value, schema), schema)

        switch (schema.type) {
            case "null":
            case "undefined":
            case "date":
            case "element":
                return value.type === schema.type
            case "boolean":
                return value.type === "boolean" && (schema.value === undefined || schema.value === value.value)
            case "number":
                return value.type === "number" && (schema.value === undefined || schema.value === value.value)
            case "string":
                return value.type === "string" && (schema.value === undefined || schema.value === value.value)
            case "array": {
                if (value.type !== "array") return false

                for (const val of value.value)
                    if (!this.verify(val, schema.elementType))
                        return false

                return true
            }
            case "object": {
                if (value.type !== "object") return false

                const hasAllRequiredProperties = [...Object.entries(schema.properties)].every(([propName, propSchema]) =>
                    (propName in value.value) || !propSchema.required)

                // Check that every required property is provided
                if (!hasAllRequiredProperties) return false

                return [...Object.entries(value.value)].every(([propName, propValue]) => {
                    // If explicitly defined, check if schema matches
                    if (propName in schema.properties && !this.verify(propValue, schema.properties[propName]))
                        return false

                    // If number index exists and index is number, verify with schema from number index
                    if (schema.numberIndex !== undefined && !isNaN(Number(propName)))
                        return this.verify(propValue, schema.numberIndex)

                    // If string index exists, check verify with schema from number index
                    if (schema.stringIndex !== undefined)
                        return this.verify(propValue, schema.stringIndex)

                    return true
                })
            }
            case "union": {
                for (const variant of schema.types)
                    if (this.verify(value, variant))
                        return true

                return false
            }
        }
    }
}

const componentContext = createContext(new ComponentContext(new ComponentLibrary()))

export const ComponentContextProvider: FC<{ params?: Map<string, NonConstructValue>, variableAssignments?: { name: string, value: ValueConstruct, type: ValueTypeSchema }[], children?: ReactNode }> = ({ params, variableAssignments, children }) => {
    const componentLibrary = useComponentLibrary()

    const [version, setVersion] = useState(0)
    const markDirtyRef = useRef(() => {})
    markDirtyRef.current = () => setVersion(version+1)

    const state = useMemo(() => {
        const context = new ComponentContext(componentLibrary, () => markDirtyRef.current(), params)

        for (const assignment of variableAssignments ?? [])
            context.setVariable(assignment.name, assignment.value, assignment.type)

        return context
    }, [params, variableAssignments, componentLibrary])

    useEffect(() => markDirtyRef.current = () => {}, []);

    return <componentContext.Provider value={state}>
        {children}
    </componentContext.Provider>
}

export const useComponentContext = () => useContext(componentContext)