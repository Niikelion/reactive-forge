import {createContext, FC, ReactNode, useContext, useEffect, useMemo, useRef, useState} from "react";
import {c, NonConstructValue, ValueConstruct} from "../constructs";
import {ArgumentValue, ComponentLibrary, ValueTypeSchema} from "@reactive-forge/shared";
import {useComponentLibrary} from "./ComponentLibraryProvider";

export class ComponentContext {
    private readonly params: Map<string, NonConstructValue>
    private readonly variables: Map<string, NonConstructValue>
    private readonly library: ComponentLibrary
    private readonly markDirty: () => void

    constructor(markDirty: () => void, library: ComponentLibrary, params?: Map<string, NonConstructValue>) {
        this.markDirty = markDirty
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
}

const componentContext = createContext(new ComponentContext(() => {}, new ComponentLibrary()))

export const ComponentContextProvider: FC<{ params?: Map<string, NonConstructValue>, variableAssignments?: { name: string, value: ValueConstruct, type: ValueTypeSchema }[], children?: ReactNode }> = ({ params, variableAssignments, children }) => {
    const componentLibrary = useComponentLibrary()

    const [version, setVersion] = useState(0)
    const markDirtyRef = useRef(() => {})
    markDirtyRef.current = () => setVersion(version+1)

    const state = useMemo(() => {
        const context = new ComponentContext(() => markDirtyRef.current(), componentLibrary, params)

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