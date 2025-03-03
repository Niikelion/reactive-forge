import {FC} from "react";
import {isReactNode} from "@reactive-forge/shared";
import {ComponentContext, useComponentContext} from "./ComponentContextProvider";
import {ValueConstruct} from "../constructs";

export const ComponentRenderer: FC<{ path: string, name: string, args: Record<string, ValueConstruct>, context?: ComponentContext }> = ({ path, name, args, context }) => {
    const providedContext = useComponentContext()
    context ??= providedContext

    const node = context.resolve({
        type: "element",
        value: { path, name, args }
    }, { type: "element" })

    if (!isReactNode(node)) return null

    return node
}