import {ComponentProps, useMemo} from "react";
import {useComponentLibrary} from "./ComponentLibraryProvider";
import {ComponentContext} from "./ComponentContextProvider";
import {c, ObjectConstruct, ValueConstruct} from "../constructs";
import {ObjectTypeSchema} from "@reactive-forge/shared";
import {Construct} from "./editor";
import {ComponentRenderer} from "./ComponentRenderer";
import {useStateWithDeps} from "use-state-with-deps";

const transformArgs = (value: Record<string, ValueConstruct>, schema: ObjectTypeSchema["properties"], context: ComponentContext) => ({
    value,
    valid: [...Object.entries(value)].every(([n, v]) => context.verify(v, schema[n]))
})

export type ComponentPreviewOptions = {
    onValueChanged?: (value: ObjectConstruct) => void
    initialValue?: ObjectConstruct
}

export function useComponentPreview(path: string, name: string, options?: ComponentPreviewOptions) {
    const { onValueChanged, initialValue } = options ?? {}

    const library = useComponentLibrary()
    const component = useMemo(() => library.getComponent(path, name), [library, path, name])
    const context = useMemo(() => new ComponentContext(library), [library])

    const [ args, setArgs ] = useStateWithDeps<{ value: Record<string, ValueConstruct>, valid: boolean  } | null>(() => {
        if (component === null) return null

        return transformArgs(initialValue?.value ?? c.argsConstructsFromSchema(component.args), component.args, context)
    }, [component])

    if (args === null || component === null) return null

    function updateArgs(value: ObjectConstruct) {
        setArgs(transformArgs(value.value, component!.args, context))
        if (onValueChanged)
            onValueChanged(value)
    }

    return {
        editorProps: {
            schema: { type: "object", properties: component.args },
            value: c.object(args.value),
            onValueChanged: v => {
                if (v.type !== "object") return
                updateArgs(v)
            }
        } satisfies ComponentProps<typeof Construct>,
        rendererProps: !args.valid ? null : {
            path, name, args: args.value, context
        } satisfies ComponentProps<typeof ComponentRenderer> | null
    }
}