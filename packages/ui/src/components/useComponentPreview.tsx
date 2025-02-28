import {ComponentProps, useMemo} from "react";
import {useComponentLibrary} from "./ComponentLibraryProvider";
import {ComponentContext} from "./ComponentContextProvider";
import {c, ValueConstruct} from "../constructs";
import {verifyValue} from "@reactive-forge/shared";
import {Construct} from "./editor";
import {ComponentRenderer} from "./ComponentRenderer";
import {useStateWithDeps} from "use-state-with-deps";

export function useComponentPreview(path: string, name: string) {
    const library = useComponentLibrary()
    const component = useMemo(() => library.getComponent(path, name), [library, path, name])
    const context = useMemo(() => new ComponentContext(() => {}, library), [library])

    const [ args, setArgs ] = useStateWithDeps<Record<string, ValueConstruct> | null>(component === null ? null : Object.fromEntries([...Object.entries(component.args)].map(([propName, propSchema]) =>
        [propName, c.constructFromSchema(propSchema) ?? c.undefined()]
    )), [component])

    if (args === null || component === null) return null

    const argsAreValid = [...Object.entries(args)].every(([n, v]) =>
        verifyValue(context.resolve(v, component.args[n]), component.args[n]))

    return {
        editorProps: {
            schema: { type: "object", properties: component.args },
            value: c.object(args),
            onValueChanged: v => {
                if (v.type !== "object") return
                setArgs(v.value)
            }
        } satisfies ComponentProps<typeof Construct>,
        rendererProps: !argsAreValid ? null : {
            path, name, args, context
        } satisfies ComponentProps<typeof ComponentRenderer> | null
    }
}